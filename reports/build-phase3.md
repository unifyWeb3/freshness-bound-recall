# Build Report — Phase 3 (demo, proof page, README/blog, submission draft, audit)

**Date:** 2026-11-05 ~01:20–04:00 UTC · **Workspace:** `~/total-recall` · **Runtime:** Node v26.13.0, npm 11.20.0
**Phase goal:** a coherent, defensible product artifact — live demo, proof page (live + offline twin),
README/blog/video cut, submission draft, secrets audit, fresh-clone test.

**Verdict: GO (with 3 decisions at the end).**

---

## 1. Verdict (first)

**GO — Phase 4 (final verification + submission readiness) may start.** Everything judged in this phase
exists, runs, and is reproducible: the proof page renders real mainnet data with live blob ids, the
deterministic demo completes in ~24 s live and 0 s offline, the secrets audit passes against the
committed tree, and a fresh clone installs and tests green without `.env`.

Nothing was pushed, published, registered or submitted. No video was recorded and no post was made.
The only mainnet activity in this phase was **read-only** (demo + proof page); the decision ledger kept
growing because the observer is still running with `--budget=0`.

---

## 2. What passed (with evidence)

| # | Deliverable | Evidence |
|---|---|---|
| 1 | Demo runner (deterministic, no LLM) | **VERIFIED** — live run at 2026-11-05 01:18 UTC completed in **23–24 s**; offline run completed instantly; steps 1–8 printed with verdicts, windows, lineage and ablation (`scripts/demo.mjs`) |
| 2 | Live demo: **stale memory is WITHHELD** | **VERIFIED** — query "Sui Clock object version checkpoint claim" → `STALE — subject changed (version 1018797298->1018815825, digest changed)`; answer shows the live value; the stored blob was not used |
| 3 | Same question → same verdict (determinism) | **VERIFIED** — steps 4 and 5 identical |
| 4 | FALSE-STALE demonstration | **VERIFIED** — `adv-not-stale-341741224` (SLOW, adversarial class): live run STALE by window (delta > 5000) with **pin unchanged**; offline snapshot run FRESH (delta 4489 ≤ 5000) — both with correct, visible reasons |
| 5 | Learned policy loads from memory at startup and per answer | **VERIFIED** — live demo step 3: FAST window **25** (`source: store, version 1, reason: MISSED-CHANGE 3 > FALSE-STALE 0: tighten 50 -> 25`); SLOW **5000** |
| 6 | Ablation table from recorded decisions | **VERIFIED** — 90 live decisions (40 FRESH · 46 STALE · 4 WITHHELD) / 76 in snapshot (36/36/4); zero stale answers with the gate (`stale-answers=0`); no gate → 49–50 would be served stale |
| 7 | Proof page, live mode | **VERIFIED** — `npm run proof` on 127.0.0.1:8787; `healthz` → `{"ok":true,"mode":"live"}`; 39 KB HTML contains all 15 memory rows (blob ids), lineage SVG, decision ledger, Tatum request log with plan header, policy cards; `fc-policy-FAST-v1` rendered |
| 8 | Proof page, offline mode | **VERIFIED** — `--offline` mode serves the cached snapshot with the `CACHED SNAPSHOT` badge; works with the network off; `healthz` ok; auto live-refresh correctly disabled |
| 9 | Secrets audit | **VERIFIED** — `npm run audit:secrets` → **AUDIT: PASS** (42 tracked files, 2 fingerprinted env values, no value printed; no PEM/JWT/token prefixes; `.env` ignored; no remote configured) |
| 10 | Fresh clone test | **VERIFIED** — clone from committed repo → `npm install --ignore-scripts` → `npm test` → **62 pass · 0 fail · 4 skipped** (2 live opt-in + 2 env-redaction tests); `.env` absent; no secrets leaked by omission |
| 11 | README with claim→evidence map | **VERIFIED** — `README.md` §6 (labelled VERIFIED / INFERRED / HYPOTHESIS / UNKNOWN), §9 hackathon map, §2 quickstart matches reality |
| 12 | Blog draft (dev.to target) | **VERIFIED (artifact exists)** — `docs/blog.md`; factual competition wording; says outright that Recall Lab/RecallIQ stamp freshness and that our difference is placement + closed loop |
| 13 | Video script | **VERIFIED (artifact exists)** — `docs/video-script.md`, ≤2:30, verbatim voice-over, commands, fallback plan |
| 14 | Submission draft for the B2 form | **VERIFIED (artifact exists; NOT sent)** — `docs/submission.md` (21 fields mapped; no track field → Track 02 stated in description) |
| 15 | `test/redact.test.mjs` works without `.env` | **VERIFIED** — 2 env-dependent tests now skip when `.env` is absent (fresh-clone shows `62 pass · 4 skipped`, not `2 fail`) |

