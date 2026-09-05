/**
 * Audit Log Integrity (Tamper-Evidence) — the deterministic, transparent data-substrate layer
 * that VERIFIES an audit trail is tamper-evident: it recomputes the log's hash chain, checks
 * for sequence gaps (a deleted entry), and decides whether the log is intact — flagging any
 * break for human forensic review while NEVER rewriting the log itself.
 *
 * Deterministic, dependency-free domain core the Audit Log Integrity Agent
 * (app/api/agents/audit-log-integrity) wraps — a control-plane / data-substrate service on the
 * platform plane of Pause's Agent Fabric. Every agent on the fabric writes a HIPAA audit span;
 * THIS agent verifies the audit trail itself. Given an audit log (an ordered list of entries,
 * each carrying a sequence number, actor, action, target, timestamp, the prior entry's hash,
 * and its own hash), it DETERMINISTICALLY recomputes each entry's hash and the chain links,
 * checks the sequence numbers for gaps, and decides whether the log is verified (hash chain
 * intact AND sequence complete).
 *
 *   Inbound:  an AuditLogVerificationRequest { logRef, entries[] }
 *   Outbound: an AuditLogDetermination { verified, hashChainIntact, sequenceComplete,
 *             brokenLinks, sequenceGaps, firstBreakSeq?, entryChecks[], repaired:false,
 *             requiresForensicReview, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform / data-substrate agents:
 * distinct from the Consent & Preferences Management agent (whether a patient may be contacted
 * / data used), the De-Identification & Safe Harbor agent (whether a dataset is no longer PHI),
 * the Minimum Necessary agent (how much PHI a purpose may see), the Master Patient Index
 * (identity / dedup), the Break-the-Glass agent (emergency PHI access), and the Data Retention
 * agent (records disposition): this verifies that the AUDIT TRAIL of everything the fabric did
 * has not been tampered with.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a verified log always has an intact hash chain.
 * ─────────────────────────────────────────────────────────────────────
 *  A log may be marked `verified` only if every entry's recomputed hash matches and every
 *  link's recorded prevHash matches the prior entry's hash — a single broken link is tampering.
 *  Asserting a verified log over a broken chain hides tampering. auditLogHashChainVerified()
 *  reports the honest signal the Agent Fabric enforces via policy.auditlog.hash-chain-verified.
 *  (Mirrors the Minimum Necessary Agent's minimum-necessary-scoped — an integrity obligation
 *  that cannot be skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a verified log always has a complete sequence.
 * ─────────────────────────────────────────────────────────────────────
 *  A log may be marked `verified` only if its sequence numbers are contiguous — a gap means an
 *  entry was deleted, which the hash chain alone would not catch if the deletion were at the
 *  tail. Asserting a verified log with a sequence gap hides a deleted record.
 *  auditLogSequenceComplete() reports the honest signal the Agent Fabric enforces via
 *  policy.auditlog.sequence-complete. (This is the load-bearing completeness gate.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the agent never autonomously redacts / repairs the log.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent VERIFIES and FLAGS — it NEVER deletes, rewrites, re-seals, or "repairs" an audit
 *  entry. A broken log is flagged for human forensic review; a determination that claims it
 *  repaired / mutated the log is dishonest and dangerous (it would destroy evidence).
 *  auditLogNoAutonomousRedaction() reports the honest signal the Agent Fabric enforces via
 *  policy.auditlog.no-autonomous-redaction. (Mirrors the Data Retention Agent's
 *  no-autonomous-purge and the Minimum Necessary Agent's no-autonomous-over-disclosure posture
 *  — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — verified OR tampered — is a SAFE, honest OUTPUT: the task COMPLETES (a
 *  tampered / incomplete log carries requiresForensicReview:true). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (a verified log over a broken chain, a verified
 *  log with a sequence gap, or a claim that the log was repaired) — which the Agent Fabric
 *  rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified tamper-evidence system.
 * ─────────────────────────────────────────────────────────────────────
 *  The hash function below is a small, dependency-free, NON-cryptographic FNV-1a chosen to
 *  model the SHAPE of a hash-chained, tamper-evident audit log deterministically in the demo —
 *  it is NOT a cryptographic hash and NOT a certified tamper-evidence system. A REAL audit-log
 *  integrity control uses a cryptographic hash (e.g. SHA-256), append-only / WORM storage, and
 *  signed checkpoints. There is NO randomness and NO clock anywhere here: verification is a pure
 *  function of the log's entries (no Date.now()), so the same log always yields the same
 *  verified / hash-chain / sequence result — which is what lets the demo, the seeded trace, and
 *  the tests agree.
 */

