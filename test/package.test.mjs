import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as recallApi from "../src/recall-checked.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

test("package supports Node 24 and uses explicit test-file globs", () => {
  assert.equal(pkg.engines.node, ">=24");
  assert.equal(pkg.scripts.test, "node --test test/*.test.mjs");
  assert.equal(pkg.scripts["test:live"], "RUN_MAINNET=1 node --test test/live/*.test.mjs");
});

test("package exposes the safe recall_checked command and library contract", () => {
  assert.equal(pkg.private, true, "registry publication remains intentionally disabled");
  assert.equal(pkg.bin.recall_checked, "./scripts/recall-checked.mjs");
  assert.equal(pkg.exports["."], "./src/recall-checked.mjs");
  assert.equal(pkg.exports["./core"], "./src/answer.mjs");
  assert.ok(pkg.files.includes("docs/evidence/proof-snapshot.json"));
  assert.ok(pkg.files.includes("scripts/recall-checked.mjs"));
  assert.equal(typeof recallApi.recallCheckedLifecycleSample, "function");
  assert.equal(recallApi.RECORDED_LIFECYCLE_SAMPLE_NAME, "sui-clock-revision-lifecycle");
});
