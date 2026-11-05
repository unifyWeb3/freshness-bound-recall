# FRESHNESS-BOUND RECALL

> A Walrus Memory agent that will never answer from a stale memory — it proves freshness against
> **live Sui mainnet reads** through **Tatum**, and the freshness window itself is a **memory** that
> the system rewrites from observed decay.

**Event:** Tatum × Walrus Memory “Total Recall” hackathon — Track 02 “Smart Agents for Real Life” ·
Submit by **2026-11-10 17:00 UTC** · Judging Nov 11–16
**Domain:** domain-agnostic by design (a claim + a freshness contract). No user has been confirmed yet —
the persona is a **HYPOTHESIS** (an operations analyst who answers “is this still true?” about a live
Sui position between sessions).

## 1. The product in one paragraph

Agents that remember things are wired to trust what they wrote down. That is fine until the world
changes — and on Sui mainnet, the world changes roughly every checkpoint. FRESHNESS-BOUND RECALL
stores claims in **Walrus Memory** with a `FR-v1` proof envelope (checkpoint sequence + digest, object
version + digest, read time). Every answer first **recalls** from Walrus Memory, then **gates** the
candidate against live Tatum mainnet reads: a checkpoint-window check (1 cached read) and a subject
version/digest pin (1 read), with a wall-clock backstop. If the gate fails — or the live reads are
unavailable — the agent **withholds** the memory and says why, and (optionally) writes a *correction*
memory that `supersedes` the old one. The **tolerance itself** is a per-claim-class policy memory that
the system rewrites from observed decay (two signals: **FALSE-STALE** widens the window, **MISSED-CHANGE**
tightens it), so the product visibly changes because of what it remembered.

**Competitive position (factual):** several entrants — and at least Recall Lab and RecallIQ — stamp
checkpoints onto their memories or re-verify claims at answer time. That is a real thing people have
already built. The factual differences here are:

* the gate sits **on the answer path**, not next to it (a stale memory is never an answer),
* the tolerance **is itself a Walrus Memory**: the system’s behaviour changes because of a memory it
  wrote and later read back (a learning loop, not a constant),
* supersession is explicitly tracked (`supersedes` / lineage), and the adversarial case
  (old-but-true) is exercised and documented,
* the critical path has **no LLM** — the answers are templates over verified chain data.

## 2. Quickstart (offline, no network)

```sh
node --version         # requires >= 26.13.0 (pinned; recorded in engines + README)
npm install --ignore-scripts   # deterministic install; never runs lifecycle scripts
npm test                     # offline suite, no network
npm run demo:offline         # cached-snapshot demo (no network)
npm run proof:offline        # proof page over cached snapshot: http://127.0.0.1:8787
npm run export               # or a fully static copy of the proof page at ./site
```

**Judges**: see `docs/judge-60s.md` for the 60-second path (fresh clone → tests → demo → proof page).

Live demo (requires `.env` for **Tatum** `TATUM_API_KEY` and a **Walrus Memory** account pair):

```sh
npm run prewarm              # warm Tatum + relayer, run startup credential self-test
npm run demo                 # deterministic live demo (read-only; no writes)
npm run proof                # proof page (live; auto-refresh)
npm run credits              # made-to-count Tatum calls; compare with your dashboard
```

## 3. What the demo shows (deterministic, 60–90 s)

1. **Credential self-test** (same as the agent startup): Tatum chain id, relayer health, on-chain proof
   that `MEMWAL_ACCOUNT_ID` is a `MemWalAccount` object (not the owner’s wallet address), authenticated
   namespace read.
2. **Chain liveness**: latest Sui mainnet checkpoint, read through Tatum GraphQL (`x-api-key` always;
   `x-ttm-plan` header logged on every request).
3. **Policy from memory**: the learned FAST window loads from `fc-policy-FAST-v1` (**25** checkpoints,
   tightened live from 50 on 3 consecutive `MISSED-CHANGE` signals), and the SLOW window loads 5000.
4. **A stale memory is WITHHELD**, with the live value shown; the stored blob is not the answer.
5. **Same question, same verdict** (determinism).
6. **FALSE-STALE** — an old-but-true memory (subject pin unchanged) is withheld too, with a visible
   reason and the widen-window learning signal.
