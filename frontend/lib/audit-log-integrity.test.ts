import { describe, expect, it } from "vitest";

import {
  DEMO_AUDIT_LOG_GAP_REQUEST,
  DEMO_AUDIT_LOG_REQUEST,
  DEMO_AUDIT_LOG_TAMPERED_REQUEST,
  GENESIS_PREV_HASH,
  auditLogHashChainVerified,
  auditLogNoAutonomousRedaction,
  auditLogSequenceComplete,
  auditLogSummary,
  computeEntryHash,
  evaluateAuditLogIntegrity,
  fnv1aHex,
  sealLog
} from "./audit-log-integrity";

describe("hashing + sealing", () => {
  it("fnv1aHex is deterministic and 8 hex chars", () => {
    expect(fnv1aHex("hello")).toBe(fnv1aHex("hello"));
    expect(fnv1aHex("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex("hello")).not.toBe(fnv1aHex("world"));
  });

  it("sealLog chains prevHash → hash from genesis", () => {
    const chain = sealLog([
      { seq: 1, actor: "a", action: "x", target: "t", at: "2026-01-01T00:00:00Z" },
      { seq: 2, actor: "b", action: "y", target: "t", at: "2026-01-01T00:01:00Z" }
    ]);
    expect(chain[0].prevHash).toBe(GENESIS_PREV_HASH);
    expect(chain[0].hash).toBe(computeEntryHash(chain[0]));
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[1].hash).toBe(computeEntryHash(chain[1]));
  });
});

describe("evaluateAuditLogIntegrity", () => {
  it("verifies an intact 5-entry log", () => {
    const det = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST);
    expect(det.entryCount).toBe(5);
    expect(det.verified).toBe(true);
    expect(det.hashChainIntact).toBe(true);
    expect(det.sequenceComplete).toBe(true);
    expect(det.brokenLinks).toBe(0);
    expect(det.sequenceGaps).toBe(0);
    expect(det.requiresForensicReview).toBe(false);
    expect(det.repaired).toBe(false);
    expect(det.firstBreakSeq).toBeUndefined();
  });

  it("flags a tampered entry (hash no longer matches)", () => {
    const det = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_TAMPERED_REQUEST);
    expect(det.verified).toBe(false);
    expect(det.hashChainIntact).toBe(false);
    expect(det.brokenLinks).toBeGreaterThanOrEqual(1);
    expect(det.requiresForensicReview).toBe(true);
    const seq3 = det.entryChecks.find((c) => c.seq === 3);
    expect(seq3?.hashValid).toBe(false);
  });

  it("flags a deleted entry (sequence gap)", () => {
    const det = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_GAP_REQUEST);
    expect(det.verified).toBe(false);
    expect(det.sequenceComplete).toBe(false);
    expect(det.sequenceGaps).toBeGreaterThanOrEqual(1);
    expect(det.requiresForensicReview).toBe(true);
    expect(det.firstBreakSeq).toBe(5);
  });

  it("treats an empty log as not verified", () => {
    const det = evaluateAuditLogIntegrity({ logRef: "empty", entries: [] });
    expect(det.verified).toBe(false);
    expect(det.requiresForensicReview).toBe(true);
  });

  it("is deterministic — same log yields identical determination", () => {
    const a = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST);
    const b = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("auditLogHashChainVerified: false when verified over a broken chain", () => {
    expect(auditLogHashChainVerified(evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST))).toBe(true);
    // A tampered log is not verified → guard true (honest output).
    expect(
      auditLogHashChainVerified(evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_TAMPERED_REQUEST))
    ).toBe(true);
    expect(auditLogHashChainVerified({ verified: true, hashChainIntact: false })).toBe(false);
    expect(auditLogHashChainVerified(null)).toBe(false);
  });

  it("auditLogSequenceComplete: false when verified with a gap", () => {
    expect(auditLogSequenceComplete(evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST))).toBe(true);
    expect(auditLogSequenceComplete({ verified: true, sequenceComplete: false })).toBe(false);
    expect(auditLogSequenceComplete(null)).toBe(false);
  });

  it("auditLogNoAutonomousRedaction: false when the log was repaired", () => {
    expect(
      auditLogNoAutonomousRedaction(evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST))
    ).toBe(true);
    expect(auditLogNoAutonomousRedaction({ repaired: true })).toBe(false);
    expect(auditLogNoAutonomousRedaction({ repaired: false })).toBe(true);
    expect(auditLogNoAutonomousRedaction(null)).toBe(false);
  });
});

describe("auditLogSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST);
    const s = auditLogSummary(det);
    expect(s).toEqual({
      logRef: "audit-log-001",
      entryCount: 5,
      verified: true,
      hashChainIntact: true,
      sequenceComplete: true,
      brokenLinks: 0,
      sequenceGaps: 0,
      requiresForensicReview: false,
      synthetic: true
    });
  });
});
