// LIVE test 1 (opt-in): Walrus Memory mainnet write + recall round-trip.
//   RUN_MAINNET=1 node --test test/live/
//
// Writes ONE seed claim for the FAST subject to `freshness-recall`, waits for
// the blob, recalls it, parses it back and checks the proof fields against the
// live Sui mainnet read. This is a real mainnet write: opt-in only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../../src/runtime.mjs";
import { credentialSelfTest } from "../../src/mainnet.mjs";
import { FAST_SUBJECT } from "../../src/subjects.mjs";
import { recordToText } from "../../src/schema.mjs";
import { SUI_MAINNET_CHAIN_ID } from "../../src/tatum.mjs";

const RUN = process.env.RUN_MAINNET === "1";

test("mainnet: credential self-test passes and a seed claim round-trips through Walrus Memory",
  { skip: !RUN, timeout: 300000 }, async () => {
    const rt = createRuntime({ live: true, logger: () => {} });

    const self = await credentialSelfTest({ client: rt.client, tatum: rt.tatum, env: rt.env, namespace: rt.namespace });
    assert.equal(self.ok, true, `self-test failed: ${JSON.stringify(self.checks.filter((c) => !c.ok))}`);
    assert.ok(self.relayer?.status, "relayer status missing");

    const live = await rt.tatum.readCheckpoint();
    const pin = await rt.tatum.readObject(FAST_SUBJECT.address);
    assert.ok(Number(live.checkpointSeq) > 0);
    assert.ok(pin.version);

    const claim = `smoke-seed-fast-${live.checkpointSeq}`;
    const text = recordToText({
      claim,
      class: "FAST",
      epoch: 1,
      state: "live",
      subject: FAST_SUBJECT.address,
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
      body: `Seed claim for the FAST class: the Sui Clock was observed at version ${pin.version} digest ${pin.digest} at checkpoint ${live.checkpointSeq}.`,
    });

    const { jobId } = await rt.store.remember(text);
    assert.ok(jobId, "no remember job id");
    const done = await rt.store.waitFor(jobId);
    const blobId = done?.[0]?.blob_id;
    assert.ok(blobId, `no blob id: ${JSON.stringify(done)}`);
    assert.match(String(blobId), /^[A-Za-z0-9_-]{20,}$/, "blob id does not look like a Walrus blob id");

    // recall it back by semantic query and parse it
    const res = await rt.store.recall({ query: "Sui Clock seed claim object version checkpoint", limit: 10, sort: "recent" });
    const hit = res.results.find((r) => r.blob_id === blobId || r.text.includes(claim));
    assert.ok(hit, "written memory was not recalled");

    const parsed = rt.store.parse(hit.text);
    assert.ok(parsed?.record, "recalled text did not parse as FR-v1");
    assert.equal(parsed.record.claim, claim);
    assert.equal(parsed.record["proof.checkpoint_seq"], live.checkpointSeq);
    assert.equal(parsed.record["proof.object_version"], pin.version);
    assert.equal(parsed.record.subject, FAST_SUBJECT.address);

    console.log(`[live-1] wrote ${claim} -> blob ${blobId}; recalled and parsed with checkpoint ${live.checkpointSeq}, version ${pin.version}`);
    rt.client.destroy?.();
  });
