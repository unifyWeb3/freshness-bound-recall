import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("published docs describe the current remote and scope deployment/export claims precisely", () => {
  const readme = read("README.md");
  const video = read("docs/video-script.md");
  const judge = read("docs/judge-60s.md");
  const submission = read("docs/submission.md");
  const combined = [readme, video, judge, submission].join("\n");

  assert.doesNotMatch(combined, /Nothing is pushed|no remote configured/i);
  assert.doesNotMatch(video, /every memory is on Walrus/i);
  assert.doesNotMatch(combined, /byte-identical to `npm run export`/i);
  assert.match(combined, /static export|static snapshot/i);
});

test("judge quickstart leads with the recorded lifecycle and records the accepted test totals", () => {
  const judge = read("docs/judge-60s.md");
  const lifecycle = "npm run recall:checked -- --sample sui-clock-revision-lifecycle";

  assert.match(judge, /real revision proof in 60 seconds/i);
  assert.ok(judge.indexOf(lifecycle) > -1, "the lifecycle command must be present");
  assert.ok(judge.indexOf(lifecycle) < judge.indexOf("npm test"),
    "the lifecycle must precede the broader test and audit path");
  assert.match(judge, /149 tests, 149 pass, 0 fail, 0 skipped/);
});

test("README leads with the exact quickstart, architecture, and honest integration limits", () => {
  const readme = read("README.md");
  const command = "npm run recall:checked -- --sample sui-clock-revision-lifecycle";

  assert.match(readme, /## The problem/);
  assert.match(readme, /Risk without a gate/);
  assert.match(readme, /npm install --ignore-scripts/);
  assert.match(readme, new RegExp(command.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(readme, /## How it works/);
  assert.match(readme, /## Honest limits/);
  assert.match(readme, /Live read-only CLI is unverified end to end/);
  assert.match(readme, /MCP — the product, not an adapter/);
  assert.match(readme, /recallguard-mcp/);
  assert.doesNotMatch(readme, /NOT DELIVERED/);
});

test("blog and three-minute script preserve the recorded learning and outcome numbers", () => {
  const blog = read("docs/blog.md");
  const video = read("docs/video-script.md");
  const combined = `${blog}\n${video}`;

  assert.match(blog, /## What Tatum does/);
  assert.match(blog, /## What Walrus Memory does/);
  assert.match(blog, /## How the policy learned over time/);
  assert.match(video, /Three-minute video script/);
  assert.match(video, /## Shot list and voice-over/);
  for (const value of ["214 changed", "16 unchanged-but-old", "4 unverified"]) {
    assert.match(combined, new RegExp(value));
  }
  assert.match(combined, /5,000[\s\S]*STALE[\s\S]*FALSE-STALE/);
  assert.match(combined, /20,000[\s\S]*FRESH[\s\S]*CONSISTENT/);
  assert.match(combined, /UNVERIFIED end to end/);
  assert.doesNotMatch(video, /Live now|nothing staged/i);
});
