// Strict selection and validation for the recorded Mainnet revision sample.
//
// Historical corrections used either a Walrus blob id or an exact claim as
// their `supersedes` reference. The committed proof snapshot resolves both to
// `supersedes_ref`; this module preserves the stored reference and verifies the
// resolved target before any lifecycle claim is exposed.

const REQUIRED_PROOF_FIELDS = [
  "checkpoint_seq",
  "checkpoint_digest",
  "object_version",
  "object_digest",
  "read_at",
  "transport",
  "chain_id",
];

function fail(message) {
  throw new Error(`recorded lifecycle: ${message}`);
}

function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertProof(memory, label) {
  if (!memory?.proof) fail(`${label} is missing its proof envelope`);
  for (const field of REQUIRED_PROOF_FIELDS) {
    if (memory.proof[field] === undefined || memory.proof[field] === null || memory.proof[field] === "") {
      fail(`${label} is missing proof.${field}`);
    }
  }
  const checkpoint = Number(memory.proof.checkpoint_seq);
  if (!Number.isInteger(checkpoint) || checkpoint < 0) fail(`${label} has an invalid proof checkpoint`);
  if (!validTime(memory.proof.read_at)) fail(`${label} has an invalid proof read time`);
}

function uniqueMatch(matches, label) {
  const unique = [...new Set(matches)];
  if (unique.length > 1) fail(`${label} is ambiguous`);
  return unique[0] || null;
}

/** Resolve a correction's stored blob-or-claim reference to one memory. */
export function resolveSupersededMemory(correction, memories) {
  if (!correction?.supersedes) fail(`${correction?.claim || "correction"} has no supersedes reference`);
  if (!Array.isArray(memories)) fail("memory inventory is missing");

  const rawReference = String(correction.supersedes);
  const rawTarget = uniqueMatch(
    memories.filter((memory) => memory?.blob_id === rawReference || memory?.claim === rawReference),
    `supersedes reference ${rawReference}`,
  );
  if (!rawTarget) fail(`stored supersedes reference ${rawReference} cannot be resolved`);
  const resolvedTarget = correction.supersedes_ref
    ? uniqueMatch(
      memories.filter((memory) => memory?.blob_id === correction.supersedes_ref),
      `resolved supersedes reference ${correction.supersedes_ref}`,
    )
    : null;

  if (correction.supersedes_ref && !resolvedTarget) {
    fail(`resolved supersedes reference ${correction.supersedes_ref} is missing`);
  }
  if (rawTarget && resolvedTarget && rawTarget !== resolvedTarget) {
    fail(`stored supersedes reference ${rawReference} disagrees with ${correction.supersedes_ref}`);
  }
  const target = resolvedTarget || rawTarget;
  if (target === correction) fail(`${correction.claim} cannot supersede itself`);
  return target;
}

function sameEventProof(eventProof, memory) {
  return Number(eventProof?.checkpoint_seq) === Number(memory?.proof?.checkpoint_seq) &&
    String(eventProof?.object_version) === String(memory?.proof?.object_version) &&
    eventProof?.object_digest === memory?.proof?.object_digest &&
    eventProof?.read_at === memory?.proof?.read_at;
}

function assertUniqueBlobIds(memories) {
  const seen = new Set();
  for (const memory of memories) {
    if (!memory?.blob_id) continue;
    if (seen.has(memory.blob_id)) fail(`duplicate blob id ${memory.blob_id}`);
    seen.add(memory.blob_id);
  }
}

/**
 * Select the latest real Sui Clock correction and the recorded evidence that
 * brackets its lifecycle: the stale predecessor decision, then the first later
 * check over an observation carrying the correction's exact proof.
 */
