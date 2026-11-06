# A memory is not an answer until it is fresh

*Draft for the Tatum × Walrus Memory “Total Recall” hackathon*

Agents are useful because they remember. That same strength creates a quiet failure mode: a memory
can remain perfectly retrievable after the world it describes has changed.

Freshness-Bound Recall puts a verification gate between recall and answer. It retrieves an on-chain
claim from Walrus Memory, checks the claim's proof against current Sui state through Tatum, and only
lets the memory answer when the evidence is still fresh. A stale or unverifiable memory is withheld;
the system explains why and shows the verified live value instead.

The gate is deterministic. There is no LLM deciding whether a proof is good enough.

## The failure modes

The project started with five cases that a fixed cache timeout does not handle well:

| Recorded state | Failure without a gate | Freshness-Bound Recall |
|---|---|---|
| The subject changed | An old value is presented as current | `STALE`; withhold the memory |
| The subject is unchanged but the record is old | A fixed timeout rejects a true claim | `FALSE-STALE`; learn to widen the window |
| The subject changed inside the window | A loose timeout trusts a changed value | `MISSED-CHANGE`; learn to tighten the window |
| Verification evidence is unavailable or malformed | Best-effort systems guess | `WITHHELD_UNVERIFIED`; fail closed |
| A newer observation corrects an older one | History is overwritten or disconnected | Preserve both records with `supersedes` lineage |

Each stored claim carries an `FR-v1` proof envelope: chain id, checkpoint sequence and digest, object
version and digest, and read time. Those fields let the answer path compare what was true when the
memory was written with what is true now.

## The answer path

For each query, the product does four things:

1. Recall a candidate from Walrus Memory.
2. Load the freshness policy for that claim class.
3. Read the latest checkpoint and current subject pin through Tatum Sui Mainnet GraphQL.
4. Return the memory only if the checkpoint window, object version/digest, and wall-clock backstop all pass.

The checkpoint read is cached for one second. A decision uses at most two Tatum reads: one checkpoint
and one subject pin. A timeout, rate-limit failure, malformed proof, missing pin, or ambiguous lineage
does not degrade into “answer anyway”; it produces a withheld result with a reason.

Correction and policy writes are optional and separately gated. Recorded mode never writes. Live mode
also defaults to read-only, and a write requires the explicit `--allow-mainnet-writes` flag.

## What Tatum does

Tatum supplies the chain truth used by the gate:

- the current Sui checkpoint sequence, digest, and timestamp;
- the current version and digest of the subject object;
- the on-chain type check used by the credential self-test;
- request metadata such as latency and the observed plan header.

All chain reads use Tatum's Sui Mainnet GraphQL endpoint. The client attaches `x-api-key` on every
request, records only a boolean that the header was sent, and never prints the key. It retries bounded
429 and timeout failures, maintains the two-read answer budget, and fails closed if verification still
cannot complete.

The installable live read-only CLI path is implemented, but its complete end-to-end execution against
Mainnet with real credentials is currently **UNVERIFIED**. Unit tests cover its arguments, safety
defaults, missing-credential failure, and dependency-injected behavior; the committed evidence does
not contain a transcript proving the whole installable CLI path. Live mode requires four credentials,
not only a Tatum key: `TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID`, `MEMWAL_AGENT_ID`, and
`MEMWAL_PRIVATE_KEY`.

## What Walrus Memory does

Walrus Memory holds three kinds of state used by the product:

- observations with their checkpoint and object proof;
- corrections that preserve explicit lineage to the observation they supersede;
- learned freshness policies that the answer path reads before making a decision.

The committed proof snapshot contains 22 historical Mainnet memory records: observations,
corrections, two policy records, test seeds, and one adversarial specimen. That count describes the
captured evidence; it is not a claim that every blob will remain available indefinitely.

The production memory SDK does not expose update or delete. The project therefore treats memory as an
append-only history. A correction names either the predecessor blob or its exact claim, and the proof
contract resolves that reference before presenting the lineage.

## How the policy learned over time

Freshness is different for different subjects. The Sui Clock changes quickly; the MemWal
AccountRegistry changes much more slowly. One fixed window either misses Clock changes or rejects too
many still-true registry observations.

The policy learns from two signals:

- `FALSE-STALE`: the window expired, but the subject version and digest were unchanged. After enough
  actionable samples, widen the window.
- `MISSED-CHANGE`: the window still said fresh, but the subject pin changed. After enough actionable
  samples, tighten the window.

