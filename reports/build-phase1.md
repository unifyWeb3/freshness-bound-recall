# Build Report — Phase 1 (offline core)

**Date:** 2026-11-05 (00:00–00:35 UTC) · **Workspace:** `~/total-recall` · **Runtime:** Node v26.13.0 (`/home/unify/.local/node-v26.13.0/bin`), npm 11.20.0
**Phase goal:** offline, no-network core — FR-v1 schema, freshness gate, learned-policy module, Tatum client, MemWalMock, unit tests incl. replay + ablation.

**Verdict: GO.**

---

## 1. Verdict (first)

**GO — Phase 2 (mainnet) may start.** All Phase 1 deliverables exist and are covered by tests that
run offline with no network access. The claim classes have been measured on Sui mainnet over
11.2 minutes with evidence in `data/claim-class-measurement.json`.

Nothing was pushed, published, registered or submitted. No transaction was signed or funded. The
only network activity in this phase was **read-only** Tatum GraphQL calls and the npm registry
(install of pinned packages with `--ignore-scripts`).

---

## 2. What passed

| # | Deliverable | Where | Status |
|---|---|---|---|
| 1 | FR-v1 schema, parse/serialize round-trip | `src/schema.mjs` | **VERIFIED** — round-trip stable, 9 schema tests pass |
| 2 | Gate: window ∧ pin, wall-clock backstop, fail closed | `src/gate.mjs` | **VERIFIED** — 9 gate tests pass |
| 3 | Learned-policy module (closed loop, bounds, min samples, one memory per change) | `src/policy.mjs` | **VERIFIED** — 8 policy tests pass |
| 4 | Tatum client: GraphQL only, `x-api-key`, plan header, 1 s cache, ≤2 reads, backoff | `src/tatum.mjs` | **VERIFIED** — 10 client tests pass (fake transport, zero network) |
| 5 | MemWalMock store (mock + mainnet backends behind one interface) | `src/store.mjs` | **VERIFIED** — used by every test |
| 6 | Replay of a recorded event log: same query, different verdict after the policy changes | `src/replay.mjs`, `fixtures/event-log.json` | **VERIFIED** — `test/replay.test.mjs` |
| 7 | Memory-off vs memory-on ablation table | `src/replay.mjs` | **VERIFIED** — `test/replay.test.mjs` |
| 8 | Answer path end-to-end (recall → gate → withhold → re-read → supersede → policy) | `src/answer.mjs` | **VERIFIED** — 11 answer tests pass |
| 9 | Decision ledger (JSONL) + secret redaction | `src/ledger.mjs`, `src/redact.mjs` | **VERIFIED** — 6 redaction tests pass |
| 10 | Pinned dependencies installed with `--ignore-scripts` | `package.json`, `package-lock.json` | **VERIFIED** — installed versions match the pins exactly |

**Test suite: 64 tests, 64 pass, 0 fail — `npm test` (offline, ~1 s).**

```
npm test
# ℹ tests 64   ℹ pass 64   ℹ fail 0
```

Pinned versions installed (VERIFIED via `npm ls` + `package-lock.json`):

```
@mysten-incubation/memwal@0.1.13   @mysten/seal@1.1.3   @mysten/sui@2.16.2
@mysten/walrus@1.1.7               zod@3.25.76
```

---

## 3. What failed (and was fixed)

Nothing remains failing. Four real defects were found by the tests and fixed:

1. **`multiGetObjects` needs an `ObjectKey` input, not an address string.** Tatum rejected
   `multiGetObjects(keys:["0x…06"])` with *"Expected input type ObjectKey"*, so the first
   measurement run read **no objects at all** and reported every candidate as "SLOW".
   **Fix:** the measurement now uses per-object `object(address:$a)` reads.
   *Evidence:* live error reproduced in the transcript; `data/measure.log` now shows real versions.
