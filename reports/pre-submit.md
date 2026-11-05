# Pre-Submission Hardening — FRESHNESS-BOUND RECALL

## Verdict: **GO** — 2026-11-05 12:15 UTC · final fixes applied · nothing pushed, posted, deployed or submitted

**Date:** 2026-11-05 · **Workspace:** `~/total-recall` · **Runtime:** Node v26.13.0, npm 11.20.0
**Nothing was pushed, posted, deployed or submitted.** No transaction was signed; no blob was renewed,
extended, re-seeded or paid for. The only write to mainnet in this phase was the single policy memory
the task authorised: `fc-policy-SLOW-v2` (§1).

**Verification run (this phase, pinned runtime):**

| Check | Result |
|---|---|
| `npm test` (offline) | **65 pass · 0 fail · 2 skipped** (the 2 live opt-in tests skip without `RUN_MAINNET=1`) |
| `RUN_MAINNET=1 node --test test/live/` | **2 pass** — wrote `6InMSm3…` (cp 341894684) and `8xyFMV-…` (cp 341894821) |
| namespace `freshness-recall` | **20 memories**, 0 deleted, `must_resync=false` |
| `npm run audit:secrets` (working tree) | **AUDIT: PASS** |
| `node scripts/audit-history.mjs` (all git refs) | **AUDIT: PASS** |
| `npm run freeze` | `freeze/freeze-2026-11-05T115517263Z.json` — 20 memories · 306 ledger entries (72 FRESH · 230 STALE · 4 WITHHELD_UNVERIFIED) |
| `npm run credits` | 21 actual GraphQL requests, **21/21 carried `x-api-key`**, plan `free;ratelimit=3;strategy=shared` |
| Docker path | **UNKNOWN** — no Docker daemon in the build environment (§6) |

---

## 0. What changed in this final phase

| # | Task | Result |
|---|---|---|
| 1 | Persist the already-learned SLOW policy | **Done** — `fc-policy-SLOW-v2`, blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`; learned_at ≠ written_at; read back; gate verdict flipped (§1) |
| 2 | README: promise, exact rules, live-vs-replay, blob labels | **Done** (§3) |
| 3 | Judge friction: `.nvmrc`, `Dockerfile`, Node requirement on line 1 | **Done** (§6) |
| 4 | Tatum proof: `x-api-key` on every call, README usage section | **Done** (§4) |
| 5 | Re-run freeze/tests/audits; submission + this report | **Done** (§7, §8) |

---

## 1. THE SLOW POLICY IS NOW PERSISTED (one write, authorised)

### What was written

Exactly **one** memory, in namespace `freshness-recall`:

| Field | Value | Source |
|---|---|---|
| blob id | `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4` | relayer |
| claim | `fc-policy-SLOW-v2` | — |
| class / state / predicate | `SLOW` / `policy` / `policy_window` | — |
| `policy.window_checkpoints` | **20000** | the learned value — **not recomputed, not tuned** |
| `policy.min_checkpoints` / `policy.max_checkpoints` | 10 / 2000000 | the SLOW bounds |
| `policy.version` | 2 | derived from the ledger (2nd window change of that observer run) |
| `policy.false_stale` / `policy.missed_change` / `policy.samples` | 6 / 0 / 6 | the engine counters at the learning event |
| `policy.reason` | `FALSE-STALE 3 > MISSED-CHANGE 0: widen 10000 -> 20000` | verbatim from the ledger entry |
| **`policy.learned_at`** | **2026-11-05T02:05:19.054Z** | **the ledger event — not backdated** |
| **`policy.written_at`** / `recorded_at` | **2026-11-05T09:23:05.105Z** | **the real clock at the write** |
| `proof.checkpoint_seq` / `proof.checkpoint_digest` | 341867198 / `8tVd3KASU65…` | a live Tatum read at write time |

The writer is `scripts/persist-policy.mjs`: it derives **every** number from `data/ledger.jsonl`, asserts
that the ledger really contains a learning event for the requested window (and that it was a widen with
≥3 FALSE-STALE samples and 0 MISSED-CHANGE), refuses to run without `--confirm=fc-policy-SLOW-v2`, and
re-runs the startup credential self-test before writing. **It refuses to write if the self-test fails** —
which it did on the first attempt (a transient Tatum network failure), so the write was correctly
suppressed; the retry passed and the single authorised write went out.

### The rule and bounds that produced it (as written into the record body)

> FALSE-STALE (window said stale, subject pin unchanged) widens the window x2; MISSED-CHANGE (window said
> fresh, subject pin changed) tightens it /2. A window change requires at least 3 actionable samples
> since the last change; CONSISTENT and UNVERIFIED never move the window. Bounds for class SLOW:
> window_checkpoints in [10, 2000000].

### The evidence it cites

The record body lists **all 16 FALSE-STALE ledger entries** with timestamp, checkpoint, delta and pin
state. The six that produced the persisted value (the 02:05:19 learning event) are:

```
2026-11-05T01:40:07.501Z cp=341752968 delta=11938 pin_unchanged=true -> pending
2026-11-05T01:45:08.816Z cp=341754208 delta=13178 pin_unchanged=true -> pending
2026-11-05T01:50:10.489Z cp=341755439 delta=14409 pin_unchanged=true -> widen to 10000
2026-11-05T01:55:11.902Z cp=341756679 delta=15649 pin_unchanged=true -> pending
2026-11-05T02:00:18.108Z cp=341757935 delta=16905 pin_unchanged=true -> pending
2026-11-05T02:05:19.054Z cp=341759185 delta=18155 pin_unchanged=true -> widen to 20000
```

(The user's brief said "the 14 FALSE-STALE samples" — that was the count when the instruction was written.
The ledger now holds **16**; the record cites all of them, so the superset is disclosed rather than
silently trimmed.)

### Read-back and the gate verdict it changes — `node scripts/show-policy-effect.mjs`

```
A. POLICY READ BACK FROM WALRUS MEMORY (LIVE)
   fc-policy-SLOW-v2  blob=Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4
      window=20000 version=2 bounds=[10, 2000000]
      reason=FALSE-STALE 3 > MISSED-CHANGE 0: widen 10000 -> 20000
      learned_at=2026-11-05T02:05:19.054Z  written_at=2026-11-05T09:23:05.105Z
      false_stale=6 missed_change=0 samples=6
   fc-policy-FAST-v1  blob=19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o
      window=25 version=1 bounds=[10, 200000]
   engine load source=store loaded_at=2026-11-05T09:26:06.784Z