**Freshness caveat (the big unknown):** Walrus Memory blobs in namespace `freshness-recall` are bounded
by Walrus epochs (~2 weeks, mainnet). The relayer sets the storage epochs for these blobs and Phase 2
documents that this is **UNKNOWN** in this workspace. The demo never assumes permanence; Phase 4 must
re-test recall of the earliest seed claim (`wYNZE__…`, cp 341740155) at the end of Phase 4.

**Competition position (factual):** Recall Lab and RecallIQ both stamp checkpoints or re-verify at answer
time — the difference stated in README/blog is that (a) the gate is on the answer path, (b) the tolerance
is a memory the system rewrites from observed decay. No other freshness claims are made.

---

## 3. What failed (and was corrected)

1. **The live adverse-case no longer shows FRESH (it now shows STALE by window).** At the adversarial
   record’s write time it was FRESH; against the current checkpoint it is STALE-by-window with the
   subject pin unchanged (the FALSE-STALE signature). The product is behaving correctly — the demo
   previously staged it as a "FRESH answerable" case, which would have gone stale with time.
   **Fix:** the demo re-labels step 6 honestly as FALSE-STALE, and the offline twin still shows the
   snapshot-time FRESH verdict (delta 4489 ≤ 5000). The live verdict will flip back to FRESH only if a
   policy widens the SLOW window.
2. **README “fresh clone” claim initially failed: 2 test failures.** The two env-dependent redaction
   tests required a real `.env`. **Fix:** they now skip when `.env` is absent; fresh clone shows
   `62 pass · 4 skipped` and the reason is printed by the runner.
3. **Demo step 6 originally selected a FAST correction for an adversarial question.** The semantic
   recall matched the nearest claim (the FAST correction). **Fix:** the live path now recalls explicitly
   for the adversarial record (`adv-not-stale`) and gates it against the SLOW pin directly — deterministic.
4. **Proof-page earlier lacked the adversarial case in the ablation narrative and "why history here".**
   Historical FRESH decisions are visible only in the ledger; the demo quotes them numerically (40/76
   FRESH of 90/76 decisions).

**Not fixed (honest):** the FAST policy is still frozen at v1 = 25 while the anchor is stale and no writes
are allowed. Closing the loop live again would need at least one fresh FAST observation + policy flushes;
counts as a nice-to-have, not a blocker — the offline replay proves the same loop with both directions
(`test/replay.test.mjs`).

---

## 4. Verification commands (reproduce Phase 3)

```sh
cd ~/total-recall
npm test                                        # 64 pass · 2 live tests skipped (offline)
RUN_MAINNET=1 node --test --test-concurrency=1 test/live/   # 2 pass live (opt-in)
npm run audit:secrets                           # AUDIT: PASS
npm run demo                                    # live, ~24 s, read-only
npm run demo:offline                            # instant, no network
npm run proof:offline                           # proof page from snapshot
# fresh-clone test:
git clone /home/unify/total-recall /tmp/fresh-clone && cd /tmp/fresh-clone
npm install --ignore-scripts && npm test        # 62 pass · 4 skipped
```

