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

  const ablation = {
    rows: [
      {
        name: "memory-off (every answer read live)",
        from_memory: 0, from_live: total, withheld: 0,
        reads: total, stale_answers: 0,
        note: "1 Tatum read per answer, no stored context used",
      },
      {
        name: "memory-on, no gate",
        from_memory: total, from_live: 0, withheld: 0,
        reads: 0, stale_answers: stale + withheld,
        note: "0 reads, but every stale memory would be answered",
      },
      {
        name: "memory-on, gate + learned policy",
        from_memory: fresh, from_live: stale + withheld, withheld,
        reads: total * 2, stale_answers: 0,
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

function lineageSvg(memories) {
  const nodes = memories
    .filter((m) => m.class && m.claim)
    .slice()
    .sort((a, b) => (a.proof.checkpoint_seq || 0) - (b.proof.checkpoint_seq || 0));
  if (!nodes.length) return `<p class="muted">No memories yet.</p>`;
  const W = 980;
  const rowH = 30;
  const H = Math.max(120, nodes.length * rowH + 40);
  const left = 250, right = 700;
  const color = (m) => m.state === "observation" ? "#3b82f6"
    : m.predicate === "policy_window" ? "#a855f7"
    : m.state === "adversarial" ? "#f59e0b"
    : m.claim?.startsWith("cor-") ? "#10b981" : "#e5e7eb";
  const y = (i) => 24 + i * rowH;
  const positions = new Map();
  nodes.forEach((m, i) => positions.set(m.blob_id || m.claim, { x: m.state === "observation" ? left : right, y: y(i), m }));
  const edges = [];
  for (const m of nodes) {
    const target = m.supersedes_ref || m.supersedes;
    if (!target) continue;
    const from = positions.get(m.blob_id || m.claim);
    const to = positions.get(target) || nodes.find((n) => n.claim === target || n.blob_id === target);
    if (!from || !to) continue;
    const toPos = positions.get(to.blob_id || to.claim);
    if (!toPos) continue;
    edges.push(`<path d="M${from.x + 120} ${from.y} C ${from.x + 200} ${from.y}, ${toPos.x - 60} ${toPos.y}, ${toPos.x} ${toPos.y}" fill="none" stroke="#4b5563" stroke-width="1.2" marker-end="url(#arrow)"/>`);
  }
  const labels = nodes.map((m, i) => {
    const p = positions.get(m.blob_id || m.claim);
    const label = `${short(m.claim, 26)} · ${m.state}`;
    return `<g><rect x="${p.x - 4}" y="${p.y - 13}" width="128" height="26" rx="6" fill="#111827" stroke="${color(m)}" stroke-width="1.2"/>
      <text x="${p.x + 2}" y="${p.y + 4}" fill="${color(m)}" font-size="10" font-family="ui-monospace,monospace">${esc(label)}</text>
      <text x="${p.x + 132}" y="${p.y + 4}" fill="#6b7280" font-size="9" font-family="ui-monospace,monospace">cp ${esc(m.proof.checkpoint_seq ?? "—")}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="memory lineage graph">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563"/></marker></defs>
    <text x="250" y="12" fill="#6b7280" font-size="10" font-family="ui-monospace,monospace">OBSERVATIONS</text>
    <text x="700" y="12" fill="#6b7280" font-size="10" font-family="ui-monospace,monospace">CLAIMS / POLICY / ADVERSARIAL</text>
    ${edges.join("")}${labels}
  </svg>`;
}

export function page(snapshot) {
  const s = summarize(snapshot);
  const live = snapshot.mode === "live";
  const cp = snapshot.checkpoint || {};
  const badge = snapshot.live_error
    ? `<span class="badge cached">REFRESH FAILED (live) · showing last good fetch from ${esc(fmtTime(snapshot.generated_at))}</span><div class="reason" style="margin-top:6px;border-color:#7f1d1d">${esc(snapshot.live_error)}</div>`
    : snapshot.exported_at
    ? `<span class="badge cached">STATIC EXPORT · ${esc(fmtTime(snapshot.exported_at))} · network off · ids &amp; stamps from a labelled snapshot</span>`
    : live
      ? `<span class="badge live">LIVE · fetched ${esc(fmtTime(snapshot.generated_at))}</span>`
      : `<span class="badge cached">CACHED SNAPSHOT · ${esc(fmtTime(snapshot.generated_at))} (network off)</span>`;
  const age = cp.read_at ? Math.max(0, Math.round((Date.now() - Date.parse(cp.read_at)) / 1000)) : null;

  const decisionRows = (snapshot.ledger || []).filter((e) => e.verdict).slice(-40).reverse().map((e) => `
    <tr>
      <td>${esc(fmtTime(e.at))}</td>
      <td>${esc(e.type || "answer")}</td>
      <td><code>${esc(short(e.query, 34))}</code></td>
      <td><span class="pill ${e.verdict === "FRESH" ? "ok" : "bad"}">${esc(e.verdict)}</span></td>
      <td>${esc(e.signal || "—")}</td>
      <td class="muted">${esc(e.reason || "")}</td>
      <td><code>${esc(e.live?.checkpoint_seq ?? "—")}</code></td>
      <td><code>${esc(e.memory?.proof_at_write?.checkpoint_seq ?? "—")}</code></td>
    </tr>`).join("");

  const memoryRows = (snapshot.memories || []).map((m) => `
    <tr>
      <td><code title="${esc(m.blob_id)}">${esc(short(m.blob_id, 12))}</code></td>
      <td><code>${esc(m.claim)}</code></td>
      <td><span class="pill ${m.class === "FAST" ? "fast" : "slow"}">${esc(m.class)}</span></td>
      <td>${esc(m.state)}</td>
      <td><code title="${esc(m.subject)}">${esc(short(m.subject, 10))}</code></td>
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
      <td>${r.api_key_sent === true ? '<span class="badge live">x-api-key</span>' : (r.api_key_sent === false ? '<span class="badge cached">NO KEY</span>' : '<span class="muted">—</span>')}</td>
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
      <td class="${r.stale_answers > 0 ? "bad" : "ok"}"><strong>${r.stale_answers}</strong></td>
      <td class="muted">${esc(r.note)}</td>
    </tr>`).join("");

  const subjectCards = Object.values(snapshot.subjects || {}).map(({ subject, pin, error }) => `
    <div class="card">
      <div class="card-title">${esc(subject.label)} <span class="pill ${subject.class === "FAST" ? "fast" : "slow"}">${esc(subject.class)}</span></div>
      <div class="muted">subject <code>${esc(subject.address)}</code></div>
      ${error ? `<div class="bad">${esc(error)}</div>` : `
        <div class="kv"><span>version</span><code>${esc(pin.version)}</code></div>
        <div class="kv"><span>digest</span><code title="${esc(pin.digest)}">${esc(short(pin.digest, 18))}</code></div>
        <div class="kv"><span>read at</span><code>${esc(fmtTime(pin.readAt))}</code></div>`}
    </div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FRESHNESS-BOUND RECALL · proof</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0f17; color: #e5e7eb; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  header { padding: 22px 28px 14px; border-bottom: 1px solid #1f2937; }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: .2px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .12em; color: #9ca3af; margin: 28px 0 10px; }
  .sub { color: #9ca3af; }
  main { padding: 8px 28px 60px; max-width: 1240px; }
  .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: .04em; }
  .badge.live { background: #052e1c; color: #34d399; border: 1px solid #065f46; }
  .badge.cached { background: #2a1f05; color: #fbbf24; border: 1px solid #92400e; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .card { background: #0f1520; border: 1px solid #1f2937; border-radius: 10px; padding: 14px 16px; }
  .card-title { font-weight: 600; margin-bottom: 6px; }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: #9ca3af; }
  .kv code { color: #e5e7eb; }
  .muted { color: #8b93a1; font-size: 12px; }
  .reason { margin-top: 8px; font-size: 12px; color: #cbd5e1; background: #0b1220; border-left: 2px solid #334155; padding: 6px 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #8b93a1; font-weight: 600; border-bottom: 1px solid #1f2937; padding: 7px 8px; white-space: nowrap; }
  td { border-bottom: 1px solid #131a26; padding: 6px 8px; vertical-align: top; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  .pill { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .03em; }
  .pill.ok { background: #052e1c; color: #34d399; }
  .pill.bad { background: #3f0d12; color: #f87171; }
  .pill.fast { background: #172554; color: #93c5fd; }
  .pill.slow { background: #1e1b4b; color: #c4b5fd; }
  .ok { color: #34d399; } .bad { color: #f87171; }
  .stat { font-size: 26px; font-weight: 700; }
  .stat-row { display: flex; gap: 26px; flex-wrap: wrap; margin: 10px 0 0; }
  .stat-row > div { min-width: 120px; }
  footer { color: #6b7280; font-size: 11px; padding: 0 28px 30px; }
  .scroll { overflow-x: auto; }
  .auto { color: #6b7280; font-size: 11px; margin-left: 10px; }
</style>
<script>${live ? `setTimeout(() => location.reload(), ${refreshSeconds * 1000});` : ""}</script>
</head>
<body>
<header>
  <h1>FRESHNESS-BOUND RECALL <span class="auto">${live ? `auto-refresh ${refreshSeconds}s` : ""}</span></h1>
  <div class="sub">${badge} &nbsp; chain <code>${esc(snapshot.chain_id || SUI_MAINNET_CHAIN_ID)}</code></div>
  <div class="stat-row">
    <div><div class="muted">checkpoint</div><div class="stat"><code>${esc(cp.checkpointSeq ?? "—")}</code></div><div class="muted">${esc(short(cp.checkpointDigest, 18))}</div></div>
    <div><div class="muted">checkpoint age</div><div class="stat">${age === null ? "—" : `${age}s`}</div><div class="muted">${esc(cp.source ?? "")}</div></div>
    <div><div class="muted">memories shown</div><div class="stat">${(snapshot.memories || []).length}</div><div class="muted">${s.byClass?.FAST?.memories ?? 0} FAST · ${s.byClass?.SLOW?.memories ?? 0} SLOW</div></div>
    <div><div class="muted">decisions</div><div class="stat">${s.total}</div><div class="muted">${s.fresh} fresh · ${s.stale} stale · ${s.withheld} unverified</div></div>
    <div><div class="muted">Tatum plan</div><div class="stat" style="font-size:13px"><code>${esc(snapshot.plan ?? "—")}</code></div><div class="muted">${esc(snapshot.tatum_call_count ?? 0)} requests this process</div></div>
  </div>
</header>
<main>

  <h2>subjects (live Sui mainnet pins)</h2>
  <div class="grid">${subjectCards || '<p class="muted">no subject data</p>'}</div>

  <h2>learned policy (from Walrus Memory)</h2>
  <div class="grid">${policyCards || '<p class="muted">no policy memories yet</p>'}</div>

  <h2>memory-off vs memory-on (over the recorded decisions)</h2>
  <div class="scroll"><table>
    <thead><tr><th>configuration</th><th>from memory</th><th>from live</th><th>withheld</th><th>Tatum reads</th><th>stale answers</th><th>note</th></tr></thead>
    <tbody>${ablationRows}</tbody>
  </table></div>
  <p class="muted">Reads are counted per decision: memory-off reads the subject once; the gate reads one checkpoint plus one subject pin. Stale answers are decisions where the gate (or the live read) proved the memory wrong.</p>

  <h2>lineage (supersedes)</h2>
  <div class="card">${lineageSvg(snapshot.memories || [])}</div>

  <h2>memories on Walrus (blob ids + checkpoint stamps)</h2>
  <div class="scroll"><table>
    <thead><tr><th>blob</th><th>claim</th><th>class</th><th>state</th><th>subject</th><th>proof cp</th><th>object version</th><th>object digest</th><th>read at</th></tr></thead>
    <tbody>${memoryRows || '<tr><td colspan="9" class="muted">no memories</td></tr>'}</tbody>
  </table></div>

  <h2>decision ledger (every stale/fresh decision)</h2>
  <div class="scroll"><table>
    <thead><tr><th>at</th><th>kind</th><th>query</th><th>verdict</th><th>signal</th><th>reason</th><th>live cp</th><th>proof cp</th></tr></thead>
    <tbody>${decisionRows || '<tr><td colspan="8" class="muted">no decisions recorded yet</td></tr>'}</tbody>
  </table></div>

  <h2>Tatum request log</h2>
  <div class="card">
    ${keyProof ? `<div class="kv"><span>x-api-key on every request</span><code>${esc(keyProof.requests_with_api_key)}/${esc(keyProof.total_log_entries)} log entries · ${keyProof.every_request_had_api_key ? "EVERY REQUEST CARRIED THE HEADER" : "INCOMPLETE - see log"}</code></div>
    <div class="kv"><span>key value</span><code>never printed (boolean proof only)</code></div>` : `<div class="muted">api-key proof not recorded in this snapshot</div>`}
  </div>
  <div class="scroll"><table>
    <thead><tr><th>at</th><th>query</th><th>status</th><th>latency</th><th>x-ttm-plan</th><th>x-api-key</th><th>error</th></tr></thead>
    <tbody>${tatumRows || '<tr><td colspan="7" class="muted">no requests recorded</td></tr>'}</tbody>
  </table></div>

  <h2>relayer</h2>
  <div class="card">
    ${snapshot.relayer ? `<div class="kv"><span>status</span><code>${esc(snapshot.relayer.status)}</code></div>
    <div class="kv"><span>version</span><code>${esc(snapshot.relayer.version)}</code></div>
    <div class="kv"><span>mode</span><code>${esc(snapshot.relayer.mode)}</code></div>
    <div class="kv"><span>write ready</span><code>${esc(snapshot.relayer.write_ready)}</code></div>` : `<div class="muted">relayer info not collected in this snapshot</div>`}
  </div>
</main>
<footer>FRESHNESS-BOUND RECALL · Tatum Sui mainnet GraphQL (read-only) + Walrus Memory · ${live ? "LIVE" : "OFFLINE CACHED"} · no LLM in the answer path</footer>
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
