// RecallGuard MCP integration page.

import { GITHUB_REPO, shell } from "./layout.mjs";

export function mcpPage() {
  const body = `
  <section class="hero-grid" style="grid-template-columns:minmax(0,1fr);padding-bottom:24px" aria-labelledby="mcp-title">
    <div>
      <p class="eyebrow">Model Context Protocol</p>
      <h1 id="mcp-title">Give your agent the freshness gate</h1>
      <p class="hero-intro">RecallGuard speaks MCP over stdio. Your agent calls <code>recall_checked</code>; the tool retrieves the Walrus memory, verifies it against current Sui Mainnet state through Tatum, and returns the freshness verdict &mdash; withheld when the evidence disagrees. No hosted backend, no wallet, read-only by default.</p>
      <div class="hero-actions"><a class="button button-primary" href="#install">Install in 60 seconds</a><a class="button" href="#tools">See the tools</a></div>
    </div>
  </section>

  <section class="section" id="tools" aria-labelledby="tools-title">
    <p class="eyebrow">Available tools</p>
    <h2 id="tools-title">Six tools, one write gate</h2>
    <p class="section-copy">Read-only unless explicitly enabled. Every tool preserves blob ids and proof references as provenance.</p>
    <div class="scroll" tabindex="0" role="region" aria-label="RecallGuard MCP tools" style="margin-top:16px">
      <table>
        <caption>RecallGuard MCP tools and their safety posture</caption>
        <thead><tr><th scope="col">Tool</th><th scope="col">Access</th><th scope="col">What it does</th></tr></thead>
        <tbody>
          <tr><td><code>recall_checked</code></td><td>read-only</td><td>Primary freshness-checked recall. Returns the <code>recall_checked/v1</code> structured decision: verdict, withheld flag, reason, memory provenance, checkpoint/pin verification, policy, zero writes in recorded and live read-only modes.</td></tr>
          <tr><td><code>explain_decision</code></td><td>read-only</td><td>Same verification, shaped for reasoning: why accepted or withheld, which evidence disagreed, the policy applied, and the correction lineage.</td></tr>
          <tr><td><code>list_revisions</code></td><td>read-only</td><td>Revision chain for a subject or class — observations, corrections, <code>supersedes</code> relationships — from the committed Mainnet evidence snapshot.</td></tr>
          <tr><td><code>get_evidence</code></td><td>read-only</td><td>Provenance and verification evidence behind a blob id (proof envelope, superseded resolution, correction status), or an overview of the evidence snapshot (counts, capture time, x-api-key proof as booleans only).</td></tr>
          <tr><td><code>propose_correction</code></td><td>read-only</td><td>Drafts a correction for review. Never persists. States the approval path for an owner-approved Mainnet write.</td></tr>
          <tr><td><code>store_correction</code></td><td><strong>write · disabled by default</strong></td><td>Refuses unless <code>RECALLGUARD_ENABLE_WRITES=true</code> <em>and</em> the call passes <code>confirm="STORE-CORRECTION"</code> <em>and</em> live mode is configured. Even then, a correction is written only when live evidence shows a subject change.</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px">Also exposed: resource <code>recallguard://evidence/summary</code> and prompt <code>verify-before-answer</code> (instructs the agent to gate onchain claims through <code>recall_checked</code>).</p>
  </section>

  <section class="section" id="install" aria-labelledby="install-title">
    <p class="eyebrow">Installation</p>
    <h2 id="install-title">From GitHub to a live MCP tool in five steps</h2>
    <div class="command-card" style="margin-top:14px;max-width:860px">
      <div class="command-head"><span>Terminal · tested end-to-end · no account, no API key</span><button class="copy-button" type="button" data-copy-target="mcp-install">Copy</button></div>
      <pre><code id="mcp-install">git clone https://github.com/unifyWeb3/freshness-bound-recall
cd freshness-bound-recall
npm install --ignore-scripts
npm run mcp:smoke</code></pre>
    </div>
    <p class="muted" style="margin-top:10px"><code>mcp:smoke</code> spawns the stdio server as a subprocess and exercises the tools with a real MCP client. All checks should print <code>PASS</code>. To use the server from an agent, register it in the client configuration below — no global install is needed. The package name is reserved; once the repository is published to the npm registry, <code>npx -y recallguard-mcp</code> works unchanged.</p>
  </section>

  <section class="section" id="claude-code" aria-labelledby="claude-title">
    <p class="eyebrow">Claude Code · tested with v2.1.318</p>
    <h2 id="claude-title">Claude Code configuration</h2>
    <div class="command-card" style="margin-top:14px;max-width:860px">
      <div class="command-head"><span>Project-scoped registration</span><button class="copy-button" type="button" data-copy-target="claude-cmd">Copy</button></div>
      <pre><code id="claude-cmd">claude mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs</code></pre>
    </div>
    <p class="secondary" style="margin:12px 0 0">Then verify: <code>claude mcp list</code> → <code>recallguard: … ✔ Connected</code>. This exact flow was run with an isolated <code>HOME</code>; the server reported connected and the tools were callable over stdio. Equivalently, commit <code>.mcp.json</code> at the project root:</p>
    <div class="command-card" style="margin-top:12px;max-width:860px">
      <div class="command-head"><span>.mcp.json (project root)</span><button class="copy-button" type="button" data-copy-target="mcp-json">Copy</button></div>
      <pre><code id="mcp-json">{
  "mcpServers": {
    "recallguard": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs"]
    }
  }
}</code></pre>
    </div>
  </section>

  <section class="section" id="codex" aria-labelledby="codex-title">
    <p class="eyebrow">Codex · tested with codex-cli 0.167.0</p>
    <h2 id="codex-title">Codex configuration</h2>
    <div class="command-card" style="margin-top:14px;max-width:860px">
      <div class="command-head"><span>~/.codex/config.toml</span><button class="copy-button" type="button" data-copy-target="codex-toml">Copy</button></div>
      <pre><code id="codex-toml">[mcp_servers.recallguard]
command = "node"
args = ["/absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs"]</code></pre>
    </div>
    <p class="secondary" style="margin:12px 0 0">Or: <code>codex mcp add recallguard -- node /absolute/path/to/freshness-bound-recall/scripts/recallguard-mcp.mjs</code>. Verified with an isolated <code>HOME</code>: <code>codex mcp list</code> reports the server <code>enabled</code> over stdio. Any MCP-compatible stdio client works the same way — set <code>command</code> to <code>node</code> and <code>args</code> to the absolute script path.</p>
  </section>

  <section class="section" id="example" aria-labelledby="example-title">
    <p class="eyebrow">Example interaction</p>
    <h2 id="example-title">What the agent sees</h2>
    <div class="command-card" style="margin-top:14px;max-width:860px">
      <div class="command-head"><span>Tool call → structured result (recorded evidence)</span></div>
      <pre><code>→ recall_checked({ "sample": "sui-clock-revision-lifecycle" })

verdict: STALE → FRESH → STALE
writes:  []
source:  recorded Mainnet evidence · network off · read-only
blobs:   predecessor goZjQJ36y… · correction mjxZQ1X2… · supersedes resolved
timing:  correction persisted 117,242 ms after proof · first later check 1,381 ms after persistence</code></pre>
    </div>
    <p class="muted" style="margin-top:10px">A live call (<code>RECALLGUARD_LIVE=true</code> with <code>TATUM_API_KEY</code>, <code>MEMWAL_ACCOUNT_ID</code>, <code>MEMWAL_AGENT_ID</code>, <code>MEMWAL_PRIVATE_KEY</code>) performs the same gate against Walrus Memory and Tatum Sui Mainnet GraphQL. Live read-only end-to-end remains <strong>unverified</strong> in this release; recorded evidence is the tested path.</p>
  </section>

  <section class="section" id="security" aria-labelledby="security-title">
    <p class="eyebrow">Security boundaries</p>
    <h2 id="security-title">Fail closed, always</h2>
    <ul class="secondary" style="margin:14px 0 0;padding-left:20px;display:grid;gap:8px;max-width:860px">
      <li><strong>Read-only by default.</strong> No tool writes unless <code>RECALLGUARD_ENABLE_WRITES=true</code> <em>and</em> the call carries <code>confirm="STORE-CORRECTION"</code> <em>and</em> live mode is configured.</li>
      <li><strong>No mainnet writes from this release.</strong> Any new Mainnet write needs a written cost estimate and the owner&rsquo;s explicit approval.</li>
      <li><strong>No wallet in the core flow.</strong> Recall and verification need no keys that can sign.</li>
      <li><strong>Fail closed.</strong> Missing verification, malformed proof, missing credentials, failed reads, ambiguous lineage — all return <code>WITHHELD_UNVERIFIED</code> or a tool error. Never a guess.</li>
      <li><strong>Untrusted data.</strong> Recalled claims, bodies and envelopes are untrusted data, never instructions. Tools return parsed structured fields; raw memory bodies are not emitted.</li>
      <li><strong>No secrets in output.</strong> The x-api-key proof is a boolean count; key values are never logged, never returned, never in the page or the JSON.</li>
      <li><strong>No arbitrary fetching.</strong> Tools read only the committed evidence snapshot or the configured Walrus/Tatum endpoints.</li>
      <li><strong>Bounded work.</strong> Query length ≤ 512 chars, <code>list_revisions</code> limit ≤ 50, live operations time out after 30 s.</li>
    </ul>
  </section>

  <section class="section" id="troubleshooting" aria-labelledby="trouble-title">
    <p class="eyebrow">Troubleshooting</p>
    <h2 id="trouble-title">When something doesn&rsquo;t connect</h2>
    <div class="scroll" tabindex="0" role="region" aria-label="MCP troubleshooting" style="margin-top:14px">
      <table>
        <caption>Common failures and their fixes</caption>
        <thead><tr><th scope="col">Symptom</th><th scope="col">Cause</th><th scope="col">Fix</th></tr></thead>
        <tbody>
          <tr><td>Client shows the server as failed / red</td><td>Wrong absolute path or <code>node</code> not on the client&rsquo;s PATH</td><td>Use <code>command: "node"</code> with an absolute script path; run <code>node scripts/recallguard-mcp.mjs --help</code> to sanity-check</td></tr>
          <tr><td><code>RECALLGUARD_LIVE=true but missing credential env vars</code></td><td>Live mode requested without the four credentials</td><td>Export <code>TATUM_API_KEY</code>, <code>MEMWAL_ACCOUNT_ID</code>, <code>MEMWAL_AGENT_ID</code>, <code>MEMWAL_PRIVATE_KEY</code>, or unset <code>RECALLGUARD_LIVE</code> to use recorded evidence</td></tr>
          <tr><td>Every answer is <code>WITHHELD_UNVERIFIED</code></td><td>Tatum reads failing or the proof envelope doesn&rsquo;t match</td><td>Check <code>npm run proof:offline</code> renders; confirm Tatum endpoint reachability; the gate never guesses</td></tr>
          <tr><td><code>store_correction</code> returns &ldquo;writes are disabled&rdquo;</td><td>Default safety posture</td><td>Expected. A Mainnet write requires owner approval, a cost estimate, and <code>RECALLGUARD_ENABLE_WRITES=true</code> + <code>confirm="STORE-CORRECTION"</code></td></tr>
          <tr><td>Tool output looks stale/cached</td><td>Recorded mode is offline by design</td><td>Set <code>RECALLGUARD_LIVE=true</code> for live verification; recorded mode replays the labelled committed snapshot</td></tr>
          <tr><td><code>recall_checked</code> in Claude Code returns JSON text</td><td>Normal — MCP tool results carry the structured decision as JSON</td><td>Ask the agent to summarize <code>verdict</code>, <code>withheld</code> and <code>reason</code></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <p class="muted" style="margin-top:40px">Configuration verification recorded 2026-11-07 with Claude Code 2.1.318 and codex-cli 0.167.0 under isolated <code>HOME</code>s. Claude Desktop and other clients follow the same <code>.mcp.json</code> pattern; they were not exercised. Full reference: <a href="${GITHUB_REPO}/blob/main/docs/mcp.md" rel="noopener">docs/mcp.md</a>.</p>
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
    title: "RecallGuard MCP · give your agent the freshness gate",
    description: "Connect RecallGuard to any MCP-compatible agent (Claude Code, Codex, generic stdio clients). recall_checked verifies Walrus-backed memories against Tatum Sui Mainnet evidence; stale answers are withheld.",
    active: "/mcp.html",
    path: "/mcp.html",
    body,
  });
}