**Continuous check:** the observer (`setsid nohup node scripts/observer.mjs --live --interval=60 --budget=0`,
PID 16783) is still running. It spends ≤3 reads/minute and appends ~2 ledger lines/minute. Stop it with
`pkill -f "scripts/observer.mjs"`. It is **not** managed by systemd/tmux and will not survive a reboot;
restart it with the same command if desired.

---

## 5. Cut-line status

**Not at risk.** It is 2026-11-05 ~04:00 UTC; the cut line is 2026-11-08 23:00 UTC — **~3.8 days** remain.
Phase 3 delivers ahead of plan. If the cut line were reached with only the mandatory items live, the set
{freshness gate on the answer path, closed learning loop, mainnet memories, deterministic demo} would
still be shippable by cutting: proof-page extras → observer automation → the only remaining trims.

---

## 6. Claims audit (this phase)

| Claim | Label | Evidence |
|---|---|---|
| Stale memories are never answered | **VERIFIED** | live demo step 4; `src/answer.mjs` + `test/answer.test.mjs` |
| Proof page shows real mainnet memories end-to-end | **VERIFIED** | §2 row 7–8, 39 KB page, 15 memory rows |
| Fresh clone test without `.env` | **VERIFIED** | §3 row 2; §4 commands |
| Offline demo is deterministic | **VERIFIED** | 2 identical verdicts across calls; `demo.mjs --offline` |
| No one is blocked by Relayer flakiness at demo time | **INFERRED** | pre-warm + 60 s timeouts + cached-snapshot mode + retry to 200s; not load-tested concurrently |
| Competitors with freshness stamps (Recall Lab, RecallIQ) | **VERIFIED (partial read)** | Stage 2 competition table; 9 of ~33 entries read |
| "Our gate is the only answer-path freshness gate in the field" | **NOT CLAIMED** | competition coverage is incomplete; framing is fact-by-fact |
| Blog is publishable as-is (dev.to) | **INFERRED** | Markdown is static; user review still required |
| Submission form accepted / accepted by portal | **UNKNOWN** | nothing submitted; field list was read read-only on 2026-11-04 |
| Walrus epoch retention of the namespace | **UNKNOWN** | Phase 4 re-test |
| Tatum credits per call | **UNKNOWN** | `npm run credits` prints 21 actual requests for the 30-step run |

---

## 7. Secrets and git hygiene

* `.env` is git-ignored (`git check-ignore -v .env` re-verified) and absent from the clone; only
  `test/helpers/fake.env` (placeholder values) is tracked.
* No remotes configured; no pushes; the only commits are local.
* `npm run audit:secrets` → **PASS** against the committed tree (42 tracked files; nothing printed).
* Ledger/monitor artifacts remain git-ignored; the measurement evidence (`data/claim-class-measurement.json`)
  is committed as evidence.

---

## 8. GO / CUT / NO-GO + decisions

**GO.** Phase 4 (final pass: re-test earliest-blob recall, full verification sweep, submission readiness) may start.

**Decisions needed from you (3):**

1. **Submission mechanics** — the form needs a `repoUrl`: do you self-host the repo (public, private repo with
   reviewers, or a downloaded ZIP / portal upload), or is there an alternative route the portal accepts?
   Nothing is pushed until you decide.
2. **Bonus posts** — publish the X/LinkedIn share before submission (your accounts, your call on tagging
   @Tatum_io/@WalrusFoundation), or leave `socialPosts` as `none` and accept the 0/20 bonus points?
3. **Recording and timing** — I recommend recording after this report is committed, against the frozen tree,
   and submitting Nov 10 morning UTC. Confirm that cadence, or state a different one.

Unknowns still open after this phase: Walrus epoch retention (Phase 4 re-test), Tatum credits per call
(needs your dashboard comparison), and whether a real user validates the persona (your call).
