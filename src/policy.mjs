// Learned policy: a closed loop on two per-claim-class signals.
//   FALSE-STALE  (window says stale, subject pin says unchanged) -> widen the window
//   MISSED-CHANGE(window says fresh, subject pin says changed)  -> tighten the window
//
// Rules enforced here:
//   - CONSISTENT and UNVERIFIED signals never move the window (they carry no
//     information about whether the window is too tight or too loose).
//   - a minimum number of *actionable* samples (FALSE-STALE + MISSED-CHANGE)
//     since the last change is required before the window may move.
//   - the window is bounded by the class min/max.
//   - exactly one policy memory is written per change (the caller does the write).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SIGNAL } from "./gate.mjs";
import { recordToText } from "./schema.mjs";

export const DEFAULT_MIN_SAMPLES = 3;
export const DEFAULT_WIDEN_FACTOR = 2;
export const DEFAULT_TIGHTEN_FACTOR = 2;

export const DEFAULT_CLASS_POLICY = {
  FAST: { windowCheckpoints: 50, minCheckpoints: 10, maxCheckpoints: 200000, maxAgeSeconds: 86400 },
  SLOW: { windowCheckpoints: 5000, minCheckpoints: 10, maxCheckpoints: 2000000, maxAgeSeconds: 604800 },
};

export function newState(className, overrides = {}) {
  const base = DEFAULT_CLASS_POLICY[className] || DEFAULT_CLASS_POLICY.SLOW;
  return {
    class: className,
    windowCheckpoints: base.windowCheckpoints,
    minCheckpoints: base.minCheckpoints,
    maxCheckpoints: base.maxCheckpoints,
    maxAgeSeconds: base.maxAgeSeconds,
    samples: 0,             // every evaluated signal
    actionableSamples: 0,   // FALSE-STALE + MISSED-CHANGE only
    falseStale: 0,
    missedChange: 0,
    pendingSamples: 0,      // actionable samples since the last change
    pendingFalseStale: 0,
    pendingMissedChange: 0,
    version: 0,
    updatedAt: null,
    lastReason: null,
    ...overrides,
  };
}

/**
 * Apply one learning signal to a policy state.
 * @returns {{state: object, changed: boolean, reason: string, previousWindow: number}}
 */
export function applySignal(state, signal, opts = {}) {
  const minSamples = opts.minSamples ?? state.minSamples ?? DEFAULT_MIN_SAMPLES;
  const widenFactor = opts.widenFactor ?? DEFAULT_WIDEN_FACTOR;
  const tightenFactor = opts.tightenFactor ?? DEFAULT_TIGHTEN_FACTOR;
  const now = opts.now ?? Date.now();

  const next = { ...state, samples: state.samples + 1 };
  if (signal === SIGNAL.FALSE_STALE) {
    next.falseStale = state.falseStale + 1;
    next.pendingFalseStale = state.pendingFalseStale + 1;
    next.pendingSamples = state.pendingSamples + 1;
    next.actionableSamples = state.actionableSamples + 1;
  } else if (signal === SIGNAL.MISSED_CHANGE) {
    next.missedChange = state.missedChange + 1;
    next.pendingMissedChange = state.pendingMissedChange + 1;
    next.pendingSamples = state.pendingSamples + 1;
    next.actionableSamples = state.actionableSamples + 1;
  }

  const previousWindow = state.windowCheckpoints;

  // Only an actionable signal can move the window.
  if (signal !== SIGNAL.FALSE_STALE && signal !== SIGNAL.MISSED_CHANGE) {
    next.lastReason = `${signal}: no window change (not an actionable signal)`;
    return { state: next, changed: false, reason: next.lastReason, previousWindow };
  }

  // Minimum sample count since the last change.
  if (next.pendingSamples < minSamples) {
    next.lastReason = `actionable sample ${next.pendingSamples}/${minSamples}: not enough samples yet`;
    return { state: next, changed: false, reason: next.lastReason, previousWindow };
  }

  let newWindow = previousWindow;
  let reason;
  if (next.pendingFalseStale > next.pendingMissedChange) {
    newWindow = Math.min(next.maxCheckpoints, previousWindow * widenFactor);
    reason = `FALSE-STALE ${next.pendingFalseStale} > MISSED-CHANGE ${next.pendingMissedChange}: widen ${previousWindow} -> ${newWindow}`;
  } else if (next.pendingMissedChange > next.pendingFalseStale) {
    newWindow = Math.max(next.minCheckpoints, Math.floor(previousWindow / tightenFactor));
    reason = `MISSED-CHANGE ${next.pendingMissedChange} > FALSE-STALE ${next.pendingFalseStale}: tighten ${previousWindow} -> ${newWindow}`;
  } else {
    reason = `FALSE-STALE ${next.pendingFalseStale} == MISSED-CHANGE ${next.pendingMissedChange}: no change`;
  }

  if (newWindow === previousWindow) {
    next.lastReason = reason;
    next.updatedAt = new Date(now).toISOString();
    // the counters still reset: this is a decision point, not a free sample
    next.pendingSamples = 0;
    next.pendingFalseStale = 0;
    next.pendingMissedChange = 0;
    return { state: next, changed: false, reason, previousWindow };
  }

  next.windowCheckpoints = newWindow;
  next.version = state.version + 1;
  next.updatedAt = new Date(now).toISOString();
  next.lastReason = reason;
  next.pendingSamples = 0;
  next.pendingFalseStale = 0;
  next.pendingMissedChange = 0;
  return { state: next, changed: true, reason, previousWindow };
}

