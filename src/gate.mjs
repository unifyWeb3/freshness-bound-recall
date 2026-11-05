// Freshness gate (P4 hybrid): checkpoint window AND subject pin, wall-clock backstop.
// Fails closed: if a required live read is unavailable the answer is withheld.

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
  const window = policy.windowCheckpoints;
  const maxAgeSeconds = policy.maxAgeSeconds;

  if (!live) {
    return decision({
      verdict: VERDICT.WITHHELD_UNVERIFIED,
      reason: "checkpoint read failed - withholding (fail closed)",
      signal: SIGNAL.UNVERIFIED,
      record, window, live: null, pin, windowDelta: null, windowOk: null, pinChanged: null, clockAge: null, clockOk: null,
    });
  }
  if (!pin) {
    return decision({
      verdict: VERDICT.WITHHELD_UNVERIFIED,
      reason: "subject pin read failed - withholding (fail closed)",
      signal: SIGNAL.UNVERIFIED,
      record, window, live, pin: null, windowDelta: null, windowOk: null, pinChanged: null, clockAge: null, clockOk: null,
    });
  }

  const windowDelta = live.checkpointSeq - Number(record["proof.checkpoint_seq"]);
  const windowOk = windowDelta <= window;
  const versionChanged = String(pin.version) !== String(record["proof.object_version"]);
  const digestChanged = String(pin.digest) !== String(record["proof.object_digest"]);
  const pinChanged = versionChanged || digestChanged;
  const readAt = Date.parse(record["proof.read_at"]);
  const clockAge = Number.isFinite(readAt) ? Math.round((now - readAt) / 1000) : null;
  const clockOk = clockAge === null ? true : clockAge <= maxAgeSeconds;

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
    windowDelta, windowOk, pinChanged, clockAge, clockOk,
  });
}

function decision(args) {
  const { verdict, reason, signal, record, window, live, pin, windowDelta, windowOk, pinChanged, clockAge, clockOk } = args;
  return {
    verdict,
    reason,
    signal,
    class: record.class,
    claim: record.claim,
    subject: record.subject,
    predicate: record.predicate,
    state: record.state,
    window,
    signals: {
      window: { delta: windowDelta, window, ok: windowOk },
      pin: { changed: pinChanged, version: pin?.version ?? null, digest: pin?.digest ?? null },
      wallclock: { age_seconds: clockAge, max_age_seconds: null, ok: clockOk },
    },
    proof_at_write: {
      checkpoint_seq: record["proof.checkpoint_seq"] ?? null,
      object_version: record["proof.object_version"] ?? null,
      object_digest: record["proof.object_digest"] ?? null,
      read_at: record["proof.read_at"] ?? null,
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
