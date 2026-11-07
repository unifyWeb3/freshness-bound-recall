# RecallGuard

**Your agent remembers. RecallGuard checks whether its memory is still true.**

AI agents reuse remembered facts after the world they describe has changed. A wallet agent can
quote a balance, config or object version that was accurate yesterday and freshly wrong today.
RecallGuard is the freshness gate for AI-agent memory: every recalled Walrus-backed memory is
checked against current Sui state through Tatum Sui Mainnet GraphQL before it may be used as an
answer. Changed or unverifiable claims are withheld — the verified value is used instead.

The gate is deterministic. There is no LLM between recall and the verdict.

```text
recall_checked: obs-sui-clock-341742463
  Walrus blob proof   checkpoint 341742463 · version 1018797298
  Tatum verification  checkpoint 341868687 · version 1019267077, digest changed
  verdict             WITHHELD — the old memory was not used as the answer
```

## The problem

| Recalled state | Risk without a gate | RecallGuard |
|---|---|---|
| The subject changed | An old value is returned as current | `STALE`; memory is withheld and the verified live value is shown |
| The subject is unchanged but the memory is old | A fixed timeout produces false staleness | `FALSE-STALE`; the learned window can widen |
| The subject changed inside the current window | A loose window misses a change | `MISSED-CHANGE`; the learned window can tighten |
| Verification is missing or malformed | The system guesses | Fails closed with `WITHHELD_UNVERIFIED` |
| A correction supersedes an observation | History is overwritten or disconnected | Both records remain addressable through explicit `supersedes` lineage |

## Quickstart — 60 seconds, zero credentials

Requirements: Node.js 24 or newer.

```sh
git clone https://github.com/unifyWeb3/freshness-bound-recall
cd freshness-bound-recall
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle
```

The replay needs no wallet, API key, `.env`, or Mainnet write permission. The recorded sample makes
no network calls and writes nothing:

```text
RecallGuard · recorded Mainnet lifecycle · read-only
STALE → FRESH → STALE
Predecessor: obs-sui-clock-341742424 · goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY
Correction:  cor-sui-clock-341742463 · mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY
```

`FRESH` is a deterministic replay at the correction's proof time; the historical later event
recalled proof-equivalent observation `zAji1w8p…`, not the correction blob — the contract discloses
that distinction.

## MCP — the product, not an adapter

RecallGuard speaks the Model Context Protocol over stdio. Point an MCP-compatible agent at it and
enforce the gate on every onchain claim it makes:

```jsonc
// .mcp.json — or run: claude mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs
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

```toml
# ~/.codex/config.toml — or run: codex mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs
[mcp_servers.recallguard]
command = "node"
args = ["/absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs"]
```

Both configurations were run with isolated `HOME`s (Claude Code 2.1.318 reports
`recallguard: … ✔ Connected`; codex-cli 0.167.0 lists the server `enabled`). Full reference,
tool documentation and troubleshooting: [docs/mcp.md](docs/mcp.md).

Tools (all read-only except the explicitly gated write):

| Tool | What it does |
|---|---|
| `recall_checked` | Freshness-checked recall — returns the `recall_checked/v1` structured decision |
| `explain_decision` | Why the memory was accepted or withheld; evidence, policy, lineage |
| `list_revisions` | Revision chain + `supersedes` relationships from the committed snapshot |
| `get_evidence` | Provenance and verification evidence behind a blob id |
| `propose_correction` | Drafts a correction for review — never persists |
| `store_correction` | Persists only with `RECALLGUARD_ENABLE_WRITES=true` + `confirm="STORE-CORRECTION"` + live mode |

```text
agent → recall_checked({ "sample": "sui-clock-changed" })
→ verdict: STALE · withheld: true · the remembered value is NOT returned as current fact
```

## CLI

```sh
npm run recall:checked -- --sample sui-clock-revision-lifecycle   # recorded, offline
npm run recall:checked -- --sample sui-clock-changed --json        # recorded, JSON contract
npm run recall:checked -- --live --query "Is the Sui Clock memory still true?"   # live read-only (credentials)
```

Live mode reads credentials from `.env`/environment: `TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID`,
`MEMWAL_AGENT_ID`, `MEMWAL_PRIVATE_KEY`. It runs a credential self-test first and refuses on
failure. Writing memories requires the additional `--allow-mainnet-writes` flag. See
[docs/docs.html](https://freshness-bound-recall-oxunify.vercel.app/docs.html) (CLI reference) or
`recall_checked --help`.

## JavaScript API

```js
import { recallChecked, recallCheckedSample } from "recallguard";

