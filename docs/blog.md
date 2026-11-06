# FRESHNESS-BOUND RECALL — a Walrus Memory agent that refuses to answer from a stale memory

*Tatum × Walrus Memory “Total Recall” hackathon · Track 02 "Smart Agents for Real Life"*

**Video:** {VIDEO_URL} · **Repo:** {REPO_URL}

---

## The 30-second problem

Every memory-backed agent has the same silent failure mode: it trusts what it wrote down. That is
fine until the world changes. On Sui mainnet, the world changes at ~243 checkpoints a minute
(measured: 2714 checkpoints in 669 s over 32 rounds, 0 errors). The Sui Clock flips ~2.8 times a
minute. An answer from a memory written minutes ago can already be wrong.

**FRESHNESS-BOUND RECALL** is a memory agent that treats freshness as a *precondition of answering*,
not as a footnote. Every answer is routed through a gate before it can reach the user; if the gate
fails, the agent withholds the memory, says why, and (optionally) writes a correction that supersedes
the old record.

## What it does

1. **Recalls** from Walrus Memory (namespace `freshness-recall`).
2. **Gates** — P4 hybrid: checkpoint window (1 cached read, 1 s TTL) ∧ subject version/digest pin (1 read) ∧ wall-clock backstop. Fail-closed: read failure ⇒ withheld, never “answer anyway”. No LLM anywhere in the answer path — answers are templates over verified chain data.
3. **Answers** from memory only when fresh; otherwise it uses **live reads from Tatum** (Sui mainnet GraphQL — read-only; `x-api-key` always sent; `x-ttm-plan: free;ratelimit=3;strategy=shared` logged on every request) and never returns the stale value as truth.
4. **Learns its own tolerance** — from observed decay, per claim class.

## How it learned over time (and what is still open)

The closed loop: `FALSE-STALE` (window said stale, subject pin unchanged) widens the window;
`MISSED-CHANGE` (window said fresh, subject changed) tightens it. Bounded ×2/÷2, minimum 3 actionable
samples since the last change, exactly one policy memory per change, policy read at startup and before
every answer. The bounds are `[10, 200000]` checkpoints for FAST and `[10, 2000000]` for SLOW; the
defaults are 50 and 5000.

What the live run actually shows, honestly:

