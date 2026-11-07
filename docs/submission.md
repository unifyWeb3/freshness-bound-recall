# Submission draft — RECALLGUARD

## Status: **GO** — the RecallGuard release (rebrand + MCP + four-page site) is pushed and deployed; the submission portal has NOT been touched. The author fills the remaining fields and submits. Nothing has been submitted to the portal, posted, or registered.

**Deadline: 2026-11-10 17:00 UTC.** Judging Nov 11–16. Recommended submission: **Nov 10, morning UTC**.
The submission form itself has **not** been filled or sent. **You** review and send.

| Published item | URL | State |
|---|---|---|
| **Repository (public, published snapshot)** | <https://github.com/unifyWeb3/freshness-bound-recall> | pushed 2026-11-05 and verified unauthenticated; later acceptance/homepage commits have not been pushed |
| **Hosted proof page — prior cached snapshot** | <https://freshness-bound-recall-oxunify.vercel.app> | prior Vercel deployment, verified unauthenticated; the current Milestone 3 homepage has not been deployed |

> The hosted page is a **static export of a labelled snapshot** — its banner reads
> `STATIC EXPORT · … · network off · ids & stamps from a labelled snapshot`. It is not a live service
> and makes no network requests. The live proof page stays a local process.

Field list below matches the live form (as read read-only on 2026-11-04; **re-verify the form before sending**).

**Acceptance review on 2026-11-06, before the homepage milestone:** the CLI installed into a genuinely
empty consumer folder (31 packages in about five seconds, no lifecycle hooks) and ran with no `.env`.
The default sample was read-only and returned `STALE/WITHHELD` with zero writes. The recorded revision
lifecycle returned `STALE → FRESH → STALE`, resolved predecessor blob
`goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY` to correction blob
`mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY`, and disclosed that the later historical event recalled
proof-equivalent blob `zAji1w8p4REMzUF2o1V7IfgfQlpN7np7Qs8ehtNVXHg`. The correction persisted 117,242 ms after its proof;
the first post-persistence check 1,381 ms later withheld it as stale. Missing, ambiguous, and invalid
evidence failed closed. Baseline suite before homepage work: **120 tests / 120 pass / 0 fail / 0 skipped**;
focused acceptance: **30/30 pass**. The homepage milestone suite was **123 tests / 123 pass / 0 fail /
0 skipped**; the current Milestone 3 suite is **127 tests / 127 pass / 0 fail / 0 skipped**. Secrets
audit: **11 passes / 0 failures**; full-history audit: **0 findings**. Live
read-only recall confirmed both lineage blobs still exist and semantic recall returns the correction.
No Mainnet writes, push, deployment, or secrets changes were performed.

The earlier freeze bundle remains `freeze/freeze-2026-11-05T145207337Z.json` (22 memories · 306 ledger
entries, live checkpoint 341948733); the namespace check recorded 22 memories, 0 deleted, and
`must_resync=false`.

> **2026-11-07 release addendum (RecallGuard).** The product was renamed to RecallGuard (repo URL
> unchanged) and the MCP gap from the previous submission draft was closed: `@modelcontextprotocol/sdk`
> over stdio; six tools (`recall_checked`, `explain_decision`, `list_revisions`, `get_evidence`,
> `propose_correction`, `store_correction`), read-only by default; `store_correction` is triple-gated
> and remains disabled everywhere. 16 protocol-level MCP tests via `InMemoryTransport` plus a real
> stdio smoke client (`npm run mcp:smoke`, all checks PASS). Claude Code (2.1.318) and Codex CLI
> (0.167.0) configurations were verified with isolated `HOME`s. The public site was rebuilt as four
> static pages (home / MCP / evidence / docs) and deployed to the existing Vercel project after
> release checks; the hosted page now shows the RecallGuard release. Suite: **149 tests / 149 pass /
> 0 fail / 0 skipped**. No Mainnet writes, no secrets changes. The live read-only CLI remains
> **unverified end to end** and is labelled as such everywhere.

> **The freeze bundle is git-ignored.** `freeze/` is a local artifact directory (it contains the full
> ledger copy and the proof snapshot). If the repo is hosted for judges, **either attach
> `freeze/freeze-2026-11-05T145207337Z.json` through the form's `additionalDocs` field** (recommended)
> **or rely on the committed equivalent**, which *is* in the repo:
> `docs/evidence/proof-snapshot.json` (22 memories, 306 decisions, the `x-api-key` proof) plus
> `reports/pre-submit.md`. The demo and proof page do **not** require the namespace or the bundle at
> judging time — `npm run demo:offline`, `npm run proof:offline` and `npm run export` all run from the
> committed snapshot.

---

## Form fields & suggested answers