/** The genesis prevHash the first entry chains from. */
export const GENESIS_PREV_HASH = "genesis";

/**
 * A small, dependency-free, NON-cryptographic FNV-1a 32-bit hash → 8-hex-char string. Chosen so
 * the hash chain is isomorphic (runs identically in the node route, the browser panel, and the
 * tests) with no crypto dependency. NOT cryptographically secure — see the header.
 */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** An audit-log entry. */
export type AuditLogEntry = {
  /** The monotonic sequence number. */
  seq: number;
  /** The actor who performed the action. */
  actor: string;
  /** The action performed. */
  action: string;
  /** The target of the action (e.g. a patient ref). */
  target: string;
  /** The ISO timestamp (treated as data — no clock). */
  at: string;
  /** The recorded hash of the prior entry (or GENESIS_PREV_HASH for the first). */
  prevHash: string;
  /** The recorded hash of this entry. */
  hash: string;
};

/** The canonical string an entry's hash is computed over (all fields except its own hash). */
export function canonicalEntry(
  entry: Pick<AuditLogEntry, "seq" | "actor" | "action" | "target" | "at" | "prevHash">
): string {
  return `${entry.seq}|${entry.actor}|${entry.action}|${entry.target}|${entry.at}|${entry.prevHash}`;
}

/** Compute an entry's hash from its content. */
export function computeEntryHash(
  entry: Pick<AuditLogEntry, "seq" | "actor" | "action" | "target" | "at" | "prevHash">
): string {
  return fnv1aHex(canonicalEntry(entry));
}

/** A raw (un-sealed) entry — content without the chain fields. */
export type RawAuditEntry = Pick<
  AuditLogEntry,
  "seq" | "actor" | "action" | "target" | "at"
>;

/**
 * Seal a list of raw entries into a valid hash chain — fills each entry's prevHash (the prior
 * entry's hash, or genesis) and its hash. Deterministic; used to build fixtures + the demo log.
 */
export function sealLog(raw: RawAuditEntry[]): AuditLogEntry[] {
  let prev = GENESIS_PREV_HASH;
  return raw.map((e) => {
    const withPrev = { ...e, prevHash: prev };
    const hash = computeEntryHash(withPrev);
    prev = hash;
    return { ...withPrev, hash };
  });
}

/** An audit-log verification request. */
export type AuditLogVerificationRequest = {
  /** Synthetic log reference. */
  logRef: string;
  /** The ordered audit-log entries. */
  entries: AuditLogEntry[];
};

/** A per-entry integrity check. */
export type EntryCheck = {
  /** The entry's sequence number. */
  seq: number;
  /** Whether the entry's recorded hash matches its recomputed hash. */
  hashValid: boolean;
  /** Whether the entry's prevHash matches the prior entry's hash (or genesis for the first). */
  linkValid: boolean;
  /** Whether the sequence number follows the prior entry's (no gap). */
  sequenceValid: boolean;
  /** Human-readable issue, if any. */
  issue?: string;
};