B. REPLAY: a recorded mainnet observer decision, re-evaluated
   recorded decision: 2026-11-05T02:05:19.054Z  round 6  checkpoint 341759185
   memory under test: obs-memwal-registry-341741030 blob=Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g
   memory OFF (default window 5000): STALE (FALSE-STALE) - checkpoint window exceeded (delta 18155 > window 5000)
   memory ON  (window 20000 from blob): FRESH (CONSISTENT) - fresh (checkpoint delta 18155 <= 20000, subject unchanged)

C. LIVE: gate evaluated against the live checkpoint + live pin
   live checkpoint 341867949 · live SLOW pin version 1062994385 digest ByXrgtEzoPoCavLtngGkpCT4yC34VoAUf6yStFGfCCod
   memory OFF (default window 5000): STALE (FALSE-STALE) - checkpoint window exceeded (delta 6000 > window 5000)
   memory ON  (window 20000 from blob): FRESH (CONSISTENT) - fresh (checkpoint delta 6000 <= 20000, subject unchanged)
```

* **B is labelled REPLAY**: a recorded mainnet decision (real memory, real checkpoint, real pin, same
  clock) — only the window differs.
* **C is labelled LIVE**: real live checkpoint and real live pin, but the claim is **constructed for the
  demo** (its anchor checkpoint is a real chain checkpoint 6000 behind the live one); it is not a stored
  memory, and the script says so.

### Honest caveats about this write

1. **The observer has since learned a wider window.** At 2026-11-05T02:25:24.293Z it widened SLOW
   20000 → **40000** (3 more FALSE-STALE samples). That result is **not persisted** — the only SLOW
   policy memory on chain is the 20000 one, which is *tighter* (more conservative) than the latest local
   mirror. The persisted record discloses this in its own body. (The author may want a `v3` write; that
   would need confirmation.)
2. **The SLOW widen happened twice.** The observer restarted at ~01:40 UTC and re-learned
   5000→10000→20000 from scratch (the earlier run reached 20000 at 01:34:22.687Z). The persisted record
   cites the **most recent** learning event (02:05:19.054Z).
3. **One malformed auxiliary field.** `policy.evidence_count=undefined` — a variable-name slip in the
   writer (`falseStale.length` instead of `falseStaleEntries.length`). The **evidence list itself is
   intact in the record body** (all 16 entries), `policy.false_stale=6` carries the count that matters,
   and the policy engine never reads that field. The script has been corrected. Fixing the blob would
   require a **second write**, which needs the author's confirmation — it was not done.
4. The ledger has grown since the brief was written (16 FALSE-STALE samples, 306 decisions).

---

## 2. RETENTION — current state, what could not be read, options

### What the mainnet relayer actually promises (VERIFIED, docs)

Walrus Memory docs → *Environment Variables* (quoted verbatim):

> “The sidecar `POST /walrus/upload` route defaults Walrus storage epochs by network: `50` on `testnet`
> (about 50 days) and **`2` on `mainnet` (about 4 weeks)`**, unless the request explicitly passes `epochs`.”

