// Runtime assembly: one call builds the whole agent (memory store, Tatum
// client, policy engine, decision ledger) for either the mock backend
// (offline) or mainnet.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

export function readEnv() {
  return loadEnv(ENV_PATH);
}

/**
 * @param {object} opts
 * @param {boolean} opts.live      use the mainnet Walrus Memory backend
 * @param {boolean} opts.offline   Tatum client serves cached data only
 * @param {string}  opts.namespace Walrus Memory namespace
 */
export function createRuntime({
  live = false,
  offline = false,
  namespace = NAMESPACE,
  ledgerPath = LEDGER_PATH,
  mirrorPath = MIRROR_PATH,
  logger = (m) => console.log(m),
} = {}) {
  const env = readEnv();
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
