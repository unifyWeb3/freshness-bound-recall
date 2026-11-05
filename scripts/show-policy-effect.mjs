#!/usr/bin/env node
// Show the persisted policy being READ BACK from Walrus Memory and the gate
// verdict it changes. READ-ONLY: this script never writes a memory.
//
//   node scripts/show-policy-effect.mjs
//
// Three labelled parts:
//   A. LIVE  - policy memories recalled from the Walrus Memory namespace
//              (source=store), with blob id, learned_at and written_at.
//   B. REPLAY- a recorded mainnet observer decision (real checkpoint, real pin,
//              real memory) re-evaluated with the old and the new window.
//              Same inputs, same clock - only the policy differs.
//   C. LIVE  - a SLOW-class claim constructed for this demo (anchor checkpoint
//              = a real chain checkpoint behind the live one, pin = the live
//              pin read in the same second) evaluated against the live
//              checkpoint with the old and the new window. This claim is NOT a
//              stored memory; it only shows the gate reacting to the window.

import { readFileSync } from "node:fs";
import { createRuntime, LEDGER_PATH } from "../src/runtime.mjs";
import { evaluateGate } from "../src/gate.mjs";
import { SUBJECTS } from "../src/subjects.mjs";

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
const raw = readFileSync(LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const replayable = raw.filter((e) =>
  e.class === "SLOW" && e.signal === "FALSE-STALE" &&
  e.live.checkpoint_seq - e.memory.proof_at_write.checkpoint_seq > 5000 &&
  e.live.checkpoint_seq - e.memory.proof_at_write.checkpoint_seq <= 20000);
if (!replayable.length) {
  console.error("  !! no recorded SLOW decision in the (5000, 20000] delta band");
  process.exit(1);
}
const ev = replayable.at(-1);
const record = {
  claim: ev.memory.claim,
  class: "SLOW",
  state: "observation",
  "proof.checkpoint_seq": ev.memory.proof_at_write.checkpoint_seq,
  "proof.object_version": ev.memory.proof_at_write.object_version,
  "proof.object_digest": ev.memory.proof_at_write.object_digest,
  "proof.read_at": ev.memory.proof_at_write.read_at,
};
const liveRec = { checkpointSeq: ev.live.checkpoint_seq, checkpointDigest: ev.live.checkpoint_digest, readAt: ev.live.read_at };
const pinRec = { version: ev.pin.version, digest: ev.pin.digest };
const nowRec = Date.parse(ev.at);
console.log(`  recorded decision: ${ev.at}  round ${ev.round}  checkpoint ${ev.live.checkpoint_seq}`);
console.log(`  memory under test: ${ev.memory.claim} blob=${ev.memory.blob_id} (anchor cp ${record["proof.checkpoint_seq"]}, object version ${record["proof.object_version"]})`);
console.log(`  recorded pin     : version ${pinRec.version} digest ${pinRec.digest}`);
for (const [label, window] of [["memory OFF (default window 5000)", 5000], [`memory ON  (window ${slowPolicy.windowCheckpoints} from blob)`, slowPolicy.windowCheckpoints]]) {
  const d = evaluateGate({ record, live: liveRec, pin: pinRec, policy: { windowCheckpoints: window, maxAgeSeconds: 604800 }, now: nowRec });
  console.log(`  ${label}: ${d.verdict} (${d.signal}) - ${d.reason}`);
}

// ---------------------------------------------------------------- C. live
console.log("");
console.log("=== C. LIVE: gate evaluated against the live checkpoint + live pin ===");
const slowSubject = SUBJECTS.find((s) => s.class === "SLOW");
const liveCp = await rt.tatum.readCheckpoint();
const livePin = await rt.tatum.readObject(slowSubject.address);
const BACK = 6000; // a real chain checkpoint ~25 minutes behind the live one
const anchorCp = liveCp.checkpointSeq - BACK;
const liveClaim = {
  claim: "constructed-slow-claim-for-the-demo",
  class: "SLOW",
  state: "live",
  "proof.checkpoint_seq": anchorCp,
  "proof.object_version": livePin.version,
  "proof.object_digest": livePin.digest,
  "proof.read_at": new Date().toISOString(),
};
console.log(`  live checkpoint ${liveCp.checkpointSeq} (${liveCp.source}) · live SLOW pin version ${livePin.version} digest ${livePin.digest}`);
console.log(`  constructed claim anchor checkpoint ${anchorCp} (${BACK} checkpoints behind the live one)`);
for (const [label, window] of [["memory OFF (default window 5000)", 5000], [`memory ON  (window ${slowPolicy.windowCheckpoints} from blob)`, slowPolicy.windowCheckpoints]]) {
  const d = evaluateGate({ record: liveClaim, live: liveCp, pin: livePin, policy: { windowCheckpoints: window, maxAgeSeconds: 604800 }, now: Date.now() });
  console.log(`  ${label}: ${d.verdict} (${d.signal}) - ${d.reason}`);
}
console.log("");
console.log("  NOTE: part B replays a recorded mainnet decision with a real stored memory;");
console.log("        part C uses a claim constructed for this demo (live checkpoint + live pin).");
console.log("        The policy window in the 'memory ON' rows was loaded from the blob in part A.");
process.exit(0);
