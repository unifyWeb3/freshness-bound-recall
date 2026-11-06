import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  recallCheckedLifecycleSample,
  RECALL_CHECKED_LIFECYCLE_SCHEMA,
  RECORDED_LIFECYCLE_SAMPLE_NAME,
} from "../src/recall-checked.mjs";
import {
  resolveSupersededMemory,
  selectRecordedRevisionLifecycle,
} from "../src/recorded-lifecycle.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));
const PREDECESSOR_BLOB = "goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY";
const CORRECTION_BLOB = "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY";
const EQUIVALENT_BLOB = "zAji1w8p4REMzUF2o1V7IfgfQlpN7np7Qs8ehtNVXHg";

test("recorded lifecycle resolves the latest correction's exact claim fallback to its real blob", () => {
  const lifecycle = selectRecordedRevisionLifecycle(SNAPSHOT);

  assert.equal(lifecycle.predecessor.blob_id, PREDECESSOR_BLOB);
  assert.equal(lifecycle.predecessor.claim, "obs-sui-clock-341742424");
  assert.equal(lifecycle.predecessor.proof.checkpoint_seq, 341742424);
  assert.equal(lifecycle.predecessor.proof.object_version, "1018797179");

  assert.equal(lifecycle.correction.blob_id, CORRECTION_BLOB);
  assert.equal(lifecycle.correction.claim, "cor-sui-clock-341742463");
  assert.equal(lifecycle.correction.proof.checkpoint_seq, 341742463);
  assert.equal(lifecycle.correction.proof.object_version, "1018797298");
  assert.equal(lifecycle.storedReference, "obs-sui-clock-341742424");
  assert.equal(lifecycle.storedReferenceKind, "claim");
  assert.equal(lifecycle.resolvedBlobId, PREDECESSOR_BLOB);
  assert.equal(resolveSupersededMemory(lifecycle.correction, SNAPSHOT.memories), lifecycle.predecessor);
});

test("recorded lifecycle preserves the stale trigger and identifies the later proof-equivalent check", () => {
  const lifecycle = selectRecordedRevisionLifecycle(SNAPSHOT);

  assert.equal(lifecycle.trigger.at, "2026-11-05T00:57:47.704Z");
  assert.equal(lifecycle.trigger.verdict, "STALE");
  assert.equal(lifecycle.trigger.signal, "MISSED-CHANGE");
  assert.equal(lifecycle.trigger.memory.claim, lifecycle.predecessor.claim);
  assert.equal(lifecycle.trigger.memory.blob_id, null, "the predecessor blob was still in flight at the trigger");
  assert.equal(lifecycle.trigger.live.checkpoint_seq, lifecycle.correction.proof.checkpoint_seq);
  assert.equal(lifecycle.trigger.pin.version, lifecycle.correction.proof.object_version);
  assert.equal(lifecycle.trigger.pin.digest, lifecycle.correction.proof.object_digest);

  assert.equal(lifecycle.laterEvent.at, "2026-11-05T00:59:46.327Z");
  assert.ok(Date.parse(lifecycle.laterEvent.at) > Date.parse(lifecycle.correction.created_at));
  assert.equal(lifecycle.laterEvent.memory.blob_id, EQUIVALENT_BLOB);
  assert.equal(lifecycle.laterEvent.memory.claim, "obs-sui-clock-341742463");
  assert.equal(lifecycle.laterEventActuallyRecalledCorrection, false);
  assert.equal(lifecycle.laterEvent.memory.proof_at_write.checkpoint_seq, lifecycle.correction.proof.checkpoint_seq);
  assert.equal(lifecycle.laterEvent.memory.proof_at_write.object_version, lifecycle.correction.proof.object_version);
  assert.equal(lifecycle.laterEvent.memory.proof_at_write.object_digest, lifecycle.correction.proof.object_digest);
});

