import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, learningSignal, VERDICT, SIGNAL } from "../src/gate.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const NOW = Date.parse("2026-11-05T01:00:00.000Z");

function rec(over = {}) {
  return {
    class: "FAST",
    claim: "fc-fast-clock-0001",
    subject: "0x6",
    predicate: "object_version",
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": 1000,
    "proof.checkpoint_digest": "cp1000",
    "proof.object_version": "v1",
    "proof.object_digest": "d1",
    "proof.read_at": "2026-11-05T00:59:00.000Z",
    ...over,
  };
}
const live = (seq) => ({ checkpointSeq: seq, checkpointDigest: `cp${seq}`, readAt: "2026-11-05T01:00:00.000Z" });
const pin = (version, digest = "d1") => ({ version, digest, readAt: "2026-11-05T01:00:00.000Z" });
const policy = (windowCheckpoints = 50, maxAgeSeconds = 86400, over = {}) => ({
  windowCheckpoints,
  minCheckpoints: 10,
  maxCheckpoints: 200000,
  maxAgeSeconds,
  ...over,
});

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

test("fail closed on non-finite or negative checkpoint deltas", () => {
  for (const current of [Number.NaN, Number.POSITIVE_INFINITY, 999]) {
    const d = evaluateGate({ record: rec(), live: live(current), pin: pin("v1"), policy: policy(), now: NOW });
    assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED, `checkpoint ${current}`);
    assert.equal(d.signal, SIGNAL.UNVERIFIED);
  }
});

test("fail closed on invalid or future timestamps", () => {
  const cases = [
    { record: rec({ "proof.read_at": "not-a-time" }), live: live(1010), pin: pin("v1") },
    { record: rec({ "proof.read_at": "2026-11-05T01:00:01.000Z" }), live: live(1010), pin: pin("v1") },
    { record: rec(), live: { ...live(1010), readAt: "not-a-time" }, pin: pin("v1") },
    { record: rec(), live: live(1010), pin: { ...pin("v1"), readAt: "not-a-time" } },
  ];
  for (const c of cases) {
    const d = evaluateGate({ ...c, policy: policy(), now: NOW });
    assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED);
    assert.equal(d.signal, SIGNAL.UNVERIFIED);
  }
});

test("fail closed on malformed policy bounds", () => {
  const policies = [
    policy(-1),
    policy(Number.NaN),
    policy(50, -1),
    policy(5),
    policy(50, 86400, { minCheckpoints: 100, maxCheckpoints: 10 }),
  ];
  for (const candidate of policies) {
    const d = evaluateGate({ record: rec(), live: live(1010), pin: pin("v1"), policy: candidate, now: NOW });
    assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED);
    assert.equal(d.signal, SIGNAL.UNVERIFIED);
  }
});

test("fail closed when a proof claims the wrong chain", () => {
  const d = evaluateGate({
    record: rec({ "proof.chain_id": "not-sui-mainnet" }),
    live: live(1010), pin: pin("v1"), policy: policy(), now: NOW,
  });
  assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED);
  assert.match(d.reason, /chain/i);
});

test("fail closed when any required proof field is missing", () => {
  const required = [
    "proof.chain_id", "proof.checkpoint_seq", "proof.checkpoint_digest",
    "proof.object_version", "proof.object_digest", "proof.read_at",
  ];
  for (const field of required) {
    const record = rec();
    delete record[field];
    const d = evaluateGate({ record, live: live(1010), pin: pin("v1"), policy: policy(), now: NOW });
    assert.equal(d.verdict, VERDICT.WITHHELD_UNVERIFIED, field);
    assert.equal(d.signal, SIGNAL.UNVERIFIED);
  }
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
