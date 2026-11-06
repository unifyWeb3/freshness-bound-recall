import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { page } from "../scripts/proof-page.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recorded = JSON.parse(readFileSync(resolve(ROOT, "docs/evidence/proof-snapshot.json"), "utf8"));

function staticPage() {
  const snapshot = structuredClone(recorded);
  snapshot.mode = "offline";
  snapshot.exported_at = new Date(Date.parse(snapshot.generated_at) + 60_000).toISOString();
  return page(snapshot);
}

function capture(html, pattern, description) {
  const match = html.match(pattern);
  assert.ok(match, `${description} must be present`);
  return match[1];
}

test("homepage leads with the product promise, try-it action, and recorded decision", () => {
  const html = staticPage();
  assert.match(html, /A stale memory is not an answer/);
  assert.match(html, /href="#try-it"/);
  assert.match(html, /href="#recorded-decision"/);
  assert.match(html, /Try it in 60 seconds/);
  assert.match(html, /id="recorded-decision"/);
  assert.match(html, /Is the Sui Clock still at version 1018797298\?/);
  assert.match(html, /obs-sui-clock-341742463/);
  assert.match(html, /WITHHELD/);
  assert.match(html, /version 1019267077/);
  assert.match(html, /checkpoint 341868687/);
  assert.match(html, /Why it matters:/);
  assert.match(html, /checkpoint-rail/);
  assert.match(html, /rail-stop gate/);

  const gateStep = capture(html,
    /<article(?=[^>]*class="(?=[^"]*\bflow-step\b)(?=[^"]*\bgate-step\b)[^"]*")[^>]*>([\s\S]*?)<\/article>/,
    "the recorded gate step");
  assert.equal((gateStep.match(/class="step-meta"/g) || []).length, 1,
    "the gate reason must be rendered once");
});

test("proof page labels static provenance and accepts camel-case checkpoint readAt", () => {
  const html = staticPage();
  assert.match(html, /Cached snapshot · static export · network off/);
  for (const label of [
    "Captured source",
    "Pins at snapshot",
    "Requests captured in snapshot",
    "Evidence captured",
    "Static page exported",
    "Snapshot age",
  ]) assert.match(html, new RegExp(label));
  assert.match(html, /Snapshot age<\/span><span class="capture-value">1m 0s/);
  assert.match(html, /Checkpoint age at render: <code>1m 3s<\/code>/,
    "checkpoint age must use the snapshot's checkpoint.readAt field");
});

test("homepage exposes the exact credential-free 60-second lifecycle", () => {
  const html = staticPage();
  const tryIt = capture(html, /<section(?=[^>]*\bid="try-it")[^>]*>([\s\S]*?)<\/section>/,
    "the 60-second try-it section");

  assert.match(tryIt, /npm install --ignore-scripts/);
  assert.match(tryIt, /npm run recall:checked -- --sample sui-clock-revision-lifecycle/);
  assert.match(tryIt, /goZjQJ36yLVBG6oPyHqR6wgYQ9HbmISoe-3HWkVB1AY/);
  assert.match(tryIt, /mjxZQ1X2xn5Xlvd-gBsBAIrD5rkUDwFCAn1NEX0gbWY/);
  assert.match(tryIt, /STALE[\s\S]*FRESH[\s\S]*STALE/);
  assert.match(tryIt, /117[,.]?242 ms/);
  assert.match(tryIt, /1[,.]?381 ms/);
  assert.match(tryIt, /read-only/i);
  assert.match(tryIt, /network off/i);
  assert.match(tryIt, /writes?[^<]{0,20}none/i);
  assert.match(tryIt, /proof-equivalent observation/i);
  assert.match(tryIt, /not the correction blob/i);
  assert.match(tryIt,
    /<button(?=[^>]*\btype="button")(?=[^>]*\baria-label="[^"]*[Cc]opy)[^>]*>/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|new WebSocket/);
});

