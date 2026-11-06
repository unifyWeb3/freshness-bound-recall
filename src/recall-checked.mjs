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
import { selectRecordedRevisionLifecycle } from "./recorded-lifecycle.mjs";
import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";

export const RECALL_CHECKED_SCHEMA = "recall_checked/v1";
export const RECALL_CHECKED_LIFECYCLE_SCHEMA = "recall_checked_lifecycle/v1";
export const DEFAULT_SAMPLE_QUERY = "Is the Sui Clock object still at the recorded version?";
export const DEFAULT_LIFECYCLE_QUERY = "Is the recorded Sui Clock correction still current?";
export const RECORDED_SAMPLE_NAME = "sui-clock-changed";
export const RECORDED_LIFECYCLE_SAMPLE_NAME = "sui-clock-revision-lifecycle";
export const AVAILABLE_RECORDED_SAMPLES = Object.freeze([
  RECORDED_SAMPLE_NAME,
  RECORDED_LIFECYCLE_SAMPLE_NAME,
]);

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
  constructor({ claim, policies = [] }) {
    this.claim = claim;
    this.policies = policies;
    this.kind = "recorded-mainnet";
    this.writeAttempts = 0;
  }

  async recall({ query = "" } = {}) {
    if (query === "FR-v1 policy window checkpoints claim class") {
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

function unknownSample(sample) {
  return new Error(`unknown sample "${sample}"; available: ${AVAILABLE_RECORDED_SAMPLES.join(", ")}`);
}

function policiesAvailableAt(evidence, cutoff = null) {
  const policies = (evidence.memories || []).filter((memory) => memory.state === "policy");
  if (cutoff === null) return policies;
  return policies.filter((memory) => Number.isFinite(Date.parse(memory.created_at)) && Date.parse(memory.created_at) <= cutoff);
}

async function replayRecordedClaim({
  evidence,
  claim,
  checkpoint,
  subject,
  query,
  now,
  source,
  policyCutoff = null,
}) {
  const store = new RecordedSnapshotStore({
    claim,
    policies: policiesAvailableAt(evidence, policyCutoff),
  });
  const tatum = new RecordedSnapshotTatum({ checkpoint, subject });
  const policy = new PolicyEngine({ store });
  const result = await recallChecked(query, {
    store,
    tatum,
    policy,
    now,
    allowWrites: false,
    mode: "recorded-mainnet",
    source,
  });
  if (store.writeAttempts !== 0 || result.writes.length !== 0) {
    throw new Error("read-only sample attempted a write");
  }
  return result;
}

function memoryEvidence(memory) {
  return {
    blob_id: memory.blob_id ?? null,
    claim: memory.claim ?? null,
    state: memory.state ?? null,
    class: memory.class ?? null,
    subject: memory.subject ?? null,
    predicate: memory.predicate ?? null,
    value_at_write: memory.value_at_write ?? null,
    proof: {
      chain_id: memory.proof?.chain_id ?? null,
      checkpoint_seq: memory.proof?.checkpoint_seq ?? null,
      checkpoint_digest: memory.proof?.checkpoint_digest ?? null,
      object_version: memory.proof?.object_version ?? null,
      object_digest: memory.proof?.object_digest ?? null,
      read_at: memory.proof?.read_at ?? null,
    },
    recorded_at: memory.recorded_at ?? null,
    created_at: memory.created_at ?? null,
  };
}

function recordedTriggerEvidence(trigger, predecessor) {
  return {
    decision_kind: "recorded-mainnet-decision",
    at: trigger.at ?? null,
    round: trigger.round ?? null,
    verdict: trigger.verdict ?? null,
    withheld: trigger.verdict !== "FRESH",
    signal: trigger.signal ?? null,
    reason: trigger.reason ?? null,
    memory: {
      claim: trigger.memory?.claim ?? null,
      blob_id_at_decision: trigger.memory?.blob_id ?? null,
      resolved_blob_id: predecessor.blob_id ?? null,
    },
    verification: {
      checkpoint: {
        checkpoint_seq: trigger.live?.checkpoint_seq ?? null,
        checkpoint_digest: trigger.live?.checkpoint_digest ?? null,
        read_at: trigger.live?.read_at ?? null,
      },
      subject: {
        version: trigger.pin?.version ?? null,
        digest: trigger.pin?.digest ?? null,
        read_at: trigger.pin?.read_at ?? null,
      },
      subject_changed: true,
      reads: {
        checkpoint: trigger.reads?.checkpoint ?? 0,
        pin: trigger.reads?.pin ?? 0,
        budget_max: trigger.reads?.budget_max ?? null,
      },
    },
  };
}

function checkpointFromProof(proof) {
  return {
    checkpointSeq: Number(proof.checkpoint_seq),
    checkpointDigest: proof.checkpoint_digest,
    checkpointTimestamp: null,
    readAt: proof.read_at,
  };
}

function subjectFromProof(memory) {
  return {
    subject: { address: memory.subject },
    pin: {
      version: String(memory.proof.object_version),
      digest: memory.proof.object_digest,
      readAt: memory.proof.read_at,
    },
  };
}

function checkpointFromEvent(event) {
  return {
    checkpointSeq: Number(event.live.checkpoint_seq),
    checkpointDigest: event.live.checkpoint_digest,
    checkpointTimestamp: null,
    readAt: event.live.read_at,
  };
}

function subjectFromEvent(event, address) {
  return {
    subject: { address },
    pin: {
      version: String(event.pin.version),
      digest: event.pin.digest,
      readAt: event.pin.read_at,
    },
  };
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
    throw unknownSample(sample);
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
  return replayRecordedClaim({
    evidence,
    claim,
    checkpoint: evidence.checkpoint,
    subject,
    query,
    now: Date.parse(evidence.generated_at),
    source: {
      sample,
      evidence_file: "docs/evidence/proof-snapshot.json",
      generated_at: evidence.generated_at,
      network_access: false,
      actual_walrus_blob_id: claim.blob_id,
    },
  });
}

/**
 * Replay one real Mainnet revision from its stale predecessor through the
 * correction's first later proof-equivalent check. No network or write occurs.
 */
export async function recallCheckedLifecycleSample({
  query = DEFAULT_LIFECYCLE_QUERY,
  sample = RECORDED_LIFECYCLE_SAMPLE_NAME,
  snapshot = null,
} = {}) {
  if (sample !== RECORDED_LIFECYCLE_SAMPLE_NAME) throw unknownSample(sample);
  const evidence = snapshot || JSON.parse(readFileSync(SNAPSHOT_URL, "utf8"));
  const lifecycle = selectRecordedRevisionLifecycle(evidence);
  const { correction, predecessor, trigger, laterEvent } = lifecycle;

  const revisionAt = Date.parse(correction.proof.read_at);
  const persistedAt = Date.parse(correction.created_at);
  const atRevisionProof = await replayRecordedClaim({
    evidence,
    claim: correction,
    checkpoint: checkpointFromProof(correction.proof),
    subject: subjectFromProof(correction),
    query,
    now: revisionAt,
    policyCutoff: revisionAt,
    source: {
      sample,
      stage: "at_revision_proof",
      evidence: "deterministic replay at the correction's recorded proof time",
      network_access: false,
      actual_walrus_blob_id: correction.blob_id,
    },
  });

  const laterAt = Date.parse(laterEvent.at);
  const subsequent = await replayRecordedClaim({
    evidence,
    claim: correction,
    checkpoint: checkpointFromEvent(laterEvent),
    subject: subjectFromEvent(laterEvent, correction.subject),
    query,
    now: laterAt,
    policyCutoff: laterAt,
    source: {
      sample,
      stage: "first_post_persistence_check",
      evidence: "deterministic replay over a later recorded proof-equivalent check",
      network_access: false,
      actual_walrus_blob_id: correction.blob_id,
      recorded_event_at: laterEvent.at,
      proof_equivalent_memory_blob_id: laterEvent.memory?.blob_id ?? null,
    },
  });

  if (atRevisionProof.verdict !== "FRESH" || atRevisionProof.withheld) {
    throw new Error("recorded lifecycle: correction was not fresh at its revision proof");
  }
  if (subsequent.verdict !== "STALE" || !subsequent.withheld || subsequent.verification.subject_changed !== true) {
    throw new Error("recorded lifecycle: correction was not withheld at the later check");
  }

  return {
    schema: RECALL_CHECKED_LIFECYCLE_SCHEMA,
    mode: "recorded-mainnet",
    read_only: true,
    source: {
      sample,
      evidence_file: "docs/evidence/proof-snapshot.json",
      generated_at: evidence.generated_at ?? null,
      network_access: false,
      decision_kind: "one recorded trigger plus deterministic replays of recorded Mainnet evidence",
      actual_walrus_blob_ids: {
        predecessor: predecessor.blob_id,
        correction: correction.blob_id,
        later_proof_equivalent_memory: laterEvent.memory?.blob_id ?? null,
      },
    },
    query,
    subject: {
      class: correction.class,
      address: correction.subject,
      predicate: correction.predicate,
    },
    revision: {
      predecessor: memoryEvidence(predecessor),
      trigger: recordedTriggerEvidence(trigger, predecessor),
      correction: {
        ...memoryEvidence(correction),
        persisted_at: correction.created_at,
        persistence_delay_ms: persistedAt - revisionAt,
        supersedes: {
          stored_reference: lifecycle.storedReference,
          stored_reference_kind: lifecycle.storedReferenceKind,
          resolved_blob_id: lifecycle.resolvedBlobId,
          resolved_claim: predecessor.claim,
        },
      },
    },
    behavior: {
      sequence: [trigger.verdict, atRevisionProof.verdict, subsequent.verdict],
      before_revision: recordedTriggerEvidence(trigger, predecessor),
      at_revision_proof: {
        decision_kind: "deterministic-replay-at-correction-proof",
        result: atRevisionProof,
      },
      first_post_persistence_check: {
        decision_kind: "deterministic-replay-over-first-post-persistence-check",
        recorded_event: {
          at: laterEvent.at,
          round: laterEvent.round ?? null,
          milliseconds_after_persistence: laterAt - persistedAt,
          actually_recalled_correction_blob: lifecycle.laterEventActuallyRecalledCorrection,
          proof_equivalent_memory_blob_id: laterEvent.memory?.blob_id ?? null,
          proof_equivalent_memory_claim: laterEvent.memory?.claim ?? null,
          note: lifecycle.laterEventActuallyRecalledCorrection
            ? "the recorded event recalled the correction blob"
            : "the recorded event recalled a proof-equivalent observation, not the correction blob",
        },
        result: subsequent,
      },
    },
    writes: [],
  };
}
