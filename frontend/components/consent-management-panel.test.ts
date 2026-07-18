import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_PRESETS,
  buildConsentRequestBody,
  consentViewFromTask,
  runConsentTask
} from "./consent-management-panel";
import type { A2ATask } from "../lib/a2a";
import {
  consentTracesToRecord,
  evaluateConsent,
  honorsRevocation,
  respectsConsentScope,
  DEMO_CONSENT_LEDGER,
  type ConsentDecision,
  type ConsentEvent
} from "../lib/consent-management";

/**
 * Unit coverage for the /demo/intake Consent & Preferences Management agent
 * panel. This repo tests components as node-env pure functions (see
 * population-health-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes: the JSON-RPC A2A body it POSTs, that
 * runConsentTask returns the resulting task, and that consentViewFromTask lifts a
 * decision and a governance block into render-ready shapes. The task fixtures
 * mirror the shapes app/api/agents/consent-management actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function decidedTask(): A2ATask {
  const decision = evaluateConsent(DEMO_CONSENT_LEDGER, {
    scope: "contact-outreach",
    channel: "sms",
    atTime: "2026-03-01T15:00:00Z"
  });
  return {
    id: "consent-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ConsentDecision",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              decision,
              ledger: {
                patientRef: DEMO_CONSENT_LEDGER.patientRef,
                events: DEMO_CONSENT_LEDGER.events,
                preferences: DEMO_CONSENT_LEDGER.preferences,
                synthetic: true
              }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.consent.recorded-source"],
        traceSpanId: "span-1",
        traceTaskId: "consent-abc",
        consentAllowed: true,
        matchedConsentEventId: decision.matchedConsentEventId,
        consentTracesToRecord: true,
        honorsRevocation: true,
        respectsConsentScope: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "consent-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this consent-management run: policy.consent.honor-revocation (allow against revoked)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.consent.honor-revocation"],
        violations: [
          {
            policyId: "policy.consent.honor-revocation",
            reason: "would allow outreach against a revoked scope"
          }
        ]
      }
    }
  };
}

describe("CONSENT_PRESETS", () => {
  it("has a granted-allowed preset that evaluates to an ALLOW", () => {
    const preset = CONSENT_PRESETS.find((p) => p.id === "granted-allowed");
    expect(preset).toBeDefined();
    const d = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: preset!.scope!,
      channel: preset!.channel,
      atTime: preset!.atTime!
    });
    expect(d.allowed).toBe(true);
  });

  it("has withheld-denied and quiet-hours-denied presets that evaluate to a DENY", () => {
    const withheld = CONSENT_PRESETS.find((p) => p.id === "withheld-denied")!;
    expect(
      evaluateConsent(DEMO_CONSENT_LEDGER, {
        scope: withheld.scope!,
        channel: withheld.channel,
        atTime: withheld.atTime!
      }).allowed
    ).toBe(false);

    const quiet = CONSENT_PRESETS.find((p) => p.id === "quiet-hours-denied")!;
    expect(
      evaluateConsent(DEMO_CONSENT_LEDGER, {
        scope: quiet.scope!,
        channel: quiet.channel,
        atTime: quiet.atTime!
      }).allowed
    ).toBe(false);
  });

  it("has an unrecorded-consent preset whose asserted events don't trace to a record", () => {
    const preset = CONSENT_PRESETS.find((p) => p.id === "unrecorded-consent-block");
    expect(preset).toBeDefined();
    expect(
      consentTracesToRecord(
        preset!.events as Array<Pick<ConsentEvent, "scope" | "status" | "at" | "source">>
      )
    ).toBe(false);
  });

  it("has an allow-against-revoked preset whose decision doesn't honor revocation", () => {
    const preset = CONSENT_PRESETS.find((p) => p.id === "allow-against-revoked-block");
    expect(preset).toBeDefined();
    expect(
      honorsRevocation(
        preset!.decisions as Array<
          Pick<ConsentDecision, "allowed" | "effectiveStatus" | "expired">
        >
      )
    ).toBe(false);
  });

  it("has a scope-override preset whose decision doesn't respect the scope", () => {
    const preset = CONSENT_PRESETS.find((p) => p.id === "scope-override-block");
    expect(preset).toBeDefined();
    expect(
      respectsConsentScope(
        preset!.decisions as Array<Pick<ConsentDecision, "allowed" | "effectiveStatus">>
      )
    ).toBe(false);
  });
});

describe("buildConsentRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a ledger + query data part", () => {
    const body = buildConsentRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      ledger: DEMO_CONSENT_LEDGER,
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect((part.data as { scope: string }).scope).toBe("contact-outreach");
    expect((part.data as { channel: string }).channel).toBe("sms");
  });

  it("posts asserted events and decisions under their data parts", () => {
    const body = buildConsentRequestBody({
      taskId: "task-block",
      scope: "marketing",
      events: [{ scope: "marketing", status: "granted", at: "2026-01-01T00:00:00Z", source: "" }],
      decisions: [{ scope: "marketing", allowed: true, effectiveStatus: "revoked", expired: false }]
    });
    expect(body.params.message.parts[0].data).toEqual({
      scope: "marketing",
      events: [{ scope: "marketing", status: "granted", at: "2026-01-01T00:00:00Z", source: "" }],
      decisions: [{ scope: "marketing", allowed: true, effectiveStatus: "revoked", expired: false }]
    });
  });
});

describe("runConsentTask", () => {
  it("POSTs the A2A body to the consent-management agent and returns the resulting task", async () => {
    const task = decidedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/consent-management/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.scope).toBe("contact-outreach");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runConsentTask(
      { taskId: "task-1", ledger: DEMO_CONSENT_LEDGER, scope: "contact-outreach", channel: "sms", atTime: "2026-03-01T15:00:00Z" },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("consent-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runConsentTask({ taskId: "t", scope: "contact-outreach" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/400/);
  });
});

describe("consentViewFromTask", () => {
  it("lifts a produced decision with the ledger, preferences, and honesty signals", () => {
    const view = consentViewFromTask(decidedTask());
    expect(view.kind).toBe("decided");
    if (view.kind !== "decided") return;
    expect(view.decision.allowed).toBe(true);
    expect(view.decision.matchedConsentEventId).toBe("consent-evt-contact-001");
    expect(view.events.length).toBeGreaterThan(0);
    expect(view.preferences?.allowedChannels).toContain("sms");
    expect(view.patientRef).toBe("consent-patient-001");
    expect(view.consentTracesToRecord).toBe(true);
    expect(view.honorsRevocation).toBe(true);
    expect(view.respectsConsentScope).toBe(true);
    expect(view.traceTaskId).toBe("consent-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = consentViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this consent-management run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.consent.honor-revocation"
    );
    expect(view.policiesEvaluated).toContain("policy.consent.honor-revocation");
    expect(view.traceTaskId).toBe("consent-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "consent-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The consent decision could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = consentViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