7. **Ablation over the recorded decision ledger** — memory-off vs memory-on vs memory-on-with-gate.
8. **Lineage** — correction memories vs the observations/claims they supersede.

The **proof page** (`npm run proof`, `--offline` twin) shows for every one of the **17 mainnet
memories**: blob id, claim, class/state, checkpoint + object version pins at write, recorded decisions,
the Tatum request log with the plan header, and the policy state. It renders with the network down from
`data/cache/proof-snapshot.json` and says so (`CACHED SNAPSHOT`).

## 4. Architecture

```
question
  ├─ 1. recall(query)                         Walrus Memory (`freshness-recall`)
  ├─ 2. freshness gate (P4 hybrid, fail-closed)
  │     ├─ checkpoint window   1 cached read (1 s TTL)    P2
  │     ├─ subject pin          version/digest re-read    P3
  │     └─ wall-clock backstop  P1 (last resort)
  ├─ 3. FRESH → answer from the memory (template, no LLM)
  │     STALE  → WITHHELD + live value; optionally write correction (supersedes=old blob)
  └─ 4. learned policy (per class)
        FALSE-STALE  → widen   MISSED-CHANGE → tighten
        bounded ×2 / ÷2, min 3 actionable samples since last change,
        one policy memory per change (state, not code)
```

* **Memory schema** — `FR-v1` (parse/serialize round-trip tested; fail-closed on parse and serialize).
* **Transport** — Tatum **Sui mainnet GraphQL only**; no gRPC, no JSON-RPC. `x-api-key` always sent;
  `x-ttm-plan: free;ratelimit=3;strategy=shared` observed on every request in every run.
* **Rate discipline** — 1 s checkpoint cache; ≤2 reads/answer (1 checkpoint + 1 pin); exponential
  backoff + retries on 429/timeout; fail **closed** with a visible reason otherwise.
* **Memory** — `@mysten-incubation/memwal@0.1.13` pinned; production SDK exposes no delete/update, so
  revision is expressed as `supersedes`/lineage; `epoch` retires generations logically.
* **Policy memory** — `fc-policy-FAST-v1`; the agent re-reads policy memories at startup **and** before
  every answer.

## 5. Mainnet evidence (this workspace)

* Live opt-in tests (`RUN_MAINNET=1`) wrote the phase-2 seed claims (`wYNZE__…`, `SwnqFF…`), and were
  **re-run for the pre-submission verification**, writing **2 more** (`DL6hLB…`, `q1vX8syn…`).
* **13 observer-authored mainnet memories** in namespace `freshness-recall` (7 observations,
  4 corrections, 1 learned policy, 1 adversarial not-stale) + the 4 test seeds = **17**.
* Decision ledger: **≥150 checkpoint-stamped stale/fresh decisions** at freeze
  `freeze-2026-11-05T022330578Z` (59 FRESH · 87 STALE · 4 WITHHELD_UNVERIFIED). It grows every
  minute the observer runs (`--budget=0`: it *reads and logs* only, never writes).
* Environment: Node v26.13.0 (SDK floor documented in the stage2 report), npm 11.20.0, plan header
  `free;ratelimit=3;strategy=shared`.

### Learning — what is demonstrated, honestly

| Direction | Live | Persisted as a memory | Where |
|---|---|---|---|
| tighten (FAST window 50→25) | **YES** — 3 consecutive `MISSED-CHANGE` on the Sui Clock | **YES** — `fc-policy-FAST-v1` (`19ZE9y-zWt1…`) | live demo step 3 |
| widen (SLOW window 5000→10000→20000) | **YES** — 6 live `FALSE-STALE` samples; learning ran 01:00–01:34 UTC | **NO** — the observer ran with `--budget=0`, so no `fc-policy-SLOW-*` was written; it lives in the local mirror (`data/policy-mirror.json`, git-ignored) and reverts to 5000 on restart | `data/policy-mirror.json`, observer log |
| both directions, persisted end-to-end | replay only | **replay only** | `test/replay.test.mjs` |

