import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { POST as inboundPOST } from "../../agents/inbound-lead/tasks/route";
import { POST as qualificationPOST } from "../../agents/qualification/tasks/route";
import { POST as prospectingPOST } from "../../agents/prospecting/tasks/route";
import { POST as careRouterPOST } from "../../agents/care-router/tasks/route";

/**
 * The orchestrator makes real A2A calls over HTTP (sendA2ATask → fetch).
 * In tests there's no server, so we stub fetch to dispatch each
 * `${base}/api/agents/<agent>/tasks` call to that route's in-process POST
 * handler, exercising the whole chain end-to-end through the real code.
 */
const ORIGINAL_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  // Force the Care Router's deterministic scripted path (no live model).
  delete process.env.ANTHROPIC_API_KEY;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    const req = new Request(url.toString(), init);
    switch (url.pathname) {
      case "/api/agents/inbound-lead/tasks":
        return inboundPOST(req);
      case "/api/agents/qualification/tasks":
        return qualificationPOST(req);
      case "/api/agents/prospecting/tasks":
        return prospectingPOST(req);
      case "/api/agents/care-router/tasks":
        return careRouterPOST(req);
      default:
        throw new Error(`unexpected fetch to ${url.pathname}`);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_ANTHROPIC === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC;
});

function funnel(lead: unknown) {
  return new Request("http://localhost/api/intake/acquisition-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lead })
  });
}

describe("POST /api/intake/acquisition-funnel", () => {
  it("routes a ready lead all the way through intake to the Care Router", async () => {
    const res = await POST(
      funnel({
        source: "web-chat",
        ageBand: "46-50",
        primarySymptom: "vasomotor",
        cycleStatus: "irregular",
        consentOptIn: true
      })
    );
    const body = await res.json();
    expect(body.outcome).toBe("routed-to-intake");
    expect(body.taskId).toBeTruthy();
    expect(body.routingDecision?.pathway).toBeTruthy();

    // One correlated trace spans all four agents.
    const { listTraces } = await import("../../../../lib/agent-fabric");
    const spans = listTraces({ taskId: body.taskId });
    const agents = new Set(spans.map((s) => s.agentId));
    expect(agents.has("inbound-lead-agent")).toBe(true);
    expect(agents.has("qualification-agent")).toBe(true);
    expect(agents.has("agentforce-intake")).toBe(true);
    expect(agents.has("care-router-claude")).toBe(true);
    // The intake span is parented (funnel is one tree, not orphans).
    const intakeSpan = spans.find((s) => s.operation === "intake.complete");
    expect(intakeSpan?.parentSpanId).toBeTruthy();
  });

  it("routes a warming lead to prospecting/nurture", async () => {
    const res = await POST(
      funnel({
        source: "content-download",
        ageBand: "51-55",
        primarySymptom: "sleep",
        consentOptIn: true
      })
    );
    const body = await res.json();
    expect(body.outcome).toBe("nurturing");
    expect(body.nurture?.channel).toBeTruthy();

    const { listTraces } = await import("../../../../lib/agent-fabric");
    const spans = listTraces({ taskId: body.taskId });
    expect(spans.some((s) => s.agentId === "prospecting-agent")).toBe(true);
    expect(spans.some((s) => s.agentId === "care-router-claude")).toBe(false);
  });

  it("reports a governance block at the inbound gate for a no-consent lead", async () => {
    const res = await POST(
      funnel({ source: "web-chat", ageBand: "46-50", primarySymptom: "vasomotor", consentOptIn: false })
    );
    const body = await res.json();
    expect(body.outcome).toBe("blocked");
    expect(body.blockedAt).toBe("inbound-lead-agent");
  });

  it("disqualifies an out-of-ICP lead", async () => {
    const res = await POST(
      funnel({ source: "web-chat", ageBand: "<40", primarySymptom: "vasomotor", consentOptIn: true })
    );
    const body = await res.json();
    expect(body.outcome).toBe("disqualified");
  });
});
