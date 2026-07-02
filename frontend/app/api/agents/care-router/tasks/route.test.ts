import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

/**
 * Tests for the /api/agents/care-router/tasks A2A endpoint.
 *
 * The Care Router agent speaks the Google Agent-to-Agent (A2A) JSON-RPC
 * dialect. This is the single edge between the rest of the prototype
 * (Agentforce intake, /demo/routing test page, the MCP server) and the
 * Claude-or-scripted policy engine. Tests cover:
 *
 *   1. JSON-RPC envelope validation -- malformed envelopes get -32700
 *      / -32600 errors at HTTP 400 with id=null.
 *   2. Governance block path -- a task that violates the model
 *      allow-list returns an A2A task in `failed` state with the
 *      blocking policy ids surfaced in metadata.
 *   3. Success path -- a well-formed task returns a `completed`
 *      A2A task with a RoutingDecision artifact attached and a
 *      span recorded in the Agent Fabric.
 *   4. Data 360 grounding passthrough -- when the inbound message
 *      carries grounding context, the response cites it.
 *   5. metadata.parentSpanId + metadata.personaId honoring.
 */

const URL = "https://example.com/api/agents/care-router/tasks";

function rpcRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function rawRequest(raw: string, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw
  });
}

function validTaskBody(overrides: {
  id?: string;
  intake?: Record<string, unknown>;
  data360Grounding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} = {}) {
  return {
    jsonrpc: "2.0",
    id: 42,
    method: "tasks/send",
    params: {
      id: overrides.id ?? "task-test-001",
      sessionId: "session-test",
      message: {
        role: "user",
        parts: [
          {
            type: "data",
            data: {
              intake: overrides.intake ?? {
                preferredName: "Test Patient",
                ageBand: "45-49",
                cycleStatus: "perimenopausal",
                primarySymptom: "vasomotor",
                severity: "moderate",
                redFlagsAcknowledged: "no"
              },
              ...(overrides.data360Grounding
                ? { data360Grounding: overrides.data360Grounding }
                : {})
            }
          }
        ],
        timestamp: new Date().toISOString()
      },
      ...(overrides.metadata ? { metadata: overrides.metadata } : {})
    }
  };
}

