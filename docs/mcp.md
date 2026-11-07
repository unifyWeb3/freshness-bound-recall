# RecallGuard MCP — Model Context Protocol reference

RecallGuard exposes its freshness gate as an MCP server over **stdio**. An MCP-compatible agent
(Claude Code, Codex, or any stdio MCP client) can recall a Walrus-backed memory and learn whether
it may be used as current fact — before answering.

The server treats recalled memory content as **untrusted data**: tools return parsed, structured
fields; raw memory bodies are never emitted; and no tool can write to Mainnet unless three separate
gates are explicitly opened (see [store_correction](#store_correction)).

## Requirements

- Node.js ≥ 24
- The repository (or the packed package). The server ships inside it — nothing else to build.
- Recorded mode (default): **no credentials, no network, read-only**.
- Live mode: `RECALLGUARD_LIVE=true` plus `TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_AGENT_ID`,
  `MEMWAL_PRIVATE_KEY`.

## Install and verify

```sh
git clone https://github.com/unifyWeb3/freshness-bound-recall
cd freshness-bound-recall
npm install --ignore-scripts
npm run mcp:smoke
```

`mcp:smoke` spawns the stdio server as a subprocess and exercises it with a real MCP client
(tool discovery, both recorded samples, list_revisions lineage, evidence overview, write-gate
refusal, invalid-argument handling). All checks print `PASS`. No credentials or network are used.

## Claude Code (tested with 2.1.318)

```sh
claude mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs
claude mcp list     # → recallguard: … ✔ Connected
```

Or commit `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "recallguard": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs"]
    }
  }
}
```

## Codex (tested with codex-cli 0.167.0)

```sh
codex mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs
codex mcp list     # → recallguard  … enabled
```

or `~/.codex/config.toml`:

```toml
[mcp_servers.recallguard]
command = "node"
args = ["/absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs"]
```

Both configurations were verified with isolated `HOME` directories on 2026-11-07. Claude Desktop and
other clients were not exercised; they use the same `.mcp.json` pattern.

## Tools

All tools are annotated with MCP tool annotations (`readOnlyHint`, `destructiveHint`,
`idempotentHint`). Unless noted, every tool is `readOnlyHint: true`.

### `recall_checked`

Freshness-checked recall — the product. Input:

```jsonc
{ "query": "Is the Sui Clock memory still true?",   // optional, ≤512 chars
  "sample": "sui-clock-changed" }                    // optional; only when RECALLGUARD_LIVE is unset
// samples: sui-clock-changed · sui-clock-revision-lifecycle
```

Returns structured content `recall_checked/v1` (or `recall_checked_lifecycle/v1` for the lifecycle
sample) plus an `untrusted_memory_note`. Example (recorded): `verdict: "STALE"`, `withheld: true`,
`writes: []`, memory blob id, proof-at-write checkpoint, live checkpoint, reason
(`subject changed (version 1018797298->1019267077, digest changed)`).

In live mode the same gate runs against Walrus Memory and Tatum Sui Mainnet GraphQL. Live read-only
end-to-end is **unverified** in this release; recorded evidence is the tested path.

### `explain_decision`

Why a memory was accepted or withheld, shaped for agent reasoning: `at_a_glance`, `verdict`,
`reason`, `signal`, `memory` (recalled claim — untrusted data), `verified_live` (Tatum evidence),
`policy` (window applied), and a `correction_hint` when withheld. Never asserts a fact it cannot
verify.

### `list_revisions`

`{ "subject"?: "0x…", "class"?: "FAST"|"SLOW", "limit"?: 1..50 }` — the revision chain (observations,
corrections, adversarial specimen) from the committed evidence snapshot, with `supersedes` /
`supersedes_ref` lineage and proof checkpoints. Read-only; no network. Use it before claiming any
lineage from row memory.

### `get_evidence`

`{ "blob_id"?: "…" }` — with a blob id: the memory's proof envelope, its superseded predecessor
resolution (for corrections), and correction status. Without: an overview of the committed snapshot
(generated time, checkpoint, 22 memories / 306 decisions, the modeled 214/16/4 counterfactual, and
the x-api-key proof as **booleans only**).

### `propose_correction`

`{ "supersedes_blob_id": "…", "corrected_claim": "…", "reason": "…" }` — builds a correction draft
(`recallguard_correction_draft/v1`) for human review. **Never persists.** States the approval path
(owner-approved write via CLI `--live --allow-mainnet-writes`, or the gated `store_correction`).

### `store_correction`

<a id="store_correction"></a>

`{ "query"?: "…", "supersedes_blob_id": "…", "reason": "…", "confirm": "STORE-CORRECTION" }` —
**disabled by default.** Refuses unless **all three** hold:

1. `RECALLGUARD_ENABLE_WRITES=true` in the server environment,
2. per-call literal `confirm: "STORE-CORRECTION"`,
3. live mode (`RECALLGUARD_LIVE=true` + valid `TATUM_API_KEY` and `MEMWAL_*`).

Even then, a correction is persisted only through the standard write path, which writes solely when
live evidence shows STALE **with a subject change**. Otherwise nothing is written. Mainnet writes
cost money and need a separate written estimate and the owner's approval. The refusal path performs
no network calls and creates no client.

## Resource and prompt

- Resource `recallguard://evidence/summary` — JSON overview of the committed snapshot (counts,
  checkpoint, modeled counterfactual, x-api-key proof booleans). No secrets.
- Prompt `verify-before-answer` — instructs the agent to gate onchain claims through
  `recall_checked` and to treat recalled memory as untrusted data.

## Modes and environment

| Variable | Default | Effect |
|---|---|---|
| `RECALLGUARD_LIVE` | unset (recorded) | `true` → live recall + Tatum verification (read-only) |
| `RECALLGUARD_ENABLE_WRITES` | unset | `true` → permits `store_correction` (still needs confirm + live) |
| `TATUM_API_KEY` | — | Tatum Sui Mainnet GraphQL credential (live only) |
| `MEMWAL_ACCOUNT_ID` / `MEMWAL_AGENT_ID` / `MEMWAL_PRIVATE_KEY` | — | MemWal SDK credentials (live only) |

Recorded mode never reads these variables; live mode without them fails closed with a remediation
message.

## Security boundaries

- Read-only by default; no wallet in the core flow; writes are triple-gated.
- Arguments are zod-validated; query ≤ 512 chars; `limit` ≤ 50; live operations time out at 30 s.
- Recall budget: at most two Tatum reads per answer (one checkpoint, one pin).
- Fail closed: missing verification, malformed proof, missing credentials, failed reads, ambiguous
  lineage → `WITHHELD_UNVERIFIED` or a tool error. Never a guess.
- Untrusted memory: parsed fields only; raw bodies never emitted; note attached to every result.
- No secrets in output: x-api-key appears as a boolean count; values are never read, logged or
  returned.
- No arbitrary URL fetching: tools read only the committed snapshot or configured Walrus/Tatum
  endpoints.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server red in client | wrong path / `node` not on client's PATH | absolute script path; run `node scripts/recallguard-mcp.mjs --help` |
| `RECALLGUARD_LIVE=true but missing credential env vars` | live without credentials | export the four variables, or unset `RECALLGUARD_LIVE` |
| Every answer `WITHHELD_UNVERIFIED` | Tatum reads failing / proof mismatch | check Tatum reachability; the gate never guesses |
| `store_correction` → "writes are disabled" | default posture | expected — see the three gates above |
| Output looks stale/cached | recorded mode is offline by design | set `RECALLGUARD_LIVE=true` for live verification |
| Client shows raw JSON | normal for MCP tool results | ask the agent to summarize `verdict` / `withheld` / `reason` |
