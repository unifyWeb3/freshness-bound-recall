import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/demo.mjs");

test("offline demo derives the real correction targets instead of hard-coding same-checkpoint links", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--offline"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, RUN_MAINNET: "" },
  });
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /cor-sui-clock-341742463[\s\S]*obs-sui-clock-341742424/);
  assert.match(result.stdout, /cor-sui-clock-341742424[\s\S]*obs-sui-clock-341742383/);
  assert.match(result.stdout, /cor-sui-clock-341742383[\s\S]*obs-sui-clock-341741527/);

  assert.doesNotMatch(result.stdout, /cor-sui-clock-341742463[^\n]*obs-sui-clock-341742463/);
  assert.doesNotMatch(result.stdout, /cor-sui-clock-341742424[^\n]*obs-sui-clock-341742424/);
  assert.doesNotMatch(result.stdout, /cor-sui-clock-341742383[^\n]*obs-sui-clock-341742383/);
});
