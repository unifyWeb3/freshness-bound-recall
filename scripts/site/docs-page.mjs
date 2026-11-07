// RecallGuard docs page — quickstart through limitations.

import { GITHUB_REPO, shell } from "./layout.mjs";

export function docsPage() {
  const body = `
  <section aria-labelledby="docs-title" style="padding-top:32px">
    <p class="eyebrow">Documentation</p>
    <h1 id="docs-title">Docs</h1>
    <nav aria-label="Docs sections" style="margin-top:10px"><p class="secondary" style="font-size:13px"><a href="#quickstart">Quickstart</a> · <a href="#cli">CLI</a> · <a href="#api">JavaScript API</a> · <a href="#mcp">MCP</a> · <a href="#architecture">Architecture</a> · <a href="#security">Security</a> · <a href="#troubleshooting">Troubleshooting</a> · <a href="#limitations">Limitations</a></p></nav>
  </section>

  <section class="section" id="quickstart" aria-labelledby="qs">
    <p class="eyebrow">Quickstart</p>
    <h2 id="qs">60 seconds, zero credentials</h2>
    <div class="command-card" style="margin-top:14px;max-width:860px">
      <div class="command-head"><span>Terminal · tested in a fresh clone</span><button class="copy-button" type="button" data-copy-target="qs-cmd">Copy</button></div>
      <pre><code id="qs-cmd">git clone https://github.com/unifyWeb3/freshness-bound-recall
cd freshness-bound-recall
npm install --ignore-scripts
npm run recall:checked -- --sample sui-clock-revision-lifecycle</code></pre>
    </div>
    <p class="secondary" style="margin-top:12px">Expected output (recorded Mainnet evidence, offline):</p>
    <pre><code>RecallGuard · recorded Mainnet lifecycle · read-only
STALE → FRESH → STALE
Predecessor: obs-sui-clock-341742424 · goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY · checkpoint 341742424
Correction:  cor-sui-clock-341742463 · mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY · checkpoint 341742463</code></pre>
    <p class="muted" style="margin-top:10px">Requirements: Node.js ≥ 24. No <code>.env</code>, wallet, API key or network access needed for the recorded samples.</p>
  </section>

  <section class="section" id="cli" aria-labelledby="cli-title">
    <p class="eyebrow">CLI</p>
    <h2 id="cli-title">recallguard — command reference</h2>
    <p class="secondary">Installed bins: <code>recallguard</code> (alias of <code>recall_checked</code>, the stable contract name) and <code>recallguard-mcp</code> (the MCP server). <code>recall_checked</code> remains available for compatibility.</p>
    <div class="scroll" tabindex="0" role="region" aria-label="CLI flags" style="margin-top:12px">
      <table>
        <caption><code>recall_checked [--sample &lt;name&gt;] [--query &lt;text&gt;] [--json]</code></caption>
        <thead><tr><th scope="col">Flag</th><th scope="col">Default</th><th scope="col">Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>--sample [name]</code></td><td><code>sui-clock-changed</code></td><td>Replay labelled recorded Mainnet evidence offline. Also: <code>sui-clock-revision-lifecycle</code>. Never writes. Never touches the network.</td></tr>
          <tr><td><code>--live</code></td><td>off</td><td>Recall from Walrus Memory and verify through Tatum Sui Mainnet GraphQL. Needs <code>TATUM_API_KEY</code>, <code>MEMWAL_ACCOUNT_ID</code>, <code>MEMWAL_AGENT_ID</code>, <code>MEMWAL_PRIVATE_KEY</code> (env or <code>.env</code> in cwd). Read-only. Runs a credential self-test first; refuses on failure.</td></tr>
          <tr><td><code>--allow-mainnet-writes</code></td><td>off</td><td><strong>Only with <code>--live</code>.</strong> Permits correction/policy memories to be written to Walrus. This can incur Mainnet cost; owner approval required.</td></tr>
          <tr><td><code>--query &lt;text&gt;</code></td><td>per-sample default</td><td>The claim to recall and check (≤ 512 chars).</td></tr>
          <tr><td><code>--json</code></td><td>off</td><td>Print the stable <code>recall_checked/v1</code> or <code>recall_checked_lifecycle/v1</code> JSON contract.</td></tr>
          <tr><td><code>--help</code>, <code>-h</code></td><td>—</td><td>Usage.</td></tr>
        </tbody>
      </table>
    </div>
    <p class="secondary" style="margin-top:12px">npm scripts: <code>npm run recall:checked</code> · <code>npm run mcp</code> · <code>npm run mcp:smoke</code> · <code>npm test</code> · <code>npm run audit:secrets</code> · <code>npm run export</code> · <code>npm run proof:offline</code></p>
  </section>

  <section class="section" id="api" aria-labelledby="api-title">
    <p class="eyebrow">JavaScript API</p>
    <h2 id="api-title">Stable <code>recall_checked/v1</code> contract</h2>
    <pre style="margin-top:14px"><code>import { recallChecked } from "recallguard";
import { recallCheckedSample } from "recallguard";

// Offline: replay the recorded Mainnet evidence (no credentials)
const result = await recallCheckedSample({ sample: "sui-clock-changed" });
// result.verdict === "STALE", result.withheld === true, result.writes.length === 0

// Live: inject the store and Tatum transport (see src/runtime.mjs)
const live = await recallChecked("Is the Sui Clock memory still true?", {
  store, tatum, allowWrites: false, mode: "live-mainnet",
});</code></pre>
    <p class="secondary" style="margin-top:12px">Exports: <code>recallChecked</code>, <code>recallCheckedSample</code>, <code>recallCheckedLifecycleSample</code>, <code>RECALL_CHECKED_SCHEMA</code>, <code>AVAILABLE_RECORDED_SAMPLES</code>, and <code>./core</code> (<code>src/answer.mjs</code>). Writes never happen without <code>allowWrites: true</code>. The package is ESM only; Node ≥ 24.</p>
  </section>

  <section class="section" id="mcp" aria-labelledby="mcp-link-title">
    <p class="eyebrow">MCP</p>
    <h2 id="mcp-link-title">Model Context Protocol</h2>
    <p class="secondary">Six tools over stdio, read-only by default, verified with Claude Code and Codex. Installation, tested client configuration, tool reference and troubleshooting:</p>
    <p style="margin-top:12px"><a class="button" href="/mcp.html">MCP setup →</a>&nbsp;&nbsp;<a class="button" href="${GITHUB_REPO}/blob/main/docs/mcp.md" rel="noopener">docs/mcp.md →</a></p>
  </section>

  <section class="section" id="architecture" aria-labelledby="arch-title">
    <p class="eyebrow">Architecture</p>
    <h2 id="arch-title">Deterministic, fail-closed, no LLM in the answer path</h2>
    <pre style="margin-top:14px"><code>query
  │
  ├─ recall candidate from Walrus Memory (MemWal SDK)
  │    └─ parse the FR-v1 proof envelope
  ├─ load per-class policy memory (FALSE-STALE widens · MISSED-CHANGE tightens)
  ├─ freshness gate (fail closed)
  │    ├─ latest Sui checkpoint via Tatum GraphQL     — at most 1 cached read
  │    ├─ current subject version + digest            — at most 1 read
  │    └─ wall-clock backstop
  ├─ FRESH → answer from verified memory
  └─ STALE / WITHHELD_UNVERIFIED → withhold and explain
       └─ correction write only with explicit allow-writes + approval</code></pre>
    <p class="secondary" style="margin-top:12px">The freshness window itself is a memory in Walrus Memory (<code>fc-policy-SLOW-v2</code>, blob <code>Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4</code>): the system rewrites it from observed decay. That is deterministic policy evaluation, not autonomous learning. Walrus Memory stores the memories and the revision history; Tatum Sui Mainnet GraphQL provides the current-state evidence; the gate enforces the decision. MCP exposes the same gate to agents.</p>
  </section>

  <section class="section" id="security" aria-labelledby="sec-title">
    <p class="eyebrow">Security model</p>
    <h2 id="sec-title">What is trusted, what is not</h2>
    <ul class="secondary" style="margin:14px 0 0;padding-left:20px;display:grid;gap:8px;max-width:860px">
      <li>Recalled memory content is <strong>untrusted data</strong>: it is parsed, validated against the FR-v1 schema, and never followed as instructions.</li>
      <li>Verification evidence is <strong>chain-anchored</strong>: checkpoint sequence/digest and object version/digest as read from Tatum Sui Mainnet GraphQL at answer time. Walrus proves a blob exists; it does not prove the fact is current — that is the gate&rsquo;s job.</li>
      <li>Missing, malformed or contradictory evidence fails closed: <code>WITHHELD_UNVERIFIED</code>. The system never guesses.</li>
      <li>Signatures are <strong>not</strong> verified by this release. Proof digests are compared as data; there is no cryptographic attestation claim.</li>
      <li>Blob integrity is <strong>not</strong> a claim of current truth. Checkpoint advance is not, by itself, proof the underlying fact changed — the version/digest pin decides.</li>
      <li>Secrets stay in <code>.env</code>/environment, are never logged, never shipped to the browser or into exports, and are scanned in the working tree and full git history.</li>
      <li>Writes are opt-in everywhere: CLI <code>--allow-mainnet-writes</code>, API <code>allowWrites: true</code>, MCP <code>RECALLGUARD_ENABLE_WRITES=true</code> + per-call literal confirm.</li>
      <li>MCP tool arguments are schema-validated; query ≤ 512 chars; live calls time out at 30 s; recall budget ≤ 2 Tatum reads per answer.</li>
    </ul>
  </section>

  <section class="section" id="troubleshooting" aria-labelledby="ts-title">
    <p class="eyebrow">Troubleshooting</p>
    <h2 id="ts-title">Common failures</h2>
    <div class="scroll" tabindex="0" role="region" aria-label="Troubleshooting table" style="margin-top:14px">
      <table>
        <caption>CLI and library failures</caption>
        <thead><tr><th scope="col">Symptom</th><th scope="col">Cause</th><th scope="col">Fix</th></tr></thead>
        <tbody>
          <tr><td><code>unknown sample</code></td><td>Typo in <code>--sample</code></td><td><code>--sample sui-clock-changed</code> or <code>--sample sui-clock-revision-lifecycle</code></td></tr>
          <tr><td><code>credential self-test failed</code> (live)</td><td>Missing/invalid Tatum or MemWal credentials</td><td>Fix <code>.env</code>; the CLI refuses to recall on failure by design</td></tr>
          <tr><td><code>WITHHELD_UNVERIFIED</code></td><td>Checkpoint or pin read failed, or proof incomplete</td><td>Fail closed is the correct behaviour; check Tatum availability and the proof fields</td></tr>
          <tr><td>429 / rate limited</td><td>Tatum quota</td><td>Built-in exponential backoff; the checkpoint read is cached for 1 s — stop tight-looping the CLI</td></tr>
          <tr><td><code>--allow-mainnet-writes rejected</code></td><td>Write flag without <code>--live</code></td><td>Writes exist only in live mode; recorded samples are always read-only</td></tr>
          <tr><td>MCP client red/disconnected</td><td>Bad path / node missing</td><td>See <a href="/mcp.html#troubleshooting">MCP troubleshooting</a></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="section" id="limitations" aria-labelledby="lim-title">
    <p class="eyebrow">Honest limitations</p>
    <h2 id="lim-title">What this release does not claim</h2>
    <ul class="secondary" style="margin:14px 0 0;padding-left:20px;display:grid;gap:8px;max-width:860px">
      <li><strong>Live read-only CLI is unverified end-to-end.</strong> Unit tests cover argument handling, missing credentials, injected behaviour and recorded samples; no committed transcript runs it against Mainnet with real credentials.</li>
      <li><strong>No user study.</strong> The wallet/treasury-agent persona is a hypothesis, not validated demand. No users, testimonials or revenue are claimed.</li>
      <li><strong>The 214/16/4 split is modelled</strong> from the committed decision log — counterfactual analysis, not production incidents.</li>
      <li><strong>The latest SLOW learning (40,000) was never persisted.</strong> The stored policy remains 20,000 (tighter, more conservative). FAST is cadence-limited below its sampling interval.</li>
      <li><strong>Walrus retention (end_epoch) is unknown.</strong> The committed snapshot stays reproducible offline regardless.</li>
      <li><strong>Signatures are not verified.</strong> This release compares digests as data.</li>
      <li><strong>Docker is unverified</strong> (written, never built — no Docker daemon in the build environment).</li>
      <li><strong>The published Vercel page is a labelled static snapshot</strong>, not a live service and not a freshness oracle.</li>
      <li><strong>Tatum AI Builder was not used.</strong> The project uses Tatum&rsquo;s Sui Mainnet GraphQL gateway only.</li>
    </ul>
  </section>

  <p class="muted" style="margin-top:40px">Source lives on <a href="${GITHUB_REPO}" rel="noopener">GitHub</a> — <code>src/</code> (gate, policy, recall contract, MCP server), <code>test/</code> (143 tests), <code>docs/</code> (mcp.md, blog.md, video-script.md, judge-60s.md), <code>reports/</code> (dated evidence).</p>
  <script>
    document.querySelectorAll("[data-copy-target]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var target = document.getElementById(button.dataset.copyTarget);
        try { await navigator.clipboard.writeText(target ? target.textContent.trim() : ""); button.textContent = "Copied"; }
        catch (e) { button.textContent = "Select and copy"; }
      });
    });
  </script>`;

  return shell({
    title: "RecallGuard docs · quickstart, CLI, API, MCP, architecture, security",
    description: "Developer documentation for RecallGuard: 60-second quickstart, CLI reference, JavaScript API, MCP setup, architecture, security model, troubleshooting and honest limitations.",
    active: "/docs.html",
    path: "/docs.html",
    body,
  });
}
