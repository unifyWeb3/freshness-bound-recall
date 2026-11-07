// Shared ablation computation over the recorded decision ledger.
// Used by the evidence page and the homepage counterfactual strip.

export function computeAblation(snapshot) {
  const led = snapshot.ledger || [];
  const decisions = led.filter((e) => e.verdict);
  const count = (v) => decisions.filter((e) => e.verdict === v).length;
  const fresh = count("FRESH");
  const stale = count("STALE");
  const withheld = count("WITHHELD_UNVERIFIED");
  const total = decisions.length;
  const changed = decisions.filter((e) => e.verdict === "STALE" && (
    e.signal === "MISSED-CHANGE" ||
    String(e.reason || "").startsWith("subject changed") ||
    (e.pin && e.memory?.proof_at_write && (
      String(e.pin.version) !== String(e.memory.proof_at_write.object_version) ||
      String(e.pin.digest) !== String(e.memory.proof_at_write.object_digest)
    ))
  )).length;
  const stillTrueOld = stale - changed;

  return {
    fresh,
    stale,
    withheld,
    total,
    rows: [
      {
        name: "memory-off (every answer read live)",
        from_memory: 0, from_live: total, withheld: 0,
        reads: total, changed_answers: 0, still_true_old_answers: 0, unverified_answers: 0,
        note: "1 Tatum read per answer, no stored context used",
      },
      {
        name: "memory-on, no gate",
        from_memory: total, from_live: 0, withheld: 0,
        reads: 0, changed_answers: changed, still_true_old_answers: stillTrueOld, unverified_answers: withheld,
        note: "0 reads; changed, old, and unverified memories would all answer",
      },
      {
        name: "memory-on, gate + learned policy",
        from_memory: fresh, from_live: stale + withheld, withheld,
        reads: total * 2, changed_answers: 0, still_true_old_answers: 0, unverified_answers: 0,
        note: "2 reads per answer (checkpoint + pin)",
      },
    ],
  };
}
