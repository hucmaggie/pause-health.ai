import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BENEFITS_PRESETS,
  benefitsViewFromTask,
  buildBenefitsRequestBody,
  carryCoverageIntoCareRouter,
  runBenefitsTask
} from "./benefits-panel";
import type { A2ATask } from "../lib/a2a";
import { hasEbvSource, verifyCoverage } from "../lib/benefits";

/**
 * Unit coverage for the /demo/intake Benefits & Coverage Verification
 * (EBV) agent panel. This repo tests components as node-env pure
 * functions (see assessment-panel.test.ts) rather than rendering them, so
 * we exercise the exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Benefits agent (both a
 *     coverageQuery and a caller-asserted coverage result),
 *   - that runBenefitsTask returns the resulting task,
 *   - and that benefitsViewFromTask lifts a verified result and a
 *     governance block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/benefits-verification
 * actually returns (see that route + lib/benefits).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(overrides?: {
  result?: Record<string, unknown>;
}): A2ATask {
  // Derive a realistic verified result from the domain source of truth so
  // the fixture can't drift from what the agent actually returns.
  const base = verifyCoverage({
    payer: "Aetna",
    memberId: "PH-1",
    patientZip: "60614"
  });
  const result = { ...base, ...(overrides?.result ?? {}) };
  const summary = {
    eligibilityStatus: result.eligibilityStatus,
    network: result.network,
    payerName: result.payerName,
    planName: result.planName,
    estimatedPatientResponsibility: result.estimatedPatientResponsibility,
    ebvTransactionId: result.source?.transactionId
  };
  return {
    id: "benefits-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CoverageBenefitResult",
        index: 0,
        parts: [{ type: "data", data: { result, summary } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: [
          "policy.benefits.eligibility-source-integrity",
          "policy.data360.consent-required-before-grounding"
        ],
        traceSpanId: "span-1",
        traceTaskId: "benefits-abc",
        eligibilityStatus: result.eligibilityStatus,
        network: result.network,
        estimatedPatientResponsibility: result.estimatedPatientResponsibility,
        nextAgent: "agentforce-intake"
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "benefits-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this coverage verification: policy.benefits.eligibility-source-integrity (no source provenance)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: [
          "policy.benefits.eligibility-source-integrity",
          "policy.data360.consent-required-before-grounding"
        ],
        violations: [
          {
            policyId: "policy.benefits.eligibility-source-integrity",
            reason:
              "Returned coverage/eligibility result did not trace to a payer/clearinghouse EBV response (no source provenance); the agent may not fabricate coverage without a source"
          }
        ]
      }
    }
  };
}

describe("BENEFITS_PRESETS", () => {
  it("builds a valid coverage query for each verifying preset", () => {
    const querying = BENEFITS_PRESETS.filter((p) => p.query);
    expect(querying.length).toBeGreaterThanOrEqual(3);
    for (const preset of querying) {
      expect(typeof preset.query!.payer).toBe("string");
      // Deterministic on inputs — verifying twice yields the same result.
      const a = verifyCoverage(preset.query!);
      const b = verifyCoverage(preset.query!);
      expect(a).toEqual(b);
      expect(hasEbvSource(a)).toBe(true);
    }
  });

  it("has an in-network deductible-met preset with low patient responsibility", () => {
    const preset = BENEFITS_PRESETS.find((p) => p.id === "in-network-deductible-met");
    expect(preset).toBeDefined();
    const r = verifyCoverage(preset!.query!);
    expect(r.eligibilityStatus).toBe("active");
    expect(r.network).toBe("in-network");
    expect(r.deductibleRemaining).toBe(0);
    expect(r.estimatedPatientResponsibility).toBeLessThan(r.estimatedVisitCost);
  });

  it("has a high-deductible preset that is not yet met (full visit on the patient)", () => {
    const preset = BENEFITS_PRESETS.find((p) => p.id === "hdhp-not-met");
    expect(preset).toBeDefined();
    const r = verifyCoverage(preset!.query!);
    expect(r.productType).toBe("HDHP");
    expect(r.deductibleMet).toBe(0);
    expect(r.estimatedPatientResponsibility).toBe(r.estimatedVisitCost);
  });

  it("has a self-pay preset that reports no active coverage but is still sourced", () => {
    const preset = BENEFITS_PRESETS.find((p) => p.id === "self-pay");
    expect(preset).toBeDefined();
    const r = verifyCoverage(preset!.query!);
    expect(r.eligibilityStatus).toBe("inactive");
    expect(r.source.responseCode).toBe("no-active-coverage");
    expect(hasEbvSource(r)).toBe(true);
  });

  it("has a caller-asserted preset with NO source so the governance block is demonstrable", () => {
    const preset = BENEFITS_PRESETS.find((p) => p.id === "asserted-no-source");
    expect(preset).toBeDefined();
    expect(preset!.assertedCoverage).toBeDefined();
    expect(preset!.query).toBeUndefined();
    // The asserted coverage must lack a valid EBV source (that's the point).
    expect(hasEbvSource(preset!.assertedCoverage as never)).toBe(false);
  });
});

describe("buildBenefitsRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a coverageQuery data part", () => {
    const body = buildBenefitsRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      query: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      coverageQuery: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }
    });
  });

  it("posts a caller-asserted coverage object under a `coverage` data part", () => {
    const asserted = { eligibilityStatus: "active", network: "in-network" };
    const body = buildBenefitsRequestBody({
      taskId: "task-block",
      assertedCoverage: asserted
    });
    expect(body.params.message.parts[0].data).toEqual({ coverage: asserted });
  });
});

describe("runBenefitsTask", () => {
  it("POSTs the A2A body to the Benefits agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/benefits-verification/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data).toEqual({
        coverageQuery: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runBenefitsTask(
      {
        taskId: "task-1",
        query: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("benefits-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runBenefitsTask(
        { taskId: "t", query: { payer: "Aetna" } },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("benefitsViewFromTask", () => {
  it("lifts a verified result with plan, network, deductible, cost, and source", () => {
    const view = benefitsViewFromTask(completedTask());
    expect(view.kind).toBe("verified");
    if (view.kind !== "verified") return;
    expect(view.eligibilityStatus).toBe("active");
    expect(view.network).toBe("in-network");
    expect(view.deductibleRemaining).toBe(0);
    expect(view.estimatedPatientResponsibility).toBeGreaterThan(0);
    expect(view.source.synthetic).toBe(true);
    expect(view.source.transactionId).toMatch(/^ebv-/);
    expect(view.nextAgent).toBe("agentforce-intake");
    expect(view.traceTaskId).toBe("benefits-abc");
  });

  it("lifts a self-pay (inactive) result with a no-active-coverage source", () => {
    const selfPay = verifyCoverage({ payer: "self-pay", memberId: "PH-1" });
    const view = benefitsViewFromTask(
      completedTask({ result: selfPay as unknown as Record<string, unknown> })
    );
    expect(view.kind).toBe("verified");
    if (view.kind !== "verified") return;
    expect(view.eligibilityStatus).toBe("inactive");
    expect(view.source.responseCode).toBe("no-active-coverage");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = benefitsViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this coverage verification/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.benefits.eligibility-source-integrity"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.benefits.eligibility-source-integrity"
    );
    expect(view.traceTaskId).toBe("benefits-block");
  });

  it("treats a failed non-block task as an invalid (not-verified) result", () => {
    const task: A2ATask = {
      id: "benefits-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "Coverage could not be verified." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = benefitsViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be verified/);
  });
});

describe("carryCoverageIntoCareRouter", () => {
  it("POSTs the coverage query to the Care Router handoff and lifts the decision", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/intake/route-to-care-router");
      const sent = JSON.parse(String(init?.body));
      expect(sent.coverage).toEqual({
        query: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }
      });
      expect(sent.origin).toBe("benefits-agent");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: "intake-to-router-77",
          decision: {
            pathway: "menopause-specialist",
            pathwayLabel: "Menopause specialist",
            acuity: "routine"
          },
          coverage: { coverageVerifiedBeforeRouting: true }
        })
      } as unknown as Response;
    });

    const out = await carryCoverageIntoCareRouter(
      { query: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" }, personaId: "demo" },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.taskId).toBe("intake-to-router-77");
    expect(out.pathwayLabel).toBe("Menopause specialist");
    expect(out.acuity).toBe("routine");
    expect(out.coverageVerifiedBeforeRouting).toBe(true);
  });
});