test("lifecycle sample is deterministic, offline, read-only, and visibly STALE -> FRESH -> STALE", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("recorded lifecycle must not use the network"); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const first = await recallCheckedLifecycleSample();
  const second = await recallCheckedLifecycleSample();

  assert.deepEqual(second, first);
  assert.equal(first.schema, RECALL_CHECKED_LIFECYCLE_SCHEMA);
  assert.equal(first.source.sample, RECORDED_LIFECYCLE_SAMPLE_NAME);
  assert.equal(first.source.network_access, false);
  assert.equal(first.read_only, true);
  assert.deepEqual(first.writes, []);
  assert.deepEqual(first.behavior.sequence, ["STALE", "FRESH", "STALE"]);

  assert.equal(first.revision.predecessor.blob_id, PREDECESSOR_BLOB);
  assert.equal(first.revision.correction.blob_id, CORRECTION_BLOB);
  assert.equal(first.revision.correction.supersedes.stored_reference, "obs-sui-clock-341742424");
  assert.equal(first.revision.correction.supersedes.resolved_blob_id, PREDECESSOR_BLOB);
  assert.equal(first.revision.correction.persistence_delay_ms, 117242);
  assert.equal(first.behavior.before_revision.decision_kind, "recorded-mainnet-decision");
  assert.equal(first.behavior.before_revision.withheld, true);

  const after = first.behavior.at_revision_proof.result;
  assert.equal(first.behavior.at_revision_proof.decision_kind, "deterministic-replay-at-correction-proof");
  assert.equal(after.at, "2026-11-05T00:57:47.704Z");
  assert.equal(after.memory.blob_id, CORRECTION_BLOB);
  assert.equal(after.verdict, "FRESH");
  assert.equal(after.withheld, false);
  assert.equal(after.read_only, true);
  assert.deepEqual(after.writes, []);
  assert.deepEqual(after.verification.reads, { checkpoint: 1, pin: 1, budget_max: 2 });

  const subsequent = first.behavior.first_post_persistence_check;
  assert.equal(subsequent.decision_kind, "deterministic-replay-over-first-post-persistence-check");
  assert.ok(Date.parse(subsequent.recorded_event.at) > Date.parse(first.revision.correction.created_at));
  assert.equal(subsequent.recorded_event.milliseconds_after_persistence, 1381);
  assert.equal(subsequent.recorded_event.actually_recalled_correction_blob, false);
  assert.equal(subsequent.recorded_event.proof_equivalent_memory_blob_id, EQUIVALENT_BLOB);
  assert.equal(subsequent.result.memory.blob_id, CORRECTION_BLOB);
  assert.equal(subsequent.result.verdict, "STALE");
  assert.equal(subsequent.result.withheld, true);
  assert.equal(subsequent.result.verification.subject_changed, true);
  assert.equal(subsequent.result.read_only, true);
  assert.deepEqual(subsequent.result.writes, []);
  assert.deepEqual(subsequent.result.verification.reads, { checkpoint: 1, pin: 1, budget_max: 2 });

  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "stable contract must contain no undefined fields");
});

test("recorded lifecycle fails closed on missing, ambiguous, or inconsistent evidence", async (t) => {
  await t.test("missing predecessor", async () => {
    const broken = structuredClone(SNAPSHOT);
    broken.memories = broken.memories.filter((memory) => memory.blob_id !== PREDECESSOR_BLOB);
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /supersedes reference .* is missing|cannot be resolved/);
  });

  await t.test("ambiguous claim fallback", async () => {
    const broken = structuredClone(SNAPSHOT);
    const duplicate = structuredClone(broken.memories.find((memory) => memory.blob_id === PREDECESSOR_BLOB));
    duplicate.blob_id = "duplicate-predecessor-blob-id";
    broken.memories.push(duplicate);
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /supersedes reference .* is ambiguous/);
  });

  await t.test("stored reference cannot be masked by a derived supersedes_ref", async () => {
    const broken = structuredClone(SNAPSHOT);
    const correction = broken.memories.find((memory) => memory.blob_id === CORRECTION_BLOB);
    correction.supersedes = "missing-historical-reference";
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /stored supersedes reference .* cannot be resolved/);
  });

  await t.test("stored and resolved references cannot disagree", async () => {
    const broken = structuredClone(SNAPSHOT);
    const correction = broken.memories.find((memory) => memory.blob_id === CORRECTION_BLOB);
    correction.supersedes = EQUIVALENT_BLOB;
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /stored supersedes reference .* disagrees/);
  });

  await t.test("missing correction proof field", async () => {
    const broken = structuredClone(SNAPSHOT);
    const correction = broken.memories.find((memory) => memory.blob_id === CORRECTION_BLOB);
    delete correction.proof.checkpoint_digest;
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /missing proof\.checkpoint_digest/);
  });

  await t.test("predecessor and correction chain proofs disagree", async () => {
    const broken = structuredClone(SNAPSHOT);
    const predecessor = broken.memories.find((memory) => memory.blob_id === PREDECESSOR_BLOB);
    predecessor.proof.chain_id = "not-the-recorded-chain";
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /disagree on proof\.chain_id/);
  });

  await t.test("correction persistence cannot predate its proof", async () => {
    const broken = structuredClone(SNAPSHOT);
    const correction = broken.memories.find((memory) => memory.blob_id === CORRECTION_BLOB);
    correction.created_at = "2026-11-05T00:57:00.000Z";
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /persisted before it was recorded/);
  });

  await t.test("trigger does not match correction", async () => {
    const broken = structuredClone(SNAPSHOT);
    const trigger = broken.ledger.find((event) => event.at === "2026-11-05T00:57:47.704Z" && event.class === "FAST");
    trigger.pin.digest = "not-the-correction-digest";
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /no recorded stale trigger matches/);
  });

  await t.test("no later proof-equivalent behavior", async () => {
    const broken = structuredClone(SNAPSHOT);
    broken.ledger = broken.ledger.filter((event) => Date.parse(event.at) <= Date.parse("2026-11-05T00:59:44.946146Z"));
    await assert.rejects(recallCheckedLifecycleSample({ snapshot: broken }), /no later recorded check carries/);
  });
});
