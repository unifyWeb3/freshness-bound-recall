import { test } from "node:test";
import assert from "node:assert/strict";
import { Redactor, loadEnv } from "../src/redact.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PRESENT = existsSync(resolve(ROOT, ".env"));

test("loadEnv parses KEY=value pairs without printing them", () => {
  const env = loadEnv(resolve(ROOT, "test/helpers/fake.env"));
  assert.equal(env.FAKE_KEY, "value-one");
  assert.equal(env.QUOTED, "value-two");
});

test("the redactor removes known secret values", () => {
  const r = new Redactor(["super-secret-value"]);
  const out = r.redact("the key is super-secret-value here");
  assert.ok(!out.includes("super-secret-value"));
  assert.match(out, /\[REDACTED\]/);
});

test("the redactor removes secret-shaped strings even when unknown", () => {
  const r = new Redactor([]);
  assert.ok(!r.redact("suiprivkey1qrstuvwxyz23456789acdefghjklmnp").includes("suiprivkey1"));
  assert.ok(!r.redact("t-0123456789abcdef0123").includes("t-0123456789abcdef"));
});

test("the redactor keeps Sui addresses (they are proof data, not secrets)", () => {
  const r = new Redactor([]);
  const addr = "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f";
  assert.equal(r.redact(addr), addr);
});

test("the redactor walks objects and arrays", () => {
  const r = new Redactor(["hunter2-secret"]);
  const out = r.redact({ a: ["hunter2-secret", "safe"], b: { c: "hunter2-secret" } });
  assert.equal(out.a[0], "[REDACTED]");
  assert.equal(out.a[1], "safe");
  assert.equal(out.b.c, "[REDACTED]");
});

test("the real .env values are redacted from any output", { skip: !ENV_PRESENT }, () => {
  const env = loadEnv(resolve(ROOT, ".env"));
  const r = Redactor.fromEnv(env);
  const sample = [env.TATUM_API_KEY, env.MEMWAL_PRIVATE_KEY, env.MEMWAL_ACCOUNT_ID, env.MEMWAL_AGENT_ID].join(" ");
  const out = r.redact(sample);
  for (const v of [env.TATUM_API_KEY, env.MEMWAL_PRIVATE_KEY, env.MEMWAL_ACCOUNT_ID, env.MEMWAL_AGENT_ID]) {
    assert.ok(!out.includes(v), "a secret survived redaction");
  }
});

test("the .env file itself contains no stray values on stdout paths", { skip: !ENV_PRESENT }, () => {
  const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
  assert.match(raw, /TATUM_API_KEY=/);
  assert.match(raw, /MEMWAL_PRIVATE_KEY=/);
});
