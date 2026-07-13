import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { listTraces } from "../../../../lib/agent-fabric";

/**
 * Tests for POST /api/intake/route-to-care-router — the server-side A2A
 * handoff (Agentforce intake → Data 360 identity → federated grounding →
 * Pause Care Router). This is the most logic-dense route in the app and had
 * no coverage. What's worth pinning:
 *   - the JSON guard (400),
 *   - the happy path: it emits the multi-agent trace (intake.complete +
 *     data360 identity + data360 grounding spans under one taskId), posts an
 *     A2A tasks/send to the derived care-router URL, and extracts the
 *     decision from the returned artifact's data part,
 *   - the transport-error path: an A2A failure returns 502 AND records an
 *     error span rather than throwing.
 *
 * SF_* are left unset so identity + grounding take the deterministic mock
 * path (identitySource/groundingSource = "mock"). The A2A call is stubbed at
 * the fetch boundary so no real Care Router server is needed.
 */

const SF_KEYS = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const;
const originalEnv: Record<string, string | undefined> = {};

function post(body: unknown | string) {
  const init: RequestInit = { method: "POST" };
  init.body = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new Request("http://localhost:3000/api/intake/route-to-care-router", init)
  );
}

/** A well-formed A2A JSON-RPC success envelope wrapping a completed task. */
function a2aOk(taskId: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      jsonrpc: "2.0",
      id: taskId,
      result: {
        id: taskId,
        status: { state: "completed", timestamp: new Date().toISOString() },
        artifacts: [
          {
            name: "routing-decision",
            index: 0,
            parts: [
              {
                type: "data",
                data: { pathway: "gynecology", acuity: "routine" }
              }
            ]
          }
        ]
      }
    })
  } as unknown as Response;
}

const INTAKE = {
  preferredName: "Jane",
  ageBand: "46-50",
  primarySymptom: "hot_flashes",
  severity: "moderate",
  cycleStatus: "irregular",
  patientZip: "94110",
  redFlagsAcknowledged: "no"
};

beforeEach(() => {
  for (const k of SF_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SF_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("POST /api/intake/route-to-care-router", () => {
  it("returns 400 on invalid JSON", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
  });

  it("resolves identity+grounding (mock), hands off over A2A, and returns the decision", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      // The only outbound call is the A2A tasks/send to the care router.
      expect(url).toContain("/api/agents/care-router/tasks");
      // taskId is generated inside the route; echo a valid envelope back.
      return a2aOk("echoed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await post({ intake: INTAKE });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json.meta._data360IdentitySource).toBe("mock");
    expect(json.meta._data360GroundingSource).toBe("mock");
    expect(json.meta._salesforceConfigured).toBe(false);
    expect(json.data360.source).toEqual({ identity: "mock", grounding: "mock" });
    // Decision is lifted out of the returned artifact's data part.
    expect(json.decision).toEqual({ pathway: "gynecology", acuity: "routine" });
    expect(json.taskId).toBeTruthy();
  });

  it("emits the multi-agent trace (intake + identity + grounding spans) under one taskId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => a2aOk("echoed"))
    );
    const json = await (await post({ intake: INTAKE })).json();
    const spans = listTraces({ taskId: json.taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("intake.complete");
    expect(ops).toContain("data360.identity.resolve");
    expect(ops).toContain("data360.grounding.federated-query");
    // The grounding span honestly reports the mock source it served.
    const grounding = spans.find(
      (s) => s.operation === "data360.grounding.federated-query"
    );
    expect(grounding?.attributes?._source).toBe("mock");
  });

  it("threads an optional personaId into the emitted spans", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => a2aOk("echoed"))
    );
    const json = await (
      await post({ intake: INTAKE, personaId: "anika-patel" })
    ).json();
    const spans = listTraces({ taskId: json.taskId });
    expect(
      spans.every((s) => s.attributes?.personaId === "anika-patel")
    ).toBe(true);
  });

  it("threads an optional origin slug onto the emitted spans", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => a2aOk("echoed"))
    );
    const json = await (
      await post({ intake: INTAKE, origin: "agentforce-chat" })
    ).json();
    const spans = listTraces({ taskId: json.taskId });
    const intake = spans.find((s) => s.operation === "intake.complete");
    expect(intake?.attributes?.origin).toBe("agentforce-chat");
    // Stamped on every span the handoff owns, not just the root.
    expect(
      spans.every((s) => s.attributes?.origin === "agentforce-chat")
    ).toBe(true);
  });

  it("drops a non-slug origin so no free text / PHI can ride in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => a2aOk("echoed"))
    );
    const json = await (
      await post({ intake: INTAKE, origin: "Jane Doe, 92614, hot flashes" })
    ).json();
    const spans = listTraces({ taskId: json.taskId });
    expect(spans.every((s) => s.attributes?.origin === undefined)).toBe(true);
  });

  it("returns 502 and records a transport-error span when the A2A call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    const res = await post({ intake: INTAKE });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/connection refused/i);
    const spans = listTraces({ taskId: json.meta._taskId });
    expect(
      spans.some((s) => s.operation === "a2a.tasks/send.transport-error")
    ).toBe(true);
    expect(
      spans.find((s) => s.operation === "a2a.tasks/send.transport-error")
        ?.status
    ).toBe("error");
  });
});