const result = await recallCheckedSample({ sample: "sui-clock-changed" });
// result.verdict === "STALE" · result.withheld === true · result.writes.length === 0
```

`recallChecked(query, { store, tatum, allowWrites = false, ... })` accepts injectable Walrus and
Tatum clients; writes are impossible without `allowWrites: true`. Stable contracts:
`recall_checked/v1`, `recall_checked_lifecycle/v1`.

## How it works

```text
query
  │
  ├─ recall candidate from Walrus Memory (MemWal SDK)
  │    └─ parse the FR-v1 proof envelope (chain id · checkpoint · version/digest · read time)
  ├─ load per-class policy memory (FALSE-STALE widens · MISSED-CHANGE tightens)
  ├─ freshness gate — fail closed
  │    ├─ latest Sui checkpoint via Tatum GraphQL — at most 1 cached read (1 s)
  │    ├─ current subject version + digest        — at most 1 read
  │    └─ wall-clock backstop
  ├─ FRESH → answer from verified memory
  └─ STALE / WITHHELD_UNVERIFIED → withhold memory and explain why
       └─ correction write only with explicit allow-writes + approval
```

| Component | Role | Path |
|---|---|---|
| MCP server | stdio, six tools, read-only default | [`scripts/recallguard-mcp.mjs`](scripts/recallguard-mcp.mjs) + [`src/mcp.mjs`](src/mcp.mjs) |
| Public CLI | Recorded replay and live read-only entry point | [`scripts/recall-checked.mjs`](scripts/recall-checked.mjs) |
| JavaScript contract | Stable `recall_checked/v1` responses | [`src/recall-checked.mjs`](src/recall-checked.mjs) |
| Gate | Window, subject pin, wall-clock, fail-closed validation | [`src/gate.mjs`](src/gate.mjs) |
| Policy engine | Loads and learns bounded per-class windows | [`src/policy.mjs`](src/policy.mjs) |
| Tatum transport | Sui Mainnet GraphQL reads, caching, retry, request budget | [`src/tatum.mjs`](src/tatum.mjs) |
| Walrus memory layer | Recall, parsing, correction lineage, policy records | [`src/store.mjs`](src/store.mjs) |
| Evidence | 22 memories, 306 checkpoint-stamped decisions | [`docs/evidence/proof-snapshot.json`](docs/evidence/proof-snapshot.json) |

## Why ordinary memory retrieval is not enough

A vector search can only tell you what a memory *sounds* like. It cannot tell you whether the
underlying object moved. For mutable onchain facts — object versions, clocks, registries, config —
the only thing that makes a remembered answer usable is proof that its evidence still holds:

- a **checkpoint proof** at write time vs. the latest checkpoint now;
- a **subject pin** (version + digest) at write time vs. the pin now;
- a **wall-clock backstop** for slow drift;
- and **lineage**: when the world moved, a correction supersedes the old record instead of
  overwriting or hiding it.

RecallGuard is that check, as a library, a CLI and an MCP server — with the memory itself
(freshness policy windows) persisted in Walrus Memory so the system's own tolerance adapts.

## Evidence

Everything is replayable from the committed snapshot; nothing below is asserted from adjectives.

- **22 recorded Mainnet memories** in namespace `freshness-recall`: 7 observer observations,
  4 corrections, 2 learned-policy records, 1 pre-fix adversarial specimen, 8 live round-trip seeds.
- **306 checkpoint-stamped decisions.** In the ungated path the recorded log divides into
  **214 changed answers**, **16 unchanged-but-old answers**, **4 unverified answers** — a modeled
  counterfactual analysis of the recorded log, not production incidents.
- **The learned policy changed a real verdict**: the same observation replayed under the built-in
  5,000 checkpoint window reads `STALE / FALSE-STALE`; under the persisted Walrus policy window of
  20,000 it reads `FRESH / CONSISTENT`. Deterministic replay, not autonomous learning.
- **A real revision aged before persistence**: a correction took 117,242 ms to reach Walrus; the
  first later check (1,381 ms later) already read a changed subject — `STALE → FRESH → STALE`.
- **Tatum access discipline**: `x-api-key` present on every measured request (21/21 in the
  measurement run, 7/7 in the final snapshot, 2,208/2,208 in the longer page run); plan header
  observed; ≤ 2 reads per answer; exponential backoff on 429.

Labels matter: **recorded** (captured from Mainnet), **offline replay** (deterministic, this
repository), **live** (requires credentials; unverified end-to-end in this release), **modeled**
(counterfactual analysis). Open [`docs/submission.md`](docs/submission.md) for the full field-by-field
claim ledger, and the hosted static export for a self-contained read.

## Safety contract

- Recorded samples are always read-only and offline.
- Live mode defaults to `allowWrites: false`; `--allow-mainnet-writes` is rejected outside live mode.
- MCP `store_correction` refuses unless `RECALLGUARD_ENABLE_WRITES=true` **and** per-call
  `confirm="STORE-CORRECTION"` **and** live mode with a passing credential self-test.
- Untrusted memory: recalled content is data, never instructions; raw memory bodies are never emitted.
- Secrets are redacted, and scanned in the tree and full git history (`npm run audit:secrets`,
  `node scripts/audit-history.mjs`).
- Walrus records are immutable; revisions use `supersedes` lineage instead of update/delete.
- Fail closed everywhere: missing credentials, malformed proof, failed reads, ambiguous lineage.

## Honest limits

- **Live read-only CLI is unverified end to end.** Unit tests cover arguments, missing credentials,
  injected behaviour and recorded samples; no committed transcript runs the installable CLI against
  Mainnet with real credentials.
- **No user study exists.** The wallet/treasury-agent persona is a hypothesis. No users,
  testimonials, revenue or retention are claimed.
- **The 214/16/4 split is modeled** from the recorded decision log — counterfactual analysis, not
  production incidents.
- **The latest learned SLOW window (40,000) was never persisted.** The stored policy remains
  20,000 — tighter, more conservative. FAST (25) is cadence-limited below its sampling interval.
- **Walrus retention (`end_epoch`) is unknown.** The committed snapshot stays reproducible offline.
- **Signatures are not verified.** Proof digests are compared as data; there is no attestation claim.
- **Docker is unverified** (written, never built — no Docker daemon in the build environment).
- **The hosted page is a labelled static snapshot**, not a live service.
- **Tatum AI Builder was not used.** This project uses Tatum's Sui Mainnet GraphQL gateway only.

## Roadmap

1. **Publish the package** to npm as `recallguard` (name reserved; publish needs owner approval).
2. **Close the live loop**: owner-approved, cost-estimated Mainnet write verification of the full
   CLI path; publish the transcript.
3. **Walrus MCP complement**: evaluate the official Walrus Memory MCP as a substrate; RecallGuard's
   gate stays responsible for freshness decisions.
4. **CI by default** (the reference builders' one shared discipline worth copying).
5. **Remote MCP transport** only if a hosted agent surface becomes a real requirement.
6. Releases with tags and a changelog.

## Tests and audits

```sh
npm test                    # 149 tests, offline
npm run audit:secrets       # working-tree secret scan
node scripts/audit-history.mjs  # full git history scan
npm run mcp:smoke           # stdio MCP server end-to-end smoke test
npm run export              # static four-page export with secret scan
```

`npm run test:live` is intentionally opt-in and performs real Walrus writes — do not run it without
explicit approval and a cost estimate.

## Links

| Resource | Link |
|---|---|
| MCP reference | [`docs/mcp.md`](docs/mcp.md) |
| 60-second judge guide | [`docs/judge-60s.md`](docs/judge-60s.md) |
| Evidence snapshot | [`docs/evidence/proof-snapshot.json`](docs/evidence/proof-snapshot.json) |
| Hosted static snapshot | <https://freshness-bound-recall-oxunify.vercel.app> |
| Blog draft | [`docs/blog.md`](docs/blog.md) |
| Video script | [`docs/video-script.md`](docs/video-script.md) |
| Repository | <https://github.com/unifyWeb3/freshness-bound-recall> |

## License

Apache-2.0. Tatum Sui Mainnet GraphQL and Walrus Memory are third-party services and are not
bundled with this repository.
