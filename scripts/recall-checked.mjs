#!/usr/bin/env node

import { runRecallCheckedCli } from "../src/recall-checked-cli.mjs";

process.exitCode = await runRecallCheckedCli();
