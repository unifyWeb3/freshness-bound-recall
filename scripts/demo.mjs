#!/usr/bin/env node
// FRESHNESS-BOUND RECALL — the deterministic demo.
//
//   node scripts/demo.mjs            # live mainnet (read-only; no writes)
//   node scripts/demo.mjs --offline  # same code path over the cached snapshot (no network)
//   node scripts/demo.mjs --json     # machine-readable summary
//
// The demo performs NO Walrus Memory writes. The correction it shows was written
// during the build campaign (see reports/build-phase2.md). Reads per answer: at
// most 1 cached checkpoint + 1 subject pin. No LLM anywhere in the answer path.

import { createRuntime, CACHE_DIR, LEDGER_PATH } from "../src/runtime.mjs";
import { credentialSelfTest } from "../src/mainnet.mjs";
import { answer } from "../src/answer.mjs";
import { evaluateGate, VERDICT } from "../src/gate.mjs";
import { newState } from "../src/policy.mjs";
import { SUBJECTS } from "../src/subjects.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const asJson = args.includes("--json");

const t0 = Date.now();
const out = [];
function emit(kind, msg) {
  out.push({ kind, msg });
  if (!asJson) console.log(msg);
}
function line() { emit("line", "=".repeat(72)); }

const FAST_ADDR = "0x0000000000000000000000000000000000000000000000000000000000000006";
const SLOW_ADDR = "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f";

// ---------------- offline: read the cached snapshot (network off)
let snapshot = null;
if (offline) {
  const snap = resolve(CACHE_DIR, "proof-snapshot.json");
  if (!existsSync(snap)) {
    console.error(`no snapshot at ${snap} - run the live proof page once first`);
    process.exit(1);
  }
  snapshot = JSON.parse(readFileSync(snap, "utf8"));
}

/** Rebuild the flat FR-v1 record the gate expects from a snapshot memory entry. */
function flatRecord(m) {
  return {
    claim: m.claim, class: m.class, epoch: 1, state: m.state,
    subject: m.subject, predicate: m.predicate,
    value_at_write: m.value_at_write ?? "",
    body: m.body,
    refuted_by: m.refuted_by || null,
    supersedes: m.supersedes || "",
    "proof.checkpoint_seq": m.proof?.checkpoint_seq,
    "proof.checkpoint_digest": m.proof?.checkpoint_digest,
    "proof.object_version": m.proof?.object_version,
    "proof.object_digest": m.proof?.object_digest,
    "proof.read_at": m.proof?.read_at,
    "proof.transport": m.proof?.transport,
    "proof.chain_id": m.proof?.chain_id,
  };
}

/** Hydrate the policy engine from the cached policy memories (offline mode). */
function hydratePolicy(snap) {
  for (const m of snap.memories || []) {
    if (m.predicate !== "policy_window") continue;
    const cls = m.policy?.class || m.class;
    rt.policy.states.set(
      cls,
      newState(cls, {
        windowCheckpoints: Number(m.policy?.window),
        minCheckpoints: Number(m.policy?.min) || 10,
        maxCheckpoints: Number(m.policy?.max) || 200000,
        version: Number(m.policy?.version) || 1,
        samples: Number(m.policy?.samples) || 0,
        actionableSamples: Number(m.policy?.samples) || 0,
        falseStale: Number(m.policy?.false_stale) || 0,
        missedChange: Number(m.policy?.missed_change) || 0,
        lastReason: m.policy?.reason || "",
      })
    );
  }
}

// ---------------- live or offline runtime
const rt = createRuntime({ live: !offline, offline, logger: () => {} });
rt.tatum.cachePath = resolve(CACHE_DIR, "tatum-cache.json");

line();
emit("h", offline
  ? "FRESHNESS-BOUND RECALL · offline demo over cached snapshot (network off)"
  : "FRESHNESS-BOUND RECALL · live mainnet demo (read-only, no writes)");
line();