2. **Transient `ENETUNREACH` on IPv6** killed two measurement runs. **Fix:** 8 attempts with
   exponential backoff and fault-tolerant rounds (a failed round is recorded, the run continues).
   The final run had **0 errors in 32 rounds**.
3. **The redactor would have destroyed proof data.** A generic `0x<64 hex>` secret pattern also
   matches a Sui address, which is exactly the shape of every object address we need to show.
   **Fix:** the pattern was removed; only known secret values, the bech32 `suiprivkey1…` shape and
   the `t-<hex>` Tatum-key shape are redacted. Test: *"the redactor keeps Sui addresses"*.
4. **Fail-open holes in the schema.** `makeRecord()` silently defaulted `class`/`state`/`epoch`
   (so a record with no class was accepted), and `serializeRecord()` did not validate the
   class/state enums or numeric fields (only `parseRecord()` did). `proof.object_version` was
   also being coerced to a number, which made every real record unparseable (Sui versions are
   opaque strings). **Fix:** no defaults anywhere, validation on both parse **and** serialize,
   versions/digests stay strings.

One design correction was made because the tests exposed it: a **FALSE-STALE** verdict (window
expired, subject unchanged) must **not** write a superseding correction — the stored memory is
still true, only the window was too tight. Writing a correction there would have reset the
checkpoint delta to 0 and destroyed the false-stale signal, so the loop could never learn.
Corrections are now written only when the subject's version/digest actually changed.

---

## 4. Claim classes — measured evidence (correction 2)

Read-only measurement over Sui **mainnet** through Tatum GraphQL. **VERIFIED** — ran it,
raw output in `data/claim-class-measurement.json` (+ `data/measure.log`).

* Method: `object(address:$a){address version digest}` per candidate, one `checkpoints(last:1)`
  per round, every 15 s.
* Window: **32 rounds, 669 s (11.2 min)** — comfortably over the required ≥5 min.
* Chain: Sui mainnet, `chainIdentifier = 4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`.
* Tatum plan header observed on every request: `free;ratelimit=3;strategy=shared`.
* Errors during the run: **0**.
* Checkpoint rate observed: **243.23 checkpoints/min** (≈4.05/s) over a span of 2714 checkpoints.

| Candidate | Address | Version first → last | Version changes | Rate | Class |
|---|---|---|---|---|---|
| C1 Sui Clock | `0x…06` | 1018746136 → 1018756335 | **31 / 32 intervals** | **2.778 / min** | **FAST** |
| C2 Sui system state | `0x…05` | 1072450605 → 1072460720 | 24 | 2.151 / min | FAST |
| C4 MemWal AccountRegistry | `0x8bf82c…199f` | 1062994378 → 1062994379 | 1 | 0.090 / min | SLOW (rarely changing) |
| C3 Sui framework package | `0x…02` | 60 → 60 | 0 | 0 | SLOW (immutable) |
| C5 MemWal package | `0xe7c16f…d7f5` | 1 → 1 | 0 | 0 | SLOW (immutable) |
| C6 USDC CoinMetadata | `0xdba346…900e` | — | no data | — | **dropped** (object id wrong, read returned null) |

**Chosen pair (proceeding unless the user objects):**

* **FAST class — Sui Clock, `0x0000…0006`.** Hot shared object: its version changed in 31 of 31
  observed intervals. Tatum read used: `object(address:"0x…06"){address version digest}`.
* **SLOW class — MemWal AccountRegistry, `0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f`.**
  Mutable, real, product-relevant object that changed **once in 11.2 min** (0.09/min) — ~31× slower
  than the FAST subject, so the version/digest pin is still meaningful for it. Same Tatum read.
  *Alternative if a zero-change subject is preferred:* the MemWal package `0xe7c16f…d7f5` or the
  Sui framework package `0x…02` (both 0 changes in 11.2 min) — but both are immutable packages,
  so their pin can never change, which makes the class less interesting.

