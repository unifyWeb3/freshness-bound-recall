#!/usr/bin/env node
// Proof page: a local, self-contained page that shows the evidence.
//
//   node scripts/proof-page.mjs --live --port=8787      # live mainnet data
//   node scripts/proof-page.mjs --offline --port=8787   # cached snapshot only
//
// Shows: memories with blob ids + checkpoint stamps, the lineage graph, a live
// checkpoint widget, the decision ledger, the Tatum request log (chain id +
// latency + plan header), the learned policy, and the memory-off vs memory-on
// comparison. No CDN, no build step; the page works with the network off.

import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, CACHE_DIR, LEDGER_PATH, ROOT } from "../src/runtime.mjs";
import { credentialSelfTest } from "../src/mainnet.mjs";
import { SUBJECTS } from "../src/subjects.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";
import { Ledger } from "../src/ledger.mjs";
import { selectRecordedRevisionLifecycle } from "../src/recorded-lifecycle.mjs";
import { comparePolicyWindows, recordedPolicyEffect } from "../src/policy-effect.mjs";

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const getArg = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};

const offline = has("offline");
const port = Number(getArg("port", "8787"));
const refreshSeconds = Math.max(5, Number(getArg("refresh", "15")));
const SNAPSHOT = resolve(CACHE_DIR, "proof-snapshot.json");

/** Snapshot candidates, newest first: live-generated cache, then the committed evidence snapshot. */
export function snapshotCandidates() {
  return [SNAPSHOT, resolve(ROOT, "docs/evidence/proof-snapshot.json")];
}

// ---------------------------------------------------------------- data
async function collectLive(rt) {
  const checkpoint = await rt.tatum.readCheckpoint();
  const subjects = {};
  for (const s of SUBJECTS) {
    try {
      subjects[s.class] = { subject: s, pin: await rt.tatum.readObject(s.address) };
    } catch (e) {
      subjects[s.class] = { subject: s, error: e.message };
    }
  }
  await rt.policy.load();

  const recalled = await rt.store.recall({
    query: "FR-v1 schema claim class epoch state subject predicate checkpoint observation correction policy adversarial",
    limit: 100,
    sort: "recent",
  });

  const memories = [];
  for (const hit of recalled.results || []) {
    const parsed = rt.store.parse(hit.text);
    if (!parsed?.record) continue;
    const r = parsed.record;
    memories.push({
      blob_id: hit.blob_id,
      claim: r.claim,
      class: r.class,
      state: r.state,
      subject: r.subject,
      predicate: r.predicate,
      value_at_write: r.value_at_write ?? null,
      body: r.body,
      supersedes: r.supersedes || null,
      proof: {
        checkpoint_seq: r["proof.checkpoint_seq"] ?? null,
        checkpoint_digest: r["proof.checkpoint_digest"] ?? null,
        object_version: r["proof.object_version"] ?? null,
        object_digest: r["proof.object_digest"] ?? null,
        read_at: r["proof.read_at"] ?? null,
        transport: r["proof.transport"] ?? null,
        chain_id: r["proof.chain_id"] ?? null,
      },
      policy: r.predicate === "policy_window" ? {
        class: r["policy.class"],
        window: r["policy.window_checkpoints"],
        min: r["policy.min_checkpoints"],
        max: r["policy.max_checkpoints"],
        false_stale: r["policy.false_stale"],
        missed_change: r["policy.missed_change"],
        samples: r["policy.samples"],
        version: r["policy.version"],
        reason: r["policy.reason"],
      } : null,
      adversarial: r.state === "adversarial" ? {
        age_checkpoints: r["adversarial.age_checkpoints"],
        fast_window: r["adversarial.fast_window"],
        verdict: r["adversarial.verdict"],
      } : null,
      recorded_at: r.recorded_at ?? null,
      distance: hit.distance,
      created_at: hit.created_at ?? null,
    });
  }

  // lineage: mark superseded blobs so the graph can draw edges both ways
  const byClaim = new Map(memories.map((m) => [m.claim, m]));
  for (const m of memories) {
    if (!m.supersedes) continue;
    const target = memories.find((x) => x.blob_id === m.supersedes || x.claim === m.supersedes);
    if (target) {
      target.superseded_by = target.superseded_by || [];
      target.superseded_by.push(m.blob_id);
      m.supersedes_ref = target.blob_id;
    }
  }

  const ledger = Ledger.read(rt.ledger.path);
  return {
    generated_at: new Date().toISOString(),
    mode: "live",
    chain_id: SUI_MAINNET_CHAIN_ID,
    checkpoint,
    plan: rt.tatum.planHeader(),
    tatum_log: rt.tatum.requestLog().slice(-120),
    tatum_call_count: rt.tatum.callCount,
    tatum_api_key_proof: rt.tatum.apiKeyProof(),
    subjects,
    memories,
    ledger,
    policy: rt.policy.snapshot(),
    relayer: rt.relayer || null,
  };
}

export function collectOffline() {
  const candidate = snapshotCandidates().find((p) => existsSync(p));
  if (!candidate) {
    throw new Error(`no snapshot found in: ${snapshotCandidates().join(", ")} - run the live page once first`);
  }
  const snap = JSON.parse(readFileSync(candidate, "utf8"));
  return { ...snap, mode: "offline", served_at: new Date().toISOString(), snapshot_path: candidate };
}

