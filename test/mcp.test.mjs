// MCP server tests: discovery, schemas, invocation, structured output,
// argument validation, read-only defaults, and write gating.
// All tests are offline; no credentials and no network are used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRecallGuardMcpServer, MCP_TOOLS, UNTRUSTED_MEMORY_NOTE } from "../src/mcp.mjs";

const CLEAN_ENV = {
  RECALLGUARD_LIVE: "",
  RECALLGUARD_ENABLE_WRITES: "",
  TATUM_API_KEY: "",
  MEMWAL_ACCOUNT_ID: "",
  MEMWAL_AGENT_ID: "",
  MEMWAL_PRIVATE_KEY: "",
};

async function withClient(fn, { env = CLEAN_ENV } = {}) {
  const server = createRecallGuardMcpServer({ env, cwd: process.cwd() });
  const client = new Client({ name: "recallguard-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn({ client, server });
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

const parseTextJson = (result) => JSON.parse(result.content[0].text.split("\n").slice(-1)[0]);

test("server starts and lists exactly the documented tools with schemas", async () => {
  await withClient(async ({ client }) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...MCP_TOOLS].sort());
    for (const tool of tools) {
      assert.ok(tool.description?.length > 20, `${tool.name} needs a real description`);
      assert.equal(tool.inputSchema?.type, "object", `${tool.name} must publish an object input schema`);
      assert.ok(tool.annotations, `${tool.name} must publish tool annotations`);
    }
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    assert.equal(readOnly.recall_checked, true);
    assert.equal(readOnly.explain_decision, true);
    assert.equal(readOnly.list_revisions, true);
    assert.equal(readOnly.get_evidence, true);
    assert.equal(readOnly.propose_correction, true);
    assert.equal(readOnly.store_correction, false, "store_correction must not advertise itself as read-only");
  });
});

test("recall_checked returns the withheld recorded decision as structured output", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "recall_checked", arguments: { sample: "sui-clock-changed" } });
    assert.equal(result.isError, undefined);
    const decision = result.structuredContent;
    assert.equal(decision.schema, "recall_checked/v1");
    assert.equal(decision.read_only, true);
    assert.equal(decision.verdict, "STALE");
    assert.equal(decision.withheld, true);
    assert.equal(decision.writes.length, 0);
    assert.ok(decision.untrusted_memory_note === UNTRUSTED_MEMORY_NOTE);
    assert.ok(decision.memory?.blob_id, "memory blob id must be preserved for provenance");
  });
});

test("recall_checked replays the full revision lifecycle sample", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "recall_checked", arguments: { sample: "sui-clock-revision-lifecycle" } });
    assert.equal(result.isError, undefined);
    const lifecycle = result.structuredContent;
    assert.equal(lifecycle.schema, "recall_checked_lifecycle/v1");
    assert.deepEqual(lifecycle.behavior.sequence, ["STALE", "FRESH", "STALE"]);
    assert.equal(lifecycle.writes.length, 0);
    assert.ok(lifecycle.revision?.correction?.blob_id);
    assert.ok(lifecycle.revision?.predecessor?.blob_id);
  });
});

test("recall_checked rejects invalid arguments", async () => {
  await withClient(async ({ client }) => {
    const badSample = await client.callTool({ name: "recall_checked", arguments: { sample: "does-not-exist" } });
    assert.equal(badSample.isError, true);
    const longQuery = await client.callTool({ name: "recall_checked", arguments: { query: "x".repeat(600) } });
    assert.equal(longQuery.isError, true);
  });
});

test("explain_decision separates verified evidence from the recalled claim", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "explain_decision", arguments: { sample: "sui-clock-changed" } });
    assert.equal(result.isError, undefined);
    const explanation = result.structuredContent;
    assert.equal(explanation.schema, "recallguard_explain/v1");
    assert.equal(explanation.withheld, true);
    assert.ok(explanation.at_a_glance.includes("WITHHELD"));
    assert.ok(explanation.memory, "recalled claim must be identified as a memory, not as current fact");
    assert.ok(explanation.verified_live, "live verification evidence must be present");
    assert.equal(explanation.untrusted_memory_note, UNTRUSTED_MEMORY_NOTE);
  });
});

test("list_revisions returns the recorded revision chain with supersedes lineage", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "list_revisions", arguments: { limit: 50 } });
    assert.equal(result.isError, undefined);
    const { revisions, source } = result.structuredContent;
    assert.ok(revisions.length >= 4, "snapshot records several revisions");
    assert.match(source, /committed Mainnet evidence snapshot/);
    const corrections = revisions.filter((r) => r.kind === "correction");
    assert.ok(corrections.length >= 1);
    for (const correction of corrections) {
      assert.ok(correction.supersedes || correction.supersedes_ref, "corrections must carry lineage");
    }
    for (const revision of revisions) {
      assert.ok(Number.isInteger(Number(revision.proof_checkpoint)), "revisions must carry proof checkpoints");
    }
  });
});

test("list_revisions filters by claim class and rejects a bad address", async () => {
  await withClient(async ({ client }) => {
    const filtered = await client.callTool({ name: "list_revisions", arguments: { class: "FAST", limit: 10 } });
    assert.equal(filtered.isError, undefined);
    for (const revision of filtered.structuredContent.revisions) {
      assert.equal(revision.class, "FAST");
    }
    const badAddress = await client.callTool({ name: "list_revisions", arguments: { subject: "not-an-address" } });
    assert.equal(badAddress.isError, true);
  });
});

