# Build Report — Phase 4 (final verification sweep, earliest-blob recall re-test, submission readiness)

**Date:** 2026-11-05 ~01:20–01:30 UTC · **Workspace:** `~/total-recall` · **Runtime:** Node v26.13.0, npm 11.20.0
**Phase goal:** confirm the product end to end, re-test recall of the earliest blob, and leave the
submission with nothing left to do except what only the user can do.

**Verdict: GO (with 2 decisions at the end).**

---

## 1. Verdict (first)

**GO — the product is demo-able, the submission package is drafted, and the fresh clone verifies green.**
Nothing was pushed, published or submitted. No video has been recorded and no social post has been made.
The only remaining items are human actions the agent cannot perform: record/upload the video, host the
repo (or provide it to the portal another way), fill the form's unknown fields, and press submit.

## 2. What passed (with evidence)

| # | Check | Result |
|---|---|---|
| 1 | Earliest-blob recall re-test | **RE-CALLED** — `smoke-seed-fast-341740155` (blob `wYNZE__Q3HkeRZIYf0BljMRa92DnZ0S5yt08xjLEIdE`) is present in the 15-memory response to the FR-v1 recall query (1,000-char body, `namespace=freshness-recall`). `listMemories()` → `memories=15`, `deleted=0`, `must_resync=false` |
| 2 | Retention across Walrus epochs | **UNKNOWN (unverified by design)** — an epoch on mainnet is ~2 weeks; the relayer sets epochs for these blobs, and whether recall actually works in 4 days (Nov 11–16 judging) is **not verifiable in this workspace**. Every README/log claim is scoped to "now"; the demo never relies on permanence |
| 3 | Live demo | **VERIFIED** — completes ~24 s; steps 1–8 green; 0 stale answers from memory; live `WITHHELD` verdict shown; policy loaded from memory (verdict prints `25`) |
| 4 | Offline demo twin | **VERIFIED** — instant, CACHED SNAPSHOT labels; deterministic |
| 5 | Proof page (live + offline) | **VERIFIED** — 15 memory rows with blob ids, lineage SVG, ledger, plan-header request log; `healthz` ok in both modes |
| 6 | Secrets audit (committed tree) | **VERIFIED — PASS** — 42 tracked files; no `.env`; no remote; no value printed; PEM/JWT/token prefixes absent |
| 7 | Fresh clone | **VERIFIED** — committed tree → `npm install --ignore-scripts` → `npm test` → **62 pass · 0 fail · 4 skipped**; `.env` absent |
| 8 | Live opt-in test suite | **VERIFIED** — 2 tests pass live (`RUN_MAINNET=1`) |
| 9 | Observer still running | **VERIFIED** — PID 16783, `--interval=60 --budget=0`, started with `setsid nohup`; ledger grown to **112 entries** (51 FRESH · 57 STALE · 4 WITHHELD_UNVERIFIED) |
| 10 | Decision ledger content | **VERIFIED** — checkpoint-stamped verdicts + pins; used by the proof page and demo step 7 |

## 3. Known limits (repeated, not hidden)

* Walrus retention UNKNOWN across epochs — intermittent recall at judging time is not ruled out.
  The demo **degrades to the `CACHED SNAPSHOT` mode** (all deliverable faithfully if the relayer or blob index
  has an incident). Plan for it: judge demo should use `npm run demo:offline` as a fallback recording.
* Tatum credits per call UNKNOWN — dashboard comparison is yours (`npm run credits` prints 21 actual requests
  against a 30-step measurement).
* Persona is HYPOTHESIS; product is domain-agnostic.
* FAST learned window frozen at 25 until either the policy floor raises ≥ sampling interval or the budget
  is renewed; offline replay covers the both-direction loop (`test/replay.test.mjs`).

## 4. Secrets and git hygiene

* `.env` (0600, git-ignored); `git check-ignore -v .env` re-verified this phase; `.env` absent from clone.
* No remotes; local commits only:

| Commit | Contents |
|---|---|
| `8e0cfdc` | Phase 1 — offline gate, policy, Tatum client, 64 tests |
| `76b26b2` | Phase 2 — mainnet live path, self-test, policy 50→25, observer, 2 live tests |
| `759e4ff` | Phase 3 — demo/proof page/audit/README/blog/submission draft |
| `0683e9e` | Phase 3 report |

* Only `test/helpers/fake.env` (placeholder) is tracked; redaction proven by `test/redact.test.mjs` and
  by `npm run audit:secrets`.

## 5. Submission checklist (all human-gated)

- [ ] Record the demo per `docs/video-script.md` (≤2:30; live or offline-fallback)
- [ ] Host the repo or deliver it per the portal (agent configured no remote; nothing pushed)
- [ ] Fill the B2 form fields — see `docs/submission.md` (incl. **Track 02 stated in description** — no track field exists)
- [ ] Optional: X/LinkedIn posts for the +20 bonus (draft in README/blog)
- [ ] Submit **2026-11-10 17:00 UTC** — suggested: morning, Nov 10, with 12 h buffer

## 6. GO / CUT / NO-GO

**GO.** No cut line applies (Phase 2 & 3 landed on day 2 of 5). Submission is ready modulo the human steps §5.

**Decisions needed from you (2):**

1. **Retention strategy** — accept the UNKNOWN (document it; the proof page and demo already degrade to
   cache) or have me take one more action at the relayer/dashboard level? (The agent cannot renew Walrus
   epochs without a credentialed action on your account.)
2. **Repo hosting** — how do you want the repo delivered to the portal (public repo you own, private repo
   with the reviewer account, ZIP upload, or a different mechanism)?