**Implication for the policy defaults (VERIFIED arithmetic, not yet a decision):** at 243.23
checkpoints/min, the FAST default window of 50 checkpoints ≈ **12.3 s** of chain time, and the
SLOW default of 5000 checkpoints ≈ **20.6 min**.

---

## 5. The learned policy, precisely

* Signals are defined **only** by the window gate, as specified:
  * **FALSE-STALE** = window says stale, subject pin says version/digest unchanged → **widen** ×2.
  * **MISSED-CHANGE** = window says fresh, subject pin says changed → **tighten** ÷2.
  * CONSISTENT and UNVERIFIED never move the window.
* **Minimum sample count:** a change requires ≥3 *actionable* samples (FALSE-STALE +
  MISSED-CHANGE) since the last change. Counters reset after each change.
* **Bounds:** FAST 10 … 200000 checkpoints; SLOW 10 … 2000000 checkpoints.
* **One policy memory per change** — `policyRecordText()` produces exactly one FR-v1 record per
  change; the answer path writes it only when `changed === true`.
* **Read at startup and on every answer** — `PolicyEngine.load()` runs at process start and
  again at the top of every `answer()` call, so a restarted process picks up the learned window
  from Walrus Memory (test: *"the policy memory is read again on the next answer and widens the gate"*).
* **No LLM in the path** — every answer string is a template over verified fields
  (`src/answer.mjs`), so the demo is deterministic.

### Offline replay result (the required demonstration)

`fixtures/event-log.json` holds 9 recorded events (FAST: 8, SLOW: 1). Replaying the FAST query:

| Event | checkpoint delta | pin | verdict | signal | window before → after |
|---|---|---|---|---|---|
| 1 | 60 | unchanged | STALE | FALSE-STALE | 50 → 50 (sample 1/3) |
| 2 | 70 | unchanged | STALE | FALSE-STALE | 50 → 50 (sample 2/3) |
| 3 | 80 | unchanged | STALE | FALSE-STALE | **50 → 100 (policy changed)** |
| 4 | 90 | unchanged | **FRESH** | CONSISTENT | 100 → 100 |
| 5 | 95 | changed | STALE | MISSED-CHANGE | 100 → 100 (1/3) |
| 6 | 95 | changed | STALE | MISSED-CHANGE | 100 → 100 (2/3) |
| 7 | 95 | changed | STALE | MISSED-CHANGE | **100 → 50 (policy changed)** |
| 8 | 90 | unchanged | STALE | FALSE-STALE | 50 → 50 (1/3) |

**The same query, the same live data, a different verdict:** event 4 is STALE under the original
50-checkpoint window and **FRESH** under the learned 100-checkpoint window. The test asserts both
directions explicitly (`test/replay.test.mjs`).

### Ablation table (memory-off vs memory-on) — VERIFIED, from the replayed log

FAST query, 8 recorded events:

| Configuration | Answers from memory | Answers from live | Withheld | Tatum reads | **Stale (wrong) answers** |
|---|---|---|---|---|---|
| memory-off (no stored claim used) | 0 | 8 | 0 | 8 (1 per answer) | **0** |
| memory-on, **no gate** | 8 | 0 | 0 | 0 | **4** |
| memory-on, **gate + learned policy** | 4 | 4 | 4 | 16 (2 per answer) | **0** |

Reading: memory without the gate is free but wrong half the time; memory with the gate is never
wrong but pays 2 reads per answer; memory-off is also never wrong and cheaper in reads, but it
can never answer from stored context — which is the product's whole point.

---

## 6. Labelled claims