| Direction | Learned live | Persisted as a memory | Evidence |
|---|---|---|---|
| tighten — FAST window **50→25** | yes (3 consecutive live MISSED-CHANGE on the Sui Clock, 2026-11-05 00:57 UTC) | **yes** — `fc-policy-FAST-v1`, blob `19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o` | live demo step 3; `npm run demo` |
| widen — SLOW window **5000→10000→20000** | yes (3 consecutive live FALSE-STALE on the MemWal AccountRegistry, learned 2026-11-05 02:05:19 UTC) | **yes** — `fc-policy-SLOW-v2`, blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`, written 09:23:05 UTC (the learned result was **not** backdated — `learned_at` and `written_at` are separate fields) | `node scripts/show-policy-effect.mjs` |
| both directions persisted end-to-end | **live, not replay-only** | yes | `scripts/show-policy-effect.mjs` part A (policy read back, `source=store`) |
| deterministic offline replay of the same loop | replay | replay | `test/replay.test.mjs` |

The policy is not decorative: reading it back changes the gate's verdict. Replaying a recorded mainnet
decision (real memory `obs-memwal-registry-341741030`, real checkpoint 341759185, real pin, same clock)
with the default window 5000 gives **STALE (FALSE-STALE)**; with the window 20000 loaded from the blob it
gives **FRESH (CONSISTENT)**. The replay uses the complete proof envelope, checkpoint and pin preserved
in the committed evidence snapshot; it does not construct a synthetic live claim.

Three honest caveats:

* The observer learned a **further** SLOW window of **40000** at 02:25:24 UTC. That later result is
  **not persisted** — the only SLOW policy memory on chain is the 20000-checkpoint one, which is
  *tighter* (more conservative) than my latest local mirror. The persisted record says this in its own body.
* The SLOW widen was learned **twice independently** (01:34:22 UTC, then again 02:05:19 UTC after an
  observer restart re-seeded the window at 5000). The persisted record cites the 02:05:19 event.
* The tightened FAST window (25 checkpoints ≈ 6 s) sits **below the observer sampling cadence**, so FAST
  is effectively frozen at v1 in the live loop. The honest fix — a window floor ≥ sampling interval, or
  heartbeat observations — is documented, not silently applied.

**No threshold was tuned and no sample was forced at any point.** Details and limits:
`reports/build-phase2.md` §4 and `reports/pre-submit.md` §3.

## What Walrus Memory is used for — concretely

* **The only memory store.** 22 mainnet blobs in `freshness-recall` — 7 observer observations,
  4 corrections, 2 learned-policy memories, 1 historical adversarial specimen that predates the
  anchor-proof fix, 8 test seeds (4 live-test runs × 2 seeds).
* **Lineage, not deletion.** The production SDK (0.1.13) exposes no delete/update, so revision is by
  `supersedes=<blob_id or exact claim fallback>`; the proof snapshot resolves either form to the
  predecessor blob before rendering the lineage chain. Two historical corrections used the claim
  fallback because their observation writes were still in flight.
* **Semantic recall for answers** — claims carry `FR-v1` checkpoint + object version stamps, so the
  gate can reject them without trusting the client’s clock.

## What Tatum is used for — concretely

* **All chain truth**: checkpoint sequence/digest/timestamp, object version/digest pinning, the
  on-chain MemWalAccount type check (credential self-test proves `MEMWAL_ACCOUNT_ID` is the
  MemWalAccount object id, not the wallet).
* **Rate discipline**: ~243 cps/min is measured, not assumed; 1 s cached checkpoint per request;
  ≤2 Tatum reads per answer; exponential backoff + retry on 429/timeout (one observed 429 retry, three
  observed transient network failures — all retried into 200).
* **Every request carries `x-api-key`**, and the request log proves it without printing the key:
  21/21 requests in the `npm run credits` run, 7/7 in the final live proof-page snapshot
  (2,208/2,208 in a longer earlier page run that was then stopped).
* **No credit card, no gRPC, no JSON-RPC.** The whole product works on the **free shared** plan.

## What the demo shows

Deterministic 60–90 s: startup self-test → live chain pins → policy loaded **from Walrus Memory**
(FAST window 25, SLOW window 20000) → a seeded claim is **WITHHELD** (“subject changed… the memory was
not used as the answer”) → live value shown instead → same question same verdict → the FALSE-STALE case
→ the ablation table over ≥306 recorded decisions → resolved lineage `old observation → correction`.

Every number and blob id is in the repo; every correctness claim maps to a command or an id.

## Honest limits (all disclosed, not hidden)

* **Walrus retention** — epochs are ~2 weeks on mainnet; the relayer’s upload path defaults to
  **2 epochs (~4 weeks)** unless overridden. **The exact `end_epoch` of these 22 blobs is UNKNOWN from
  the tools available** — expiry before judging cannot be ruled out; the demo and proof page degrade to a
  labelled cached mode with no network. Options and costs are listed in `reports/pre-submit.md` §1.
* **Tatum credits per call** — no credit header is returned; `npm run credits` prints the request count
  (21 actual GraphQL requests from 30 attempted reads; 9 absorbed by the 1 s checkpoint cache).
* **No user** — persona is a hypothesis; the product is deliberately domain-agnostic (a claim + a
  freshness contract).
* **Learning stability** — FAST window froze at 25 by the sampling-vs-window deadlock; the honest fix
  (window floor ≥ sampling interval / heartbeat observations) is documented, not performed.
* **This is not the only freshness work in the field.** Recall Lab and RecallIQ also stamp checkpoints
  or re-verify at answer time; Invoice Chaser and swiftbotlab use streams/canaries. The difference here
  is **placement and a closed loop**, not a novel primitive: the gate is on the answer path, and the
  tolerance itself is a memory the system rewrites from observed decay.

---

*Built solo with Node v26.13.0, `@mysten-incubation/memwal@0.1.13`, `@mysten/seal@1.1.3`,
`@mysten/sui@2.16.2`, `@mysten/walrus@1.1.7`, `zod@3.25.76`. Zero LLM in the answer path.
`npm test` (offline), `npm run demo` (live), `npm run demo:offline`, `npm run proof[:offline]`,
`npm run export`, `npm run freeze`. Reports: `reports/build-phase1.md`…`pre-submit.md`.*
