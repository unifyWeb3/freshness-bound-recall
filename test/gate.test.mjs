import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, learningSignal, VERDICT, SIGNAL } from "../src/gate.mjs";

const NOW = Date.parse("2026-11-05T01:00:00.000Z");

function rec(over = {}) {
  return {
    class: "FAST",
    claim: "fc-fast-clock-0001",
    subject: "0x6",
    predicate: "object_version",
    "proof.checkpoint_seq": 1000,
    "proof.object_version": "v1",
    "proof.object_digest": "d1",
    "proof.read_at": "2026-11-05T00:59:00.000Z",
    ...over,
  };
}
const live = (seq) => ({ checkpointSeq: seq, checkpointDigest: `cp${seq}`, readAt: "2026-11-05T01:00:00.000Z" });
const pin = (version, digest = "d1") => ({ version, digest, readAt: "2026-11-05T01:00:00.000Z" });
const policy = (windowCheckpoints = 50, maxAgeSeconds = 86400) => ({ windowCheckpoints, maxAgeSeconds });

test("fresh: inside window, subject unchanged", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v1"), policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.FRESH);
  assert.equal(d.signal, SIGNAL.CONSISTENT);
  assert.equal(d.signals.window.delta, 10);
  assert.equal(d.signals.pin.changed, false);
});

test("stale by window: subject unchanged -> FALSE-STALE (widening signal)", () => {
  const d = evaluateGate({ record: rec(), live: live(1100), pin: pin("v1"), policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.STALE);
  assert.equal(d.signal, SIGNAL.FALSE_STALE);
  assert.match(d.reason, /checkpoint window exceeded/);
});

test("stale by pin: subject version changed inside window -> MISSED-CHANGE (tightening signal)", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v2"), policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.STALE);
  assert.equal(d.signal, SIGNAL.MISSED_CHANGE);
});

test("stale by pin: digest changed but version same is still a change", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v1", "d2"), policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.STALE);
  assert.equal(d.signal, SIGNAL.MISSED_CHANGE);
});

test("pin precedence: changed subject is stale even inside the window", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v2"), policy: policy(1000), now: NOW });
  assert.equal(d.verdict, VERDICT.STALE);
  assert.equal(d.signal, SIGNAL.MISSED_CHANGE);
});

test("wall-clock backstop: expired memory is stale with a CONSISTENT signal", () => {
  const old = rec({ "proof.read_at": "2026-11-01T00:00:00.000Z" });
  const d = evaluateGate({ record: old, live: live(1010), pin: pin("v1"), policy: policy(100000, 60), now: NOW });
  assert.equal(d.verdict, VERDICT.STALE);
  assert.equal(d.signal, SIGNAL.CONSISTENT);
  assert.match(d.reason, /wall-clock backstop/);
});

test("fail closed when the checkpoint read failed", () => {
  const d = evaluateGate({ record: rec(), live: null, pin: pin("v1"), policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED);
  assert.equal(d.signal, SIGNAL.UNVERIFIED);
  assert.match(d.reason, /fail closed/);
});

test("fail closed when the subject pin read failed", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: null, policy: policy(), now: NOW });
  assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED);
  assert.equal(d.signal, SIGNAL.UNVERIFIED);
  assert.match(d.reason, /subject pin read failed/);
});

test("the decision carries the proof at write time and the live checkpoint", () => {
  const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v1"), policy: policy(), now: NOW });
  assert.equal(d.proof_at_write.checkpoint_seq, 1000);
  assert.equal(d.live_checkpoint.seq, 1010);
  assert.equal(d.class, "FAST");
});

test("learningSignal maps the window/pin pair to the two learning signals", () => {
  assert.equal(learningSignal({ windowOk: false, pinChanged: false }), SIGNAL.FALSE_STALE);
  assert.equal(learningSignal({ windowOk: true, pinChanged: true }), SIGNAL.MISSED_CHANGE);
  assert.equal(learningSignal({ windowOk: true, pinChanged: false }), SIGNAL.CONSISTENT);
  assert.equal(learningSignal({ windowOk: false, pinChanged: true }), SIGNAL.CONSISTENT);
  assert.equal(learningSignal({ windowOk: null, pinChanged: false }), SIGNAL.UNVERIFIED);
});
