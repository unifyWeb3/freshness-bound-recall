// RecallGuard homepage — the five-second answer first.

import { GITHUB_REPO, esc, short, fmtTime, shell } from "./layout.mjs";
import { selectRecordedRevisionLifecycle } from "../../src/recorded-lifecycle.mjs";
import { comparePolicyWindows, recordedPolicyEffect } from "../../src/policy-effect.mjs";
import { computeAblation } from "./ablation.mjs";

const REPO_SNAPSHOT = `${GITHUB_REPO}/blob/main/docs/evidence/proof-snapshot.json`;

function featuredDecision(snapshot) {
  return (snapshot.ledger || []).filter((entry) => (
    entry.verdict === "STALE" &&
    entry.memory?.claim?.includes("sui-clock") &&
    entry.pin?.version &&
    String(entry.reason || "").startsWith("subject changed")
  )).at(-1) || null;
}

export function homePage(snapshot) {
  const lifecycle = selectRecordedRevisionLifecycle(snapshot);
  const decision = featuredDecision(snapshot);
  const policyEffect = recordedPolicyEffect(snapshot);
  const storedSlowPolicy = (snapshot.memories || []).find((memory) => (
    memory.predicate === "policy_window" &&
    memory.class === "SLOW" &&
    Number(memory.policy?.window) === 20000
  ));
  const policyComparison = comparePolicyWindows(policyEffect, { newWindow: Number(storedSlowPolicy?.policy?.window ?? 20000) });
  const ablationSummary = computeAblation(snapshot);
  const changed = ablationSummary.rows[1]?.changed_answers ?? 0;
  const unchangedOld = ablationSummary.rows[1]?.still_true_old_answers ?? 0;
  const unverified = ablationSummary.rows[1]?.unverified_answers ?? 0;

  const rememberedVersion = decision?.memory?.proof_at_write?.object_version ?? "—";
  const rememberedCheckpoint = decision?.memory?.proof_at_write?.checkpoint_seq ?? "—";
  const verifiedVersion = decision?.pin?.version ?? "—";
  const verifiedCheckpoint = decision?.live?.checkpoint_seq ?? "—";
  const persistenceDelay = Date.parse(lifecycle.correction.created_at) - Date.parse(lifecycle.correction.recorded_at);

  // Interactive demonstration payload: the recorded revision lifecycle, embedded
  // so the stepper works with no network access.
  const demoData = {
    predecessor: {
      claim: lifecycle.predecessor.claim,
      blob_id: lifecycle.predecessor.blob_id,
      checkpoint: lifecycle.predecessor.proof.checkpoint_seq,
      version: lifecycle.predecessor.proof.object_version,
    },
    correction: {
      claim: lifecycle.correction.claim,
      blob_id: lifecycle.correction.blob_id,
      checkpoint: lifecycle.correction.proof.checkpoint_seq,
      version: lifecycle.correction.proof.object_version,
      supersedes_ref: lifecycle.storedReference,
      resolved_blob_id: lifecycle.resolvedBlobId,
      persistence_delay_ms: persistenceDelay,
    },
    verification: decision ? {
      stored_version: rememberedVersion,
      stored_checkpoint: rememberedCheckpoint,
      verified_version: verifiedVersion,
      verified_checkpoint: verifiedCheckpoint,
      verdict: "WITHHELD",
      reason: decision.reason || "subject changed",
    } : null,
  };

  const body = `
  <section class="hero-grid" aria-labelledby="hero-title">
    <div>
      <p class="eyebrow">AI-agent memory · verification layer</p>
      <h1 id="hero-title">Your agent remembers.<br>RecallGuard checks whether it&rsquo;s still true.</h1>
      <p class="hero-intro">AI agents reuse remembered facts after the onchain world has moved. RecallGuard gates every Walrus-backed recall against current Sui state through Tatum Sui Mainnet GraphQL. Changed or unverifiable claims are withheld &mdash; the verified value is used instead.</p>
      <div class="hero-actions">
        <a class="button button-primary" href="/mcp.html">Add it to your agent via MCP</a>
        <a class="button" href="#try-it">Run the 60-second replay</a>
      </div>
      <p class="muted" style="margin-top:14px">Read-only by default · no wallet required · fail-closed · no LLM in the answer path</p>
    </div>
    <figure class="card" style="margin:0" aria-label="Recorded WITHHELD decision">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px"><span class="mono-tag" style="color:var(--muted)">RECORDED MAINNET DECISION</span><span class="pill pill-accent">WITHHELD</span></div>
      <dl class="kv-list">
        <div><dt class="muted">Recalled memory claims</dt><dd style="margin:2px 0 0"><code>${esc(decision?.memory?.claim ?? "cor-sui-clock-341742463")}</code></dd></div>
        <div><dt class="muted">Stored proof</dt><dd style="margin:2px 0 0"><code>version ${esc(rememberedVersion)} · checkpoint ${esc(rememberedCheckpoint)}</code></dd></div>
        <div><dt class="muted">Tatum verification shows</dt><dd style="margin:2px 0 0"><code>version ${esc(verifiedVersion)} · checkpoint ${esc(verifiedCheckpoint)}</code></dd></div>
        <div><dt class="muted">Decision</dt><dd style="margin:2px 0 0"><strong class="verdict-withheld">WITHHELD</strong> — the old memory was not used as the answer</dd></div>
      </dl>
      <p class="muted" style="margin:12px 0 0">Full evidence, blob ids and the decision ledger live on the <a href="/evidence.html">evidence page</a>.</p>
    </figure>
  </section>

  <section class="section" aria-labelledby="how-title">
    <p class="eyebrow">How it works</p>
    <h2 id="how-title">One gate between recall and action</h2>
    <div class="grid" role="list" style="margin-top:18px">
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">01 · RECALL</p><h3>Agent remembers</h3><p class="secondary" style="font-size:13px;margin:8px 0 0">The agent recalls a Walrus-backed memory with its FR-v1 proof envelope: checkpoint, object version and digest at write time.</p></article>
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">02 · VERIFY</p><h3>Tatum checks Sui</h3><p class="secondary" style="font-size:13px;margin:8px 0 0">One cached checkpoint read and one subject pin read through Tatum&rsquo;s Sui Mainnet GraphQL. At most two reads per answer, ever.</p></article>
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">03 · DECIDE</p><h3>Gate decides</h3><p class="secondary" style="font-size:13px;margin:8px 0 0">Checkpoint window ∧ object version/digest pin ∧ wall-clock backstop. Any missing or malformed proof fails closed: WITHHELD_UNVERIFIED.</p></article>
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">04 · CORRECT</p><h3>Correction supersedes</h3><p class="secondary" style="font-size:13px;margin:8px 0 0">When the pin changed, a correction memory supersedes the old record with explicit <code>supersedes</code> lineage. Later recalls use the corrected memory.</p></article>
    </div>
  </section>

  <section class="section" id="try-it" aria-labelledby="demo-title">
    <p class="eyebrow">Interactive demonstration</p>
    <h2 id="demo-title">Watch a stale memory become a withheld answer</h2>
    <p class="section-copy">This replays the recorded Mainnet lifecycle with the real blob ids and checkpoints. No network calls, no credentials, no writes.</p>

    <div class="card" style="margin-top:18px" id="demo">
      <div role="tablist" aria-label="Demonstration steps" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px" id="demo-tabs"></div>
      <div id="demo-panel" aria-live="polite" style="min-height:190px;border:1px solid var(--hairline);border-radius:10px;padding:18px;background:var(--bg)"></div>
      <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
        <button class="button" type="button" id="demo-prev" aria-label="Previous step">← Back</button>
        <button class="button button-primary" type="button" id="demo-next" aria-label="Next step">Next →</button>
        <span class="muted" id="demo-progress" style="margin-left:auto"></span>
      </div>
    </div>
    <script type="application/json" id="demo-data">${JSON.stringify(demoData).replace(/</g, "\\u003c")}</script>
    <script>
      (function () {
        var data = JSON.parse(document.getElementById("demo-data").textContent);
        var steps = [
          { label: "1 · Recalled claim", html: '<p class="mono-tag" style="color:var(--muted)">AGENT RECALLS FROM WALRUS MEMORY</p><p style="font-size:17px;margin:10px 0 12px"><code>' + data.predecessor.claim + '</code></p><p class="secondary" style="margin:0">Claim: the Sui Clock was at this version when it was recorded.<br>Blob <code>' + data.predecessor.blob_id + '</code><br>Proof: checkpoint <code>' + data.predecessor.checkpoint + '</code> · version <code>' + data.predecessor.version + '</code></p>' },
          { label: "2 · Tatum verification", html: '<p class="mono-tag" style="color:var(--muted)">TATUM SUI MAINNET GRAPHQL · CURRENT PIN</p><p style="font-size:17px;margin:10px 0 12px">The subject moved on.</p><p class="secondary" style="margin:0">Stored proof says version <code>' + data.verification.stored_version + '</code> at checkpoint <code>' + data.verification.stored_checkpoint + '</code><br>Live pin reads version <code>' + data.verification.verified_version + '</code> at checkpoint <code>' + data.verification.verified_checkpoint + '</code></p>' },
          { label: "3 · Gate verdict", html: '<p class="mono-tag" style="color:var(--muted)">FRESHNESS GATE</p><p class="verdict-withheld" style="font-size:28px;font-weight:600;letter-spacing:-.02em;margin:10px 0 12px">WITHHELD</p><p class="secondary" style="margin:0">' + data.verification.reason + ' — the remembered value was <strong>not</strong> returned as current fact. The agent reports the verified live value instead.</p>' },
          { label: "4 · Correction", html: '<p class="mono-tag" style="color:var(--muted)">CORRECTION SUPERSEDES THE OLD MEMORY</p><p style="font-size:17px;margin:10px 0 12px"><code>' + data.correction.claim + '</code></p><p class="secondary" style="margin:0">Blob <code>' + data.correction.blob_id + '</code><br><code>supersedes</code> → <code>' + (data.correction.supersedes_ref || "unresolved") + '</code><br>Resolved predecessor <code>' + (data.correction.resolved_blob_id || "unknown") + '</code><br>Persisted ' + data.correction.persistence_delay_ms.toLocaleString("en-US") + ' ms after proof</p>' },
          { label: "5 · Next interaction", html: '<p class="mono-tag" style="color:var(--muted)">THE AGENT NOW BEHAVES DIFFERENTLY</p><p style="font-size:17px;margin:10px 0 12px">STALE → FRESH → STALE</p><p class="secondary" style="margin:0">At the correction&rsquo;s proof: <strong>FRESH</strong> — the corrected memory answers.<br>At the first later Mainnet check: <strong>STALE</strong> — withheld again after the subject changed.<br>The answer changes because the memory, not the prompt, changed.</p>' }
        ];
        var i = 0;
        var tabs = document.getElementById("demo-tabs");
        var panel = document.getElementById("demo-panel");
        var prev = document.getElementById("demo-prev");
        var next = document.getElementById("demo-next");
        var progress = document.getElementById("demo-progress");
        function render() {
          panel.innerHTML = steps[i].html;
          progress.textContent = (i + 1) + " / " + steps.length;
          prev.disabled = i === 0;
          next.disabled = i === steps.length - 1;
          prev.style.opacity = i === 0 ? .5 : 1;
          next.style.opacity = i === steps.length - 1 ? .5 : 1;
          Array.prototype.forEach.call(tabs.children, function (tab, n) {
            tab.setAttribute("aria-selected", n === i ? "true" : "false");
            tab.className = "button" + (n === i ? " button-primary" : "");
            tab.style.minHeight = "36px";
            tab.style.padding = "6px 12px";
            tab.style.fontSize = "12px";
          });
        }
        steps.forEach(function (step, n) {
          var tab = document.createElement("button");
          tab.type = "button";
          tab.textContent = step.label;
          tab.setAttribute("role", "tab");
          tab.addEventListener("click", function () { i = n; render(); });
          tabs.appendChild(tab);
        });
        prev.addEventListener("click", function () { if (i > 0) { i -= 1; render(); } });
        next.addEventListener("click", function () { if (i < steps.length - 1) { i += 1; render(); } });
        panel.addEventListener("keydown", function (event) {
          if (event.key === "ArrowLeft" && i > 0) { i -= 1; render(); }
          if (event.key === "ArrowRight" && i < steps.length - 1) { i += 1; render(); }
        });
        render();
      })();
    </script>
    <p class="muted" style="margin-top:12px">Labels: steps 1–4 replay recorded Mainnet evidence; step 5 is the deterministic sequence from the recorded lifecycle sample (<code>npm run recall:checked -- --sample sui-clock-revision-lifecycle</code>).</p>
  </section>

  <section class="section" id="try-command-block" aria-labelledby="sixty-title">
    <p class="eyebrow">60-second quickstart</p>
    <h2 id="sixty-title">Run the same replay yourself</h2>
    <div class="command-card" style="margin-top:14px;max-width:760px">
      <div class="command-head"><span>Terminal · no credentials, no network</span><button class="copy-button" type="button" data-copy-target="quickstart">Copy</button></div>
      <pre><code id="quickstart">git clone https://github.com/unifyWeb3/freshness-bound-recall
cd freshness-bound-recall
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle</code></pre>
    </div>
    <p class="muted" style="margin-top:10px">Prints <code>STALE → FRESH → STALE</code> with the real blob ids and checkpoints. See <a href="/docs.html">docs</a> for CLI flags, the JavaScript API and MCP setup.</p>
    <script>
      document.querySelectorAll("[data-copy-target]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var target = document.getElementById(button.dataset.copyTarget);
          try { await navigator.clipboard.writeText(target ? target.textContent.trim() : ""); button.textContent = "Copied"; }
          catch (e) { button.textContent = "Select and copy"; }
        });
      });
    </script>
  </section>

  <section class="section" aria-labelledby="comparison-title">
    <p class="eyebrow">Why ordinary memory retrieval breaks</p>
    <h2 id="comparison-title">A vector hit is not a fresh fact</h2>
    <div class="scroll" tabindex="0" role="region" aria-label="Comparison of ordinary memory retrieval and RecallGuard" style="margin-top:14px">
      <table>
        <caption>What happens to a remembered onchain fact under each approach</caption>
        <thead><tr><th scope="col">Situation</th><th scope="col">Ordinary memory retrieval</th><th scope="col">RecallGuard</th></tr></thead>
        <tbody>
          <tr><td>Subject changed since the memory was written</td><td>Old value returned as current</td><td><code>STALE</code> · withheld; verified live value shown</td></tr>
          <tr><td>Subject unchanged, memory is old</td><td>Fixed timeout produces false staleness</td><td><code>FRESH</code> when inside the learned window (<code>FALSE-STALE</code> signal recorded)</td></tr>
          <tr><td>Change hidden inside the current window</td><td>Loose window misses the change</td><td><code>MISSED-CHANGE</code> signal recorded; window can tighten</td></tr>
          <tr><td>Proof missing, malformed, or reads fail</td><td>System guesses</td><td><code>WITHHELD_UNVERIFIED</code> — fail closed</td></tr>
          <tr><td>A correction supersedes an observation</td><td>History overwritten or disconnected</td><td>Both records kept; explicit <code>supersedes</code> lineage</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="section" aria-labelledby="integrations-title">
    <p class="eyebrow">Three surfaces, one gate</p>
    <h2 id="integrations-title">Use it from your agent, your terminal, or your code</h2>
    <div class="grid" role="list" style="margin-top:18px">
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">MCP</p><h3>MCP-native</h3><p class="secondary" style="font-size:13px">Six tools over stdio; read-only by default. Verified with Claude Code and Codex.</p><p style="margin:12px 0 0"><a href="/mcp.html">MCP setup →</a></p></article>
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">CLI</p><h3><code>recallguard</code></h3><p class="secondary" style="font-size:13px"><code>--sample sui-clock-changed</code> replays recorded Mainnet evidence offline. <code>--live</code> reads Walrus + Tatum with your credentials; writes need <code>--allow-mainnet-writes</code>.</p><p style="margin:12px 0 0"><a href="/docs.html#cli">CLI reference →</a></p></article>
      <article class="card" role="listitem"><p class="mono-tag" style="color:var(--muted)">JAVASCRIPT API</p><h3><code>recallChecked()</code></h3><p class="secondary" style="font-size:13px">Stable <code>recall_checked/v1</code> contract. Dependency-injected store and Tatum transport; writes off unless <code>allowWrites: true</code>.</p><p style="margin:12px 0 0"><a href="/docs.html#api">API reference →</a></p></article>
    </div>
  </section>

  <section class="section" aria-labelledby="evidence-cta-title">
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap">
      <div><p class="eyebrow" style="margin-bottom:6px">Evidence, not adjectives</p><h2 id="evidence-cta-title" style="margin-bottom:6px">22 recorded Mainnet memories · 306 stamped decisions</h2><p class="section-copy" style="font-size:14px">Blob ids, checkpoint stamps, revision lineage, the learned-policy replay and the captured Tatum request log. Modeled counterfactual split: ${changed} changed answers, ${unchangedOld} unchanged-but-old, ${unverified} unverified — an analysis of recorded decisions, not production incidents.</p></div>
      <a class="button" href="/evidence.html">Inspect the evidence →</a>
    </div>
  </section>
`;

  return shell({
    title: "RecallGuard · Your agent remembers. RecallGuard checks whether it's still true.",
    description: "RecallGuard is the freshness gate for AI-agent memory: a Walrus-backed memory is checked against current Sui state through Tatum Sui Mainnet GraphQL before your agent acts on it. Stale answers are withheld.",
    active: "/index.html",
    path: "/index.html",
    body,
  });
}
