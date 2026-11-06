**Requires Node v26.13.0 or newer (`node --version`; `nvm use` picks it up from `.nvmrc`) — an older Node fails at install with a clear `ENOTSUP` message.**

# Judge quickstart — fresh clone → proof in 60 seconds

Everything below works **without any credentials**. Live paths are optional and marked.

## 0. Requirements

- Node **v26.13.0** or newer — **check `node --version` first**. If it is older, your `npm test` may
  fail with a cryptic `Cannot find module …/test`; switch Node (nvm: `nvm install 26.13.0 && nvm use 26.13.0`)
  and retry. `.npmrc` sets `engine-strict=true`, so an older Node fails at install time with a clear message.
  The repo ships **`.nvmrc` (26.13.0)** — `nvm use` in the clone directory selects it automatically.
- No secrets, no network needed for the default path.
- A terminal with `git`.
- Optional: Docker (see §7).

## 1. Clone and install (~20 s)

```sh
git clone https://github.com/unifyWeb3/freshness-bound-recall.git freshness-recall && cd freshness-recall
nvm use                 # reads .nvmrc -> 26.13.0 (the package supports Node >= 24)
npm install --ignore-scripts
```

> **Already published — the hosted proof page (a cached snapshot):**
> <https://freshness-bound-recall-oxunify.vercel.app>
> It is the static export of a labelled snapshot (`STATIC EXPORT · … · network off · ids & stamps from a
> labelled snapshot` on the page itself), byte-identical to the deployed export
> (sha256 `91ebae92b30481f9…`). It fetches nothing and needs no credentials. The steps below rebuild
> the page from the committed snapshot; they are not claimed to reproduce the deployment's old bytes.

## 2. Offline tests (~5 s)

```sh
npm test
```

Expected: `ℹ tests 67 · ℹ pass 63 · ℹ fail 0 · ℹ skipped 4`
(2 live opt-in tests skip without `RUN_MAINNET=1`; 2 real-`.env` redaction tests skip because a
judge's clone has no `.env`. With a `.env` present but no `RUN_MAINNET=1` the same suite reports
`65 pass / 2 skipped`.)

## 3. The offline demo (~1 s)

```sh
npm run demo:offline
```

Expected output (abbreviated):

```
FRESHNESS-BOUND RECALL · offline demo over cached snapshot (network off)
…
offline mode: skipping live self-test; serving cached checkpoint 341944901 read at 2026-11-05T14:36:57.232Z
chain 4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S (Sui mainnet)
checkpoint 341944901 (9AmYmYmNUs9V…) source=cache-offline
Sui Clock (shared object, 0x6) 1019546722  @2026-11-05T14:36:57.402Z
FAST window = 25 checkpoints (source: store, version 1, reason: MISSED-CHANGE 3 > FALSE-STALE 0: tighten 50 -> 25)
SLOW window = 20000 checkpoints (source: store, version 2, reason: FALSE-STALE 3 > MISSED-CHANGE 0: widen 10000 -> 20000)
4) a stale memory is WITHHELD, not answered
verdict: STALE — subject changed (version 1018789643->1019546722, digest changed)
answer: WITHHELD — …The stored memory … was not used as the answer.
6) the adversarial old-but-true memory is re-checked (the loop learns)
7) memory-off vs memory-on …
memory-on, gate + policy …  stale-answers 0
demo complete … 0 stale answers given from memory; 306 decisions recorded
```

Snapshot source: committed `docs/evidence/proof-snapshot.json` (labelled — snapshot generated
2026-11-05T14:37Z, cp 341944901, **22** memories, 306 recorded decisions). The demo reads nothing
live in this mode.

> **The offline demo narrates only what it observed.** Step 6 says what actually happened to the
> adversarial record's pin (unchanged → `FALSE-STALE`, changed → `STALE`/`CONSISTENT`) — it never
> claims a pin state it did not read. The `FALSE-STALE` path is reproducible on demand with
> `node scripts/show-policy-effect.mjs` (needs live credentials).
>
> The committed snapshot's adversarial record predates the anchor-proof fix, so its body is not
> evidence that it was already old when written. `test/observer.test.mjs` verifies that new records
> carry the anchor's real checkpoint, digest, object pin and read time.

## 4. The proof page (~1 s)

```sh
npm run proof:offline
```

Expected: `[proof] OFFLINE (cached) page on http://127.0.0.1:8787` — open it in a browser.
It shows all **22** memories (blob ids + checkpoint stamps), the lineage graph, the Tatum request log
(with the plan header and an `x-api-key` badge per row), the decision ledger, and the ablation table.
The badge says **CACHED SNAPSHOT** and names the generation time; nothing is fetched.

> **Port already in use?** Use another one: `node scripts/proof-page.mjs --offline --port=8801`
> (the same flag works for the live page). This happened during verification on the build host — an
> unrelated service was already on 8787 — and the fix is a flag, not a code change.

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

## 6. Optional — one-command container (Docker)

```sh
docker build -t freshness-bound-recall .
docker run --rm freshness-bound-recall
```

The image runs the offline tests, the offline demo and `npm run export`, then prints the path of the
static proof page. It contains **no credentials**: `.env` is excluded by `.dockerignore` and no
command in the image touches the live path.

> **Verification status: UNKNOWN — the Docker path could not be executed in the build environment**
> (no `docker` binary and no Docker socket were available on the build host, 2026-11-05).
> What *was* verified natively, from a fresh clone, with the exact command sequence the image runs
> (`npm ci --ignore-scripts` → `npm test` → `npm run demo:offline` → `npm run export`, no `.env`
> present): all four steps succeed — 67 tests, 63 pass, 0 fail, 4 skipped; the demo completes with
> 0 stale answers; the export writes `site/index.html` and scans 0 env values. The Docker image
> itself is therefore **written but UNVERIFIED**; please treat `npm test` on the host as the
> authoritative check.

## 7. If something fails

- `no snapshot found` — the repo ships `docs/evidence/proof-snapshot.json`; if it was deleted, run
  `npm run proof` live once to regenerate it (needs live credentials), or ask the author for it.
- `EADDRINUSE … 127.0.0.1:8787` — something else is on the default port; run
  `node scripts/proof-page.mjs --offline --port=8801` instead.
- `429 rate limited` — Tatum free plan is 3 rps shared; wait a minute; retry.
- `Cannot find module …/test` — your Node is older than 26.13.0; run `nvm use` (reads `.nvmrc`).
- Anything else — run `npm run audit:secrets`; it prints AUDIT: PASS/FAIL honestly.
