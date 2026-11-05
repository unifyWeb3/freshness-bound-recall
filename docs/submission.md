# Submission draft — FRESHNESS-BOUND RECALL

**Deadline: 2026-11-10 17:00 UTC.** Judging Nov 11–16. Recommended submission: **Nov 10, morning UTC**.
Nothing here has been submitted, published, registered, or posted. **You** review and send.

Field list below matches the live form (as read read-only on 2026-11-04; **re-verify the form before sending**).

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
| repoUrl | **decision point** — host the repo yourself (public or private repo) and paste; or paste the submission portal's link option if allowed. Agent will not create a remote. | you |
| additionalDocs | `reports/build-phase1.md` … `build-phase4.md` (if repo public) or a link to the docs/ folder | you/agent |
| walrusExperience | "Built with `@mysten-incubation/memwal@0.1.13` on mainnet; 15 memories written; `restore()` round-trip verified; lineage by `supersedes`/epoch because the production SDK exposes no delete/update." | agent-drafted |
| tatumAiBuilderExperience | "All chain truth via Tatum Sui mainnet GraphQL (read-only), `x-api-key` + `x-ttm-plan` logged, 1 s cached checkpoint, ≤2 reads per answer, backoff on 429/timeout, fail-closed gate." | agent-drafted |
| walrusFriction | "Production SDK (0.1.13) has no delete/update; semantic recall needed substring matching to hit exact claims; index lag after writes; blob retention is not verified in a disposable namespace (availability vs epochs); 5 s default preflight timeout and ~18 s write latency needed explicit timeouts/retries/queueing." | agent-drafted |
| socialPosts | `[X/LinkedIn posts you publish for the bonus, or “none”]` | you |

## Suggested description (Track 02 stated explicitly — the form has no track field)

> Track 02 — Smart Agents for Real Life
>
> FRESHNESS-BOUND RECALL is a Walrus Memory agent that will never answer from a stale memory. Every
> answer is routed through a **freshness gate on the answer path**: checkpoint window (Tatum Sui
> mainnet GraphQL, 1 cached read) ∧ subject version/digest pin (1 read) ∧ wall-clock backstop, failing
> closed with a visible reason. Stale memories are never answers; when a claim is re-verified
> differently, a correction memory supersedes the old blob (lineage chain) and the tolerance itself —
> a per-class policy memory `fc-policy-FAST-v1` — is rewritten by the system from observed decay
> (FALSE-STALE widens, MISSED-CHANGE tightens; one policy memory per change).
>
> Evidence: 15 mainnet Walrus blobs in namespace `freshness-recall` (7 observations, 4 corrections,
> 1 learned-policy memory, 1 adversarial not-stale record) + 2 live round-trip test memories;
> 90+ recorded stale/fresh decisions with checkpoint stamps; an ablation table on the built-in proof
> page; everything pinned (Node v26.13.0), zero LLM in the answer path, `.env`-only secrets with a
> startup on-chain credential self-test.

## Repo contents to include if a repo is hosted

`README.md`, `src/`, `scripts/`, `test/`, `fixtures/`, `docs/` (this file, `blog.md`, `video-script.md`),
`reports/build-phase1.md` … (all evidence, all labels), `data/claim-class-measurement.json`.
**Never the `.env`.**

## Order of operations before Nov 10 17:00 UTC

1. Re-verify the submission form field list and this draft (agent reads it at your request — read-only).
2. Record the demo per `docs/video-script.md`; upload to a venue you control; paste the URL.
3. Publish or host the repo per your choice; paste the URL.
4. Fill remaining fields; attach `docs/` if asked; keep the Track 02 line in the description.
5. Submit, then verify the confirmation page; keep the submission id.
6. Bonus: post X/LinkedIn (your accounts) tagging the event; paste URLs in socialPosts before submitting,
   otherwise leave `none`.

**Known open items at 2026-11-05:** Walrus epoch retention not verified (unknown); Tatum credits per
call not measured (unknown); no real user validated the persona (hypothesis).
