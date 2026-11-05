#!/usr/bin/env node
// The observer: polls the two claim-class subjects sparsely, writes observation
// and correction memories to Walrus Memory in the `freshness-recall` namespace,
// records every stale/fresh decision with checkpoint stamps, and drives the
// learned policy from real mainnet signals.
//
//   node scripts/observer.mjs --live --interval=8 --budget=14
//
//   --interval   seconds between samples (default 8; must stay below the FAST
//                window so a changed subject can produce MISSED-CHANGE)
//   --budget     maximum memories this process may write
//   --policy-cap maximum learned-policy memories (default 3)
//   --rounds     stop after N rounds (default 0 = run until stopped)
//   --dry-run    do not write to Walrus Memory at all
//
// Sampling is decoupled from writing: a relayer write takes ~18 s, so writes
// go through a background queue and never slow the sample loop down.
//
// Run it under tmux or nohup so it survives the shell:
//   tmux new -s recall 'cd ~/total-recall && node scripts/observer.mjs --live 2>&1 | tee -a data/observer.log'
//   # or: nohup node scripts/observer.mjs --live >> data/observer.log 2>&1 &

import { createRuntime, CACHE_DIR } from "../src/runtime.mjs";
import { SUBJECTS } from "../src/subjects.mjs";
import { evaluateGate, VERDICT, SIGNAL } from "../src/gate.mjs";
import { policyRecordText } from "../src/policy.mjs";
import { recordToText } from "../src/schema.mjs";
import { credentialSelfTest } from "../src/mainnet.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const getArg = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};

const live = has("live");
const dryRun = has("dry-run");
const interval = Math.max(5, Number(getArg("interval", "8")));
const budget = Math.max(0, Number(getArg("budget", "14")));
const policyCap = Math.max(0, Number(getArg("policy-cap", "3")));
const rounds = Math.max(0, Number(getArg("rounds", "0")));

if (!live) {
  console.error("[observer] refusing to run without --live: this observer exists to record real events");
  process.exit(2);
}

const rt = createRuntime({ live, logger: (m) => console.log(`${new Date().toISOString()} ${m}`) });
rt.tatum.cachePath = resolve(CACHE_DIR, "tatum-cache.json");

