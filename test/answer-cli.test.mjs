import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/answer.mjs");

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, RUN_MAINNET: "" },
  });
}

test("answer CLI accepts both --query value and --query=value", () => {
  for (const args of [["--query", "clock version"], ["--query=clock version"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"query": "clock version"/);
  }
});
