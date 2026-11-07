// Site tests: the four generated pages (home, MCP, evidence, docs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { page, pages } from "../scripts/proof-page.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recorded = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));

function staticSite() {
  const snapshot = structuredClone(recorded);
  snapshot.mode = "offline";
  snapshot.exported_at = new Date(Date.parse(snapshot.generated_at) + 60_000).toISOString();
  return pages(snapshot);
}
const home = (site) => site["/index.html"];
const mcp = (site) => site["/mcp.html"];
const evidence = (site) => site["/evidence.html"];
const docs = (site) => site["/docs.html"];

const skipLink = '<a class="skip-link" href="#main-content">Skip to main content</a>';

test("every page leads with a working skip link and the brand mark", () => {
  for (const [name, html] of Object.entries(staticSite())) {
    assert.ok(html.includes(skipLink), `${name} must carry the skip link`);
    assert.ok(html.indexOf(skipLink) < html.indexOf("<nav"), `${name}: skip link must come first`);
    assert.match(html, /class="brand-mark"/);
    assert.match(html, /<main class="shell" id="main-content" tabindex="-1">/);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta name="description"/);
    assert.doesNotMatch(html, /setTimeout|location\.reload/);
  }
});

test("homepage answers what-is-this in five seconds: name, promise, actions", () => {
  const html = home(staticSite());
  assert.match(html, /Your agent remembers\./);
  assert.match(html, /RecallGuard checks whether it&rsquo;s still true/);
  assert.match(html, /href="\/mcp\.html"/);
  assert.match(html, /Add it to your agent via MCP/);
  assert.match(html, /Run the 60-second replay/);
  assert.match(html, /WITHHELD/);
  assert.match(html, /Walrus-backed recall/);
  assert.match(html, /Tatum Sui Mainnet GraphQL/);
});

test("homepage WITHHELD hero card shows the real recorded evidence", () => {
  const html = home(staticSite());
  assert.match(html, /cor-sui-clock-341742463/);
  assert.match(html, /RECORDED MAINNET DECISION/);
  assert.match(html, /subject changed/);
});

