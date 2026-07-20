import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_COMPLEX_PATIENT,
  DEMO_ELIGIBLE_PATIENT,
  DEMO_INELIGIBLE_PATIENT
} from "../../../../../lib/complex-care-management";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/complex-care-management/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

function dataPart(body: {
  result: { artifacts: { parts: { type: string; data?: unknown }[] }[] };
}) {
  return body.result.artifacts[0].parts.find(
    (p: { type: string }) => p.type === "data"
  ) as { type: "data"; data: Record<string, unknown> };
}

describe("POST /api/agents/complex-care-management/tasks", () => {
  it("produces a 99490 CCM month report for the eligible demo (35min); records a parented trace with all signals true", async () => {
    const taskId = "test-ccm-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { context: DEMO_ELIGIBLE_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.eligibilityTracesToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.billingRequiresHumanApproval).toBe(true);
    expect(body.result.metadata.agentFabric.timeEntriesAddUp).toBe(true);
    expect(body.result.metadata.agentFabric.cptCode).toBe("99490");
    expect(body.result.metadata.agentFabric.eligible).toBe(true);
    expect(body.result.metadata.agentFabric.totalMinutes).toBe(35);

    const data = dataPart(body).data as {
      result: {
        report: {
          billingPackage: { requiresQualityTeamApproval: boolean; submitted: boolean } | null;
        };
      };
    };
    expect(data.result.report.billingPackage?.requiresQualityTeamApproval).toBe(true);
    expect(data.result.report.billingPackage?.submitted).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("ccm.evaluate-eligibility");
    expect(ops).toContain("ccm.summarize-time");
    expect(ops).toContain("ccm.assemble-billing-package");
    const elig = spans.find((s) => s.operation === "ccm.evaluate-eligibility");
    expect(elig?.agentId).toBe("complex-care-management-agent");
    expect(elig?.attributes?.phiAccessed).toBe(true);
  });

  it("produces a complex-CCM 99487 package for the moderate/high complexity demo (72min)", async () => {
    const taskId = "test-ccm-complex-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { context: DEMO_COMPLEX_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.cptCode).toBe("99487");
    expect(body.result.metadata.agentFabric.totalMinutes).toBe(72);
  });

  it("returns an ineligible report for a patient below Medicare age (no billing package)", async () => {
    const taskId = "test-ccm-ineligible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { context: DEMO_INELIGIBLE_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.eligible).toBe(false);
    expect(body.result.metadata.agentFabric.cptCode).toBe("NOT_BILLABLE");
    const data = dataPart(body).data as {
      result: { report: { billingPackage: unknown } };
    };
    expect(data.result.report.billingPackage).toBeNull();
  });

  it("blocks an off-catalog chronic-condition eligibility override (eligibility-catalog-sourced)", async () => {
    const taskId = "test-ccm-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: DEMO_ELIGIBLE_PATIENT,
                eligibilityOverride: {
                  eligible: true,
                  qualifyingConditions: [
                    "condition.hypertension",
                    "condition.made-up"
                  ],
                  hasTwoOrMoreConditions: true,
                  meetsAgeGate: true,
                  medicareCoverageOnFile: true,
                  consentOnFile: true,
                  ineligibilityReasons: []
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.ccm.eligibility-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "ccm.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "ccm.evaluate-eligibility")).toBe(false);
  });

  it("blocks an autonomously-submitted CCM claim (no-autonomous-billing)", async () => {
    const taskId = "test-ccm-auto-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: DEMO_ELIGIBLE_PATIENT,
                billingOverride: {
                  state: "ready-for-quality-team-review",
                  patientRef: DEMO_ELIGIBLE_PATIENT.patientRef,
                  month: DEMO_ELIGIBLE_PATIENT.month,
                  totalMinutes: 35,
                  cptCode: "99490",
                  complexity: "non-complex",
                  requiresQualityTeamApproval: false,
                  submitted: true,
                  packageId: "override",
                  body: "override"
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.ccm.no-autonomous-billing");
  });

  it("blocks a time report that doesn't add up (time-integrity: phantom minutes)", async () => {
    const taskId = "test-ccm-phantom-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: DEMO_ELIGIBLE_PATIENT,
                // Entries sum to 35, but claim 60 → phantom minutes.
                timeSummaryOverride: {
                  perActivity: [],
                  totalMinutes: 60,
                  everyActivityIsCatalogSourced: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.ccm.time-integrity");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/complex-care-management/tasks", {
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
      new Request("http://localhost/api/agents/complex-care-management/tasks", {
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
