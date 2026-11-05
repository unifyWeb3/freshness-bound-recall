// Secret loading + redaction. Secrets live only in ./.env and are never printed.
import { readFileSync } from "node:fs";

export function loadEnv(path) {
  const env = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const SECRET_PATTERNS = [
  // Sui private key (bech32): suiprivkey1 + bech32 data (no 1, b, i, o)
  /suiprivkey1[023456789acdefghjklmnpqrstuvwxyz]{20,}/g,
  // Tatum API key shape
  /\bt-[0-9a-f]{16,}\b/gi,
];
// NOTE: deliberately no generic `0x<hex>` rule - a Sui address has exactly that
// shape, and redacting addresses would destroy the proof data.

export class Redactor {
  constructor(secrets = []) {
    this.secrets = secrets.filter((s) => typeof s === "string" && s.length >= 8);
  }
  static fromEnv(env) {
    return new Redactor([
      env.MEMWAL_PRIVATE_KEY,
      env.TATUM_API_KEY,
      env.MEMWAL_ACCOUNT_ID,
      env.MEMWAL_AGENT_ID,
    ]);
  }
  /** Replace known secret values and secret-shaped substrings. */
  redact(value) {
    if (typeof value === "string") {
      let s = value;
      for (const secret of this.secrets) {
        while (s.includes(secret)) s = s.replace(secret, "[REDACTED]");
      }
      for (const p of SECRET_PATTERNS) s = s.replace(p, "[REDACTED]");
      return s;
    }
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.redact(v);
      return out;
    }
    return value;
  }
  /** Redact then stringify, for logs. */
  line(...parts) {
    return this.redact(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
  }
}
