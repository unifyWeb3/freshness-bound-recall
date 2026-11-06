# Freshness-Bound Recall

Freshness-Bound Recall prevents an agent from answering with an on-chain memory it can no longer
prove fresh. A recalled Walrus record is checked against a checkpoint window, the current Sui object
version and digest, and a wall-clock backstop before it can become an answer.

The critical path is deterministic: there is no LLM between recall and the gate.

## The problem

| Recalled state | Risk without a gate | Freshness-Bound Recall |
|---|---|---|
| The subject changed | An old value is returned as current | `STALE`; memory is withheld and the verified live value is shown |
| The subject is unchanged but the memory is old | A fixed timeout produces false staleness | `FALSE-STALE`; the learned window can widen |
| The subject changed inside the current window | A loose window misses a change | `MISSED-CHANGE`; the learned window can tighten |
| Verification is missing or malformed | The system guesses | Fails closed with `WITHHELD_UNVERIFIED` |
| A correction supersedes an observation | History is overwritten or disconnected | Both records remain addressable through explicit lineage |

## Try the recorded lifecycle in 60 seconds

Requirements: Node.js 24 or newer. The accepted runtime is pinned in [`.nvmrc`](.nvmrc).

```sh
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle
```

The replay needs no wallet, API key, `.env`, or Mainnet write permission. The recorded sample makes
no network calls and writes nothing.

```text
Freshness-Bound Recall · recorded Mainnet lifecycle · read-only
STALE → FRESH → STALE
Predecessor: obs-sui-clock-341742424 · goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY
Correction: cor-sui-clock-341742463 · mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY
Timing: persisted 117242 ms after proof · first recorded check 1381 ms later
Provenance: recorded Mainnet evidence · network off · Writes: none
```

The `FRESH` step is a deterministic replay at the correction's proof time. The historical later
event recalled proof-equivalent observation `zAji1w8p…`, not the correction blob itself; the contract
discloses that distinction.

Open the local proof page with:

```sh
npm run proof:offline
```

Then visit <http://127.0.0.1:8787>. It contains the same lifecycle, the checkpoint gate, full evidence
inventories, and the recorded learning-loop comparison.

## The learned policy changes a verdict

The freshness window is data stored in Walrus Memory, not a constant hidden in the application.
The homepage replays the same recorded Mainnet inputs under two policies:

| Input | Without stored policy | With Walrus policy memory |
|---|---|---|
| Observation blob `Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g`, checkpoint delta 18,155, subject pin unchanged | Window 5,000 → `STALE / FALSE-STALE` | Window 20,000 → `FRESH / CONSISTENT` |

The stored policy is `fc-policy-SLOW-v2`, blob
`Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`. It records the real learning step
10,000 → 20,000, learned at `2026-11-05T02:05:19.054Z` and written to Walrus later at
`2026-11-05T09:23:05.105Z`; it was not backdated.

Across the committed 306-decision snapshot, an ungated memory path would have produced:

- 214 changed answers
- 16 unchanged-but-old answers
- 4 unverified answers

The gated path answered only records it proved fresh.

## Architecture

```text
query
  │
  ├─ recall candidate from Walrus Memory
  │    └─ parse the FR-v1 proof envelope
  │
  ├─ load per-class policy memory
  │    ├─ FALSE-STALE   → widen window
  │    └─ MISSED-CHANGE → tighten window
  │
  ├─ freshness gate (fail closed)
  │    ├─ latest Sui checkpoint through Tatum      max 1 read
  │    ├─ current subject version + digest         max 1 read
  │    └─ wall-clock backstop
  │
  ├─ FRESH → answer from verified memory
  └─ STALE / UNVERIFIED → withhold memory and explain why
       └─ optional correction/policy write only with explicit write opt-in
```

| Component | Role | Path |
|---|---|---|
| Public CLI | Recorded replay and live read-only entry point | [`scripts/recall-checked.mjs`](scripts/recall-checked.mjs) |
| JavaScript contract | Stable `recall_checked/v1` and lifecycle responses | [`src/recall-checked.mjs`](src/recall-checked.mjs) |
| Gate | Window, subject pin, wall-clock, fail-closed validation | [`src/gate.mjs`](src/gate.mjs) |
| Policy engine | Loads and learns bounded per-class windows | [`src/policy.mjs`](src/policy.mjs) |
| Tatum transport | Sui Mainnet GraphQL reads, caching, retry, request budget | [`src/tatum.mjs`](src/tatum.mjs) |
| Walrus memory layer | Recall, parsing, correction lineage, policy records | [`src/store.mjs`](src/store.mjs) |
| Proof page | Static/offline and live evidence renderer | [`scripts/proof-page.mjs`](scripts/proof-page.mjs) |
| Recorded evidence | 22 memories and 306 checkpoint-stamped decisions | [`docs/evidence/proof-snapshot.json`](docs/evidence/proof-snapshot.json) |