/** The deterministic audit-log integrity determination the agent returns. */
export type AuditLogDetermination = {
  /** Synthetic log reference. */
  logRef: string;
  /** The number of entries verified. */
  entryCount: number;
  /** Whether the log is verified (hash chain intact AND sequence complete). */
  verified: boolean;
  /** Whether every hash + link checks out. */
  hashChainIntact: boolean;
  /** Whether the sequence numbers are contiguous. */
  sequenceComplete: boolean;
  /** The number of broken links (bad hash or bad prevHash). */
  brokenLinks: number;
  /** The number of sequence gaps. */
  sequenceGaps: number;
  /** The sequence number of the first detected break (undefined when verified). */
  firstBreakSeq?: number;
  /** The per-entry checks. */
  entryChecks: EntryCheck[];
  /** Always false — the agent never repairs / rewrites the log. */
  repaired: false;
  /** Whether the determination requires human forensic review (any break). */
  requiresForensicReview: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the hash is non-cryptographic / illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic audit-log integrity function — the heart of the service. DETERMINISTIC: a
 * pure function of the log's entries (no randomness, no clock). It recomputes each entry's hash
 * (hashValid), verifies each link against the prior entry's hash (linkValid), checks the
 * sequence numbers for gaps (sequenceValid), then decides whether the log is verified (hash
 * chain intact AND sequence complete). Nothing is rewritten here — a broken log is FLAGGED for
 * forensic review, never repaired.
 */
export function evaluateAuditLogIntegrity(
  request: AuditLogVerificationRequest
): AuditLogDetermination {
  const entries = Array.isArray(request.entries) ? request.entries : [];

  const entryChecks: EntryCheck[] = entries.map((entry, i) => {
    const expectedHash = computeEntryHash(entry);
    const hashValid = entry.hash === expectedHash;
    const linkValid =
      i === 0
        ? entry.prevHash === GENESIS_PREV_HASH
        : entry.prevHash === entries[i - 1].hash;
    const sequenceValid = i === 0 ? true : entry.seq === entries[i - 1].seq + 1;

    const issues: string[] = [];
    if (!hashValid) issues.push("entry hash does not match its content (entry altered)");
    if (!linkValid) issues.push("prevHash does not match the prior entry's hash (chain broken)");
    if (!sequenceValid) issues.push("sequence gap (an entry may have been deleted)");

    return {
      seq: entry.seq,
      hashValid,
      linkValid,
      sequenceValid,
      ...(issues.length > 0 ? { issue: issues.join("; ") } : {})
    };
  });

  const brokenLinks = entryChecks.filter((c) => !c.hashValid || !c.linkValid).length;
  const sequenceGaps = entryChecks.filter((c) => !c.sequenceValid).length;
  const hashChainIntact = brokenLinks === 0;
  const sequenceComplete = sequenceGaps === 0;
  const verified = entries.length > 0 && hashChainIntact && sequenceComplete;

  const firstBreak = entryChecks.find(
    (c) => !c.hashValid || !c.linkValid || !c.sequenceValid
  );
  const firstBreakSeq = firstBreak?.seq;
  const requiresForensicReview = !verified;

  const reason = verified
    ? `Audit log ${request.logRef}: VERIFIED — hash chain intact and sequence complete across ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`
    : entries.length === 0
      ? `Audit log ${request.logRef}: empty — nothing to verify; forensic review required`
      : `Audit log ${request.logRef}: TAMPER SUSPECTED — ${brokenLinks} broken link(s), ${sequenceGaps} sequence gap(s)${firstBreakSeq !== undefined ? ` (first break at seq ${firstBreakSeq})` : ""}; flagged for forensic review, NOT repaired`;

  return {
    logRef: request.logRef,
    entryCount: entries.length,
    verified,
    hashChainIntact,
    sequenceComplete,
    brokenLinks,
    sequenceGaps,
    firstBreakSeq,
    entryChecks,
    repaired: false,
    requiresForensicReview,
    reason,
    synthetic: true,
    note:
      `Audit-log integrity check for ${request.logRef}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${brokenLinks} broken link(s), ${sequenceGaps} sequence gap(s), verified=${verified}. ` +
      "Synthetic/illustrative NON-cryptographic FNV-1a hash chain — NOT a certified tamper-evidence system; a real control uses a cryptographic hash (SHA-256), append-only / WORM storage, and signed checkpoints."
  };
}

/**
 * Hash-chain-verified check: is the log NOT marked verified over a broken chain? True unless a
 * determination claims `verified` while its hash chain is not intact; the guard that catches
 * hiding tampering behind a verified label. Anything evaluateAuditLogIntegrity() produces
 * satisfies it. This is the honest signal the route reports to
 * policy.auditlog.hash-chain-verified. A non-object input is a violation.
 */
export function auditLogHashChainVerified(
  determination:
    | Pick<AuditLogDetermination, "verified" | "hashChainIntact">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(determination.verified === true && determination.hashChainIntact === false);
}

/**
 * Sequence-complete check: is the log NOT marked verified with a sequence gap? True unless a
 * determination claims `verified` while its sequence is not complete; the guard that catches
 * hiding a deleted entry behind a verified label. Anything evaluateAuditLogIntegrity() produces
 * satisfies it. This is the honest signal the route reports to policy.auditlog.sequence-complete.
 * A non-object input is a violation.
 */
export function auditLogSequenceComplete(
  determination:
    | Pick<AuditLogDetermination, "verified" | "sequenceComplete">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(determination.verified === true && determination.sequenceComplete === false);
}

/**
 * No-autonomous-redaction check: did the agent avoid redacting / repairing the log? True unless
 * a determination claims it repaired / rewrote the log; the guard that catches an autonomous
 * mutation of the audit trail (which would destroy evidence). Anything
 * evaluateAuditLogIntegrity() produces satisfies it (repaired is always false). This is the
 * honest signal the route reports to policy.auditlog.no-autonomous-redaction. A non-object
 * input is a violation.
 */
export function auditLogNoAutonomousRedaction(
  determination: { repaired?: boolean } | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return determination.repaired !== true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`. Carries no entry-level content (ref, counts, and flags only).
 */
export function auditLogSummary(determination: AuditLogDetermination): {
  logRef: string;
  entryCount: number;
  verified: boolean;
  hashChainIntact: boolean;
  sequenceComplete: boolean;
  brokenLinks: number;
  sequenceGaps: number;
  requiresForensicReview: boolean;
  synthetic: boolean;
} {
  return {
    logRef: determination.logRef,
    entryCount: determination.entryCount,
    verified: determination.verified,
    hashChainIntact: determination.hashChainIntact,
    sequenceComplete: determination.sequenceComplete,
    brokenLinks: determination.brokenLinks,
    sequenceGaps: determination.sequenceGaps,
    requiresForensicReview: determination.requiresForensicReview,
    synthetic: determination.synthetic
  };
}

/** The raw entries the demo logs are sealed from (illustrative / synthetic). */
const DEMO_RAW_ENTRIES: RawAuditEntry[] = [
  { seq: 1, actor: "care-router-agent", action: "route", target: "patient-abc", at: "2026-09-05T14:00:00Z" },
  { seq: 2, actor: "lab-result-agent", action: "classify", target: "patient-abc", at: "2026-09-05T14:01:00Z" },
  { seq: 3, actor: "break-the-glass-agent", action: "grant-emergency-access", target: "patient-abc", at: "2026-09-05T14:02:00Z" },
  { seq: 4, actor: "minimum-necessary-agent", action: "scope-disclosure", target: "patient-abc", at: "2026-09-05T14:03:00Z" },
  { seq: 5, actor: "deidentification-agent", action: "screen-safe-harbor", target: "dataset-xyz", at: "2026-09-05T14:04:00Z" }
];

/**
 * A representative demo request with an intact log (illustrative). A sealed 5-entry chain →
 * verified. Synthetic.
 */
export const DEMO_AUDIT_LOG_REQUEST: AuditLogVerificationRequest = {
  logRef: "audit-log-001",
  entries: sealLog(DEMO_RAW_ENTRIES)
};

/**
 * A representative demo request with a TAMPERED entry (illustrative). A sealed chain whose 3rd
 * entry's action was altered after sealing (its stored hash no longer matches) → not verified,
 * forensic review. Synthetic.
 */
export const DEMO_AUDIT_LOG_TAMPERED_REQUEST: AuditLogVerificationRequest = {
  logRef: "audit-log-002",
  entries: sealLog(DEMO_RAW_ENTRIES).map((e) =>
    e.seq === 3 ? { ...e, action: "delete-record" } : e
  )
};

/**
 * A representative demo request with a DELETED entry (illustrative). A sealed chain with entry
 * seq 4 removed → sequence gap (3 → 5) → not verified, forensic review. Synthetic.
 */
export const DEMO_AUDIT_LOG_GAP_REQUEST: AuditLogVerificationRequest = {
  logRef: "audit-log-003",
  entries: sealLog(DEMO_RAW_ENTRIES).filter((e) => e.seq !== 4)
};
