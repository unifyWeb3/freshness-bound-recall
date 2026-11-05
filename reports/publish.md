# Publish report — FRESHNESS-BOUND RECALL

## Verdict: **GO** — published and deployed; verified unauthenticated. Nothing was submitted to the portal, posted, or registered.

**Date:** 2026-11-05 · **Scope executed:** exactly the authorised list (public repo + push + static
deploy + one project's deployment protection + links in three docs + this report). **Not executed and
not authorised:** any post, tweet, blog publish, form submission, dashboard change, renewal or funding,
Walrus write, or signed transaction. The observer and the live proof page were **not** started.

---

## 1. The two URLs

| What | URL |
|---|---|
| **Repository** (public, full history) | <https://github.com/unifyWeb3/freshness-bound-recall> |
| **Hosted proof page — a cached snapshot** | <https://freshness-bound-recall-oxunify.vercel.app> |
| Deployment-specific URL (same bytes) | <https://freshness-bound-recall-bt2cpyhp3-oxunify.vercel.app> |

**Final published commit:** `3488fcd` (the state verified below). This report is committed **on top of
it**, so `git log -1` on `main` shows the report commit one ahead — the content it describes is
`3488fcd`. The earlier hashes cited throughout the repo (`f9832ac`, `6811932`, `97b10aa`, `f9ddd66`)
are **unchanged on GitHub** (verified, §4).

**The hosted page is a cached snapshot, not a live service.** Its banner reads
`STATIC EXPORT · 2026-11-05 14:38:32.408Z · network off · ids & stamps from a labelled snapshot`. It is
the output of `npm run export`, byte-identical (sha256 `91ebae92b30481f9ecd1d76d81d0d953ff23ee4e65fbe3d39fd54d9de98eca9b`),
and it fires **no network requests**. The live proof page remains a local process and was never hosted.

---

## 2. What was published, and how

| Item | Detail |
|---|---|
| GitHub account | `unifyWeb3` (the `gh` CLI session; the GitHub MCP has no auth-user tool, so the account was confirmed with `gh auth status`) |
| Repo name | `freshness-bound-recall` — **the first-choice name was free** (the API returned 404 before creation), so no alternative was needed |
| Visibility | **public** (`private: false`, `visibility: public` — re-read unauthenticated) |
| Description | “A Walrus Memory agent that gates every answer on live Sui mainnet reads through Tatum — the freshness window itself is a memory the system rewrites from observed decay.” |
| Topics | `walrus`, `sui`, `tatum`, `agent-memory`, `hackathon` (all five confirmed present on the repo) |
| Branch | `main` (the local branch was renamed `master` → `main` to match the new repo's default branch; **no commit hash changed**) |
| History | **all 16 commits pushed as-is** — no file was re-committed, squashed or rewritten |
| Vercel project | `freshness-bound-recall`, id `prj_ft4fAYroHEvbIPd9ksbodWOMhIHc`, team `oxunify` (`team_D5vYgIJiBerZlxQkRwPgNlkX`), account `oxunifyy`, hobby plan |
| Deployment | id `dpl_5wJQLf5oqKNs1efNtiaykHug22Vx`, target **production**, state **READY**, alias `freshness-bound-recall-oxunify.vercel.app` |
| Deployed content | **only `./site`** — `index.html` (47,372 B) and `export.json` (258 B). The live proof page was **not** deployed |
| Vercel env vars | **none** — `filter_project_envs` returns `envs: []`, `hiddenProductionEnvCount: 0`. No `.env` value was ever sent to Vercel |
| Deployment Protection | was **enabled by default** on the new project (`ssoProtection.enabled: true`, `deploymentType: all_except_custom_domains`) and blocked the production URL with a 302 to `vercel.com/sso-api`. It was disabled **for this project only** (`ssoProtection: null`, `passwordProtection: null`, `trustedIps: null`). **No other Vercel project was touched** |

### Why the push used `git` and not the GitHub MCP

The GitHub MCP can only write files through the REST API (`create_or_update_file`, `push_files`), which
**creates new commits and cannot reproduce the existing history** — the hashes cited in the docs
(`f9832ac`, `97b10aa`, …) would not have survived it. The MCP has no git-data API (no create-blob /
create-tree / create-commit / update-ref tools) and therefore no way to push history.

Instead the authenticated `gh` CLI (same account, `unifyWeb3`, token scopes `repo`, `workflow`) was used
for a real `git push`, so the history and every hash are intact. **The GitHub MCP was then used for
read-back verification** (file tree, commit list, README content). No file was re-committed to fake
history — the instruction’s intent was satisfied by using the push path that can preserve it.

---

## 3. Gates, in order (STEP 2 and STEP 3)

| Gate | Result |
|---|---|
| `.env` untracked | **PASS** — `git ls-files --error-unmatch .env` → not tracked; `git check-ignore -v .env` → `.gitignore:1:.env` |
| `.env` absent from the published tree | **PASS** — `git ls-tree -r origin/main --name-only` → 0 matches |
| Offline tests (working tree, with `.env`) | **PASS** — 67 tests · 65 pass · 0 fail · 2 skipped |
| Secrets audit — working tree | **PASS** — 56 tracked files, 2 secret values fingerprinted (never printed), 11 passes, 0 failures |
| Secrets audit — full git history (all refs) | **PASS** — 167 objects · 100 blobs scanned · **0 findings** |
| Fresh clone, no `.env`, Node v26.13.0 (from `.nvmrc`) | **PASS** — see below |

**Fresh-clone judge run** (`/tmp/opencode/judge-run`, clone of the local repo, `.env` absent, Node
v26.13.0): `npm install --ignore-scripts` → 30 packages · `npm test` → 67 / 63 / 0 / 4 (the 2 extra
skips are the `.env`-redaction tests) · `npm run demo:offline` → FAST 25 + SLOW 20000 loaded from the
store, 306 decisions, **0 stale answers** · `npm run export` → `site/index.html` 47,372 B, 0 env values
scanned · proof page `--offline --port=8801` → `/healthz` **200** `{"ok":true,"error":null,"mode":"offline"}`
and `/` **200** with the `CACHED SNAPSHOT` badge and the `x-api-key` badges. **No step failed, so no
repo fix was needed.**

> **Audit rule change (disclosed, not silent).** The tree audit previously asserted *“no git remotes
> configured”* — a rule from the local-only phase. After publishing it correctly failed. It was replaced
> with a **stronger** publication-aware rule: every configured remote must be the authorised public
> repo, **and** the published tree must contain no `.env` and no runtime artifact (`data/cache/`,
> `data/ledger.jsonl`, `data/policy-mirror.json`, `site/`, `freeze/`). Both halves pass. The history
> audit — the real secret-leak check — was never weakened: it still scans every blob in every ref.

---

## 4. What was verified **unauthenticated** (no credentials sent)

| Request | Status | Observed |
|---|---|---|
| `GET https://api.github.com/repos/unifyWeb3/freshness-bound-recall` | **200** | `private: false`, `visibility: public`, `default_branch: main`, topics `[agent-memory, hackathon, sui, tatum, walrus]` |
| `GET https://raw.githubusercontent.com/unifyWeb3/freshness-bound-recall/main/README.md` | **200** | 28,289 B, correct title and promise line |
| `GET https://github.com/unifyWeb3/freshness-bound-recall` | **200** | 363,599 B of HTML; the README renders (`FRESHNESS-BOUND RECALL`) |
| `GET …/commits/f9832ac` | **200** | `f9832ac4bfdd…` — the freeze-era hash still resolves on GitHub |
| `GET …/commits/6811932` · `…/97b10aa` · `…/f9ddd66` | **200** each | hashes unchanged |
| `GET …/commits?per_page=100` | **200** | full history, oldest `8e0cfdc` (Phase 1) → newest |
| `GET https://freshness-bound-recall-oxunify.vercel.app/` (before the protection change) | **302** | → `https://vercel.com/sso-api?…` — “Protected by Vercel Authentication” |
| `GET https://freshness-bound-recall-oxunify.vercel.app/` (after) | **200** | 47,372 B; banner present; 9 `x-api-key` badges; sha256 identical to the local export |
| `GET …/export.json` | **200** | 258 B, its `index_html_sha256` matches the served page |
| `GET https://freshness-bound-recall-bt2cpyhp3-oxunify.vercel.app/` | **200** | 47,372 B, same sha256 |

**Integrity:** the bytes served by Vercel have sha256
`91ebae92b30481f9ecd1d76d81d0d953ff23ee4e65fbe3d39fd54d9de98eca9b` — identical to
`site/index.html` locally and to the deployment’s uploaded SHA-1
`3480822bf654386c4cb7bb9929c8ae939f48bf40`.

**GitHub MCP read-back (cross-check):** the remote tree contains `.dockerignore`, `.gitignore`,
`.npmrc`, `.nvmrc`, `Dockerfile`, `README.md`, `data/`, `docs/`, `fixtures/`, `package.json`,
`package-lock.json`, `reports/`, `scripts/`, `src/`, `test/` — and **no `.env`**; the commit list
matches the local history.

---

## 5. Failed, changed, or UNKNOWN

| Item | State |
|---|---|
| GitHub MCP cannot push history | **LIMITATION FOUND** — API-only file writes would have destroyed the cited hashes; resolved with a real `git push` via the authenticated `gh` CLI (§2) |
| Deployment Protection blocked public access | **FOUND AND FIXED** (this project only) — 302 → 200 |
| First `create_deployment` call rejected | **FOUND AND WORKED AROUND** — the MCP’s `files` union rejected the inline `data`+`encoding`+`file` shape (“Expected exactly one member to match”); switched to the documented `upload_file` → `{file, sha, size}` flow |
| `x-api-key` proof | **VERIFIED** — 21/21 in the credits run, 7/7 in the final snapshot, 2,208/2,208 in the earlier long page run; the key value is never printed |
| Docker path | **UNKNOWN** — never executed (no Docker binary or socket on this host); the same command sequence was verified natively |
| Walrus blob retention beyond the relayer default | **UNKNOWN** — `end_epoch` is not readable with any tool available here |
| Tatum credits per call | **UNKNOWN** — Tatum returns no credit header; compare the 21-request measurement with the dashboard |
| Real-user validation of the persona | **HYPOTHESIS** — no user has validated it |
| `fc-policy-SLOW-v2` auxiliary field | **DISCLOSED** — `policy.evidence_count=undefined` on blob `Zne2mnjA…`; immutable on Walrus, evidence list intact, ignored by the engine |
| Later SLOW learning | **DISCLOSED** — the observer learned 40000 at 02:25:24 UTC; never persisted, so the stored policy is 20000 |
| Freeze bundle | **LOCAL** — `freeze/` is git-ignored and is **not** in the public repo; the committed equivalent is `docs/evidence/proof-snapshot.json` + `reports/pre-submit.md`. Attach `freeze/freeze-2026-11-05T145207337Z.json` through the form’s `additionalDocs` field if an upload is accepted |
| Deployment ↔ commit linkage | The deployment’s `gitMetadata` names `f9ddd66` (the commit at deploy time). The deployed bytes are the static export and are hash-identical, so later commits do not change the served page |
| Observer / live proof page | **NOT RUNNING** — neither was started; no Tatum traffic was generated during publication |

---

## 6. Exact lines to paste into the submission form

**`repoUrl`**

```
https://github.com/unifyWeb3/freshness-bound-recall
```

**Snapshot link** (for `additionalDocs`, or the description / video description — label it as a cached
snapshot, because that is what it is):

```
Hosted proof page (static export of a labelled snapshot, network off): https://freshness-bound-recall-oxunify.vercel.app
```

**If the form wants a bare URL for the snapshot**

```
https://freshness-bound-recall-oxunify.vercel.app
```

**Still yours to do (not authorised here):** record and upload the demo video (`demoVideoUrl`), fill
`tatumAccountId`, `suiAddress`, `accountId`, `memwalAgentId`, `email`, `discordId`, `linkedinUrl`,
`howHeard`, `firstWeb3Project`, `telegramId`, tick the **event-rules acceptance checkbox**, paste the
bonus `socialPosts` (or `none`), and press submit. The portal was never touched.
