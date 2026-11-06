#!/usr/bin/env node
// Backward-compatible entrypoint. The installable command is `recall_checked`.

import { runRecallCheckedCli } from "../src/recall-checked-cli.mjs";

process.exitCode = await runRecallCheckedCli();
