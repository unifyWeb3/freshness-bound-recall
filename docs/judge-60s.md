**Runtime:** Node >=24. The accepted run used Node 26.13.0; `nvm use` selects that version from `.nvmrc`.

# Judge quickstart — real revision proof in 60 seconds

The shortest useful path is credential-free, offline, read-only, and deterministic. It needs no
`.env`, wallet, Mainnet access, or write approval.

## 1. Clone, install, and run the lifecycle

Run this from an otherwise empty working directory:

```sh
git clone https://github.com/unifyWeb3/freshness-bound-recall.git freshness-recall
cd freshness-recall
nvm use                         # optional; selects the accepted Node 26.13.0 runtime
npm install --ignore-scripts    # lifecycle scripts never run
npm run recall:checked -- --sample sui-clock-revision-lifecycle
```

The accepted empty-folder install added 31 packages in about five seconds and ran no lifecycle
hooks. The product output was:

```text
Freshness-Bound Recall · recorded Mainnet lifecycle · read-only
STALE → FRESH → STALE
Predecessor: obs-sui-clock-341742424 · goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY · checkpoint 341742424
Correction: cor-sui-clock-341742463 · mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY · checkpoint 341742463
Supersedes: obs-sui-clock-341742424 → goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY
Timing: persisted 117242 ms after proof · first recorded check 1381 ms later
At revision proof: FRESH · 0x0000000000000000000000000000000000000000000000000000000000000006 on Sui mainnet: version=1018797298 digest=4vTVNHed9pwSGFSE6xeSqvMyXBMSYv9nJfzXvxdQMqUM. Memory cor-sui-clock-341742463 was written at checkpoint 341742463 (0 checkpoints ago, window 50); subject version/digest unchanged.
First post-persistence check: STALE/WITHHELD · subject changed (version 1018797298->1018799005, digest changed)
Provenance: recorded Mainnet evidence · network off · Writes: none
```

This is the recorded revision lifecycle, not a fabricated fixture:

- Predecessor Walrus blob: `goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY`
- Correction Walrus blob: `mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY`
- Stored `supersedes` reference: claim `obs-sui-clock-341742424`, resolved to the predecessor blob
- First later recorded event: 1,381 ms after persistence, recalling proof-equivalent observation
  `zAji1w8p4REMzUF2o1V7IfgfQlpN7np7Qs8ehtNVXHg`

The public replay evaluates the actual correction blob. The historical later event recalled the
proof-equivalent observation, not that correction blob; the JSON contract discloses this distinction.

## 2. Inspect the machine-readable proof

```sh
npm run --silent recall:checked -- --sample sui-clock-revision-lifecycle --json
```

The stable `recall_checked_lifecycle/v1` document reports:

- `read_only: true`
- `source.network_access: false`
- `behavior.sequence: ["STALE", "FRESH", "STALE"]`
- empty `writes` arrays at the top level and in both deterministic replays
- the two actual blob IDs, resolved lineage, recorded checkpoints, subject pins, and timing above

Missing, ambiguous, or inconsistent lifecycle evidence is rejected rather than converted into a
verdict. Those fail-closed cases are covered by `test/recorded-lifecycle.test.mjs`.

## 3. Open the 60-second proof desk

```sh
npm run proof:offline
```

Open <http://127.0.0.1:8787>. The homepage leads with the same one-command lifecycle and then exposes
the cached proof desk: memory IDs and checkpoint stamps, lineage, decision ledger, Tatum request log,
and ablation evidence. It makes no network requests and needs no credentials.

If port 8787 is occupied:

```sh
node scripts/proof-page.mjs --offline --port=8801
```

For a serverless copy:

```sh
npm run export
```

This writes the self-contained `site/index.html`. The export scans for `.env` values before writing
and fires no browser requests. The previously hosted URL is an older labelled cached snapshot; this
homepage milestone has not been deployed.

## 4. Run the tests and audits

```sh
npm test
npm run audit:secrets
node scripts/audit-history.mjs
```

Current Milestone 3 suite: **127 tests, 127 pass, 0 fail, 0 skipped**. The acceptance baseline
before homepage work was **120 tests, 120 pass, 0 fail, 0 skipped**; focused milestone acceptance was
**30/30 pass**. Secrets audit: **11 passes, 0 failures**; full-history audit: **0 findings**.

## 5. Verify the write boundary without writing

Recorded samples are always offline and read-only. This invalid opt-in fails before any network use:

```sh
npm run --silent recall:checked -- --allow-mainnet-writes
```

Expected: exit code 2 and
`--allow-mainnet-writes is valid only with --live. The recorded sample is always read-only.` Live
mode also defaults to read-only. Without credentials it exits before network access and names all four required keys.
`--allow-mainnet-writes` can incur Mainnet cost and must not be used without the account owner's
separate approval.

## 6. Optional deeper offline demo

```sh
npm run demo:offline
```

This runs the longer cached-snapshot narrative over 22 memories and 306 recorded decisions. It ends
with zero stale answers from memory. The committed source is `docs/evidence/proof-snapshot.json`.

## 7. Optional container path

```sh
docker build -t freshness-bound-recall .
docker run --rm freshness-bound-recall
```

**Verification status: UNKNOWN.** The Docker path could not be executed in the build environment:
there was no Docker binary or socket. Its native command sequence was verified, but the image itself
must still be treated as unverified.

## 8. Troubleshooting

- `EADDRINUSE … 127.0.0.1:8787` — use `--port=8801` as shown above.
- `Cannot find module …/test` — use Node >=24; `nvm use` selects the accepted version.
- `no snapshot found` — restore the committed `docs/evidence/proof-snapshot.json`.
- Live `429` responses — Tatum's shared limit may be exhausted; the 60-second path never calls it.