And *Manage Your Memory*: “A memory persists on Walrus for the number of epochs you paid for. An epoch is
about 2 weeks on Mainnet … **When the epochs run out, Walrus drops the blob and the memory disappears** …
Renew before the expiry epoch, not after.”

### Whether these 20 blobs expire before 2026-11-17 (judging) — honest answer

**UNKNOWN, and — with the tools available here — unfalsifiable.** What was tried:

| Route | Result |
|---|---|
| `events(filter:{atCheckpoint: …})` at all write checkpoints and ±12 cps; `module`-restricted to `0xa9ac…::events` | **No walrus events at all** — the page is crowded by DEX/oracle events (50-entry cap) and Tatum's `afterCheckpoint`/`beforeCheckpoint` range filter returns 0 rows even where events provably exist (coin case was also empty) |
| Walrus System object `0x2134…` / Staking pool `0x10b9…` (JSON) | id / version=4 / `package_id` only — **the current epoch is not published there** |
| MemWal `listMemories()` / `listNamespaces()` | `memories=20, deleted=0, must_resync=false` — **no expiry field exists** (`MemorySummary` has no `end_epoch`) |
| Walrus HTTP aggregators | **unreachable from this environment** (curl exit 000) |
| Earliest-blob recall | **OK** — `wYNZE__Q3HkeRZIYf0BljMRa92DnZ0S5yt08xjLEIdE` recalled on 2026-11-05 01:29 UTC; namespace intact at 12:00 UTC |

The relayer's upload path almost certainly used the **mainnet default of 2 epochs (~4 weeks)**, which —
if true — lands around **2026-12-03** (INFERRED from docs, not read off chain). Whether that is the case
for these specific blobs is not knowable from here, and **expiry before 2026-11-17 cannot be ruled out**.

**A judge opening blob `wYNZE__…` today sees it. Whether that blob still exists when judged is UNKNOWN.**

### Options (costed — none executed)

| Option | Cost | Notes |
|---|---|---|
| **(a) Accept the risk; ship with cached mode** | 0 | The submission and the demo do **not** depend on the namespace at judging time: `npm run demo:offline`, `npm run proof:offline` and `npm run export` all run from a committed snapshot. The ledger evidence (306 entries) is frozen in `freeze/freeze-…` |
| **(b) Renew the blobs** on the Walrus dashboard **before Nov 10** | WAL + gas — negligible for 20 tiny blobs | **Your** transaction — the agent will not sign or fund. Strongly recommended (renew with ≥1 epoch margin) |
| **(c) Re-seed the namespace with long epochs** | new blob ids; reports go stale | Not recommended |
| **(d) Ask the relayer / dashboard whether Walrus Memory relayer writes carry 50-epoch defaults** | time only | Unknown until someone checks the dashboard's blob details |

---

## 3. CREDIT BURN — what `--budget=0` means, projections, safest setting, proof-page failure mode

### What `--budget=0` means (exactly)

