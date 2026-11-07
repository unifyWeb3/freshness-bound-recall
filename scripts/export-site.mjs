#!/usr/bin/env node
// Export the offline proof page to a static directory (./site by default).
//
//   node scripts/export-site.mjs              # writes ./site
//   node scripts/export-site.mjs --out=./out
//
// The export is rendered from a labelled snapshot (live-generated cache if
// present, else the committed docs/evidence/proof-snapshot.json). It contains
// no secrets: the renderer only touches public data (blob ids, checkpoint
// stamps, plan header), and this script scans the rendered HTML against every
// value in .env before writing anything.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ROOT, readEnv } from "../src/runtime.mjs";
import { snapshotCandidates, pages } from "./proof-page.mjs";

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const outDir = resolve(ROOT, getArg("out", "./site"));

const snapPath = snapshotCandidates().find((p) => existsSync(p));
if (!snapPath) {
  console.error(`[export] no snapshot found (tried ${snapshotCandidates().join(", ")})`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(snapPath, "utf8"));
const snapshot = {
  ...raw,
  mode: "offline",
  exported_at: new Date().toISOString(),
  snapshot_path: snapPath,
  live_error: undefined,
};

const rendered = pages(snapshot);

// ---- secret scan: never write a page that carries a .env value
let leaked = 0;
let scanned = 0;
try {
  const env = readEnv();
  for (const [k, v] of Object.entries(env)) {
    if (String(v).length < 8) continue;
    scanned += 1;
    for (const [file, html] of Object.entries(rendered)) {
      if (html.includes(String(v))) {
        console.error(`[export] REFUSING to write: ${file} contains env value ${k} (fp ${createHash("sha256").update(String(v)).digest("hex").slice(0, 8)})`);
        leaked += 1;
      }
    }
  }
} catch {
  // .env absent (e.g. a fresh clone): nothing to scan against, keep going
}
const secretShaped = [
  /suiprivkey1[0-9a-z]{32,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(EXPOSE|API|PRIVATE|SECRET)_[A-Z_]{0,32}[A-Za-z0-9/=]{20,}/,
];
for (const re of secretShaped) {
  for (const [file, html] of Object.entries(rendered)) {
    if (re.test(html)) { console.error(`[export] REFUSING to write: secret-shaped string found in ${file}`); leaked += 1; }
  }
}

if (leaked > 0) process.exit(1);

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) {
  if (file.endsWith(".html") || file === "export.json") rmSync(resolve(outDir, file), { force: true });
}
const fingerprints = { pages: {}, source_snapshot: snapPath.split("/").slice(-1)[0], snapshot_relpath: snapPath.includes(ROOT) ? snapPath.slice(ROOT.length).replace(/^\//, "") : "snapshot", exported_at: snapshot.exported_at, scanned_env_values: scanned };
for (const [file, html] of Object.entries(rendered)) {
  const name = file.replace(/^\//, "");
  writeFileSync(resolve(outDir, name), html);
  fingerprints.pages[name] = { index_html_sha256: createHash("sha256").update(html).digest("hex"), bytes: Buffer.byteLength(html) };
}
// Keep export.json compatible with prior consumers: top-level index_html_sha256 stays.
fingerprints.index_html_sha256 = fingerprints.pages["index.html"].index_html_sha256;
fingerprints.bytes = fingerprints.pages["index.html"].bytes;
writeFileSync(resolve(outDir, "export.json"), JSON.stringify(fingerprints, null, 1));

console.log(`[export] wrote ${Object.keys(rendered).length} pages to ${outDir}`);
for (const [name, meta] of Object.entries(fingerprints.pages)) {
  console.log(`[export]   ${name}  bytes=${meta.bytes}  sha256=${meta.index_html_sha256.slice(0, 16)}…`);
}
console.log(`[export] source snapshot: ${snapPath} (generated ${raw.generated_at})`);
console.log(`[export] scanned ${scanned} env values for accidental leakage: none found`);
console.log(`[export] pages are static; open ${resolve(outDir, "index.html")} in a browser (no requests fire)`);
process.exit(0);
