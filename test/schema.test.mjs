import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord, recordToText, tryParseRecord, SchemaError, SCHEMA } from "../src/schema.mjs";

const SAMPLE = {
  schema: SCHEMA,
  claim: "fc-fast-clock-0001",
  class: "FAST",
  epoch: 1,
  state: "live",
  subject: "0x0000000000000000000000000000000000000000000000000000000000000006",
  predicate: "object_version",
  value_at_write: "version=1018742782",
  "proof.transport": "tatum-sui-mainnet/graphql",
  "proof.chain_id": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
  "proof.checkpoint_seq": 341600000,
  "proof.checkpoint_digest": "JBUuCemn6gCimu2dTDtCLVPagCpKQwwiEW2WJR9gUKpF",
  "proof.object_version": "1018742782",
  "proof.object_digest": "ALXHNy71oZQfMWzEeUbUUmCegcTpFt4CHkjLThV5H2fE",
  "proof.read_at": "2026-11-05T00:00:00.000Z",
  agent_id: "agent-test",
  recorded_at: "2026-11-05T00:00:00.000Z",
  body: "The Sui clock object was observed at version 1018742782 at checkpoint 341600000.",
};

test("parse/serialize round-trip preserves every field", () => {
  const text = recordToText(SAMPLE);
  const { record } = parseRecord(text);
  for (const [k, v] of Object.entries(SAMPLE)) {
    assert.deepEqual(record[k], v, `field ${k} changed in round-trip`);
  }
  assert.equal(record.body, SAMPLE.body);
});

test("round-trip is stable (serialize(parse(x)) === x)", () => {
  const text = recordToText(SAMPLE);
  const again = serializeRecord(parseRecord(text).record);
  assert.equal(again, text);
});

test("numeric proof fields become numbers", () => {
  const { record } = parseRecord(recordToText(SAMPLE));
  assert.equal(typeof record["proof.checkpoint_seq"], "number");
  assert.equal(record["proof.checkpoint_seq"], 341600000);
  assert.equal(typeof record["proof.object_version"], "string");
});

test("missing required field is rejected (fail closed)", () => {
  for (const field of ["claim", "class", "subject", "predicate", "state", "epoch"]) {
    const broken = { ...SAMPLE };
    delete broken[field];
    assert.throws(() => recordToText(broken), SchemaError, `expected rejection when ${field} is missing`);
  }
});

test("unknown schema / class / state are rejected", () => {
  assert.throws(() => recordToText({ ...SAMPLE, schema: "FR-v2" }), SchemaError);
  assert.throws(() => recordToText({ ...SAMPLE, class: "MEDIUM" }), SchemaError);
  assert.throws(() => recordToText({ ...SAMPLE, state: "deleted" }), SchemaError);
});

test("empty body is rejected", () => {
  assert.throws(() => recordToText({ ...SAMPLE, body: "   " }), SchemaError);
});

test("non-numeric checkpoint is rejected", () => {
  assert.throws(() => recordToText({ ...SAMPLE, "proof.checkpoint_seq": "not-a-number" }), SchemaError);
});

test("tryParseRecord returns null instead of throwing", () => {
  assert.equal(tryParseRecord("not a record at all"), null);
  assert.ok(tryParseRecord(recordToText(SAMPLE)));
});

test("extra fields are preserved verbatim", () => {
  const text = recordToText({ ...SAMPLE, "custom.field": "keep-me" });
  const { record } = parseRecord(text);
  assert.equal(record["custom.field"], "keep-me");
});