In `scripts/observer.mjs`, every write goes through `writeMemory()`/`enqueue()`, which refuses once
`budgetUsed + queued >= budget`. With **budget=0** the observer

1. **writes nothing to Walrus Memory** — every observation, correction or policy memory becomes a log
   line *“budget exhausted … recorded in the ledger only”*;
2. **keeps reading**: one checkpoint read (uncached — the 1 s TTL never helps at 60 s intervals) + two
   subject pins per round;
3. **keeps appending to the local ledger** (`data/ledger.jsonl`) — which is why it costs Tatum credits
   while producing zero mainnet writes.

Measured cost at `--interval=60`: **3 GraphQL requests per minute ⇒ ~4,320/day**. The measurement run made
**exactly 30 attempted reads, 21 actual GraphQL requests** (9 absorbed by the 1 s checkpoint cache; p50
189 ms; zero errors). Tatum credits-per-call remains **UNKNOWN** — no credit header is returned.

### Live proof page while running

`npm run proof` in live mode refreshes every `--refresh` seconds (default **15 s**): ~1 checkpoint read +
2 subject pins (Tatum) **and** 2 relayer recalls (broad + policy) per refresh ⇒ ~**34,000 Tatum
requests/day** + ~57,000 relayer requests/day. It must never run unattended through judging.

### Safest settings for the judging window (11–16 Nov)

- **Observer:** the running instance is `node scripts/observer.mjs --live --interval=300 --budget=0`
  (PID 56574) → ~**864 Tatum calls/day**, ~10k over judging, zero writes. Leave it at 300 s or stop it;
  the agent does not touch it without the author's word.
- **Proof page:** `--offline` or static (`npm run export`) for the recorded video and the judging demo.
- **Demo:** `npm run demo` (live) on demand — ~6 Tatum calls — not as a background process.
- **When credits or rate limits run out:** the proof page logs `[proof] refresh failed: …`; it keeps
  serving the **last good snapshot**, `/healthz` reports `{"ok":false, error:"…"}`, and the page shows a
  **red banner with the failure and the last-good fetch time** instead of a stale LIVE badge. Offline mode
  is unaffected and cannot exhaust anything.

---

## 4. LEARNING LOOP HONESTY — counts and the exact words used in public copy

### Per-class signal counts (from `data/ledger.jsonl`, current tree)

| Class | Samples | MISSED-CHANGE | FALSE-STALE | CONSISTENT | STALE verdicts | FRESH verdicts |
|---|---|---|---|---|---|---|
| FAST (Sui Clock) | 153 | **5** | 0 | 146 | 151 | 2 unverified |
| SLOW (MemWal Registry) | 153 | 0 | **16** | 135 | 79 | 72 |

(Totals: 306 decisions — 72 FRESH · 230 STALE · 4 WITHHELD_UNVERIFIED. The ledger keeps growing while
the observer runs; the numbers above are the freeze-time values.)

### Policy state (memory + local mirror)

