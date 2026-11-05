// Mainnet wiring: the Walrus Memory (relayer) client and the startup
// credential self-test.
//
// Rules from the build brief:
//   - secrets come from ./.env only and are never printed
//   - MEMWAL_ACCOUNT_ID is the MemWalAccount OBJECT ID, not the wallet address
//     (the self-test proves this on-chain through Tatum)
//   - relayer timeouts are >= 30 s with retries (the SDK default preflight
//     timeout is 5 s, which is what made health() fail in Stage 2)

import { MemWal } from "@mysten-incubation/memwal";

export const RELAYER_URL = "https://relayer.memory.walrus.xyz";

/** All >= 30 s, per correction 4. */
export const RELAYER_TIMEOUTS = {
  requestTimeoutMs: 60000,
  recallTimeoutMs: 60000,
  preflightTimeoutMs: 30000,
};

export const NAMESPACE = "freshness-recall";

/** Create the pinned-SDK mainnet client. */
export function createMemWalClient({ env, namespace = NAMESPACE, serverUrl = RELAYER_URL } = {}) {
  return MemWal.create({
    key: env.MEMWAL_PRIVATE_KEY,
    accountId: env.MEMWAL_ACCOUNT_ID,
    serverUrl,
    namespace,
    ...RELAYER_TIMEOUTS,
  });
}

const HEX64 = /^0x[0-9a-fA-F]{64}$/;

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail: detail ?? null };
}

/**
 * Startup credential self-test. Never prints a secret value.
 *
 * @param {object} args
 * @param {object} args.client  MemWal client
 * @param {object} args.tatum   TatumClient (read-only on-chain checks)
 * @param {object} args.env     loaded environment
 * @param {string} args.namespace
 * @returns {Promise<{ok: boolean, checks: Array, relayer: object}>}
 */
export async function credentialSelfTest({ client, tatum, env, namespace = NAMESPACE }) {
  const checks = [];

  // 1. the four credentials are present (names only)
  const required = ["TATUM_API_KEY", "MEMWAL_ACCOUNT_ID", "MEMWAL_AGENT_ID", "MEMWAL_PRIVATE_KEY"];
  const missing = required.filter((k) => !env[k]);
  checks.push(check("env keys present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all present"));

  // 2. shape checks
  checks.push(check("MEMWAL_ACCOUNT_ID is a 32-byte object id", HEX64.test(env.MEMWAL_ACCOUNT_ID || ""), "0x + 64 hex"));
  checks.push(check("MEMWAL_AGENT_ID present", Boolean(env.MEMWAL_AGENT_ID), null));

  // 3. on-chain proof that the account id is the MemWalAccount OBJECT, not the wallet
  let accountType = null;
  try {
    const obj = await tatum.readObjectType(env.MEMWAL_ACCOUNT_ID);
    accountType = obj.typeRepr;
    checks.push(check("account id resolves on-chain to a MemWalAccount object",
      /::account::MemWalAccount$/.test(accountType || ""),
      accountType || "no move type"));
  } catch (e) {
    checks.push(check("account id resolves on-chain to a MemWalAccount object", false, e.message));
  }

  // 4. relayer health (>= 30 s timeout)
  let relayer = null;
  try {
    const h = await client.health();
    relayer = {
      status: h.status ?? null,
      version: h.version ?? null,
      mode: h.mode ?? null,
      write_ready: h.write_ready ?? null,
      build: h.build ?? h.commit ?? null,
    };
    checks.push(check("relayer health reachable", true, `${relayer.status} v${relayer.version} (${relayer.mode})`));
  } catch (e) {
    checks.push(check("relayer health reachable", false, e.message));
  }

  // 5. the delegate key + account are accepted by the relayer (authenticated read)
  try {
    const res = await client.listMemories({ namespace, limit: 100 });
    const count = (res.memories || []).length;
    checks.push(check("authenticated read of the namespace succeeds", true,
      `${count} memories listed${res.must_resync ? ", must_resync" : ""}`));
  } catch (e) {
    checks.push(check("authenticated read of the namespace succeeds", false, e.message));
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, relayer };
}

/**
 * Retry wrapper for relayer calls that are known to be flaky (health, preflight).
 * Exponential backoff, >= 30 s per attempt.
 */
export async function withRetries(fn, { attempts = 3, baseMs = 1000, label = "relayer" } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts) break;
      const wait = Math.min(15000, baseMs * 2 ** (i - 1));
      console.error(`[${label}] attempt ${i}/${attempts} failed (${e.message}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}
