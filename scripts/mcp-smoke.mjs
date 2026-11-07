#!/usr/bin/env node
// MCP smoke test over real stdio: spawns the server as a subprocess and
// exercises it with an actual MCP client. Exits non-zero on any failure.
//
//   node scripts/mcp-smoke.mjs
//
// No credentials, network access, or writes are used or required.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(root, "scripts/recallguard-mcp.mjs");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { PATH: process.env.PATH || "/usr/bin:/bin" },
  stderr: "pipe",
});
const client = new Client({ name: "recallguard-smoke", version: "0.0.0" }, { capabilities: {} });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  check("server lists the six tools", ["recall_checked", "explain_decision", "list_revisions", "get_evidence", "propose_correction", "store_correction"].every((name) => names.includes(name)), names.join(","));

  const decision = await client.callTool({ name: "recall_checked", arguments: { sample: "sui-clock-changed" } });
  const decisionJson = decision.structuredContent;
  check("recall_checked returns WITHHELD/STALE for the stale memory", decisionJson?.verdict === "STALE" && decisionJson?.withheld === true, decisionJson?.verdict);
  check("writes are zero", (decisionJson?.writes || []).length === 0);

  const lifecycle = await client.callTool({ name: "recall_checked", arguments: { sample: "sui-clock-revision-lifecycle" } });
  check("lifecycle replay shows STALE → FRESH → STALE", JSON.stringify(lifecycle.structuredContent?.behavior?.sequence) === JSON.stringify(["STALE", "FRESH", "STALE"]));

  const explanation = await client.callTool({ name: "explain_decision", arguments: { sample: "sui-clock-changed" } });
  check("explain_decision marks the memory untrusted", typeof explanation.structuredContent?.untrusted_memory_note === "string");

  const revisions = await client.callTool({ name: "list_revisions", arguments: { class: "FAST", limit: 5 } });
  check("list_revisions returns revisions with lineage", (revisions.structuredContent?.revisions || []).some((r) => r.supersedes));

  const evidence = await client.callTool({ name: "get_evidence", arguments: {} });
  check("get_evidence overview reports 22 memories / 306 decisions", evidence.structuredContent?.memory_count === 22 && evidence.structuredContent?.decision_count === 306);

  const gated = await client.callTool({
    name: "store_correction",
    arguments: {
      query: "q",
      supersedes_blob_id: "mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY",
      reason: "smoke test must never write",
      confirm: "STORE-CORRECTION",
    },
  });
  check("store_correction is refused by default (no write path reached)", gated.isError === true && /writes are disabled/i.test(gated.content?.[0]?.text || ""));

  const invalid = await client.callTool({ name: "recall_checked", arguments: { sample: "nope" } });
  check("invalid arguments are rejected", invalid.isError === true);

  await client.close();
} catch (error) {
  console.error(`MCP smoke test failed: ${error?.message || error}`);
  failed += 1;
}

console.log(failed === 0 ? "\nMCP smoke test: all checks passed (stdio, read-only, recorded evidence)." : `\nMCP smoke test: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
