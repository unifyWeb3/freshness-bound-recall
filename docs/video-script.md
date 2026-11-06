# Three-minute video script — Freshness-Bound Recall

Audience: hackathon judges and reviewers.

This script is deliberately recordable from the offline, committed evidence. It needs no wallet,
API key, `.env`, network access, or Mainnet write. The installable live read-only CLI remains
**UNVERIFIED end to end** and is not part of the default recording.

## Prepare the recording

Run:

```sh
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle
npm run proof:offline
```

Open <http://127.0.0.1:8787>. Keep the terminal beside the browser. Use the current local page, not
the older hosted snapshot.

Never run `npm run test:live`, `--allow-mainnet-writes`, the observer, or a persistence script while
recording. Those paths can write to Mainnet and require separate approval and a cost estimate.

## Shot list and voice-over

| Time | Screen and action | Voice-over |
|---|---|---|
| 0:00–0:15 | Homepage hero. Keep the “Cached snapshot · network off” label visible. | “A memory is useful only while it is still true. Freshness-Bound Recall puts a verification gate between an agent’s memory and its answer. This recording uses committed Mainnet evidence, replayed offline and read-only.” |
| 0:15–0:35 | Terminal. Run or reveal `npm run recall:checked -- --sample sui-clock-revision-lifecycle`. Pause on `STALE → FRESH → STALE`. | “The sixty-second path needs no credentials. A real Sui Clock observation became stale, its correction is fresh at the recorded revision proof, and the same proof becomes stale again after the subject changes. The sequence is stale, fresh, stale.” |
| 0:35–0:52 | Point to the predecessor and correction lines, then the timing line. | “The lineage uses actual Walrus blob IDs. The correction took 117,242 milliseconds to persist. The first recorded proof-equivalent check came 1,381 milliseconds later and withheld it. The historical event recalled a proof-equivalent observation, not the correction blob itself; the contract says that explicitly.” |
| 0:52–1:15 | Browser: scroll to “The stale answer that did not escape.” Trace question → recalled memory → gate → verified value. | “Here is the answer path. Recall supplies a candidate. The gate compares its checkpoint proof with the current checkpoint and the subject’s version and digest. This recorded memory is withheld because the Sui Clock changed. The old value never becomes the answer; the verified value is shown instead.” |
| 1:15–1:34 | Scroll to “A policy memory changed the verdict.” Point first to the two source cards. | “The freshness window is also a memory. The stored SLOW policy is blob `Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4`. The observation replayed under both policies is blob `Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g`. The checkpoint delta is 18,155 and the subject pin is unchanged.” |
| 1:34–1:55 | Point left, then right, across the two verdict cards. | “With the built-in 5,000-checkpoint window, those exact inputs are stale with a false-stale signal. With the 20,000-checkpoint policy read from the Walrus record, the same inputs are fresh and consistent. The policy learned the recorded 10,000-to-20,000 step and was written later without backdating its learning time.” |
| 1:55–2:18 | Show the learned-policy cards, then the evidence inventory or architecture in the README. | “The recalled memories are on Walrus: observations, corrections, explicit supersession links, and learned policy records. Tatum supplies Sui Mainnet checkpoint truth and the current object version and digest. The gate budgets at most two Tatum reads per answer and fails closed if either verification read is missing or invalid.” |
| 2:18–2:38 | Scroll to “What the gate prevented.” Hold on the three large figures. | “The committed ledger contains 306 recorded decisions. Without the gate, 214 changed memories could have answered, 16 unchanged-but-old memories would have been treated as answers, and 4 unverified records would have escaped. The gated path answers only what it proves fresh.” |
| 2:38–2:53 | Open the evidence records briefly, then return to the homepage. | “The proof is inspectable: blob IDs, checkpoint stamps, lineage, request metadata, and the latest decisions stay in the page. The offline page makes no browser requests, and the exported copy is scanned for secret values.” |
| 2:53–3:00 | Return to the hero and stop on “A stale memory is not an answer.” | “The honest limits remain visible: the live CLI is not yet verified end to end, retention is unknown, and the later 40,000 window was not persisted. A stale memory is not an answer.” |

## Recording notes

- Aim for 2:55–3:05; pause on the numbers rather than speaking faster.
- Keep the offline/read-only labels in frame whenever a Mainnet claim is discussed.
- Do not say that the historical later event recalled the correction blob; it recalled a
  proof-equivalent observation.
- Do not say every learned value was persisted. The stored SLOW policy is 20,000; a later learned
  40,000 value was not persisted.
- Do not claim the live installable CLI is verified. If the owner later grants permission for a
  separate live read-only run, treat that footage as an optional appendix and show `read_only: true`
  and `writes: []` on screen.
- Do not use the older hosted homepage as evidence for the current local milestone until the owner
  separately approves a push and deployment.
