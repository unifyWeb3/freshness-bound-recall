// Decision ledger: append-only JSONL of every gate decision.
// This is the recorded event log the replay tool and the proof page read.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export class Ledger {
  constructor(path, redactor = null) {
    this.path = path;
    this.redactor = redactor;
    this.entries = [];
  }
  append(entry) {
    const e = this.redactor ? this.redactor.redact(entry) : entry;
    this.entries.push(e);
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, JSON.stringify(e) + "\n");
    } catch { /* ledger is best-effort on disk */ }
    return e;
  }
  static read(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }
}
