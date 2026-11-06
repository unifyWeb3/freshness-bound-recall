// The answer path: recall -> gate -> (withhold -> re-read -> supersede) -> policy update.
//
// No LLM anywhere in this path: every answer string is a template over verified data.

import { evaluateGate, VERDICT, SIGNAL } from "./gate.mjs";
import { recordToText } from "./schema.mjs";
import { policyRecordText } from "./policy.mjs";
import { SUBJECTS } from "./subjects.mjs";
import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";

const RECALL_LIMIT = 10;
// Only a claim is answerable. Observations are evidence, policy records are the
// learned window, and a superseded memory is history.
const ANSWERABLE_STATES = new Set(["live", "adversarial"]);
const DOMAIN_STOP_WORDS = new Set([
  "a", "an", "and", "at", "claim", "checkpoint", "fresh", "is", "mainnet", "memory",
  "object", "of", "on", "recorded", "shared", "still", "sui", "the", "version", "what",
]);
const REQUIRED_PROOF_FIELDS = [
  "proof.chain_id", "proof.checkpoint_seq", "proof.checkpoint_digest",
  "proof.object_version", "proof.object_digest", "proof.read_at",
];

function short(addr) { return String(addr || "").slice(0, 10) + "…"; }

function words(value) {
  return new Set((String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((word) => word.length >= 3 && !DOMAIN_STOP_WORDS.has(word)));
}

function requestedSubjects(query) {
  const normalized = String(query || "").toLowerCase();
  const queryWords = words(query);
  return new Set(SUBJECTS.filter((subject) => {
    if (normalized.includes(subject.address.toLowerCase())) return true;
    const aliases = words(`${subject.id} ${subject.class} ${subject.label}`);
    return [...aliases].some((word) => queryWords.has(word));
  }).map((subject) => subject.address.toLowerCase()));
}

function isValidCandidate(record, now) {
  if (!record || !ANSWERABLE_STATES.has(record.state)) return false;
  if (REQUIRED_PROOF_FIELDS.some((field) => record[field] === undefined || record[field] === null || record[field] === "")) return false;
  if (record["proof.chain_id"] !== SUI_MAINNET_CHAIN_ID) return false;
  const checkpoint = Number(record["proof.checkpoint_seq"]);
  const readAt = Date.parse(record["proof.read_at"]);
  return Number.isInteger(checkpoint) && checkpoint >= 0 && Number.isFinite(readAt) && readAt <= now;
}

export function renderFreshAnswer({ record, decision }) {
  const delta = decision.signals.window.delta;
  return `${record.subject} on Sui mainnet: ${record.value_at_write}. ` +
    `Memory ${record.claim} was written at checkpoint ${record["proof.checkpoint_seq"]} ` +
    `(${delta} checkpoints ago, window ${decision.window}); subject version/digest unchanged.`;
}

export function renderStaleAnswer({ record, decision, pin, live }) {
  if (decision.signals.pin.changed) {
    return `WITHHELD — ${decision.reason}. ` +
      `Live value from Tatum Sui mainnet: version=${pin.version} digest=${pin.digest} ` +
      `(checkpoint ${live.checkpointSeq}). The stored memory ${record.claim} was not used as the answer.`;
  }
  // FALSE-STALE: the subject did not change, the window was simply too tight.
  return `WITHHELD — ${decision.reason}. The subject is unchanged ` +
    `(version=${pin.version} digest=${pin.digest}), so the stored memory ${record.claim} is still true, ` +
    `but it is outside the current window of ${decision.window} checkpoints. ` +
    `Signal FALSE-STALE recorded: the policy engine will widen the window for class ${record.class}.`;
}

export function renderUnverifiedAnswer({ decision }) {
  return `WITHHELD — ${decision.reason}. No answer from memory: freshness could not be verified against Sui mainnet.`;
}

/**
 * Answer one query.
 *
 * @param {object} args
 * @param {string} args.query
 * @param {object} args.store      memory store (mock or mainnet)
 * @param {object} args.tatum      TatumClient
 * @param {object} args.policy     PolicyEngine
 * @param {object} args.ledger     Ledger
 * @param {boolean} args.writeCorrections  write the superseding memory + policy memory
 */
export async function answer(query, {
  store, tatum, policy, ledger, now = Date.now(), epoch = 1,
  agentId = "", chainId = "", writeCorrections = false, readBudget = 2, logger = () => {},
}) {
  // 1. policy memory is read at every answer
  await policy.load();

  // 2. recall
  const recalled = await store.recall({ query, limit: RECALL_LIMIT });
  const subjectFilter = requestedSubjects(query);
  const candidates = [];
  for (const [index, hit] of (recalled.results || []).entries()) {
    const parsed = store.parse ? store.parse(hit.text) : null;
    const rec = parsed?.record || parsed;
    if (!isValidCandidate(rec, now)) continue;
    if (subjectFilter.size && !subjectFilter.has(String(rec.subject).toLowerCase())) continue;
    candidates.push({ hit, record: rec, index });
  }
  // Preserve semantic relevance: the closest valid hit wins. Recall order is
  // the stable fallback when a backend omits distance or returns a tie.
  candidates.sort((a, b) => {
    const distanceA = Number(a.hit.distance);
    const distanceB = Number(b.hit.distance);
    const rankA = Number.isFinite(distanceA) ? distanceA : Number.POSITIVE_INFINITY;
    const rankB = Number.isFinite(distanceB) ? distanceB : Number.POSITIVE_INFINITY;
    return rankA - rankB || a.index - b.index;
  });

  if (!candidates.length) {
    const out = {
      query, at: new Date(now).toISOString(), answer: `No stored claim matched "${query}".`,
      withheld: true, verdict: VERDICT.WITHHELD_UNVERIFIED, reason: "no claim memory found",
      signal: SIGNAL.UNVERIFIED, memory: null, live: null, pin: null, subject_changed: null,
      policy: null, writes: [], reads: { checkpoint: 0, pin: 0, budget_max: readBudget },
    };
    ledger?.append(out);
    return out;
  }

  const { hit, record } = candidates[0];
  const classState = policy.state(record.class);
  const budget = tatum.createBudget ? tatum.createBudget(readBudget) : null;

  // 3. live reads (at most 2 network reads per answer)
  let live = null;
  let pin = null;
  let readError = null;
  try {
    live = await tatum.readCheckpoint({ budget, now });
  } catch (e) {
    readError = e;
  }
  if (live && !readError) {
    try {
      pin = await tatum.readObject(record.subject, { budget });
    } catch (e) {
      readError = e;
    }
  }

  // 4. gate
  const decision = evaluateGate({
    record, live, pin,
    policy: {
      windowCheckpoints: classState.windowCheckpoints,
      minCheckpoints: classState.minCheckpoints,
      maxCheckpoints: classState.maxCheckpoints,
      maxAgeSeconds: classState.maxAgeSeconds,
    },
    now,
  });
  if (readError && decision.verdict === VERDICT.WITHHELD_UNVERIFIED) {
    decision.reason = `${decision.reason} (${readError.kind || "error"}: ${readError.message})`;
  }

  // 5. learning signal -> policy (one policy memory per change)
  const before = { ...classState };
  const writes = [];
  const proposedPolicy = policy.preview(record.class, decision.signal, { now });
  let policyResult = proposedPolicy;

  if (!proposedPolicy.changed) {
    policy.commit(record.class, proposedPolicy);
  } else if (writeCorrections) {
    const ptext = policyRecordText(proposedPolicy.state, {
      now, epoch, chainId, agentId,
      checkpointSeq: live?.checkpointSeq,
      checkpointDigest: live?.checkpointDigest,
    });
    try {
      const { jobId } = await store.remember(ptext);
      const done = await store.waitFor(jobId);
      const blobId = done?.find((item) => item?.blob_id)?.blob_id ?? null;
      if (!blobId) throw new Error("policy write completed without a confirmed blob id");
      policy.commit(record.class, proposedPolicy);
      writes.push({ type: "policy", job_id: jobId, blob_id: blobId, text: ptext });
      logger(`[answer] policy changed for ${record.class}: ${proposedPolicy.reason}`);
    } catch (e) {
      policyResult = {
        ...proposedPolicy,
        state: before,
        changed: false,
        reason: `policy change not committed: ${e?.message || e}`,
      };
      writes.push({ type: "policy", error: String(e?.message || e) });
      logger(`[answer] policy write failed; in-memory state unchanged: ${e?.message || e}`);
    }
  } else {
    policyResult = {
      ...proposedPolicy,
      state: before,
      changed: false,
      reason: "policy change not committed: persistence disabled",
    };
  }

  let text;
  if (decision.verdict === VERDICT.FRESH) {
    text = renderFreshAnswer({ record, decision });
  } else if (decision.verdict === VERDICT.STALE) {
    text = renderStaleAnswer({ record, decision, pin, live });
  } else {
    text = renderUnverifiedAnswer({ decision });
  }

  // 6. superseding memory.
  //    Only when the subject actually changed: then the stored memory is wrong
  //    and a correction carries the truth forward.
  //    A FALSE-STALE (window expired, subject unchanged) must NOT write a
  //    correction - the memory is still true, the window was too tight. That
  //    case is handled by the policy engine (one policy memory per change).
  const subjectChanged = decision.signals.pin.changed === true;
  if (writeCorrections && decision.verdict === VERDICT.STALE && subjectChanged && pin) {
    const correction = recordToText({
      claim: `fc-${record.class.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      class: record.class,
      epoch,
      state: "live",
      subject: record.subject,
      predicate: record.predicate,
      value_at_write: `version=${pin.version} digest=${pin.digest}`,
      "proof.transport": "tatum-sui-mainnet/graphql",
      "proof.chain_id": chainId,
      "proof.checkpoint_seq": live.checkpointSeq,
      "proof.checkpoint_digest": live.checkpointDigest,
      "proof.object_version": pin.version,
      "proof.object_digest": pin.digest,
      "proof.read_at": pin.readAt,
      "policy.class": record.class,
      "policy.window_checkpoints": policyResult.state.windowCheckpoints,
      "policy.min_checkpoints": policyResult.state.minCheckpoints,
      "policy.max_checkpoints": policyResult.state.maxCheckpoints,
      supersedes: hit.blob_id,
      agent_id: agentId,
      "recorded_at": new Date(now).toISOString(),
      body: `Correction: ${record.subject} is now version=${pin.version} digest=${pin.digest} on Sui mainnet ` +
        `(checkpoint ${live.checkpointSeq}). This memory supersedes ${record.claim} (${hit.blob_id}), which was withheld as ${decision.reason}.`,
    });
    try {
      const { jobId } = await store.remember(correction);
      const done = await store.waitFor(jobId);
      writes.push({ type: "correction", job_id: jobId, blob_id: done?.[0]?.blob_id ?? null, text: correction });
      logger(`[answer] wrote correction superseding ${hit.blob_id}`);
    } catch (e) {
      writes.push({ type: "correction", error: String(e?.message || e) });
      logger(`[answer] correction write failed: ${e?.message || e}`);
    }
  }

  const out = {
    query,
    at: new Date(now).toISOString(),
    answer: text,
    withheld: decision.verdict !== VERDICT.FRESH,
    verdict: decision.verdict,
    reason: decision.reason,
    signal: decision.signal,
    memory: {
      blob_id: hit.blob_id, claim: record.claim, class: record.class, subject: record.subject,
      predicate: record.predicate, value_at_write: record.value_at_write, created_at: hit.created_at,
      distance: hit.distance,
      proof_at_write: {
        chain_id: record["proof.chain_id"], checkpoint_seq: record["proof.checkpoint_seq"],
        checkpoint_digest: record["proof.checkpoint_digest"], object_version: record["proof.object_version"],
        object_digest: record["proof.object_digest"], read_at: record["proof.read_at"],
      },
    },
    live: live ? { checkpoint_seq: live.checkpointSeq, checkpoint_digest: live.checkpointDigest, read_at: live.readAt, source: live.source } : null,
    pin: pin ? { version: pin.version, digest: pin.digest, read_at: pin.readAt, source: pin.source } : null,
    policy: {
      before_window: before.windowCheckpoints,
      after_window: policyResult.state.windowCheckpoints,
      changed: policyResult.changed,
      version: policyResult.state.version,
      reason: policyResult.reason,
      false_stale: policyResult.state.falseStale,
      missed_change: policyResult.state.missedChange,
      samples: policyResult.state.samples,
    },
    writes: writes.map((w) => ({ type: w.type, blob_id: w.blob_id ?? null, job_id: w.job_id ?? null, error: w.error ?? null })),
    reads: { checkpoint: live ? 1 : 0, pin: pin ? 1 : 0, budget_max: readBudget },
    subject_changed: subjectChanged,
    subject_short: short(record.subject),
  };
  ledger?.append(out);
  return out;
}