## Public surfaces and verification status

| Surface | Status | What is proven |
|---|---|---|
| Recorded CLI samples | **VERIFIED** | Fresh install, stable JSON contracts, read-only defaults, zero network and zero writes |
| Recorded revision lifecycle | **VERIFIED** | Real blob lineage and deterministic `STALE → FRESH → STALE` behavior |
| Recorded learned-policy effect | **VERIFIED** | Same Mainnet inputs change from stale to fresh when the persisted policy is applied |
| Offline/static proof page | **VERIFIED** | Self-contained export, no browser requests, secret scan, desktop/mobile rendering |
| Live read-only CLI end to end | **UNVERIFIED** | Implemented, but no committed test or transcript runs the installable CLI against Mainnet with real credentials |
| MCP tool / agent adapter | **NOT DELIVERED** | No MCP server, transport, tool schema, entry point, dependency, or MCP test exists |
| Mainnet writes from this milestone | **NOT PERFORMED** | Writes require `--live --allow-mainnet-writes` and separate owner approval |

The live CLI requires all four credentials in the current working directory's environment or `.env`:
`TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_AGENT_ID`, and `MEMWAL_PRIVATE_KEY`.
Selecting `--live` remains read-only; writes require the additional `--allow-mainnet-writes` flag.

```sh
# UNVERIFIED end-to-end; do not run without credential-owner permission
npm run recall:checked -- --live --query "Is the Sui Clock memory still true?" --json
```

## Safety contract

- Recorded samples are always read-only and offline.
- Live mode defaults to `allowWrites: false`.
- `--allow-mainnet-writes` is rejected outside live mode.
- Missing credentials, malformed proof fields, ambiguous lineage, failed checkpoint reads, and failed
  subject-pin reads all fail closed.
- The answer path has a budget of at most two Tatum reads: one checkpoint and one subject pin.
- Secrets are redacted from logs and scanned in the tracked tree, generated export, and git history.
- Walrus records are immutable; revisions use `supersedes` lineage instead of update/delete claims.

## Honest limits

- **Live read-only CLI is unverified end to end.** Unit tests cover argument handling, missing
  credentials, dependency-injected behavior, and recorded samples. The opt-in live tests are not CLI
  tests and perform real Walrus writes.
- **MCP integration is absent.** The shipped integrations are the CLI and JavaScript API only.
- **The latest learned SLOW window is not persisted.** The observer later learned 40,000, while the
  stored policy remains 20,000. The stored value is tighter and therefore more conservative.
- **FAST learning is cadence-limited.** Its persisted 25-checkpoint window is shorter than the
  observer sampling interval, so the historical live loop is effectively frozen at that version.
- **Walrus retention is unknown.** The exact `end_epoch` for the recorded blobs was not available
  through the tools used for this project. The committed snapshot remains reproducible offline.
- **Docker is unverified.** The native command sequence passes, but the build environment had no
  Docker binary or socket.
- **No user study exists.** The operations-analyst persona remains a hypothesis.
- **The hosted page is an older published snapshot.** The current homepage milestone is local until
  the owner separately approves a push and deployment. That older snapshot was verified
  byte-identical to the deployed export; a new local export is not claimed to reproduce those bytes.

## Tests and audits

```sh
npm test
npm run audit:secrets
node scripts/audit-history.mjs
npm run export
```

The default suite is offline. `npm run test:live` is intentionally opt-in and performs real Walrus
writes; do not run it without explicit approval and a cost estimate.

## Links

| Resource | Link |
|---|---|
| 60-second judge guide | [`docs/judge-60s.md`](docs/judge-60s.md) |
| Static proof snapshot | [`docs/evidence/proof-snapshot.json`](docs/evidence/proof-snapshot.json) |
| Recorded lifecycle tests | [`test/recorded-lifecycle.test.mjs`](test/recorded-lifecycle.test.mjs) |
| Policy-effect tests | [`test/policy-effect.test.mjs`](test/policy-effect.test.mjs) |
| Homepage regression tests | [`test/proof-page.test.mjs`](test/proof-page.test.mjs) |
| Submission evidence report | [`reports/pre-submit.md`](reports/pre-submit.md) |
| Blog draft | [`docs/blog.md`](docs/blog.md) |
| Video script | [`docs/video-script.md`](docs/video-script.md) |
| Public repository — older published state | <https://github.com/unifyWeb3/freshness-bound-recall> |
| Hosted proof page — older cached snapshot | <https://freshness-bound-recall-oxunify.vercel.app> |

## License

Apache-2.0. The project uses Tatum Sui Mainnet GraphQL and Walrus Memory; neither service is bundled
with this repository.
