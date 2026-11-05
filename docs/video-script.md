# Video script — FRESHNESS-BOUND RECALL (≈ 2:30)

**Audience:** hackathon judges (Track 02, “Smart Agents for Real Life”).
**Recording (user only — the agent never records, uploads or posts):**
`npm run demo` live, side-by-side with `http://127.0.0.1:8787` proof page.
If the live relayer flakes, record the whole clip in `--offline` mode — the labels say CACHED SNAPSHOT
and it is fully reproducible. Budget one re-take.

**Do not** say "nobody else does this". Say: *"Recall Lab and RecallIQ stamp freshness too; I move the
gate onto the answer path and make the tolerance a memory."*

---

## Shot list (screen: terminal / proof page)

| t | Screen / action | Voice-over |
|---|---|---|
| 0:00 | proof page (offline badge visible) | “This is FRESHNESS-BOUND RECALL. It answers real Sui mainnet questions, but it will not answer from a memory it cannot re-verify.” |
| 0:10 | scroll the 15 memories list; point at blob id + checkpoint stamp | “Every record here — fifteen blobs on Walrus Memory — carries a checkpoint stamp at write time: sequence, digest, object version.” |
| 0:22 | point at policy card `fc-policy-FAST-v1` window 25 | “This window is not a constant. It is a memory — `fc-policy-FAST-v1`. The system tightened it from 50 to 25 after three live MISSED-CHANGE decisions on the Sui Clock.” |
| 0:35 | terminal: `npm run demo` | “Live now — nothing staged, nothing scripted around me.” |
| 0:40 | demo output steps 1–3 | “First the startup self-test: chain id, relayer health, and on-chain proof that my account id is the MemWalAccount object, not my wallet — that mistake cost me four hours.” |
| 0:55 | demo output step 2 | “The chain is moving: checkpoint 341747392. The Sui Clock is at version 1018814655.” |
| 1:00 | demo output step 3 | “Notice: policy loads from memory, not from this process. FAST window 25, version 1, learned from live decay.” |
| 1:08 | demo output step 4 | “The seeded claim — ‘Sui Clock at version 1018797298’. The gate refuses to answer. WITHHELD — subject changed. And it shows the live value instead of lying.” |
| 1:22 | demo output step 4 (verdict text) | “That verdict is what every answer in the product goes through. Fresh, or withheld. There is no ‘answer anyway.’” |
| 1:28 | demo output step 6 | “Old-but-true is not the same as fresh either. The registry pin never changed — but the window expired — so the answer is withheld and the policy sees FALSE-STALE.” |
| 1:42 | demo output step 7 (ablation table) | “Ninety decisions recorded with checkpoint stamps: without the gate, fifty of them would have been served stale. With it — zero.” |
| 1:52 | demo output step 8 (lineage) | “Every correction links the blob it superseded — lineage is on-chain, not implied.” |
| 2:02 | proof page detail: Tatum request log (plan header) | “Both integrations are real: every request goes through Tatum GraphQL with the API key and logs the plan header; every memory is on Walrus.” |
| 2:12 | terminal: `npm run audit:secrets` (optional) | “Nothing secret in the repo; `.env` is ignored; no remote configured.” |
| 2:18 | closing card: product name + “Submit by 10 Nov 17:00 UTC” | “A memory you cannot re-verify is not an answer. It's a rumor.” |

## Re-take checklist

`npm run demo` must complete green with 0 stale answers; if the relayer hangs, `npm run demo:offline`
and re-record. Any claim that cannot be pointed at on the proof page is cut from the script.
