// The two claim classes with their real Sui mainnet subjects.
//
// Measured over 11.2 minutes on 2026-11-05 (32 rounds, 0 errors) through Tatum
// GraphQL - see data/claim-class-measurement.json and reports/build-phase1.md.
//
//   FAST  Sui Clock            31 version changes in 11.2 min  (2.778 / min)
//   SLOW  MemWal AccountRegistry 1 version change in 11.2 min  (0.090 / min)

export const FAST_SUBJECT = {
  id: "sui-clock",
  class: "FAST",
  label: "Sui Clock (shared object, 0x6)",
  address: "0x0000000000000000000000000000000000000000000000000000000000000006",
  predicate: "object_version",
};

export const SLOW_SUBJECT = {
  id: "memwal-registry",
  class: "SLOW",
  label: "MemWal AccountRegistry (mainnet)",
  address: "0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f",
  predicate: "object_version",
};

export const SUBJECTS = [FAST_SUBJECT, SLOW_SUBJECT];

export const SUBJECT_BY_CLASS = {
  FAST: FAST_SUBJECT,
  SLOW: SLOW_SUBJECT,
};

export function subjectFor(className) {
  const s = SUBJECT_BY_CLASS[className];
  if (!s) throw new Error(`unknown claim class ${className}`);
  return s;
}
