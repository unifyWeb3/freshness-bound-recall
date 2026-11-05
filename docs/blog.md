# Nobody asked for an agent that "never answers from a stale memory" — until it did

*How I built FRESHNESS-BOUND RECALL for the Tatum × Walrus Memory “Total Recall” hackathon, when live Sui mainnet reads became the precondition of every answer.*

**Tags:** `#walrus` `#tatum` `#ai` `#sui`

---

## The 30-second problem

Every memory-backed agent has the same silent failure mode: it trusts what it wrote down. That is
fine until the world changes — and on Sui mainnet, the world changes at roughly **243 checkpoints a
minute** (measured: 2714 checkpoints in 669 s, 32 rounds, zero errors; `data/claim-class-measurement.json`).

The Sui Clock flips **~2.8 times per minute**. GitHub still says your agent "last verified" a fact
from the previous checkpoint. That's not a freshness problem; it's a *trust problem with a chain
attached*.

**FRESHNESS-BOUND RECALL** — an agent that will *never* answer from a stale memory. Every answer is
routed through a freshness gate before it is allowed to reach the user, and the tolerance the gate
enforces is itself a Walrus Memory, so the product visibly changes because of what it remembered.

## What makes this different (and what doesn't)

Recall Lab and RecallIQ both stamp checkpoints or re-verify claims at answer time — and they do it
well. Invoice Chaser flips a pay page on a gRPC checkpoint stream. Naming them isn't optional here,
because the honest answer to "what's new" is a *placement*, not a novel primitive:

* the gate sits **on the answer path**, not next to it — a stale memory is never an answer, any answer
  is either fresh *or* withheld with the reason visible;
* the tolerance is **a memory** — `fc-policy-FAST-v1`, not a config default, rewritten live as the
  system observes decay (50 → 25 after three live `MISSED-CHANGE` samples);
* supersession is explicit: a correction memory records the stale claim's `blob_id`, and the lineage
  is visible.

## What it does under the hood

1. **Recall** — query Walrus Memory for matching claims.
2. **Gate (P4 hybrid, fail-closed)** — checkpoint window (1 cached read, 1 s) ∧ subject version/digest
   pin (1 read) ∧ wall-clock backstop. Read failure ⇒ withheld, never answered.
3. **If FRESH** — the answer is a template over verified chain data (no LLM in the critical path).
   **If STALE** — the live value is shown instead, and the old memory is flagged as superseded by the
   correction the campaign wrote.
4. **Learning loop** — two signals: `FALSE-STALE` widens the window (a still-true memory expired with
   the pin unchanged), `MISSED-CHANGE` tightens it (the pin changed inside the window). Bounded ×2/÷2,
   minimum 3 actionable samples since the last change, exactly one policy memory per change.

## What it proved on mainnet (statements, not slogans)

* 15 real Walrus Memory blobs in namespace `freshness-recall` — 7 observations, 4 correction memories
  linking old → new blob ids, 1 `fc-policy-FAST-v1`, 1 adversarial not-stale record. IDs and checkpoint
  stamps are in the build reports; every claim above maps to a blob id + checkpoint.
* Three live `MISSED-CHANGE` decisions against the Sui Clock tightened the FAST window from 50 to 25
  checkpoints, and the result is recallable as a memory **right now** — the next answer an agent gives
  in this claim class loads the tighter 25. Behavior changed because of what was written down.
* 90+ recorded stale/fresh decisions with checkpoint stamps in the decision ledger (33+ FRESH, 33+ STALE,
  4 withheld) — this is the ablation table on the proof page, not a slide.
* The adversarial case is real: `adv-not-stale-341741224` was FRESH at its write time (subject unchanged),
  and is correctly withheld *today* under the 5000-checkpoint window — old-but-true is not the same thing
  as fresh.

## What I got wrong and fixed publicly

The first live policy run was **too aggressive**: with a 6 s window and an 8 s sampling cadence, once the
write budget froze the anchor, every signal degenerated to `CONSISTENT` and the loop learned nothing. The
fix is a floor of `window ≥ sampling interval` (or a heartbeat observation), and the honest account of
the failure lives in `reports/build-phase2.md` §4.

## Notes, constraints and honest limits

* Walrus Memory has **no delete/update** — retirement is by supersedes lineage and logical epochs. That
  is by design; judges can always recover the old blob.
* Blob **retention is not verified in this workspace** (Walrus mainnet epoch ≈ 2 weeks; relayer-managed
  expiry behaviour not verified here). Treat every blob as epoch-bounded, not permanent.
* **No real user** has validated this yet. The product is deliberately domain-agnostic — a claim + a
  freshness contract — because there is nobody to show it to.
* Tatum's per-call credit cost is **UNKNOWN**; the evidence tool (`npm run credits`) prints the exact
  request count so the dashboard can settle it, but no credit header is returned.

## What I learned

* Failure modes, not features, win hackathons. 401s, 5-second timeouts, 429 rate limits, in-flight writes
  dropped at SIGTERM, stale anchors below the sampling cadence — that's where the whole build went.
* Rate limits are a product; 3 rps shared changes the whole shape of the agent (cached checkpoint, ≤2
  reads/answer, backoff, fail closed).
* A learning loop you can *read back* is worth ten heuristics you can't.

---

*Built solo with Node v26.13.0, `@mysten-incubation/memwal@0.1.13`, Tatum Sui mainnet GraphQL (read-only),
and Walrus Memory. Zero LLM in the answer path; every claim maps to a blob id + checkpoint.
Reports: `reports/build-phase1.md` … `build-phase4.md`. Demo: `npm run demo` (live) / `npm run demo:offline`.*
