#!/usr/bin/env node
// Measure observed change rates of candidate Sui mainnet objects (read-only).
// Purpose: pick a FAST claim class (hot shared object) and a SLOW claim class
// (rarely-changing object), both with real mainnet subjects and no transactions.
//
// Read-only: one GraphQL multiGetObjects call per round + one cached checkpoint call.
// Output: data/claim-class-measurement.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const ENV_PATH = resolve(ROOT, ".env");
const OUT = resolve(ROOT, "data/claim-class-measurement.json");

function loadEnv(path) {
  const env = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = loadEnv(ENV_PATH);
const KEY = ENV.TATUM_API_KEY;
const GQL = "https://sui-mainnet.gateway.tatum.io/graphql";

const CANDIDATES = [
  { id: "C1-clock", label: "Sui Clock (shared, every checkpoint)", addr: "0x0000000000000000000000000000000000000000000000000000000000000006" },
  { id: "C2-system-state", label: "Sui system state (shared)", addr: "0x0000000000000000000000000000000000000000000000000000000000000005" },
  { id: "C3-framework-pkg", label: "Sui framework package 0x2", addr: "0x0000000000000000000000000000000000000000000000000000000000000002" },
  { id: "C4-memwal-registry", label: "MemWal AccountRegistry (mainnet)", addr: "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f" },
  { id: "C5-memwal-package", label: "MemWal package (mainnet)", addr: "0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5" },
  { id: "C6-usdc-metadata", label: "Native USDC CoinMetadata", addr: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e" },
];

const args = process.argv.slice(2);
const getArg = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const ROUNDS = Number(getArg("rounds", "34"));      // 34 rounds x 15s = 8.5 min
const INTERVAL_S = Number(getArg("interval", "15"));

async function gql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const t0 = performance.now();
    try {
      const res = await fetch(GQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": KEY },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const latencyMs = Math.round(performance.now() - t0);
      const plan = res.headers.get("x-ttm-plan") || null;
      if (res.status === 429) {
        lastErr = new Error(`429 rate limited (plan=${plan})`);
        await new Promise((r) => setTimeout(r, 750 * 2 ** Math.min(attempt, 3)));
        continue;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = new Error(`http ${res.status}: ${JSON.stringify(json).slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 750 * 2 ** Math.min(attempt, 3)));
        continue;
      }
      return { status: res.status, latencyMs, plan, json };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 750 * 2 ** Math.min(attempt, 3)));
    }
  }
  throw new Error(`gql failed after retries: ${lastErr?.message || lastErr}`);
}

const OBJ_Q = `query($a: SuiAddress!){ object(address:$a){ address version digest } }`;
const CP_Q = `{ checkpoints(last:1){ nodes { sequenceNumber digest timestamp } } }`;

console.log(`[measure] rounds=${ROUNDS} interval=${INTERVAL_S}s candidates=${CANDIDATES.length}`);
const rounds = [];
let lastPlan = null;
for (let i = 0; i < ROUNDS; i++) {
  const snap = { round: i, at: new Date().toISOString(), checkpoint: null, objects: {}, errors: [] };
  for (const c of CANDIDATES) {
    try {
      const obs = await gql(OBJ_Q, { a: c.addr });
      lastPlan = obs.plan || lastPlan;
      const o = obs.json?.data?.object;
      snap.objects[c.addr] = o ? { version: o.version, digest: o.digest } : null;
    } catch (e) {
      snap.errors.push(`${c.id}: ${e.message}`);
      snap.objects[c.addr] = undefined;
    }
  }
  try {
    const cp = await gql(CP_Q);
    lastPlan = cp.plan || lastPlan;
    snap.checkpoint = cp.json?.data?.checkpoints?.nodes?.[0] || null;
  } catch (e) {
    snap.errors.push(`cp: ${e.message}`);
  }
  rounds.push(snap);
  const summary = CANDIDATES.map((c) => `${c.id}=v${snap.objects[c.addr]?.version ?? "null"}`).join(" ");
  console.log(`[measure] r${i} cp=${snap.checkpoint?.sequenceNumber ?? "?"} ${summary} plan=${lastPlan}${snap.errors.length ? " ERR:" + snap.errors.join(";") : ""}`);
  if (i < ROUNDS - 1) await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
}

// ---- analysis ----
const analysis = CANDIDATES.map((c) => {
  const series = rounds.map((r) => r.objects[c.addr]).filter(Boolean);
  const versions = series.map((s) => s.version);
  const digests = series.map((s) => s.digest);
  const uniqV = new Set(versions);
  const uniqD = new Set(digests);
  let changes = 0;
  let firstChangeAt = null;
  let lastChangeAt = null;
  for (let i = 1; i < versions.length; i++) {
    if (versions[i] !== versions[i - 1]) {
      changes++;
      firstChangeAt = firstChangeAt ?? rounds[i].at;
      lastChangeAt = rounds[i].at;
    }
  }
  const spanS = series.length ? (new Date(rounds[rounds.length - 1].at) - new Date(rounds[0].at)) / 1000 : 0;
  const cpSpan = rounds.length > 1 ? rounds[rounds.length - 1].checkpoint?.sequenceNumber - rounds[0].checkpoint?.sequenceNumber : 0;
  return {
    id: c.id, label: c.label, addr: c.addr,
    samples: series.length, distinct_versions: uniqV.size, distinct_digests: uniqD.size,
    version_changes: changes,
    changes_per_min: spanS ? Number(((changes / spanS) * 60).toFixed(3)) : 0,
    checkpoint_span: cpSpan,
    checkpoints_per_min: spanS ? Number(((cpSpan / spanS) * 60).toFixed(2)) : 0,
    first_change_at: firstChangeAt, last_change_at: lastChangeAt,
    first_version: versions[0] ?? null, last_version: versions[versions.length - 1] ?? null,
    span_seconds: Math.round(spanS),
    classification: changes === 0 ? "SLOW" : changes >= 3 ? "FAST" : "MEDIUM",
  };
});

const out = {
  generated_at: new Date().toISOString(),
  method: "Tatum Sui mainnet GraphQL multiGetObjects, read-only, no transactions",
  tatum_plan_header: lastPlan,
  rounds: rounds.length, interval_s: INTERVAL_S,
  analysis,
  rounds_detail: rounds,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("\n=== SUMMARY ===");
for (const a of analysis) {
  console.log(`${a.classification.padEnd(7)} ${a.id.padEnd(18)} changes=${String(a.version_changes).padStart(3)} (${a.changes_per_min}/min) cp_span=${a.checkpoint_span} cp/min=${a.checkpoints_per_min}`);
}
console.log(`saved ${OUT}`);
