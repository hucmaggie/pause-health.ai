import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/advance-care-planning/tasks", {
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

const EN_PATIENT = {
  patientRef: "acp-patient-001",
  preferredLanguageCode: "en",
  asOfDate: "2026-07-01",
  directivesOnFile: [
    {
      directiveId: "directive.dpoahc",
      source: "attorney-executed",
      executedDate: "2023-04-12",
      languageCode: "en"
    }
  ]
};

const LEP_PATIENT_NO_INTERPRETER = {
  patientRef: "acp-patient-002",
  preferredLanguageCode: "es",
  asOfDate: "2026-07-01",
  qualifiedInterpreterPlanned: false,
  directivesOnFile: []
};

describe("POST /api/agents/advance-care-planning/tasks", () => {
  it("assesses an English patient and drafts an actionable prompt; records a parented trace", async () => {
    const taskId = "test-acp-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: EN_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.directivesTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.directiveChangeRequiresHumanSignoff).toBe(true);
    expect(body.result.metadata.agentFabric.languageAccessSatisfied).toBe(true);
    expect(body.result.metadata.agentFabric.conversationPromptState).toBe("drafted");

    const data = dataPart(body).data as {
      result: {
        assessment: { conversationPrompt: { state: string; actionable: boolean } };
        proposal: { requiresClinicianAndPatientSignoff: boolean; applied: boolean };
      };
    };
    expect(data.result.assessment.conversationPrompt.state).toBe("drafted");
    expect(data.result.assessment.conversationPrompt.actionable).toBe(true);
    expect(data.result.proposal.requiresClinicianAndPatientSignoff).toBe(true);
    expect(data.result.proposal.applied).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("acp.assess");
    expect(ops).toContain("acp.draft-conversation");
    const assess = spans.find((s) => s.operation === "acp.assess");
    expect(assess?.agentId).toBe("advance-care-planning-agent");
    expect(assess?.attributes?.phiAccessed).toBe(true);
  });

  it("WITHHOLDS the prompt for an LEP patient with no interpreter plan (a safe answer, not a block)", async () => {
    const taskId = "test-acp-lep-withhold-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: LEP_PATIENT_NO_INTERPRETER } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // Withholding an active prompt for an LEP patient is a SAFE completed answer.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.conversationPromptState).toBe(
      "withheld-language-access-required"
    );
    // languageAccessSatisfied is still true — the safe withhold satisfies it.
    expect(body.result.metadata.agentFabric.languageAccessSatisfied).toBe(true);
  });

  it("blocks a claimed directive with a verbal / off-catalog source (directive-source-integrity)", async () => {
    const taskId = "test-acp-verbal-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: EN_PATIENT,
                onFile: [
                  {
                    directiveId: "directive.dpoahc",
                    source: "verbal-not-documented",
                    executedDate: "2024-01-01"
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
    expect(violationIds).toContain("policy.acp.directive-source-integrity");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "acp.assess.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "acp.assess")).toBe(false);
  });

  it("blocks an autonomously-applied directive change (no-autonomous-directive-change)", async () => {
    const taskId = "test-acp-auto-apply-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: EN_PATIENT,
                proposal: [
                  {
                    directiveId: "directive.living-will",
                    proposedChange: "auto-execute",
                    requiresClinicianAndPatientSignoff: false,
                    applied: true,
                    state: "applied"
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
    expect(violationIds).toContain("policy.acp.no-autonomous-directive-change");
  });

  it("blocks an active ACP conversation for an LEP patient with no interpreter (language-access-integrity)", async () => {
    const taskId = "test-acp-lep-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: LEP_PATIENT_NO_INTERPRETER,
                plan: {
                  preferredLanguageCode: "es",
                  qualifiedInterpreterPlanned: false,
                  conversationPromptState: "drafted"
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
    expect(violationIds).toContain("policy.acp.language-access-integrity");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/advance-care-planning/tasks", {
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
      new Request("http://localhost/api/agents/advance-care-planning/tasks", {
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
