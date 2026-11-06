# FRESHNESS-BOUND RECALL — a Walrus Memory agent that never answers from a stale memory, because it gates every answer on live Sui mainnet reads through Tatum and rewrites its own freshness window from what it observes.

> The gate sits **on the answer path**: recall → freshness gate → answer or withhold.
> The tolerance is **itself a memory** (`fc-policy-FAST-v1`, `fc-policy-SLOW-v2`), read at startup and
> before every answer — so the system's behaviour changes because of something it wrote and read back.

**Event:** Tatum × Walrus Memory “Total Recall” hackathon — Track 02 “Smart Agents for Real Life” ·
Submit by **2026-11-10 17:00 UTC** · Judging Nov 11–16
**Domain:** domain-agnostic by design (a claim + a freshness contract). No user has been confirmed yet —
the persona is a **HYPOTHESIS** (an operations analyst who answers “is this still true?” about a live
Sui position between sessions).

**Links**

| What | URL |
|---|---|
| **This repository** (public, full history) | <https://github.com/unifyWeb3/freshness-bound-recall> |
| **Hosted proof page — a cached snapshot** | <https://freshness-bound-recall-oxunify.vercel.app> |
| Judge quickstart (60 s, no credentials) | [`docs/judge-60s.md`](docs/judge-60s.md) |
| Pre-submission report (GO, with the open items) | [`reports/pre-submit.md`](reports/pre-submit.md) |

> The hosted page is the **static export of a labelled snapshot** (the banner on it says
> `STATIC EXPORT · … · network off · ids & stamps from a labelled snapshot`). It is byte-identical to
> the deployed export artifact — sha256 `91ebae92b30481f9…` — and makes **no network requests**. A new
> `npm run export` rebuilds from the current tree and is not claimed to reproduce those old bytes. It is a
> snapshot, not a live service: the live proof page is a local process and is never hosted.

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
  (old-but-true) is generated from the anchor's actual old proof and regression-tested,
* the critical path has **no LLM** — the answers are templates over verified chain data.

## 2. Quickstart: safe recall (offline by default)

```sh
node --version         # supports >= 24; .nvmrc pins the published verification runtime (26.13.0)
nvm use                # if you use nvm: reads .nvmrc -> 26.13.0
npm install --ignore-scripts   # deterministic install; never runs lifecycle scripts
npm test                     # offline suite, no network
node scripts/recall-checked.mjs --sample sui-clock-changed --json
node scripts/recall-checked.mjs --sample sui-clock-revision-lifecycle --json
npm run demo:offline         # cached-snapshot demo (no network)
npm run proof:offline        # proof page over cached snapshot: http://127.0.0.1:8787
npm run export               # or a fully static copy of the proof page at ./site
```

`recall_checked` is the small public product surface. With no mode flag it runs the
`sui-clock-changed` recorded-Mainnet sample: a real Walrus blob from the committed evidence snapshot,
checked through the same freshness gate with **no wallet, credentials, network access, or writes**.
The result is a stable `recall_checked/v1` JSON document when `--json` is supplied. After installing
the packed package, the equivalent command is:

```sh
recall_checked --sample sui-clock-changed --json
recall_checked --sample sui-clock-revision-lifecycle --json
```

The lifecycle sample resolves a real correction to the observation it supersedes, then shows the
same recorded Mainnet evidence as `STALE → FRESH → STALE`: the predecessor was withheld, the actual
correction is fresh at its revision proof, and that correction is withheld at a later recorded
post-persistence check. The FRESH and final STALE verdicts are deterministic replays over recorded
checkpoints and pins, not a claim that the historical ledger recalled the correction blob itself.
The contract exposes the observed timing too: this correction reached Walrus 117,242 ms after its
proof, and the first recorded proof-equivalent check 1,381 ms later already found it stale. Its
stable JSON schema is `recall_checked_lifecycle/v1`.

Live recall is also read-only unless writes are explicitly enabled. It reads credentials from the
process environment and from `.env` in the **current working directory** (not from inside the
installed package):

