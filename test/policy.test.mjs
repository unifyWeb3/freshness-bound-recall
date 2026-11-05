import { test } from "node:test";
import assert from "node:assert/strict";
import { applySignal, newState, policyRecordText, PolicyEngine, DEFAULT_MIN_SAMPLES } from "../src/policy.mjs";
import { SIGNAL } from "../src/gate.mjs";
import { parseRecord } from "../src/schema.mjs";
import { MockStore } from "../src/store.mjs";

test("a policy does not move before the minimum sample count", () => {
  let s = newState("FAST");
  const r1 = applySignal(s, SIGNAL.FALSE_STALE);
  assert.equal(r1.changed, false);
  assert.equal(r1.state.windowCheckpoints, s.windowCheckpoints);
  const r2 = applySignal(r1.state, SIGNAL.FALSE_STALE);
  assert.equal(r2.changed, false);
  assert.match(r2.reason, /not enough samples/);
  const r3 = applySignal(r2.state, SIGNAL.FALSE_STALE);
  assert.equal(r3.changed, true, `third sample should change the policy (minSamples=${DEFAULT_MIN_SAMPLES})`);
});

test("FALSE-STALE widens the window by x2", () => {
  let s = newState("FAST");
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  const r = applySignal(s, SIGNAL.FALSE_STALE);
  assert.equal(r.changed, true);
  assert.equal(r.previousWindow, 50);
  assert.equal(r.state.windowCheckpoints, 100);
  assert.equal(r.state.version, 1);
});

test("MISSED-CHANGE tightens the window by /2", () => {
  let s = newState("FAST");
  s = applySignal(s, SIGNAL.MISSED_CHANGE).state;
  s = applySignal(s, SIGNAL.MISSED_CHANGE).state;
  const r = applySignal(s, SIGNAL.MISSED_CHANGE);
  assert.equal(r.changed, true);
  assert.equal(r.previousWindow, 50);
  assert.equal(r.state.windowCheckpoints, 25);
});

test("the window is bounded by the class min/max", () => {
  let s = newState("FAST");
  for (let i = 0; i < 60; i++) s = applySignal(s, SIGNAL.FALSE_STALE).state;
  assert.equal(s.windowCheckpoints, s.maxCheckpoints);
  assert.equal(s.windowCheckpoints, 200000);
  assert.ok(s.windowCheckpoints <= s.maxCheckpoints);

  let t = newState("SLOW");
  for (let i = 0; i < 60; i++) t = applySignal(t, SIGNAL.MISSED_CHANGE).state;
  assert.equal(t.windowCheckpoints, t.minCheckpoints);
  assert.equal(t.windowCheckpoints, 10);
  assert.ok(t.windowCheckpoints >= t.minCheckpoints);
});

test("a tie does not change the window", () => {
  let s = newState("FAST");
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  s = applySignal(s, SIGNAL.MISSED_CHANGE).state;
  const before = s.windowCheckpoints;
  const r = applySignal(s, SIGNAL.CONSISTENT);
  assert.equal(r.changed, false);
  assert.equal(r.state.windowCheckpoints, before);
});

test("the policy record serializes to a valid FR-v1 policy memory", () => {
  let s = newState("FAST");
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  const r = applySignal(s, SIGNAL.FALSE_STALE);
  const text = policyRecordText(r.state, { now: Date.parse("2026-11-05T01:00:00.000Z"), chainId: "chain", checkpointSeq: 42 });
  const { record } = parseRecord(text);
  assert.equal(record.state, "policy");
  assert.equal(record.predicate, "policy_window");
  assert.equal(record["policy.class"], "FAST");
  assert.equal(record["policy.window_checkpoints"], 100);
  assert.equal(record["policy.version"], 1);
  assert.equal(record["policy.false_stale"], 3);
  assert.equal(record["policy.samples"], 3);
});

test("PolicyEngine loads the newest policy memory from the store", async () => {
  const store = new MockStore({ namespace: "freshness-recall" });
  let s = newState("FAST");
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  s = applySignal(s, SIGNAL.FALSE_STALE).state;
  const changed = applySignal(s, SIGNAL.FALSE_STALE);
  await store.remember(policyRecordText(changed.state, { now: Date.parse("2026-11-05T01:00:00.000Z") }));
  await store.remember(policyRecordText({ ...changed.state, windowCheckpoints: 999, version: 99 }, {}));

  const engine = new PolicyEngine({ store });
  await engine.load();
  assert.equal(engine.state("FAST").windowCheckpoints, 999);
  assert.equal(engine.state("FAST").version, 99);
});

test("PolicyEngine falls back to defaults when the store has no policy memory", async () => {
  const store = new MockStore({ namespace: "freshness-recall" });
  const engine = new PolicyEngine({ store });
  await engine.load();
  assert.equal(engine.state("FAST").windowCheckpoints, 50);
  assert.equal(engine.state("SLOW").windowCheckpoints, 5000);
});
