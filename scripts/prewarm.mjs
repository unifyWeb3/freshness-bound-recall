#!/usr/bin/env node
// Pre-warm before the demo: make the relayer and Tatum fast before anyone
// watches. The relayer's first call builds a SEAL session and probes the
// relayer version, and the Tatum checkpoint is cached to disk so the offline
// proof page has something to show.
//
//   node scripts/prewarm.mjs            # relayer + Tatum, mainnet reads only
//   node scripts/prewarm.mjs --live     # also touch the mainnet memory store

import { createRuntime, CACHE_DIR } from "../src/runtime.mjs";
import { credentialSelfTest, withRetries } from "../src/mainnet.mjs";
import { resolve } from "node:path";
import { SUBJECTS } from "../src/subjects.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");

const rt = createRuntime({ live, logger: (m) => console.log(m) });
const cachePath = resolve(CACHE_DIR, "tatum-cache.json");
rt.tatum.cachePath = cachePath;

console.log("[prewarm] warming Tatum...");
const cp = await withRetries(() => rt.tatum.readCheckpoint(), { label: "tatum-checkpoint" });
console.log(`[prewarm] checkpoint ${cp.checkpointSeq} (${cp.source})`);
for (const s of SUBJECTS) {
  const obj = await withRetries(() => rt.tatum.readObject(s.address), { label: `tatum-object-${s.id}` });
  console.log(`[prewarm] ${s.id} version=${obj.version}`);
}
rt.tatum.saveDiskCache({ prewarmed_at: new Date().toISOString() });
console.log(`[prewarm] cached to ${cachePath}`);

if (live) {
  console.log("[prewarm] warming the relayer...");
  const self = await withRetries(
    () => credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace }),
    { label: "relayer-self-test" },
  );
  for (const c of self.checks) console.log(`[prewarm] self-test ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  const recall = await withRetries(() => rt.store.recall({ query: "freshness", limit: 3, sort: "recent" }), { label: "relayer-recall" });
  console.log(`[prewarm] recall returned ${recall.results?.length ?? 0} memories`);
  console.log(`[prewarm] relayer: ${JSON.stringify(self.relayer)}`);
} else {
  console.log("[prewarm] relayer not warmed (pass --live to warm mainnet memory)");
}
console.log(`[prewarm] tatum plan: ${rt.tatum.planHeader() ?? "-"}`);
console.log("[prewarm] done");
