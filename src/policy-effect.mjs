// Build a complete, replayable freshness decision from the committed proof
// snapshot. Older ledger entries intentionally contain only the proof fields
// needed by the observer at the time; the memory inventory carries the full
// FR-v1 proof envelope required by the hardened gate.

import { evaluateGate } from "./gate.mjs";

export function recordedPolicyEffect(snapshot, {
  className = "SLOW",
  oldWindow = 5000,
  newWindow = 20000,
} = {}) {
  const events = (snapshot?.ledger || []).filter((entry) => {
    const delta = Number(entry?.live?.checkpoint_seq) - Number(entry?.memory?.proof_at_write?.checkpoint_seq);
    return entry?.class === className &&
      entry?.signal === "FALSE-STALE" &&
      Number.isFinite(delta) && delta > oldWindow && delta <= newWindow;
  });
  const event = events.at(-1);
  if (!event) {
    throw new Error(`no recorded ${className} FALSE-STALE decision in the (${oldWindow}, ${newWindow}] delta band`);
  }

  const memory = (snapshot.memories || []).find((candidate) => candidate.blob_id === event.memory.blob_id);
  if (!memory) throw new Error(`memory ${event.memory.blob_id} is missing from the proof snapshot`);

  const record = {
    claim: memory.claim,
    class: memory.class,
    state: memory.state,
    subject: memory.subject,
    predicate: memory.predicate,
    "proof.chain_id": memory.proof?.chain_id,
    "proof.checkpoint_seq": memory.proof?.checkpoint_seq,
    "proof.checkpoint_digest": memory.proof?.checkpoint_digest,
    "proof.object_version": memory.proof?.object_version,
    "proof.object_digest": memory.proof?.object_digest,
    "proof.read_at": memory.proof?.read_at,
  };
  const live = {
    checkpointSeq: event.live.checkpoint_seq,
    checkpointDigest: event.live.checkpoint_digest,
    readAt: event.live.read_at,
  };
  const pin = {
    version: event.pin.version,
    digest: event.pin.digest,
    readAt: event.pin.read_at,
  };

  return { event, memory, record, live, pin, now: Date.parse(event.at) };
}

export function comparePolicyWindows(effect, {
  oldWindow = 5000,
  newWindow,
  maxAgeSeconds = 604800,
} = {}) {
  if (!Number.isInteger(newWindow)) throw new Error("newWindow must be an integer");
  const decide = (windowCheckpoints) => evaluateGate({
    record: effect.record,
    live: effect.live,
    pin: effect.pin,
    policy: { windowCheckpoints, maxAgeSeconds },
    now: effect.now,
  });
  return {
    oldPolicy: decide(oldWindow),
    newPolicy: decide(newWindow),
  };
}