```sh
recall_checked --live --query "Is the Sui Clock memory still true?" --json
```

`--allow-mainnet-writes` is deliberately separate. It permits correction/policy memories and can
incur Mainnet cost; use it only with the account owner's specific approval. Merely selecting
`--live` never enables writes.

The same contract is available as a library. `recallChecked()` is dependency-injected and defaults
to zero writes; only `allowWrites: true` opts in. The recorded sample needs no dependencies:

```js
import {
  recallChecked,
  recallCheckedLifecycleSample,
  recallCheckedSample,
} from "freshness-bound-recall";

const sample = await recallCheckedSample();
const lifecycle = await recallCheckedLifecycleSample();
const live = await recallChecked("Is this still true?", { store, tatum });
// Explicit write opt-in: recallChecked(query, { store, tatum, allowWrites: true })
```

**Judges**: see `docs/judge-60s.md` for the 60-second path (fresh clone → tests → demo → proof page),
including a one-command Docker path.

Live demo (requires `.env` for **Tatum** `TATUM_API_KEY` and a **Walrus Memory** account pair):

```sh
npm run prewarm              # warm Tatum + relayer, run startup credential self-test
npm run demo                 # deterministic live demo (read-only; no writes)
npm run proof                # proof page (live; auto-refresh)
npm run credits              # made-to-count Tatum calls; compare with your dashboard
npm run freeze               # timestamped evidence bundle for the video / submission
```

## 3. What the demo shows (deterministic, 60–90 s)

1. **Credential self-test** (same as the agent startup): Tatum chain id, relayer health, on-chain proof
   that `MEMWAL_ACCOUNT_ID` is a `MemWalAccount` object (not the owner’s wallet address), authenticated
   namespace read.
2. **Chain liveness**: latest Sui mainnet checkpoint, read through Tatum GraphQL (`x-api-key` always;
   `x-ttm-plan` header logged on every request).
3. **Policy from memory**: the learned windows load from the memory layer — FAST **25** checkpoints
   (`fc-policy-FAST-v1`, tightened live from 50 on 3 consecutive `MISSED-CHANGE` signals) and SLOW
   **20000** checkpoints (`fc-policy-SLOW-v2`, widened live from 10000 on 3 consecutive `FALSE-STALE`
   signals; learned 2026-11-05 02:05 UTC, written to Walrus Memory 09:23 UTC).
4. **A stale memory is WITHHELD**, with the live value shown; the stored blob is not the answer.
5. **Same question, same verdict** (determinism).
6. **The adversarial old-but-true memory is re-checked** — the gate narrates what actually happened
   (pin unchanged + window expired → `FALSE-STALE`; pin changed → `STALE`/`CONSISTENT`), and never
   claims a pin state it did not observe. The `FALSE-STALE` path is reproducible on demand with
   `node scripts/show-policy-effect.mjs` (16 FALSE-STALE samples are also in the recorded ledger).
7. **Ablation over the recorded decision ledger** — memory-off vs memory-on vs memory-on-with-gate.
8. **Lineage** — correction memories vs the observations/claims they supersede.

The **proof page** (`npm run proof`, `--offline` twin) shows the **recalled memories** in its snapshot:
blob id, claim, class/state, checkpoint + object version pins at write, recorded decisions,
the Tatum request log with the plan header **and an `x-api-key` badge on every row**, and the policy
state. It renders with the network down from `data/cache/proof-snapshot.json` and says so
(`CACHED SNAPSHOT`).

## 4. Architecture

```
question
  ├─ 1. recall(query)                         Walrus Memory (`freshness-recall`)
  ├─ 2. freshness gate (P4 hybrid, fail-closed)
  │     ├─ checkpoint window   1 cached read (1 s TTL)    P2
  │     ├─ subject pin          version/digest re-read    P3
  │     └─ wall-clock backstop  P1 (last resort)
  ├─ 3. FRESH → answer from the memory (template, no LLM)
  │     STALE  → WITHHELD + live value; optionally write correction (supersedes=old reference)
  └─ 4. learned policy (per class)
        FALSE-STALE  → widen   MISSED-CHANGE → tighten
        bounded ×2 / ÷2, min 3 actionable samples since last change,
        one policy memory per change (state, not code)
```

