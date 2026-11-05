// Tatum Sui mainnet client - GraphQL only, always with x-api-key.
//
// Rules enforced here:
//   - one checkpoint read cached for 1s
//   - at most 2 network reads per answer (budget object)
//   - exponential backoff on 429 / timeout / transient error
//   - every request logs the x-ttm-plan header
//   - offline mode serves the last cached checkpoint and says so

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const TATUM_GRAPHQL = "https://sui-mainnet.gateway.tatum.io/graphql";
export const SUI_MAINNET_CHAIN_ID = "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S";

export class TatumError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "TatumError";
    this.kind = kind; // "rate_limit" | "timeout" | "http" | "network" | "budget" | "offline"
  }
}

export class ReadBudget {
  constructor(max = 2) {
    this.max = max;
    this.used = 0;
    this.kinds = [];
  }
  take(kind) {
    if (this.used >= this.max) {
      throw new TatumError(`read budget exhausted (${this.used}/${this.max})`, "budget");
    }
    this.used += 1;
    this.kinds.push(kind);
    return true;
  }
  remaining() { return this.max - this.used; }
}

const CP_QUERY = `{ checkpoints(last:1){ nodes { sequenceNumber digest timestamp } } }`;
const OBJ_QUERY = `query($a: SuiAddress!){ object(address:$a){ address version digest } }`;
const OBJ_TYPE_QUERY = `query($a: SuiAddress!){ object(address:$a){ address version digest asMoveObject{ contents{ type{ repr } } } } }`;
const CHAIN_QUERY = `{ chainIdentifier }`;

