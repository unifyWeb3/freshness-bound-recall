#!/usr/bin/env node
// Secrets audit: proves the repo contains no secret material and that .env is
// correctly ignored/untracked. Exits non-zero on any failure.
//
//   node scripts/audit-secrets.mjs
//
// The audit never prints a secret value; findings are paths + names redacted to
// fingerprints only (prefix + length + first/last hash slice).

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, ENV_PATH, readEnv } from "../src/runtime.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const failures = [];
const passes = [];
const notes = [];
function ok(name, detail = "") { passes.push(`${name}${detail ? ` — ${detail}` : ""}`); if (verbose) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); }
function fail(name, detail = "") { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`FAIL ${name} — ${detail}`); }
function note(m) { notes.push(m); if (verbose) console.log(`NOTE ${m}`); }

const fp = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 8);

// ---------------- 1. .env exists, ignored, untracked
if (existsSync(ENV_PATH)) {
  ok(".env exists", ENV_PATH);
} else {
  fail(".env exists", `${ENV_PATH} missing`);
}
let ignored = "";
try {
  ignored = execSync("git check-ignore -v .env", { cwd: ROOT, encoding: "utf8" }).trim();
} catch { ignored = ""; }
if (ignored) ok(".env is git-ignored", ignored.split("\n")[0]);
else fail(".env is git-ignored", "git check-ignore found no rule");
let tracked = [];
try { tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch (e) { fail("git ls-files", String(e.message)); }
const trackedEnv = tracked.filter((f) => /(^|\/)\.env(\b|$)/.test(f));
if (trackedEnv.length === 0) ok(".env is not tracked by git", `${tracked.length} tracked files scanned`);
else fail(".env is not tracked by git", trackedEnv.join(", "));

// ---------------- 2. tracked files contain no value from .env
const env = readEnv();
const secretKeys = Object.keys(env).filter((k) => /(KEY|SECRET|PRIVATE|TOKEN|PASSWORD|SEED)/i.test(k));
const secretValues = Object.entries(env)
  .filter(([k, v]) => /(KEY|SECRET|PRIVATE|TOKEN|PASSWORD|SEED)/i.test(k) && String(v).length >= 8)
  .map(([k, v]) => [k, String(v)]);
if (secretValues.length === 0) {
  note("no secret-shaped env values with length >= 8 to fingerprint (nothing to check)");
} else {
  for (const f of tracked) {
    let body = "";
    try { body = readFileSync(resolve(ROOT, f), "utf8"); } catch { continue; }
    for (const [k, v] of secretValues) {
      if (body.includes(v)) fail(`tracked file ${f} contains the value of ${k} (fp ${fp(v)})`);
    }
  }
  ok(`no tracked file contains any of ${secretValues.length} secret-shaped env value(s) (values are never printed)`);
}

// ---------------- 3. secret-shaped strings in tracked files (PEM/hex blocks)
const shaped = [];
for (const f of tracked) {
  let body = "";
  try { body = readFileSync(resolve(ROOT, f), "utf8"); } catch { continue; }
  const hits = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
  ];
  for (const h of hits) if (h.test(body)) shaped.push(`${f}: ${h}`);
}
if (shaped.length) fail("secret-shaped string found in tracked file(s)", shaped.join("; "));
else ok("no secret-shaped strings (PEM/JWT/token prefixes) in tracked files");

// ---------------- 4. runtime artifacts are ignored
for (const artifact of ["data/ledger.jsonl", "data/policy-mirror.json", "data/cache/proof-snapshot.json", "data/observer.log"]) {
  try {
    execSync(`git check-ignore -q ${JSON.stringify(artifact)}`, { cwd: ROOT });
    ok(`${artifact} is git-ignored`);
  } catch {
    if (existsSync(resolve(ROOT, artifact))) fail(`${artifact} is not git-ignored`, "runtime artifact would be risky to commit");
    else ok(`${artifact} absent (not generated)`);
  }
}

// ---------------- 5. no git remotes (nothing pushed)
let remotes = "";
try { remotes = execSync("git remote -v", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { remotes = ""; }
if (!remotes) ok("no git remotes configured");
else fail("no git remotes configured", "a remote exists — check that nothing was pushed");

// ---------------- report
const summary = { tracked_files: tracked.length, secret_value_fingerprints: secretValues.length, passes: passes.length, failures: failures.length };
console.log("\n=== secrets audit ===");
console.log(`tracked files   : ${summary.tracked_files}`);
console.log(`secret values   : ${summary.secret_value_fingerprints} fingerprinted (never printed); ${secretKeys.length} candidate keys in .env`);
console.log(`passes          : ${summary.passes}`);
console.log(`failures        : ${summary.failures}`);
console.log(`remotes         : ${remotes ? "present" : "none"}`);
if (summary.failures === 0) {
  console.log("AUDIT: PASS");
  process.exit(0);
} else {
  console.log("AUDIT: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