### The learning rule — exact thresholds and bounds

| | FAST (Sui Clock `0x…06`) | SLOW (MemWal AccountRegistry `0x8bf82c…199f`) |
|---|---|---|
| default window | **50** checkpoints | **5000** checkpoints |
| **widen** rule | `FALSE-STALE` → `window = min(max, window × 2)` | same |
| **tighten** rule | `MISSED-CHANGE` → `window = max(min, floor(window / 2))` | same |
| widen/tighten trigger | `FALSE-STALE > MISSED-CHANGE` / `MISSED-CHANGE > FALSE-STALE`, counted since the last change | same |
| **minimum actionable samples before any change** | **3** | **3** |
| signals that never move the window | `CONSISTENT`, `UNVERIFIED` | same |
| **bounds** | **[10, 200000]** checkpoints | **[10, 2000000]** checkpoints |
| wall-clock backstop (`maxAgeSeconds`) | 86400 s (1 day) | 604800 s (7 days) |
| counters after a change | reset (`pendingSamples = pendingFalseStale = pendingMissedChange = 0`) | same |
| policy memories written per change | exactly 1 | exactly 1 |

* `FALSE-STALE` = the checkpoint window said *stale* **and** the subject version/digest pin said
  *unchanged* → the window was too tight → **widen**.
* `MISSED-CHANGE` = the window said *fresh* **and** the pin said *changed* → the window was too loose
  → **tighten**.
* The policy is re-read **at startup and before every answer** (`PolicyEngine.load()`); the local
  mirror (`data/policy-mirror.json`, git-ignored) is a convenience, never the source of truth.

* **Memory schema** — `FR-v1` (parse/serialize round-trip tested; fail-closed on parse and serialize).
* **Transport** — Tatum **Sui mainnet GraphQL only**; no gRPC, no JSON-RPC. `x-api-key` always sent;
  `x-ttm-plan: free;ratelimit=3;strategy=shared` observed on every request in every run.
* **Rate discipline** — 1 s checkpoint cache; ≤2 reads/answer (1 checkpoint + 1 pin); exponential
  backoff + retries on 429/timeout; fail **closed** with a visible reason otherwise.
* **Memory** — `@mysten-incubation/memwal@0.1.13` pinned; production SDK exposes no delete/update, so
  revision is expressed as `supersedes`/lineage; `epoch` retires generations logically.
* **Policy memory** — `fc-policy-FAST-v1` and `fc-policy-SLOW-v2`; the agent re-reads policy memories
  at startup **and** before every answer.

## 5. Mainnet evidence (this workspace)

### The 22 memories in namespace `freshness-recall`

| Group | Count | What they are | Blob ids |
|---|---|---|---|
| **Test seeds** (`state=live`, claim `smoke-seed-*`) | 8 | round-trip seeds written by the opt-in live test suite (`RUN_MAINNET=1`); 2 per test run × 4 runs | `wYNZE__…`, `SwnqFF…`, `DL6hLB…`, `q1vX8syn…`, `6InMSm3…`, `8xyFMV-…`, `xMy45mc7…`, `fsFeUrbx…` |
| **Observer observations** (`state=observation`, claim `obs-*`) | 7 | what the observer saw on chain, each stamped with checkpoint + object version/digest at read time | `EXLTJp9…`, `Pk3CAi9…`, `BZ8iuoO…`, `WJv-iK2…`, `FMBYgz…`, `goZjQJ3…`, `zAji1w8…` |
| **Corrections** (`state=live`, claim `cor-*`, `supersedes=…`) | 4 | the superseding memory written when the FAST subject changed | `5ndF6Q5q…`, `_RswBPgo…`, `1JJVQ71R…`, `mjxZQ1X2…` |
| **Policy records** (`state=policy`, predicate `policy_window`) | 2 | the learned windows — **the only memories the answer path reads as policy** | `19ZE9y-zWt1…` (`fc-policy-FAST-v1`), `Zne2mnjAy6u…` (`fc-policy-SLOW-v2`) |
| **Adversarial** (`state=adversarial`, claim `adv-not-stale-*`) | 1 | historical specimen; the current generator now stamps the anchor's actual old proof | `MNQZ0eE0…` |
| **Total** | **22** | `listMemories` on the namespace: 22 memories, 0 deleted, `must_resync=false` | full list in `reports/build-phase2.md` §2 + `reports/pre-submit.md` |

