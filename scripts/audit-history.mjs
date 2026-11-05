#!/usr/bin/env node
// Git history audit: scan every object reachable from every ref for secret
// material. Prints fingerprints only (sha prefix + git path + value hash),
// never the secret itself. Exits non-zero on any finding.
//
//   node scripts/audit-history.mjs
//
// Checks:
//   - the real .env never appears in any commit
//   - no blob contains any value from the current .env (length >= 8)
//   - no blob matches secret-shaped patterns (suiprivkey/JWT/PEM)

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readEnv } from "../src/runtime.mjs";

const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 8);

function git(args, maxBuffer = 64 * 1024 * 1024) {
  return execSync(`git ${args}`, { encoding: "utf8", maxBuffer });
}

const findings = [];

// 1. .env must never have been committed
const envPaths = [".env", "a/.env", "total-recall/.env"];
for (const p of envPaths) {
  const out = git(`rev-list --all -- "${p}"`).trim();
  if (out) findings.push(`.env path ${p} referenced in commit(s): ${out.split("\n").length} (fp-only)`);
}

// 2. every blob object: compare against current .env values
let envValues = [];
try {
  const env = readEnv();
  envValues = Object.entries(env).filter(([k, v]) => /(KEY|SECRET|PRIVATE|TOKEN|PASSWORD|SEED)/i.test(k) && String(v).length >= 8);
} catch {
  // no .env in this checkout (fresh clone): nothing to match against
}

const listing = git("rev-list --objects --all").trim().split("\n").filter(Boolean);
const candidates = new Map();
for (const line of listing) {
  const sp = line.indexOf(" ");
  if (sp === -1) continue;
  const sha = line.slice(0, sp), path = line.slice(sp + 1);
  candidates.set(sha, path);
}

const shaped = [
  { re: /suiprivkey1[0-9a-z]{32,}/i, name: "suiprivkey" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: "PEM private key" },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/, name: "JWT" },
];

let blobs = 0, flagged = 0;
for (const [sha, path] of candidates) {
  let type = "";
  try { type = git(`cat-file -t ${sha}`).trim(); } catch { continue; }
  if (type !== "blob") continue;
  blobs += 1;
  let body = "";
  try { body = git(`cat-file blob ${sha}`, 8 * 1024 * 1024); } catch { continue; }
  for (const [k, v] of envValues) {
    if (body.includes(String(v))) { flagged += 1; findings.push(`blob ${sha.slice(0, 12)} (${path}) contains .env value ${k} (fp ${fp(v)})`); }
  }
  for (const { re, name } of shaped) {
    if (re.test(body)) { flagged += 1; findings.push(`blob ${sha.slice(0, 12)} (${path}) matches secret-shaped pattern: ${name}`); }
  }
}

console.log("=== git history audit ===");
console.log(`refs objects : ${listing.length}`);
console.log(`blobs scanned: ${blobs}`);
console.log(`findings     : ${findings.length}`);
if (findings.length) {
  for (const f of findings) console.error(` - ${f}`);
  console.log("AUDIT: FAIL");
  process.exit(1);
}
console.log("AUDIT: PASS");
process.exit(0);
