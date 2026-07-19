import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/transitions-of-care/tasks", {
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

const PATIENT = {
  patientRef: "toc-patient-001",
  dischargeDate: "2026-07-01",
  encounterKind: "hospitalization" as const,
  encounterReasonCategory: "cardiovascular" as const,
  preAdmitMedications: [
    {
      medicationId: "med.metoprolol-25",
      label: "Metoprolol",
      dose: "25 mg PO BID",
      source: "pre-admit-verified"
    }
  ],
  dischargeMedications: [
    {
      medicationId: "med.metoprolol-25",
      label: "Metoprolol",
      dose: "50 mg PO BID",
      source: "discharge-order"
    },
    {
      medicationId: "med.apixaban-5",
      label: "Apixaban",
      dose: "5 mg PO BID",
      source: "discharge-order"
    }
  ],
  scheduledFollowUp: {
    slotStart: "2026-07-08T15:00:00Z",
    providerRef: "provider-card-001",
    providerLabel: "Dr. K. Patel · Cardiology",
    modality: "telehealth" as const
  }
};

const AWAITING_PATIENT = {
  patientRef: "toc-patient-002",
  dischargeDate: "2026-07-01",
  encounterKind: "ed-visit" as const,
  encounterReasonCategory: "behavioral" as const,
  preAdmitMedications: [],
  dischargeMedications: [
    {
      medicationId: "med.sertraline-50",
      label: "Sertraline",
      dose: "50 mg PO daily",
      source: "discharge-order"
    }
  ]
};

describe("POST /api/agents/transitions-of-care/tasks", () => {
  it("assembles a happy-path TOC package (scheduled follow-up) and records a parented trace", async () => {
    const taskId = "test-toc-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { patient: PATIENT } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.medicationsTraceToApprovedSource).toBe(true);
    expect(body.result.metadata.agentFabric.reconciliationChangeRequiresClinician).toBe(true);
    expect(body.result.metadata.agentFabric.followUpScheduledNotRecommended).toBe(true);
    expect(body.result.metadata.agentFabric.packageState).toBe("ready-for-clinician-signoff");
    expect(body.result.metadata.agentFabric.followUpScheduled).toBe(true);

    const data = dataPart(body).data as {
      result: {
        package: {
          reconciliation: {
            lines: { changeKind: string; medicationId: string }[];
            requiresClinicianSignoff: boolean;
            applied: boolean;
          };
          followUp: { scheduled: boolean; awaitingSchedule: boolean };
        };
        proposal: { requiresClinicianSignoff: boolean; applied: boolean } | null;
      };
    };
    expect(data.result.package.reconciliation.lines.some((l) => l.changeKind === "dose-changed")).toBe(true);
    expect(data.result.package.reconciliation.requiresClinicianSignoff).toBe(true);
    expect(data.result.package.reconciliation.applied).toBe(false);
    expect(data.result.package.followUp.scheduled).toBe(true);
    expect(data.result.package.followUp.awaitingSchedule).toBe(false);
    expect(data.result.proposal?.requiresClinicianSignoff).toBe(true);
    expect(data.result.proposal?.applied).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("toc.reconcile");
    expect(ops).toContain("toc.assemble-package");
    const reconcile = spans.find((s) => s.operation === "toc.reconcile");
    expect(reconcile?.agentId).toBe("transitions-of-care-agent");
    expect(reconcile?.attributes?.phiAccessed).toBe(true);
  });

  it("returns awaiting-schedule when no follow-up is booked (a safe interim answer)", async () => {
    const taskId = "test-toc-await-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { patient: AWAITING_PATIENT } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // Awaiting-schedule is a SAFE completed answer (satisfies the follow-up signal).
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.followUpScheduledNotRecommended).toBe(true);
    expect(body.result.metadata.agentFabric.followUpAwaitingSchedule).toBe(true);
    expect(body.result.metadata.agentFabric.packageState).toBe("awaiting-schedule");
  });

  it("blocks a reconciliation with a verbal / off-source medication (reconciliation-source-integrity)", async () => {
    const taskId = "test-toc-verbal-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: {
                  ...PATIENT,
                  dischargeMedications: [
                    {
                      medicationId: "med.metoprolol-25",
                      label: "Metoprolol",
                      dose: "50 mg PO BID",
                      source: "verbal-not-documented"
                    }
                  ]
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
    expect(violationIds).toContain("policy.toc.reconciliation-source-integrity");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "toc.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "toc.reconcile")).toBe(false);
  });

  it("blocks an autonomously-applied medication change (no-autonomous-medication-change)", async () => {
    const taskId = "test-toc-auto-med-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                proposals: [
                  {
                    medicationId: "med.metoprolol-25",
                    changeKind: "dose-changed",
                    rationale: "auto",
                    requiresClinicianSignoff: false,
                    applied: true
                  }
                ]
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
    expect(violationIds).toContain("policy.toc.no-autonomous-medication-change");
  });

  it("blocks a follow-up marked scheduled without a real slot (follow-up-scheduled-not-recommended)", async () => {
    const taskId = "test-toc-fake-schedule-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                followUpPlan: {
                  scheduled: true,
                  awaitingSchedule: false
                  // no slotStart / providerRef — a 'recommended' follow-up
                  // masquerading as complete.
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
    expect(violationIds).toContain("policy.toc.follow-up-scheduled-not-recommended");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/transitions-of-care/tasks", {
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
      new Request("http://localhost/api/agents/transitions-of-care/tasks", {
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