* Decision ledger: **≥306 checkpoint-stamped stale/fresh decisions** at freeze
  `freeze-2026-11-05T145207337Z` (72 FRESH · 230 STALE · 4 WITHHELD_UNVERIFIED). It grows every
  round the observer runs (`--budget=0`: it *reads and logs* only, never writes).
  *The freeze bundle itself is a local artifact (`freeze/` is git-ignored); the **committed**
  equivalent of the same evidence is `docs/evidence/proof-snapshot.json` — 22 memories, 306 decisions,
  the `x-api-key` proof — and the full history is in `reports/`.*
* Environment: Node v26.13.0, npm 11.20.0, plan header `free;ratelimit=3;strategy=shared`.

### Learning — what is demonstrated, honestly

| Direction | Learned live | Persisted as a memory | Where |
|---|---|---|---|
| **tighten** — FAST window 50→25 | **YES** — 3 consecutive `MISSED-CHANGE` on the Sui Clock, 2026-11-05 00:57 UTC | **YES** — `fc-policy-FAST-v1` (`19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o`), written 00:57:55 UTC | live demo step 3 |
| **widen** — SLOW window 5000→10000→20000 | **YES** — 3 consecutive `FALSE-STALE` on the MemWal AccountRegistry, learned 2026-11-05 02:05:19 UTC | **YES** — `fc-policy-SLOW-v2` (`Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`), written 09:23:05 UTC (not backdated) | `scripts/show-policy-effect.mjs` |
| **both directions persisted end-to-end** | **LIVE, not replay-only** — both policy memories are written to Walrus Memory and read back at startup | **YES** | `scripts/show-policy-effect.mjs` parts A/B |
| deterministic offline replay of the same loop | replay | replay | `test/replay.test.mjs` + `fixtures/event-log.json` |

**The persisted policy changes a gate verdict — shown, not asserted** (`node scripts/show-policy-effect.mjs`):

```
A. POLICY READ BACK FROM WALRUS MEMORY (LIVE)   engine load source=store
   fc-policy-SLOW-v2  blob=Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4
      window=20000 version=2 bounds=[10, 2000000]
      reason=FALSE-STALE 3 > MISSED-CHANGE 0: widen 10000 -> 20000
      learned_at=2026-11-05T02:05:19.054Z  written_at=2026-11-05T09:23:05.105Z
B. REPLAY: recorded mainnet decision 2026-11-05T02:05:19.054Z, checkpoint 341759185
   memory obs-memwal-registry-341741030 (blob Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g)
   memory OFF (default window 5000): STALE (FALSE-STALE) - checkpoint window exceeded (delta 18155 > window 5000)
   memory ON  (window 20000 from blob): FRESH (CONSISTENT) - fresh (checkpoint delta 18155 <= 20000, subject unchanged)
```

Part B is a **replay** of a recorded mainnet decision (real memory, complete proof envelope, real
checkpoint, real pin, same clock — only the window differs). The SLOW policy is read back live from
Walrus Memory in part A; the decision inputs come from the committed evidence snapshot so the result
is reproducible without constructing a synthetic claim.

**Disclosed limits of the learning evidence (nothing hidden):**