Per-class totals in the recorded ledger: **FAST** — MISSED-CHANGE 5, FALSE-STALE 0, CONSISTENT 60
(67 samples) · **SLOW** — FALSE-STALE 7, MISSED-CHANGE 0, CONSISTENT 58 (67 samples). Forcing no
samples and changing no thresholds were required to see it.

> **Retention — open unknown.** Walrus mainnet epochs are ~2 weeks each. The Walrus Memory relayer's
> own upload path defaults to **2 epochs on mainnet (~4 weeks)** unless overridden
> (docs → reference → environment-variables: “`POST /walrus/upload` … `2` on mainnet (about 4 weeks)”).
> If the relayer is default-configured, a blob written 2026-11-05 expires around **2026-12-03** — but
> **the exact `end_epoch` is not readable with any tool available in this workspace** (three routes tried;
> see `reports/pre-submit.md`), so expiry **before 2026-11-17 cannot be ruled out**.
> The earliest seed blob was recalled OK on 2026-11-05 01:29 UTC. Options with cost: (a) accept the risk
> and use the cached proof page (0 cost); (b) renew 17 blobs on the Walrus dashboard before judging
> (your action, WAL + gas); (c) the submission carries this caveat, with the ledger as evidence.

## 6. Labelled correctness claims

| Claim | Label | Evidence |
|---|---|---|
| FR-v1 schema parse/serialize round-trips and rejects malformed records | VERIFIED | `test/schema.test.mjs` |
| Gate: window ∧ pin, wall-clock backstop, fail closed | VERIFIED | `test/gate.test.mjs`, `test/answer.test.mjs` |
| Never more than 2 Tatum reads per answer; 1 s checkpoint cache | VERIFIED | `test/tatum.test.mjs` |
| Same query → different verdict after the policy memory changed (persisted) | VERIFIED (offline replay) | `test/replay.test.mjs` + `fixtures/event-log.json` |
| Learned FAST window 50→25 from 3 live MISSED-CHANGE samples, persisted | VERIFIED (live, on mainnet) | `fc-policy-FAST-v1` blob `19ZE9y-zWt1…` |
| SLOW window widen live (5000→10000→20000) learned by the observer | **LEARNED LIVE, NOT PERSISTED** | ledger + `data/policy-mirror.json` (reverts on restart) |
| One policy memory per change (when the budget allows) | VERIFIED | `test/answer.test.mjs` |
| Sui mainnet checkpoint advances ~243 cps/min (measurement window) | VERIFIED | `data/claim-class-measurement.json` |
| Sui Clock ~2.78 changes/min; MemWal AccountRegistry ~0.09 changes/min | VERIFIED | `data/claim-class-measurement.json` |
| Adversarial not-stale memory answered FRESH at its snapshot epoch | VERIFIED (snapshot) | `adv-not-stale-341741224`; offline demo/proof shows FRESH at snapshot time |
| Live demo answers are pulled from current chain state, not from memory | VERIFIED | `npm run demo` output step 4 |
| Product survives relayer/Tatum failure without answering stale | VERIFIED (offline tests) + INFERRED (live) | gate fails closed on live-read failure in `src/gate.mjs` / offline tests |
| A real user persona works | HYPOTHESIS | no user confirmed |
| “The judge will see 21 distinct calls in the dashboard” | UNKNOWN | no credit header from Tatum; `npm run credits` prints the request count (21 for the 20-step run after 9 cache-absorbed reads) |
| Blob retention of this namespace | UNKNOWN | `end_epoch` not readable; relayer mainnet default ~2 epochs (~4 weeks) from docs; see `reports/pre-submit.md` |
| Competitor X has a stale-memory gate | UNKNOWN | ~33 entries; ~9 read in full; no global negation claimed anywhere |

## 7. Repository layout

```
src/          FR-v1 schema, gate, policy, Tatum client, store (mock + mainnet),
              answer path, ledger, replay/ablation, redaction, runtime assembly,
              mainnet credentials & self-test, subject registry
scripts/      answer.mjs prewarm.mjs observer.mjs demo.mjs proof-page.mjs
              export-site.mjs freeze.mjs measure-credits.mjs measure-claim-classes.mjs
              audit-secrets.mjs audit-history.mjs
test/         64 offline tests + test/live (2 opt-in mainnet tests)
fixtures/     recorded event log used by the replay/ablation test
docs/         blog.md, video-script.md, submission.md, judge-60s.md, evidence snapshot
reports/      build-phase1.md … build-phase4.md, pre-submit.md
data/         measurement evidence (committed); ledger/cache/mirror (git-ignored)
```

