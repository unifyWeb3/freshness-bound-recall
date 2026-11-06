import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

test("package supports Node 24 and uses explicit test-file globs", () => {
  assert.equal(pkg.engines.node, ">=24");
  assert.equal(pkg.scripts.test, "node --test test/*.test.mjs");
  assert.equal(pkg.scripts["test:live"], "RUN_MAINNET=1 node --test test/live/*.test.mjs");
});