describe("POST /api/agents/care-router/tasks · envelope validation", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("returns JSON-RPC parse error -32700 for invalid JSON body", async () => {
    const res = await POST(rawRequest("{not-valid"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700 }
    });
  });

  it("returns invalid-request -32600 when jsonrpc is not '2.0'", async () => {
    const res = await POST(
      rpcRequest({ ...validTaskBody(), jsonrpc: "1.0" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe(-32600);
  });

  it("returns invalid-request -32600 when method is not tasks/send", async () => {
    const res = await POST(
      rpcRequest({ ...validTaskBody(), method: "tasks/cancel" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe(-32600);
  });

  it("returns invalid-request -32600 when params are missing", async () => {
    const res = await POST(
      rpcRequest({ jsonrpc: "2.0", id: 1, method: "tasks/send" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe(-32600);
  });

  it("echoes the client's rpc id on errors", async () => {
    const res = await POST(
      rpcRequest({ ...validTaskBody(), id: "my-correlation-id", jsonrpc: "1.0" })
    );
    const json = await res.json();
    expect(json.id).toBe("my-correlation-id");
  });
});

describe("POST /api/agents/care-router/tasks · success path", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
  const ORIGINAL_MODEL = process.env.PAUSE_CARE_ROUTER_MODEL;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PAUSE_CARE_ROUTER_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.PAUSE_CARE_ROUTER_MODEL;
    else process.env.PAUSE_CARE_ROUTER_MODEL = ORIGINAL_MODEL;
  });

  it("returns a completed A2A task with a RoutingDecision artifact", async () => {
    const res = await POST(
      rpcRequest(validTaskBody({ id: "task-success-001" }))
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(42); // echo of the rpc envelope id

    const task = json.result;
    expect(task.id).toBe("task-success-001");
    expect(task.sessionId).toBe("session-test");
    expect(task.status.state).toBe("completed");

    expect(task.artifacts).toHaveLength(1);
    const artifact = task.artifacts[0];
    expect(artifact.name).toBe("RoutingDecision");
    expect(artifact.parts).toHaveLength(1);
    const decision = artifact.parts[0].data;
    expect(decision.pathway).toBe("mscp-virtual-visit");
    expect(decision.modelProvenance.provider).toBe("pause-scripted");
  });

  it("stamps governance metadata with the policies that were evaluated", async () => {
    const res = await POST(
      rpcRequest(validTaskBody({ id: "task-gov-meta-001" }))
    );
    const task = (await res.json()).result;
    expect(task.metadata.agentFabric.decision).toBe("allow");
    expect(task.metadata.agentFabric.policiesEvaluated.length).toBeGreaterThan(
      0
    );
    expect(task.metadata.agentFabric.traceSpanId).toMatch(/^span-/);
    expect(task.metadata.agentFabric.traceTaskId).toBe("task-gov-meta-001");
  });

  it("includes the inbound message in task.history", async () => {
    const res = await POST(
      rpcRequest(validTaskBody({ id: "task-history-001" }))
    );
    const task = (await res.json()).result;
    expect(task.history).toHaveLength(1);
    expect(task.history[0].role).toBe("user");
  });

  it("auto-generates a task id when params.id is missing", async () => {
    const body = validTaskBody({ id: "" });
    // Remove the id entirely (not just empty string) to confirm the
    // newTaskId() fallback.
    delete (body.params as { id?: string }).id;
    const res = await POST(rpcRequest(body));
    const task = (await res.json()).result;
    expect(task.id).toMatch(/^care-router-/);
  });
});

describe("POST /api/agents/care-router/tasks · governance block path", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
  const ORIGINAL_MODEL = process.env.PAUSE_CARE_ROUTER_MODEL;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.PAUSE_CARE_ROUTER_MODEL;
    else process.env.PAUSE_CARE_ROUTER_MODEL = ORIGINAL_MODEL;
  });

  it("returns an A2A task in 'failed' state when the governance gate blocks", async () => {
    // The blocking lever exposed to A2A clients is PAUSE_CARE_ROUTER_MODEL.
    // Set it to an off-allow-list model so the model-allow-list policy
    // fires regardless of intake shape.
    process.env.PAUSE_CARE_ROUTER_MODEL = "gpt-4o-2024-08-06";

    const res = await POST(
      rpcRequest(validTaskBody({ id: "task-blocked-001" }))
    );
    expect(res.status).toBe(200); // JSON-RPC blocks return 200 with a failed task

    const task = (await res.json()).result;
    expect(task.id).toBe("task-blocked-001");
    expect(task.status.state).toBe("failed");
    expect(task.metadata.agentFabric.decision).toBe("block");
    expect(task.metadata.agentFabric.violations.length).toBeGreaterThan(0);

    const violationPolicies = task.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationPolicies).toContain(
      "policy.model.anthropic-claude-sonnet-allowlisted"
    );
  });

  it("blocked tasks do NOT call the Care Router policy engine (no artifacts)", async () => {
    process.env.PAUSE_CARE_ROUTER_MODEL = "gpt-4o-2024-08-06";
    const res = await POST(
      rpcRequest(validTaskBody({ id: "task-blocked-002" }))
    );
    const task = (await res.json()).result;
    expect(task.artifacts).toBeUndefined();
  });
});

describe("POST /api/agents/care-router/tasks · metadata + grounding passthrough", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("threads Data 360 grounding into the routing decision", async () => {
    const grounding = {
      unifiedPatientId: "data360-anika",
      calculatedInsights: [
        { id: "insight.vasomotor-burden-30d", name: "Vasomotor", value: 62 }
      ],
      cohortComparison: {
        cohortName: "perimenopausal-vasomotor",
        cohortSize: 5000,
        patientPercentile: 80,
        metric: "vasomotor burden 30d"
      }
    };
    const res = await POST(
      rpcRequest(
        validTaskBody({ id: "task-grounded-001", data360Grounding: grounding })
      )
    );
    const task = (await res.json()).result;
    const decision = task.artifacts[0].parts[0].data;
    // High burden + high percentile should promote moderate -> in-person.
    expect(decision.pathway).toBe("mscp-in-person");
    expect(decision.groundingUsed.cohortName).toBe("perimenopausal-vasomotor");
  });

  it("accepts a kind:'data' part (current A2A spec) as equivalent to type:'data'", async () => {
    // A spec-current external client (Vertex, an OpenAI harness) tags its
    // Parts with `kind`, not `type`. The route must read the intake either
    // way -- otherwise the part is ignored, intake collapses to {}, and the
    // task is silently blocked on the red-flag policy.
    const body = validTaskBody({ id: "task-kinddata-001" });
    body.params.message.parts = [
      {
        kind: "data",
        data: {
          intake: {
            preferredName: "Kind Client",
            ageBand: "45-49",
            cycleStatus: "perimenopausal",
            primarySymptom: "vasomotor",
            severity: "moderate",
            redFlagsAcknowledged: "no"
          }
        }
      }
    ] as unknown as typeof body.params.message.parts;
    const res = await POST(rpcRequest(body));
    const task = (await res.json()).result;
    expect(task.status.state).toBe("completed");
    expect(task.artifacts?.[0]?.name).toBe("RoutingDecision");
    expect(task.metadata.agentFabric.decision).toBe("allow");
  });

  it("blocks via red-flag-mandatory policy when the message has no data part", async () => {
    const body = validTaskBody({ id: "task-noparts-001" });
    // Strip the data part so the route's `dataPart` lookup misses.
    body.params.message.parts = [];
    const res = await POST(rpcRequest(body));
    const task = (await res.json()).result;
    // Documented behavior: when no intake data part is present, the
    // route synthesizes intake = {} and passes hasRedFlagScreen=false
    // into evaluateGovernance. The red-flag-mandatory policy is
    // block-enforced for care-router-claude, so the task is rejected
    // BEFORE the Care Router policy engine runs. This is the right
    // call -- silently routing on missing intake would be a clinical
    // safety bug.
    expect(task.status.state).toBe("failed");
    expect(task.metadata.agentFabric.decision).toBe("block");
    const violations = task.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violations).toContain("policy.intake.red-flag-mandatory");
  });

  it("threads metadata.parentSpanId and metadata.personaId onto the recorded span", async () => {
    const body = validTaskBody({
      id: "task-meta-passthrough-001",
      metadata: {
        parentSpanId: "span-upstream-abc123",
        personaId: "anika-patel"
      }
    });
    const res = await POST(rpcRequest(body));
    const task = (await res.json()).result;
    // We can verify the span was recorded under the expected task id;
    // the parentSpanId / personaId attributes are visible to
    // /demo/agent-fabric and to the analytics persona filter.
    expect(task.metadata.agentFabric.traceTaskId).toBe(
      "task-meta-passthrough-001"
    );
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId: "task-meta-passthrough-001" });
    expect(spans).toHaveLength(1);
    expect(spans[0].parentSpanId).toBe("span-upstream-abc123");
    expect(spans[0].attributes?.personaId).toBe("anika-patel");
  });
});
