# Three-minute video script — RecallGuard

Audience: hackathon judges and reviewers.

This script is deliberately recordable from the offline, committed evidence. It needs no wallet,
API key, `.env`, network access, or Mainnet write. The installable live read-only CLI remains
**UNVERIFIED end to end** and is not part of the default recording.

## Prepare the recording

Run:

```sh
npm install --ignore-scripts
npm run mcp:smoke
npm run recall:checked -- --sample sui-clock-revision-lifecycle
npm run export && npm run proof:offline
```

Open <http://127.0.0.1:8787>. Keep the terminal beside the browser. Use the current local pages,
not the older hosted snapshot until the release is deployed.

Never run `npm run test:live`, `--allow-mainnet-writes`, the observer, or a persistence script while
recording. Those paths can write to Mainnet and require separate approval and a cost estimate.

## Shot list and voice-over

| Time | Screen and action | Voice-over |
|---|---|---|
| 0:00–0:15 | Homepage hero. Keep the tagline in frame: “Your agent remembers. RecallGuard checks whether it’s still true.” | “AI agents reuse remembered facts after the world moves. RecallGuard is a verification gate between an agent’s memory and its answer. This recording uses committed Mainnet evidence, replayed offline and read-only.” |
| 0:15–0:28 | Click through the interactive demo steps 1→5 (recalled claim → Tatum verification → WITHHELD → correction → next interaction). | “Here is the whole loop. The agent recalls a Walrus-backed memory. Tatum reads the current Sui checkpoint and the subject’s version and digest. The evidence disagrees, so the gate withholds the answer. A correction supersedes the old memory, and the next interaction behaves differently because the memory changed, not the prompt.” |
| 0:28–0:44 | Terminal. Reveal `npm run mcp:smoke` output — all checks PASS. | “RecallGuard is an MCP server. This spawns it over stdio and calls the tools with a real MCP client: recall_checked, the revision chain, the evidence overview, and the write gate refusing by default. No credentials, no network, read-only.” |
| 0:44–0:58 | Browser: the WITHHELD recorded decision card in the hero, then `/mcp.html` — scroll to the tools table and the Claude Code / Codex configs. | “Six tools. Recall_checked enforces freshness; explain_decision says why; list_revisions shows lineage; get_evidence shows provenance; propose_correction only drafts. store_correction stays disabled unless the owner flips three separate gates. Claude Code and Codex configs are in the page, and both were tested with isolated home directories.” |
| 0:58–1:14 | Terminal. Reveal `npm run recall:checked -- --sample sui-clock-revision-lifecycle`. Pause on `STALE → FRESH → STALE`. | “The sixty-second path needs no credentials. A real Sui Clock observation became stale; its correction is fresh at the recorded revision proof; and the same proof becomes stale again after the subject changes.” |
| 1:14–1:30 | Point to the predecessor and correction lines, then the timing line. | “The lineage uses actual Walrus blob ids. The correction took 117,242 milliseconds to persist. The first recorded proof-equivalent check came 1,381 milliseconds later and withheld it. The historical event recalled a proof-equivalent observation, not the correction blob itself; the contract says that explicitly.” |
| 1:30–1:50 | `/evidence.html`: scroll to the decision that did not escape; trace question → recalled memory → gate → verified value. | “On the evidence page, every number is labelled: recorded evidence, offline replay, live verification, and one modelled counterfactual analysis. This captured decision shows the exact claim, the checkpoint proof it was stored with, and the live values that disagreed.” |
| 1:50–2:12 | Scroll to “A policy memory changed the verdict.” Point to the two verdict cards. | “The freshness window is also a memory. The stored SLOW policy is blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`. The observation replayed under both policies is `Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g`. Delta 18,155 checkpoints, subject pin unchanged. Five-thousand window: stale, false-stale. Twenty-thousand from the Walrus policy record: fresh, consistent. Deterministic replay of a real recorded decision — not autonomous learning.” |
| 2:12–2:32 | Scroll to “What the gate prevented.” Hold on the three figures. | “The committed ledger contains 306 recorded decisions. Without the gate, 214 changed memories could have answered, 16 unchanged-but-old memories would have answered, and 4 unverified records would have escaped. The gated path answers only what it proves fresh. That split is a modeled analysis of the recorded log — not production incidents.” |
| 2:32–2:50 | Open the collapsed inventories briefly — memory inventory, latest decisions, Tatum request metadata. | “The proof is inspectable: blob ids, checkpoint stamps, lineage, request metadata with a boolean x-api-key proof — never the key itself. The offline export makes no browser requests, and the four-page export is scanned for secret values.” |
| 2:50–3:00 | Return to the hero and stop on the tagline. | “The honest limits are visible in the docs: the live CLI is not yet verified end to end, retention is unknown, and the later 40,000 window was not persisted. The name is the contract: your agent remembers — RecallGuard checks whether it’s still true.” |

## Recording notes

- Aim for 2:55–3:05; pause on the numbers rather than speaking faster.
- Keep the offline / read-only / network-off labels in frame whenever a Mainnet claim is discussed.
- Do not say that the historical later event recalled the correction blob; it recalled a
  proof-equivalent observation.
- Do not say every learned value was persisted. The stored SLOW policy is 20,000; a later learned
  40,000 value was not persisted.
- Do not claim the live installable CLI is verified. If the owner later grants permission for a
  separate live read-only run, treat that footage as an optional appendix and show `read_only: true`
  and `writes: []` on screen.
- Do not describe the MCP smoke test as proof of Mainnet behaviour; it proves the tools, the
  protocol and the write gate on recorded evidence.
- Do not use the older hosted snapshot as evidence for the current release until the deploy is
  verified; after deployment, the hosted page is the matching four-page static export.