| Class | Window | Version | Persisted? | Where it lives |
|---|---|---|---|---|
| FAST | **25** | v1 | **YES** | `fc-policy-FAST-v1`, blob `19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o` — loaded at every startup and every answer |
| SLOW | **20000** | v2 | **YES** (this phase) | `fc-policy-SLOW-v2`, blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4` — learned_at 02:05:19Z, written_at 09:23:05Z |
| SLOW (later local learning) | 40000 | v3 | no | `data/policy-mirror.json` only — disclosed in the persisted record's body |

### What the README and blog now say

> **README §5:** both directions are learned live **and persisted as memories**; the “both directions
> persisted end-to-end” row now reads **LIVE, not replay-only**; the replay is kept as the deterministic
> offline check. The unpersisted 40000 learning, the double learning, the FAST sampling deadlock and the
> malformed `policy.evidence_count` field are all disclosed in-line.
>
> **Blog:** the same table, plus “the policy is not decorative: reading it back changes the gate's
> verdict” and the three honest caveats. It no longer says the SLOW policy was not persisted.

No thresholds were changed and no events were forced in this phase.

---

## 5. STATIC PROOF PAGE — `npm run export`

`scripts/export-site.mjs` — verified:

```
[export] wrote /home/unify/total-recall/site/index.html
[export] source snapshot: …/data/cache/proof-snapshot.json (generated 2026-11-05T11:5x UTC)
[export] bytes=… sha256=…
[export] scanned 4 env values for accidental leakage: none found
```

* `./site/index.html` is a single self-contained page: no CDN, no fetches, **STATIC EXPORT** banner with
  timestamp + “network off · ids & stamps from a labelled snapshot”; it contains all 20 blobs and their
  checkpoint stamps; the decision ledger, the ablation table and the Tatum request log with the
  `x-api-key` badge per row.
* The HTML is asserted against **every value in `.env`** (length ≥ 8) plus secret-shaped patterns before
  being written; it is **not** committed (`site/` is git-ignored). The author decides hosting.

---

## 6. JUDGE FRICTION — `.nvmrc`, `Dockerfile`, `docs/judge-60s.md`

* **`.nvmrc`** → `26.13.0` (nvm picks it up; `nvm use` is the first line of the quickstart).
* **`Dockerfile`** → `node:26.13.0-slim`, `npm ci --ignore-scripts`, and a default command that runs
  `npm test` → `npm run demo:offline` → `npm run export`. **No secrets**: `.env` is excluded by
  `.dockerignore` (which also excludes `node_modules`, `site/`, `freeze/`, the runtime ledger/cache and
  `.git`), and no command in the image touches the live path.
* **`docs/judge-60s.md` line 1** is now the Node requirement:
  `**Requires Node v26.13.0 or newer (node --version; nvm use picks it up from .nvmrc) — an older Node
  fails at install with a clear ENOTSUP message.**`
* **Docker execution status: UNKNOWN.** The build environment has **no `docker` binary and no Docker
  socket** (`docker: command not found`, `/var/run/docker.sock` absent), so `docker build` / `docker run`
  could not be executed here. What *was* verified natively, from a fresh clone, with the exact command
  sequence the image runs and **no `.env` present**: `npm ci --ignore-scripts` → 30 packages, `npm test` →
  66 tests / 62 pass / 0 fail / 4 skipped, `npm run demo:offline` → 0 stale answers, `npm run export` →
  `site/index.html` written with 0 env values scanned. **The image itself is therefore written but
  UNVERIFIED**, and the doc says exactly that.

---

## 7. FINAL AUDIT — tree, history, form, map, tests

**Working tree:** `npm run audit:secrets` → **AUDIT: PASS** (tracked files fingerprinted; secret values
never printed; no remote configured).

**Git history, all refs:** `node scripts/audit-history.mjs` → **AUDIT: PASS** (`.env` never in any
commit; every blob scanned against current `.env` values and secret-shaped patterns — 0 findings).

**`.env`:** untracked everywhere; `git check-ignore` ✓; absent from the fresh clone.

**`docs/submission.md` vs the live B2 form (read read-only 2026-11-04):**
email · discordId · linkedinUrl · telegramId · howHeard · firstWeb3Project · tatumAccountId · suiAddress ·
`accountId` (Account ID (SUI)) · `memwalAgentId` · description · demoVideoUrl · repoUrl · additionalDocs ·
walrusExperience · tatumAiBuilderExperience · walrusFriction · socialPosts — **all present (18/18)**, plus
the **event-rules acceptance checkbox** listed as required, with an explicit note that the **agent never
ticks it — you do**. No track selector exists; the description carries `Track 02 — Smart Agents for Real
Life`. Field copy labels match the B2 row verbatim.

**README claim → evidence map:** 20 memories everywhere (6 seeds / 7 observations / 4 corrections /
2 policy records / 1 adversarial); the learning claims are split into live+persisted / unpersisted-40000 /
replay; the credits row shows 21 actual requests (credits-per-call UNKNOWN); a new **§5b “Tatum usage”**
section carries the `npm run credits` output, the 21/21 and 291/291 `x-api-key` proofs and a
**dashboard-screenshot placeholder**; retention stays UNKNOWN with the relayer default quoted.

---

## 8. Decisions needed from you

1. **Retention** — **(a)** accept the documented UNKNOWN (free; the demo and proof page never depend on
   the namespace at judging time), or **(b)** renew the blobs on the Walrus dashboard before Nov 10
   (recommended; your transaction, negligible WAL/gas). The agent will not sign, fund, renew or re-seed.
2. **Optional `fc-policy-SLOW-v3`** — persist the later live learning (window 40000) as well, or keep
   20000 as the conservative persisted value? **This would be a second write and needs your confirmation.**
3. **Optional second write to fix `policy.evidence_count`** in `fc-policy-SLOW-v2` — cosmetic (the
   evidence list is in the body and the engine ignores the field), but it needs your confirmation.
4. **Repo to the portal** — the form needs `repoUrl`: public repo? a reviewer-invited private repo? a ZIP
   via the portal? (The agent configures nothing and has no remote.)
5. **Recording cadence** — record the video now against the current tree, or after the retention choice?
   The script is unchanged either way (`docs/video-script.md`, ≤2:30).
6. **Bonus posts** — post on X and/or LinkedIn (your accounts), or leave `socialPosts=none`.
7. **Observer** — leave it running at `--interval=300 --budget=0`, or stop it for the judging window?
8. **Submission timing** — Nov 10 morning UTC (12 h headroom), or another slot you prefer.

**Hard deadline in this plan:** nothing is submitted until you say so.

---

# Appendix — what the earlier hardening pass established (superseded numbers in brackets)

The first pre-submission pass (2026-11-05 02:30–03:30 UTC, commit `f89c8b3`) is superseded by the
sections above. It is summarised here so the record is complete without repeating stale figures; the
per-phase build reports (`reports/build-phase1.md` … `build-phase4.md`) remain the primary history.

* **Retention (unchanged conclusion).** Three routes were tried to read a blob's `end_epoch` and all
  failed for tooling reasons, not because the field is absent: Tatum's Sui event index returns **no
  walrus events** at the write checkpoints (the 50-entry page is crowded by DEX/oracle events, and the
  `afterCheckpoint`/`beforeCheckpoint` range filter returns 0 rows even for event types that provably
  exist — the `0x2::coin` case was also empty); the Walrus **System** object
  `0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2` and the **Staking** pool
  `0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904` expose only
  id / version=4 / `package_id=0xa9ac4281c72b0ed3277c08e821ab77eccea7b187f2b402ffa3b33f548d4bbf1e`;
  and the Walrus HTTP aggregators are unreachable from this environment (curl exit 000). The
  **relayer mainnet default of 2 epochs (~4 weeks)** comes from the Walrus Memory docs, not from chain
  state — it is INFERRED for these blobs, not VERIFIED.
* **Credits (unchanged conclusion).** `npm run credits --calls=20` → 30 attempted reads, **21 actual
  GraphQL requests** (9 absorbed by the 1 s checkpoint cache), p50 189 ms, 0 errors, plan
  `free;ratelimit=3;strategy=shared`. Credits-per-call stays **UNKNOWN** — Tatum returns no credit
  header, so only the dashboard can close it.
* **Two traps found by fresh-clone testing in that pass, both fixed here.** (a) Offline mode used to
  read `.env` unconditionally and crashed on a credential-less clone — fixed in `src/runtime.mjs`
  (offline never touches secrets; live mode fails with a named error). (b) The Node floor is
  load-bearing: on the build host the default `node` is v24.22.2 and `npm test` fails there with a
  cryptic `Cannot find module …/test` — `.npmrc` now sets `engine-strict=true`, so an old Node fails at
  install with `ENOTSUP Required: {"node":">=26.13.0"}`.
* **Artifacts from that pass** (still valid, superseded by the newer bundle): freeze manifests
  `freeze-2026-11-05T021132543Z.json` and `freeze-2026-11-05T022330578Z.json`; the committed evidence
  snapshot `docs/evidence/proof-snapshot.json` (regenerated in this phase with 20 memories and the
  `x-api-key` proof); `scripts/export-site.mjs`, `scripts/freeze.mjs`, `scripts/audit-history.mjs`.
* **Numbers superseded by this phase:** 17 → **20** mainnet memories; 150 → **306** ledger entries;
  59 FRESH / 87 STALE → **72 FRESH / 230 STALE**; the SLOW policy from “learned live, not persisted” →
  **persisted as `fc-policy-SLOW-v2`**; the Docker path → **UNKNOWN** (no daemon in this environment).
