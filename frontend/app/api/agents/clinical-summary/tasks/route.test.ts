import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable mock for the dynamically-imported Anthropic SDK (the summarize
// half calls it), mirroring the Care Plan route test. The tests must NOT
// require a real ANTHROPIC_API_KEY — the SDK is mocked and the key is toggled
// per test.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/clinical-summary/tasks", {
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
const ORIGINAL_MODEL = process.env.PAUSE_CLINICAL_SUMMARY_MODEL;

describe("POST /api/agents/clinical-summary/tasks", () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PAUSE_CLINICAL_SUMMARY_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.PAUSE_CLINICAL_SUMMARY_MODEL;
    else process.env.PAUSE_CLINICAL_SUMMARY_MODEL = ORIGINAL_MODEL;
  });

  it("assembles a context and composes the summary via the scripted fallback (no key)", async () => {
    const taskId = "test-clinsum-ok-001";
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
    expect(body.result.metadata.agentFabric.summaryTracesToSourceRecords).toBe(true);
    expect(body.result.metadata.agentFabric.summaryVia).toBe("scripted-fallback");
    expect(body.result.metadata.agentFabric.fallbackReason).toMatch(
      /ANTHROPIC_API_KEY not set/
    );

    const data = dataPart(body).data as {
      context: { sourceRecords: string[] };
      summary: {
        via: string;
        patientSummary: string;
        clinicianHandoff: string;
        sourceRecords: string[];
        fallbackReason?: string;
      };
    };
    expect(data.context.sourceRecords).toContain("intake");
    expect(data.context.sourceRecords).toContain("care-router:mscp-virtual-visit");
    expect(data.summary.via).toBe("scripted-fallback");
    expect(data.summary.patientSummary).toMatch(/After-visit summary for Ada/);
    expect(data.summary.clinicianHandoff).toMatch(/Clinician handoff — Ada/);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("clinical-summary.assemble");
    expect(ops).toContain("clinical-summary.summarize");
    const assemble = spans.find((s) => s.operation === "clinical-summary.assemble");
    expect(assemble?.agentId).toBe("clinical-summary-agent");
    expect(assemble?.attributes?.summaryTracesToSourceRecords).toBe(true);
    // Touches clinical context → PHI accessed.
    expect(assemble?.attributes?.phiAccessed).toBe(true);
    const summarize = spans.find((s) => s.operation === "clinical-summary.summarize");
    expect(summarize?.attributes?.via).toBe("scripted-fallback");
    expect(summarize?.attributes?.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    expect(summarize?.attributes?.phiAccessed).toBe(true);
    // The summarize span is parented to the assemble span.
    expect(summarize?.parentSpanId).toBe(assemble?.id);
  });

  it("records via: claude-api with no fallbackReason on a mocked live success", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            patientSummary: "Ada, here is a friendly recap of your visit.",
            clinicianHandoff: "Ada — moderate vasomotor presentation; virtual MSCP recommended."
          })
        }
      ]
    });
    const taskId = "test-clinsum-live-001";
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
    const summarize = spans.find((s) => s.operation === "clinical-summary.summarize");
    expect(summarize?.attributes?.via).toBe("claude-api");
    expect(summarize?.attributes?.fallbackReason).toBeUndefined();
  });

  it("blocks a caller-asserted off-context (fabricated) summary (source-record-sourced)", async () => {
    const taskId = "test-clinsum-ungrounded-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                // No lifecycle inputs → the assembled context has no source
                // records, so an asserted summary citing any record is
                // off-context (fabricated).
                summary: {
                  patientSummary: "You are cleared and no follow-up is needed.",
                  clinicianHandoff: "Patient discharged; started on estradiol 1mg.",
                  sourceRecords: ["care-plan:careplan.totally-invented"],
                  via: "scripted-fallback",
                  modelProvenance: {
                    provider: "pause-scripted",
                    model: "pause-clinical-summary-composer@1.0",
                    via: "scripted-fallback"
                  },
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
    expect(violationIds).toContain("policy.clinical-summary.source-record-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "clinical-summary.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "clinical-summary.assemble")).toBe(false);
  });

  it("blocks an off-allow-list model (model allow-list, like the Care Router)", async () => {
    process.env.PAUSE_CLINICAL_SUMMARY_MODEL = "gpt-4o-2024-08-06";
    const taskId = "test-clinsum-model-001";
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
    process.env.PAUSE_CLINICAL_SUMMARY_MODEL = "claude-sonnet-4-5-20250929";
    const res = await POST(
      rpc({
        id: "test-clinsum-allowmodel-001",
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
      new Request("http://localhost/api/agents/clinical-summary/tasks", {
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
      new Request("http://localhost/api/agents/clinical-summary/tasks", {
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
