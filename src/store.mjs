// Memory store: one interface, two backends.
//   MockStore - offline, deterministic (MemWalMock semantics, token-overlap ranking)
//   MemWalStore - mainnet Walrus Memory through the pinned SDK (@mysten-incubation/memwal)
//
// Both expose: remember / waitFor / recall / listMemories / health / parse.
// listMemories returns metadata only (no text) on the real backend, so policy
// memories are read back through recall().

import { MemWalMock } from "@mysten-incubation/memwal";
import { tryParseRecord } from "./schema.mjs";

export class MockStore {
  constructor({ namespace = "freshness-recall", initial = [] } = {}) {
    this.namespace = namespace;
    this.mock = MemWalMock.create({ namespace, initialMemories: initial.map((t) => ({ text: t, namespace })) });
    this.kind = "mock";
    this.written = [];
  }
  async health() { return this.mock.health(); }
  async remember(text) {
    const acc = await this.mock.remember(text, this.namespace);
    return { jobId: acc.job_id };
  }
  async waitFor(jobIds) {
    const res = await this.mock.waitForRememberJobs(Array.isArray(jobIds) ? jobIds : [jobIds], [this.namespace], { timeoutMs: 60000 });
    return (res.results || []).map((r) => ({ blob_id: r.blob_id, job_id: r.id, status: r.status }));
  }
  async recall({ query, limit = 10, sort } = {}) {
    // The mock supports the same `sort: "recent"` semantics as the relayer.
    const res = await this.mock.recall({ query, limit, ...(sort ? { sort } : {}) });
    const results = (res.results || []).map((r) => ({ blob_id: r.blob_id, text: r.text, distance: r.distance, created_at: r.created_at }));
    return { results, total: res.total };
  }
  async listMemories({ namespace } = {}) {
    const res = await this.mock.listNamespaces();
    const ns = (res.namespaces || []).find((n) => n.name === (namespace || this.namespace));
    return { memories: [], memory_count: ns?.memory_count ?? 0, namespaces: res.namespaces || [] };
  }
  parse(text) { return tryParseRecord(text); }
}

export class MemWalStore {
  constructor({ client, namespace = "freshness-recall" } = {}) {
    this.client = client;
    this.namespace = namespace;
    this.kind = "memwal";
  }
  async health() { return this.client.health(); }
  async remember(text) {
    const acc = await this.client.remember(text, this.namespace);
    return { jobId: acc.job_id ?? acc.jobId };
  }
  async waitFor(jobIds) {
    const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
    const res = await this.client.waitForRememberJobs(ids, [this.namespace], { timeoutMs: 180000 });
    return (res.results || []).map((r) => ({ blob_id: r.blob_id, job_id: r.id, status: r.status }));
  }
  async recall({ query, limit = 10, sort } = {}) {
    const params = { query, limit };
    if (sort) params.sort = sort;
    const res = await this.client.recall(params);
    return {
      results: (res.results || []).map((r) => ({ blob_id: r.blob_id, text: r.text, distance: r.distance, created_at: r.created_at })),
      total: res.total,
    };
  }
  async listMemories({ namespace } = {}) {
    const res = await this.client.listMemories({ namespace: namespace || this.namespace });
    return { memories: res.memories || [], deleted: res.deleted || [], has_more: res.has_more, must_resync: res.must_resync };
  }
  async listNamespaces() {
    const res = await this.client.listNamespaces();
    return { namespaces: res.namespaces || [], has_more: res.has_more };
  }
  parse(text) { return tryParseRecord(text); }
}