/** Render a policy state as an FR-v1 policy record (one per change). */
export function policyRecordText(state, ctx = {}) {
  const now = ctx.now ? new Date(ctx.now).toISOString() : new Date().toISOString();
  return recordToText({
    claim: ctx.claim || `fc-policy-${state.class}-v${state.version}`,
    class: state.class,
    epoch: ctx.epoch ?? 1,
    state: "policy",
    subject: `class:${state.class}`,
    predicate: "policy_window",
    value_at_write: String(state.windowCheckpoints),
    "proof.transport": "tatum-sui-mainnet/graphql",
    "proof.chain_id": ctx.chainId || "",
    "proof.checkpoint_seq": ctx.checkpointSeq ?? "",
    "proof.checkpoint_digest": ctx.checkpointDigest || "",
    "proof.read_at": now,
    "policy.class": state.class,
    "policy.window_checkpoints": state.windowCheckpoints,
    "policy.min_checkpoints": state.minCheckpoints,
    "policy.max_checkpoints": state.maxCheckpoints,
    "policy.false_stale": state.falseStale,
    "policy.missed_change": state.missedChange,
    "policy.samples": state.samples,
    "policy.actionable_samples": state.actionableSamples,
    "policy.version": state.version,
    "policy.reason": state.lastReason || "initial",
    agent_id: ctx.agentId || "",
    recorded_at: now,
    body: `Learned policy for claim class ${state.class}: trust a memory for ${state.windowCheckpoints} checkpoints. ` +
      `FALSE-STALE=${state.falseStale}, MISSED-CHANGE=${state.missedChange}, samples=${state.samples}. ${state.lastReason || "initial state"}.`,
  });
}

/**
 * Policy engine: loads policy memories from the store (authoritative) with a
 * local mirror as a fast path, and tracks per-class state in memory.
 */
export class PolicyEngine {
  constructor({ store, mirrorPath = null, defaults = {}, minSamples = DEFAULT_MIN_SAMPLES } = {}) {
    this.store = store;
    this.mirrorPath = mirrorPath;
    this.defaults = defaults;
    this.minSamples = minSamples;
    this.states = new Map();
    this.loadedAt = null;
    this.source = null;
  }

  state(className) {
    if (!this.states.has(className)) {
      this.states.set(className, newState(className, this.defaults[className] || {}));
    }
    return this.states.get(className);
  }

  /** Read policy memories. Called at startup and before every answer. */
  async load() {
    const found = new Map();
    if (this.store) {
      try {
        const res = await this.store.recall({ query: "FR-v1 policy window checkpoints claim class", limit: 25, sort: "recent" });
        for (const hit of res.results || []) {
          const parsed = this.store.parse ? this.store.parse(hit.text) : null;
          const rec = parsed?.record || parsed;
          if (!rec || rec.predicate !== "policy_window") continue;
          const cls = rec["policy.class"] || rec.class;
          const version = Number(rec["policy.version"] ?? 0);
          const prev = found.get(cls);
          if (!prev || version > prev.version) {
            const def = DEFAULT_CLASS_POLICY[cls] || DEFAULT_CLASS_POLICY.SLOW;
            found.set(cls, {
              class: cls,
              version,
              windowCheckpoints: Number(rec["policy.window_checkpoints"]),
              minCheckpoints: Number(rec["policy.min_checkpoints"] ?? def.minCheckpoints),
              maxCheckpoints: Number(rec["policy.max_checkpoints"] ?? def.maxCheckpoints),
              samples: Number(rec["policy.samples"] ?? 0),
              actionableSamples: Number(rec["policy.actionable_samples"] ?? 0),
              falseStale: Number(rec["policy.false_stale"] ?? 0),
              missedChange: Number(rec["policy.missed_change"] ?? 0),
              pendingSamples: 0,
              pendingFalseStale: 0,
              pendingMissedChange: 0,
              lastReason: rec["policy.reason"] ?? null,
              updatedAt: rec["recorded_at"] ?? null,
            });
          }
        }
        this.source = "store";
      } catch (e) {
        this.source = `store-error:${e?.message || e}`;
      }
    }
    for (const [cls, s] of found) {
      const current = this.states.get(cls);
      if (!current || s.version > current.version) {
        const base = current || newState(cls, this.defaults[cls] || {});
        this.states.set(cls, { ...base, ...s, maxAgeSeconds: base.maxAgeSeconds });
      }
    }
    this.loadedAt = new Date().toISOString();
    return this.snapshot();
  }

  apply(className, signal, opts = {}) {
    return this.commit(className, this.preview(className, signal, opts));
  }

  /** Calculate the next state without making it visible in memory. */
  preview(className, signal, opts = {}) {
    const before = this.state(className);
    return applySignal(before, signal, { minSamples: this.minSamples, ...opts });
  }

  /** Make a previewed result visible after any required persistence succeeds. */
  commit(className, res) {
    this.states.set(className, res.state);
    if (res.changed && this.mirrorPath) this.writeMirror();
    return res;
  }

  snapshot() {
    return Object.fromEntries([...this.states.entries()].map(([k, v]) => [k, { ...v }]));
  }

  writeMirror() {
    if (!this.mirrorPath) return;
    try {
      mkdirSync(dirname(this.mirrorPath), { recursive: true });
      writeFileSync(this.mirrorPath, JSON.stringify({ updated_at: new Date().toISOString(), states: this.snapshot() }, null, 1));
    } catch { /* mirror is a convenience only */ }
  }
}