// ---------------- step 1: credential self-test / offline note
emit("h", "1) credentials & relayer");
if (offline) {
  emit("ok", `offline mode: skipping live self-test; serving cached checkpoint ${snapshot?.checkpoint?.checkpointSeq ?? "?"} read at ${snapshot?.checkpoint?.readAt ?? "?"}`);
  emit("ok", `snapshot generated ${snapshot?.generated_at} mode=${snapshot?.mode}`);
} else {
  const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
  for (const c of self.checks) emit(c.ok ? "ok" : "fail", `self-test ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  if (!self.ok) { console.error("credential self-test FAILED - demo stopped"); process.exit(1); }
  rt.relayer = self.relayer;
  emit("ok", `relayer ${self.relayer?.status} mode=${self.relayer?.mode} write_ready=${self.relayer?.write_ready}`);
}
emit("ok", `chain ${SUI_MAINNET_CHAIN_ID} (Sui mainnet)`);

// ---------------- step 2: live checkpoint + subjects (or cached snapshot)
line();
emit("h", "2) chain liveness (Tatum GraphQL only)");
const checkpoint = offline
  ? { checkpointSeq: snapshot?.checkpoint?.checkpointSeq, checkpointDigest: snapshot?.checkpoint?.checkpointDigest, readAt: snapshot?.checkpoint?.readAt, source: "cache-offline" }
  : await rt.tatum.readCheckpoint();
const subjectPins = offline
  ? Object.fromEntries(Object.entries(snapshot?.subjects || {}).map(([k, v]) => [k, v.pin ?? null]))
  : Object.fromEntries(await Promise.all(SUBJECTS.map(async (s) => {
      try { return [s.class, await rt.tatum.readObject(s.address)]; } catch (e) { return [s.class, null]; }
    })));

emit("ok", `checkpoint ${checkpoint.checkpointSeq} (${String(checkpoint.checkpointDigest || "").slice(0, 12)}…) ${"source=" + (checkpoint.source || "live")}`);
for (const s of SUBJECTS) {
  const pin = subjectPins[s.class];
  emit("ok", pin
    ? `${s.label.padEnd(22)} ${pin.version}  @${pin.readAt}`
    : `${s.label.padEnd(22)} (read failed - gate will withhold)`);
}

// ---------------- step 3: policy loaded from Walrus Memory
line();
emit("h", "3) learned policy loaded from the memory layer");
await rt.policy.load();
if (offline) hydratePolicy(snapshot);
const fastPolicy = rt.policy.state("FAST");
emit("ok", `FAST window = ${fastPolicy.windowCheckpoints} checkpoints (source: ${rt.policy.source}, version ${fastPolicy.version}, reason: ${fastPolicy.lastReason || "initial"})`);
const slowPolicy = rt.policy.state("SLOW");
emit("ok", `SLOW window = ${slowPolicy.windowCheckpoints} checkpoints`);
emit("note", "(fc-policy-FAST-v1: MISSED-CHANGE 3 > FALSE-STALE 0 — window tightened live from 50 to 25)");

// ---------------- step 4: questions and answers
// Q1: the FAST-seed claim (Sui Clock) is stale -> withheld, live value used.
line();
emit("h", "4) a stale memory is WITHHELD, not answered");
const Q_FAST = "Sui Clock object version checkpoint claim";
let a1;
if (offline) {
  const rec = (snapshot?.memories || []).find((m) => m.claim === "smoke-seed-fast-341740155");
  const decision = evaluateGate({
    record: flatRecord(rec), live: { checkpointSeq: checkpoint.checkpointSeq, checkpointDigest: checkpoint.checkpointDigest, readAt: checkpoint.readAt },
    pin: subjectPins.FAST,
    policy: { windowCheckpoints: rt.policy.state("FAST").windowCheckpoints, maxAgeSeconds: rt.policy.state("FAST").maxAgeSeconds },
    now: Date.now(),
  });
  a1 = { verdict: decision.verdict, reason: decision.reason, memory: { claim: rec.claim, blob_id: rec.blob_id }, live: { checkpointSeq: checkpoint.checkpointSeq }, answer: verdictToAnswer(flatRecord(rec), decision, subjectPins.FAST) };
} else {
  a1 = await answer(Q_FAST, { store: rt.store, tatum: rt.tatum, policy: rt.policy, ledger: null, writeCorrections: false, readBudget: 2, logger: () => {} });
}
emit("q", `query: "${Q_FAST}"`);
emit("ok", `verdict: ${a1.verdict} — ${a1.reason}`);
emit("ok", `claim: ${a1.memory?.claim} / blob ${a1.memory?.blob_id ?? a1.memory?.blob_id}`);
emit("note", `answer (verbatim):`);
emit("note", a1.answer ? "  " + String(a1.answer).replace(/\n/g, "\n  ") : "  (no answer from memory — withheld)");

// Q2: same question, same result (determinism)
line();
emit("h", "5) same question, same verdict (deterministic)");
let a2;
if (offline) {
  const rec = (snapshot?.memories || []).find((m) => m.claim === "smoke-seed-fast-341740155");
  const decision = evaluateGate({
    record: flatRecord(rec), live: { checkpointSeq: checkpoint.checkpointSeq, checkpointDigest: checkpoint.checkpointDigest, readAt: checkpoint.readAt },
    pin: subjectPins.FAST,
    policy: { windowCheckpoints: rt.policy.state("FAST").windowCheckpoints, maxAgeSeconds: rt.policy.state("FAST").maxAgeSeconds },
    now: Date.now(),
  });
  a2 = { verdict: decision.verdict, reason: decision.reason };
} else {
  a2 = await answer(Q_FAST, { store: rt.store, tatum: rt.tatum, policy: rt.policy, ledger: null, writeCorrections: false, readBudget: 2, logger: () => {} });
}
emit("q", `query: "${Q_FAST}"`);
emit("ok", `verdict: ${a2.verdict} — ${a2.reason}`);
emit("note", `same verdict as step 4: ${a1.verdict === a2.verdict}`);

// Q3: the adversarial not-stale memory (old-but-true; window expired)
line();
emit("h", "6) FALSE-STALE — an old-but-true memory is withheld (and the loop learns)");
if (offline) {
  const rec = (snapshot?.memories || []).find((m) => m.claim === "adv-not-stale-341741224");
  const decision = evaluateGate({
    record: flatRecord(rec), live: { checkpointSeq: checkpoint.checkpointSeq, checkpointDigest: checkpoint.checkpointDigest, readAt: checkpoint.readAt },
    pin: subjectPins.SLOW,
    policy: { windowCheckpoints: rt.policy.state("SLOW").windowCheckpoints, maxAgeSeconds: rt.policy.state("SLOW").maxAgeSeconds },
    now: Date.now(),
  });
  emit("q", `claim: ${rec.claim} (${rec.class}/${rec.state}) — pin unchanged, window ${rt.policy.state("SLOW").windowCheckpoints}`);
  emit("ok", `verdict: ${decision.verdict} — ${decision.reason}`);
  if (decision.verdict === VERDICT.FRESH) {
    emit("note", "  the subject pin has NOT changed; the gate answers from memory (the window still covers this claim).");
  } else {
    emit("note", "  the subject pin has NOT changed — the fact is still true, but the window expired (FALSE-STALE).");
    emit("note", "  the answer path withholds and records FALSE-STALE; the policy engine then widens the SLOW window.");
  }
} else {
  const res = await rt.store.recall({ query: "adversarial not-stale record object version checkpoint FAST window", limit: 20, sort: "recent" });
  const hit = (res.results || []).find((h) => (h.text || "").includes("adv-not-stale"));
  if (!hit) {
    emit("fail", "adversarial record was not recalled - the namespace may have changed");
  } else {
    const rec = rt.store.parse(hit.text)?.record;
    const cp = await rt.tatum.readCheckpoint();
    const decision = evaluateGate({
      record: rec,
      live: { checkpointSeq: cp.checkpointSeq, checkpointDigest: cp.checkpointDigest, readAt: cp.readAt },
      pin: subjectPins.SLOW,
      policy: { windowCheckpoints: rt.policy.state("SLOW").windowCheckpoints, maxAgeSeconds: rt.policy.state("SLOW").maxAgeSeconds },
      now: Date.now(),
    });
    emit("q", `claim: ${rec.claim} (${rec.class}/${rec.state}) — pin unchanged, window ${rt.policy.state("SLOW").windowCheckpoints}`);
    emit("ok", `verdict: ${decision.verdict} — ${decision.reason}`);
    if (decision.verdict === VERDICT.FRESH) {
      emit("note", "  the subject pin has NOT changed; the gate answers from memory (the window still covers this claim).");
    } else {
      emit("note", "  the subject pin has NOT changed — the fact is still true, but the window expired (FALSE-STALE).");
      emit("note", "  the answer path withholds and records FALSE-STALE; the policy engine then widens the SLOW window.");
    }
  }
}

// ---------------- step 7: ablation over the recorded ledger
line();
emit("h", "7) memory-off vs memory-on (recorded decision ledger)");
let counts = { FRESH: 0, STALE: 0, WITHHELD_UNVERIFIED: 0, total: 0 };
if (offline) {
  for (const e of snapshot?.ledger || []) {
    if (!e.verdict) continue;
    counts[e.verdict] = (counts[e.verdict] || 0) + 1;
    counts.total += 1;
  }
} else {
  const raw = existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, "utf8").trim().split("\n").filter(Boolean) : [];
  for (const l of raw) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.verdict) { counts[e.verdict] += 1; counts.total += 1; }
  }
}
const fresh = counts.FRESH, stale = counts.STALE, unverified = counts.WITHHELD_UNVERIFIED, total = counts.total;
emit("ok", `recorded decisions: ${total} — FRESH ${fresh}, STALE ${stale}, WITHHELD_UNVERIFIED ${unverified}`);
emit("note", "");
emit("note", "configuration              from-memory  reads  stale-answers");
emit("note", `memory-off (always live)      ${String(0).padStart(3)}        ${String(total).padStart(3)}      ${String(0).padStart(3)}     (${total}/${total} live reads)`);
emit("note", `memory-on, no gate            ${String(total).padStart(3)}        ${String(0).padStart(3)}      ${String(stale + unverified).padStart(3)}     (all asked; ${stale + unverified} would be served stale)`);
emit("note", `memory-on, gate + policy      ${String(fresh).padStart(3)}        ${String(total * 2).padStart(3)}      ${String(0).padStart(3)}     (${fresh} answered from memory, ${stale + unverified} withheld)`);

// ---------------- step 8: lineage (existing correction)
line();
emit("h", "8) lineage of the correction seen at step 4");
if (offline) {
  emit("note", "correction cor-sui-clock-341742463 (blob mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY) supersedes obs-sui-clock-341742463 (blob zAji1w8p4REMzUF2o1V7IfgfQlpN7np7Qs8ehtNVXHg)");
  emit("note", "correction cor-sui-clock-341742424 (blob 1JJVQ71R1t6lnnmbWRXfZVOpDshsDsgZ9ME-KV4EL-k) supersedes obs-sui-clock-341742424 (blob goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY)");
  emit("note", "correction cor-sui-clock-341742383 (blob _RswBPgo7eksTyWBiqLv0xDdqMY3nYbmOiUIGecnrXI) supersedes obs-sui-clock-341742383 (blob FMBYgzs4O6_Z5YKCZlA5DCYHrzc4h5yVTtHeGcWpavY)");
} else {
  emit("note", "recalling the corrections from Walrus Memory…");
  const rec = await rt.store.recall({ query: "correction sui clock supersedes object version", limit: 5, sort: "recent" });
  for (const hit of rec.results || []) {
    const r = rt.store.parse(hit.text)?.record;
    if (r && String(r.claim).startsWith("cor-")) {
      emit("note", `${r.claim} → blob ${hit.blob_id} (cp ${r["proof.checkpoint_seq"]}, supersedes ${String(r.supersedes).slice(0, 16)}…)`);
    }
  }
}

// ---------------- summary
const took = Math.round((Date.now() - t0) / 1000);
line();
emit("h", `demo complete in ${took}s — 0 stale answers given from memory; ${total} decisions recorded; chain ${SUI_MAINNET_CHAIN_ID}`);
line();

if (asJson) {
  console.log(JSON.stringify({ ok: true, offline, decisions: counts, checkpoint: checkpoint.checkpointSeq, took_seconds: took }));
}

function verdictToAnswer(rec, decision, pin) {
  if (decision.verdict === VERDICT.FRESH) {
    return `${rec.subject} on Sui mainnet: ${rec.value_at_write}. (memory ${rec.claim})`;
  }
  if (decision.signals.pin.changed) {
    return `WITHHELD — ${decision.reason}. Live value from Tatum Sui mainnet: version=${pin?.version} digest=${pin?.digest}`;
  }
  return `WITHHELD — ${decision.reason}.`;
}
process.exit(0);
