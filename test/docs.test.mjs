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
  assert.match(video, /recalled memories are on Walrus/i);
  assert.doesNotMatch(combined, /byte-identical to `npm run export`/i);
  assert.match(combined, /byte-identical to the deployed export/i);
});
