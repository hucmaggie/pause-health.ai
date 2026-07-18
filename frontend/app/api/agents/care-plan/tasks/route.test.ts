import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable mock for the dynamically-imported Anthropic SDK (the summarize
// half calls it), mirroring lib/care-router.test.ts. The tests must NOT require
// a real ANTHROPIC_API_KEY — the SDK is mocked and the key is toggled per test.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-plan/tasks", {
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
const ORIGINAL_MODEL = process.env.PAUSE_CARE_PLAN_MODEL;

describe("POST /api/agents/care-plan/tasks", () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PAUSE_CARE_PLAN_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.PAUSE_CARE_PLAN_MODEL;
    else process.env.PAUSE_CARE_PLAN_MODEL = ORIGINAL_MODEL;
  });

  it("instantiates a plan and summarizes it via the scripted fallback (no key)", async () => {
    const taskId = "test-careplan-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                pathway: "mscp-virtual-visit",
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
    expect(body.result.metadata.agentFabric.planTracesToTemplate).toBe(true);
    expect(body.result.metadata.agentFabric.summaryVia).toBe("scripted-fallback");
    expect(body.result.metadata.agentFabric.fallbackReason).toMatch(
      /ANTHROPIC_API_KEY not set/
    );

    const data = dataPart(body).data as {
      plan: { templateId: string; goals: unknown[]; interventions: unknown[] };
      summary: { via: string; summary: string; fallbackReason?: string };
    };
    expect(data.plan.templateId).toMatch(/^careplan\./);
    expect(data.plan.goals.length).toBeGreaterThan(0);
    expect(data.summary.via).toBe("scripted-fallback");
    expect(data.summary.summary).toMatch(/does not add or change any prescription/i);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("careplan.instantiate");
    expect(ops).toContain("careplan.summarize");
    const instantiate = spans.find((s) => s.operation === "careplan.instantiate");
    expect(instantiate?.agentId).toBe("care-plan-agent");
    expect(instantiate?.attributes?.planTracesToTemplate).toBe(true);
    const summarize = spans.find((s) => s.operation === "careplan.summarize");
    expect(summarize?.attributes?.via).toBe("scripted-fallback");
    // The fallbackReason is present on the forced scripted-fallback path.
    expect(summarize?.attributes?.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The summarize span is parented to the instantiate span.
    expect(summarize?.parentSpanId).toBe(instantiate?.id);
  });

  it("records via: claude-api with no fallbackReason on a mocked live success", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Ada is progressing well on her plan." }]
    });
    const taskId = "test-careplan-live-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                pathway: "mscp-virtual-visit",
                intake: { preferredName: "Ada", severity: "moderate", primarySymptom: "vasomotor" }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.summaryVia).toBe("claude-api");
    expect(body.result.metadata.agentFabric.fallbackReason).toBeUndefined();

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const summarize = spans.find((s) => s.operation === "careplan.summarize");
    expect(summarize?.attributes?.via).toBe("claude-api");
    expect(summarize?.attributes?.fallbackReason).toBeUndefined();
  });

  it("blocks a caller-asserted off-catalog (fabricated) plan (template-sourced)", async () => {
    const taskId = "test-careplan-offcatalog-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                plan: {
                  templateId: "careplan.totally-invented",
                  templateLabel: "Invented plan",
                  patientDisplayName: "the patient",
                  pathway: "mscp-virtual-visit",
                  severity: "moderate",
                  goals: [],
                  interventions: [],
                  followUp: { intervalDays: 30, modality: "telehealth", description: "x" },
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
    expect(violationIds).toContain("policy.careplan.template-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "careplan.instantiate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "careplan.instantiate")).toBe(false);
  });

  it("blocks an off-allow-list model (model allow-list, like the Care Router)", async () => {
    process.env.PAUSE_CARE_PLAN_MODEL = "gpt-4o-2024-08-06";
    const taskId = "test-careplan-model-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                pathway: "mscp-virtual-visit",
                intake: { severity: "moderate", primarySymptom: "vasomotor" }
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
    expect(violationIds).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
  });

  it("allows an approved claude model", async () => {
    process.env.PAUSE_CARE_PLAN_MODEL = "claude-sonnet-4-5-20250929";
    const res = await POST(
      rpc({
        id: "test-careplan-allowmodel-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                pathway: "mscp-virtual-visit",
                intake: { severity: "moderate", primarySymptom: "vasomotor" }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/care-plan/tasks", {
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
      new Request("http://localhost/api/agents/care-plan/tasks", {
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