const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
for (const c of self.checks) console.log(`[observer] self-test ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
if (!self.ok) {
  console.error("[observer] credential self-test FAILED - refusing to write");
  process.exit(1);
}
await rt.policy.load();
console.log(`[observer] policy loaded from ${rt.policy.source}: ${JSON.stringify(rt.policy.snapshot())}`);
console.log(`[observer] interval=${interval}s budget=${budget} policy-cap=${policyCap} rounds=${rounds || "unlimited"}`);

const anchors = new Map(); // class -> { record, blob_id }
const history = new Map(); // class -> [{ at, checkpointSeq, version, digest }]
const rate = new Map();    // class -> { rounds, changes }

let budgetUsed = 0;
let queued = 0;
let policyWritten = 0;
let policyQueued = 0;
let adversarialWritten = false;
let writing = false;
const queue = [];

function log(msg) { console.log(`${new Date().toISOString()} ${msg}`); }
function rateFor(cls) {
  if (!rate.has(cls)) rate.set(cls, { rounds: 0, changes: 0 });
  return rate.get(cls);
}

// ---------------------------------------------------------------- write queue
function enqueue(text, what, onWritten = null, onFailed = null) {
  if (dryRun) { log(`[observer] DRY-RUN would write ${what}`); return null; }
  if (budgetUsed + queued >= budget) {
    log(`[observer] budget exhausted (${budgetUsed}+${queued}/${budget}) - ${what} recorded in the ledger only`);
    return null;
  }
  const item = { text, what, onWritten, onFailed, blob_id: null };
  queue.push(item);
  queued += 1;
  drain();
  return item;
}

async function drain() {
  if (writing) return;
  writing = true;
  while (queue.length) {
    const item = queue.shift();
    try {
      const { jobId } = await rt.store.remember(item.text);
      const done = await rt.store.waitFor(jobId);
      item.blob_id = done?.[0]?.blob_id ?? null;
      budgetUsed += 1;
      queued -= 1;
      log(`[observer] wrote ${item.what} -> ${item.blob_id} (${budgetUsed}/${budget})`);
      if (item.onWritten) item.onWritten(item.blob_id);
    } catch (e) {
      queued -= 1;
      log(`[observer] write FAILED for ${item.what}: ${e.message}`);
      if (item.onFailed) item.onFailed(e);
    }
  }
  writing = false;
}

/** Observation/correction pairs must leave room for the reserved policy memories. */
function pairAllowed() {
  const reserve = Math.max(0, policyCap - policyWritten - policyQueued);
  return budgetUsed + queued + 2 + reserve <= budget;
}

// ---------------------------------------------------------------- anchors
async function loadAnchors() {
  for (const s of SUBJECTS) {
    const res = await rt.store.recall({ query: `observation ${s.label} object version checkpoint`, limit: 25, sort: "recent" });
    let best = null;
    for (const hit of res.results || []) {
      const rec = rt.store.parse(hit.text)?.record;
      if (!rec) continue;
      if (rec.subject !== s.address) continue;
      if (rec.state === "adversarial") adversarialWritten = true;
      if (rec.state !== "observation") continue;
      const at = Date.parse(rec["proof.read_at"]) || 0;
      if (!best || at > best.at) best = { at, record: rec, blob_id: hit.blob_id };
    }
    if (best) {
      anchors.set(s.class, { record: best.record, blob_id: best.blob_id });
      log(`[observer] anchor ${s.class}: ${best.record.claim} (${best.blob_id}) v${best.record["proof.object_version"]} cp ${best.record["proof.checkpoint_seq"]}`);
    } else {
      log(`[observer] anchor ${s.class}: none yet`);
    }
  }
  log(`[observer] adversarial record already present: ${adversarialWritten}`);
}

// ---------------------------------------------------------------- records
function anchorRecordFor(subject, anchor) {
  const r = anchor.record;
  return {
    class: subject.class,
    claim: r.claim,
    subject: subject.address,
    predicate: r.predicate,
    state: r.state,
    "proof.checkpoint_seq": r["proof.checkpoint_seq"],
    "proof.object_version": r["proof.object_version"],
    "proof.object_digest": r["proof.object_digest"],
    "proof.read_at": r["proof.read_at"],
  };
}

function observationText({ subject, live, pin, previous, decision, delta, secondsSince }) {
  const versionChanged = previous ? String(previous.version) !== String(pin.version) : true;
  const r = rateFor(subject.class);
  return recordToText({
    claim: `obs-${subject.id}-${live.checkpointSeq}`,
    class: subject.class,
    epoch: 1,
    state: "observation",
    subject: subject.address,
    predicate: "object_version",
    value_at_write: `version=${pin.version} digest=${pin.digest}`,
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": live.checkpointSeq,
    "proof.checkpoint_digest": live.checkpointDigest,
    "proof.object_version": pin.version,
    "proof.object_digest": pin.digest,
    "proof.read_at": pin.readAt,
    "observation.previous_version": previous?.version ?? "",
    "observation.delta_checkpoints": delta,
    "observation.seconds_since": secondsSince,
    "observation.changed": versionChanged,
    "observation.verdict": decision.verdict,
    "observation.signal": decision.signal,
    agent_id: rt.env.MEMWAL_AGENT_ID || "",
    recorded_at: new Date().toISOString(),
    body: `Observation of ${subject.label} at checkpoint ${live.checkpointSeq}: ` +
      `version=${pin.version} digest=${pin.digest}` +
      (previous ? `, previous version=${previous.version} (${versionChanged ? "changed" : "unchanged"})` : ", first observation") +
      `, ${delta} checkpoints and ${secondsSince}s since the previous observation. ` +
      `Gate verdict against the previous observation: ${decision.verdict} (${decision.reason}). ` +
      `Observed change rate so far: ${r.changes}/${r.rounds} rounds changed.`,
  });
}

function correctionText({ subject, live, pin, decision, supersedesClaim, supersedesBlob }) {
  return recordToText({
    claim: `cor-${subject.id}-${live.checkpointSeq}`,
    class: subject.class,
    epoch: 1,
    state: "live",
    subject: subject.address,
    predicate: "object_version",
    value_at_write: `version=${pin.version} digest=${pin.digest}`,
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": live.checkpointSeq,
    "proof.checkpoint_digest": live.checkpointDigest,
    "proof.object_version": pin.version,
    "proof.object_digest": pin.digest,
    "proof.read_at": pin.readAt,
    supersedes: supersedesBlob || supersedesClaim || "",
    "correction.reason": decision.reason,
    agent_id: rt.env.MEMWAL_AGENT_ID || "",
    recorded_at: new Date().toISOString(),
    body: `Correction for ${subject.label}: at checkpoint ${live.checkpointSeq} the subject is ` +
      `version=${pin.version} digest=${pin.digest}. This supersedes ${supersedesClaim || "the previous claim"} ` +
      `(${supersedesBlob || "unknown blob"}), which was ${decision.verdict} - ${decision.reason}.`,
  });
}

function adversarialText({ subject, live, pin, decision, ageCheckpoints, fastWindow }) {
  return recordToText({
    claim: `adv-not-stale-${live.checkpointSeq}`,
    class: subject.class,
    epoch: 1,
    state: "adversarial",
    subject: subject.address,
    predicate: "object_version",
    value_at_write: `version=${pin.version} digest=${pin.digest}`,
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": live.checkpointSeq,
    "proof.checkpoint_digest": live.checkpointDigest,
    "proof.object_version": pin.version,
    "proof.object_digest": pin.digest,
    "proof.read_at": pin.readAt,
    "adversarial.age_checkpoints": ageCheckpoints,
    "adversarial.fast_window": fastWindow,
    "adversarial.verdict": decision.verdict,
    agent_id: rt.env.MEMWAL_AGENT_ID || "",
    recorded_at: new Date().toISOString(),
    body: `Adversarial not-stale record. At checkpoint ${live.checkpointSeq} this memory is ${ageCheckpoints} checkpoints old - ` +
      `more than the FAST window of ${fastWindow} - but its subject (${subject.label}) still has ` +
      `version=${pin.version} digest=${pin.digest}, unchanged since the memory was written. ` +
      `The gate answered ${decision.verdict}, so it withholds stale memories, not old-but-true ones.`,
  });
}

// ---------------------------------------------------------------- one round
async function round(n) {
  const now = Date.now();
  const live = await rt.tatum.readCheckpoint();
  const entry = { round: n, at: new Date().toISOString(), checkpoint: live.checkpointSeq, subjects: {} };

  for (const subject of SUBJECTS) {
    const pin = await rt.tatum.readObject(subject.address);
    const anchor = anchors.get(subject.class);
    const hist = history.get(subject.class) || [];
    const previous = hist.at(-1) || null;
    const secondsSince = previous ? Math.max(0, Math.round((now - previous.at) / 1000)) : 0;
    const deltaSinceLast = previous ? live.checkpointSeq - previous.checkpointSeq : 0;

    const decision = anchor
      ? evaluateGate({
        record: anchorRecordFor(subject, anchor), live, pin,
        policy: {
          windowCheckpoints: rt.policy.state(subject.class).windowCheckpoints,
          maxAgeSeconds: rt.policy.state(subject.class).maxAgeSeconds,
        },
        now,
      })
      : {
        verdict: VERDICT.WITHHELD_UNVERIFIED, reason: "no anchor observation yet", signal: SIGNAL.UNVERIFIED,
        signals: { window: { delta: null }, pin: { changed: null }, wallclock: { age_seconds: null } },
      };

    const r = rateFor(subject.class);
    r.rounds += 1;
    if (previous && String(previous.version) !== String(pin.version)) r.changes += 1;
    history.set(subject.class, [...hist, { at: now, checkpointSeq: live.checkpointSeq, version: pin.version, digest: pin.digest }].slice(-100));

    // policy learning from the window-gate signal
    let policyResult = null;
    if (anchor) {
      policyResult = rt.policy.apply(subject.class, decision.signal, { now });
      if (policyResult.changed && policyWritten + policyQueued < policyCap) {
        const ptext = policyRecordText(policyResult.state, {
          now, epoch: 1, chainId: SUI_MAINNET_CHAIN_ID, agentId: rt.env.MEMWAL_AGENT_ID || "",
          checkpointSeq: live.checkpointSeq, checkpointDigest: live.checkpointDigest,
        });
        policyQueued += 1;
        const w = enqueue(ptext, `policy ${subject.class} window ${policyResult.previousWindow}->${policyResult.state.windowCheckpoints}`,
          () => { policyWritten += 1; policyQueued -= 1; },
          () => { policyQueued -= 1; });
        entry.subjects[subject.class] = { ...entry.subjects[subject.class], policy_write: w?.blob_id ?? "queued" };
      } else if (policyResult.changed) {
        log(`[observer] policy ${subject.class} changed (${policyResult.previousWindow}->${policyResult.state.windowCheckpoints}) but the policy cap (${policyCap}) is reached - ledger only`);
      }
    }

    if (!anchor) {
      const text = observationText({ subject, live, pin, previous, decision, delta: deltaSinceLast, secondsSince });
      const holder = { record: rt.store.parse(text)?.record ?? null, blob_id: null };
      anchors.set(subject.class, holder);
      enqueue(text, `first observation ${subject.class}`, (blobId) => { holder.blob_id = blobId; });
      entry.subjects[subject.class] = { verdict: decision.verdict, signal: decision.signal, observation: "queued (first)" };
    } else if (decision.signals.pin.changed) {
      if (pairAllowed()) {
        const ageDelta = live.checkpointSeq - anchor.record["proof.checkpoint_seq"];
        const text = observationText({ subject, live, pin, previous: anchor.record, decision, delta: ageDelta, secondsSince });
        const holder = { record: rt.store.parse(text)?.record ?? null, blob_id: null };
        anchors.set(subject.class, holder);
        enqueue(text, `observation ${subject.class} (changed)`, (blobId) => { holder.blob_id = blobId; });
        const corText = correctionText({ subject, live, pin, decision, supersedesClaim: anchor.record.claim, supersedesBlob: anchor.blob_id });
        enqueue(corText, `correction ${subject.class} supersedes ${anchor.record.claim}`);
        entry.subjects[subject.class] = { verdict: decision.verdict, signal: decision.signal, observation: "queued", correction: "queued" };
      } else {
        entry.subjects[subject.class] = { verdict: decision.verdict, signal: decision.signal, note: "changed, pair skipped (budget reserve)" };
      }
    } else {
      entry.subjects[subject.class] = { verdict: decision.verdict, signal: decision.signal, note: "unchanged" };
    }

    // adversarial not-stale record: an old-but-true claim the gate answers FRESH
    const fastWindow = rt.policy.state("FAST").windowCheckpoints;
    const anchorDelta = anchor ? live.checkpointSeq - anchor.record["proof.checkpoint_seq"] : 0;
    if (!adversarialWritten && anchor && decision.verdict === VERDICT.FRESH && anchorDelta > fastWindow) {
      const text = adversarialText({ subject, live, pin, decision, ageCheckpoints: anchorDelta, fastWindow });
      const item = enqueue(text, "adversarial not-stale record", () => { adversarialWritten = true; });
      if (item) entry.adversarial = "queued";
    }

    // decision ledger: every stale/fresh decision with checkpoint stamps
    rt.ledger.append({
      type: "observer", round: n, at: new Date().toISOString(),
      query: `observe:${subject.id}`, class: subject.class,
      verdict: decision.verdict, reason: decision.reason, signal: decision.signal,
      live: { checkpoint_seq: live.checkpointSeq, checkpoint_digest: live.checkpointDigest, read_at: live.readAt },
      pin: { version: pin.version, digest: pin.digest, read_at: pin.readAt },
      memory: anchor ? {
        claim: anchor.record.claim, blob_id: anchor.blob_id,
        proof_at_write: {
          checkpoint_seq: anchor.record["proof.checkpoint_seq"],
          object_version: anchor.record["proof.object_version"],
          object_digest: anchor.record["proof.object_digest"],
          read_at: anchor.record["proof.read_at"],
        },
      } : null,
      policy: policyResult ? {
        before_window: policyResult.previousWindow,
        after_window: policyResult.state.windowCheckpoints,
        changed: policyResult.changed,
        reason: policyResult.reason,
      } : null,
      reads: { checkpoint: 1, pin: 1 },
    });
  }

  rt.tatum.saveDiskCache({ observer_round: n });
  log(`[observer] round ${n} cp=${live.checkpointSeq} ` +
    SUBJECTS.map((s) => `${s.class}=${entry.subjects[s.class]?.verdict ?? "?"}/${entry.subjects[s.class]?.signal ?? "?"}`).join(" ") +
    ` written=${budgetUsed} queued=${queued} budget=${budget}`);
  return entry;
}

// ---------------------------------------------------------------- main loop
await loadAnchors();
let n = 0;
while (rounds === 0 || n < rounds) {
  n += 1;
  try {
    await round(n);
  } catch (e) {
    log(`[observer] round ${n} failed: ${e.message}`);
  }
  if (rounds !== 0 && n >= rounds) break;
  // Once the memory budget is spent the observer keeps watching, but sparsely:
  // the decision ledger stays useful without growing by thousands of rows a day.
  const effectiveInterval = budgetUsed + queued >= budget ? Math.max(interval, 60) : interval;
  await new Promise((r) => setTimeout(r, effectiveInterval * 1000));
}

log(`[observer] stopped after ${n} rounds; memories written ${budgetUsed}/${budget}`);
log(`[observer] final policy: ${JSON.stringify(rt.policy.snapshot())}`);
log(`[observer] ledger: ${rt.ledger.path}`);
process.exit(0);
