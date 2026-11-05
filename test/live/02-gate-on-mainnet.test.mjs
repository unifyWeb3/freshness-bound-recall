// LIVE test 2 (opt-in): the freshness gate on real mainnet data.
//   RUN_MAINNET=1 node --test test/live/
//
// Writes ONE seed claim for the SLOW subject, then gates it against live Tatum
// mainnet reads: at most 2 reads, a verdict in {FRESH, STALE}, a visible reason,
// and the checkpoint stamps present. No transaction, no funding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../../src/runtime.mjs";
import { SLOW_SUBJECT } from "../../src/subjects.mjs";
import { recordToText } from "../../src/schema.mjs";
import { evaluateGate, VERDICT } from "../../src/gate.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../../src/tatum.mjs";

const RUN = process.env.RUN_MAINNET === "1";

test("mainnet: a seed claim for the SLOW subject is gated against live Tatum reads",
  { skip: !RUN, timeout: 300000 }, async () => {
    const rt = createRuntime({ live: true, logger: () => {} });

    const live = await rt.tatum.readCheckpoint();
    const pin = await rt.tatum.readObject(SLOW_SUBJECT.address);
    assert.ok(pin.version, "no version for the SLOW subject");

    const claim = `smoke-seed-slow-${live.checkpointSeq}`;
    const text = recordToText({
      claim,
      class: "SLOW",
      epoch: 1,
      state: "live",
      subject: SLOW_SUBJECT.address,
      predicate: "object_version",
      value_at_write: `version=${pin.version} digest=${pin.digest}`,
      "proof.transport": "tatum-sui-mainnet/graphql",
      "proof.chain_id": SUI_MAINNET_CHAIN_ID,
      "proof.checkpoint_seq": live.checkpointSeq,
      "proof.checkpoint_digest": live.checkpointDigest,
      "proof.object_version": pin.version,
      "proof.object_digest": pin.digest,
      "proof.read_at": pin.readAt,
      agent_id: rt.env.MEMWAL_AGENT_ID || "",
      recorded_at: new Date().toISOString(),
      body: `Seed claim for the SLOW class: the MemWal AccountRegistry was observed at version ${pin.version} digest ${pin.digest} at checkpoint ${live.checkpointSeq}.`,
    });

    const { jobId } = await rt.store.remember(text);
    const done = await rt.store.waitFor(jobId);
    const blobId = done?.[0]?.blob_id;
    assert.ok(blobId, `no blob id: ${JSON.stringify(done)}`);

    // gate the freshly written record against a NEW live read, with a 2-read budget
    const budget = rt.tatum.createBudget(2);
    const live2 = await rt.tatum.readCheckpoint({ budget });
    const pin2 = await rt.tatum.readObject(SLOW_SUBJECT.address, { budget });
    assert.ok(budget.remaining() >= 0, "read budget must not go negative");

    const decision = evaluateGate({
      record: {
        class: "SLOW", claim, subject: SLOW_SUBJECT.address, predicate: "object_version",
        "proof.checkpoint_seq": live.checkpointSeq,
        "proof.object_version": pin.version,
        "proof.object_digest": pin.digest,
        "proof.read_at": pin.readAt,
      },
      live: { checkpointSeq: live2.checkpointSeq, checkpointDigest: live2.checkpointDigest, readAt: live2.readAt },
      pin: { version: pin2.version, digest: pin2.digest, readAt: pin2.readAt },
      policy: { windowCheckpoints: rt.policy.state("SLOW").windowCheckpoints, maxAgeSeconds: rt.policy.state("SLOW").maxAgeSeconds },
      now: Date.now(),
    });

    assert.ok([VERDICT.FRESH, VERDICT.STALE].includes(decision.verdict), `unexpected verdict ${decision.verdict}`);
    assert.ok(decision.reason && decision.reason.length > 0, "the gate must give a visible reason");
    assert.equal(typeof decision.signals.window.delta, "number");
    assert.equal(rt.tatum.callCount >= 2, true);

    console.log(`[live-2] gated ${claim} (blob ${blobId}): ${decision.verdict} - ${decision.reason}`);
    console.log(`[live-2] window delta ${decision.signals.window.delta}, pin changed=${decision.signals.pin.changed}, plan=${rt.tatum.planHeader()}`);
    rt.client.destroy?.();
  });