* The observer learned a **further** SLOW window of **40000** at 2026-11-05 02:25:24 UTC (3 more
  `FALSE-STALE` samples). That later result is **not persisted** — the only SLOW policy memory on
  chain is the 20000-checkpoint one, which is *tighter* (more conservative) than the latest local
  mirror. The persisted record says so in its own body.
* `fc-policy-FAST-v1` was written before the schema carried `policy.learned_at`, so it has no separate
  learned-at field; its `recorded_at` (00:57:55.895 UTC) is both the learning time and the write time.
* The tightened FAST window (25 checkpoints ≈ 6 s) is **below the observer sampling cadence**, so FAST
  is effectively frozen at v1 in the live loop. The honest fix — a window floor ≥ sampling interval, or
  heartbeat observations — is documented in `reports/build-phase2.md` §4, not silently applied.
* The SLOW widen happened **twice, independently**: at 01:34:22 UTC and again at 02:05:19 UTC (the
  observer restarted in between and re-learned 5000→10000→20000 from scratch). The persisted record
  cites the 02:05:19 learning event; all 16 `FALSE-STALE` ledger entries are listed in its body.
* No threshold was tuned and no sample was forced at any point.

> **Retention — open unknown.** Walrus mainnet epochs are ~2 weeks each. The Walrus Memory relayer's
> own upload path defaults to **2 epochs on mainnet (~4 weeks)** unless overridden
> (docs → reference → environment-variables: “`POST /walrus/upload` … `2` on mainnet (about 4 weeks)”).
> If the relayer is default-configured, a blob written 2026-11-05 expires around **2026-12-03** — but
> **the exact `end_epoch` is not readable with any tool available in this workspace** (three routes tried;
> see `reports/pre-submit.md`), so expiry **before 2026-11-17 cannot be ruled out**.
> The earliest seed blob was recalled OK on 2026-11-05 01:29 UTC. Options with cost: (a) accept the risk
> and use the cached proof page (0 cost); (b) renew the blobs on the Walrus dashboard before judging
> (your action, WAL + gas); (c) the submission carries this caveat, with the ledger as evidence.

## 5b. Tatum usage

Every Tatum call goes to **`https://sui-mainnet.gateway.tatum.io/graphql`** (Sui mainnet, GraphQL only)
with the **`x-api-key`** header attached, and the response plan header `x-ttm-plan` is logged on every
request. The request log records a **boolean** `api_key_sent` per entry — never the key value — so the
credential can be proven from the log:

```
$ npm run credits
attempted calls      : 30 (requested 20)
actual GraphQL reqs  : 21  <-- compare this with the dashboard
  checkpoint reads    : 20 (1 s cache; 9 absorbed by cache)
  object reads        : 10
  errors              : 0
plan header           : free;ratelimit=3;strategy=shared
api key sent         : 21/21 requests carried the x-api-key header (value never printed) -> EVERY REQUEST
latency ms            : p50 189 / p95 281 / max 1178
credits per call      : UNKNOWN - no credit header is returned by Tatum; compare actual_graphql_requests with the dashboard
```

| What | Number | Label | Evidence |
|---|---|---|---|
| GraphQL requests in the `npm run credits --calls=20` run | **21** (30 attempted, 9 absorbed by the 1 s checkpoint cache) | VERIFIED | `npm run credits` |
| Requests carrying `x-api-key` | **21 / 21** | VERIFIED | `npm run credits`; `TatumClient.apiKeyProof()`; `test/tatum.test.mjs` |
| Requests carrying `x-api-key` in the live proof-page snapshot | **7 / 7** (final snapshot; a longer earlier page run logged **2,208 / 2,208**) | VERIFIED | `docs/evidence/proof-snapshot.json` → `tatum_api_key_proof` |
| Plan header on every response | `free;ratelimit=3;strategy=shared` | VERIFIED | same |
| **Credits consumed per call** | **UNKNOWN** — Tatum returns no credit header | UNKNOWN | compare the 21 requests with the dashboard |
| Steady-state observer (`--interval=300 --budget=0`) | 3 requests / 5 min ≈ 864 / day | VERIFIED (arithmetic) | `scripts/observer.mjs` |