// ---------------------------------------------------------------- aggregate
export function summarize(snapshot) {
  const led = snapshot.ledger || [];
  const decisions = led.filter((e) => e.verdict);
  const count = (v) => decisions.filter((e) => e.verdict === v).length;
  const fresh = count("FRESH");
  const stale = count("STALE");
  const withheld = count("WITHHELD_UNVERIFIED");
  const total = decisions.length;
  const changed = decisions.filter((e) => e.verdict === "STALE" && (
    e.signal === "MISSED-CHANGE" ||
    String(e.reason || "").startsWith("subject changed") ||
    (e.pin && e.memory?.proof_at_write && (
      String(e.pin.version) !== String(e.memory.proof_at_write.object_version) ||
      String(e.pin.digest) !== String(e.memory.proof_at_write.object_digest)
    ))
  )).length;
  const stillTrueOld = stale - changed;

  const ablation = {
    rows: [
      {
        name: "memory-off (every answer read live)",
        from_memory: 0, from_live: total, withheld: 0,
        reads: total, changed_answers: 0, still_true_old_answers: 0, unverified_answers: 0,
        note: "1 Tatum read per answer, no stored context used",
      },
      {
        name: "memory-on, no gate",
        from_memory: total, from_live: 0, withheld: 0,
        reads: 0, changed_answers: changed, still_true_old_answers: stillTrueOld, unverified_answers: withheld,
        note: "0 reads; changed, old, and unverified memories would all answer",
      },
      {
        name: "memory-on, gate + learned policy",
        from_memory: fresh, from_live: stale + withheld, withheld,
        reads: total * 2, changed_answers: 0, still_true_old_answers: 0, unverified_answers: 0,
        note: "2 reads per answer (checkpoint + pin)",
      },
    ],
    total_decisions: total,
    stale,
    withheld,
  };

  const byClass = {};
  for (const m of snapshot.memories || []) {
    byClass[m.class] = byClass[m.class] || { memories: 0, observations: 0, policies: 0, corrections: 0, adversarial: 0 };
    byClass[m.class].memories += 1;
    if (m.state === "observation") byClass[m.class].observations += 1;
    if (m.predicate === "policy_window") byClass[m.class].policies += 1;
    if (m.claim?.startsWith("cor-")) byClass[m.class].corrections += 1;
    if (m.state === "adversarial") byClass[m.class].adversarial += 1;
  }

  return { fresh, stale, withheld, total, ablation, byClass };
}

// ---------------------------------------------------------------- html
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function short(s, n = 14) { return s ? `${String(s).slice(0, n)}…` : "—"; }
function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().replace("T", " ").replace(".000Z", "Z"); } catch { return iso; }
}