test("homepage shows a Walrus policy memory changing the same recorded verdict", () => {
  const html = staticPage();
  const learning = capture(html, /<section(?=[^>]*\bid="learning-loop")[^>]*>([\s\S]*?)<\/section>/,
    "the recorded learning-loop section");

  assert.match(learning, /Zne2mnjAy6uOtOhJ6o5QAxH963EqXQaMMtYWOPBkK_4/,
    "the persisted SLOW policy blob must be named");
  assert.match(learning, /Pk3CAi9A0vLueqT8LGWS1zHoicYNSl7cUbXeAQFtF0g/,
    "the observation replayed under both policies must be named");
  assert.match(learning, /same recorded inputs/i);
  assert.match(learning, /18[,.]?155/);
  assert.match(learning, /5[,.]?000[\s\S]*STALE[\s\S]*FALSE-STALE/);
  assert.match(learning, /20[,.]?000[\s\S]*FRESH[\s\S]*CONSISTENT/);
  assert.match(learning, /10[,.]?000\s*(?:→|-&gt;|to)\s*20[,.]?000/i,
    "the stored policy's actual learning step must be disclosed");
  assert.match(learning, /2026-11-05(?:T| )02:05:19\.054Z/,
    "the recorded learning time must be visible");
  assert.match(learning, /2026-11-05(?:T| )09:23:05\.105Z/,
    "the later Walrus write time must be visible");
  assert.match(learning, /offline/i);
  assert.match(learning, /read-only/i);
  assert.match(learning, /writes?[^<]{0,20}none/i);
});

test("homepage uses the checkpoint signature without a generic FBR tile", () => {
  const html = staticPage();
  assert.match(html, /class="brand-mark"/);
  assert.doesNotMatch(html, />FBR</);
  assert.match(html, /Recorded Mainnet evidence/);
  assert.doesNotMatch(html, /EVIDENCE PAGE|CACHED SNAPSHOT|STATIC EXPORT/);
  assert.match(html, /--amber: #f4b860/);
  assert.doesNotMatch(html, /gradient|box-shadow|--green|--red|--focus|--amber-ink/,
    "the page must use one amber accent without gradients or haze");
});

test("proof page keeps dense evidence accessible without widening mobile documents", () => {
  const html = staticPage();
  assert.match(html, /\.grid > \*, \.decision-flow > \*, \.capture-grid > \* \{ min-width: 0; \}/);
  assert.match(html, /\.address, \.address-line, \.address-line code \{ overflow-wrap: anywhere;/);
  assert.match(html, /html, body \{ width: 100%; max-width: 100%;/);
  assert.match(html, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(html, /<div class="scroll"(?! tabindex="0" role="region" aria-label=)/);
});

test("proof page shows only connected correction pairs and the recorded outcome split", () => {
  const html = staticPage();
  assert.doesNotMatch(html, /<svg\b/);
  assert.match(html, /Observation → correction chain/);
  assert.match(html, /class="correction-list"/);
  assert.match(html, /Recalled observation/);
  assert.match(html, /Recorded correction/);
  const correctionSection = html.split('<section class="section" aria-labelledby="corrections-title">')[1]
    .split('<section class="section" aria-labelledby="records-title">')[0];
  assert.doesNotMatch(correctionSection, /smoke-seed/);
  assert.match(html, /<span class="split-number">214<\/span><span class="split-label">changed<\/span>/);
  assert.match(html, /<span class="split-number">16<\/span><span class="split-label">unchanged-but-old<\/span>/);
  assert.match(html, /<span class="split-number">4<\/span><span class="split-label">unverified<\/span>/);
});

test("proof page collapses inventories and links the complete ledger", () => {
  const html = staticPage();
  assert.equal((html.match(/<details>/g) || []).length, 2);
  assert.match(html, /Latest 40 of 306 decisions/);
  assert.match(html, /https:\/\/github\.com\/unifyWeb3\/freshness-bound-recall\/blob\/main\/docs\/evidence\/proof-snapshot\.json/);
  assert.equal((html.match(/<caption>/g) || []).length, 4);
  assert.doesNotMatch(html, /<th\b(?! scope="col")/);
  assert.match(html, /tabindex="0" role="region" aria-label="Memory inventory table"/);
  assert.match(html, /tabindex="0" role="region" aria-label="Latest decision ledger table"/);
});

test("proof page includes project links and static share metadata without auto reload", () => {
  const html = staticPage();
  assert.match(html, /https:\/\/github\.com\/unifyWeb3\/freshness-bound-recall"/);
  assert.match(html, /https:\/\/github\.com\/unifyWeb3\/freshness-bound-recall\/blob\/main\/docs\/judge-60s\.md/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:description"/);
  assert.match(html, /<meta property="og:type" content="website"/);
  assert.match(html, /<meta property="og:url"/);
  assert.doesNotMatch(html, /setTimeout|location\.reload|auto-refresh/);
});
