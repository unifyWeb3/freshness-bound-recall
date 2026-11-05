# Pre-Submission Hardening — FRESHNESS-BOUND RECALL

**Date:** 2026-11-05 ~02:30–03:30 UTC · **Workspace:** `~/total-recall` · **Runtime:** Node v26.13.0, npm 11.20.0
**Commit under test:** `e57f280` (fresh clones verified against this tree) · **Nothing was pushed, posted, deployed or submitted.**

## Verdict: **GO** — with one explicit, delegated retention risk (§1) and 6 decisions listed in §9.

Nothing in this report implies any action on your accounts or your wallet. No blob was renewed, extended,
re-seeded, burned or paid for; no transaction was signed; no post or message exists anywhere except in
this repository.

---

## 1. RETENTION — current state, what could not be read, options

### What the mainnet relayer actually promises (VERIFIED, docs)

Walrus Memory docs → *Environment Variables* (quoted verbatim):

> “The sidecar `POST /walrus/upload` route defaults Walrus storage epochs by network: `50` on `testnet`
> (about 50 days) and **`2` on `mainnet` (about 4 weeks)**, unless the request explicitly passes `epochs`.”

And *Manage Your Memory*: “A memory persists on Walrus for the number of epochs you paid for. An epoch is
about 2 weeks on Mainnet … **When the epochs run out, Walrus drops the blob and the memory disappears** …
Renew before the expiry epoch, not after.”

### Whether these 17 blobs expire before 2026-11-17 (judging) — honest answer

**UNKNOWN, and — with the tools available here — unfalsifiable.** What I tried, in order:

| Route | Result |
|---|---|
| `events(filter:{atCheckpoint: …})` at all 9 write checkpoints and ±12 cps; and `module`-restricted to `0xa9ac…::events` | **No walrus events at all** — the page is crowded by DEX/oracle events (50-entry cap) and Tatum's `afterCheckpoint`/`beforeCheckpoint` range filter returns 0 rows even where events provably exist (coin case was also empty) |
| Walrus System object `0x2134…` (JSON) | Returns id / version=4 / `package_id=0xa9ac4281c72b0ed3277c08e821ab77eccea7b187f2b402ffa3b33f548d4bbf1e` only — **the current epoch is not published there** |
| Walrus Staking pool object `0x10b9…` (JSON) | id / version / package_id only |
| MemWal `listMemories()` / `listNamespaces()` | `memories=17, deleted=0, must_resync=false` — **no expiry field exists** (`MemorySummary` has no end_epoch) |
| Walrus HTTP aggregators (`aggregator.memory.walrus.xyz`, `aggregator.walrus.xyz`) | **unreachable from this environment** (curl exit 000) |
| Earliest-blob recall | **OK** — `wYNZE__Q3HkeRZIYf0BljMRa92DnZ0S5yt08xjLEIdE` recalled on 2026-11-05 01:29 UTC (still present at 03:30 UTC; namespace intact) |

The relayer's upload path almost certainly used the **mainnet default of 2 epochs (~4 weeks)**, which —
if true — lands around **2026-12-03** (INFERRED from docs, not read off chain). Whether that's the case for
these specific blobs is not knowable from here, and **expiry before 2026-11-17 cannot be ruled out**: it
depends on the epoch boundary at registration time and on whether the relayer overrode `epochs` for Walrus
Memory writes (not documented, not observable).

**A judge opening blob `wYNZE__…` today sees it. Whether that blob still exists when judged is UNKNOWN.**

### Options (costed — none executed)

