import {
  AVAILABLE_RECORDED_SAMPLES,
  DEFAULT_LIFECYCLE_QUERY,
  DEFAULT_SAMPLE_QUERY,
  RECALL_CHECKED_LIFECYCLE_SCHEMA,
  RECORDED_LIFECYCLE_SAMPLE_NAME,
  RECORDED_SAMPLE_NAME,
  recallChecked,
  recallCheckedLifecycleSample,
  recallCheckedSample,
} from "./recall-checked.mjs";
import { createRuntime } from "./runtime.mjs";
import { credentialSelfTest } from "./mainnet.mjs";
import { SUI_MAINNET_CHAIN_ID } from "./tatum.mjs";
import { resolve } from "node:path";

export const HELP = `RecallGuard

Usage:
  recall_checked [--sample <name>] [--query <text>] [--json]
  recall_checked --live --query <text> [--json]
  recall_checked --live --allow-mainnet-writes --query <text> [--json]

Modes:
  --sample [name]            Run labelled recorded Mainnet evidence with no
                             wallet, API key, network access, or writes.
                             Default sample: ${RECORDED_SAMPLE_NAME}
                             Available: ${AVAILABLE_RECORDED_SAMPLES.join(", ")}
  --live                     Recall from Walrus Memory and verify through
                             Tatum Sui Mainnet GraphQL. Reads credentials from
                             process env or .env in the current directory.

Safety:
  Live mode is READ-ONLY by default.
  --allow-mainnet-writes     Explicitly allow correction/policy memories to be
                             written to Walrus. This can incur Mainnet cost and
                             must not be used without the account owner's approval.

Output:
  --json                     Print the stable recall_checked/v1 or
                             recall_checked_lifecycle/v1 JSON contract.
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
  const sampleFlag = args.includes("--sample") || args.some((arg) => arg.startsWith("--sample="));
  const sample = valueAfter(args, "--sample") || RECORDED_SAMPLE_NAME;
  const defaultQuery = sample === RECORDED_LIFECYCLE_SAMPLE_NAME
    ? DEFAULT_LIFECYCLE_QUERY
    : DEFAULT_SAMPLE_QUERY;
  const query = valueAfter(args, "--query") || defaultQuery;
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
  if (result.schema === RECALL_CHECKED_LIFECYCLE_SCHEMA) {
    const predecessor = result.revision?.predecessor || {};
    const correction = result.revision?.correction || {};
    const atRevision = result.behavior?.at_revision_proof?.result || {};
    const postPersistence = result.behavior?.first_post_persistence_check?.result || {};
    const predecessorCheckpoint = predecessor.proof?.checkpoint_seq ?? predecessor.checkpoint?.sequence ?? "—";
    const correctionCheckpoint = correction.proof?.checkpoint_seq ?? correction.checkpoint?.sequence ?? "—";

    write(`RecallGuard · recorded Mainnet lifecycle · ${result.read_only ? "read-only" : "writes enabled"}\n`);
    write(`${(result.behavior?.sequence || ["STALE", "FRESH", "STALE"]).join(" → ")}\n`);
    write(`Predecessor: ${predecessor.claim || "unknown"} · ${predecessor.blob_id || "no blob"} · checkpoint ${predecessorCheckpoint}\n`);
    write(`Correction: ${correction.claim || "unknown"} · ${correction.blob_id || "no blob"} · checkpoint ${correctionCheckpoint}\n`);
    write(`Supersedes: ${correction.supersedes?.stored_reference || "unknown"} → ${correction.supersedes?.resolved_blob_id || "unresolved"}\n`);
    write(`Timing: persisted ${correction.persistence_delay_ms ?? "—"} ms after proof · first recorded check ${result.behavior?.first_post_persistence_check?.recorded_event?.milliseconds_after_persistence ?? "—"} ms later\n`);
    write(`At revision proof: ${atRevision.verdict || "unknown"} · ${atRevision.answer || atRevision.reason || "no result"}\n`);
    write(`First post-persistence check: ${postPersistence.verdict || "unknown"}${postPersistence.withheld ? "/WITHHELD" : ""} · ${postPersistence.reason || "no reason"}\n`);
    write(`Provenance: recorded Mainnet evidence · network off · Writes: ${result.writes?.length ? "present" : "none"}\n`);
    return;
  }
  write(`RecallGuard · ${result.mode} · ${result.read_only ? "read-only" : "writes enabled"}\n`);
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
      result = opts.sample === RECORDED_LIFECYCLE_SAMPLE_NAME
        ? await recallCheckedLifecycleSample({ query: opts.query, sample: opts.sample })
        : await recallCheckedSample({ query: opts.query, sample: opts.sample });
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
