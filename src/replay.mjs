// Replay a recorded event log through the gate + policy engine.
// Used by the offline test ("same query, different gate verdict after the policy
// memory changes") and by the proof page's ablation table.
//
// A recorded event is a ledger entry: it carries the proof at write time, the live
// checkpoint, the pin, and the resulting verdict.

import { readFileSync } from "node:fs";
import { evaluateGate, VERDICT } from "./gate.mjs";
import { applySignal, newState } from "./policy.mjs";

function recordOf(ev, className) {
  return {
    class: ev.memory?.class || className,
    claim: ev.memory?.claim,
    subject: ev.memory?.subject,
    predicate: ev.memory?.predicate,
    "proof.checkpoint_seq": ev.memory?.proof_at_write?.checkpoint_seq ?? ev.proof_at_write?.checkpoint_seq,
    "proof.object_version": ev.memory?.proof_at_write?.object_version ?? ev.proof_at_write?.object_version,
    "proof.object_digest": ev.memory?.proof_at_write?.object_digest ?? ev.proof_at_write?.object_digest,
    "proof.read_at": ev.memory?.proof_at_write?.read_at ?? ev.proof_at_write?.read_at,
  };
}
function liveOf(ev) {
  return ev.live ? { checkpointSeq: ev.live.checkpoint_seq, checkpointDigest: ev.live.checkpoint_digest, readAt: ev.live.read_at } : null;
}
function pinOf(ev) {
  return ev.pin ? { version: ev.pin.version, digest: ev.pin.digest, readAt: ev.pin.read_at } : null;
}

/**
 * Replay events and report, for one target query, how the verdict evolves.
 * @param {Array} events  ledger entries (or a fixture in the same shape)
 */
export function replay(events, { query = null, className = "FAST", minSamples = 3, now = Date.now() } = {}) {
  let state = newState(className);
  const timeline = [];
  const policyChanges = [];

  for (const ev of events) {
    if (query && ev.query !== query) continue;
    const record = recordOf(ev, className);
    const decision = evaluateGate({
      record, live: liveOf(ev), pin: pinOf(ev),
      policy: { windowCheckpoints: state.windowCheckpoints, maxAgeSeconds: state.maxAgeSeconds },
      now,
    });
    const before = state.windowCheckpoints;
    const res = applySignal(state, decision.signal, { minSamples, now });
    state = res.state;
    timeline.push({
      at: ev.at, query: ev.query, claim: record.claim,
      window_before: before, window_after: state.windowCheckpoints,
      verdict: decision.verdict, signal: decision.signal, reason: decision.reason,
      policy_changed: res.changed, policy_reason: res.reason,
    });
    if (res.changed) policyChanges.push({ at: ev.at, from: before, to: state.windowCheckpoints, reason: res.reason });
  }

  // Re-evaluate the last event for this query under the final policy.
  let finalVerdict = null;
  const matching = events.filter((e) => (!query || e.query === query));
  if (matching.length) {
    const last = matching.at(-1);
    const d = evaluateGate({
      record: recordOf(last, className), live: liveOf(last), pin: pinOf(last),
      policy: { windowCheckpoints: state.windowCheckpoints, maxAgeSeconds: state.maxAgeSeconds }, now,
    });
    finalVerdict = {
      verdict: d.verdict, reason: d.reason, signal: d.signal,
      window: state.windowCheckpoints, delta: d.signals.window.delta,
    };
  }

  return { state, timeline, policyChanges, finalVerdict };
}

/**
 * Ablation: the same recorded answers under three configurations.
 *
 *   memory-off                 no stored claim is used; every answer is read live
 *                              (1 Tatum read per answer: the subject object)
 *   memory-on (no gate)        the stored memory answers; no verification reads
 *   memory-on (gate + policy)  the memory answers only when the gate proves it
 *                              fresh, otherwise it is withheld and the answer is
 *                              re-read from the chain (2 Tatum reads per answer:
 *                              one checkpoint + one subject pin)
 */
export function ablation(events, { className = "FAST", minSamples = 3, now = Date.now() } = {}) {
  const rows = [];
  const queries = [...new Set(events.map((e) => e.query))].filter(Boolean);

  for (const q of queries) {
    const evs = events.filter((e) => e.query === q);
    let state = newState(className);

    let offAnswersLive = 0, offReads = 0;
    let onAnswers = 0, onReads = 0, onStale = 0;
    let gatedFromMemory = 0, gatedWithheld = 0, gatedReads = 0, gatedStale = 0;

    for (const ev of evs) {
      const record = recordOf(ev, className);
      const live = liveOf(ev);
      const pin = pinOf(ev);

      // memory-off: nothing is stored, so the answer is always the live read
      offAnswersLive += 1;
      offReads += 1;

      const d = evaluateGate({
        record, live, pin,
        policy: { windowCheckpoints: state.windowCheckpoints, maxAgeSeconds: state.maxAgeSeconds }, now,
      });

      // memory-on without the gate: the memory answers, even when it is wrong
      onAnswers += 1;
      onReads += 0;
      if (d.verdict !== VERDICT.FRESH) onStale += 1;

      // memory-on with the gate + learned policy
      const res = applySignal(state, d.signal, { minSamples, now });
      state = res.state;
      gatedReads += 2; // checkpoint + subject pin
      if (d.verdict === VERDICT.FRESH) gatedFromMemory += 1;
      else { gatedWithheld += 1; gatedStale += 0; }
    }

    rows.push({
      query: q,
      events: evs.length,
      "memory-off": {
        answers_from_memory: 0, answers_from_live: offAnswersLive, withheld: 0,
        tatum_reads: offReads, stale_answers: 0,
      },
      "memory-on (no gate)": {
        answers_from_memory: onAnswers, answers_from_live: 0, withheld: 0,
        tatum_reads: onReads, stale_answers: onStale,
      },
      "memory-on (gate + learned policy)": {
        answers_from_memory: gatedFromMemory, answers_from_live: gatedWithheld, withheld: gatedWithheld,
        tatum_reads: gatedReads, stale_answers: gatedStale,
      },
    });
  }
  return rows;
}

export function readEvents(path) {
  const raw = readFileSync(path, "utf8");
  if (raw.trim().startsWith("[")) return JSON.parse(raw);
  if (raw.trim().startsWith("{")) return JSON.parse(raw).events;
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