Changes are bounded, move by ×2 or ÷2, and require at least three actionable samples since the last
change. `CONSISTENT` and `UNVERIFIED` observations never move a window.

The recorded Mainnet run produced both directions:

| Class | Recorded learning | Persisted Walrus policy |
|---|---|---|
| FAST — Sui Clock | 50 → 25 after three `MISSED-CHANGE` signals | `fc-policy-FAST-v1`, blob `19ZE9y-zWt1fuR3lryI3AZiqM-v-cloWw7_oXHGOU4o` |
| SLOW — MemWal AccountRegistry | 5,000 → 10,000 → 20,000 from `FALSE-STALE` signals | `fc-policy-SLOW-v2`, blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4` |

The SLOW record distinguishes when the result was learned from when it was persisted. It was learned
at `2026-11-05T02:05:19.054Z` and written to Walrus at `2026-11-05T09:23:05.105Z`; the record was not
backdated.

## The policy changes the verdict

The homepage now demonstrates the effect with the same recorded Mainnet inputs on both sides.

The observation under test is blob
`Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g`, anchored at checkpoint `341741030`. The decision was
recorded at checkpoint `341759185`, a delta of 18,155 checkpoints, with the subject version and digest
unchanged.

| Policy used for the same evidence | Verdict |
|---|---|
| Built-in 5,000-checkpoint default | `STALE / FALSE-STALE` — delta 18,155 exceeded the window |
| 20,000-checkpoint policy from Walrus blob `Zne2mnj…` | `FRESH / CONSISTENT` — delta 18,155 fit the learned window and the subject pin was unchanged |

This is a deterministic replay of a real recorded decision. It does not fabricate a claim, contact
Mainnet, or write a new policy. The only changed input is the policy window.

## What the recorded ledger says

The committed snapshot contains 306 checkpoint-stamped decisions. In the ungated memory path, the
unsafe outcomes divide into three concrete categories:

- **214 changed** — the stored subject pin no longer matched;
- **16 unchanged-but-old** — the memory exceeded its window even though the pin remained unchanged;
- **4 unverified** — the required proof could not be established.

With the gate enabled, none of those 234 records becomes an answer from memory. Changed and
unverifiable claims are withheld; unchanged-but-old cases become evidence for learning rather than a
silent answer.

## A real revision can age before persistence

The recorded lifecycle also exposes a less comfortable result. A Sui Clock correction took 117,242 ms
to reach Walrus after its proof was read. The first later proof-equivalent check happened 1,381 ms after
persistence and already found the subject changed.

The lifecycle therefore reports `STALE → FRESH → STALE` precisely:

- the predecessor observation was stale and withheld;
- the correction evaluates fresh at its own proof time;
- the same proof evaluates stale at the first later recorded check.

The historical later event recalled proof-equivalent observation `zAji1w8p…`, not the correction blob
itself. The contract states that distinction instead of implying that the correction was historically
recalled fresh after persistence.

## Try the recorded evidence

The reproducible path is offline, read-only, and credential-free:

```sh
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle
```

To inspect the homepage and evidence desk:

```sh
npm run proof:offline
```

The page includes the exact blob lineage, revision timing, learned-policy verdict comparison, memory
inventory, decision ledger, and recorded Tatum request metadata.

## Honest limits

- The live read-only installable CLI remains **UNVERIFIED end to end** against Mainnet.
- The delivered integration surfaces are a CLI and JavaScript API; an MCP tool/agent adapter is not
  implemented.
- The observer later learned a SLOW window of 40,000, but that later value was not persisted. The
  stored 20,000-checkpoint policy is tighter and more conservative.
- The FAST window of 25 checkpoints is shorter than the historical observer cadence, so that learning
  loop is effectively frozen at its persisted version. A cadence-aware floor or heartbeat observation
  would be needed to continue it reliably.
- Exact Walrus blob retention is unknown because the recorded blobs' `end_epoch` was not available
  through the tools used for this project. The committed snapshot remains reproducible offline.
- No real user study has validated the proposed operations-analyst persona.
- The current milestone has not been pushed or deployed. The public repository and hosted proof page
  remain older published snapshots until the owner approves those actions.

No new Mainnet write was required for this demonstration. The learning-loop view is built entirely
from recorded Mainnet evidence and the existing persisted policy blob IDs.

---

Source paths: [`src/gate.mjs`](../src/gate.mjs), [`src/policy.mjs`](../src/policy.mjs),
[`src/tatum.mjs`](../src/tatum.mjs), [`src/store.mjs`](../src/store.mjs), and the committed
[`proof snapshot`](evidence/proof-snapshot.json).
