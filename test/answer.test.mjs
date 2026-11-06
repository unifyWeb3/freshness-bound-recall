import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockStore } from "../src/store.mjs";
import { PolicyEngine } from "../src/policy.mjs";
import { Ledger } from "../src/ledger.mjs";
import { answer } from "../src/answer.mjs";
import { recordToText } from "../src/schema.mjs";
import { FakeTatum } from "./helpers/fake-tatum.mjs";

const SUBJECT = "0x0000000000000000000000000000000000000000000000000000000000000006";
const REGISTRY = "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f";
const NOW = Date.parse("2026-11-05T01:00:00.000Z");

function claim({ claim = "fc-fast-clock-0001", className = "FAST", subject = SUBJECT,
  checkpoint = 1000000, version = "v1", digest = "d1", readAt = "2026-11-05T00:59:00.000Z" } = {}) {
  return recordToText({
    claim, class: className, epoch: 1, state: "live", subject, predicate: "object_version",
    value_at_write: `version=${version}`,
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
    "proof.checkpoint_seq": checkpoint,
    "proof.checkpoint_digest": "cpAtWrite",
    "proof.object_version": version,
    "proof.object_digest": digest,
    "proof.read_at": readAt,
    agent_id: "agent-test",
    recorded_at: readAt,
    body: `The subject ${subject} was observed at version ${version} at checkpoint ${checkpoint}.`,
  });
}

function setup({ texts = [], checkpoint = 1000010, objects = {}, ...rest } = {}) {
  const store = new MockStore({ namespace: "freshness-recall", initial: texts });
  const tatum = new FakeTatum({
    checkpoint: { sequenceNumber: checkpoint, digest: "cpLive", timestamp: "2026-11-05T01:00:00.000Z" },
    objects: { [SUBJECT]: { version: "v1", digest: "d1" }, ...objects },
    ...rest,
  });
  const policy = new PolicyEngine({ store });
  const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "fr-ledger-")), "ledger.jsonl"));
  return { store, tatum, policy, ledger };
}

test("a fresh memory answers from memory with the checkpoint stamps in the text", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [claim()] });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "FRESH");
  assert.equal(out.withheld, false);
  assert.match(out.answer, /checkpoint 1000000/);
  assert.match(out.answer, /10 checkpoints ago/);
  assert.equal(out.reads.checkpoint, 1);
  assert.equal(out.reads.pin, 1);
  assert.equal(out.writes.length, 0, "nothing to write for a fresh answer");
});

test("a changed subject is withheld and the answer comes from the live read", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    objects: { [SUBJECT]: { version: "v2", digest: "d2" } },
  });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "STALE");
  assert.equal(out.withheld, true);
  assert.match(out.answer, /WITHHELD/);
  assert.match(out.answer, /version=v2/);
  assert.equal(out.signal, "MISSED-CHANGE");
});

test("a stale answer writes exactly one superseding correction memory", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    objects: { [SUBJECT]: { version: "v2", digest: "d2" } },
  });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  const corrections = out.writes.filter((w) => w.type === "correction");
  assert.equal(corrections.length, 1);
  assert.ok(corrections[0].blob_id);
  const written = await store.recall({ query: "Correction supersedes", limit: 5 });
  assert.ok(written.results.some((r) => r.text.includes("supersedes")));
});

test("the gate fails closed when the live read fails, and writes nothing", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [claim()], failCheckpoint: true });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "WITHHELD_UNVERIFIED");
  assert.equal(out.withheld, true);
  assert.match(out.reason, /fail closed/);
  assert.equal(out.writes.length, 0);
  assert.equal(out.live, null);
});

test("the gate fails closed when only the subject pin fails", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [claim()], failObject: true });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "WITHHELD_UNVERIFIED");
  assert.match(out.reason, /subject pin read failed/);
  assert.equal(out.writes.length, 0);
});

test("a FALSE-STALE verdict does not write a correction memory (the memory is still true)", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    checkpoint: 1000060, // delta 60 > window 50, but the subject is unchanged
    objects: { [SUBJECT]: { version: "v1", digest: "d1" } },
  });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "STALE");
  assert.equal(out.signal, "FALSE-STALE");
  assert.equal(out.subject_changed, false);
  assert.equal(out.writes.filter((w) => w.type === "correction").length, 0,
    "a still-true memory must not be superseded");
  assert.match(out.answer, /still true/);
});

test("the policy memory is written exactly once per change", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    checkpoint: 1000060, // delta 60 > window 50 -> FALSE-STALE
    objects: { [SUBJECT]: { version: "v1", digest: "d1" } },
  });
  const q = "clock version";
  const o1 = await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  const o2 = await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  const o3 = await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(o1.policy.changed, false);
  assert.equal(o2.policy.changed, false);
  assert.equal(o3.policy.changed, true, "the third actionable sample changes the policy");
  assert.equal(o3.policy.after_window, 100);

  const policyMemories = (await store.recall({ query: "Learned policy for claim class", limit: 20 }))
    .results.filter((r) => r.text.includes("policy_window"));
  assert.equal(policyMemories.length, 1, "exactly one policy memory per change");
});

