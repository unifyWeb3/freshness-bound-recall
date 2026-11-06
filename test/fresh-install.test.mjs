import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test("packed CLI installs in an empty directory and runs without credentials", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "recall-checked-install-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));

  const artifacts = join(scratch, "artifacts");
  const consumer = join(scratch, "consumer");
  mkdirSync(artifacts);
  mkdirSync(consumer);

  const packed = run(NPM, ["pack", "--json", "--pack-destination", artifacts], { cwd: ROOT });
  const [manifest] = JSON.parse(packed.stdout);
  const paths = manifest.files.map((file) => file.path);
  const forbidden = paths.filter((path) => (
    path === ".env" ||
    path.startsWith("test/") ||
    path.startsWith("reports/") ||
    path.startsWith("freeze/") ||
    path.startsWith("site/") ||
    path.startsWith("data/cache/") ||
    /^scripts\/(observer|persist-policy|freeze|prewarm|measure|proof-page|export-site|audit)/.test(path)
  ));
  assert.deepEqual(forbidden, [], `packed artifact contains non-product files: ${forbidden.join(", ")}`);

  const tarball = join(artifacts, manifest.filename);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }, null, 2));
  run(NPM, [
    "install",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
    tarball,
  ], { cwd: consumer });

  const env = { ...process.env };
  for (const name of ["TATUM_API_KEY", "MEMWAL_ACCOUNT_ID", "MEMWAL_AGENT_ID", "MEMWAL_PRIVATE_KEY"]) {
    delete env[name];
  }
  const bin = join(consumer, "node_modules", ".bin", process.platform === "win32" ? "recall_checked.cmd" : "recall_checked");
  const invoked = run(bin, ["--sample", "sui-clock-changed", "--json"], { cwd: consumer, env });
  const result = JSON.parse(invoked.stdout);

  assert.equal(result.schema, "recall_checked/v1");
  assert.equal(result.mode, "recorded-mainnet");
  assert.equal(result.read_only, true);
  assert.equal(result.source.network_access, false);
  assert.equal(result.withheld, true);
  assert.deepEqual(result.writes, []);
  assert.match(result.memory.blob_id, /^[A-Za-z0-9_-]{40,}$/);

  const installedPackage = JSON.parse(readFileSync(
    join(consumer, "node_modules", "freshness-bound-recall", "package.json"),
    "utf8",
  ));
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(installedPackage.scripts?.[hook], undefined, `package must not define ${hook}`);
  }
});
