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

test("proof page leads with the recorded question, withheld memory, and verified value", () => {
  const html = staticPage();
  assert.match(html, /A stale answer was withheld/);
  assert.match(html, /Is the Sui Clock still at version 1018797298\?/);
  assert.match(html, /obs-sui-clock-341742463/);
  assert.match(html, /WITHHELD/);
  assert.match(html, /version 1019267077/);
  assert.match(html, /checkpoint 341868687/);
  assert.match(html, /Why it matters:/);
  assert.match(html, /checkpoint-rail/);
  assert.match(html, /rail-stop gate/);
});

test("proof page labels static provenance and accepts camel-case checkpoint readAt", () => {
  const html = staticPage();
  assert.match(html, /CACHED SNAPSHOT · STATIC EXPORT · network off/);
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
