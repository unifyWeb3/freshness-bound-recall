// RecallGuard evidence page — the recorded Mainnet evidence, labelled honestly.

import { GITHUB_REPO, esc, short, fmtTime, fmtAge, shell } from "./layout.mjs";
import { selectRecordedRevisionLifecycle } from "../../src/recorded-lifecycle.mjs";
import { computeAblation } from "./ablation.mjs";
import { comparePolicyWindows, recordedPolicyEffect } from "../../src/policy-effect.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../../src/tatum.mjs";

const REPO_SNAPSHOT = `${GITHUB_REPO}/blob/main/docs/evidence/proof-snapshot.json`;

function featuredDecision(snapshot) {
  return (snapshot.ledger || []).filter((entry) => (
    entry.verdict === "STALE" &&
    entry.memory?.claim?.includes("sui-clock") &&
    entry.pin?.version &&
    String(entry.reason || "").startsWith("subject changed")
  )).at(-1) || null;
}

function correctionList(memories) {
  const byId = new Map();
  for (const memory of memories || []) {
    if (memory.blob_id) byId.set(memory.blob_id, memory);
    if (memory.claim) byId.set(memory.claim, memory);
  }
  const pairs = (memories || [])
    .filter((memory) => memory.claim?.startsWith("cor-") && memory.supersedes)
    .map((correction) => ({
      correction,
      observation: byId.get(correction.supersedes_ref) || byId.get(correction.supersedes),
    }))
    .filter(({ observation }) => observation?.state === "observation")
    .sort((a, b) => Number(b.correction.proof?.checkpoint_seq || 0) - Number(a.correction.proof?.checkpoint_seq || 0));

  if (!pairs.length) return `<p class="muted">No connected observation and correction records were captured.</p>`;
  return `<ol class="correction-list">${pairs.map(({ observation, correction }) => `
    <li class="correction-row">
      <article class="record old-record">
        <span class="record-kind">Recalled observation</span>
        <strong><code>${esc(observation.claim)}</code></strong>
        <span>Version <code>${esc(observation.proof?.object_version ?? "—")}</code></span>
        <span>Checkpoint <code>${esc(observation.proof?.checkpoint_seq ?? "—")}</code></span>
      </article>
      <span class="correction-arrow" aria-hidden="true">→</span>
      <article class="record corrected-record">
        <span class="record-kind">Recorded correction</span>
        <strong><code>${esc(correction.claim)}</code></strong>
        <span>Version <code>${esc(correction.proof?.object_version ?? "—")}</code></span>
        <span>Checkpoint <code>${esc(correction.proof?.checkpoint_seq ?? "—")}</code></span>
      </article>
    </li>`).join("")}</ol>`;
}