> **Dashboard comparison note (2026-11-05).** The dashboard will show **more than 21 requests** for
> today: besides the 21-request measurement run, the observer read 3 requests every 5 minutes while it
> ran (it stopped at 09:29 UTC), and a long-running live proof-page instance logged 2,208 requests
> before it was stopped. **The 21 is the number to compare against for a controlled measurement**
> (`npm run credits` prints exactly what it did); the rest is the running agent's own traffic.

> **Dashboard screenshot — placeholder (to be pasted by the author):**
> `![Tatum dashboard usage — 21 requests from the npm run credits run](docs/tatum-dashboard.png)`
> *File not present in this repo yet; the author attaches the dashboard screenshot before submission.*

## 6. Labelled correctness claims

| Claim | Label | Evidence |
|---|---|---|
| FR-v1 schema parse/serialize round-trips and rejects malformed records | VERIFIED | `test/schema.test.mjs` |
| Gate: window ∧ pin, wall-clock backstop, fail closed | VERIFIED | `test/gate.test.mjs`, `test/answer.test.mjs` |
| Never more than 2 Tatum reads per answer; 1 s checkpoint cache | VERIFIED | `test/tatum.test.mjs` |
| Same query → different verdict after the policy memory changed (persisted) | VERIFIED (offline replay) | `test/replay.test.mjs` + `fixtures/event-log.json` |
| Learned FAST window 50→25 from 3 live MISSED-CHANGE samples, persisted | VERIFIED (live, on mainnet) | `fc-policy-FAST-v1` blob `19ZE9y-zWt1…` |
| Learned SLOW window 5000→10000→20000 from 3 live FALSE-STALE samples, persisted | VERIFIED (live learning; memory written later, learned_at ≠ written_at) | `fc-policy-SLOW-v2` blob `Zne2mnjAy6u…`; ledger entries 2026-11-05 01:55–02:05 UTC |
| Both learning directions persisted as Walrus Memory and read back at startup | VERIFIED (live) | `scripts/show-policy-effect.mjs` part A (`source=store`) |
| The persisted SLOW policy changes a gate verdict (recorded mainnet decision) | VERIFIED (replay of a recorded mainnet decision) | `scripts/show-policy-effect.mjs` part B: window 5000 → STALE, window 20000 → FRESH |
| A real correction has visible revision and subsequent behavior | VERIFIED (recorded trigger + deterministic replays of recorded Mainnet evidence) | `recall_checked --sample sui-clock-revision-lifecycle --json`: STALE → FRESH at proof → STALE at first post-persistence check |
| A later SLOW window (40000) was learned live but is **not** persisted | VERIFIED (disclosed) | `fc-policy-SLOW-v2` body; ledger 2026-11-05 02:25:24 UTC |
| One policy memory per change (when the budget allows) | VERIFIED | `test/answer.test.mjs` |
| `x-api-key` was sent on every Tatum request | VERIFIED | `TatumClient.apiKeyProof()` → 21/21 in the credits run, 7/7 in the final proof snapshot (2,208/2,208 in a longer earlier page run); `test/tatum.test.mjs` |
| Sui mainnet checkpoint advances ~243 cps/min (measurement window) | VERIFIED | `data/claim-class-measurement.json` |
| Sui Clock ~2.78 changes/min; MemWal AccountRegistry ~0.09 changes/min | VERIFIED | `data/claim-class-measurement.json` |
| Adversarial generator carries the old anchor proof it claims to test | VERIFIED (offline test) | `test/observer.test.mjs`; the historical snapshot specimen predates this fix and is not proof of age-at-creation |
| Live demo answers are pulled from current chain state, not from memory | VERIFIED | `npm run demo` output step 4 |
| Product survives relayer/Tatum failure without answering stale | VERIFIED (offline tests) + INFERRED (live) | gate fails closed on live-read failure in `src/gate.mjs` / offline tests |
| A real user persona works | HYPOTHESIS | no user confirmed |
| “The judge will see 21 distinct calls in the dashboard” | UNKNOWN | no credit header from Tatum; `npm run credits` prints the request count (21 actual requests from the 30 attempted reads; 9 absorbed by the 1 s checkpoint cache) |
| The Docker image path (`docker build` / `docker run`) | UNKNOWN | no Docker daemon in the build environment; the exact command sequence was verified natively from a fresh clone |
| Blob retention of this namespace | UNKNOWN | `end_epoch` not readable; relayer mainnet default ~2 epochs (~4 weeks) from docs; see `reports/pre-submit.md` |
| Competitor X has a stale-memory gate | UNKNOWN | ~33 entries; ~9 read in full; no global negation claimed anywhere |

