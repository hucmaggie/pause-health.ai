import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_REQUEST
} from "../../../../../lib/identifier-validation";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/identifier-validation/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the 3-identifier demo — the block base. */
const VALID_DETERMINATION = {
  batchRef: "npi-batch-001",
  identifiers: [
    { npi: "1234567893", providerLabel: "Dr. Alice Valid" },
    { npi: "1234567890", providerLabel: "Dr. Bob Transposed" },
    { npi: "99999", providerLabel: "Dr. Carol Malformed" }
  ],
  results: [
    {
      npi: "1234567893",
      providerLabel: "Dr. Alice Valid",
      disposition: "valid",
      expectedCheckDigit: 3,
      actualCheckDigit: 3,
      reason: ""
    },
    {
      npi: "1234567890",
      providerLabel: "Dr. Bob Transposed",
      disposition: "invalid-checksum",
      expectedCheckDigit: 3,
      actualCheckDigit: 0,
      reason: ""
    },
    {
      npi: "99999",
      providerLabel: "Dr. Carol Malformed",
      disposition: "invalid-format",
      expectedCheckDigit: null,
      actualCheckDigit: null,
      reason: ""
    }
  ],
  total: 3,
  validCount: 1,
  invalidFormatCount: 1,
  invalidChecksumCount: 1,
  disposition: "invalids-flagged",
  requiresStewardReview: true,
  autoRejected: false
};

describe("POST /api/agents/identifier-validation/tasks", () => {
  it("invalids-flagged → completed, with a parented NOT-PHI trace", async () => {
    const taskId = "test-iv-flagged-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_IDENTIFIER_VALIDATION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("invalids-flagged");
    expect(body.result.metadata.agentFabric.validCount).toBe(1);
    expect(body.result.metadata.agentFabric.identifiersSourced).toBe(true);
    expect(body.result.metadata.agentFabric.checksumConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.identifierNoAutonomousReject).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("identifier.receive-batch");
    expect(ops).toContain("identifier.validate-checksums");
    expect(ops).toContain("identifier.classify-disposition");
    expect(ops).toContain("identifier.log-audit");
    const validateSpan = spans.find((s) => s.operation === "identifier.validate-checksums");
    expect(validateSpan?.agentId).toBe("identifier-validation-agent");
    expect(validateSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("all-valid → completed", async () => {
    const taskId = "test-iv-valid-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-valid");
    expect(body.result.metadata.agentFabric.validCount).toBe(3);
  });

  it("single malformed NPI → completed, invalids-flagged", async () => {
    const taskId = "test-iv-format-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("invalids-flagged");
    expect(body.result.metadata.agentFabric.invalidFormatCount).toBe(1);
  });

  it("blocks a fabricated identifier result (identifiers-sourced)", async () => {
    const taskId = "test-iv-fabricated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  results: [
                    ...VALID_DETERMINATION.results,
                    {
                      npi: "0000000000",
                      providerLabel: "Phantom",
                      disposition: "invalid-format",
                      expectedCheckDigit: null,
                      actualCheckDigit: null,
                      reason: ""
                    }
                  ],
                  total: 4,
                  invalidFormatCount: 2
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.identifier.identifiers-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "identifier.validate-checksums.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "identifier.log-audit")).toBe(false);
  });

  it("blocks a miscomputed check digit (checksum-consistent)", async () => {
    const taskId = "test-iv-checksum-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  results: [
                    VALID_DETERMINATION.results[0],
                    {
                      npi: "1234567890",
                      providerLabel: "Dr. Bob Transposed",
                      disposition: "valid",
                      expectedCheckDigit: 0,
                      actualCheckDigit: 0,
                      reason: ""
                    },
                    VALID_DETERMINATION.results[2]
                  ],
                  validCount: 2,
                  invalidChecksumCount: 0
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.identifier.checksum-consistent");
  });

  it("blocks an autonomous reject (no-autonomous-reject)", async () => {
    const taskId = "test-iv-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresStewardReview: false,
                  autoRejected: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.identifier.no-autonomous-reject");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/identifier-validation/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/identifier-validation/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
