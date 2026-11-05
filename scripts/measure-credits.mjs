#!/usr/bin/env node
// Credit measurement: make a KNOWN number of Tatum calls and print the count,
// so the number can be compared against the Tatum dashboard.
//
//   node scripts/measure-credits.mjs --calls=20
//   node scripts/measure-credits.mjs --calls=20 --json
//
// The script prints two numbers, since the 1 s checkpoint cache absorbs some
// reads without hitting the network:
//   - attempted_calls       (would-be requests without the cache)
//   - actual_graphql_requests (what Tatum receives, and what the dashboard sees)
// Tatum does not return a credit header, so the credit cost of one call is
// UNKNOWN until the dashboard is compared - this script provides one half.

import { readEnv } from "../src/runtime.mjs";
import { TatumClient, TATUM_GRAPHQL, SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const CALLS = Math.max(1, Number(getArg("calls", "20")));
const INTERVAL_MS = Math.max(0, Number(getArg("interval", "350"))); // stay under 3 rps shared
const json = args.includes("--json");

const env = readEnv();
const client = new TatumClient({ apiKey: env.TATUM_API_KEY, logger: () => {} });

const startedAt = new Date().toISOString();
const t0 = performance.now();
const subjects = [
  "0x0000000000000000000000000000000000000000000000000000000000000006",
  "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f",
];

let checkpointCalls = 0;
let objectCalls = 0;
const latencies = [];
const errors = [];

for (let i = 0; i < CALLS; i++) {
  try {
    const cp = await client.readCheckpoint();
    checkpointCalls += 1;
    latencies.push(client.requestLog().at(-1)?.latency_ms ?? 0);
    if (i % 2 === 1) {
      const addr = subjects[(i >> 1) % subjects.length];
      await client.readObject(addr);
      objectCalls += 1;
      latencies.push(client.requestLog().at(-1)?.latency_ms ?? 0);
    }
  } catch (e) {
    errors.push(e.message);
  }
  if (i < CALLS - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

const elapsedMs = Math.round(performance.now() - t0);
const sorted = [...latencies].sort((a, b) => a - b);
const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const actualCalls = client.callCount;

const report = {
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  requested_calls: CALLS,
  attempted_calls: checkpointCalls + objectCalls,
  actual_graphql_requests: actualCalls,
  checkpoint_cache_hits: Math.max(0, checkpointCalls + objectCalls - actualCalls),
  checkpoint_reads: checkpointCalls,
  object_reads: objectCalls,
  errors: errors.length,
  endpoint: TATUM_GRAPHQL,
  chain_id: SUI_MAINNET_CHAIN_ID,
  plan_header: client.planHeader(),
  elapsed_ms: elapsedMs,
  latency_ms: { p50: p(0.5), p95: p(0.95), max: sorted.at(-1) ?? 0 },
  credits_per_call: "UNKNOWN - no credit header is returned by Tatum; compare actual_graphql_requests with the dashboard",
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("=== Tatum credit measurement ===");
  console.log(`attempted calls      : ${report.attempted_calls} (requested ${report.requested_calls})`);
  console.log(`actual GraphQL reqs  : ${report.actual_graphql_requests}  <-- compare this with the dashboard`);
  console.log(`  checkpoint reads    : ${report.checkpoint_reads} (1 s cache; ${report.checkpoint_cache_hits} absorbed by cache)`);
  console.log(`  object reads        : ${report.object_reads}`);
  console.log(`  errors              : ${report.errors}`);
  console.log(`plan header           : ${report.plan_header}`);
  console.log(`endpoint              : ${report.endpoint}`);
  console.log(`latency ms            : p50 ${report.latency_ms.p50} / p95 ${report.latency_ms.p95} / max ${report.latency_ms.max}`);
  console.log(`elapsed               : ${report.elapsed_ms} ms`);
  console.log(`credits per call      : ${report.credits_per_call}`);
  console.log("\nCompare this request count with your Tatum dashboard usage.");
}
