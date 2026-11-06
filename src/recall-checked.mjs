// Public, side-effect-minimal contract for freshness-checked recall.
//
// `recallChecked()` is dependency-injected so applications can provide their
// own Walrus Memory store and Tatum transport. Writes are disabled unless the
// caller explicitly passes `allowWrites: true`.
//
// `recallCheckedSample()` runs the same answer path over the committed,
// labelled Mainnet evidence snapshot. It performs no network calls, needs no
// wallet or API key, and never writes a memory.

import { readFileSync } from "node:fs";
import { answer } from "./answer.mjs";
import { PolicyEngine } from "./policy.mjs";
import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";

export const RECALL_CHECKED_SCHEMA = "recall_checked/v1";
export const DEFAULT_SAMPLE_QUERY = "Is the Sui Clock object still at the recorded version?";
export const RECORDED_SAMPLE_NAME = "sui-clock-changed";

const SNAPSHOT_URL = new URL("../docs/evidence/proof-snapshot.json", import.meta.url);

function asRecord(memory) {
  const policy = memory.policy || {};
  return {
    schema: "FR-v1",
    claim: memory.claim,
    class: memory.class,
    epoch: 1,
    state: memory.state,
    subject: memory.subject,
    predicate: memory.predicate,
    value_at_write: memory.value_at_write,
    "proof.transport": memory.proof?.transport,
    "proof.chain_id": memory.proof?.chain_id,
    "proof.checkpoint_seq": memory.proof?.checkpoint_seq,
    "proof.checkpoint_digest": memory.proof?.checkpoint_digest,
    "proof.object_version": memory.proof?.object_version,
    "proof.object_digest": memory.proof?.object_digest,
    "proof.read_at": memory.proof?.read_at,
    "policy.class": policy.class,
    "policy.window_checkpoints": policy.window,
    "policy.min_checkpoints": policy.min,
    "policy.max_checkpoints": policy.max,
    "policy.false_stale": policy.false_stale,
    "policy.missed_change": policy.missed_change,
    "policy.samples": policy.samples,
    "policy.version": policy.version,
    "policy.reason": policy.reason,
    supersedes: memory.supersedes,
    recorded_at: memory.recorded_at,
    body: memory.body,
  };
}

function hit(memory) {
  return {
    blob_id: memory.blob_id,
    text: JSON.stringify(asRecord(memory)),
    distance: memory.distance,
    created_at: memory.created_at,
  };
}

class RecordedSnapshotStore {
  constructor({ claim, policies }) {
    this.claim = claim;
    this.policies = policies;
    this.kind = "recorded-mainnet";
    this.writeAttempts = 0;
  }

  async recall({ query = "" } = {}) {
    if (/policy\s+window|claim\s+class/i.test(query)) {
      return { results: this.policies.map(hit), total: this.policies.length };
    }
    return { results: [hit(this.claim)], total: 1 };
  }

  parse(text) {
    try {
      return { record: JSON.parse(text) };
    } catch {
      return null;
    }
  }

  async remember() {
    this.writeAttempts += 1;
    throw new Error("the recorded Mainnet sample is read-only");
  }

  async waitFor() {
    throw new Error("the recorded Mainnet sample is read-only");
  }
}

class RecordedSnapshotTatum {
  constructor({ checkpoint, subject }) {
    this.checkpoint = checkpoint;
    this.subject = subject;
    this.lastPlan = "recorded-mainnet-evidence";
  }

  createBudget(max = 2) {
    let used = 0;
    return {
      max,
      take(kind) {
        if (used >= max) throw new Error(`read budget exhausted before ${kind} (${used}/${max})`);
        used += 1;
      },
      remaining() { return max - used; },
    };
  }

  async readCheckpoint({ budget = null } = {}) {
    budget?.take("checkpoint");
    return {
      checkpointSeq: Number(this.checkpoint.checkpointSeq),
      checkpointDigest: this.checkpoint.checkpointDigest,
      checkpointTimestamp: this.checkpoint.checkpointTimestamp,
      readAt: this.checkpoint.readAt,
      source: "recorded-mainnet",
      cache_age_ms: 0,
    };
  }

  async readObject(address, { budget = null } = {}) {
    budget?.take("pin");
    if (address !== this.subject.subject.address) {
      throw Object.assign(new Error(`recorded sample has no object ${address}`), { kind: "offline" });
    }
    return {
      version: String(this.subject.pin.version),
      digest: this.subject.pin.digest,
      address,
      readAt: this.subject.pin.readAt,
      source: "recorded-mainnet",
    };
  }