## 8. Known limits (stated, not hidden)

* **Memory has no delete/update** — revision is by `supersedes` lineage and `epoch` semantics. Judges
  can recover older generations by blob id, which is by design.
* **17 mainnet memories** (13 observer + 4 test seeds — the pre-submission test re-run added 2 more).
  “Over 10+ writes” satisfied by blob count.
* **Learning stability** — the tightened FAST window (25 cps ≈ 6 s) is below the observer sampling
  cadence; the anchor froze on budget exhaustion and stopped moving (FAST stays at v1). SLOW learned
  live (FALSE-STALE ×6) but the observer had `--budget=0`, so that learning is **not persisted as a
  memory** (mirror only; resets on restart). The honest fix is a window floor ≥ sampling interval or
  heartbeat observations — see `reports/build-phase2.md` §4.
* **No user** — HYPOTHESIS persona; product is domain-agnostic.
* **Tatum credits per call = UNKNOWN** — dashboard comparison required (`npm run credits` prints the
  request count: 21 actual GraphQL requests from the 20-attempt × 1.5 measurement run).
* **Retention UNVERIFIED** — see §5. Expiry before the judging window cannot be ruled out by tooling
  available here; mitigations are listed in §5 (cached/offline proof page is the free one).
* **`--budget=0` means** the observer reads with 3 Tatum calls every 60 s and **writes nothing**; the
  steepest unseen cost is the live proof page (≈15 s auto-refresh): run it only on demand, never as a
  background service.

## 9. Hackathon deliverables map

| Deliverable | File | Status |
|---|---|---|
| Product + demo | `scripts/demo.mjs`, `src/answer.mjs` | works (live & offline) |
| Proof page | `scripts/proof-page.mjs` (`npm run proof[:offline]`) | live & offline verified |
| Static export | `npm run export` → `./site` | verified (labelled snapshot, env-scan clean) |
| Observed mainnet memories | namespace `freshness-recall` (17) | ids in `reports/build-phase2.md` §2 + phase 4 |
| Decision ledger | `data/ledger.jsonl` (git-ignored) | ≥150 entries |
| Learned-policy memory | `fc-policy-FAST-v1` blob `19ZE9y-zWt1…` | persisted live |
| Judge 60 s | `docs/judge-60s.md` | fresh-clone verified |
| Videos + submission | `docs/video-script.md`, `docs/submission.md` | user records/sends |
| Freeze for video/submission | `npm run freeze` → `./freeze/` | verified live |
| Secrets audits (tree + history) | `npm run audit:secrets`, `scripts/audit-history.mjs` | both PASS |
| Report series | `reports/build-phase1.md` … `pre-submit.md` | committed |
| Blog post | `docs/blog.md` | see §10 of submission |
| Video | `docs/video-script.md` (user to record) | script provided, no upload by agent |
| Submission text | `docs/submission.md` | fields mapped to B2 form |
| Secrets audit | `npm run audit:secrets` | PASS |

## 10. Security & secrets

* Secrets live in `.env` (mode 0600, git-ignored; `git check-ignore -v .env` re-verified).
* Nothing is pushed; no remote is configured.
* The startup credential self-test proves `MEMWAL_ACCOUNT_ID` is the MemWalAccount object id
  (not the wallet) on-chain, and that the relayer is reached with ≥30 s timeouts and retries.
* `src/redact.mjs` scrubs secret-shaped strings from everything the ledger writes; `audit-secrets.mjs`
  asserts no tracked file contains any value fingerprinted from `.env` or matches PEM/JWT prefixes.

## 11. Submission note (to be posted by the user)

The user will submit the hackathon form with placeholders already resolved: see `docs/submission.md`.
Nothing has been submitted, published, or posted by the agent. The X/LinkedIn bonus post is the user’s
to post.
