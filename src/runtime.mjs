// Runtime assembly: one call builds the whole agent (memory store, Tatum
// client, policy engine, decision ledger) for either the mock backend
// (offline) or mainnet.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadEnv, Redactor } from "./redact.mjs";
import { TatumClient } from "./tatum.mjs";
import { MockStore, MemWalStore } from "./store.mjs";
import { PolicyEngine } from "./policy.mjs";
import { Ledger } from "./ledger.mjs";
import { createMemWalClient, NAMESPACE } from "./mainnet.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = resolve(ROOT, ".env");
export const LEDGER_PATH = resolve(ROOT, "data/ledger.jsonl");
export const MIRROR_PATH = resolve(ROOT, "data/policy-mirror.json");
export const CACHE_DIR = resolve(ROOT, "data/cache");
export const CREDENTIAL_ENV_KEYS = [
  "TATUM_API_KEY",
  "MEMWAL_ACCOUNT_ID",
  "MEMWAL_AGENT_ID",
  "MEMWAL_PRIVATE_KEY",
];

export function readEnv(path = ENV_PATH) {
  return loadEnv(path);
}

/**
 * @param {object} opts
 * @param {boolean} opts.live      use the mainnet Walrus Memory backend
 * @param {boolean} opts.offline   Tatum client serves cached data only
 * @param {string}  opts.namespace Walrus Memory namespace
 * @param {string|null} opts.envPath path to an optional dotenv file
 * @param {object|null} opts.environment credential values that override dotenv
 */
export function createRuntime({
  live = false,
  offline = false,
  namespace = NAMESPACE,
  envPath = ENV_PATH,
  environment = null,
  ledgerPath = LEDGER_PATH,
  mirrorPath = MIRROR_PATH,
  logger = (m) => console.log(m),
} = {}) {
  const hasEnvFile = typeof envPath === "string" && existsSync(envPath);
  const fileEnv = hasEnvFile ? readEnv(envPath) : {};
  const suppliedEnv = environment && typeof environment === "object"
    ? Object.fromEntries(CREDENTIAL_ENV_KEYS
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, environment[key]]))
    : {};
  // Callers opt in to process-environment credentials by supplying
  // `environment`; legacy repository scripts remain dotenv-only by default.
  const env = { ...fileEnv, ...suppliedEnv };
  const missingCredentials = CREDENTIAL_ENV_KEYS.filter((key) => !env[key]);
  if (live && missingCredentials.length) {
    throw new Error(
      `live mode requires credentials from ${envPath || "a .env file"} or the process environment; ` +
      `missing: ${missingCredentials.join(", ")}`,
    );
  }
  // A fresh clone still runs without credentials; callers may source them
  // from the selected dotenv file, an explicit environment object, or both.
  const redactor = Redactor.fromEnv(env);
  const log = (m) => logger(redactor.line(m));

  const tatum = new TatumClient({
    apiKey: env.TATUM_API_KEY,
    offline,
    logger: log,
  });

  let client = null;
  let store;
  if (live) {
    client = createMemWalClient({ env, namespace });
    store = new MemWalStore({ client, namespace });
  } else {
    store = new MockStore({ namespace });
  }

  const policy = new PolicyEngine({ store, mirrorPath });
  const ledger = new Ledger(ledgerPath, redactor);

  return { env, redactor, tatum, store, policy, ledger, client, namespace, live, log };
}
