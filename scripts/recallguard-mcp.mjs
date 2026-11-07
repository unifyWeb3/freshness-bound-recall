#!/usr/bin/env node
// RecallGuard MCP server over stdio.
//
//   recallguard-mcp            # start the stdio MCP server
//   recallguard-mcp --help     # print configuration help
//
// Logs go to stderr only; stdout carries the MCP protocol.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRecallGuardMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../src/mcp.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stderr.write(`RecallGuard MCP server (stdio) v${MCP_SERVER_VERSION}

Starts the Model Context Protocol server on stdin/stdout. Configure it in an
MCP-compatible client, for example:

  Claude Code:  claude mcp add recallguard -- npx -y recallguard-mcp
  Codex (TOML): [mcp_servers.recallguard]
                command = "npx"
                args = ["-y", "recallguard-mcp"]

or run the local checkout:  node scripts/recallguard-mcp.mjs

Modes:
  default               recorded Mainnet evidence, offline, read-only
  RECALLGUARD_LIVE=true live Walrus recall + Tatum Sui Mainnet GraphQL (read-only)
  RECALLGUARD_ENABLE_WRITES=true  allow store_correction (requires live mode and
                        per-call confirm="STORE-CORRECTION"); costs Mainnet writes.

No wallet is required for the default read-only flow. No credentials are
needed for the recorded mode.
`);
  process.exit(0);
}

const server = createRecallGuardMcpServer();
const transport = new StdioServerTransport();

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

await server.connect(transport);
process.stderr.write(`[${MCP_SERVER_NAME}] MCP server v${MCP_SERVER_VERSION} running on stdio\n`);
