#!/usr/bin/env node
// Persist ONE already-learned policy result as a real Walrus Memory record.
//
//   node scripts/persist-policy.mjs --claim=fc-policy-SLOW-v2 --window=20000 --confirm=fc-policy-SLOW-v2
//
// This script does NOT learn anything and does NOT tune anything: every number
// it writes is derived from the recorded decision ledger (data/ledger.jsonl),
// which is the only place the learning actually happened. It refuses to run
// unless --confirm names the exact claim it is about to write, and it asserts
// that the ledger really contains a learning event for the requested window.
//
// Honesty rules enforced here:
//   - learned_at  = the timestamp of the learning event IN THE LEDGER
//   - written_at  = the real clock at the moment of the write
//   - the two are never the same value and neither is backdated
//   - the record cites the FALSE-STALE ledger entries that produced the window
//   - if the live observer learned a LATER window, that fact is stated in the
//     record body instead of being hidden
//
// Exactly one memory is written. Nothing else is sent to the network except the
// reads needed for the credential self-test and the write-time proof stamp.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRuntime, LEDGER_PATH, ROOT } from "../src/runtime.mjs";
import { credentialSelfTest } from "../src/mainnet.mjs";
import { recordToText } from "../src/schema.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};

const CLAIM = getArg("claim", "fc-policy-SLOW-v2");
const CLASS_NAME = getArg("class", "SLOW");
const WINDOW = Number(getArg("window", "20000"));
const CONFIRM = getArg("confirm", "");

if (CONFIRM !== CLAIM) {
  console.error(`[persist] REFUSING to write. Pass --confirm=${CLAIM} to authorize exactly this one memory.`);
  process.exit(2);
}

