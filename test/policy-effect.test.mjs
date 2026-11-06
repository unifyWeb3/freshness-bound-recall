import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordedPolicyEffect, comparePolicyWindows } from "../src/policy-effect.mjs";
import { SIGNAL, VERDICT } from "../src/gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));

test("recorded policy effect reconstructs the complete proof envelope", () => {
  const effect = recordedPolicyEffect(snapshot);
  for (const field of [
    "proof.chain_id", "proof.checkpoint_seq", "proof.checkpoint_digest",
    "proof.object_version", "proof.object_digest", "proof.read_at",
  ]) {
    assert.notEqual(effect.record[field], undefined, field);
    assert.notEqual(effect.record[field], "", field);
  }
  assert.equal(effect.memory.blob_id, effect.event.memory.blob_id);
  assert.ok(Number.isFinite(effect.now));
  assert.ok(effect.pin.readAt);
});

test("persisted SLOW window changes the same recorded decision from false-stale to fresh", () => {
  const effect = recordedPolicyEffect(snapshot);
  const { oldPolicy, newPolicy } = comparePolicyWindows(effect, { newWindow: 20000 });

  assert.equal(oldPolicy.verdict, VERDICT.STALE);
  assert.equal(oldPolicy.signal, SIGNAL.FALSE_STALE);
  assert.match(oldPolicy.reason, /delta 18155 > window 5000/);

  assert.equal(newPolicy.verdict, VERDICT.FRESH);
  assert.equal(newPolicy.signal, SIGNAL.CONSISTENT);
  assert.match(newPolicy.reason, /delta 18155 <= 20000/);
});
