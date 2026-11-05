// FR-v1 record schema: parse / serialize round-trip.
//
// A record is a plain-text document (Walrus Memory stores text and does semantic
// search over it). Header = key=value groups; body after a `---` separator.
//
// Required fields (a record missing any of these is rejected -> fail closed):
//   schema=FR-v1, claim, class, subject, predicate, state, epoch, body
//
// Everything else is optional and preserved verbatim.

export const SCHEMA = "FR-v1";
export const STATES = ["live", "superseded", "quarantined", "policy", "observation", "adversarial"];
export const CLASSES = ["FAST", "SLOW"];

export class SchemaError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "SchemaError";
    this.field = field;
  }
}

const REQUIRED = ["schema", "claim", "class", "subject", "predicate", "state", "epoch"];
// Numeric fields only. `proof.object_version` and `proof.object_digest` are
// kept as strings: Sui versions/digests are opaque identifiers, and Tatum
// returns them as strings.
const INT_FIELDS = new Set(["epoch", "policy.window_checkpoints", "policy.min_checkpoints", "policy.max_checkpoints",
  "policy.false_stale", "policy.missed_change", "policy.samples", "policy.actionable_samples", "policy.version",
  "proof.checkpoint_seq"]);

const ORDER = [
  "schema", "claim", "class", "epoch", "state", "subject", "predicate", "value_at_write",
  "proof.transport", "proof.chain_id", "proof.checkpoint_seq", "proof.checkpoint_digest",
  "proof.object_version", "proof.object_digest", "proof.read_at",
  "policy.class", "policy.window_checkpoints", "policy.min_checkpoints", "policy.max_checkpoints",
  "policy.false_stale", "policy.missed_change", "policy.samples", "policy.version", "policy.reason",
  "supersedes", "superseded_by", "agent_id", "recorded_at",
];

function splitHeader(header) {
  const out = {};
  for (const part of header.split(/[|\n]/)) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const k = token.slice(0, eq).trim();
    const v = token.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Parse an FR-v1 document.
 * @returns {{record: object, body: string}}
 * @throws {SchemaError} when a required field is missing or malformed.
 */
export function parseRecord(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new SchemaError("record is empty", "body");
  }
  const sep = text.indexOf("\n---");
  const headerText = sep === -1 ? text : text.slice(0, sep);
  const body = sep === -1 ? "" : text.slice(sep + 4).replace(/^\n/, "");
  const fields = splitHeader(headerText);

  if (fields.schema !== SCHEMA) {
    throw new SchemaError(`schema must be ${SCHEMA}, got ${fields.schema ?? "(none)"}`, "schema");
  }
  for (const f of REQUIRED) {
    if (fields[f] === undefined || fields[f] === "") {
      throw new SchemaError(`missing required field ${f}`, f);
    }
  }
  if (!CLASSES.includes(fields.class)) {
    throw new SchemaError(`unknown claim class ${fields.class}`, "class");
  }
  if (!STATES.includes(fields.state)) {
    throw new SchemaError(`unknown state ${fields.state}`, "state");
  }
  if (!body.trim()) {
    throw new SchemaError("record body is empty", "body");
  }
  const record = { ...fields };
  for (const f of INT_FIELDS) {
    if (record[f] !== undefined && record[f] !== "") {
      const n = Number(record[f]);
      if (!Number.isFinite(n)) throw new SchemaError(`${f} must be numeric, got ${record[f]}`, f);
      record[f] = n;
    }
  }
  record.body = body.trim();
  return { record, body: record.body };
}

/** Serialize a record to an FR-v1 document. Deterministic field order. */
export function serializeRecord(record) {
  if (!record || record.schema !== SCHEMA) throw new SchemaError("cannot serialize non-FR-v1 record", "schema");
  for (const f of REQUIRED) {
    if (record[f] === undefined || record[f] === "") {
      throw new SchemaError(`cannot serialize: missing ${f}`, f);
    }
  }
  if (!CLASSES.includes(record.class)) {
    throw new SchemaError(`cannot serialize: unknown claim class ${record.class}`, "class");
  }
  if (!STATES.includes(record.state)) {
    throw new SchemaError(`cannot serialize: unknown state ${record.state}`, "state");
  }
  if (!record.body || !String(record.body).trim()) throw new SchemaError("cannot serialize: empty body", "body");
  for (const f of INT_FIELDS) {
    if (record[f] === undefined || record[f] === "") continue;
    const n = Number(record[f]);
    if (!Number.isFinite(n)) throw new SchemaError(`cannot serialize: ${f} must be numeric, got ${record[f]}`, f);
  }

  const lines = [];
  let current = [];
  for (const key of ORDER) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    current.push(`${key}=${value}`);
    if (current.length === 4) { lines.push(current.join(" | ")); current = []; }
  }
  if (current.length) lines.push(current.join(" | "));
  const extras = Object.entries(record).filter(([k, v]) => !ORDER.includes(k) && k !== "body" && v !== undefined && v !== null && v !== "");
  for (const [k, v] of extras) lines.push(`${k}=${v}`);
  return `${lines.join("\n")}\n---\n${String(record.body).trim()}\n`;
}

/**
 * Convenience: build + serialize in one step.
 * No field is defaulted: a missing required field must fail closed.
 */
export function makeRecord(fields) {
  return { schema: SCHEMA, ...fields };
}

export function recordToText(fields) {
  return serializeRecord(makeRecord(fields));
}

/** Try to parse; return null instead of throwing (used when scanning recall hits). */
export function tryParseRecord(text) {
  try {
    return parseRecord(text);
  } catch {
    return null;
  }
}
