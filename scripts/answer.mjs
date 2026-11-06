#!/usr/bin/env node
// Answer one query through the freshness gate.
//
//   node scripts/answer.mjs --query "Is the Sui clock still at the recorded version?"
//   node scripts/answer.mjs --live --query "..."        # mainnet memories + live Tatum reads
//   node scripts/answer.mjs --live --offline --query "" # mainnet memories, cached Tatum only
//
// No LLM is involved: the answer is a template over verified data.

import { createRuntime } from "../src/runtime.mjs";
import { answer } from "../src/answer.mjs";
import { credentialSelfTest } from "../src/mainnet.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../src/tatum.mjs";

const args = process.argv.slice(2);
const getArg = (n, d = null) => {
  const flag = `--${n}`;
  const equals = args.find((x) => x.startsWith(`${flag}=`));
  if (equals) return equals.slice(flag.length + 1);
  const index = args.indexOf(flag);
  const next = index >= 0 ? args[index + 1] : undefined;
  return next !== undefined && !next.startsWith("--") ? next : d;
};
const has = (n) => args.includes(`--${n}`);

const live = has("live");
const offline = has("offline");
const query = getArg("query", "Is the Sui clock object still at the recorded version?");
const json = has("json");

const rt = createRuntime({ live, offline });
rt.log(`[answer] mode=${live ? "mainnet" : "mock"}${offline ? "/offline-tatum" : ""} query="${query}"`);

if (live) {
  const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
  for (const c of self.checks) rt.log(`[self-test] ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  if (!self.ok) {
    console.error("[answer] credential self-test FAILED - refusing to answer");
    process.exit(1);
  }
}

// policy memory is read at startup
await rt.policy.load();
rt.log(`[policy] loaded from ${rt.policy.source}: ${JSON.stringify(rt.policy.snapshot())}`);

const out = await answer(query, {
  store: rt.store,
  tatum: rt.tatum,
  policy: rt.policy,
  ledger: rt.ledger,
  agentId: rt.env.MEMWAL_AGENT_ID || "",
  chainId: SUI_MAINNET_CHAIN_ID,
  writeCorrections: live,
  logger: rt.log,
});

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log("\n=== ANSWER ===");
  console.log(out.answer);
  console.log("\n=== DECISION ===");
  console.log(`verdict      : ${out.verdict}`);
  console.log(`reason       : ${out.reason}`);
  console.log(`signal       : ${out.signal}`);
  console.log(`subject      : ${out.subject_short}${out.subject_changed === true ? " (changed)" : ""}`);
  console.log(`memory       : ${out.memory?.claim ?? "-"} (${out.memory?.blob_id ?? "-"})`);
  console.log(`proof at write: cp ${out.memory?.proof_at_write?.checkpoint_seq ?? "-"} v${out.memory?.proof_at_write?.object_version ?? "-"}`);
  console.log(`live         : cp ${out.live?.checkpoint_seq ?? "-"} v${out.pin?.version ?? "-"} (${out.live?.source ?? "none"})`);
  console.log(`policy       : window ${out.policy?.before_window} -> ${out.policy?.after_window} (changed=${out.policy?.changed})`);
  console.log(`reads        : ${out.reads.checkpoint} checkpoint + ${out.reads.pin} pin (max ${out.reads.budget_max})`);
  console.log(`writes       : ${out.writes.map((w) => `${w.type}:${w.blob_id ?? w.error}`).join(", ") || "none"}`);
  console.log(`tatum plan   : ${rt.tatum.planHeader() ?? "-"}`);
}
