import { recallChecked, recallCheckedSample, DEFAULT_SAMPLE_QUERY, RECORDED_SAMPLE_NAME } from "./recall-checked.mjs";
import { createRuntime } from "./runtime.mjs";
import { credentialSelfTest } from "./mainnet.mjs";
import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";
import { resolve } from "node:path";

export const HELP = `Freshness-Bound Recall

Usage:
  recall_checked [--sample ${RECORDED_SAMPLE_NAME}] [--query <text>] [--json]
  recall_checked --live --query <text> [--json]
  recall_checked --live --allow-mainnet-writes --query <text> [--json]

Modes:
  --sample [name]            Run labelled recorded Mainnet evidence with no
                             wallet, API key, network access, or writes.
                             Default sample: ${RECORDED_SAMPLE_NAME}
  --live                     Recall from Walrus Memory and verify through
                             Tatum Sui Mainnet GraphQL. Reads credentials from
                             process env or .env in the current directory.

Safety:
  Live mode is READ-ONLY by default.
  --allow-mainnet-writes     Explicitly allow correction/policy memories to be
                             written to Walrus. This can incur Mainnet cost and
                             must not be used without the account owner's approval.

Output:
  --json                     Print the stable recall_checked/v1 JSON contract.
  --help, -h                 Show this help.
`;

function valueAfter(args, flag) {
  const equals = args.find((arg) => arg.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const index = args.indexOf(flag);
  const next = index >= 0 ? args[index + 1] : undefined;
  return next !== undefined && !next.startsWith("-") ? next : null;
}

function parseArgs(args) {
  const live = args.includes("--live");
  const allowWrites = args.includes("--allow-mainnet-writes");
  const json = args.includes("--json");
  const help = args.includes("--help") || args.includes("-h");
  const query = valueAfter(args, "--query") || DEFAULT_SAMPLE_QUERY;
  const sampleFlag = args.includes("--sample") || args.some((arg) => arg.startsWith("--sample="));
  const sample = valueAfter(args, "--sample") || RECORDED_SAMPLE_NAME;
  const known = new Set(["--live", "--allow-mainnet-writes", "--json", "--help", "-h", "--sample", "--query"]);
  const booleans = new Set(["--live", "--allow-mainnet-writes", "--json", "--help", "-h"]);
  const unknown = args.filter((arg, index) => {
    if (!arg.startsWith("-")) {
      return index === 0 || !["--sample", "--query"].includes(args[index - 1]);
    }
    if (arg.includes("=")) {
      const flag = arg.slice(0, arg.indexOf("="));
      return !known.has(flag) || booleans.has(flag);
    }
    return !known.has(arg);
  });
  return { live, allowWrites, json, help, query, sample, sampleFlag, unknown };
}

function printHuman(result, write) {
  write(`Freshness-Bound Recall · ${result.mode} · ${result.read_only ? "read-only" : "writes enabled"}\n`);
  write(`${result.verdict}\n`);
  write(`${result.answer}\n`);
  write(`Memory: ${result.memory?.claim || "none"} · ${result.memory?.blob_id || "no blob"}\n`);
  write(`Stored: checkpoint ${result.memory?.proof_at_write?.checkpoint_seq ?? "—"} · version ${result.memory?.proof_at_write?.object_version ?? "—"}\n`);
  write(`Checked: checkpoint ${result.verification?.checkpoint?.checkpoint_seq ?? "—"} · version ${result.verification?.subject?.version ?? "—"}\n`);
  write(`Reason: ${result.reason}\n`);
  write(`Writes: ${result.writes.length ? result.writes.map((item) => item.type).join(", ") : "none"}\n`);
}

export async function runRecallCheckedCli(args = process.argv.slice(2), {
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
} = {}) {
  const opts = parseArgs(args);
  if (opts.help) {
    stdout(HELP);
    return 0;
  }
  if (opts.unknown.length) {
    stderr(`Unknown argument: ${opts.unknown.join(", ")}\n\n${HELP}`);
    return 2;
  }
  if (opts.live && opts.sampleFlag) {
    stderr("Choose either --live or --sample, not both.\n");
    return 2;
  }
  if (opts.allowWrites && !opts.live) {
    stderr("--allow-mainnet-writes is valid only with --live. The recorded sample is always read-only.\n");
    return 2;
  }

  try {
    let result;
    if (!opts.live) {
      result = await recallCheckedSample({ query: opts.query, sample: opts.sample });
    } else {
      const log = (line) => stderr(`${line}\n`);
      const rt = createRuntime({
        live: true,
        envPath: resolve(process.cwd(), ".env"),
        environment: process.env,
        ledgerPath: null,
        mirrorPath: null,
        logger: log,
      });
      const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
      for (const check of self.checks) log(`[self-test] ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
      if (!self.ok) throw new Error("credential self-test failed; refusing to recall or write");
      result = await recallChecked(opts.query, {
        store: rt.store,
        tatum: rt.tatum,
        policy: rt.policy,
        ledger: rt.ledger,
        agentId: rt.env.MEMWAL_AGENT_ID || "",
        chainId: SUI_MAINNET_CHAIN_ID,
        allowWrites: opts.allowWrites,
        logger: log,
        mode: "live-mainnet",
        source: {
          namespace: rt.namespace,
          walrus: "Walrus Memory Mainnet",
          chain: "Sui Mainnet through Tatum GraphQL",
        },
      });
    }

    if (opts.json) stdout(`${JSON.stringify(result, null, 2)}\n`);
    else printHuman(result, stdout);
    return 0;
  } catch (error) {
    stderr(`recall_checked: ${error?.message || error}\n`);
    return 1;
  }
}