test("homepage interactive demo embeds the recorded lifecycle and works offline", () => {
  const html = home(staticSite());
  const demo = html.match(/<script type="application\/json" id="demo-data">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(demo);
  assert.equal(data.predecessor.claim, "obs-sui-clock-341742424");
  assert.equal(data.correction.claim, "cor-sui-clock-341742463");
  assert.equal(data.verification.verdict, "WITHHELD");
  assert.match(html, /id="demo-next"/);
  assert.match(html, /id="demo-prev"/);
  assert.match(html, /id="demo-tabs"/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|new WebSocket/);
});

test("homepage carries the exact credential-free 60-second replay command", () => {
  const html = home(staticSite());
  assert.match(html, /npm install --ignore-scripts/);
  assert.match(html, /npm run recall:checked -- --sample sui-clock-revision-lifecycle/);
  assert.match(html, /git clone https:\/\/github\.com\/unifyWeb3\/freshness-bound-recall/);
  assert.match(html, /STALE/);
  assert.match(html, /FRESH/);
  assert.match(html, /navigator\.clipboard\.writeText/);
});

test("homepage explains the comparison and the modeled counterfactual, labelled", () => {
  const html = home(staticSite());
  assert.match(html, /A vector hit is not a fresh fact/);
  assert.match(html, /WITHHELD_UNVERIFIED/);
  assert.match(html, /supersedes/);
  assert.match(html, /modelled counterfactual|Modeled counterfactual|Modelled counterfactual/i);
  assert.match(html, /not production incidents/i);
});

test("evidence page labels every number: recorded, offline, live, modeled", () => {
  const html = evidence(staticSite());
  assert.match(html, /Recorded evidence/);
  assert.match(html, /Offline replay/);
  assert.match(html, /Live verification/);
  assert.match(html, /Modelled counterfactual|Modelled|counterfactual/i);
  assert.match(html, /Unverified end-to-end/i);
  assert.match(html, /existence, not current truth|not a claim that any fact is still true/i);
});

test("evidence page preserves blob ids, the learned policy replay and the outcome split", () => {
  const html = evidence(staticSite());
  assert.match(html, /Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4/);
  assert.match(html, /Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g/);
  assert.match(html, /fc-policy-SLOW-v2/);
  assert.match(html, /10[,.]?000\s*(?:→|-&gt;|to)\s*20[,.]?000/i);
  assert.match(html, />214</);
  assert.match(html, />16</);
  assert.match(html, />4</);
  assert.match(html, /deterministic policy evaluation, not autonomous learning/i);
});

test("evidence page shows connected correction pairs only, inventories collapsed", () => {
  const html = evidence(staticSite());
  const correctionsSection = html.split('aria-labelledby="corrections-title"')[1].split('aria-labelledby="pins-title"')[0];
  assert.doesNotMatch(correctionsSection, /smoke-seed/);
  assert.match(html, /class="correction-list"/);
  assert.match(html, /Recalled observation/);
  assert.match(html, /Recorded correction/);
  assert.match(html, /Latest 40 of 306 decisions/);
  assert.match(html, /blob/i);
  assert.match(html, /tabindex="0" role="region" aria-label="Memory inventory table"/);
  assert.match(html, /tabindex="0" role="region" aria-label="Latest decision ledger table"/);
  assert.match(html, /tabindex="0" role="region" aria-label="Tatum request log table"/);
  assert.match(html, /https:\/\/github\.com\/unifyWeb3\/freshness-bound-recall\/blob\/main\/docs\/evidence\/proof-snapshot\.json/);
  assert.match(html, /x-api-key/);
  assert.doesNotMatch(html, /<th\b(?! scope="col")/);
});

test("evidence page uses one amber accent without gradients or haze", () => {
  const html = evidence(staticSite());
  assert.match(html, /--amber: #e5a83d/);
  assert.doesNotMatch(html, /gradient|box-shadow|--green|--red|backdrop-filter/i);
  const homeHtml = home(staticSite());
  assert.doesNotMatch(homeHtml, /gradient|box-shadow|--green|--red|backdrop-filter/i);
});

test("MCP page documents all six tools with read-only defaults and gating", () => {
  const html = mcp(staticSite());
  for (const tool of ["recall_checked", "explain_decision", "list_revisions", "get_evidence", "propose_correction", "store_correction"]) {
    assert.match(html, new RegExp(`<code>${tool}</code>`), `${tool} must be documented`);
  }
  assert.match(html, /RECALLGUARD_ENABLE_WRITES=true/);
  assert.match(html, /STORE-CORRECTION/);
  assert.match(html, /read-only by default/i);
  assert.match(html, /no wallet/i);
  assert.match(html, /untrusted data/i);
  assert.match(html, /withheld/i);
  assert.match(html, /Fail closed/i);
});

test("MCP page carries tested client configs for Claude Code and Codex", () => {
  const html = mcp(staticSite());
  assert.match(html, /claude mcp add recallguard/);
  assert.match(html, /v2\.1\.318/);
  assert.match(html, /codex-cli 0\.167\.0/);
  assert.match(html, /mcp_servers\.recallguard/);
  assert.match(html, /\.mcp\.json/);
  assert.match(html, /recallguard-mcp/);
  assert.match(html, /npm run mcp:smoke/);
  assert.match(html, /Troubleshooting/i);
  assert.match(html, /Claude Desktop and other clients.*not exercised/i);
});

test("docs page covers quickstart, CLI, API, architecture, security and honest limits", () => {
  const html = docs(staticSite());
  assert.match(html, /60 seconds/i);
  assert.match(html, /recallguard/);
  assert.match(html, /--allow-mainnet-writes/);
  assert.match(html, /--sample sui-clock-revision-lifecycle/);
  assert.match(html, /recallChecked/);
  assert.match(html, /recall_checked\/v1/);
  assert.match(html, /no LLM in the answer path/i);
  assert.match(html, /untrusted data/i);
  assert.match(html, /Signatures are <strong>not<\/strong> verified/);
  assert.match(html, /Live read-only CLI is unverified end-to-end/);
  assert.match(html, /Tatum AI Builder was not used/);
  assert.match(html, /fc-policy-SLOW-v2/);
  assert.match(html, /deterministic policy evaluation, not autonomous learning/i);
});

test("MCP and docs pages never print secrets and link the repo snapshot", () => {
  const site = staticSite();
  const all = Object.values(site).join("\n");
  assert.doesNotMatch(all, /suiprivkey1[0-9a-z]{32,}/i);
  assert.doesNotMatch(all, /PRIVATE KEY-----/);
  assert.match(all, /github\.com\/unifyWeb3\/freshness-bound-recall/);
});

test("pages render with 390px-ready rules and keyboard-accessible scroll regions", () => {
  for (const [name, html] of Object.entries(staticSite())) {
    assert.match(html, /html, body \{ width: 100%; max-width: 100%;/, name);
    assert.match(html, /@media \(max-width: 720px\)/, name);
    assert.doesNotMatch(html, /<div class="scroll"(?! tabindex="0" role="region" aria-label=)/);
    assert.match(html, /\.skip-link \{[^}]*translateY\(-220%\)/, name);
  }
});

test("back-compat page() export still renders the home page", () => {
  const html = page(structuredClone(recorded));
  assert.match(html, /Your agent remembers\./);
});
