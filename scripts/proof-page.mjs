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
import { homePage } from "./site/home.mjs";
import { mcpPage } from "./site/mcp-page.mjs";
import { evidencePage } from "./site/evidence.mjs";
import { docsPage } from "./site/docs-page.mjs";

/** Render the full static site from one snapshot. */
export function pages(snapshot) {
  return {
    "/index.html": homePage(snapshot),
    "/mcp.html": mcpPage(),
    "/evidence.html": evidencePage(snapshot),
    "/docs.html": docsPage(),
  };
}

/** Back-compat: the home page renderer. */
export function page(snapshot) {
  return homePage(snapshot);
}

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
    const all = pages(view);
    const path = (req.url || "/").split("?")[0];
    const target = path === "/" ? "/index.html" : path;
    const html = all[target];
    if (!html) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found: " + target);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[proof] ${offline ? "OFFLINE (cached)" : "LIVE"} page on http://127.0.0.1:${port}`);
  });
}