  planHeader() { return this.lastPlan; }
}

function formatResult(decision, { mode, readOnly, source = null } = {}) {
  const reads = decision.reads || {};
  return {
    schema: RECALL_CHECKED_SCHEMA,
    mode,
    read_only: readOnly,
    source,
    query: decision.query,
    at: decision.at,
    verdict: decision.verdict,
    withheld: decision.withheld,
    answer: decision.answer,
    reason: decision.reason,
    signal: decision.signal,
    memory: decision.memory,
    verification: {
      checkpoint: decision.live ?? null,
      subject: decision.pin ?? null,
      subject_changed: decision.subject_changed ?? null,
      reads: {
        checkpoint: reads.checkpoint ?? 0,
        pin: reads.pin ?? 0,
        budget_max: reads.budget_max ?? null,
      },
    },
    policy: decision.policy ?? null,
    writes: decision.writes || [],
  };
}

/**
 * Recall a memory, check it through the supplied Tatum transport, and return a
 * stable JSON-shaped result. The default can never write a Walrus memory.
 */
export async function recallChecked(query, {
  store,
  tatum,
  policy = null,
  ledger = null,
  now = Date.now(),
  epoch = 1,
  agentId = "",
  chainId = SUI_MAINNET_CHAIN_ID,
  allowWrites = false,
  readBudget = 2,
  logger = () => {},
  mode = "custom",
  source = null,
} = {}) {
  if (typeof query !== "string" || !query.trim()) throw new TypeError("query must be a non-empty string");
  if (!store || typeof store.recall !== "function") throw new TypeError("store.recall is required");
  if (!tatum || typeof tatum.readCheckpoint !== "function" || typeof tatum.readObject !== "function") {
    throw new TypeError("tatum.readCheckpoint and tatum.readObject are required");
  }
  const engine = policy || new PolicyEngine({ store });
  const decision = await answer(query, {
    store,
    tatum,
    policy: engine,
    ledger,
    now,
    epoch,
    agentId,
    chainId,
    writeCorrections: allowWrites === true,
    readBudget,
    logger,
  });
  return formatResult(decision, { mode, readOnly: allowWrites !== true, source });
}

/** Run the built-in, labelled Mainnet recording without network or credentials. */
export async function recallCheckedSample({
  query = DEFAULT_SAMPLE_QUERY,
  sample = RECORDED_SAMPLE_NAME,
  snapshot = null,
} = {}) {
  if (sample !== RECORDED_SAMPLE_NAME) {
    throw new Error(`unknown sample "${sample}"; available: ${RECORDED_SAMPLE_NAME}`);
  }
  const evidence = snapshot || JSON.parse(readFileSync(SNAPSHOT_URL, "utf8"));
  const subject = evidence.subjects?.FAST;
  if (!subject?.subject?.address || !subject?.pin) throw new Error("recorded sample is missing the FAST subject pin");

  const candidates = (evidence.memories || [])
    .filter((memory) => memory.state === "live" && memory.class === "FAST" && memory.subject === subject.subject.address)
    .sort((a, b) => Number(b.proof?.checkpoint_seq || 0) - Number(a.proof?.checkpoint_seq || 0));
  // Prefer a real correction over a smoke-test seed: it proves this value was
  // previously carried forward through Walrus lineage, then became stale too.
  const claim = candidates.find((memory) => memory.claim?.startsWith("cor-sui-clock-")) || candidates[0];
  if (!claim) throw new Error("recorded sample contains no answerable FAST claim");
  const policies = (evidence.memories || []).filter((memory) => memory.state === "policy");
  const store = new RecordedSnapshotStore({ claim, policies });
  const tatum = new RecordedSnapshotTatum({ checkpoint: evidence.checkpoint, subject });
  const policy = new PolicyEngine({ store });

  const result = await recallChecked(query, {
    store,
    tatum,
    policy,
    now: Date.parse(evidence.generated_at),
    allowWrites: false,
    mode: "recorded-mainnet",
    source: {
      sample,
      evidence_file: "docs/evidence/proof-snapshot.json",
      generated_at: evidence.generated_at,
      network_access: false,
      actual_walrus_blob_id: claim.blob_id,
    },
  });
  if (store.writeAttempts !== 0 || result.writes.length !== 0) {
    throw new Error("read-only sample attempted a write");
  }
  return result;
}
