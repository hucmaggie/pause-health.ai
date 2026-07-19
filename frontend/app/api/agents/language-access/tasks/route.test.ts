import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/language-access/tasks", {
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

const SPANISH_PATIENT = {
  patientRef: "langaccess-patient-001",
  preferredLanguageCode: "es",
  requiresConsentStep: true
};

const RARE_PATIENT = {
  patientRef: "langaccess-patient-002",
  preferredLanguageCode: "ff",
  requiresConsentStep: true
};

describe("POST /api/agents/language-access/tasks", () => {
  it("assesses a Spanish patient, arranges a qualified interpreter; records a parented trace", async () => {
    const taskId = "test-langaccess-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: SPANISH_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.usesQualifiedInterpreter).toBe(true);
    expect(body.result.metadata.agentFabric.materialsTraceToApprovedSource).toBe(true);
    expect(body.result.metadata.agentFabric.noMachineTranslationForConsent).toBe(true);
    expect(body.result.metadata.agentFabric.interpreterState).toBe("arranged");
    expect(body.result.metadata.agentFabric.recommendedModality).toBe("video");
    expect(body.result.metadata.agentFabric.equityGapCount).toBe(0);

    const data = dataPart(body).data as {
      result: {
        assessment: { interpreterNeeded: boolean; equityGaps: unknown[] };
        interpreterRequest: { state: string; qualified: boolean };
      };
    };
    expect(data.result.assessment.interpreterNeeded).toBe(true);
    expect(data.result.interpreterRequest.qualified).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("langaccess.detect-language");
    expect(ops).toContain("langaccess.assess");
    expect(ops).toContain("langaccess.arrange-interpreter");
    const assess = spans.find((s) => s.operation === "langaccess.assess");
    expect(assess?.agentId).toBe("language-access-agent");
    expect(assess?.attributes?.phiAccessed).toBe(true);
  });

  it("surfaces an equity gap (no qualified interpreter → escalation) but still COMPLETES (safe, not a block)", async () => {
    const taskId = "test-langaccess-equitygap-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: RARE_PATIENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // Surfacing an equity gap is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.qualifiedInterpreterAvailable).toBe(false);
    expect(body.result.metadata.agentFabric.interpreterState).toBe("equity-gap-escalation");
    // Still qualified-only — it never proposes an unqualified fallback.
    expect(body.result.metadata.agentFabric.usesQualifiedInterpreter).toBe(true);
    expect(body.result.metadata.agentFabric.equityGapCount).toBeGreaterThan(0);
  });

  it("blocks a family / ad-hoc interpreter for clinical use (qualified-interpreter-only)", async () => {
    const taskId = "test-langaccess-family-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: SPANISH_PATIENT,
                interpreterPlan: { interpreterType: "family", qualified: false }
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
    expect(violationIds).toContain("policy.langaccess.qualified-interpreter-only");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "langaccess.assess.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "langaccess.assess")).toBe(false);
  });

  it("blocks an unapproved / ad-hoc translation presented as official (source-integrity)", async () => {
    const taskId = "test-langaccess-material-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: SPANISH_PATIENT,
                materials: [
                  {
                    materialId: "material.clinical-consent-form",
                    languageCode: "vi",
                    available: true
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
    expect(violationIds).toContain(
      "policy.langaccess.translated-material-source-integrity"
    );
  });

  it("blocks machine-translating clinical consent (no-machine-translation-for-consent)", async () => {
    const taskId = "test-langaccess-machine-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: SPANISH_PATIENT,
                consentPlan: {
                  translationMethod: "machine-translation",
                  forClinicalConsent: true
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
    expect(violationIds).toContain(
      "policy.langaccess.no-machine-translation-for-consent"
    );
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/language-access/tasks", {
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
      new Request("http://localhost/api/agents/language-access/tasks", {
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
