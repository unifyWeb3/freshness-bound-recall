// Shared site shell for RecallGuard static pages.
// One near-neutral warm-dark canvas, one amber accent, flat surfaces,
// hairline borders, monospace for identifiers. No gradients, no glows.

export const GITHUB_REPO = "https://github.com/unifyWeb3/freshness-bound-recall";
const REPO_SNAPSHOT = `${GITHUB_REPO}/blob/main/docs/evidence/proof-snapshot.json`;

export const esc = (s) => String(s ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
export const short = (s, n = 14) => (s ? `${String(s).slice(0, n)}…` : "—");
export const fmtTime = (iso) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "unknown time";
};
export const fmtAge = (from, to = Date.now()) => {
  const start = Date.parse(from);
  const end = to instanceof Date ? to.getTime() : Number(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown age";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const CSS = `
  :root {
    color-scheme: dark;
    --bg: #151310;
    --card: #1c1a17;
    --raised: #232019;
    --ink: #ece8de;
    --secondary: #aaa49a;
    --muted: #7d786e;
    --hairline: rgba(236,232,222,.10);
    --hairline-strong: rgba(236,232,222,.22);
    --amber: #e5a83d;
    --amber-soft: rgba(229,168,61,.12);
  }
  * { box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; margin: 0; overflow-x: hidden; }
  body { background: var(--bg); color: var(--ink); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: var(--ink); text-underline-offset: 4px; text-decoration-color: var(--hairline-strong); transition: color 160ms ease; }
  a:hover { color: var(--amber); }
  a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; border-radius: 2px; }
  .skip-link { position: fixed; z-index: 10; top: 12px; left: 12px; padding: 10px 14px; background: var(--amber); color: #151310; border-radius: 6px; font-weight: 600; transform: translateY(-220%); }
  .skip-link:hover, .skip-link:focus { color: #151310; transform: translateY(0); }
  code { max-width: 100%; color: var(--ink); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  h1, h2, h3, p, dl, dd { margin-top: 0; }
  h1 { margin-bottom: 20px; font-size: clamp(40px, 5.4vw, 60px); font-weight: 550; line-height: 1.06; letter-spacing: -.03em; }
  h2 { margin: 0 0 10px; font-size: clamp(22px, 2.6vw, 30px); font-weight: 550; line-height: 1.25; letter-spacing: -.02em; }
  h3 { margin: 0; font-size: 15px; font-weight: 600; }
  .shell { width: min(100% - 48px, 1200px); margin: 0 auto; min-width: 0; }

  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 64px; border-bottom: 1px solid var(--hairline); }
  .brand { display: flex; align-items: center; gap: 11px; text-decoration: none; }
  .brand-mark { position: relative; display: block; width: 22px; height: 22px; flex: 0 0 22px; }
  .brand-mark svg { display: block; }
  .wordmark { font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
  .wordmark span { color: var(--amber); }
  .nav-links { display: flex; gap: 18px; list-style: none; padding: 0; margin: 0; font-size: 13px; }
  .nav-links a { text-decoration: none; color: var(--secondary); }
  .nav-links a:hover { color: var(--amber); }
  .nav-links a[aria-current="page"] { color: var(--ink); border-bottom: 1px solid var(--amber); padding-bottom: 3px; }

  .snapshot-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--hairline); }
  .status { display: inline-flex; min-height: 30px; align-items: center; padding: 3px 10px; border: 1px solid var(--hairline-strong); border-radius: 6px; font: 500 11px/1.4 ui-monospace, monospace; text-decoration: none; }
  .status-snapshot { border-color: rgba(229,168,61,.4); background: var(--amber-soft); color: var(--amber); }
  .status-live { border-color: var(--hairline-strong); color: var(--ink); }
  .snapshot-note { color: var(--secondary); font-size: 12px; }

  main { min-width: 0; padding-bottom: 72px; }
  .section { min-width: 0; padding-top: 56px; }
  .section-heading { margin-bottom: 22px; max-width: 760px; }
  .eyebrow { margin-bottom: 14px; color: var(--amber); font: 500 11px/1.4 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
  .section-copy { max-width: 680px; margin: 0; color: var(--secondary); font-size: 15px; }
  .footer { padding: 28px 0 44px; border-top: 1px solid var(--hairline); color: var(--secondary); font-size: 13px; }
  .footer-inner { display: flex; justify-content: space-between; gap: 24px; }
  .footer-links { display: flex; gap: 16px; }

  .button { min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border: 1px solid var(--hairline-strong); border-radius: 8px; background: transparent; color: var(--ink); font-size: 14px; font-weight: 550; text-decoration: none; cursor: pointer; }
  .button:hover { border-color: var(--amber); color: var(--amber); }
  .button-primary { border-color: var(--amber); background: var(--amber); color: #151310; }
  .button-primary:hover { color: #151310; filter: brightness(1.06); }

  .card { min-width: 0; padding: 20px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 16px; }
  .scroll { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 12px; }
  caption { padding: 12px 16px; border-bottom: 1px solid var(--hairline); color: var(--secondary); text-align: left; }
  th { padding: 10px 12px; border-bottom: 1px solid var(--hairline-strong); color: var(--secondary); font-weight: 500; text-align: left; white-space: nowrap; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  .muted { color: var(--muted); font-size: 12px; }
  .secondary { color: var(--secondary); }
  .kv { display: flex; justify-content: space-between; gap: 16px; min-width: 0; padding-top: 8px; color: var(--secondary); font-size: 13px; }
  .kv > * { min-width: 0; }
  .kv code { color: var(--ink); text-align: right; }
  .reason { margin-top: 12px; padding: 8px 12px; border-left: 2px solid var(--hairline-strong); background: var(--bg); color: var(--secondary); font-size: 12px; }
  .verdict-fresh { color: #ece8de; }
  .verdict-withheld { color: var(--amber); }
  .mono-tag { font: 500 11px/1.5 ui-monospace, monospace; }
  .pill { display: inline-flex; align-items: center; min-height: 26px; padding: 2px 8px; border: 1px solid var(--hairline); border-radius: 5px; color: var(--secondary); font: 11px/1.4 ui-monospace, monospace; }
  .pill-accent { border-color: rgba(229,168,61,.4); color: var(--amber); }
  pre { max-width: 100%; margin: 0; padding: 18px; overflow-x: auto; background: var(--bg); border: 1px solid var(--hairline); border-radius: 10px; }
  pre code { display: block; white-space: pre; overflow-wrap: normal; }
  .command-head { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 4px 4px 16px; border: 1px solid var(--hairline); border-bottom: 0; border-radius: 12px 12px 0 0; color: var(--secondary); font-size: 12px; background: var(--card); }
  .command-card pre { border-radius: 0 0 12px 12px; border: 1px solid var(--hairline); }
  .copy-button { min-height: 32px; padding: 6px 12px; border: 1px solid var(--hairline-strong); border-radius: 6px; background: var(--raised); color: var(--ink); font: inherit; cursor: pointer; }
  .copy-button:hover { border-color: var(--amber); color: var(--amber); }

  details { min-width: 0; border: 1px solid var(--hairline); border-radius: 12px; background: var(--card); }
  details + details { margin-top: 16px; }
  summary { min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; cursor: pointer; font-weight: 550; }
  summary::marker { color: var(--amber); }
  .details-content { min-width: 0; padding: 0 16px 16px; }
  .details-meta { color: var(--muted); font: 12px/1.5 ui-monospace, monospace; }

  .correction-list { display:grid; gap:12px; margin:0; padding:0; list-style:none; }
  .correction-row { display:grid; grid-template-columns:minmax(0,1fr) 40px minmax(0,1fr); align-items:stretch; min-width:0; }
  .record { display:grid; gap:6px; min-width:0; padding:16px; border:1px solid var(--hairline); background:var(--card); }
  .old-record { border-radius:12px 0 0 12px; }
  .corrected-record { border-color:var(--hairline-strong); border-radius:0 12px 12px 0; }
  .record-kind { color:var(--muted); font-size:12px; }
  .record span:not(.record-kind) { color:var(--secondary); font-size:13px; }
  .correction-arrow { display:grid; place-items:center; border-top:1px solid var(--hairline); border-bottom:1px solid var(--hairline); background:var(--raised); color:var(--secondary); }
  .rail-stop { position:relative; min-width:0; padding-top:16px; color:var(--muted); font:10px/1.4 ui-monospace,monospace; text-align:center; overflow-wrap:anywhere; }
  .rail-stop::before { content:""; position:absolute; top:0; left:calc(50% - 5px); width:10px; height:10px; background:var(--secondary); }
  .rail-stop.gate-stop::before { background:var(--amber); }

  .hero-grid { display: grid; grid-template-columns: minmax(0,1.05fr) minmax(0,.95fr); gap: 40px; align-items: center; padding: 56px 0 48px; border-bottom: 1px solid var(--hairline); }
  .hero-intro { color: var(--secondary); max-width: 560px; font-size: 18px; line-height: 1.6; margin: 0; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
  .kv-list { display: grid; gap: 10px; margin: 0; font-size: 13px; }
  .kv-list dt { color: var(--muted); }
  .kv-list dd { margin: 2px 0 0; }

  @media (max-width: 900px) {
    .hero-grid { grid-template-columns: minmax(0,1fr); padding: 40px 0 36px; }
  }
  @media (max-width: 900px) {
    .shell { width: min(100% - 32px, 1200px); }
    .nav-links { gap: 12px; }
  }
  @media (max-width: 720px) {
    .correction-row { grid-template-columns: minmax(0,1fr); }
    .old-record, .corrected-record { border-radius: 12px; }
    .correction-arrow { min-height: 28px; border: 0; }
    .topbar { align-items: start; padding: 14px 0; flex-direction: column; gap: 10px; }
    .nav-links { flex-wrap: wrap; }
    h1 { font-size: clamp(32px, 9vw, 40px); }
    .footer-inner { flex-direction: column; }
    .snapshot-bar { flex-direction: column; align-items: start; }
  }
`;

export function shell({ title, description, active, path, body, ogUrl }) {
  const url = ogUrl || `https://freshness-bound-recall-oxunify.vercel.app${path === "/index.html" ? "/" : path}`;
  const nav = [
    ["/index.html", "Overview"],
    ["/mcp.html", "MCP"],
    ["/evidence.html", "Evidence"],
    ["/docs.html", "Docs"],
  ].map(([href, label]) => {
    const current = active === href ? ' aria-current="page"' : "";
    return `<li><a href="${href}"${current}>${label}</a></li>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="${esc(description)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${esc(url)}"/>
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<nav class="shell topbar" aria-label="Primary navigation">
  <a class="brand" href="/index.html" aria-label="RecallGuard home">
    <span class="brand-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="1.5" y="1.5" width="19" height="19" rx="3" stroke="#ece8de" stroke-opacity=".35"/><circle cx="11" cy="11" r="4.2" stroke="#e5a83d" stroke-width="2"/><circle cx="11" cy="11" r="1.1" fill="#e5a83d"/></svg></span>
    <span class="wordmark">Recall<span>Guard</span></span>
  </a>
  <ul class="nav-links">${nav}<li><a href="${GITHUB_REPO}" rel="noopener">GitHub</a></li></ul>
</nav>
<main class="shell" id="main-content" tabindex="-1">
${body}
</main>
<footer class="footer"><div class="shell footer-inner"><span>RecallGuard · Walrus Memory + Tatum Sui Mainnet GraphQL · no LLM in the answer path</span><span class="footer-links"><a href="${GITHUB_REPO}" rel="noopener">Source</a><a href="/docs.html">Docs</a><a href="/evidence.html">Evidence</a><a href="${REPO_SNAPSHOT}" rel="noopener">Snapshot</a></span></div></footer>
</body></html>`;
}