test("a policy change is committed in memory only after storage confirms a blob id", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    checkpoint: 1000060,
    objects: { [SUBJECT]: { version: "v1", digest: "d1" } },
  });
  const q = "clock version";
  await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });

  const waitFor = store.waitFor.bind(store);
  let windowDuringWait = null;
  store.waitFor = async (jobId) => {
    windowDuringWait = policy.state("FAST").windowCheckpoints;
    return waitFor(jobId);
  };

  const out = await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(windowDuringWait, 50,
    "the proposed window must not be visible before persistence succeeds");
  assert.equal(out.policy.changed, true);
  assert.equal(out.policy.after_window, 100);
  assert.equal(policy.state("FAST").windowCheckpoints, 100);
  assert.ok(out.writes.find((w) => w.type === "policy")?.blob_id);
});

test("a failed or unconfirmed policy write rolls back the proposed in-memory change", async () => {
  for (const failure of ["throw", "no-blob"]) {
    const { store, tatum, policy, ledger } = setup({
      texts: [claim()],
      checkpoint: 1000060,
      objects: { [SUBJECT]: { version: "v1", digest: "d1" } },
    });
    const q = "clock version";
    await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
    await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
    store.waitFor = failure === "throw"
      ? async () => { throw new Error("write failed"); }
      : async () => [];

    const out = await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
    assert.equal(out.policy.changed, false, failure);
    assert.equal(out.policy.after_window, 50, failure);
    assert.equal(policy.state("FAST").windowCheckpoints, 50, failure);
    assert.equal(policy.state("FAST").version, 0, failure);
    assert.equal(policy.state("FAST").pendingSamples, 2, failure);
    assert.match(out.writes.find((w) => w.type === "policy")?.error || "", /failed|blob/i, failure);
  }
});

test("the policy memory is read again on the next answer and widens the gate", async () => {
  const { store, tatum, policy, ledger } = setup({
    texts: [claim()],
    checkpoint: 1000060,
    objects: { [SUBJECT]: { version: "v1", digest: "d1" } },
  });
  const q = "clock version";
  await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  await answer(q, { store, tatum, policy, ledger, now: NOW, writeCorrections: true });

  // A fresh engine (as if the process restarted) must pick the window up from the store.
  const engine2 = new PolicyEngine({ store });
  await engine2.load();
  assert.equal(engine2.state("FAST").windowCheckpoints, 100);

  tatum.setCheckpoint(1000090); // delta 90: stale under window 50, fresh under window 100
  const out = await answer(q, { store, tatum, policy: engine2, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.policy.before_window, 100);
  assert.equal(out.verdict, "FRESH", "the learned window makes the same query fresh");
});

test("an answer never uses more than 2 Tatum reads", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [claim()] });
  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.ok(tatum.networkCalls <= 2, `expected <= 2 network reads, got ${tatum.networkCalls}`);
  assert.equal(out.reads.budget_max, 2);
});

test("no stored claim means no answer and no reads", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [] });
  const out = await answer("nothing stored", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(out.verdict, "WITHHELD_UNVERIFIED");
  assert.match(out.reason, /no claim memory found/);
  assert.equal(tatum.networkCalls, 0);
});

test("the decision is written to the ledger with its checkpoint stamps", async () => {
  const { store, tatum, policy, ledger } = setup({ texts: [claim()] });
  await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: true });
  assert.equal(ledger.entries.length, 1);
  const e = ledger.entries[0];
  assert.equal(e.live.checkpoint_seq, 1000010);
  assert.equal(e.memory.proof_at_write.checkpoint_seq, 1000000);
  assert.equal(e.verdict, "FRESH");
});

test("answer keeps semantic ranking and chooses the closest valid hit in the requested subject domain", async () => {
  const target = claim({
    claim: "fc-fast-clock-target",
    version: "v1",
    digest: "d1",
    readAt: "2026-11-05T00:50:00.000Z",
  });
  const newerSameSubject = claim({
    claim: "fc-fast-clock-newer-but-farther",
    version: "v2",
    digest: "d2",
    readAt: "2026-11-05T00:59:00.000Z",
  });
  const unrelatedNewest = claim({
    claim: "fc-slow-memwal-registry-newest",
    className: "SLOW",
    subject: REGISTRY,
    version: "r1",
    digest: "rd1",
    readAt: "2026-11-05T00:59:30.000Z",
  });

  const store = new MockStore({ namespace: "freshness-recall" });
  store.recall = async ({ query }) => query.startsWith("FR-v1 policy")
    ? { results: [], total: 0 }
    : {
      results: [
        { blob_id: "target", text: target, distance: 0.1, created_at: "2026-11-05T00:50:00.000Z" },
        { blob_id: "same-subject-farther", text: newerSameSubject, distance: 0.3, created_at: "2026-11-05T00:59:00.000Z" },
        { blob_id: "unrelated", text: unrelatedNewest, distance: 0.01, created_at: "2026-11-05T00:59:30.000Z" },
      ],
      total: 3,
    };
  const tatum = new FakeTatum({
    checkpoint: { sequenceNumber: 1000010, digest: "cpLive", timestamp: "2026-11-05T01:00:00.000Z" },
    objects: {
      [SUBJECT]: { version: "v1", digest: "d1" },
      [REGISTRY]: { version: "r1", digest: "rd1" },
    },
  });
  const policy = new PolicyEngine({ store });
  const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "fr-ledger-")), "ledger.jsonl"));

  const out = await answer("clock version", { store, tatum, policy, ledger, now: NOW, writeCorrections: false });
  assert.equal(out.memory.claim, "fc-fast-clock-target");
  assert.equal(out.memory.blob_id, "target");
  assert.equal(out.memory.distance, 0.1);
  assert.equal(out.verdict, "FRESH");
});
