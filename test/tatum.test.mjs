import { test } from "node:test";
import assert from "node:assert/strict";
import { TatumClient, ReadBudget, TatumError, TATUM_GRAPHQL, SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

// A fetch stub that never touches the network.
function fakeFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, headers: init.headers });
    return responder(calls.length, url, init);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

const CP_BODY = { data: { checkpoints: { nodes: [{ sequenceNumber: 1000, digest: "cpDigest0", timestamp: "2026-11-05T00:00:00.000Z" }] } } };
const OBJ_BODY = { data: { object: { address: "0x6", version: "1018742782", digest: "objDigest1" } } };

test("every request sends x-api-key and the GraphQL endpoint", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY, { headers: { "x-ttm-plan": "free;ratelimit=3;strategy=shared" } }));
  const c = new TatumClient({ apiKey: "test-key-123", fetchImpl });
  await c.readCheckpoint();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, TATUM_GRAPHQL);
  assert.equal(fetchImpl.calls[0].headers["x-api-key"], "test-key-123");
  assert.equal(c.planHeader(), "free;ratelimit=3;strategy=shared");
});

test("the request log proves x-api-key was sent on every call, without exposing the key", async () => {
  const fetchImpl = fakeFetch((n, url, init) => {
    const body = String(init.body).includes("checkpoints") ? CP_BODY : OBJ_BODY;
    return jsonResponse(body, { headers: { "x-ttm-plan": "free;ratelimit=3;strategy=shared" } });
  });
  const c = new TatumClient({ apiKey: "test-key-123", fetchImpl });
  await c.readCheckpoint();
  await c.readObject("0x6");
  const proof = c.apiKeyProof();
  assert.equal(proof.total_log_entries, 2);
  assert.equal(proof.requests_with_api_key, 2);
  assert.equal(proof.requests_without_api_key, 0);
  assert.equal(proof.every_request_had_api_key, true);
  assert.equal(proof.header_name, "x-api-key");
  assert.equal(proof.value_printed, false);
  // the proof must never contain the key itself
  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes("test-key-123"), false);
  // every log entry carries the boolean flag
  for (const e of c.requestLog()) assert.equal(e.api_key_sent, true);
});

test("the checkpoint read is cached for 1 second and does not consume budget again", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY));
  const c = new TatumClient({ apiKey: "k", fetchImpl });
  const budget = new ReadBudget(2);
  const a = await c.readCheckpoint({ budget, now: 1_000_000 });
  const b = await c.readCheckpoint({ budget, now: 1_000_500 });
  assert.equal(a.source, "live");
  assert.equal(b.source, "cache");
  assert.equal(fetchImpl.calls.length, 1, "cached read must not hit the network");
  assert.equal(budget.used, 1);
});

test("a checkpoint read older than 1s goes back to the network", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY));
  const c = new TatumClient({ apiKey: "k", fetchImpl });
  await c.readCheckpoint({ now: 1_000_000 });
  await c.readCheckpoint({ now: 1_002_000 });
  assert.equal(fetchImpl.calls.length, 2);
});

test("the read budget refuses more than 2 reads per answer", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY));
  const c = new TatumClient({ apiKey: "k", fetchImpl });
  const budget = new ReadBudget(2);
  budget.take("checkpoint");
  budget.take("pin");
  assert.throws(() => budget.take("extra"), TatumError);
  assert.equal(budget.remaining(), 0);
});

test("429 triggers exponential backoff and a retry", async () => {
  let n = 0;
  const fetchImpl = fakeFetch(() => {
    n += 1;
    if (n === 1) return jsonResponse({ error: "rate limited" }, { status: 429, headers: { "x-ttm-plan": "free;ratelimit=3;strategy=shared" } });
    return jsonResponse(CP_BODY);
  });
  const c = new TatumClient({ apiKey: "k", fetchImpl, backoffBaseMs: 1 });
  const cp = await c.readCheckpoint();
  assert.equal(cp.checkpointSeq, 1000);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(c.requestLog().length, 2);
  assert.equal(c.requestLog()[0].status, 429);
});

test("a timeout is retried and then reported", async () => {
  const fetchImpl = fakeFetch(() => { throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }); });
  const c = new TatumClient({ apiKey: "k", fetchImpl, maxAttempts: 3, backoffBaseMs: 1 });
  await assert.rejects(() => c.readCheckpoint(), (e) => e instanceof TatumError && e.kind === "timeout");
  assert.equal(fetchImpl.calls.length, 3);
});

test("offline mode serves the cached checkpoint and labels it", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY));
  const c = new TatumClient({ apiKey: "k", fetchImpl });
  await c.readCheckpoint();
  c.offline = true;
  const cached = await c.readCheckpoint({ now: Date.now() + 60_000 });
  assert.equal(cached.source, "cache-offline");
  assert.equal(cached.checkpointSeq, 1000);
});

test("offline mode with no cache fails closed", async () => {
  const c = new TatumClient({ apiKey: "k", fetchImpl: fakeFetch(() => jsonResponse(CP_BODY)), offline: true });
  await assert.rejects(() => c.readCheckpoint(), (e) => e.kind === "offline");
});

test("the request log records latency, status and the plan header", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(CP_BODY, { headers: { "x-ttm-plan": "free;ratelimit=3;strategy=shared" } }));
  const c = new TatumClient({ apiKey: "k", fetchImpl });
  await c.readCheckpoint();
  const entry = c.requestLog()[0];
  assert.equal(entry.label, "checkpoints(last:1)");
  assert.equal(entry.status, 200);
  assert.equal(entry.plan, "free;ratelimit=3;strategy=shared");
  assert.equal(typeof entry.latency_ms, "number");
});

test("the mainnet chain id constant is the one Tatum returned", () => {
  assert.equal(SUI_MAINNET_CHAIN_ID, "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S");
});