function fmtAge(from, to = Date.now()) {
  const start = Date.parse(from);
  const end = typeof to === "number" ? to : Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function featuredDecision(snapshot) {
  return (snapshot.ledger || []).filter((entry) => (
    entry.verdict === "STALE" &&
    entry.memory?.claim?.includes("sui-clock") &&
    entry.pin?.version &&
    String(entry.reason || "").startsWith("subject changed")
  )).at(-1) || null;
}

function correctionList(memories) {
  const byId = new Map();
  for (const memory of memories) {
    if (memory.blob_id) byId.set(memory.blob_id, memory);
    if (memory.claim) byId.set(memory.claim, memory);
  }
  const pairs = memories
    .filter((memory) => memory.claim?.startsWith("cor-") && memory.supersedes)
    .map((correction) => ({
      correction,
      observation: byId.get(correction.supersedes_ref) || byId.get(correction.supersedes),
    }))
    .filter(({ observation }) => observation?.state === "observation")
    .sort((a, b) => Number(b.correction.proof?.checkpoint_seq || 0) - Number(a.correction.proof?.checkpoint_seq || 0));

  if (!pairs.length) return `<p class="muted">No connected observation and correction records were captured.</p>`;
  return `<ol class="correction-list">${pairs.map(({ observation, correction }) => `
    <li class="correction-row">
      <article class="record old-record">
        <span class="record-kind">Recalled observation</span>
        <strong><code>${esc(observation.claim)}</code></strong>
        <span>Version <code>${esc(observation.proof?.object_version ?? "—")}</code></span>
        <span>Checkpoint <code>${esc(observation.proof?.checkpoint_seq ?? "—")}</code></span>
      </article>
      <span class="correction-arrow" aria-hidden="true">→</span>
      <article class="record corrected-record">
        <span class="record-kind">Recorded correction</span>
        <strong><code>${esc(correction.claim)}</code></strong>
        <span>Version <code>${esc(correction.proof?.object_version ?? "—")}</code></span>
        <span>Checkpoint <code>${esc(correction.proof?.checkpoint_seq ?? "—")}</code></span>
      </article>
    </li>`).join("")}</ol>`;
}

export function page(snapshot) {
  const s = summarize(snapshot);
  const lifecycle = selectRecordedRevisionLifecycle(snapshot);
  const persistenceDelay = Date.parse(lifecycle.correction.created_at) - Date.parse(lifecycle.correction.recorded_at);
  const firstLaterCheckDelay = Date.parse(lifecycle.laterEvent.at) - Date.parse(lifecycle.correction.created_at);
  const policyEffect = recordedPolicyEffect(snapshot);
  const storedSlowPolicy = (snapshot.memories || []).find((memory) => (
    memory.predicate === "policy_window" &&
    memory.class === "SLOW" &&
    Number(memory.policy?.window) === 20000
  ));
  if (!storedSlowPolicy?.blob_id) throw new Error("recorded SLOW policy memory is missing");
  const policyComparison = comparePolicyWindows(policyEffect, { newWindow: Number(storedSlowPolicy.policy.window) });
  const policyDelta = Number(policyEffect.event.live.checkpoint_seq) - Number(policyEffect.record["proof.checkpoint_seq"]);
  const live = snapshot.mode === "live";
  const cp = snapshot.checkpoint || {};
  const cpReadAt = cp.read_at ?? cp.readAt;
  const renderedAt = snapshot.exported_at || snapshot.served_at || Date.now();
  const evidenceAge = fmtAge(snapshot.generated_at, renderedAt);
  const checkpointAge = fmtAge(cpReadAt, renderedAt);
  const decision = featuredDecision(snapshot);
  const rememberedVersion = decision?.memory?.proof_at_write?.object_version ?? "—";
  const rememberedCheckpoint = decision?.memory?.proof_at_write?.checkpoint_seq ?? "—";
  const verifiedVersion = decision?.pin?.version ?? "—";
  const verifiedCheckpoint = decision?.live?.checkpoint_seq ?? "—";
  const decisionQuestion = decision
    ? `Is the Sui Clock still at version ${rememberedVersion}?`
    : "Can this recalled Sui state still be trusted?";
  const badge = snapshot.live_error
    ? `<span class="status status-warning">Refresh failed · showing the last captured evidence from ${esc(fmtTime(snapshot.generated_at))}</span><div class="reason error-reason">${esc(snapshot.live_error)}</div>`
    : snapshot.exported_at
    ? `<span class="status status-snapshot">Cached snapshot · static export · network off</span>`
    : live
      ? `<span class="status status-live">Live evidence · fetched ${esc(fmtTime(snapshot.generated_at))}</span>`
      : `<span class="status status-snapshot">Cached snapshot · network off</span>`;

  const decisionRows = (snapshot.ledger || []).filter((e) => e.verdict).slice(-40).reverse().map((e) => `
    <tr>
      <td>${esc(fmtTime(e.at))}</td>
      <td>${esc(e.type || "answer")}</td>
      <td><code>${esc(short(e.query, 34))}</code></td>
      <td><span class="verdict ${e.verdict === "FRESH" ? "verdict-fresh" : "verdict-withheld"}">${esc(e.verdict)}</span></td>
      <td>${esc(e.signal || "—")}</td>
      <td class="muted">${esc(e.reason || "")}</td>
      <td><code>${esc(e.live?.checkpoint_seq ?? "—")}</code></td>
      <td><code>${esc(e.memory?.proof_at_write?.checkpoint_seq ?? "—")}</code></td>
    </tr>`).join("");

  const memoryRows = (snapshot.memories || []).map((m) => `
    <tr>
      <td><code title="${esc(m.blob_id)}">${esc(short(m.blob_id, 12))}</code></td>
      <td><code>${esc(m.claim)}</code></td>
      <td><span class="class-label">${esc(m.class)}</span></td>
      <td>${esc(m.state)}</td>
      <td><code class="address" title="${esc(m.subject)}">${esc(short(m.subject, 10))}</code></td>
      <td><code>${esc(m.proof.checkpoint_seq ?? "—")}</code></td>
      <td><code>${esc(m.proof.object_version ?? "—")}</code></td>
      <td><code title="${esc(m.proof.object_digest)}">${esc(short(m.proof.object_digest, 12))}</code></td>
      <td class="muted">${esc(fmtTime(m.proof.read_at))}</td>
    </tr>`).join("");

  const tatumRows = (snapshot.tatum_log || []).slice().reverse().slice(0, 30).map((r) => `
    <tr>
      <td>${esc(fmtTime(r.at))}</td>
      <td><code>${esc(r.label)}</code></td>
      <td>${esc(r.status)}</td>
      <td>${esc(r.latency_ms)} ms</td>
      <td><code>${esc(r.plan ?? "—")}</code></td>
      <td>${r.api_key_sent === true ? '<span class="key-state">header sent</span>' : (r.api_key_sent === false ? '<span class="key-state key-missing">not sent</span>' : '<span class="muted">—</span>')}</td>
      <td class="muted">${esc(r.error || "")}</td>
    </tr>`).join("");
  const keyProof = snapshot.tatum_api_key_proof || null;

  const policyCards = Object.entries(snapshot.policy || {}).map(([cls, p]) => `
    <div class="card">
      <div class="card-title">${esc(cls)} window <strong>${esc(p.windowCheckpoints)}</strong> checkpoints</div>
      <div class="muted">bounds ${esc(p.minCheckpoints)} … ${esc(p.maxCheckpoints)} · version ${esc(p.version)} · samples ${esc(p.samples)} (actionable ${esc(p.actionableSamples ?? 0)})</div>
      <div class="muted">FALSE-STALE ${esc(p.falseStale)} · MISSED-CHANGE ${esc(p.missedChange)}</div>
      <div class="reason">${esc(p.lastReason || "initial")}</div>
    </div>`).join("");

  const ablationRows = s.ablation.rows.map((r) => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${r.from_memory}</td>
      <td>${r.from_live}</td>
      <td>${r.withheld}</td>
      <td>${r.reads}</td>
      <td class="${r.changed_answers > 0 ? "bad" : "ok"}"><strong>${r.changed_answers}</strong></td>
      <td>${r.still_true_old_answers}</td>
      <td>${r.unverified_answers}</td>
      <td class="muted">${esc(r.note)}</td>
    </tr>`).join("");

  const subjectCards = Object.values(snapshot.subjects || {}).map(({ subject, pin, error }) => `
    <div class="card">
      <div class="card-heading"><span>${esc(subject.label)}</span><span class="class-label">${esc(subject.class)}</span></div>
      <div class="muted address-line">Subject <code class="address">${esc(subject.address)}</code></div>
      ${error ? `<div class="bad">${esc(error)}</div>` : `
        <div class="kv"><span>Version</span><code>${esc(pin.version)}</code></div>
        <div class="kv"><span>Digest</span><code title="${esc(pin.digest)}">${esc(short(pin.digest, 18))}</code></div>
        <div class="kv"><span>Read at</span><code>${esc(fmtTime(pin.readAt ?? pin.read_at))}</code></div>`}
    </div>`).join("");

  const changed = s.ablation.rows[1]?.changed_answers ?? 0;
  const unchangedOld = s.ablation.rows[1]?.still_true_old_answers ?? 0;
  const unverified = s.ablation.rows[1]?.unverified_answers ?? 0;
  const fullSnapshotUrl = "https://github.com/unifyWeb3/freshness-bound-recall/blob/main/docs/evidence/proof-snapshot.json";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="RecallGuard stops agents from answering with stale on-chain memories. Run the recorded Sui lifecycle in 60 seconds."/>
<meta property="og:title" content="RecallGuard · A stale memory is not an answer"/>
<meta property="og:description" content="Run the recorded Sui revision lifecycle, then inspect the proof that withheld a stale memory."/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://freshness-bound-recall-oxunify.vercel.app/"/>
<title>RecallGuard · Stop stale answers</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d14;
    --card: #11141c;
    --raised: #1a1e28;
    --ink: #eef0f5;
    --secondary: #a3a9b8;
    --muted: #7a8296;
    --hairline: rgba(238,240,245,.09);
    --hairline-strong: rgba(238,240,245,.16);
    --amber: #f4b860;
  }
  * { box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; margin: 0; overflow-x: hidden; }
  body { background: var(--bg); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: var(--ink); text-underline-offset: 4px; text-decoration-color: var(--hairline-strong); transition: color 160ms cubic-bezier(.22,1,.36,1), text-decoration-color 160ms cubic-bezier(.22,1,.36,1); }
  a:hover { color: var(--amber); text-decoration-color: var(--amber); }
  a:focus-visible, button:focus-visible, summary:focus-visible, .scroll:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }
  .skip-link { position: fixed; z-index: 10; top: 12px; left: 12px; padding: 8px 12px; border-radius: 6px; background: var(--amber); color: var(--bg); text-decoration: none; transform: translateY(-200%); }
  .skip-link:hover, .skip-link:focus { color: var(--bg); transform: translateY(0); }
  code { max-width: 100%; color: var(--ink); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { max-width: 1040px; margin-bottom: 20px; font-size: clamp(48px, 5vw, 64px); font-weight: 500; line-height: 1.04; letter-spacing: -.03em; }
  h2 { margin: 0 0 8px; font-size: clamp(24px, 3vw, 32px); font-weight: 500; line-height: 1.2; letter-spacing: -.02em; }
  h3 { margin: 0; font-size: 16px; font-weight: 500; }
  .shell { width: min(100% - 48px, 1440px); margin: 0 auto; min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 64px; border-bottom: 1px solid var(--hairline); }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: 15px; font-weight: 500; }
  .brand-mark { position: relative; display: block; width: 32px; height: 20px; flex: 0 0 32px; }
  .brand-mark::before { content: ""; position: absolute; top: 9px; right: 0; left: 0; height: 1px; background: var(--hairline-strong); }
  .brand-mark::after { content: ""; position: absolute; top: 5px; left: 12px; width: 8px; height: 8px; border: 2px solid var(--bg); background: var(--amber); outline: 1px solid rgba(244,184,96,.5); }
  .nav-links { display: flex; gap: 20px; font-size: 13px; }
  .snapshot-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 16px 0; border-bottom: 1px solid var(--hairline); }
  .status { display: inline-flex; min-height: 32px; align-items: center; padding: 4px 10px; border: 1px solid var(--hairline-strong); border-radius: 6px; font: 500 12px/1.4 ui-monospace, monospace; }
  .status-snapshot, .status-warning { border-color: rgba(244,184,96,.38); background: rgba(244,184,96,.08); color: var(--amber); }
  .status-live { border-color: var(--hairline-strong); background: var(--raised); color: var(--ink); }
  .snapshot-note { color: var(--secondary); font-size: 13px; text-align: right; }
  .error-reason { margin-top: 8px; border-color: var(--hairline-strong); }
  main { min-width: 0; padding-bottom: 80px; }
  .hero { min-height: min(680px, calc(100vh - 128px)); display: grid; align-content: center; gap: 32px; padding: 72px 0; border-bottom: 1px solid var(--hairline); }
  .eyebrow { margin-bottom: 16px; color: var(--amber); font: 500 12px/1.4 ui-monospace, monospace; }
  .hero-intro { color: var(--secondary); max-width: 720px; margin-bottom: 0; font-size: 18px; line-height: 1.6; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
  .action { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border: 1px solid var(--hairline-strong); border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; }
  .action-primary { border-color: var(--amber); background: var(--amber); color: var(--bg); }
  .action-primary:hover { color: var(--bg); }
  .action-secondary { color: var(--secondary); }
  .try-it { padding-bottom: 64px; border-bottom: 1px solid var(--hairline); }
  .try-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 24px; min-width: 0; }
  .command-card, .lifecycle-card { min-width: 0; border: 1px solid var(--hairline-strong); border-radius: 12px; background: var(--card); }
  .command-card { align-self: start; overflow: hidden; }
  .command-head { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--hairline); color: var(--secondary); font-size: 12px; }
  .copy-button { min-height: 32px; padding: 6px 10px; border: 1px solid var(--hairline-strong); border-radius: 6px; background: var(--raised); color: var(--ink); font: inherit; cursor: pointer; }
  .copy-button:hover { border-color: rgba(244,184,96,.5); color: var(--amber); }
  pre { max-width: 100%; margin: 0; padding: 20px; overflow-x: auto; background: var(--bg); }
  pre code { display: block; white-space: pre; overflow-wrap: normal; }
  .command-note { margin: 0; padding: 16px; color: var(--secondary); font-size: 13px; }
  .lifecycle-card { padding: 20px; }
  .sequence { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 20px 0; border: 1px solid var(--hairline); border-radius: 8px; overflow: hidden; }
  .sequence-step { position: relative; min-width: 0; padding: 14px; color: var(--secondary); font: 500 13px/1.4 ui-monospace, monospace; text-align: center; }
  .sequence-step + .sequence-step { border-left: 1px solid var(--hairline); }
  .sequence-step::after { content: "→"; position: absolute; top: 12px; right: 4px; color: var(--muted); }
  .sequence-step:last-child::after { content: none; }
  .sequence-step.fresh { color: var(--ink); }
  .sequence-step.stale { color: var(--amber); }
  .lineage { display: grid; gap: 12px; margin: 0; }
  .lineage-row { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 16px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--hairline); }
  .lineage-row dt { color: var(--muted); font-size: 12px; }
  .lineage-row dd { min-width: 0; margin: 0; }
  .lineage-row strong { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; }
  .lifecycle-timing { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--hairline); color: var(--secondary); font-size: 13px; }
  .safety-line { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .safety-line span { padding: 5px 8px; border: 1px solid var(--hairline); border-radius: 5px; color: var(--secondary); font: 12px/1.4 ui-monospace, monospace; }
  .lifecycle-caveat { margin: 16px 0 0; padding: 12px 14px; border-left: 2px solid var(--amber); background: var(--bg); color: var(--secondary); font-size: 12px; }
  .learning-proof { min-width: 0; padding: 24px; border: 1px solid var(--hairline-strong); border-radius: 16px; background: var(--card); }
  .policy-source { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
  .policy-source-item { min-width: 0; padding: 16px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--bg); }
  .policy-source-item span { display: block; margin-bottom: 8px; color: var(--muted); font-size: 12px; }
  .policy-source-item strong { display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500; }
  .policy-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .policy-case { min-width: 0; padding: 20px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--raised); }
  .policy-case-learned { border-color: var(--hairline-strong); }
  .policy-window { display: block; margin-bottom: 12px; color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }
  .policy-verdict { display: block; margin-bottom: 8px; font-size: 24px; font-weight: 500; }
  .policy-case-learned .policy-verdict { color: var(--ink); }
  .policy-reason { margin: 0; color: var(--secondary); font-size: 13px; }
  .policy-disclosure { margin: 20px 0 0; color: var(--secondary); font-size: 13px; }
  .policy-disclosure code { color: var(--secondary); }
  .recorded-decision { scroll-margin-top: 24px; }
  .evidence-panel { min-width: 0; padding: 24px; border: 1px solid var(--hairline-strong); border-radius: 16px; background: var(--card); }
  .checkpoint-rail { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; min-width: 0; margin-bottom: 24px; }
  .checkpoint-rail::before { content: ""; position: absolute; top: 5px; right: 12.5%; left: 12.5%; height: 1px; background: var(--hairline-strong); }
  .rail-stop { position: relative; min-width: 0; padding-top: 20px; color: var(--muted); font: 11px/1.4 ui-monospace, monospace; text-align: center; overflow-wrap: anywhere; }
  .rail-stop::before { content: ""; position: absolute; top: 0; left: calc(50% - 5px); width: 10px; height: 10px; border: 2px solid var(--card); background: var(--secondary); }
  .rail-stop.gate::before { background: var(--amber); outline: 1px solid rgba(244,184,96,.4); }
  .decision-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; min-width: 0; }
  .flow-step { position: relative; min-width: 0; min-height: 172px; display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--raised); }
  .flow-step.gate-step { border-color: rgba(244,184,96,.46); }
  .flow-step.verified-step { border-color: var(--hairline-strong); }
  .step-label { color: var(--muted); font: 12px/1.4 ui-monospace, monospace; }
  .step-value { margin: 0; font-size: 17px; font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
  .step-meta { margin-top: auto; color: var(--secondary); font: 12px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
  .gate-verdict { color: var(--amber); font-size: 26px; letter-spacing: -.02em; }
  .verified-step .step-value { color: var(--ink); }
  .why { margin: 20px 0 0; padding-top: 20px; border-top: 1px solid var(--hairline); color: var(--secondary); }
  .why strong { color: var(--ink); font-weight: 500; }
  .capture-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; min-width: 0; border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; background: var(--hairline); }
  .capture-item { min-width: 0; padding: 16px; background: var(--card); }
  .capture-label { display: block; margin-bottom: 8px; color: var(--muted); font-size: 12px; }
  .capture-value { display: block; color: var(--ink); font: 500 13px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
  .section { min-width: 0; padding-top: 64px; }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  .section-copy { max-width: 680px; margin: 0; color: var(--secondary); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; min-width: 0; }
  .grid > *, .decision-flow > *, .capture-grid > * { min-width: 0; }
  .card { min-width: 0; padding: 20px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  .card-heading, .card-title { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 12px; font-weight: 500; }
  .class-label { color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }
  .address, .address-line, .address-line code { overflow-wrap: anywhere; word-break: break-word; }
  .kv { display: flex; justify-content: space-between; gap: 16px; min-width: 0; padding-top: 8px; color: var(--secondary); font-size: 13px; }
  .kv > * { min-width: 0; }
  .kv code { color: var(--ink); text-align: right; }
  .muted { color: var(--muted); font-size: 12px; }
  .reason { margin-top: 12px; padding: 8px 12px; border-left: 2px solid var(--hairline-strong); background: var(--bg); color: var(--secondary); font-size: 12px; }
  .split-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; margin-bottom: 24px; border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; }
  .split-stat { min-width: 0; padding: 24px; background: var(--card); }
  .split-stat + .split-stat { border-left: 1px solid var(--hairline); }
  .split-number { display: block; margin-bottom: 8px; font: 500 32px/1 ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .split-label { color: var(--secondary); overflow-wrap: anywhere; }
  .split-stat:first-child .split-number { color: var(--amber); }
  .scroll { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 12px; }
  caption { padding: 12px 16px; border-bottom: 1px solid var(--hairline); color: var(--secondary); text-align: left; }
  th { padding: 10px 12px; border-bottom: 1px solid var(--hairline-strong); color: var(--secondary); font-weight: 500; text-align: left; white-space: nowrap; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  .ok, .verdict-fresh { color: var(--ink); }
  .bad, .verdict-withheld { color: var(--amber); }
  .verdict, .key-state { font: 500 11px/1.5 ui-monospace, monospace; }
  .key-missing { color: var(--amber); }
  .correction-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
  .correction-row { display: grid; grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr); align-items: stretch; min-width: 0; }
  .record { display: grid; gap: 8px; min-width: 0; padding: 16px; border: 1px solid var(--hairline); background: var(--card); }
  .old-record { border-radius: 12px 0 0 12px; }
  .corrected-record { border-color: var(--hairline-strong); border-radius: 0 12px 12px 0; }
  .record-kind { color: var(--muted); font-size: 12px; }
  .record span:not(.record-kind) { color: var(--secondary); font-size: 13px; }
  .correction-arrow { display: grid; place-items: center; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); background: var(--raised); color: var(--secondary); }
  details { min-width: 0; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  details + details { margin-top: 16px; }
  summary { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; cursor: pointer; font-weight: 500; }
  summary::marker { color: var(--amber); }
  .details-content { min-width: 0; padding: 0 16px 16px; }
  .details-meta { color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }
  .request-proof { margin-bottom: 16px; }
  .footer { padding: 32px 0 48px; border-top: 1px solid var(--hairline); color: var(--secondary); font-size: 13px; }
  .footer-inner { display: flex; justify-content: space-between; gap: 24px; }
  .footer-links { display: flex; gap: 16px; }
  @media (max-width: 1080px) {
    .try-grid { grid-template-columns: minmax(0, 1fr); }
    .capture-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .decision-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 720px) {
    .shell { width: min(100% - 32px, 1440px); }
    .topbar { align-items: start; padding: 16px 0; }
    .nav-links { flex-direction: column; align-items: end; gap: 8px; }
    .snapshot-bar { align-items: start; flex-direction: column; }
    .snapshot-note { text-align: left; }
    .hero { min-height: auto; gap: 32px; padding: 48px 0; }
    h1 { font-size: clamp(36px, 11vw, 44px); }
    .hero-intro { font-size: 16px; }
    .hero-actions { align-items: stretch; flex-direction: column; }
    .action { width: 100%; }
    .lineage-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .policy-source, .policy-compare { grid-template-columns: minmax(0, 1fr); }
    .evidence-panel { padding: 16px; border-radius: 12px; }
    .checkpoint-rail { gap: 4px; }
    .rail-stop { font-size: 9px; }
    .decision-flow { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .flow-step { min-height: auto; }
    .capture-grid, .split-stats { grid-template-columns: minmax(0, 1fr); }
    .capture-item + .capture-item, .split-stat + .split-stat { border-top: 1px solid var(--hairline); border-left: 0; }
    .section { padding-top: 48px; }
    .section-heading { align-items: start; flex-direction: column; gap: 8px; }
    .correction-row { grid-template-columns: minmax(0, 1fr); }
    .old-record, .corrected-record { border-radius: 12px; }
    .correction-arrow { min-height: 32px; border: 0; }
    .footer-inner { flex-direction: column; }
  }
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<nav class="shell topbar" aria-label="Primary navigation">
  <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>RecallGuard</span></div>
  <div class="nav-links">
    <a href="https://github.com/unifyWeb3/freshness-bound-recall">GitHub repo</a>
    <a href="https://github.com/unifyWeb3/freshness-bound-recall/blob/main/docs/judge-60s.md">Judge quickstart</a>
  </div>
</nav>
<header class="shell snapshot-bar">
  <div>${badge}</div>
  <div class="snapshot-note">Read-only evidence · chain <code>${esc(snapshot.chain_id || SUI_MAINNET_CHAIN_ID)}</code></div>
</header>
<main class="shell" id="main-content" tabindex="-1">
  <section class="hero" aria-labelledby="hero-title">
    <div>
      <p class="eyebrow">Recorded Mainnet evidence · replayed offline</p>
      <h1 id="hero-title">A stale memory is not an answer</h1>
      <p class="hero-intro">RecallGuard checks a memory's checkpoint proof and current on-chain subject before an agent can answer with it. Changed, expired, or unverifiable claims are withheld.</p>
      <div class="hero-actions">
        <a class="action action-primary" href="#try-it">Try it in 60 seconds</a>
        <a class="action action-secondary" href="#recorded-decision">Inspect the recorded decision</a>
      </div>
    </div>
  </section>

  <section class="section try-it" id="try-it" aria-labelledby="try-it-title">
    <div class="section-heading"><div><p class="eyebrow">One credential-free replay</p><h2 id="try-it-title">Run the real revision lifecycle</h2><p class="section-copy">From this repository, install without lifecycle hooks and replay the recorded Sui Clock correction. No wallet, API key, or network access is needed.</p></div></div>
    <div class="try-grid">
      <div class="command-card">
        <div class="command-head"><span>Terminal · about 60 seconds</span><button class="copy-button" type="button" aria-label="Copy the 60-second lifecycle command" data-copy-command>Copy</button></div>
        <pre><code id="try-command">npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle</code></pre>
        <p class="command-note">The command prints the decision sequence, exact Walrus lineage, persistence timing, and the later stale recall.</p>
      </div>
      <div class="lifecycle-card" aria-label="Recorded revision lifecycle">
        <h3>Recorded outcome</h3>
        <div class="sequence" aria-label="Stale to fresh to stale lifecycle">
          <span class="sequence-step stale">STALE</span>
          <span class="sequence-step fresh">FRESH</span>
          <span class="sequence-step stale">STALE</span>
        </div>
        <dl class="lineage">
          <div class="lineage-row"><dt>Predecessor</dt><dd><strong><code>${esc(lifecycle.predecessor.claim)}</code> · checkpoint ${esc(lifecycle.predecessor.proof.checkpoint_seq)}</strong><code>${esc(lifecycle.predecessor.blob_id)}</code></dd></div>
          <div class="lineage-row"><dt>Correction</dt><dd><strong><code>${esc(lifecycle.correction.claim)}</code> · checkpoint ${esc(lifecycle.correction.proof.checkpoint_seq)}</strong><code>${esc(lifecycle.correction.blob_id)}</code></dd></div>
          <div class="lineage-row"><dt>Supersedes</dt><dd><strong><code>${esc(lifecycle.storedReference)}</code> → resolved predecessor blob</strong><code>${esc(lifecycle.resolvedBlobId)}</code></dd></div>
        </dl>
        <div class="lifecycle-timing"><span>Persisted <strong>${esc(persistenceDelay.toLocaleString("en-US"))} ms</strong> after proof</span><span>First later check <strong>${esc(firstLaterCheckDelay.toLocaleString("en-US"))} ms</strong> after persistence</span></div>
        <div class="safety-line" aria-label="Replay safety"><span>read-only</span><span>network off</span><span>Writes: none</span></div>
        <p class="lifecycle-caveat">Historical precision: the first later event recalled proof-equivalent observation <code>${esc(lifecycle.laterEvent.memory.blob_id)}</code>, not the correction blob. The deterministic replay evaluates the correction itself and withholds it after the subject changes.</p>
      </div>
    </div>
  </section>

  <section class="section recorded-decision" id="recorded-decision" aria-labelledby="recorded-decision-title">
    <div class="section-heading"><div><p class="eyebrow">Checkpoint gate</p><h2 id="recorded-decision-title">The stale answer that did not escape</h2><p class="section-copy">This captured decision shows the exact recalled claim, gate verdict, and verified Sui value used instead.</p></div></div>
    <div class="evidence-panel" aria-label="Recorded stale memory decision">
      <div class="checkpoint-rail" aria-label="Verification checkpoints">
        <span class="rail-stop">question</span>
        <span class="rail-stop">memory cp ${esc(rememberedCheckpoint)}</span>
        <span class="rail-stop gate">freshness gate</span>
        <span class="rail-stop">live cp ${esc(verifiedCheckpoint)}</span>
      </div>
      <div class="decision-flow">
        <article class="flow-step">
          <span class="step-label">Question</span>
          <p class="step-value">${esc(decisionQuestion)}</p>
          <span class="step-meta">Recorded query reconstructed from the recalled claim</span>
        </article>
        <article class="flow-step">
          <span class="step-label">Recalled memory</span>
          <p class="step-value"><code>${esc(decision?.memory?.claim ?? "No recorded claim")}</code></p>
          <span class="step-meta">version ${esc(rememberedVersion)} · checkpoint ${esc(rememberedCheckpoint)}</span>
        </article>
        <article class="flow-step gate-step">
          <span class="step-label">Gate verdict</span>
          <p class="step-value gate-verdict">WITHHELD</p>
          <span class="step-meta">${esc(decision?.reason || "The recalled proof could not be verified as fresh")}</span>
        </article>
        <article class="flow-step verified-step">
          <span class="step-label">Verified live value</span>
          <p class="step-value">version ${esc(verifiedVersion)}</p>
          <span class="step-meta">checkpoint ${esc(verifiedCheckpoint)} · ${esc(fmtTime(decision?.pin?.read_at))}</span>
        </article>
      </div>
      <p class="why"><strong>Why it matters:</strong> the system returned the verified current value instead of letting version ${esc(rememberedVersion)} answer after the Sui Clock had changed.</p>
    </div>
    <div class="capture-grid" aria-label="Snapshot provenance">
      <div class="capture-item"><span class="capture-label">Captured source</span><span class="capture-value">${esc(cp.source ?? snapshot.mode ?? "—")}</span></div>
      <div class="capture-item"><span class="capture-label">Pins at snapshot</span><span class="capture-value">${Object.keys(snapshot.subjects || {}).length}</span></div>
      <div class="capture-item"><span class="capture-label">Requests captured in snapshot</span><span class="capture-value">${(snapshot.tatum_log || []).length}</span></div>
      <div class="capture-item"><span class="capture-label">Evidence captured</span><span class="capture-value">${esc(fmtTime(snapshot.generated_at))}</span></div>
      <div class="capture-item"><span class="capture-label">Static page exported</span><span class="capture-value">${snapshot.exported_at ? esc(fmtTime(snapshot.exported_at)) : "Not exported"}</span></div>
      <div class="capture-item"><span class="capture-label">Snapshot age</span><span class="capture-value">${esc(evidenceAge)}</span></div>
    </div>
  </section>

  <section class="section" id="learning-loop" aria-labelledby="learning-loop-title">
    <div class="section-heading"><div><p class="eyebrow">Recorded learning loop</p><h2 id="learning-loop-title">A policy memory changed the verdict</h2><p class="section-copy">The same recorded inputs—Mainnet observation, checkpoint, subject pin, and evaluation time—are replayed twice. Only the freshness window changes, from the built-in default to the policy read from Walrus Memory.</p></div></div>
    <div class="learning-proof">
      <div class="policy-source">
        <div class="policy-source-item"><span>Walrus policy memory</span><strong><code>${esc(storedSlowPolicy.claim)}</code> · learned step 10,000 → 20,000</strong><code>${esc(storedSlowPolicy.blob_id)}</code></div>
        <div class="policy-source-item"><span>Observation under test</span><strong><code>${esc(policyEffect.memory.claim)}</code> · checkpoint ${esc(policyEffect.record["proof.checkpoint_seq"])}</strong><code>${esc(policyEffect.memory.blob_id)}</code></div>
      </div>
      <div class="policy-compare" aria-label="Same recorded decision before and after the stored policy">
        <article class="policy-case">
          <span class="policy-window">Without stored policy · default 5,000 checkpoints</span>
          <strong class="policy-verdict">${esc(policyComparison.oldPolicy.verdict)} · ${esc(policyComparison.oldPolicy.signal)}</strong>
          <p class="policy-reason">${esc(policyComparison.oldPolicy.reason)}</p>
        </article>
        <article class="policy-case policy-case-learned">
          <span class="policy-window">With Walrus policy memory · 20,000 checkpoints</span>
          <strong class="policy-verdict">${esc(policyComparison.newPolicy.verdict)} · ${esc(policyComparison.newPolicy.signal)}</strong>
          <p class="policy-reason">${esc(policyComparison.newPolicy.reason)}</p>
        </article>
      </div>
      <p class="policy-disclosure">Identical inputs: anchor checkpoint <code>${esc(policyEffect.record["proof.checkpoint_seq"])}</code>, decision checkpoint <code>${esc(policyEffect.event.live.checkpoint_seq)}</code>, delta <code>${esc(policyDelta.toLocaleString("en-US"))}</code>, and an unchanged subject pin. The policy was learned at <code>${esc(fmtTime(policyEffect.event.at))}</code> and written to Walrus later at <code>${esc(fmtTime(storedSlowPolicy.recorded_at))}</code>; it is not backdated.</p>
      <div class="safety-line" aria-label="Learning replay safety"><span>recorded Mainnet replay</span><span>offline</span><span>read-only</span><span>network off</span><span>Writes: none</span></div>
    </div>
  </section>

  <section class="section" aria-labelledby="pins-title">
    <div class="section-heading"><div><h2 id="pins-title">Pins captured in the snapshot</h2><p class="section-copy">The subject versions and digests recorded alongside the evidence. Checkpoint age at render: <code>${esc(checkpointAge)}</code>.</p></div></div>
    <div class="grid">${subjectCards || '<p class="muted">No subject data captured.</p>'}</div>
  </section>

  <section class="section" aria-labelledby="policy-title">
    <div class="section-heading"><div><h2 id="policy-title">Learned freshness policy</h2><p class="section-copy">Windows recovered from Walrus Memory for fast- and slow-changing claims.</p></div></div>
    <div class="grid">${policyCards || '<p class="muted">No policy memories captured.</p>'}</div>
  </section>

  <section class="section" aria-labelledby="comparison-title">
    <div class="section-heading"><div><h2 id="comparison-title">What the gate prevented</h2><p class="section-copy">The recorded decisions separated changed memories from old claims that remained true and records that could not be verified.</p></div></div>
    <div class="split-stats" aria-label="Recorded unsafe memory outcomes">
      <div class="split-stat"><span class="split-number">${changed}</span><span class="split-label">changed</span></div>
      <div class="split-stat"><span class="split-number">${unchangedOld}</span><span class="split-label">unchanged-but-old</span></div>
      <div class="split-stat"><span class="split-number">${unverified}</span><span class="split-label">unverified</span></div>
    </div>
    <div class="scroll" tabindex="0" role="region" aria-label="Memory-off and memory-on comparison table"><table>
    <caption>Memory-off versus memory-on over all ${s.total} recorded decisions</caption>
    <thead><tr><th scope="col">configuration</th><th scope="col">from memory</th><th scope="col">from live</th><th scope="col">withheld</th><th scope="col">Tatum reads</th><th scope="col">changed answers</th><th scope="col">still-true old</th><th scope="col">unverified</th><th scope="col">note</th></tr></thead>
    <tbody>${ablationRows}</tbody>
  </table></div>
    <p class="muted">“Unchanged-but-old” is the still-true old category: the value matched, but the memory exceeded its freshness bound. The gate uses one checkpoint read and one subject-pin read per decision.</p>
  </section>

  <section class="section" aria-labelledby="corrections-title">
    <div class="section-heading"><div><h2 id="corrections-title">Observation → correction chain</h2><p class="section-copy">Only corrections connected to a captured observation are shown; unconnected smoke-test seeds are excluded.</p></div></div>
    ${correctionList(snapshot.memories || [])}
  </section>

  <section class="section" aria-labelledby="records-title">
    <div class="section-heading"><div><h2 id="records-title">Evidence records</h2><p class="section-copy">Dense inventories stay available for inspection without competing with the recorded decision above.</p></div></div>
    <details>
      <summary><span>Memory inventory</span><span class="details-meta">${(snapshot.memories || []).length} captured records</span></summary>
      <div class="details-content"><div class="scroll" tabindex="0" role="region" aria-label="Memory inventory table"><table>
        <caption>Walrus Memory blob identifiers and checkpoint stamps</caption>
        <thead><tr><th scope="col">Blob</th><th scope="col">Claim</th><th scope="col">Class</th><th scope="col">State</th><th scope="col">Subject</th><th scope="col">Proof cp</th><th scope="col">Object version</th><th scope="col">Object digest</th><th scope="col">Read at</th></tr></thead>
        <tbody>${memoryRows || '<tr><td colspan="9" class="muted">No memories captured.</td></tr>'}</tbody>
      </table></div></div>
    </details>
    <details>
      <summary><span>Latest 40 of ${s.total} decisions</span><span class="details-meta">Open ledger</span></summary>
      <div class="details-content">
        <p class="muted">The complete ledger is preserved in the <a href="${fullSnapshotUrl}">full proof snapshot</a>.</p>
        <div class="scroll" tabindex="0" role="region" aria-label="Latest decision ledger table"><table>
          <caption>Latest 40 of ${s.total} decisions</caption>
          <thead><tr><th scope="col">At</th><th scope="col">Kind</th><th scope="col">Query</th><th scope="col">Verdict</th><th scope="col">Signal</th><th scope="col">Reason</th><th scope="col">Live cp</th><th scope="col">Proof cp</th></tr></thead>
          <tbody>${decisionRows || '<tr><td colspan="8" class="muted">No decisions recorded.</td></tr>'}</tbody>
        </table></div>
      </div>
    </details>
  </section>

  <section class="section" aria-labelledby="requests-title">
    <div class="section-heading"><div><h2 id="requests-title">Captured Tatum requests</h2><p class="section-copy">Read-only request metadata preserved in this snapshot. API-key values are never printed.</p></div></div>
    <div class="card request-proof">
      ${keyProof ? `<div class="kv"><span>x-api-key on every request</span><code>${esc(keyProof.requests_with_api_key)}/${esc(keyProof.total_log_entries)} log entries · ${keyProof.every_request_had_api_key ? "every request carried the header" : "incomplete — see log"}</code></div>
      <div class="kv"><span>Key value</span><code>never printed; boolean proof only</code></div>` : `<div class="muted">API-key proof was not recorded in this snapshot.</div>`}
    </div>
    <div class="scroll" tabindex="0" role="region" aria-label="Tatum request log table"><table>
      <caption>Latest ${Math.min(30, (snapshot.tatum_log || []).length)} captured request log entries</caption>
      <thead><tr><th scope="col">At</th><th scope="col">Query</th><th scope="col">Status</th><th scope="col">Latency</th><th scope="col">x-ttm-plan</th><th scope="col">x-api-key</th><th scope="col">Error</th></tr></thead>
      <tbody>${tatumRows || '<tr><td colspan="7" class="muted">No requests captured.</td></tr>'}</tbody>
    </table></div>
  </section>

  <section class="section" aria-labelledby="relayer-title">
    <div class="section-heading"><div><h2 id="relayer-title">Relayer record</h2></div></div>
    <div class="card">
      ${snapshot.relayer ? `<div class="kv"><span>Status</span><code>${esc(snapshot.relayer.status)}</code></div>
      <div class="kv"><span>Version</span><code>${esc(snapshot.relayer.version)}</code></div>
      <div class="kv"><span>Mode</span><code>${esc(snapshot.relayer.mode)}</code></div>
      <div class="kv"><span>Write ready</span><code>${esc(snapshot.relayer.write_ready)}</code></div>` : `<div class="muted">Relayer information was not collected in this snapshot.</div>`}
    </div>
  </section>
</main>
<footer class="footer"><div class="shell footer-inner"><span>RecallGuard · Tatum Sui mainnet GraphQL + Walrus Memory · ${live ? "live evidence" : "offline cached evidence"} · no LLM in the answer path</span><span class="footer-links"><a href="https://github.com/unifyWeb3/freshness-bound-recall">Source</a><a href="https://github.com/unifyWeb3/freshness-bound-recall/blob/main/docs/judge-60s.md">Reproduce</a></span></div></footer>
<script>
  const copyButton = document.querySelector("[data-copy-command]");
  copyButton?.addEventListener("click", async () => {
    const command = document.querySelector("#try-command")?.textContent?.trim() || "";
    try {
      await navigator.clipboard.writeText(command);
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Select command to copy";
    }
  });
</script>
</body></html>`;
}

// ---------------------------------------------------------------- serve
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
let latest = null;
let latestError = null;
let rt = null;

async function refresh() {
  try {
    if (offline) {
      latest = collectOffline();
    } else {
      latest = await collectLive(rt);
      const s = summarize(latest);
      latest.relayer = latest.relayer || null;
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(SNAPSHOT, JSON.stringify({ ...latest, summary: s }, null, 1));
    }
    latestError = null;
  } catch (e) {
    latestError = e.message;
    console.error(`[proof] refresh failed: ${e.message}`);
  }
}

if (IS_MAIN) {
  if (offline) {
    await refresh();
    const snapPath = snapshotCandidates().find((p) => existsSync(p));
    console.log(`[proof] offline mode: serving ${snapPath || SNAPSHOT}`);
  } else {
    rt = createRuntime({ live: true, logger: () => {} });
    const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
    for (const c of self.checks) console.log(`[proof] self-test ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
    rt.relayer = self.relayer;
    await refresh();
    setInterval(refresh, refreshSeconds * 1000);
  }

  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: !latestError, error: latestError, mode: offline ? "offline" : "live" }));
      return;
    }
    if (!latest) {
      res.writeHead(503, { "Content-Type": "text/html" });
      res.end(`<h1>no data yet</h1><p>${esc(latestError || "collecting…")}</p>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    const view = latestError ? { ...latest, live_error: latestError } : latest;
    res.end(page(view));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[proof] ${offline ? "OFFLINE (cached)" : "LIVE"} page on http://127.0.0.1:${port}`);
  });
}