## 7. Repository layout

```
src/          FR-v1 schema, gate, policy, Tatum client, store (mock + mainnet),
              answer path, ledger, replay/ablation, redaction, runtime assembly,
              mainnet credentials & self-test, subject registry, recall_checked library
scripts/      recall-checked.mjs answer.mjs prewarm.mjs observer.mjs demo.mjs proof-page.mjs
              export-site.mjs freeze.mjs persist-policy.mjs show-policy-effect.mjs
              measure-credits.mjs measure-claim-classes.mjs
              audit-secrets.mjs audit-history.mjs
test/         offline unit, contract, CLI, packaging, and replay coverage;
              test/live contains the credential-gated Mainnet tests
fixtures/     recorded event log used by the replay/ablation test
docs/         blog.md, video-script.md, submission.md, judge-60s.md, evidence snapshot
reports/      build-phase1.md … build-phase4.md, pre-submit.md
data/         measurement evidence (committed); ledger/cache/mirror (git-ignored)
.nvmrc        26.13.0 (nvm picks it up)
Dockerfile    offline tests + offline demo + export, no secrets in the image
```

## 8. Known limits (stated, not hidden)

### The five limits a judge should read first

1. The policy memory blob `Zne2mnjA…` (`fc-policy-SLOW-v2`) contains one malformed auxiliary field,
   `policy.evidence_count=undefined`. A Walrus blob is immutable, so this cannot be edited in place.
   The evidence list itself is intact inside the record body, and the policy engine does not read that
   field. The gate now has regression coverage for every required chain/checkpoint/object/time proof
   field, but that validation does not and cannot rewrite this auxiliary field in the existing blob.
2. The observer later learned a SLOW window of **40000**. That value was never persisted as a memory,
   so the SLOW policy stored on chain is **20000**. The current engine now previews changes, persists
   them, and only commits in memory after a confirmed blob id; tests cover same-version reloads and
   failed/unconfirmed writes. The historical snapshot still contains the old 40000/20000 mismatch.
3. The Docker path is **UNKNOWN** because it was never executed: the build environment had no Docker
   binary and no Docker socket. The same command sequence was verified natively instead.
4. Walrus blob retention beyond the relayer default is **UNKNOWN**. The relayer's documented mainnet
   default is 2 epochs (about 4 weeks), but the exact `end_epoch` of these blobs could not be read with
   any tool available here. Local checkpoint-cache age is separately covered: a disk-loaded checkpoint
   keeps its saved timestamp and cannot become “fresh” merely because the process just loaded it.
5. No real user has validated the persona. It is a hypothesis, and the product is deliberately
   domain-agnostic. Recall selection now preserves semantic distance and constrains known Clock vs
   AccountRegistry queries to the matching subject, but that engineering check is not user validation.

* **Memory has no delete/update** — revision is by `supersedes` lineage and `epoch` semantics. Judges
  can recover older generations by blob id, which is by design.
* **A correction can age during persistence** — the recorded lifecycle sample shows one FAST
  correction reaching Walrus 117,242 ms after its proof and already being stale at the first
  proof-equivalent check 1,381 ms later. The sample does not claim that blob was ever recalled fresh
  after persistence; it labels the FRESH step as a replay at the correction's proof time.