export function selectRecordedRevisionLifecycle(snapshot, { className = "FAST" } = {}) {
  const memories = snapshot?.memories;
  const ledger = snapshot?.ledger;
  if (!Array.isArray(memories)) fail("memory inventory is missing");
  if (!Array.isArray(ledger)) fail("decision ledger is missing");
  assertUniqueBlobIds(memories);

  const corrections = memories
    .filter((memory) => (
      memory?.class === className &&
      memory?.state === "live" &&
      memory?.claim?.startsWith("cor-sui-clock-") &&
      memory?.supersedes
    ))
    .sort((a, b) => Number(b.proof?.checkpoint_seq || -1) - Number(a.proof?.checkpoint_seq || -1));
  const correction = corrections[0];
  if (!correction) fail(`no ${className} Sui Clock correction was recorded`);
  assertProof(correction, `correction ${correction.claim}`);
  if (!correction.blob_id) fail(`${correction.claim} has no Walrus blob id`);
  if (!validTime(correction.recorded_at) || !validTime(correction.created_at)) {
    fail(`${correction.claim} is missing a valid recorded_at or created_at timestamp`);
  }
  if (correction.recorded_at !== correction.proof.read_at) {
    fail(`${correction.claim} recorded_at does not match its proof read time`);
  }
  if (Date.parse(correction.created_at) < Date.parse(correction.recorded_at)) {
    fail(`${correction.claim} was persisted before it was recorded`);
  }
  if (snapshot.chain_id && correction.proof.chain_id !== snapshot.chain_id) {
    fail(`${correction.claim} does not match the snapshot chain id`);
  }
  if (correction.recorded_at !== correction.proof.read_at) {
    fail(`${correction.claim} recorded_at does not match its proof read time`);
  }
  if (Date.parse(correction.created_at) < Date.parse(correction.recorded_at)) {
    fail(`${correction.claim} was persisted before its recorded proof time`);
  }

  const predecessor = resolveSupersededMemory(correction, memories);
  assertProof(predecessor, `predecessor ${predecessor.claim}`);
  if (predecessor.recorded_at !== predecessor.proof.read_at) {
    fail(`${predecessor.claim} recorded_at does not match its proof read time`);
  }
  if (predecessor.state !== "observation") fail(`${predecessor.claim} is not an observation`);
  for (const field of ["class", "subject", "predicate"]) {
    if (predecessor[field] !== correction[field]) fail(`predecessor and correction disagree on ${field}`);
  }
  for (const field of ["chain_id", "transport"]) {
    if (predecessor.proof[field] !== correction.proof[field]) {
      fail(`predecessor and correction disagree on proof.${field}`);
    }
  }
  if (Number(correction.proof.checkpoint_seq) <= Number(predecessor.proof.checkpoint_seq)) {
    fail("correction checkpoint does not follow its predecessor");
  }
  if (Date.parse(correction.proof.read_at) <= Date.parse(predecessor.proof.read_at)) {
    fail("correction read time does not follow its predecessor");
  }

  const triggerMatches = ledger.filter((event) => (
    event?.class === className &&
    event?.verdict === "STALE" &&
    (event?.memory?.blob_id === predecessor.blob_id || event?.memory?.claim === predecessor.claim) &&
    Number(event?.live?.checkpoint_seq) === Number(correction.proof.checkpoint_seq) &&
    String(event?.pin?.version) === String(correction.proof.object_version) &&
    event?.pin?.digest === correction.proof.object_digest
  ));
  const trigger = uniqueMatch(triggerMatches, `trigger for ${correction.claim}`);
  if (!trigger) fail(`no recorded stale trigger matches ${correction.claim}`);
  if (!sameEventProof(trigger.memory?.proof_at_write, predecessor)) {
    fail("recorded trigger does not carry the predecessor proof");
  }
  if (trigger.live?.checkpoint_digest !== correction.proof.checkpoint_digest) {
    fail("recorded trigger checkpoint digest does not match the correction proof");
  }
  if (trigger.at !== correction.recorded_at || trigger.pin?.read_at !== correction.proof.read_at) {
    fail("recorded trigger time does not match the correction proof");
  }
  if (!String(trigger.reason || "").startsWith("subject changed")) {
    fail("recorded trigger was not a subject-change decision");
  }

  const persistedAt = Date.parse(correction.created_at);
  const laterMatches = ledger
    .filter((event) => (
      validTime(event?.at) &&
      Date.parse(event.at) > persistedAt &&
      event?.class === className &&
      sameEventProof(event?.memory?.proof_at_write, correction) &&
      Number(event?.live?.checkpoint_seq) > Number(correction.proof.checkpoint_seq) &&
      event?.pin?.version &&
      event?.pin?.digest
    ))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const laterEvent = laterMatches[0];
  if (!laterEvent) fail(`no later recorded check carries ${correction.claim}'s proof`);
  if (laterEvent.verdict !== "STALE" || !String(laterEvent.reason || "").startsWith("subject changed")) {
    fail("the first later proof-equivalent check was not withheld as a changed subject");
  }
  if (String(laterEvent.pin.version) === String(correction.proof.object_version) &&
      laterEvent.pin.digest === correction.proof.object_digest) {
    fail("the later recorded subject did not change");
  }

  return {
    correction,
    predecessor,
    trigger,
    laterEvent,
    storedReference: String(correction.supersedes),
    storedReferenceKind: correction.supersedes === predecessor.blob_id ? "blob_id" : "claim",
    resolvedBlobId: predecessor.blob_id,
    laterEventActuallyRecalledCorrection: laterEvent.memory?.blob_id === correction.blob_id,
  };
}
