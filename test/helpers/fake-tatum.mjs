// Fake Tatum transport for offline tests: deterministic, no network.
// Supports: 429 injection, timeout injection, scripted object versions,
// and a per-call call counter so the read budget can be asserted.

export class FakeTatum {
  constructor({
    checkpoint = { sequenceNumber: 1000, digest: "cpDigest0", timestamp: "2026-11-05T00:00:00.000Z" },
    objects = {},
    fail429Times = 0,
    failTimeoutTimes = 0,
    failCheckpoint = false,
    failObject = false,
    offline = false,
  } = {}) {
    this.checkpoint = checkpoint;
    this.objects = objects;
    this.fail429Times = fail429Times;
    this.failTimeoutTimes = failTimeoutTimes;
    this.failCheckpoint = failCheckpoint;
    this.failObject = failObject;
    this.offline = offline;
    this.calls = [];
    this.networkCalls = 0;
    this.checkpointCache = null;
    this.lastPlan = "free;ratelimit=3;strategy=shared";
    this.log = [];
    this.callCount = 0;
  }

  createBudget(max = 2) {
    const self = this;
    let used = 0;
    return {
      max,
      take(kind) {
        if (used >= max) throw new Error(`read budget exhausted (${used}/${max})`);
        used += 1;
        self.calls.push({ kind, network: true });
        return true;
      },
      remaining() { return max - used; },
    };
  }

  async readCheckpoint({ budget = null, now = Date.now() } = {}) {
    if (this.checkpointCache && now - this.checkpointCache.at < 1000) {
      return { ...this.checkpointCache.value, source: "cache", cache_age_ms: now - this.checkpointCache.at };
    }
    if (this.offline) throw Object.assign(new Error("offline mode and no cached checkpoint"), { kind: "offline" });
    if (budget) budget.take("checkpoint");
    this.networkCalls += 1;
    this.callCount += 1;
    if (this.fail429Times > 0) {
      this.fail429Times -= 1;
      this.calls.push({ kind: "checkpoint", network: true, result: "429" });
      throw Object.assign(new Error("429 rate limited"), { kind: "rate_limit" });
    }
    if (this.failTimeoutTimes > 0) {
      this.failTimeoutTimes -= 1;
      this.calls.push({ kind: "checkpoint", network: true, result: "timeout" });
      throw Object.assign(new Error("timeout"), { kind: "timeout" });
    }
    if (this.failCheckpoint) throw Object.assign(new Error("checkpoint read failed"), { kind: "network" });
    const value = {
      checkpointSeq: this.checkpoint.sequenceNumber,
      checkpointDigest: this.checkpoint.digest,
      checkpointTimestamp: this.checkpoint.timestamp,
      readAt: new Date().toISOString(),
      source: "live",
      cache_age_ms: 0,
    };
    this.checkpointCache = { at: now, value };
    this.calls.push({ kind: "checkpoint", network: true, result: "ok" });
    return value;
  }

  async readObject(address, { budget = null } = {}) {
    if (budget) budget.take("pin");
    this.networkCalls += 1;
    this.callCount += 1;
    if (this.fail429Times > 0) {
      this.fail429Times -= 1;
      this.calls.push({ kind: "pin", network: true, result: "429" });
      throw Object.assign(new Error("429 rate limited"), { kind: "rate_limit" });
    }
    if (this.failTimeoutTimes > 0) {
      this.failTimeoutTimes -= 1;
      this.calls.push({ kind: "pin", network: true, result: "timeout" });
      throw Object.assign(new Error("timeout"), { kind: "timeout" });
    }
    if (this.failObject) throw Object.assign(new Error("object read failed"), { kind: "network" });
    const o = this.objects[address];
    if (!o) throw Object.assign(new Error(`object ${address} not found`), { kind: "http" });
    this.calls.push({ kind: "pin", network: true, result: "ok" });
    return { version: String(o.version), digest: o.digest, address, readAt: new Date().toISOString(), source: "live" };
  }

  setCheckpoint(seq, digest = `cpDigest${seq}`) {
    this.checkpoint = { sequenceNumber: seq, digest, timestamp: "2026-11-05T00:00:00.000Z" };
  }

  setObject(address, version, digest = `objDigest${version}`) {
    this.objects[address] = { version, digest };
  }

  requestLog() { return this.log.map((e) => ({ ...e })); }
}