export function evidencePage(snapshot) {
  const memories = snapshot.memories || [];
  const ledger = snapshot.ledger || [];
  const live = snapshot.mode === "live";
  const cp = snapshot.checkpoint || {};
  const cpReadAt = cp.read_at ?? cp.readAt;
  const renderedAt = snapshot.exported_at || snapshot.served_at || Date.now();
  const evidenceAge = fmtAge(snapshot.generated_at, renderedAt);
  const checkpointAge = fmtAge(cpReadAt, renderedAt);
  const lifecycle = selectRecordedRevisionLifecycle(snapshot);
  const persistenceDelay = Date.parse(lifecycle.correction.created_at) - Date.parse(lifecycle.correction.recorded_at);
  const policyEffect = recordedPolicyEffect(snapshot);
  const storedSlowPolicy = memories.find((memory) => (
    memory.predicate === "policy_window" &&
    memory.class === "SLOW" &&
    Number(memory.policy?.window) === 20000
  ));
  const policyComparison = comparePolicyWindows(policyEffect, { newWindow: Number(storedSlowPolicy?.policy?.window ?? 20000) });
  const policyDelta = Number(policyEffect.event.live.checkpoint_seq) - Number(policyEffect.record["proof.checkpoint_seq"]);

  const decisionRows = ledger.filter((e) => e.verdict).slice(-40).reverse().map((e) => `
    <tr>
      <td>${esc(fmtTime(e.at))}</td>
      <td>${esc(e.type || "answer")}</td>
      <td><code>${esc(short(e.query, 34))}</code></td>
      <td><span class="verdict ${e.verdict === "FRESH" ? "verdict-fresh" : "verdict-withheld"}">${esc(e.verdict)}</span></td>
      <td>${esc(e.signal || "—")}</td>
      <td class="muted">${esc(e.reason || "")}</td>
      <td><code>${esc(e.live?.checkpoint_seq ?? "—")}</code></td>
      <td><code>${esc(e.memory?.proof_at_write?.checkpoint_seq ?? "—")}</code></td>
    </tr>`).join("");

  const memoryRows = memories.map((m) => `
    <tr>
      <td><code title="${esc(m.blob_id)}">${esc(short(m.blob_id, 12))}</code></td>
      <td><code>${esc(m.claim)}</code></td>
      <td><span class="mono-tag" style="color:var(--muted)">${esc(m.class)}</span></td>
      <td>${esc(m.state)}</td>
      <td><code title="${esc(m.subject)}">${esc(short(m.subject, 10))}</code></td>
      <td><code>${esc(m.proof?.checkpoint_seq ?? "—")}</code></td>
      <td><code>${esc(m.proof?.object_version ?? "—")}</code></td>
      <td><code title="${esc(m.proof?.object_digest)}">${esc(short(m.proof?.object_digest, 12))}</code></td>
      <td class="muted">${esc(fmtTime(m.proof?.read_at))}</td>
    </tr>`).join("");

  const tatumRows = (snapshot.tatum_log || []).slice().reverse().slice(0, 30).map((r) => `
    <tr>
      <td>${esc(fmtTime(r.at))}</td>
      <td><code>${esc(r.label)}</code></td>
      <td>${esc(r.status)}</td>
      <td>${esc(r.latency_ms)} ms</td>
      <td><code>${esc(r.plan ?? "—")}</code></td>
      <td>${r.api_key_sent === true ? '<span class="mono-tag">header sent</span>' : (r.api_key_sent === false ? '<span class="mono-tag verdict-withheld">not sent</span>' : '<span class="muted">—</span>')}</td>
      <td class="muted">${esc(r.error || "")}</td>
    </tr>`).join("");
  const keyProof = snapshot.tatum_api_key_proof || null;

  const policyCards = Object.entries(snapshot.policy || {}).map(([cls, p]) => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;gap:12px"><span>${esc(cls)} window</span><strong class="mono-tag">${esc(p.windowCheckpoints)} checkpoints</strong></div>
      <p class="muted" style="margin:8px 0 0">bounds ${esc(p.minCheckpoints)} … ${esc(p.maxCheckpoints)} · version ${esc(p.version)} · samples ${esc(p.samples)} (actionable ${esc(p.actionableSamples ?? 0)})</p>
      <p class="muted" style="margin:4px 0 0">FALSE-STALE ${esc(p.falseStale)} · MISSED-CHANGE ${esc(p.missedChange)}</p>
      <p class="reason">${esc(p.lastReason || "initial")}</p>
    </div>`).join("");

  const ablationSummary = computeAblation(snapshot);
  const ablationRows = ablationSummary.rows.map((r) => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${r.from_memory}</td>
      <td>${r.from_live}</td>
      <td>${r.withheld}</td>
      <td>${r.reads}</td>
      <td class="${r.changed_answers > 0 ? "verdict-withheld" : ""}"><strong>${r.changed_answers}</strong></td>
      <td>${r.still_true_old_answers}</td>
      <td>${r.unverified_answers}</td>
      <td class="muted">${esc(r.note)}</td>
    </tr>`).join("");

  const subjectCards = Object.values(snapshot.subjects || {}).map(({ subject, pin, error }) => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;gap:12px"><span>${esc(subject.label)}</span><span class="mono-tag" style="color:var(--muted)">${esc(subject.class)}</span></div>
      <p class="muted" style="margin:8px 0 0">Subject <code>${esc(subject.address)}</code></p>
      ${error ? `<p class="verdict-withheld" style="margin:8px 0 0">${esc(error)}</p>` : `
        <div class="kv"><span>Version</span><code>${esc(pin.version)}</code></div>
        <div class="kv"><span>Digest</span><code title="${esc(pin.digest)}">${esc(short(pin.digest, 18))}</code></div>
        <div class="kv"><span>Read at</span><code>${esc(fmtTime(pin.readAt ?? pin.read_at))}</code></div>`}
    </div>`).join("");

  const totalDecisions = ablationSummary.total;
  const changed = ablationSummary.rows[1]?.changed_answers ?? 0;
  const unchangedOld = ablationSummary.rows[1]?.still_true_old_answers ?? 0;
  const unverified = ablationSummary.rows[1]?.unverified_answers ?? 0;
  const bundle = `
  <section aria-labelledby="labels-title">
    <p class="eyebrow">Labels for every number on this page</p>
    <div class="grid" role="list" style="margin-top:12px">
      <article class="card" role="listitem"><h3>Recorded evidence</h3><p class="secondary" style="font-size:13px">Blob ids, checkpoints, revisions and the 306 decisions captured from Mainnet by the observer at capture time. This page renders that labelled snapshot; Walrus blob integrity proves existence, not current truth.</p></article>
      <article class="card" role="listitem"><h3>Offline replay</h3><p class="secondary" style="font-size:13px">The STALE → FRESH → STALE sequence and the policy-window comparison are deterministic replays of the recorded inputs. They prove the gate logic on real evidence, not a new Mainnet observation.</p></article>
      <article class="card" role="listitem"><h3>Live verification</h3><p class="secondary" style="font-size:13px">Implemented via Tatum Sui Mainnet GraphQL reads. <strong>Unverified end-to-end in this release</strong>: no committed transcript runs the installable CLI against Mainnet with real credentials.</p></article>
      <article class="card" role="listitem"><h3>Modelled counterfactual</h3><p class="secondary" style="font-size:13px">The 214 / 16 / 4 outcome split is an analysis of the recorded decision log — not production incidents, not user impact, not a market claim.</p></article>
    </div>
  </section>
`;

  const body = `
  <section class="hero-grid" style="grid-template-columns:minmax(0,1fr);padding-bottom:8px" aria-labelledby="evidence-title">
    <div>
      <p class="eyebrow">Evidence</p>
      <h1 id="evidence-title">Proof, not promises</h1>
      <p class="hero-intro">Everything on this page comes from the committed, labelled snapshot captured from Mainnet: 22 memory blobs, checkpoint stamps, revision lineage, and the captured Tatum request metadata. Read it as evidence about the recording — not as a claim that any fact is still true.</p>
      <div class="snapshot-bar" style="border-bottom:0;border-top:1px solid var(--hairline);margin-top:18px;padding-bottom:0">
        <span class="status status-snapshot">${snapshot.exported_at ? "CACHED SNAPSHOT · STATIC EXPORT · NETWORK OFF" : live ? `LIVE EVIDENCE · FETCHED ${esc(fmtTime(snapshot.generated_at))}` : "CACHED SNAPSHOT · NETWORK OFF"}</span>
        <span class="snapshot-note">chain <code>${esc(snapshot.chain_id || SUI_MAINNET_CHAIN_ID)}</code> · generated <code>${esc(fmtTime(snapshot.generated_at))}</code>${snapshot.exported_at ? ` · exported <code>${esc(fmtTime(snapshot.exported_at))}</code>` : ""}</span>
      </div>
    </div>
  </section>

  ${bundle}

  <section class="section" aria-labelledby="decision-title">
    <p class="eyebrow">The decision that did not escape</p>
    <h2 id="decision-title">Memory recalled, evidence disagreed, answer withheld</h2>
    <div class="card" style="margin-top:14px">
      <div class="checkpoint-rail" aria-label="Verification checkpoints" style="position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:18px">
        <span class="rail-stop">question</span>
        <span class="rail-stop">memory cp ${esc(decisionSafe(featuredDecision(snapshot)?.memory?.proof_at_write?.checkpoint_seq))}</span>
        <span class="rail-stop gate-stop">freshness gate</span>
        <span class="rail-stop">live cp ${esc(decisionSafe(featuredDecision(snapshot)?.live?.checkpoint_seq))}</span>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))">
        <div><p class="muted">Question</p><p style="margin:4px 0 0;font-size:14px">Is the Sui Clock still at the recorded version?</p></div>
        <div><p class="muted">Recalled memory</p><p style="margin:4px 0 0;font-size:14px"><code>${esc(featuredDecision(snapshot)?.memory?.claim ?? "—")}</code><br><span class="muted">version ${esc(featuredDecision(snapshot)?.memory?.proof_at_write?.object_version ?? "—")}</span></p></div>
        <div><p class="muted">Gate verdict</p><p class="verdict-withheld" style="margin:4px 0 0;font-size:20px;font-weight:600">WITHHELD</p></div>
        <div><p class="muted">Verified live value</p><p style="margin:4px 0 0;font-size:14px">version <code>${esc(featuredDecision(snapshot)?.pin?.version ?? "—")}</code><br><span class="muted">cp ${esc(featuredDecision(snapshot)?.live?.checkpoint_seq ?? "—")} · ${esc(fmtTime(featuredDecision(snapshot)?.pin?.read_at))}</span></p></div>
      </div>
      <p class="reason" style="margin-top:14px">${esc(featuredDecision(snapshot)?.reason ?? "The recalled proof could not be verified as fresh.")}</p>
    </div>
    <div class="grid" style="margin-top:14px">
      <div class="card"><span class="muted">Captured source</span><br><code>${esc(cp.source ?? snapshot.mode ?? "—")}</code></div>
      <div class="card"><span class="muted">Pins at snapshot</span><br><code>${Object.keys(snapshot.subjects || {}).length}</code></div>
      <div class="card"><span class="muted">Requests in snapshot</span><br><code>${(snapshot.tatum_log || []).length}</code></div>
      <div class="card"><span class="muted">Evidence captured</span><br><code>${esc(fmtTime(snapshot.generated_at))}</code></div>
      <div class="card"><span class="muted">Static export</span><br><code>${snapshot.exported_at ? esc(fmtTime(snapshot.exported_at)) : "not exported"}</code></div>
      <div class="card"><span class="muted">Snapshot age at render</span><br><code>${esc(evidenceAge)}</code></div>
    </div>
  </section>

  <section class="section" id="learning-loop" aria-labelledby="learning-title">
    <p class="eyebrow">Recorded learning loop</p>
    <h2 id="learning-title">A policy memory changed the verdict</h2>
    <p class="section-copy">The same recorded inputs replayed under two policies. Only the freshness window changes: built-in default vs. the window read from Walrus policy memory.</p>
    <div class="card" style="margin-top:14px">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">
        <div><span class="muted">Walrus policy memory</span><p style="margin:4px 0 0"><code>${esc(storedSlowPolicy?.claim ?? "fc-policy-SLOW-v2")}</code> — learned 10,000 → 20,000</p><code class="muted">${esc(storedSlowPolicy?.blob_id ?? "")}</code></div>
        <div><span class="muted">Observation under test</span><p style="margin:4px 0 0"><code>${esc(policyEffect.memory.claim)}</code> — checkpoint ${esc(policyEffect.record["proof.checkpoint_seq"])}</p><code class="muted">${esc(policyEffect.memory.blob_id)}</code></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));margin-top:14px">
        <div style="border:1px solid var(--hairline);border-radius:12px;padding:18px;background:var(--raised)"><span class="muted">Without stored policy · default 5,000</span><br><strong style="font-size:22px;display:block;margin-top:6px">${esc(policyComparison.oldPolicy.verdict)} · ${esc(policyComparison.oldPolicy.signal)}</strong><span class="muted">${esc(policyComparison.oldPolicy.reason)}</span></div>
        <div style="border:1px solid var(--hairline-strong);border-radius:12px;padding:18px;background:var(--card)"><span class="muted">With Walrus policy memory · 20,000</span><br><strong style="font-size:22px;display:block;margin-top:6px">${esc(policyComparison.newPolicy.verdict)} · ${esc(policyComparison.newPolicy.signal)}</strong><span class="muted">${esc(policyComparison.newPolicy.reason)}</span></div>
      </div>
      <p class="policy-disclosure secondary" style="margin-top:14px;font-size:13px">Identical inputs: anchor checkpoint <code>${esc(policyEffect.record["proof.checkpoint_seq"])}</code>, decision checkpoint <code>${esc(policyEffect.event.live.checkpoint_seq)}</code>, delta <code>${esc(policyDelta.toLocaleString("en-US"))}</code>, unchanged subject pin. Learned at <code>${esc(fmtTime(policyEffect.event.at))}</code>, written to Walrus later at <code>${esc(fmtTime(storedSlowPolicy?.recorded_at))}</code>; not backdated. This is deterministic policy evaluation, not autonomous learning.</p>
    </div>
  </section>

  <section class="section" aria-labelledby="comparison-title">
    <p class="eyebrow">Recorded outcome split</p>
    <h2 id="comparison-title">What the gate prevented</h2>
    <p class="section-copy">Over the committed 306-decision snapshot. Modeled counterfactual analysis of recorded Mainnet decisions — not production incidents.</p>
    <div class="grid" role="list" style="margin-top:14px">
      <div class="card" role="listitem"><span class="split-number" style="display:block;font:500 34px/1 ui-monospace,monospace;color:var(--amber)">${changed}</span><span class="secondary" style="font-size:13px">changed answers an ungated path would have served</span></div>
      <div class="card" role="listitem"><span class="split-number" style="display:block;font:500 34px/1 ui-monospace,monospace">${unchangedOld}</span><span class="secondary" style="font-size:13px">unchanged-but-old still-true answers withheld</span></div>
      <div class="card" role="listitem"><span class="split-number" style="display:block;font:500 34px/1 ui-monospace,monospace">${unverified}</span><span class="secondary" style="font-size:13px">unverifiable answers withheld</span></div>
    </div>
    <div class="scroll" tabindex="0" role="region" aria-label="Memory-off and memory-on comparison table" style="margin-top:14px"><table>
      <caption>Memory-off vs memory-on over all ${totalDecisions} recorded decisions</caption>
      <thead><tr><th scope="col">configuration</th><th scope="col">from memory</th><th scope="col">from live</th><th scope="col">withheld</th><th scope="col">Tatum reads</th><th scope="col">changed answers</th><th scope="col">still-true old</th><th scope="col">unverified</th><th scope="col">note</th></tr></thead>
      <tbody>${ablationRows || '<tr><td colspan="9" class="muted">No ablation rows captured.</td></tr>'}</tbody>
    </table></div>
  </section>

  <section class="section" aria-labelledby="corrections-title">
    <p class="eyebrow">Lineage</p>
    <h2 id="corrections-title">Observation → correction chain</h2>
    <p class="section-copy">Both records remain addressable; Walrus records are immutable, so corrections supersede rather than overwrite.</p>
    <div style="margin-top:14px">${correctionList(memories)}</div>
    <div class="card" style="margin-top:14px"><span class="muted">Revision lifecycle replay (deterministic)</span><p style="margin:4px 0 0;font-size:14px"><code>STALE → FRESH → STALE</code></p><p class="muted" style="margin:6px 0 0">predecessor persisted ${esc(persistenceDelay.toLocaleString("en-US"))} ms before the correction's proof; first later check ${esc((Date.parse(lifecycle.laterEvent.at) - Date.parse(lifecycle.correction.created_at)).toLocaleString("en-US"))} ms after persistence</p></div>
  </section>

  <section class="section" aria-labelledby="pins-title">
    <p class="eyebrow">Snapshot</p>
    <h2 id="pins-title">Pins and policy memories</h2>
    <p class="section-copy">Subject versions and digests recorded alongside the evidence. Checkpoint age at render: <code>${esc(checkpointAge)}</code>.</p>
    <div class="grid" style="margin-top:14px">${subjectCards || '<p class="muted">No subject data captured.</p>'}</div>
    <div class="grid" style="margin-top:14px">${policyCards || '<p class="muted">No policy memories captured.</p>'}</div>
  </section>

  <section class="section" aria-labelledby="records-title">
    <p class="eyebrow">Inventories</p>
    <h2 id="records-title">Every blob, every decision</h2>
    <details style="margin-top:14px">
      <summary><span>Memory inventory</span><span class="details-meta">${memories.length} captured records</span></summary>
      <div class="details-content"><div class="scroll" tabindex="0" role="region" aria-label="Memory inventory table"><table>
        <caption>Walrus Memory blob identifiers and checkpoint stamps</caption>
        <thead><tr><th scope="col">Blob</th><th scope="col">Claim</th><th scope="col">Class</th><th scope="col">State</th><th scope="col">Subject</th><th scope="col">Proof cp</th><th scope="col">Object version</th><th scope="col">Object digest</th><th scope="col">Read at</th></tr></thead>
        <tbody>${memoryRows || '<tr><td colspan="9" class="muted">No memories captured.</td></tr>'}</tbody>
      </table></div></div>
    </details>
    <details>
      <summary><span>Latest 40 of ${totalDecisions} decisions</span><span class="details-meta">Open ledger</span></summary>
      <div class="details-content">
        <p class="muted">Complete ledger in the <a href="${REPO_SNAPSHOT}" rel="noopener">full proof snapshot</a>.</p>
        <div class="scroll" tabindex="0" role="region" aria-label="Latest decision ledger table"><table>
          <caption>Latest 40 of ${totalDecisions} decisions</caption>
          <thead><tr><th scope="col">At</th><th scope="col">Kind</th><th scope="col">Query</th><th scope="col">Verdict</th><th scope="col">Signal</th><th scope="col">Reason</th><th scope="col">Live cp</th><th scope="col">Proof cp</th></tr></thead>
          <tbody>${decisionRows || '<tr><td colspan="8" class="muted">No decisions recorded.</td></tr>'}</tbody>
        </table></div>
      </div>
    </details>
    <details>
      <summary><span>Tatum request metadata</span><span class="details-meta">${(snapshot.tatum_log || []).length} captured entries</span></summary>
      <div class="details-content">
        ${keyProof ? `<div class="card" style="margin-bottom:12px"><div class="kv"><span>x-api-key on every request</span><code>${esc(keyProof.requests_with_api_key)}/${esc(keyProof.total_log_entries)} entries · ${keyProof.every_request_had_api_key ? "every request carried the header" : "incomplete — see log"}</code></div><div class="kv"><span>Key value</span><code>never printed; boolean proof only</code></div></div>` : `<p class="muted">API-key proof was not recorded in this snapshot.</p>`}
        <div class="scroll" tabindex="0" role="region" aria-label="Tatum request log table"><table>
          <caption>Latest ${Math.min(30, (snapshot.tatum_log || []).length)} captured request log entries</caption>
          <thead><tr><th scope="col">At</th><th scope="col">Query</th><th scope="col">Status</th><th scope="col">Latency</th><th scope="col">x-ttm-plan</th><th scope="col">x-api-key</th><th scope="col">Error</th></tr></thead>
          <tbody>${tatumRows || '<tr><td colspan="7" class="muted">No requests captured.</td></tr>'}</tbody>
        </table></div>
      </div>
    </details>
    ${snapshot.relayer ? `<details>
      <summary><span>Relayer record</span></summary>
      <div class="details-content"><div class="card"><div class="kv"><span>Status</span><code>${esc(snapshot.relayer.status)}</code></div><div class="kv"><span>Version</span><code>${esc(snapshot.relayer.version)}</code></div><div class="kv"><span>Mode</span><code>${esc(snapshot.relayer.mode)}</code></div><div class="kv"><span>Write ready</span><code>${esc(snapshot.relayer.write_ready)}</code></div></div></div>
    </details>` : ""}
  </section>
`;

  return shell({
    title: "RecallGuard evidence · recorded Sui Mainnet proof",
    description: "Labelled Mainnet evidence behind RecallGuard: 22 Walrus memory blobs, checkpoint stamps, revision lineage, the learned-policy replay, and the captured Tatum request log. Recorded, offline replay, live and modelled — labelled as such.",
    active: "/evidence.html",
    path: "/evidence.html",
    body,
  });
}

function decisionSafe(value) {
  return value ?? "—";
}
