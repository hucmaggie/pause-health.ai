import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TRIAL_PAYMENTS_PRESETS,
  buildTrialPaymentsRequestBody,
  runTrialPaymentsTask,
  trialPaymentsViewFromTask
} from "./trial-payments-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_EXTRA_PROCEDURE,
  DEMO_MISSED_VISIT,
  DEMO_NO_CONSENT,
  DEMO_STANDARD_PAYMENT,
  DEMO_TRAVEL_OUT_OF_RANGE,
  evaluatePayment
} from "../lib/trial-payments";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluatePayment(DEMO_STANDARD_PAYMENT);
  return {
    id: "tp-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "TrialPaymentDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.trial-payments.schedule-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "tp-abc",
        requestRef: decision.requestRef,
        participantRef: decision.participantRef,
        trialId: decision.trialId,
        visitTypeId: decision.visitTypeId,
        trialPaymentDecision: decision.decision,
        stipendAmountCents: decision.stipendAmountCents,
        travelReimbursementCents: decision.travelReimbursementCents,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresCoordinatorCosign: decision.requiresCoordinatorCosign,
        paymentsTraceToCatalog: true,
        deviationRequiresCoordinatorCosign: true,
        paymentHasParticipantConsent: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "tp-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this trial-payment: policy.trial-payments.participant-consented (no consent)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.trial-payments.participant-consented"],
        violations: [
          {
            policyId: "policy.trial-payments.participant-consented",
            reason: "no research-payment consent on file"
          }
        ]
      }
    }
  };
}

describe("TRIAL_PAYMENTS_PRESETS", () => {
  it("has a schedule-approved preset", () => {
    const preset = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "schedule-approved");
    expect(preset).toBeDefined();
    const d = evaluatePayment(preset!.request!);
    expect(d.decision).toBe("schedule-approved");
    expect(d.stipendAmountCents).toBeGreaterThan(0);
  });

  it("has missed-visit and travel-out-of-range pends", () => {
    const missed = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "missed-visit-pend");
    expect(missed!.request).toEqual(DEMO_MISSED_VISIT);
    const travel = TRIAL_PAYMENTS_PRESETS.find(
      (p) => p.id === "travel-out-of-range-pend"
    );
    expect(travel!.request).toEqual(DEMO_TRAVEL_OUT_OF_RANGE);
  });

  it("has an extra-procedure and no-consent preset", () => {
    const extra = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "extra-procedure-pend");
    expect(extra!.request).toEqual(DEMO_EXTRA_PROCEDURE);
    const noConsent = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "blocked-no-consent");
    expect(noConsent!.request).toEqual(DEMO_NO_CONSENT);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "offcat-trial-block");
    expect(off!.decisionOverride!.trialId).toBe("trial.made-up");
    const auto = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "autonomous-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
    const noConsent = TRIAL_PAYMENTS_PRESETS.find((p) => p.id === "no-consent-lied-block");
    expect(noConsent!.decisionOverride!.decision).toBe("schedule-approved");
    expect(noConsent!.request!.hasResearchPaymentConsent).toBe(false);
  });
});

describe("buildTrialPaymentsRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildTrialPaymentsRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_STANDARD_PAYMENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_STANDARD_PAYMENT });
  });
});

describe("runTrialPaymentsTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/trial-payments/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runTrialPaymentsTask(
      { taskId: "task-1", request: DEMO_STANDARD_PAYMENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("tp-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runTrialPaymentsTask(
        { taskId: "t", request: DEMO_STANDARD_PAYMENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("trialPaymentsViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = trialPaymentsViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("schedule-approved");
    expect(view.paymentsTraceToCatalog).toBe(true);
    expect(view.deviationRequiresCoordinatorCosign).toBe(true);
    expect(view.paymentHasParticipantConsent).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = trialPaymentsViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.trial-payments.participant-consented"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "tp-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The trial payment could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = trialPaymentsViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
