import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SDOH_PRESETS,
  buildSdohRequestBody,
  runSdohTask,
  sdohViewFromTask
} from "./sdoh-screening-panel";
import type { A2ATask } from "../lib/a2a";
import {
  draftCommunityReferralsForResult,
  isAllowlistedSdohScreener,
  screenSocialNeeds,
  type SdohScreeningResponse
} from "../lib/sdoh";

/**
 * Unit coverage for the /demo/intake SDOH Screening agent panel. This repo
 * tests components as node-env pure functions (see care-gap-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the SDOH agent,
 *   - that runSdohTask returns the resulting task,
 *   - and that sdohViewFromTask lifts a completed screening and a governance
 *     block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/sdoh-screening actually
 * returns (see that route + lib/sdoh).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  // Derive a realistic result + referrals from the domain source of truth so
  // the fixture can't drift from what the agent actually returns.
  const responses: SdohScreeningResponse = {
    screener: "ahc-hrsn",
    responses: {
      housing: [0, 0],
      food: [1, 0],
      transportation: [1],
      utilities: [0],
      safety: [1, 1, 1, 1]
    }
  };
  const result = screenSocialNeeds(responses);
  const referrals = draftCommunityReferralsForResult(result, { patientConsent: true });
  return {
    id: "sdoh-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "SdohScreeningResult",
        index: 0,
        parts: [{ type: "data", data: { result, referrals, careSignal: { safetyEscalation: false } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.sdoh.validated-screener-only"],
        traceSpanId: "span-1",
        traceTaskId: "sdoh-abc",
        socialNeedsIdentified: true,
        positiveDomainCount: 2,
        safetyEscalation: false,
        referralsDrafted: referrals.length,
        nextAgent: "agentforce-intake"
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "sdoh-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this SDOH screening: policy.sdoh.consent-before-referral (no consent)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: [
          "policy.sdoh.validated-screener-only",
          "policy.sdoh.consent-before-referral"
        ],
        violations: [
          {
            policyId: "policy.sdoh.consent-before-referral",
            reason: "a community referral requires the patient's consent"
          }
        ]
      }
    }
  };
}

describe("SDOH_PRESETS", () => {
  it("has a multi-domain consented preset that screens two positive domains", () => {
    const preset = SDOH_PRESETS.find((p) => p.id === "food-transportation-consented");
    expect(preset).toBeDefined();
    const result = screenSocialNeeds({
      screener: "ahc-hrsn",
      responses: preset!.responses
    });
    expect(result.positiveDomains).toEqual(["food", "transportation"]);
    expect(preset!.patientConsent).toBe(true);
  });

  it("has an interpersonal-safety preset that fires the red flag", () => {
    const preset = SDOH_PRESETS.find((p) => p.id === "interpersonal-safety-escalation");
    expect(preset).toBeDefined();
    const result = screenSocialNeeds({
      screener: "ahc-hrsn",
      responses: preset!.responses
    });
    expect(result.redFlags.length).toBeGreaterThan(0);
  });

  it("has a consent-withheld preset with a positive domain but no consent", () => {
    const preset = SDOH_PRESETS.find((p) => p.id === "consent-withheld-block");
    expect(preset).toBeDefined();
    expect(preset!.patientConsent).toBe(false);
    const result = screenSocialNeeds({
      screener: "ahc-hrsn",
      responses: preset!.responses
    });
    expect(result.positiveDomains.length).toBeGreaterThan(0);
  });

  it("has a non-allow-listed preset whose screener is off the allow-list", () => {
    const preset = SDOH_PRESETS.find((p) => p.id === "off-allowlist-block");
    expect(preset).toBeDefined();
    expect(isAllowlistedSdohScreener(preset!.screener)).toBe(false);
  });
});

describe("buildSdohRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a screening data part", () => {
    const responses = { food: [1, 0], transportation: [1] };
    const body = buildSdohRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      screener: "ahc-hrsn",
      responses,
      patientConsent: true
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      screening: { screener: "ahc-hrsn", responses },
      patientConsent: true
    });
  });
});

describe("runSdohTask", () => {
  it("POSTs the A2A body to the SDOH agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/sdoh-screening/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.screening.screener).toBe("ahc-hrsn");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runSdohTask(
      {
        taskId: "task-1",
        screener: "ahc-hrsn",
        responses: { food: [1, 0] },
        patientConsent: true
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("sdoh-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runSdohTask(
        { taskId: "t", screener: "ahc-hrsn", responses: {}, patientConsent: true },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("sdohViewFromTask", () => {
  it("lifts a completed screening with positive domains + consent-gated referrals", () => {
    const view = sdohViewFromTask(completedTask());
    expect(view.kind).toBe("screened");
    if (view.kind !== "screened") return;
    expect(view.positiveDomains).toEqual(["food", "transportation"]);
    expect(view.domains.length).toBe(5);
    expect(view.safetyEscalation).toBe(false);
    expect(view.referrals.length).toBeGreaterThan(0);
    for (const r of view.referrals) {
      expect(r.autonomousEnrollment).toBe(false);
      expect(r.sent).toBe(false);
      expect(r.suppressedForNoConsent).toBe(false);
    }
    expect(view.nextAgent).toBe("agentforce-intake");
    expect(view.traceTaskId).toBe("sdoh-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = sdohViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this SDOH screening/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.sdoh.consent-before-referral"
    );
    expect(view.policiesEvaluated).toContain("policy.sdoh.consent-before-referral");
    expect(view.traceTaskId).toBe("sdoh-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "sdoh-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The SDOH screening could not be scored." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = sdohViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be scored/);
  });
});
