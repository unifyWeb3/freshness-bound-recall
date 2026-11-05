#!/usr/bin/env node
// Freeze the current state of the evidence: a timestamped bundle of
//   - the decision ledger (verbatim copy + verdict counts)
//   - the memories manifest (every namespace blob: claim, blob_id, class, state,
//     checkpoint + object version stamps)
//   - the proof snapshot (cached page data) used as the render source
//   - repo state (commit, dirty files), Node version, chain id, captured checkpoint
//
//   node scripts/freeze.mjs
//
// Output: ./freeze/freeze-<UTC timestamp>.json plus copied artifacts in
// ./freeze/. No secrets; filenames are full ids and hashes. Live reads need
// the network; on failure the script falls back to the committed snapshot and
// marks source=offline.

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { ROOT, LEDGER_PATH, readEnv } from "../src/runtime.mjs";
import { createRuntime, CACHE_DIR } from "../src/runtime.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const outDir = resolve(ROOT, "freeze");
mkdirSync(outDir, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const fileSha = (p) => sha256(readFileSync(p));

function gitState() {
  let commit = "unknown", dirty = "unknown";
  try { commit = execSync("git rev-parse --short=12 HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch {}
  try {
    const s = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
    dirty = s ? `${s.split("\n").length} dirty path(s)` : "clean";
  } catch {}
  return { commit, dirty };
}

function readLedger() {
  if (!existsSync(LEDGER_PATH)) return { entries: [], counts: {}, error: "ledger not found" };
  const raw = readFileSync(LEDGER_PATH, "utf8");
  const entries = raw.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const counts = {};
  for (const e of entries) if (e.verdict) counts[e.verdict] = (counts[e.verdict] || 0) + 1;
  return { entries, counts };
}

// ---- memories manifest: live recall if possible, else the committed snapshot
let memories = [];
let source = "live";
let liveCheckpoint = null;
let liveError = null;
try {
  const rt = createRuntime({ live: true, logger: () => {} });
  const res = await rt.store.recall({ query: "FR-v1 schema claim class epoch state subject predicate checkpoint observation correction policy adversarial", limit: 100, sort: "recent" });
  const seen = new Set();
  for (const hit of res.results || []) {
    const rec = rt.store.parse(hit.text)?.record;
    if (!rec || seen.has(hit.blob_id)) continue;
    seen.add(hit.blob_id);
    memories.push({
      blob_id: hit.blob_id, claim: rec.claim, class: rec.class, state: rec.state,
      subject: rec.subject, predicate: rec.predicate,
      proof_checkpoint_seq: rec["proof.checkpoint_seq"] ?? null,
      proof_object_version: rec["proof.object_version"] ?? null,
      proof_object_digest: rec["proof.object_digest"] ?? null,
      proof_read_at: rec["proof.read_at"] ?? null,
      recorded_at: rec.recorded_at ?? null,
      distance: hit.distance ?? null,
    });
  }
  try {
    const cp = await rt.tatum.readCheckpoint();
    liveCheckpoint = { checkpointSeq: cp.checkpointSeq, checkpointDigest: cp.checkpointDigest, readAt: cp.readAt, source: cp.source };
  } catch (e) {
    liveError = e.message;
  }
  memories.sort((a, b) => (a.proof_checkpoint_seq ?? 0) - (b.proof_checkpoint_seq ?? 0));
  rt.client?.destroy?.();
} catch (e) {
  source = "offline";
  liveError = e.message;
  const snapPath = [resolve(CACHE_DIR, "proof-snapshot.json"), resolve(ROOT, "docs/evidence/proof-snapshot.json")].find(existsSync);
  if (snapPath) {
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    liveCheckpoint = snap.checkpoint || null;
    for (const m of snap.memories || []) {
      memories.push({
        blob_id: m.blob_id, claim: m.claim, class: m.class, state: m.state,
        subject: m.subject, predicate: m.predicate,
        proof_checkpoint_seq: m.proof?.checkpoint_seq ?? null,
        proof_object_version: m.proof?.object_version ?? null,
        proof_object_digest: m.proof?.object_digest ?? null,
        proof_read_at: m.proof?.read_at ?? null,
        recorded_at: m.recorded_at ?? null, distance: m.distance ?? null,
      });
    }
    memories.sort((a, b) => (a.proof_checkpoint_seq ?? 0) - (b.proof_checkpoint_seq ?? 0));
  }
}

// ---- snapshot copies
const snapshotPath = [resolve(CACHE_DIR, "proof-snapshot.json"), resolve(ROOT, "docs/evidence/proof-snapshot.json")].find(existsSync) || null;
const ledgerCopy = resolve(outDir, "ledger.jsonl");
const snapCopy = snapshotPath ? resolve(outDir, "proof-snapshot.json") : null;
if (existsSync(LEDGER_PATH)) copyFileSync(LEDGER_PATH, ledgerCopy);
if (snapCopy) copyFileSync(snapshotPath, snapCopy);

const git = gitState();
const ledger = readLedger();

const manifest = {
  kind: "total-recall-freeze",
  created_at: new Date().toISOString(),
  source,
  live_error: liveError,
  chain_id: SUI_MAINNET_CHAIN_ID,
  checkpoint: liveCheckpoint,
  repo: git,
  node: process.version,
  memories: { count: memories.length, blobs: memories },
  decisions: ledger.counts,
  ledger_entries: ledger.entries.length,
  files: {
    ledger_jsonl: ledgerCopy,
    ledger_sha256: existsSync(ledgerCopy) ? fileSha(ledgerCopy) : null,
    proof_snapshot: snapCopy,
    proof_snapshot_sha256: snapCopy ? fileSha(snapCopy) : null,
  },
};
const manifestPath = resolve(outDir, `freeze-${stamp}.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

console.log(`[freeze] ${manifestPath}`);
console.log(`[freeze] source=${source}${liveError ? ` (live read failed: ${liveError})` : ""}`);
console.log(`[freeze] ${memories.length} memories · ${ledger.entries.length} ledger entries (${manifestFilesSummary(ledger.counts)})`);
console.log(`[freeze] commit ${git.commit} · ${git.dirty} · node ${process.version}`);
console.log(`[freeze] copies: ${ledgerCopy}${snapCopy ? ` · ${snapCopy}` : ""}`);

function manifestFilesSummary(counts) {
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "none";
}
process.exit(0);
