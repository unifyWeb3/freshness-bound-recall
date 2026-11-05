// Tatum Sui mainnet client - GraphQL only, always with x-api-key.
//
// Rules enforced here:
//   - one checkpoint read cached for 1s
//   - at most 2 network reads per answer (budget object)
//   - exponential backoff on 429 / timeout / transient error
//   - every request logs the x-ttm-plan header
//   - offline mode serves the last cached checkpoint and says so

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
const CHAIN_QUERY = `{ chainIdentifier }`;

export class TatumClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000, cacheTtlMs = 1000,
    maxAttempts = 4, backoffBaseMs = 500, logger = () => {}, offline = false } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.maxAttempts = maxAttempts;
    this.backoffBaseMs = backoffBaseMs;
    this.logger = logger;
    this.offline = offline;
    this.log = [];               // request log for the proof page
    this.checkpointCache = null; // { at, value }
    this.lastPlan = null;
    this.callCount = 0;          // total network calls (credit measurement)
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
        const entry = { label, attempt, status: res.status, latency_ms: latencyMs, plan, at: new Date().toISOString() };
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
        this.log.push({ label, attempt, status: -1, latency_ms: latencyMs, plan: this.lastPlan, error: lastErr.message, at: new Date().toISOString() });
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
    return { version: String(obj.version), digest: obj.digest, address: obj.address, readAt: new Date().toISOString(), source: "live" };
  }

  /** Chain identifier (proof page only; not part of the per-answer budget). */
  async readChainIdentifier() {
    const data = await this.request(CHAIN_QUERY, {}, "chainIdentifier");
    return data?.chainIdentifier || null;
  }

  /** Last cached checkpoint without any network access (offline proof page). */
  cachedCheckpoint() {
    return this.checkpointCache ? { ...this.checkpointCache.value, source: "cache-offline" } : null;
  }

  requestLog() { return this.log.map((e) => ({ ...e })); }
}
