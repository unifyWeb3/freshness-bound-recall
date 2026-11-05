# Judge quickstart — fresh clone → proof in 60 seconds

Everything below works **without any credentials**. Live paths are optional and marked.

## 0. Requirements

- Node **v26.13.0** or newer (`node --version`); npm 11+.
- No secrets, no network needed for the default path.
- A terminal with `git`.

## 1. Clone and install (~20 s)

```sh
git clone <repo-url> freshness-recall && cd freshness-recall
npm install --ignore-scripts
```

## 2. Offline tests (~5 s)

```sh
npm test
```

Expected: `ℹ tests 66 · ℹ pass 62 · ℹ fail 0 · ℹ skipped 4`
(2 live opt-in tests skip without `RUN_MAINNET=1`; 2 real-`.env` redaction tests skip without `.env`.)

## 3. The offline demo (~1 s)

```sh
npm run demo:offline
```

Expected output (abbreviated):

```
FRESHNESS-BOUND RECALL · offline demo over cached snapshot (network off)
…
FAST window = 25 checkpoints (source: store, version 1, reason: MISSED-CHANGE 3 > FALSE-STALE 0: tighten 50 -> 25)
4) a stale memory is WITHHELD, not answered
verdict: STALE — subject changed (version 1018789643->1018808529, digest changed)
answer: WITHHELD — …The stored memory … was not used as the answer.
7) memory-off vs memory-on …
memory-on, gate + policy …  stale-answers 0
```

Snapshot source: committed `docs/evidence/proof-snapshot.json` (labelled — snapshot generated
2026-11-05T02:05Z, cp 341759265, 17 memories). The demo reads nothing live in this mode.

## 4. The proof page (~1 s)

```sh
npm run proof:offline
```

Expected: `[proof] OFFLINE (cached) page on http://127.0.0.1:8787` — open it in a browser.
It shows all 17 memories (blob ids + checkpoint stamps), the lineage graph, the Tatum request log
(with the plan header), the decision ledger, and the ablation table. The badge says
**CACHED SNAPSHOT** and names the generation time; nothing is fetched.

Static alternative (no server at all):

```sh
npm run export   # writes ./site/index.html (+ export.json fingerprints)
```

`./site/index.html` is a single self-contained page (no requests fire). The export scans the HTML
against `.env` values (none exist in a judge's clone) and refuses to write if any leak.

## 5. Optional — live mainnet path

Requires a `.env` with `TATUM_API_KEY`, `MEMWAL_ACCOUNT_ID` (the MemWalAccount **object id**, never a
wallet address), `MEMWAL_AGENT_ID`, `MEMWAL_PRIVATE_KEY`. Never commit it.

```sh
npm run prewarm        # warm Tatum + relayer; credential self-test (on-chain check of the account id)
npm run demo           # live answers, ~25 s, read-only — no Walrus writes
RUN_MAINNET=1 npm run test:live   # 2 opt-in live tests (both write 1 seed blob each)
```

Live budget note: the steady observer (`node scripts/observer.mjs --live --interval=300 --budget=0`)
makes ~3 Tatum calls per 5 minutes and writes nothing. Do not run the live proof page unattended.

## 6. If something fails

- `no snapshot found` — the repo ships `docs/evidence/proof-snapshot.json`; if it was deleted, run
  `npm run proof` live once to regenerate it (needs live credentials), or ask the author for it.
- `429 rate limited` — Tatum free plan is 3 rps shared; wait a minute; retry.
- Anything else — run `npm run audit:secrets`; it prints AUDIT: PASS/FAIL honestly.
