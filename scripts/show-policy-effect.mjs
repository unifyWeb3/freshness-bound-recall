#!/usr/bin/env node
// Show the persisted policy being READ BACK from Walrus Memory and the gate
// verdict it changes. READ-ONLY: this script never writes a memory.
//
//   node scripts/show-policy-effect.mjs
//
// Two labelled parts:
//   A. LIVE  - policy memories recalled from the Walrus Memory namespace
//              (source=store), with blob id, learned_at and written_at.
//   B. REPLAY- a recorded mainnet observer decision (real checkpoint, real pin,
//              real memory) re-evaluated with the old and the new window.
//              Same inputs, same clock - only the policy differs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRuntime, ROOT } from "../src/runtime.mjs";
import { comparePolicyWindows, recordedPolicyEffect } from "../src/policy-effect.mjs";

const rt = createRuntime({ live: true, logger: () => {} });

// ---------------------------------------------------------------- A. read back
console.log("=== A. POLICY READ BACK FROM WALRUS MEMORY (LIVE) ===");
const recalled = await rt.store.recall({ query: "FR-v1 policy window checkpoints claim class", limit: 25, sort: "recent" });
const policyHits = [];
for (const hit of recalled.results || []) {
  const rec = rt.store.parse(hit.text)?.record;
  if (!rec || rec.predicate !== "policy_window") continue;
  policyHits.push({ blob_id: hit.blob_id, record: rec });
}
for (const h of policyHits) {
  const r = h.record;
  console.log(`  ${r.claim}  blob=${h.blob_id}`);
  console.log(`     window=${r["policy.window_checkpoints"]} version=${r["policy.version"]} bounds=[${r["policy.min_checkpoints"]}, ${r["policy.max_checkpoints"]}]`);
  console.log(`     reason=${r["policy.reason"]}`);
  console.log(`     learned_at=${r["policy.learned_at"] ?? "(not recorded)"}  written_at=${r["policy.written_at"] ?? r.recorded_at}`);
  console.log(`     false_stale=${r["policy.false_stale"]} missed_change=${r["policy.missed_change"]} samples=${r["policy.samples"]}`);
}
await rt.policy.load();
const snap = rt.policy.snapshot();
console.log(`  engine load source=${rt.policy.source} loaded_at=${rt.policy.loadedAt}`);
for (const [cls, s] of Object.entries(snap)) {
  console.log(`     ${cls}: window=${s.windowCheckpoints} version=${s.version} updatedAt=${s.updatedAt} reason=${s.lastReason}`);
}
const slowPolicy = snap.SLOW;
if (!slowPolicy) {
  console.error("  !! no SLOW policy loaded - the memory is not readable back");
  process.exit(1);
}

// ---------------------------------------------------------------- B. replay
console.log("");
console.log("=== B. REPLAY: a recorded mainnet observer decision, re-evaluated ===");
const proofSnapshot = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));
const effect = recordedPolicyEffect(proofSnapshot, { newWindow: slowPolicy.windowCheckpoints });
const ev = effect.event;
const comparison = comparePolicyWindows(effect, { newWindow: slowPolicy.windowCheckpoints });
console.log(`  recorded decision: ${ev.at}  round ${ev.round}  checkpoint ${ev.live.checkpoint_seq}`);
console.log(`  memory under test: ${ev.memory.claim} blob=${ev.memory.blob_id} (anchor cp ${effect.record["proof.checkpoint_seq"]}, object version ${effect.record["proof.object_version"]})`);
console.log(`  recorded pin     : version ${effect.pin.version} digest ${effect.pin.digest}`);
for (const [label, d] of [["memory OFF (default window 5000)", comparison.oldPolicy], [`memory ON  (window ${slowPolicy.windowCheckpoints} from blob)`, comparison.newPolicy]]) {
  console.log(`  ${label}: ${d.verdict} (${d.signal}) - ${d.reason}`);
}
console.log("");
console.log("  NOTE: part B replays a recorded mainnet decision with a real stored memory,");
console.log("        full proof envelope, checkpoint and pin from the committed evidence snapshot.");
console.log("        The policy window in the 'memory ON' row was loaded from the blob in part A.");
process.exit(0);