* **22 mainnet memories** (8 test seeds · 7 observer observations · 4 corrections · 2 policy records ·
  1 adversarial). “Over 10+ writes” satisfied by blob count.
* **Learning stability** — the tightened FAST window (25 checkpoints ≈ 6 s) is below the observer
  sampling cadence, so FAST is effectively frozen at v1 in the live loop; the SLOW widen was learned
  live twice and persisted once (window 20000), while a third learning (40000) was **not** persisted.
  The honest fix is a window floor ≥ sampling interval or heartbeat observations — documented in
  `reports/build-phase2.md` §4, not silently applied.
* **No user** — HYPOTHESIS persona; product is domain-agnostic.
* **Tatum credits per call = UNKNOWN** — dashboard comparison required (`npm run credits` prints the
  request count: 21 actual GraphQL requests from the 30 attempted reads).
* **Retention UNVERIFIED** — see §5. Expiry before the judging window cannot be ruled out by tooling
  available here; mitigations are listed in §5 (cached/offline proof page is the free one).
* **`--budget=0` means** the observer reads with 3 Tatum calls every round and **writes nothing**; the
  steepest unseen cost is the live proof page (≈15 s auto-refresh): run it only on demand, never as a
  background service.
* **Relayer flakiness** — the relayer occasionally drops a connection (`fetch failed` / content-length
  mismatch). Reads therefore retry, and the live proof page keeps serving the last good snapshot with a
  visible `REFRESH FAILED` banner instead of a stale LIVE badge.

## 9. Hackathon deliverables map

| Deliverable | File | Status |
|---|---|---|
| Product + demo | `scripts/demo.mjs`, `src/answer.mjs` | works (live & offline) |
| Proof page | `scripts/proof-page.mjs` (`npm run proof[:offline]`) | live & offline verified |
| Static export | `npm run export` → `./site` | verified (labelled snapshot, env-scan clean) |
| **Hosted static export (a cached snapshot)** | <https://freshness-bound-recall-oxunify.vercel.app> | Vercel production deployment, HTTP 200 unauthenticated, byte-identical to the deployed export (sha256 `91ebae92b30481f9…`) |
| **Public repository** | <https://github.com/unifyWeb3/freshness-bound-recall> | pushed with the full history; HTTP 200 unauthenticated |
| Observed mainnet memories | namespace `freshness-recall` (22) | ids in `reports/build-phase2.md` §2 + `reports/pre-submit.md` |
| Decision ledger | `data/ledger.jsonl` (git-ignored) | ≥306 entries |
| Learned-policy memories | `fc-policy-FAST-v1` (`19ZE9y-zWt1…`), `fc-policy-SLOW-v2` (`Zne2mnjAy6u…`) | both persisted live |
| Policy read-back + gate effect | `scripts/show-policy-effect.mjs` | verified (live policy read-back + recorded-mainnet replay verdict flip) |
| Judge 60 s | `docs/judge-60s.md` | fresh-clone verified |
| Judge container | `Dockerfile`, `.nvmrc`, `.dockerignore` | written; docker build UNVERIFIED (no daemon in build env) |
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
* The public remote is <https://github.com/unifyWeb3/freshness-bound-recall>; tree and history audits
  verify that no `.env` or runtime artifact is tracked.
* The startup credential self-test proves `MEMWAL_ACCOUNT_ID` is the MemWalAccount object id
  (not the wallet) on-chain, and that the relayer is reached with ≥30 s timeouts and retries.
* `src/redact.mjs` scrubs secret-shaped strings from everything the ledger writes; `audit-secrets.mjs`
  asserts no tracked file contains any value fingerprinted from `.env` or matches PEM/JWT prefixes.

## 11. Submission note (to be posted by the user)

The user will submit the hackathon form with placeholders already resolved: see `docs/submission.md`.
Nothing has been submitted, published, or posted by the agent. The X/LinkedIn bonus post is the user’s
to post.
