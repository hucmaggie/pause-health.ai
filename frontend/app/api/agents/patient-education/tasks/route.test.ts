import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable mock for the dynamically-imported Anthropic SDK (the coach half
// calls it), mirroring lib/care-router.test.ts. The tests must NOT require a
// real ANTHROPIC_API_KEY — the SDK is mocked and the key is toggled per test.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/patient-education/tasks", {
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

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_MODEL = process.env.PAUSE_PATIENT_EDUCATION_MODEL;

describe("POST /api/agents/patient-education/tasks", () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PAUSE_PATIENT_EDUCATION_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.PAUSE_PATIENT_EDUCATION_MODEL;
    else process.env.PAUSE_PATIENT_EDUCATION_MODEL = ORIGINAL_MODEL;
  });

  it("curates a curriculum and coaches via the scripted fallback (no key)", async () => {
    const taskId = "test-patiented-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: {
                  preferredName: "Ada",
                  ageBand: "45-49",
                  cycleStatus: "perimenopausal",
                  primarySymptom: "vasomotor",
                  severity: "moderate"
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.educationTracesToEvidenceSource).toBe(true);
    expect(body.result.metadata.agentFabric.coachingVia).toBe("scripted-fallback");
    expect(body.result.metadata.agentFabric.fallbackReason).toMatch(
      /ANTHROPIC_API_KEY not set/
    );

    const data = dataPart(body).data as {
      curriculum: { moduleIds: string[]; modules: unknown[] };
      coaching: { via: string; coachingMessage: string; fallbackReason?: string };
    };
    expect(data.curriculum.moduleIds).toContain("education.vasomotor");
    expect(data.curriculum.moduleIds.length).toBeGreaterThan(0);
    expect(data.coaching.via).toBe("scripted-fallback");
    expect(data.coaching.coachingMessage).toMatch(/does not diagnose/i);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("patient-education.curate");
    expect(ops).toContain("patient-education.coach");
    const curate = spans.find((s) => s.operation === "patient-education.curate");
    expect(curate?.agentId).toBe("patient-education-agent");
    expect(curate?.attributes?.educationTracesToEvidenceSource).toBe(true);
    const coach = spans.find((s) => s.operation === "patient-education.coach");
    expect(coach?.attributes?.via).toBe("scripted-fallback");
    expect(coach?.attributes?.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The coach span is parented to the curate span.
    expect(coach?.parentSpanId).toBe(curate?.id);
  });

  it("records via: claude-api with no fallbackReason on a mocked live success", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Ada, small steady habits go a long way." }]
    });
    const taskId = "test-patiented-live-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { intake: { preferredName: "Ada", primarySymptom: "vasomotor" } }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.coachingVia).toBe("claude-api");
    expect(body.result.metadata.agentFabric.fallbackReason).toBeUndefined();

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const coach = spans.find((s) => s.operation === "patient-education.coach");
    expect(coach?.attributes?.via).toBe("claude-api");
    expect(coach?.attributes?.fallbackReason).toBeUndefined();
  });

  it("blocks a caller-asserted off-catalog (fabricated) curriculum (evidence-sourced)", async () => {
    const taskId = "test-patiented-offcatalog-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                curriculum: {
                  moduleIds: ["education.totally-invented"],
                  modules: [
                    { id: "education.totally-invented", source: "made up" }
                  ],
                  patientDisplayName: "the patient",
                  focusAreas: [],
                  rationale: ["fabricated"],
                  synthetic: true
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
    expect(violationIds).toContain("policy.education.evidence-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "patient-education.curate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "patient-education.curate")).toBe(false);
  });

  it("blocks a task that asserts it will give medical advice (no-medical-advice)", async () => {
    const taskId = "test-patiented-scope-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: { primarySymptom: "vasomotor" },
                deliversMedicalAdvice: true
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
    expect(violationIds).toContain("policy.education.no-medical-advice");
  });

  it("blocks a coaching push without consent (consent-before-outreach)", async () => {
    const taskId = "test-patiented-consent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: { primarySymptom: "vasomotor" },
                hasCoachingConsent: false
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
    expect(violationIds).toContain("policy.education.consent-before-outreach");
  });

  it("blocks an off-allow-list model (model allow-list, like the Care Router)", async () => {
    process.env.PAUSE_PATIENT_EDUCATION_MODEL = "gpt-4o-2024-08-06";
    const taskId = "test-patiented-model-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { intake: { primarySymptom: "vasomotor" } } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
  });

  it("allows an approved claude model", async () => {
    process.env.PAUSE_PATIENT_EDUCATION_MODEL = "claude-sonnet-4-5-20250929";
    const res = await POST(
      rpc({
        id: "test-patiented-allowmodel-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { intake: { primarySymptom: "vasomotor" } } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/patient-education/tasks", {
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
      new Request("http://localhost/api/agents/patient-education/tasks", {
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