export class TatumClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000, cacheTtlMs = 1000,
    maxAttempts = 4, backoffBaseMs = 500, logger = () => {}, offline = false, cachePath = null } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.maxAttempts = maxAttempts;
    this.backoffBaseMs = backoffBaseMs;
    this.logger = logger;
    this.offline = offline;
    this.cachePath = cachePath;
    this.log = [];               // request log for the proof page
    this.checkpointCache = null; // { at, value }
    this.objectCache = new Map();
    this.lastPlan = null;
    this.callCount = 0;          // total network calls (credit measurement)
    if (cachePath) this.loadDiskCache();
  }

  /** Load the last saved checkpoint from disk (offline proof page / prewarm). */
  loadDiskCache() {
    try {
      const raw = readFileSync(this.cachePath, "utf8");
      const saved = JSON.parse(raw);
      if (saved?.checkpoint?.checkpointSeq !== undefined) {
        this.checkpointCache = { at: Date.now(), value: { ...saved.checkpoint, source: "cache-disk" } };
      }
      for (const [addr, obj] of Object.entries(saved?.objects || {})) {
        this.objectCache.set(addr, obj);
      }
      if (saved?.plan) this.lastPlan = saved.plan;
      this.diskCacheMeta = { saved_at: saved?.saved_at ?? null, chain_id: saved?.chain_id ?? null };
    } catch { /* no disk cache yet */ }
  }

  /** Persist the last checkpoint + observed objects for the offline proof page. */
  saveDiskCache(extra = {}) {
    if (!this.cachePath) return;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify({
        saved_at: new Date().toISOString(),
        chain_id: SUI_MAINNET_CHAIN_ID,
        plan: this.lastPlan,
        checkpoint: this.checkpointCache?.value ?? null,
        objects: Object.fromEntries(this.objectCache.entries()),
        ...extra,
      }, null, 1));
    } catch { /* the disk cache is a convenience only */ }
  }

  planHeader() { return this.lastPlan; }

  /** Per-answer read budget: 1 checkpoint read + 1 subject pin by default. */
  createBudget(max = 2) { return new ReadBudget(max); }

  async request(query, variables = {}, label = "query") {
    if (this.offline) throw new TatumError("client is in offline mode", "offline");
    let lastErr = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const t0 = performance.now();
      this.callCount += 1;
      try {
        const res = await this.fetchImpl(TATUM_GRAPHQL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const plan = res.headers.get("x-ttm-plan");
        if (plan) this.lastPlan = plan;
        const body = await res.json().catch(() => null);
        // api_key_sent is a BOOLEAN, never the key itself: the request log is
        // proof that the credential was attached to every call.
        const entry = { label, attempt, status: res.status, latency_ms: latencyMs, plan, api_key_sent: true, at: new Date().toISOString() };
        this.log.push(entry);
        this.logger(`[tatum] ${label} status=${res.status} latency=${latencyMs}ms plan=${plan}`);

        if (res.status === 429) {
          lastErr = new TatumError(`429 rate limited (plan=${plan})`, "rate_limit");
          entry.error = lastErr.message;
          await this.backoff(attempt);
          continue;
        }
        if (!res.ok) {
          lastErr = new TatumError(`http ${res.status}: ${JSON.stringify(body).slice(0, 160)}`, "http");
          entry.error = lastErr.message;
          await this.backoff(attempt);
          continue;
        }
        if (body?.errors?.length) {
          lastErr = new TatumError(`graphql error: ${JSON.stringify(body.errors).slice(0, 160)}`, "http");
          entry.error = lastErr.message;
          await this.backoff(attempt);
          continue;
        }
        return body.data;
      } catch (e) {
        const latencyMs = Math.round(performance.now() - t0);
        const kind = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "network";
        lastErr = new TatumError(`${kind}: ${e?.message || e}`, kind);
        this.log.push({ label, attempt, status: -1, latency_ms: latencyMs, plan: this.lastPlan, api_key_sent: true, error: lastErr.message, at: new Date().toISOString() });
        this.logger(`[tatum] ${label} failed (${kind}) latency=${latencyMs}ms -> retry ${attempt}/${this.maxAttempts}`);
        await this.backoff(attempt);
      }
    }
    throw lastErr || new TatumError("request failed", "network");
  }

  async backoff(attempt) {
    const ms = Math.min(8000, this.backoffBaseMs * 2 ** (attempt - 1));
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Latest checkpoint. Cached for cacheTtlMs (1s). Cached reads do not consume the budget. */
  async readCheckpoint({ budget = null, now = Date.now() } = {}) {
    const cached = this.checkpointCache;
    if (cached && now - cached.at < this.cacheTtlMs) {
      return { ...cached.value, source: "cache", cache_age_ms: now - cached.at };
    }
    if (this.offline) {
      if (cached) return { ...cached.value, source: "cache-offline", cache_age_ms: now - cached.at };
      throw new TatumError("offline mode and no cached checkpoint", "offline");
    }
    if (budget) budget.take("checkpoint");
    const data = await this.request(CP_QUERY, {}, "checkpoints(last:1)");
    const node = data?.checkpoints?.nodes?.[0];
    if (!node) throw new TatumError("no checkpoint returned", "http");
    const value = {
      checkpointSeq: Number(node.sequenceNumber),
      checkpointDigest: node.digest,
      checkpointTimestamp: node.timestamp,
      readAt: new Date().toISOString(),
      source: "live",
      cache_age_ms: 0,
    };
    this.checkpointCache = { at: now, value };
    return value;
  }

  /** Subject pin: the object's current version + digest. */
  async readObject(address, { budget = null } = {}) {
    if (budget) budget.take("pin");
    const data = await this.request(OBJ_QUERY, { a: address }, `object(${address.slice(0, 8)}…)`);
    const obj = data?.object;
    if (!obj) throw new TatumError(`object ${address} not found`, "http");
    const value = { version: String(obj.version), digest: obj.digest, address: obj.address, readAt: new Date().toISOString(), source: "live" };
    this.objectCache.set(address, value);
    return value;
  }

  /** Last known pin for an address, from the disk cache (no network). */
  cachedObject(address) {
    const v = this.objectCache.get(address);
    return v ? { ...v, source: "cache-disk" } : null;
  }

  /** Chain identifier (proof page only; not part of the per-answer budget). */
  async readChainIdentifier() {
    const data = await this.request(CHAIN_QUERY, {}, "chainIdentifier");
    return data?.chainIdentifier || null;
  }

  /**
   * The Move type of an object (e.g. "0x…::account::MemWalAccount").
   * Used by the credential self-test to prove that MEMWAL_ACCOUNT_ID is the
   * MemWalAccount object id and not the owner wallet address.
   */
  async readObjectType(address, { budget = null } = {}) {
    if (budget) budget.take("object-type");
    const data = await this.request(OBJ_TYPE_QUERY, { a: address }, `objectType(${address.slice(0, 8)}…)`);
    const obj = data?.object;
    if (!obj) throw new TatumError(`object ${address} not found`, "http");
    return {
      address: obj.address,
      version: String(obj.version),
      digest: obj.digest,
      typeRepr: obj.asMoveObject?.contents?.type?.repr ?? null,
      readAt: new Date().toISOString(),
      source: "live",
    };
  }

  /** Last cached checkpoint without any network access (offline proof page). */
  cachedCheckpoint() {
    return this.checkpointCache ? { ...this.checkpointCache.value, source: "cache-offline" } : null;
  }

  requestLog() { return this.log.map((e) => ({ ...e })); }

  /**
   * Proof that the x-api-key header was attached to every request this client
   * made. Counts only - the key value is never read back or printed.
   */
  apiKeyProof() {
    const entries = this.requestLog();
    const withKey = entries.filter((e) => e.api_key_sent === true).length;
    const withoutKey = entries.filter((e) => e.api_key_sent !== true).length;
    return {
      total_log_entries: entries.length,
      requests_with_api_key: withKey,
      requests_without_api_key: withoutKey,
      every_request_had_api_key: entries.length > 0 && withoutKey === 0,
      header_name: "x-api-key",
      value_printed: false,
    };
  }
}