| Claim | Label | Evidence |
|---|---|---|
| FR-v1 round-trips stably and rejects malformed records | **VERIFIED** | `npm test` → `test/schema.test.mjs` (9 tests) |
| The gate fails closed when either live read is unavailable | **VERIFIED** | `test/gate.test.mjs`, `test/answer.test.mjs` |
| The gate never exceeds 2 Tatum reads per answer | **VERIFIED** | `test/tatum.test.mjs` (budget), `test/answer.test.mjs` |
| The checkpoint read is cached for 1 s and does not consume budget again | **VERIFIED** | `test/tatum.test.mjs` |
| 429 and timeouts are retried with exponential backoff | **VERIFIED** | `test/tatum.test.mjs` (fake transport) |
| The same query changes verdict after the policy memory changes | **VERIFIED** | `test/replay.test.mjs` + `fixtures/event-log.json` |
| One policy memory per policy change | **VERIFIED** | `test/answer.test.mjs` (counts the written memories) |
| Exactly one policy change per ≥3 actionable samples | **VERIFIED** | `test/policy.test.mjs`, `test/replay.test.mjs` |
| Window bounds are respected (10…200000 / 10…2000000) | **VERIFIED** | `test/policy.test.mjs` |
| The Sui Clock changes ~2.78 times/min; the MemWal registry ~0.09 times/min | **VERIFIED** | `data/claim-class-measurement.json` (32 rounds, 669 s, 0 errors) |
| Sui mainnet advances ~243 checkpoints/min via Tatum | **VERIFIED** | same file, `checkpoint_span = 2714` |
| Tatum free plan is shared at 3 rps (`x-ttm-plan` header) | **VERIFIED** | observed on every request in the measurement |
| **Cost of one Tatum call in credits** | **UNKNOWN** | no credit header is returned; `scripts/measure-credits.mjs` (Phase 2) will make a known number of calls for dashboard comparison |
| **How long Walrus keeps these blobs** | **UNKNOWN** | Phase 2/4: relayer behaviour / epochs setting, plus re-recall of the earliest blob |
| **A real user persona** | **HYPOTHESIS** | no user confirmed yet; the product is domain-agnostic (claim + freshness contract) by design |
| **Mainnet write path through the pinned SDK** | **INFERRED** | Stage 2 spike wrote 12 mainnet memories with this SDK; Phase 2 re-verifies in this workspace |

---

## 7. Secrets and git hygiene

* Secrets live only in `~/total-recall/.env` (mode `0600`), copied from the Stage 2 store.
  Keys present: `TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_AGENT_ID`, `MEMWAL_PRIVATE_KEY`.
  No value was printed, logged or echoed in this phase.
* `.gitignore` contains `.env` (plus `node_modules/`, `*.log`, `.DS_Store`, `data/cache/`);
  `git status` shows `.env` absent → **it is ignored**. Confirmed **before** any git command.
* `src/redact.mjs` redacts known secret values and secret-shaped strings from everything the
  ledger writes; the real `.env` values are asserted to be redacted in `test/redact.test.mjs`.
* No remote, nothing pushed. Local commits only.

---

## 8. Cut-line status

**Not at risk.** The cut line is **2026-11-08 23:00 UTC**; it is now 2026-11-05 00:35 UTC —
**3 days 22 hours** remain, and the submission deadline (2026-11-10 17:00 UTC) is 5 days 16 hours
away. Phase 1 finished on schedule with no features deferred.

---

## 9. GO / CUT / NO-GO

**GO — continue to Phase 2 (mainnet: Walrus Memory client, credential self-test, answer path on mainnet, two live opt-in tests, two memories into `freshness-recall`, then start the observer).**

**Decisions needed from you (3):**
1. **Claim-class pair** — proceed with FAST = Sui Clock `0x…06` and SLOW = MemWal AccountRegistry
   `0x8bf82c…199f` (1 change / 11.2 min), or switch SLOW to an immutable zero-change package
   (`0xe7c16f…d7f5` or `0x…02`)?
2. **FALSE-STALE handling** — today a still-true memory outside the window is *withheld* (with a
   visible reason) while the policy widens the window; the memory is not superseded. Confirm, or
   authorize answering directly from the memory when the pin proves the subject unchanged?
3. **Default windows** — FAST 50 checkpoints (≈12 s) and SLOW 5000 checkpoints (≈21 min) at the
   measured 243 checkpoints/min. Keep, or retune before the live run?