test("get_evidence without blob_id returns the snapshot overview without secret values", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "get_evidence", arguments: {} });
    assert.equal(result.isError, undefined);
    const overview = result.structuredContent;
    assert.equal(overview.schema, "recallguard_evidence_overview/v1");
    assert.equal(overview.memory_count, 22);
    assert.equal(overview.decision_count, 306);
    const keyProof = overview.tatum_api_key_proof;
    if (keyProof) {
      assert.equal(typeof keyProof.every_request_had_api_key, "boolean");
      assert.ok(!JSON.stringify(overview).includes(process.env.TATUM_API_KEY || "NO_KEY_SET"), "no secret value in output");
    }
  });
});

test("get_evidence resolves a correction blob to its superseded predecessor", async () => {
  await withClient(async ({ client }) => {
    const listed = await client.callTool({ name: "list_revisions", arguments: { class: "FAST", limit: 50 } });
    const correction = listed.structuredContent.revisions.find((r) => r.kind === "correction");
    assert.ok(correction?.blob_id);
    const result = await client.callTool({ name: "get_evidence", arguments: { blob_id: correction.blob_id } });
    assert.equal(result.isError, undefined);
    const evidence = result.structuredContent;
    assert.equal(evidence.schema, "recallguard_evidence/v1");
    assert.equal(evidence.is_correction, true);
    assert.ok(evidence.memory?.proof?.checkpoint_seq, "proof envelope is preserved");
    // unknown blob id fails cleanly
    const missing = await client.callTool({ name: "get_evidence", arguments: { blob_id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" } });
    assert.equal(missing.isError, true);
  });
});

test("propose_correction prepares a draft and never persists", async () => {
  await withClient(async ({ client }) => {
    const listed = await client.callTool({ name: "recall_checked", arguments: { sample: "sui-clock-changed" } });
    const blob = listed.structuredContent.memory.blob_id;
    const result = await client.callTool({
      name: "propose_correction",
      arguments: {
        supersedes_blob_id: blob,
        corrected_claim: "The Sui Clock object is at version 341742463.",
        reason: "Live pin shows the subject version advanced beyond the proof version recorded at write time.",
      },
    });
    assert.equal(result.isError, undefined);
    const draft = result.structuredContent;
    assert.equal(draft.persisted, false);
    assert.equal(draft.approval_required, true);
    assert.equal(draft.found_in_snapshot, true);
    assert.equal(draft.draft.supersedes, blob);
    assert.match(draft.how_to_apply, /approval/i);
  });
});

test("store_correction refuses before any runtime exists when writes are disabled", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({
      name: "store_correction",
      arguments: {
        query: "Is the Sui Clock memory still true?",
        supersedes_blob_id: "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY",
        reason: "testing the disabled-by-default write gate",
        confirm: "STORE-CORRECTION",
      },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /writes are disabled/i);
    assert.match(result.content[0].text, /no network requests/i);
  });
});

test("store_correction requires the literal confirmation and live mode", async () => {
  await withClient(async ({ client }) => {
    const unconfirmed = await client.callTool({
      name: "store_correction",
      arguments: {
        query: "q",
        supersedes_blob_id: "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY",
        reason: "testing the confirmation requirement",
        confirm: "yes",
      },
    });
    assert.equal(unconfirmed.isError, true);
  });
  await withClient(async ({ client }) => {
    const liveButWritesDisabled = await client.callTool({
      name: "store_correction",
      arguments: {
        query: "q",
        supersedes_blob_id: "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY",
        reason: "testing the environment opt-in requirement",
        confirm: "STORE-CORRECTION",
      },
    }, );
    assert.equal(liveButWritesDisabled.isError, true);
    assert.match(liveButWritesDisabled.content[0].text, /writes are disabled/i);
  }, { env: { ...CLEAN_ENV, RECALLGUARD_LIVE: "true", TATUM_API_KEY: "x".repeat(8), MEMWAL_ACCOUNT_ID: "y", MEMWAL_AGENT_ID: "z", MEMWAL_PRIVATE_KEY: "k" } });
});

test("store_correction reports missing credentials without network when live is requested", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({
      name: "store_correction",
      arguments: {
        query: "q",
        supersedes_blob_id: "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY",
        reason: "testing live-mode credential gating for writes",
        confirm: "STORE-CORRECTION",
      },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /RECALLGUARD_LIVE/);
  }, { env: { ...CLEAN_ENV, RECALLGUARD_ENABLE_WRITES: "true" } });
});

test("recall_checked fails closed when live is requested without credentials", async () => {
  await withClient(async ({ client }) => {
    const result = await client.callTool({ name: "recall_checked", arguments: { query: "anything" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /RECALLGUARD_LIVE=true but missing/);
  }, { env: { ...CLEAN_ENV, RECALLGUARD_LIVE: "true" } });
});

test("the evidence-summary resource exposes counts, not secrets", async () => {
  await withClient(async ({ client }) => {
    const { resources } = await client.listResources();
    const summary = resources.find((r) => r.uri === "recallguard://evidence/summary");
    assert.ok(summary, "evidence summary resource must be listed");
    const { contents } = await client.readResource({ uri: "recallguard://evidence/summary" });
    const parsed = JSON.parse(contents[0].text);
    assert.equal(parsed.memory_count, 22);
    assert.equal(parsed.decision_count, 306);
    assert.ok(!contents[0].text.includes(process.env.TATUM_API_KEY || "NO_KEY_SET"));
  });
});

test("the verify-before-answer prompt instructs fail-closed use", async () => {
  await withClient(async ({ client }) => {
    const result = await client.getPrompt({ name: "verify-before-answer", arguments: { claim: "The Sui Clock is at version 42" } });
    assert.equal(result.messages.length, 1);
    const text = result.messages[0].content.text;
    assert.match(text, /recall_checked/);
    assert.match(text, /STALE/);
    assert.match(text, /untrusted data/);
  });
});