// ---------------------------------------------------------------- ledger facts
const raw = readFileSync(LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const slow = raw.filter((e) => e.class === CLASS_NAME && e.policy);

if (!slow.length) {
  console.error(`[persist] no ${CLASS_NAME} policy entries in ${LEDGER_PATH}`);
  process.exit(1);
}

// A "run" is a maximal stretch of entries without the window resetting to the
// class default (the observer restarts re-seed the policy from defaults).
const DEFAULT_WINDOW = CLASS_NAME === "FAST" ? 50 : 5000;
const runs = [];
let current = null;
for (const e of slow) {
  const resets = e.policy.before_window === DEFAULT_WINDOW &&
    (!current || current.entries.at(-1)?.policy?.after_window !== DEFAULT_WINDOW);
  if (!current || resets) {
    current = { entries: [], changes: [] };
    runs.push(current);
  }
  current.entries.push(e);
  if (e.policy.changed) current.changes.push(e);
}

// The learning event we persist: the LAST policy change in the ledger whose
// resulting window equals the requested window.
const candidates = slow.filter((e) => e.policy.changed && e.policy.after_window === WINDOW);
if (!candidates.length) {
  console.error(`[persist] REFUSING: the ledger contains no learned window ${WINDOW} for class ${CLASS_NAME}.`);
  console.error(`[persist] learned windows present: ${[...new Set(slow.filter((e) => e.policy.changed).map((e) => e.policy.after_window))].join(", ")}`);
  process.exit(1);
}
const event = candidates.at(-1);
const run = runs.find((r) => r.entries.includes(event));
// the policy version is the number of window changes the engine had made in
// this run up to and including the event we persist
const version = run.changes.filter((c) => c.at <= event.at).length;
const EXPECTED_VERSION = Number(getArg("version", "2"));

// counters the engine held at the moment of the change (same run, up to the event)
const upto = run.entries.filter((e) => e.at <= event.at);
const samples = upto.length;
const falseStale = upto.filter((e) => e.signal === "FALSE-STALE").length;
const missedChange = upto.filter((e) => e.signal === "MISSED-CHANGE").length;
const actionable = falseStale + missedChange;

// every FALSE-STALE sample ever recorded for this class (the evidence set)
const falseStaleEntries = raw.filter((e) => e.class === CLASS_NAME && e.signal === "FALSE-STALE");
const evidence = falseStaleEntries.map((e) => {
  const delta = e.live.checkpoint_seq - e.memory.proof_at_write.checkpoint_seq;
  const produces = e.policy?.changed ? e.policy.after_window : null;
  return `${e.at} cp=${e.live.checkpoint_seq} delta=${delta} pin_unchanged=true -> ${produces ? `widen to ${produces}` : "pending"}`;
});

// the latest window the live observer has learned (persisted or not)
const allChanges = slow.filter((e) => e.policy.changed);
const latestChange = allChanges.at(-1);
const laterLearning = latestChange && latestChange.policy.after_window !== WINDOW
  ? { at: latestChange.at, window: latestChange.policy.after_window, reason: latestChange.policy.reason }
  : null;

// ---------------------------------------------------------------- safety asserts
const problems = [];
if (version !== EXPECTED_VERSION) problems.push(`ledger says version ${version}, expected ${EXPECTED_VERSION}`);
if (event.policy.after_window !== WINDOW) problems.push("event window mismatch");
if (falseStale < 3) problems.push(`only ${falseStale} FALSE-STALE samples - the rule requires >= 3`);
if (missedChange !== 0) problems.push(`MISSED-CHANGE count is ${missedChange}, expected 0 for a widen`);
if (problems.length) {
  console.error(`[persist] REFUSING to write: ${problems.join("; ")}`);
  process.exit(1);
}

console.log(`[persist] target        : ${CLAIM} (class ${CLASS_NAME}, window ${WINDOW}, version ${version})`);
console.log(`[persist] learned_at    : ${event.at}   (from the ledger, not backdated)`);
console.log(`[persist] rule          : ${event.policy.reason}`);
console.log(`[persist] counters      : samples=${samples} false_stale=${falseStale} missed_change=${missedChange}`);
console.log(`[persist] evidence      : ${falseStaleEntries.length} FALSE-STALE ledger entries`);
for (const e of evidence) console.log(`[persist]   ${e}`);
if (laterLearning) {
  console.log(`[persist] NOTE          : the observer later learned window ${laterLearning.window} at ${laterLearning.at} (${laterLearning.reason}); that later result is NOT persisted by this script and is disclosed in the record body.`);
}

// ---------------------------------------------------------------- live write
if (args.includes("--dry-run")) {
  console.log("[persist] DRY-RUN: nothing was sent to the network and nothing was written.");
  process.exit(0);
}
const rt = createRuntime({ live: true, logger: () => {} });
// The on-chain part of the self-test rides on Tatum, whose free shared plan
// occasionally drops a connection. Retry the whole self-test a few times
// before refusing: a write must never go out on an unverified account.
let self = null;
for (let attempt = 1; attempt <= 3 && !(self?.ok); attempt++) {
  self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
  for (const c of self.checks) console.log(`[persist] self-test ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  if (!self.ok && attempt < 3) {
    console.log(`[persist] self-test attempt ${attempt}/3 failed - retrying in 5 s (fail closed until it passes)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
if (!self.ok) {
  console.error("[persist] REFUSING to write: the credential self-test failed.");
  process.exit(1);
}

const live = await rt.tatum.readCheckpoint();
const writtenAt = new Date().toISOString();

const minBound = CLASS_NAME === "FAST" ? 10 : 10;
const maxBound = CLASS_NAME === "FAST" ? 200000 : 2000000;
const body = [
  `Learned policy for claim class ${CLASS_NAME}: trust a memory for ${WINDOW} checkpoints.`,
  `FALSE-STALE=${falseStale}, MISSED-CHANGE=${missedChange}, samples=${samples} (same observer run, up to the learning event).`,
  `${event.policy.reason}.`,
  `Rule: FALSE-STALE (window said stale, subject pin unchanged) widens the window x2; MISSED-CHANGE (window said fresh, subject pin changed) tightens it /2.`,
  `A window change requires at least 3 actionable samples since the last change; CONSISTENT and UNVERIFIED never move the window.`,
  `Bounds for class ${CLASS_NAME}: window_checkpoints in [${minBound}, ${maxBound}].`,
  `learned_at=${event.at} (the learning event in the local decision ledger).`,
  `written_at=${writtenAt} (the real time this memory was written to Walrus Memory; the learned result was NOT backdated).`,
  `Evidence - FALSE-STALE ledger entries (checkpoint delta over the previous window, subject pin unchanged):`,
  ...evidence.map((e) => `  ${e}`),
  laterLearning
    ? `Disclosure: after this learning event the same observer run learned window ${laterLearning.window} at ${laterLearning.at} (${laterLearning.reason}). That later result is NOT persisted in Walrus Memory; the persisted policy here is the ${WINDOW}-checkpoint window, which is tighter (more conservative) than the latest local mirror.`
    : `Disclosure: no later window change for class ${CLASS_NAME} exists in the ledger at write time.`,
].join("\n");

const text = recordToText({
  claim: CLAIM,
  class: CLASS_NAME,
  epoch: 1,
  state: "policy",
  subject: `class:${CLASS_NAME}`,
  predicate: "policy_window",
  value_at_write: String(WINDOW),
  "proof.transport": "tatum-sui-mainnet/graphql",
  "proof.chain_id": SUI_MAINNET_CHAIN_ID,
  "proof.checkpoint_seq": live.checkpointSeq,
  "proof.checkpoint_digest": live.checkpointDigest,
  "proof.read_at": writtenAt,
  "policy.class": CLASS_NAME,
  "policy.window_checkpoints": WINDOW,
  "policy.min_checkpoints": minBound,
  "policy.max_checkpoints": maxBound,
  "policy.false_stale": falseStale,
  "policy.missed_change": missedChange,
  "policy.samples": samples,
  "policy.actionable_samples": actionable,
  "policy.version": version,
  "policy.reason": event.policy.reason,
  "policy.learned_at": event.at,
  "policy.written_at": writtenAt,
  "policy.evidence_count": String(falseStaleEntries.length),
  "policy.learned_rule": "FALSE-STALE widens x2; MISSED-CHANGE tightens /2; >=3 actionable samples; bounds [10, 2000000] for SLOW",
  agent_id: rt.env.MEMWAL_AGENT_ID || "",
  recorded_at: writtenAt,
  body,
});

console.log(`[persist] record (${text.length} bytes):`);
console.log(text);
console.log("[persist] writing ONE memory to namespace " + rt.namespace + " ...");

const { jobId } = await rt.store.remember(text);
const done = await rt.store.waitFor(jobId);
const blobId = done?.[0]?.blob_id ?? null;
if (!blobId) {
  console.error("[persist] write did not return a blob id - check the relayer");
  process.exit(1);
}
console.log(`[persist] WROTE ${CLAIM} -> blob ${blobId} (job ${jobId})`);
console.log(`[persist] learned_at=${event.at} written_at=${writtenAt}`);
console.log(`[persist] verify with: node scripts/show-policy-effect.mjs`);
process.exit(0);