| Option | Cost | Notes |
|---|---|---|
| **(a) Accept the risk; ship with cached mode** | 0 | The submission and the demo do **not** depend on the namespace at judging time: `npm run demo:offline`, `npm run proof:offline` and `npm run export` all run from a committed snapshot. The ledger evidence (150 entries, 59 FRESH/87 STALE/4 UNVERIFIED) is frozen in `freeze/freeze-…`. Probably fine but worst case judges see stale/no live blobs |
| **(b) Renew all 17 blobs** on the Walrus dashboard **before Nov 10** | WAL + gas — negligible (17 tiny blobs, likely < 0.1 WAL + fees) | **Your** transaction — I will not sign or fund. Strongly recommended (renew from the console's “renew memories” flow with ≥1 epoch margin) |
| **(c) Re-seed namespace with long epochs** via `MemWalManual` `walrusEpochs: 50` | New writes only (new blob ids; reports stale) | Not recommended — throws away the evidence chain |
| **(d) Ask the relayer / dashboard whether Walrus Memory relayer writes carry 50-epoch defaults** | time only | Unknown until someone looks at the dashboard's blob details |

**Decision needed from you: (a) or (b).** I recommend **(b)**, done 2026-11-09.

---

## 2. CREDIT BURN — what `--budget=0` means, projections, safest setting, proof-page failure mode

### What `--budget=0` means (exactly)

In `scripts/observer.mjs`, every write goes through `writeMemory()`/`enqueue()`, which refuses once
`budgetUsed + queued >= budget`. With **budget=0** the observer

1. **writes nothing to Walrus Memory** — every observation, correction or policy memory becomes a log
   line *“budget exhausted … recorded in the ledger only”*;
2. **keeps reading**: one checkpoint read (uncached — the 1 s TTL never helps at 60 s intervals) + two
   subject pins per round;
3. **keeps appending to the local ledger** (`data/ledger.jsonl`) — which is why it costs Tatum credits
   while producing zero mainnet writes.

Measured cost at the current `--interval=60`: **3 GraphQL requests per minute ⇒ ~4,320/day ⇒ ~52k
requests by 2026-11-17** (12 days). The measurement run made **exactly 30 attempted reads, 21 actual
GraphQL requests** (9 absorbed by the 1 s checkpoint cache; p50 187 ms; zero errors). Tatum
credits-per-call remains **UNKNOWN** — no credit header is returned, so the 3 rps free plan is the
only price signal we have; the dashboard remains yours to check.

### Live proof page while running

`npm run proof` in live mode refreshes every `--refresh` seconds (default **15 s**): ~1 checkpoint
read + 2 subject pins (Tatum) **and** 2 relayer recalls (broad + policy) per refresh ⇒
~**34,000 Tatum requests/day** + ~57,000 relayer requests/day. It must never run unattended through
judging.

### Safest settings for the judging window (11–16 Nov)

- **Observer:** restart at `--interval=300 --budget=0` (~**864 Tatum calls/day**, ~10k over judging), or
  stop it entirely (`pkill -f observer`) and use the frozen data. I will not restart or stop it without your
  say-so; it is presently running (PID 16783, `--interval=60`).
- **Proof page:** `--offline` or static (`npm run export`) for the recorded video and the judging demo.
  Live mode only while you are watching, e.g. `npm run proof` for 2 minutes during a demo and stop it.
- **Demo:** `npm run demo` (live) on demand — ~6 Tatum calls — not as a background process.
- **What happens when credits or rate limits run out (now fixed):** the proof page logs
  `[proof] refresh failed: …`; it keeps serving the **last good snapshot**, `/healthz` reports
  `{"ok":false, error:"…"}`, and — as of this phase — the page shows a **red banner with the failure and
  the last-good fetch time** instead of a stale LIVE badge. Offline mode is unaffected and cannot
  exhaust anything.

---

## 3. LEARNING LOOP HONESTY — counts and the exact words used in public copy

### Per-class signal counts (from `data/ledger.jsonl`, current tree)

| Class | Samples | MISSED-CHANGE | FALSE-STALE | CONSISTENT | STALE verdicts | FRESH verdicts |
|---|---|---|---|---|---|---|
| FAST (Sui Clock) | 75 | **5** | 0 | 68 | 73 | 2 unverified |
| SLOW (MemWal Registry) | 75 | 0 | **14** | 59 | 14 | 59 |

(The FS=14 includes the whole live 5000-checkpoint era, before the live widen at 01:00–01:34 UTC.)

### Policy state (mirror + memory)

| Class | Window | Version | Samples | falseStale / missedChange | Where it lives |
|---|---|---|---|---|---|
| FAST | **25** | v1 | 31 | 0 / 3 | **Persisted on mainnet** — `fc-policy-FAST-v1`, blob `19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o` (loaded at every startup and every answer) |
| SLOW | **20000** | v2 | 27 | 6 / 0 | **Local mirror only** (`data/policy-mirror.json`, git-ignored). The observer ran with `--budget=0` when the widen fired, so no memory was written — **SLOW reverts to 5000 on restart.** |

### What the README and blog now say (wording, not paraphrase)

> **README §5 “Learning — what is demonstrated, honestly”:** tighten persisted (FAST, mainnet); widen
> learned live (SLOW 5000→10000→20000) but **not persisted** (budget=0 — mirror only, resets on
> restart); both directions end-to-end with persisted memories = replay only (`test/replay.test.mjs`).
> Per-class totals printed; no thresholds changed; no samples forced.
>
> **Blog:** “the persisted, recalled-on-every-start policy in production today is the tightened one for
> FAST and the **default 5000** for SLOW (no SLOW policy memory was written). The widen direction is
> real, live, and measurable in the ledger — but it would be fiction to say it survived a restart.”

No thresholds were changed and no events were forced in this phase.

---

## 4. STATIC PROOF PAGE — `npm run export` (new)

`scripts/export-site.mjs` — verified:

```
[export] wrote ./site/index.html
[export] source snapshot: …/data/cache/proof-snapshot.json (generated 2026-11-05T02:05:58.622Z)
[export] bytes=42270 sha256=c4349d6a4d668483…
[export] scanned 4 env values for accidental leakage: none found
```

* `./site/index.html` is a single self-contained page: no CDN, no fetches, **STATIC EXPORT** banner with
  timestamp + “network off · ids & stamps from a labelled snapshot”; it contains all 17 blobs and their
  checkpoint stamps; decision ledger and ablation table included.
* The HTML is asserted against **every value in `.env`** (length ≥ 8) plus secret-shaped patterns
  before being written; it was **not** committed (`site/` is git-ignored). The user decides hosting.
* `npm run export` works from a fresh clone offline (falls back to the committed evidence snapshot,
  and cannot see any `.env` values — nothing exists to scan).

---

## 5. JUDGE QUICKSTART — `docs/judge-60s.md` (new, written and verified)

Contents: clone → `npm install --ignore-scripts` → `npm test` (expected: 66 tests, **62 pass, 4 skipped**)
→ `npm run demo:offline` → `npm run proof:offline` (serves `127.0.0.1:8787` from the committed snapshot)
→ `npm run export`. Optional live: `prewarm`, `demo`, `test:live`.

**Verified fresh-clone runs** (the exact commands from the doc):

```
$ npm install --ignore-scripts  → added 30 packages in 3s           (under Node v26.13.0)
$ npm test                      → ℹ tests 66 ℹ pass 62 ℹ fail 0 ℹ skipped 4
$ npm run demo:offline          → WITHHELD — subject changed … stale-answers=0
$ npm run export                → ./site/index.html written (env-scan clean)
$ npm run proof:offline         → "serving …/docs/evidence/proof-snapshot.json" (CACHED SNAPSHOT badge)
```

Two traps found and fixed during verification:

1. **Node floor is load-bearing.** On this machine the default `node` is v24.22.2; `npm test` there fails
   with `Cannot find module …/test`, not a nice message. `.npmrc` now sets **`engine-strict=true`** so an
   old Node fails at install with `ENOTSUP Required: {"node":">=26.13.0"}` (verified), and `judge-60s.md`
   says `node --version` first with the nvm line.
2. **The clone had no `.env`** and `createRuntime()` crashed offline. Fixed in `src/runtime.mjs` (offline
   never touches secrets; live mode fails with a named error instead of ENOENT). Committed; clone verified
   again end-to-end under the pinned runtime.

---

## 6. BLOG — finalized (`docs/blog.md`, paste-ready)

* Placeholders **only**: `{VIDEO_URL}` and `{REPO_URL}`; nothing else is unresolved.
* States what it does, how Walrus Memory is used (lineage `supersedes`; 17 blobs enumerated; no
  delete/update in SDK 0.1.13; semantic recall with proof stamps), how Tatum is used (read-only GraphQL
  on the free shared plan; 1 s cache; ≤2 calls/answer; fail-closed; on-chain MemWalAccount proof), and
  how it learned over time — with the table in §3 of this report, including “it would be fiction to say
  [the SLOW widen] survived a restart”.
* Does **not** claim that no other entry gates recall. It names Recall Lab and RecallIQ stamping
  freshness, and Invoice Chaser / swiftbotlab stream/canary patterns, and states the actual difference:
  placement on the answer path + the tolerance being a memory the system rewrites.
* Retention, credits, no-user persona, and the budget=0 deadlock are all disclosed.
* Nothing was posted; this is a local Markdown file for you to paste.

---

## 7. FREEZE — `npm run freeze` (new, verified live)

```
[freeze] source=live
[freeze] 17 memories · 150 ledger entries (4 WITHHELD_UNVERIFIED · 87 STALE · 59 FRESH)
[freeze] commit e57f2803b05e · 1 dirty path(s) · node v26.13.0
```

* Writes `./freeze/freeze-<UTC-timestamp>.json` (claims · blob ids · checkpoint/object version/digest
  stamps · verdict counts · node version · git state · sha256 of every copied artifact) plus verbatim
  copies of `ledger.jsonl` and the proof snapshot used for render. Current artifacts:
  `freeze/freeze-2026-11-05T022330578Z.json` (17 blobs with cp stamps, 150 ledger entries,
  commit `e57f2803b05e`, source `live`).
* `./freeze/` is git-ignored (runtime artifact for the video and submission, printed for you).
* Re-run any time before the video: `npm run freeze`. It issues a live read; expect ~10–30 s.

---

## 8. FINAL AUDIT — tree, history, form, map, tests

**Working tree (this commit):** `npm run audit:secrets` → **AUDIT: PASS** (50 tracked files; 2 fingerprinted
env values never printed; no remote configured).

**Git history, all refs:** `node scripts/audit-history.mjs` → **AUDIT: PASS** (103 objects · 65 blobs;
`.env` never in any commit; every blob scanned against current `.env` values and shaped patterns — 0 findings).

**`.env`:** untracked everywhere; `git check-ignore` ✓; absent from the fresh clone.

**`docs/submission.md` vs the live B2 form (read read-only 2026-11-04):**
email · discordId · linkedinUrl · telegramId · howHeard · firstWeb3Project · tatumAccountId · suiAddress ·
`accountId` (Account ID (SUI)) · `memwalAgentId` · description · demoVideoUrl · repoUrl · additionalDocs ·
walrusExperience · tatumAiBuilderExperience · walrusFriction · socialPosts — **all present** (18/18), plus the
**event-rules acceptance checkbox** now listed as required, with an explicit note that the **agent never ticks
it — you do**. No track selector exists; the description carries `Track 02 — Smart Agents for Real Life`.
Field copy labels match the B2 row verbatim.

**README claim → evidence map re-read end-to-end for `e57f280`:** 17 memories everywhere; learning claims
are split into persisted/live-but-unpersisted/replay; credits row shows 21 actual requests (UNKNOWN);
retention row says UNKNOWN with the relayer default quoted and the Nov-17 caveat; judge quickstart linked.

**Tests (current tree, this machine, pinned runtime):**
`npm test` → **64 pass · 0 fail · 2 of 66 skipped** (the two opt-in live tests skip unless
`RUN_MAINNET=1`). Live suite re-run: **2 passed** (writes 2 more blobs — `DL6hLBNQd2fDxRnNM8R0MCekw9QcR583dEuK2YUSRW4`
at cp 341758897 and `q1vX8synwjZ0tFpdpl9fAdKWIxvtGj9r7G3eBYGVIcw` at cp 341759010 — hence 17 total).

Also re-verified from a fresh clone of `e57f280` (the commit this report reviews): install OK under the
pinned runtime; tests green; demo works offline; page serves with the CACHED badge; export clean; Node-floor
trap produces a legible `ENOTSUP` instead of a cryptic failure.

---

## 9. Decisions needed from you

1. **Retention** — **(a)** accept the documented UNKNOWN (free; the demo and proof page never depend on the
   namespace at judging time), or **(b)** renew the 17 blobs on the Walrus dashboard before Nov 10
   (I recommend (b), your transaction, ~0 cost in WAL/gas). I will not sign, fund, renew or re-seed anything.
2. **Repo to the portal** — the form needs `repoUrl`: public repo? a reviewer-invited private repo? a ZIP via
   the portal? (Or whichever mechanism the hackathon tells you to use — I configure nothing.)
3. **Recording cadence** — record the video against `e57f280` now (offline-proof page shot list is
   deterministic and always works), or after the retention decision settles? My recommendation: record
   **after** (1) is decided; script stays unchanged either way (`docs/video-script.md`, ≤2:30).
4. **Bonus posts** — post on X and/or LinkedIn (your accounts; tagging @Tatum_io and @WalrusFoundation is
   your call), or leave `socialPosts=none` in the form.
5. **Observer for the judging window** — stop PID 16783 now (`pkill -f observer`), or restart it at
   `--interval=300`? I do not touch it without your word; my recommendation is restart at 300 s or stop.
6. **Submission timing** — submit 2026-11-10 morning UTC (12 h headroom), or another slot you prefer.

**Hard deadline in this plan:** nothing is submitted until you say so.
