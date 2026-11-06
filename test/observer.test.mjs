import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecord, recordToText } from "../src/schema.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadAdversarialText() {
  const source = readFileSync(resolve(ROOT, "scripts/observer.mjs"), "utf8");
  const start = source.indexOf("function adversarialText");
  const end = source.indexOf("\n}\n", start) + 3;
  assert.ok(start >= 0 && end > start, "observer adversarialText function must be present");
  const declaration = source.slice(start, end);
  return Function("recordToText", "SUI_MAINNET_CHAIN_ID", "rt", `${declaration}; return adversarialText;`)(
    recordToText,
    SUI_MAINNET_CHAIN_ID,
    { env: {} },
  );
}

test("observer adversarial memory carries the old anchor proof it claims to test", () => {
  const adversarialText = loadAdversarialText();
  const anchor = {
    "proof.chain_id": SUI_MAINNET_CHAIN_ID,
    "proof.checkpoint_seq": 1000,
    "proof.checkpoint_digest": "anchor-checkpoint",
    "proof.object_version": "v1",
    "proof.object_digest": "d1",
    "proof.read_at": "2026-11-05T00:00:00.000Z",
  };
  const text = adversarialText({
    subject: { id: "memwal-registry", class: "SLOW", label: "MemWal AccountRegistry", address: "0xabc" },
    anchor,
    live: { checkpointSeq: 1200, checkpointDigest: "live-checkpoint", readAt: "2026-11-05T00:01:00.000Z" },
    pin: { version: "v1", digest: "d1", readAt: "2026-11-05T00:01:00.000Z" },
    decision: { verdict: "FRESH" },
    ageCheckpoints: 200,
    fastWindow: 50,
  });
  const { record } = parseRecord(text);

  assert.equal(record["proof.checkpoint_seq"], 1000);
  assert.equal(record["proof.checkpoint_digest"], "anchor-checkpoint");
  assert.equal(record["proof.object_version"], "v1");
  assert.equal(record["proof.object_digest"], "d1");
  assert.equal(record["proof.read_at"], "2026-11-05T00:00:00.000Z");
  assert.match(record.body, /proof from checkpoint 1000 is 200 checkpoints old at checkpoint 1200/);
});