| Field | Suggested value | Who fills |
|---|---|---|
| email | `[your email]` | you |
| discordId | `[your Discord]` | you |
| linkedinUrl | `[your LinkedIn]` (used for the bonus share) | you |
| telegramId | `[your Telegram or leave blank if not required]` | you |
| howHeard | `[honest source, e.g. Tatum community / RSS]` | you |
| firstWeb3Project | `[true/false — your call]` | you |
| tatumAccountId | `[your Tatum account id, from the dashboard]` | you |
| suiAddress | `[your Sui wallet address, 0x…]` | you |
| accountId (Account ID (SUI)) | `[the MemWalAccount object id from .env MEMWAL_ACCOUNT_ID — public, it is an on-chain object]` | you |
| memwalAgentId ("public key from delegate keys") | `[the delegate public key from .env MEMWAL_AGENT_ID — public]` | you |
| description | see below | agent-drafted, you review |
| demoVideoUrl | `[upload the 60–90 s recording, then paste]` | you |
| repoUrl | `https://github.com/unifyWeb3/freshness-bound-recall` — **public, pushed 2026-11-05, full commit history** (the hashes cited in the reports, e.g. `f9832ac`, resolve on GitHub) | **done** — paste as-is |
| additionalDocs | `reports/build-phase1.md` … `build-phase4.md` (in the public repo) · hosted proof page (**cached snapshot**): `https://freshness-bound-recall-oxunify.vercel.app` · freeze bundle `freeze/freeze-2026-11-05T145207337Z.json` (local — attach the file if the form takes an upload) | you/agent |
| walrusExperience | "Built with `@mysten-incubation/memwal@0.1.13` on mainnet; 22 memories written in namespace `freshness-recall`; `restore()` round-trip verified; lineage by `supersedes`/epoch because the production SDK exposes no delete/update." | agent-drafted |
| tatumAiBuilderExperience | "Tatum AI Builder was NOT used. The project uses Tatum's Sui Mainnet GraphQL gateway only (read-only): `x-api-key` on every request (proven from the request log: 21/21 in the controlled measurement run, 7/7 in the final proof snapshot, 2,208/2,208 in a longer page run) + `x-ttm-plan` logged, 1 s cached checkpoint, ≤2 reads per answer, backoff on 429/timeout, fail-closed gate." | agent-drafted |
| walrusFriction | "Production SDK (0.1.13) has no delete/update; semantic recall needed substring matching to hit exact claims; index lag after writes; blob retention is not verified in a disposable namespace (availability vs epochs); 5 s default preflight timeout and ~18 s write latency needed explicit timeouts/retries/queueing." | agent-drafted |
| socialPosts | `[X/LinkedIn posts you publish for the bonus, or “none”]` | you |
| event-rules checkbox | **Required by the form** (must accept the event rules / terms) — you click it; the agent never accepts legal terms on your behalf | you |

## Suggested description (Track 02 stated explicitly — the form has no track field)

> Track 02 — Smart Agents for Real Life
>
> RecallGuard is the freshness gate for AI-agent memory — a Walrus Memory agent that will never
> answer from a stale memory. Every answer is routed through a **freshness gate on the answer path**:
> checkpoint window (Tatum Sui mainnet GraphQL, 1 cached read) ∧ subject version/digest pin (1 read)
> ∧ wall-clock backstop, failing closed with a visible reason. Stale memories are never answers; when
> a claim is re-verified differently, a correction memory supersedes the old record (blob id when
> available, exact claim fallback while a write is still in flight; the proof view resolves both) and
> the tolerance itself — a per-class policy memory (`fc-policy-FAST-v1`, `fc-policy-SLOW-v2`) — is
> rewritten by the system from observed decay (FALSE-STALE widens, MISSED-CHANGE tightens; one policy
> memory per change).
>
> RecallGuard is also an MCP server (stdio): six tools — `recall_checked` enforces the same gate
> for MCP-compatible agents (Claude Code and Codex configurations tested); `store_correction` is
> triple-gated and read-only by default. Recalled memory content is treated as untrusted data.
>
> Evidence: 22 mainnet Walrus blobs in namespace `freshness-recall` (7 observer observations, 4
> corrections, 2 learned-policy memories, 1 historical adversarial specimen (it predates the
> anchor-proof fix), 8 live round-trip test memories); 306 recorded stale/fresh decisions with
> checkpoint stamps; an ablation table on the evidence page; both learning directions persisted as
> memories and read back before every answer; everything pinned (Node v26.13.0), zero LLM in the answer
> path, `.env`-only secrets with a startup on-chain credential self-test.
> startup on-chain credential self-test.

## Repo contents — the public repo is already live

<https://github.com/unifyWeb3/freshness-bound-recall> — public, pushed with the **full commit history**
(the hashes cited in `reports/`, e.g. `f9832ac`, resolve on GitHub). It contains `README.md`, `src/`,
`scripts/`, `test/`, `fixtures/`, `docs/` (this file, `blog.md`, `video-script.md`, `judge-60s.md`),
`reports/build-phase1.md` … (all evidence, all labels), `data/claim-class-measurement.json`,
`.nvmrc`, `Dockerfile`, `.dockerignore`.
**Never the `.env`** — it is git-ignored, untracked, and the secrets audit passes on the working tree
*and* on every pushed commit.

## Order of operations before Nov 10 17:00 UTC

1. Re-verify the submission form field list and this draft (agent reads it at your request — read-only).
2. Record the demo per `docs/video-script.md`; upload to a venue you control; paste the URL.
3. ~~Publish or host the repo~~ — **done**: <https://github.com/unifyWeb3/freshness-bound-recall> (paste
   it into `repoUrl`).
4. Fill remaining fields; tick the **event-rules acceptance checkbox** (you, not the agent); attach `docs/` if asked; keep the Track 02 line in the description.
5. Submit, then verify the confirmation page; keep the submission id.
6. Bonus: post X/LinkedIn (your accounts) tagging the event; paste URLs in socialPosts before submitting,
   otherwise leave `none`.

**Known open items at 2026-11-05:** Walrus epoch retention not verified (unknown — expiry before
judging cannot be ruled out); Tatum credits per call not measured (unknown — `npm run credits` prints the
request count for a dashboard comparison); no real user validated the persona (hypothesis); the Docker
image path is written but unverified (no Docker daemon in the build environment); the `fc-policy-SLOW-v2`
memory carries one malformed auxiliary field (`policy.evidence_count=undefined`) caused by a
variable-name slip in the writer — the evidence list itself is intact in the record body, and the
policy engine does not read that field. Fixing the blob would need a second write, which needs the
author's confirmation.
