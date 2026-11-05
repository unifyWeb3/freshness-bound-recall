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
the old blob.

## What it does

1. **Recalls** from Walrus Memory (namespace `freshness-recall`).
2. **Gates** — P4 hybrid: checkpoint window (1 cached read, 1 s TTL) ∧ subject version/digest pin (1 read) ∧ wall-clock backstop. Fail-closed: read failure ⇒ withheld, never “answer anyway”. No LLM anywhere in the answer path — answers are templates over verified chain data.
3. **Answers** from memory only when fresh; otherwise it uses **live reads from Tatum** (Sui mainnet GraphQL — read-only; `x-api-key` always sent; `x-ttm-plan: free;ratelimit=3;strategy=shared` logged on every request) and never returns the stale value as truth.
4. **Learns its own tolerance** — from observed decay, per claim class.

## How it learned over time (and what was NOT persisted)

The closed loop: `FALSE-STALE` (window said stale, subject pin unchanged) widens the window;
`MISSED-CHANGE` (window said fresh, subject changed) tightens it. Bounded ×2/÷2, minimum 3 actionable
samples since the last change, exactly one policy memory per change, policy read at startup and before
every answer.

What the live run actually shows, honestly:

| Direction | Live | Persisted as a memory | Evidence |
|---|---|---|---|
| tighten — FAST window **50→25** | yes (3 consecutive live MISSED-CHANGE on the Sui Clock) | **yes** — `fc-policy-FAST-v1`, blob `19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o` | live demo step 3; `npm run demo` |
| widen — SLOW window **5000→10000→20000** | yes (6 live FALSE-STALE samples, ~01:00–01:34 UTC) | **no** — the observer ran with `--budget=0`, so nothing was written; the values live in a local mirror and reset on restart | `data/ledger.jsonl`; `data/policy-mirror.json` (local only) |
| both directions end-to-end with persisted memories | replay only | replay only (deterministic fixture) | `test/replay.test.mjs` |

Per-class totals in the ledger: **FAST** — MISSED-CHANGE 5, FALSE-STALE 0 (67 samples) · **SLOW** —
FALSE-STALE 7, MISSED-CHANGE 0 (67 samples). The window that froze at 25 was closed by the
budget/sampling-ratio deadlock; **no threshold was tuned to make the demo look good, and nothing was
forced.** Details and honest limitations: `reports/build-phase2.md` §4 and `reports/pre-submit.md` §3.

I want to be plain about what judges are seeing: the persisted, recalled-on-every-start policy in
production today is the **tightened** one for FAST and the **default** 5000 for SLOW (no SLOW policy
memory was written). The widen direction is real, live, and measurable in the ledger — but it would be
fiction to say it survived a restart.

## What Walrus Memory is used for — concretely

* **The only memory store.** 17 mainnet blobs in `freshness-recall` — 7 observations, 4 corrections,
  1 learned-policy memory, 1 adversarial not-stale record, 5 test seeds (2 phase-2 round-trips, 2 more
  on verification).
* **Lineage, not deletion.** The production SDK (0.1.13) exposes no delete/update, so revision is by
  `supersedes=<blob_id>`; the proof page renders the lineage chain.
* **Semantic recall for answers** — claims carry `FR-v1` checkpoint + object version stamps, so the
  gate can reject them without trusting the client’s clock.

## What Tatum is used for — concretely

* **All chain truth**: checkpoint sequence/digest/timestamp, object version/digest pinning, the
  on-chain MemWalAccount type check (credential self-test proves `MEMWAL_ACCOUNT_ID` is the
  MemWalAccount object id, not the wallet).
* **Rate discipline**: ~243 cps/min is measured, not assumed; 1 s cached checkpoint per request;
  ≤2 Tatum reads per answer; exponential backoff + retry on 429/timeout (one observed 429 retry, three
  observed transient network failures — all retried into 200).
* **No credit card, no gRPC, no JSON-RPC.** The whole product works on the **free shared** plan.

## What the demo shows

Deterministic 60–90 s: startup self-test → live chain pins → policy loaded **from Walrus Memory**
(FAST window 25) → a seeded claim is **WITHHELD** (“subject changed… the memory was not used as the
answer”) → live value shown instead → same question same verdict → the FALSE-STALE case → the ablation
table over ≥146 recorded decisions → lineage `old blob → correction blob`.

Every number and blob id is in the repo; every correctness claim maps to a command or an id.

## Honest limits (all disclosed, not hidden)

* **Walrus retention** — epochs are ~2 weeks on mainnet; the relayer’s upload path defaults to
  **2 epochs (~4 weeks)** unless overridden. **The exact `end_epoch` of these 17 blobs is UNKNOWN from
  the tools available** — expiry before judging cannot be ruled out; the demo and proof page degrade to a
  labelled cached mode with no network. Options and costs are listed in `reports/pre-submit.md` §1.
* **Tatum credits per call** — no credit header is returned; `npm run credits` prints the request count
  (21 actual GraphQL requests for the 20-step run; 9 absorbed by the 1 s checkpoint cache).
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
