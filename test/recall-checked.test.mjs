import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recallChecked,
  recallCheckedSample,
  RECALL_CHECKED_SCHEMA,
  RECORDED_SAMPLE_NAME,
} from "../src/recall-checked.mjs";
import { createRuntime } from "../src/runtime.mjs";
import { MockStore } from "../src/store.mjs";
import { PolicyEngine } from "../src/policy.mjs";
import { recordToText } from "../src/schema.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";
import { FakeTatum } from "./helpers/fake-tatum.mjs";

const SUBJECT = "0x0000000000000000000000000000000000000000000000000000000000000006";
const NOW = Date.parse("2026-11-05T01:00:00.000Z");

function changedSubjectSetup() {
  const text = recordToText({
    claim: "fc-fast-clock-library-test",
    class: "FAST",
    epoch: 1,
    state: "live",
    subject: SUBJECT,
    predicate: "object_version",
    value_at_write: "version=v1",
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": 1000000,
    "proof.checkpoint_digest": "cp-at-write",
    "proof.object_version": "v1",
    "proof.object_digest": "d1",
    "proof.read_at": "2026-11-05T00:59:00.000Z",
    agent_id: "agent-test",
    recorded_at: "2026-11-05T00:59:00.000Z",
    body: "The Sui Clock object was version v1.",
  });
  const store = new MockStore({ namespace: "recall-checked-test", initial: [text] });
  const remember = store.remember.bind(store);
  let rememberCalls = 0;
  store.remember = async (...args) => {
    rememberCalls += 1;
    return remember(...args);
  };
  const tatum = new FakeTatum({
    checkpoint: {
      sequenceNumber: 1000010,
      digest: "cp-live",
      timestamp: "2026-11-05T01:00:00.000Z",
    },
    objects: { [SUBJECT]: { version: "v2", digest: "d2" } },
  });
  return {
    store,
    tatum,
    policy: new PolicyEngine({ store }),
    rememberCalls: () => rememberCalls,
  };
}

test("recorded Mainnet sample is stable, labelled, and read-only", async () => {
  const result = await recallCheckedSample();

  assert.equal(result.schema, RECALL_CHECKED_SCHEMA);
  assert.equal(result.mode, "recorded-mainnet");
  assert.equal(result.read_only, true);
  assert.equal(result.source.sample, RECORDED_SAMPLE_NAME);
  assert.equal(result.source.network_access, false);
  assert.equal(result.source.actual_walrus_blob_id, result.memory.blob_id);
  assert.match(result.memory.blob_id, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(result.verdict, "STALE");
  assert.equal(result.withheld, true);
  assert.equal(result.verification.subject_changed, true);
  assert.equal(result.writes.length, 0);
  assert.match(result.answer, /^WITHHELD — subject changed/);
});

test("recorded sample rejects unknown sample names", async () => {
  await assert.rejects(
    recallCheckedSample({ sample: "invented" }),
    /unknown sample "invented"; available: sui-clock-changed/,
  );
});

test("recallChecked defaults to zero store writes", async () => {
  const fixture = changedSubjectSetup();
  const result = await recallChecked("clock version", {
    store: fixture.store,
    tatum: fixture.tatum,
    policy: fixture.policy,
    now: NOW,
  });

  assert.equal(result.verdict, "STALE");
  assert.equal(result.read_only, true);
  assert.equal(fixture.rememberCalls(), 0);
  assert.deepEqual(result.writes, []);
});

test("recallChecked writes only after allowWrites is explicitly true", async () => {
  const fixture = changedSubjectSetup();
  const result = await recallChecked("clock version", {
    store: fixture.store,
    tatum: fixture.tatum,
    policy: fixture.policy,
    now: NOW,
    allowWrites: true,
  });

  assert.equal(result.verdict, "STALE");
  assert.equal(result.read_only, false);
  assert.equal(fixture.rememberCalls(), 1);
  assert.equal(result.writes.filter((write) => write.type === "correction").length, 1);
});

test("no-match results keep the stable JSON verification shape", async () => {
  const store = new MockStore({ namespace: "recall-checked-empty" });
  const tatum = new FakeTatum();
  const result = await recallChecked("nothing stored", {
    store,
    tatum,
    policy: new PolicyEngine({ store }),
    now: NOW,
  });

  assert.equal(result.memory, null);
  assert.deepEqual(result.verification, {
    checkpoint: null,
    subject: null,
    subject_changed: null,
    reads: { checkpoint: 0, pin: 0, budget_max: 2 },
  });
});

test("runtime loads a caller-selected .env and lets the process environment override it", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "recall-checked-env-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const envPath = join(scratch, ".env");
  writeFileSync(envPath, [
    "TATUM_API_KEY=from-file",
    "MEMWAL_ACCOUNT_ID=file-account",
    "MEMWAL_AGENT_ID=file-agent",
    "MEMWAL_PRIVATE_KEY=file-private-key",
    "",
  ].join("\n"));

  const runtime = createRuntime({
    envPath,
    environment: {
      TATUM_API_KEY: "from-process",
      MEMWAL_AGENT_ID: "process-agent",
    },
    ledgerPath: null,
    mirrorPath: null,
    logger: () => {},
  });

  assert.equal(runtime.env.TATUM_API_KEY, "from-process");
  assert.equal(runtime.env.MEMWAL_ACCOUNT_ID, "file-account");
  assert.equal(runtime.env.MEMWAL_AGENT_ID, "process-agent");
  assert.equal(runtime.env.MEMWAL_PRIVATE_KEY, "file-private-key");
});

test("runtime rejects missing live credentials before constructing a Mainnet client", () => {
  assert.throws(
    () => createRuntime({
      live: true,
      envPath: "/definitely/not/a/real/recall-checked.env",
      environment: { PATH: process.env.PATH },
      ledgerPath: null,
      mirrorPath: null,
      logger: () => {},
    }),
    /missing: TATUM_API_KEY, MEMWAL_ACCOUNT_ID, MEMWAL_AGENT_ID, MEMWAL_PRIVATE_KEY/,
  );
});
