// Freshness gate (P4 hybrid): checkpoint window AND subject pin, wall-clock backstop.
// Fails closed: if a required live read is unavailable the answer is withheld.

import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";

export const VERDICT = {
  FRESH: "FRESH",
  STALE: "STALE",
  WITHHELD_UNVERIFIED: "WITHHELD_UNVERIFIED",
};

export const SIGNAL = {
  CONSISTENT: "CONSISTENT",
  FALSE_STALE: "FALSE-STALE",
  MISSED_CHANGE: "MISSED-CHANGE",
  UNVERIFIED: "UNVERIFIED",
};

/**
 * @param {object} args
 * @param {object} args.record   parsed FR-v1 claim record
 * @param {?object} args.live    { checkpointSeq, checkpointDigest, readAt } | null when the read failed
 * @param {?object} args.pin     { version, digest } | null when the read failed
 * @param {object} args.policy   { windowCheckpoints, maxAgeSeconds }
 * @param {number} args.now      epoch ms
 */
export function evaluateGate({ record, live, pin, policy, now }) {
  const window = Number(policy?.windowCheckpoints);
  const maxAgeSeconds = Number(policy?.maxAgeSeconds);

  const unverified = (reason, over = {}) => decision({
    verdict: VERDICT.WITHHELD_UNVERIFIED,
    reason: `${reason} - withholding (fail closed)`,
    signal: SIGNAL.UNVERIFIED,
    record: record || {}, window: Number.isFinite(window) ? window : null,
    live: live || null, pin: pin || null,
    windowDelta: null, windowOk: null, pinChanged: null, clockAge: null, clockOk: null,
    maxAgeSeconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : null,
    ...over,
  });

  if (!live) {
    return unverified("checkpoint read failed", { live: null });
  }
  if (!pin) {
    return unverified("subject pin read failed", { pin: null });
  }

  const requiredProof = [
    "proof.chain_id", "proof.checkpoint_seq", "proof.checkpoint_digest",
    "proof.object_version", "proof.object_digest", "proof.read_at",
  ];
  const missingProof = requiredProof.find((field) => record?.[field] === undefined || record?.[field] === null || record?.[field] === "");
  if (missingProof) return unverified(`missing required proof field ${missingProof}`);
  if (record["proof.chain_id"] !== SUI_MAINNET_CHAIN_ID) {
    return unverified(`wrong proof chain id ${record["proof.chain_id"]}`);
  }

  const min = policy?.minCheckpoints;
  const max = policy?.maxCheckpoints;
  const hasMin = min !== undefined && min !== null;
  const hasMax = max !== undefined && max !== null;
  const numericMin = Number(min);
  const numericMax = Number(max);
  const policyInvalid = !Number.isInteger(window) || window < 0 ||
    !Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0 ||
    hasMin !== hasMax ||
    (hasMin && (!Number.isInteger(numericMin) || numericMin < 0 ||
      !Number.isInteger(numericMax) || numericMax < numericMin ||
      window < numericMin || window > numericMax));
  if (policyInvalid) return unverified("invalid policy bounds");

  if (!Number.isFinite(now)) return unverified("invalid evaluation timestamp");

  const proofReadAt = Date.parse(record["proof.read_at"]);
  const liveReadAt = Date.parse(live.readAt);
  const pinReadAt = Date.parse(pin.readAt);
  if (!Number.isFinite(proofReadAt) || !Number.isFinite(liveReadAt) || !Number.isFinite(pinReadAt)) {
    return unverified("invalid proof or read timestamp");
  }
  if (proofReadAt > now) return unverified("proof timestamp is in the future");

  const proofCheckpoint = Number(record["proof.checkpoint_seq"]);
  const liveCheckpoint = Number(live.checkpointSeq);
  if (!Number.isInteger(proofCheckpoint) || proofCheckpoint < 0 ||
      !Number.isInteger(liveCheckpoint) || liveCheckpoint < 0 ||
      !live.checkpointDigest || pin.version === undefined || pin.version === null || pin.version === "" || !pin.digest) {
    return unverified("invalid or incomplete live proof values");
  }

  const windowDelta = liveCheckpoint - proofCheckpoint;
  if (!Number.isFinite(windowDelta) || windowDelta < 0) {
    return unverified("invalid checkpoint delta");
  }
  const windowOk = windowDelta <= window;
  const versionChanged = String(pin.version) !== String(record["proof.object_version"]);
  const digestChanged = String(pin.digest) !== String(record["proof.object_digest"]);
  const pinChanged = versionChanged || digestChanged;
  const clockAge = Math.round((now - proofReadAt) / 1000);
  const clockOk = clockAge <= maxAgeSeconds;

  let verdict;
  let reason;
  let signal;

  if (pinChanged) {
    verdict = VERDICT.STALE;
    reason = `subject changed (version ${record["proof.object_version"]}->${pin.version}, digest ${digestChanged ? "changed" : "same"})`;
    signal = windowOk ? SIGNAL.MISSED_CHANGE : SIGNAL.CONSISTENT;
  } else if (!windowOk) {
    verdict = VERDICT.STALE;
    reason = `checkpoint window exceeded (delta ${windowDelta} > window ${window})`;
    signal = SIGNAL.FALSE_STALE;
  } else if (!clockOk) {
    verdict = VERDICT.STALE;
    reason = `wall-clock backstop exceeded (age ${clockAge}s > ${maxAgeSeconds}s)`;
    signal = SIGNAL.CONSISTENT;
  } else {
    verdict = VERDICT.FRESH;
    reason = `fresh (checkpoint delta ${windowDelta} <= ${window}, subject unchanged)`;
    signal = SIGNAL.CONSISTENT;
  }

  return decision({
    verdict, reason, signal, record, window, live, pin,
    windowDelta, windowOk, pinChanged, clockAge, clockOk, maxAgeSeconds,
  });
}

function decision(args) {
  const { verdict, reason, signal, record, window, live, pin, windowDelta, windowOk, pinChanged, clockAge, clockOk, maxAgeSeconds } = args;
  return {
    verdict,
    reason,
    signal,
    class: record?.class,
    claim: record?.claim,
    subject: record?.subject,
    predicate: record?.predicate,
    state: record?.state,
    window,
    signals: {
      window: { delta: windowDelta, window, ok: windowOk },
      pin: { changed: pinChanged, version: pin?.version ?? null, digest: pin?.digest ?? null },
      wallclock: { age_seconds: clockAge, max_age_seconds: maxAgeSeconds ?? null, ok: clockOk },
    },
    proof_at_write: {
      chain_id: record?.["proof.chain_id"] ?? null,
      checkpoint_seq: record?.["proof.checkpoint_seq"] ?? null,
      checkpoint_digest: record?.["proof.checkpoint_digest"] ?? null,
      object_version: record?.["proof.object_version"] ?? null,
      object_digest: record?.["proof.object_digest"] ?? null,
      read_at: record?.["proof.read_at"] ?? null,
    },
    live_checkpoint: live ? { seq: live.checkpointSeq, digest: live.checkpointDigest, read_at: live.readAt } : null,
  };
}

/** Learning signal only (used by the policy engine and the replay tool). */
export function learningSignal({ windowOk, pinChanged }) {
  if (windowOk === null || pinChanged === null) return SIGNAL.UNVERIFIED;
  if (!windowOk && !pinChanged) return SIGNAL.FALSE_STALE;
  if (windowOk && pinChanged) return SIGNAL.MISSED_CHANGE;
  return SIGNAL.CONSISTENT;
}
