import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { replay, ablation, readEvents } from "../src/replay.mjs";
import { evaluateGate, VERDICT, SIGNAL } from "../src/gate.mjs";
import { page, summarize } from "../scripts/proof-page.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const events = readEvents(resolve(ROOT, "fixtures/event-log.json"));
const FAST_Q = "Is the Sui clock object still at the recorded version?";

test("the recorded event log loads with the expected shape", () => {
  assert.ok(events.length >= 8);
  assert.ok(events.every((e) => e.query && e.memory?.proof_at_write?.checkpoint_seq !== undefined));
});

test("replay: the first three FALSE-STALE signals move the window once (min sample count)", () => {
  const r = replay(events, { query: FAST_Q, className: "FAST" });
  assert.equal(r.timeline[0].verdict, VERDICT.STALE);
  assert.equal(r.timeline[0].signal, SIGNAL.FALSE_STALE);
  assert.equal(r.timeline[0].policy_changed, false, "no change before the minimum sample count");
  assert.equal(r.timeline[1].policy_changed, false);
  assert.equal(r.timeline[2].policy_changed, true, "the third actionable sample changes the policy");
  assert.equal(r.policyChanges[0].from, 50);
  assert.equal(r.policyChanges[0].to, 100);
  assert.match(r.policyChanges[0].reason, /widen/);
});

test("replay: the same query gets a different verdict after the policy memory changes", () => {
  const r = replay(events, { query: FAST_Q, className: "FAST" });
  const e4 = r.timeline[3];
  assert.equal(e4.verdict, VERDICT.FRESH, "the widened window makes the same query fresh");
  assert.equal(e4.window_before, 100);
  assert.match(e4.reason, /fresh/);

  // The identical event data under the pre-change window is stale.
  const ev = events[3];
  const underOldPolicy = evaluateGate({
    record: {
      class: "FAST", claim: ev.memory.claim, subject: ev.memory.subject, predicate: ev.memory.predicate,
      "proof.chain_id": ev.memory.proof_at_write.chain_id,
      "proof.checkpoint_seq": ev.memory.proof_at_write.checkpoint_seq,
      "proof.checkpoint_digest": ev.memory.proof_at_write.checkpoint_digest,
      "proof.object_version": ev.memory.proof_at_write.object_version,
      "proof.object_digest": ev.memory.proof_at_write.object_digest,
      "proof.read_at": ev.memory.proof_at_write.read_at,
    },
    live: { checkpointSeq: ev.live.checkpoint_seq, checkpointDigest: ev.live.checkpoint_digest, readAt: ev.live.read_at },
    pin: { version: ev.pin.version, digest: ev.pin.digest, readAt: ev.pin.read_at },
    policy: { windowCheckpoints: 50, minCheckpoints: 10, maxCheckpoints: 200000, maxAgeSeconds: 86400 },
    now: Date.parse("2026-11-05T01:00:00.000Z"),
  });
  assert.equal(underOldPolicy.verdict, VERDICT.STALE);
  assert.equal(underOldPolicy.signal, SIGNAL.FALSE_STALE);
});

test("replay: three MISSED-CHANGE signals tighten the window", () => {
  const r = replay(events, { query: FAST_Q, className: "FAST" });
  const tight = r.policyChanges.find((c) => /tighten/.test(c.reason));
  assert.ok(tight, "expected a tightening change");
  assert.equal(tight.from, 100);
  assert.equal(tight.to, 50);
  assert.equal(r.policyChanges.length, 2);
});

test("replay: a CONSISTENT signal never moves the window", () => {
  const r = replay(events, { query: FAST_Q, className: "FAST" });
  const fresh = r.timeline.find((t) => t.signal === SIGNAL.CONSISTENT);
  assert.ok(fresh);
  assert.equal(fresh.policy_changed, false);
  assert.equal(fresh.window_before, fresh.window_after);
});

test("replay: the SLOW class subject stays fresh under its wider window", () => {
  const r = replay(events, { query: "Is the MemWal AccountRegistry still at the recorded version?", className: "SLOW" });
  assert.equal(r.timeline[0].verdict, VERDICT.FRESH);
  assert.equal(r.policyChanges.length, 0);
});

test("replay evaluates every decision at that event's timestamp", () => {
  const r = replay(events, {
    query: FAST_Q,
    className: "FAST",
    now: Date.parse("2099-01-01T00:00:00.000Z"),
  });
  assert.equal(r.timeline[3].verdict, VERDICT.FRESH,
    "a caller's current time must not make a historical event fail the wall-clock backstop");
});

test("ablation: memory-off never answers from a stale memory", () => {
  const rows = ablation(events, { className: "FAST" });
  const fast = rows.find((r) => r.query === FAST_Q);
  const off = fast["memory-off"];
  assert.equal(off.answers_from_memory, 0);
  assert.equal(off.answers_from_live, fast.events);
  assert.equal(off.changed_answers, 0);
  assert.equal(off.still_true_old_answers, 0);
  assert.equal(off.unverified_answers, 0);
  assert.equal(off.tatum_reads, fast.events, "memory-off reads the subject once per answer");
});

test("ablation: memory-on without the gate separates changed, still-true old, and unverified answers", () => {
  const rows = ablation(events, { className: "FAST" });
  const fast = rows.find((r) => r.query === FAST_Q);
  const on = fast["memory-on (no gate)"];
  assert.equal(on.answers_from_memory, fast.events);
  assert.equal(on.tatum_reads, 0, "no verification reads without the gate");
  assert.ok(on.changed_answers > 0, "the gate is what prevents changed memories from answering");
  assert.ok(on.still_true_old_answers > 0, "old-but-still-true memories are reported separately");
  assert.equal(on.unverified_answers, 0);
  assert.equal("stale_answers" in on, false, "the ambiguous combined count is removed");
});

test("ablation: memory-on with the gate answers only what it proved fresh", () => {
  const rows = ablation(events, { className: "FAST" });
  const fast = rows.find((r) => r.query === FAST_Q);
  const gated = fast["memory-on (gate + learned policy)"];
  assert.equal(gated.changed_answers, 0);
  assert.equal(gated.still_true_old_answers, 0);
  assert.equal(gated.unverified_answers, 0);
  assert.equal(gated.answers_from_memory + gated.withheld, fast.events);
  assert.equal(gated.tatum_reads, fast.events * 2, "one checkpoint + one pin per answer");
  assert.ok(gated.withheld > 0, "the gate must withhold at least one memory");
});

test("proof-page ablation reports the recorded 214 changed / 16 still-true old / 4 unverified split", () => {
  const snapshot = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));
  const summary = summarize(snapshot);
  const noGate = summary.ablation.rows.find((r) => r.name === "memory-on, no gate");
  assert.equal(noGate.changed_answers, 214);
  assert.equal(noGate.still_true_old_answers, 16);
  assert.equal(noGate.unverified_answers, 4);
  assert.equal("stale_answers" in noGate, false);

  const html = page(snapshot);
  assert.match(html, /changed answers/);
  assert.match(html, /still-true old/);
  assert.match(html, /unverified/);
  assert.doesNotMatch(html, /<th>stale answers<\/th>/);
});
