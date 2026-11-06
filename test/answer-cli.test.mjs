import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/answer.mjs");
const INSTALLABLE_SCRIPT = resolve(ROOT, "scripts/recall-checked.mjs");

function run(args, script = SCRIPT) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, RUN_MAINNET: "" },
  });
}

test("answer CLI accepts both --query value and --query=value", () => {
  for (const args of [["--query", "clock version"], ["--query=clock version"]]) {
    const result = run([...args, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"query": "clock version"/);
  }
});

test("installable CLI defaults to the read-only recorded Mainnet sample", () => {
  const result = run(["--json"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schema, "recall_checked/v1");
  assert.equal(body.mode, "recorded-mainnet");
  assert.equal(body.read_only, true);
  assert.equal(body.source.network_access, false);
  assert.equal(body.writes.length, 0);
  assert.match(body.memory.blob_id, /^[A-Za-z0-9_-]{40,}$/);
});

test("CLI exposes the recorded Mainnet revision lifecycle as stable JSON", () => {
  const result = run(["--sample", "sui-clock-revision-lifecycle", "--json"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);

  assert.equal(body.schema, "recall_checked_lifecycle/v1");
  assert.equal(body.read_only, true);
  assert.equal(body.source.network_access, false);
  assert.deepEqual(body.behavior.sequence, ["STALE", "FRESH", "STALE"]);
  assert.equal(body.revision.predecessor.blob_id, "goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY");
  assert.equal(body.revision.correction.blob_id, "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY");
  assert.equal(body.behavior.first_post_persistence_check.recorded_event.actually_recalled_correction_blob, false);
  assert.deepEqual(body.writes, []);
});

test("CLI human output makes revision and later withholding visible", () => {
  const result = run(["--sample", "sui-clock-revision-lifecycle"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /STALE → FRESH → STALE/);
  assert.match(result.stdout, /Predecessor: obs-sui-clock-341742424 · goZjQJ36/);
  assert.match(result.stdout, /Correction: cor-sui-clock-341742463 · mjxZQ1X2/);
  assert.match(result.stdout, /Timing: persisted 117242 ms after proof · first recorded check 1381 ms later/);
  assert.match(result.stdout, /At revision proof: FRESH/);
  assert.match(result.stdout, /First post-persistence check: STALE\/WITHHELD/);
  assert.match(result.stdout, /network off · Writes: none/);
});

test("CLI rejects unknown samples and lists both recorded choices", () => {
  const result = run(["--sample", "invented", "--json"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown sample "invented"/);
  assert.match(result.stderr, /sui-clock-changed, sui-clock-revision-lifecycle/);
});

test("recorded lifecycle sample cannot be combined with live mode", () => {
  const result = run(["--live", "--sample", "sui-clock-revision-lifecycle"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Choose either --live or --sample/);
});

test("CLI makes the Mainnet write switch explicit and refuses it outside live mode", () => {
  const help = run(["--help"], INSTALLABLE_SCRIPT);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Live mode is READ-ONLY by default/);
  assert.match(help.stdout, /--allow-mainnet-writes/);
  assert.match(help.stdout, /account owner's approval/);

  const rejected = run(["--allow-mainnet-writes"], INSTALLABLE_SCRIPT);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /valid only with --live/);
});

test("legacy --offline flag is rejected instead of silently changing live safety", () => {
  const result = run(["--live", "--offline"], INSTALLABLE_SCRIPT);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown argument: --offline/);
});

test("boolean CLI flags reject =value forms instead of silently ignoring them", () => {
  for (const flag of ["--live", "--help", "--allow-mainnet-writes"]) {
    const result = run([`${flag}=true`], INSTALLABLE_SCRIPT);
    assert.equal(result.status, 2, `${flag}=true must be rejected\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(flag.replaceAll("-", "\\-")));
  }
});
