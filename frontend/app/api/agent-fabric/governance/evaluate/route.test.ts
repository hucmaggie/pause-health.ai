import { describe, expect, it } from "vitest";
import { POST } from "./route";

/**
 * Route test for POST /api/agent-fabric/governance/evaluate -- the HTTP
 * wrapper over evaluateGovernance(). The evaluator's logic is unit-tested in
 * lib/agent-fabric.test.ts; here we pin the request/response contract:
 * defaults, error handling, no-store caching, and that the wired-up rationale
 * signal actually surfaces through the endpoint.
 */

function post(body: unknown, { raw }: { raw?: string } = {}): Request {
  return new Request("http://test/api/agent-fabric/governance/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body)
  });
}

describe("POST /api/agent-fabric/governance/evaluate", () => {
  it("allows a well-formed Care Router task", async () => {
    const res = await POST(
      post({
        agentId: "care-router-claude",
        task: {
          hasRedFlagScreen: true,
          requestedModel: "claude-sonnet-4-5-20250929",
          hasRationaleField: true
        }
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.result.decision).toBe("allow");
    expect(json.result.blockingViolations).toEqual([]);
    expect(json.result.appliesPolicies.length).toBeGreaterThan(0);
  });

  it("blocks and reports violations for a non-compliant task", async () => {
    const res = await POST(
      post({
        agentId: "care-router-claude",
        task: {
          hasRedFlagScreen: false,
          requestedModel: "gpt-4o",
          hasRationaleField: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.intake.red-flag-mandatory");
    expect(ids).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    // Regression: hasRationaleField used to be accepted but ignored.
    expect(ids).toContain("policy.clinical.rationale-required");
  });

  it("defaults agentId to care-router-claude and task to {}", async () => {
    const res = await POST(post({}));
    const json = await res.json();
    // Empty task -> nothing to violate -> allow, with the router's policies.
    expect(json.result.decision).toBe("allow");
    expect(json.result.appliesPolicies.length).toBeGreaterThan(0);
  });

  it("returns 400 on an unparseable body", async () => {
    const res = await POST(post(undefined, { raw: "{ not json" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid JSON/i);
  });

  it("passes lifecycle/commercial signals through to the evaluator", async () => {
    // Pins that the shared GovernanceTask fields (beyond the Care Router's
    // three) actually reach evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "account-management-agent",
        task: { accessesPhi: true, commitsContractChangeWithoutHumanOwner: true }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.commercial.no-phi-in-commercial-plane");
    expect(ids).toContain(
      "policy.commercial.human-owner-before-contract-change"
    );
  });

  it("passes the patient-education signals through to the evaluator", async () => {
    // Pins that the new patient-education GovernanceTask fields reach
    // evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "patient-education-agent",
        task: {
          educationTracesToEvidenceSource: false,
          staysWithinEducationScope: false,
          coachingOutreachHasConsent: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.education.evidence-sourced");
    expect(ids).toContain("policy.education.no-medical-advice");
    expect(ids).toContain("policy.education.consent-before-outreach");
  });

  it("passes the remote-monitoring signals through to the evaluator", async () => {
    // Pins that the new remote-patient-monitoring GovernanceTask fields reach
    // evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "remote-monitoring-agent",
        task: {
          readingsTraceToSource: false,
          escalationRoutedToHuman: false,
          monitoringHasConsent: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.rpm.reading-source-integrity");
    expect(ids).toContain("policy.rpm.no-autonomous-escalation");
    expect(ids).toContain("policy.rpm.consent-to-monitor");
  });

  it("passes the population-health signals through to the evaluator", async () => {
    // Pins that the new population-health / risk-stratification GovernanceTask
    // fields reach evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "population-health-agent",
        task: {
          riskScoreTracesToFactors: false,
          excludesProtectedAttributes: false,
          tierReviewedByHuman: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.pophealth.transparent-risk-model");
    expect(ids).toContain("policy.pophealth.no-protected-class-factors");
    expect(ids).toContain("policy.pophealth.no-autonomous-care-decision");
  });

  it("passes the consent-management signals through to the evaluator", async () => {
    // Pins that the new consent & preferences management GovernanceTask fields
    // reach evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "consent-management-agent",
        task: {
          consentTracesToRecord: false,
          honorsRevocation: false,
          respectsConsentScope: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.consent.recorded-source");
    expect(ids).toContain("policy.consent.honor-revocation");
    expect(ids).toContain("policy.consent.no-scope-override");
  });

  it("passes the clinical-trials signals through to the evaluator", async () => {
    // Pins that the new clinical-trials / research-matching GovernanceTask fields
    // reach evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "clinical-trials-agent",
        task: {
          eligibilityTracesToCriteria: false,
          researchConsentPresent: false,
          enrollmentRequiresHuman: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.trials.eligibility-criteria-sourced");
    expect(ids).toContain("policy.trials.research-consent-required");
    expect(ids).toContain("policy.trials.no-autonomous-enrollment");
  });

  it("passes the language-access signals through to the evaluator", async () => {
    // Pins that the new language-access / health-equity GovernanceTask fields
    // reach evaluateGovernance across the HTTP boundary.
    const res = await POST(
      post({
        agentId: "language-access-agent",
        task: {
          usesQualifiedInterpreter: false,
          materialsTraceToApprovedSource: false,
          noMachineTranslationForConsent: false
        }
      })
    );
    const json = await res.json();
    expect(json.result.decision).toBe("block");
    const ids = json.result.blockingViolations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.langaccess.qualified-interpreter-only");
    expect(ids).toContain("policy.langaccess.translated-material-source-integrity");
    expect(ids).toContain("policy.langaccess.no-machine-translation-for-consent");
  });

  it("an unknown agent has no applicable policies and allows", async () => {
    const res = await POST(post({ agentId: "ghost-agent", task: {} }));
    const json = await res.json();
    expect(json.result.appliesPolicies).toEqual([]);
    expect(json.result.decision).toBe("allow");
  });
});
