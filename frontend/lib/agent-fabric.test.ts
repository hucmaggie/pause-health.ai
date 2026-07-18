import { describe, expect, it } from "vitest";
import {
  evaluableBlockPolicyIds,
  evaluateGovernance,
  getAgent,
  getPoliciesForAgent,
  listAgents,
  listPolicies,
  listRecentTaskIds,
  listTraces,
  recordInstantSpan,
  recordSpan,
  type TraceSpan
} from "./agent-fabric";
import {
  BOOLEAN_BLOCK_SIGNALS,
  MODEL_ALLOWLIST_POLICY_ID
} from "./governance-signals";
import {
  GOVERNANCE_PLANES,
  GOVERNANCE_TIERS,
  planeForTier
} from "./governance-tiers";

/**
 * Tests for lib/agent-fabric.ts -- the in-memory mock of the
 * MuleSoft Agent Fabric control plane.
 *
 * Important shape consideration: the trace ring buffer lives in a
 * module-scoped global so it survives Next.js hot reload and is
 * shared across every API route in the same Node process. The
 * module also seeds 5 historical spans on first load. These tests
 * use task ids unique to each test ("test-task-<random>") so they
 * cannot conflict with the seeded spans OR with other tests in this
 * file -- and they assert via per-task filtering rather than total
 * counts, so adding more seed spans in the future cannot break them.
 */

function uniqueTaskId(label: string): string {
  return `test-task-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("Agent + Policy registries", () => {
  it("exposes a non-trivial agent registry", () => {
    const agents = listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(5);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("agentforce-intake");
    expect(ids).toContain("care-router-claude");
    expect(ids).toContain("salesforce-data-360");
  });

  it("returns a copy from listAgents (mutating the result doesn't poison the registry)", () => {
    const copy = listAgents();
    const before = copy.length;
    copy.push({} as never);
    expect(listAgents()).toHaveLength(before);
  });

  it("getAgent resolves by id and returns undefined for unknowns", () => {
    expect(getAgent("care-router-claude")?.kind).toBe("anthropic-claude");
    expect(getAgent("does-not-exist")).toBeUndefined();
  });

  it("listPolicies returns a non-empty list with a stable shape", () => {
    const policies = listPolicies();
    expect(policies.length).toBeGreaterThan(5);
    for (const p of policies) {
      expect(p.id).toMatch(/^policy\./);
      expect(["block", "audit", "rate-limit", "redact"]).toContain(p.enforcement);
      expect(["enforced", "advisory", "draft"]).toContain(p.status);
    }
  });

  it("getPoliciesForAgent filters by appliesTo membership", () => {
    const careRouter = getPoliciesForAgent("care-router-claude").map(
      (p) => p.id
    );
    expect(careRouter).toContain("policy.intake.red-flag-mandatory");
    expect(careRouter).toContain(
      "policy.model.anthropic-claude-sonnet-allowlisted"
    );
    // The Data 360 federation policy applies only to Data 360, not
    // the care router.
    expect(careRouter).not.toContain("policy.data360.zero-copy-federation");
  });

  it("returns an empty array for an unknown agent id", () => {
    expect(getPoliciesForAgent("does-not-exist")).toEqual([]);
  });
});

describe("Registry policies derive from the policy catalog (single source of truth)", () => {
  // Regression guard: agent .policies used to be a hand-maintained second copy
  // that drifted from POLICIES[].appliesTo. It under-listed the Care Router
  // (missing the consent, red-flag, and HIPAA-audit policies it enforces) and
  // MuleSoft (missing FHIR + bearer-token), and referenced a policy id that
  // doesn't exist. Now .policies is derived, so these can never disagree.
  it("every agent's .policies exactly equals getPoliciesForAgent(id)", () => {
    for (const a of listAgents()) {
      expect(a.policies).toEqual(getPoliciesForAgent(a.id).map((p) => p.id));
    }
  });

  it("the Care Router advertises every policy it actually enforces", () => {
    const p = getAgent("care-router-claude")!.policies;
    // The two policies evaluateGovernance() can actively block on...
    expect(p).toContain("policy.intake.red-flag-mandatory");
    expect(p).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    // ...plus the audit + consent policies whose appliesTo includes the router
    // but which the old hand-list omitted.
    expect(p).toContain("policy.audit.hipaa-log-every-turn");
    expect(p).toContain("policy.data360.consent-required-before-grounding");
  });

  it("MuleSoft ingest no longer references a phantom policy id", () => {
    const p = getAgent("mulesoft-ingest")!.policies;
    // The old registry listed "policy.audit.correlation-id-mandatory", which
    // was never defined in the catalog. The real id is the return- form.
    expect(p).not.toContain("policy.audit.correlation-id-mandatory");
    expect(p).toContain("policy.audit.return-mulesoft-correlation-id");
    expect(p).toContain("policy.data.fhir-r5-only");
  });
});

describe("Patient-lifecycle agents · Prospecting + Engagement", () => {
  it("registers both lifecycle agents as prototype Agentforce agents", () => {
    const prospecting = getAgent("prospecting-agent");
    const engagement = getAgent("engagement-agent");
    expect(prospecting).toBeDefined();
    expect(engagement).toBeDefined();

    expect(prospecting!.kind).toBe("agentforce");
    expect(prospecting!.protocol).toBe("a2a");
    expect(prospecting!.provider).toBe("Salesforce");
    expect(prospecting!.status).toBe("prototype");
    expect(prospecting!.governanceTier).toBe("patient-acquisition");

    expect(engagement!.kind).toBe("agentforce");
    expect(engagement!.governanceTier).toBe("patient-engagement");
    expect(engagement!.status).toBe("prototype");
  });

  it("gates outreach on contact-consent and human approval (no autonomous send)", () => {
    for (const id of ["prospecting-agent", "engagement-agent"]) {
      const ids = getPoliciesForAgent(id).map((p) => p.id);
      expect(ids).toContain("policy.marketing.consent-to-contact-required");
      expect(ids).toContain("policy.marketing.human-approval-before-send");
      // Every lifecycle agent turn is still HIPAA-audited.
      expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    }
  });

  it("applies quiet-hours + frequency-cap only to the engagement agent", () => {
    const engagement = getPoliciesForAgent("engagement-agent").map((p) => p.id);
    expect(engagement).toContain(
      "policy.engagement.quiet-hours-and-channel-preference"
    );
    expect(engagement).toContain("policy.engagement.frequency-cap");

    const prospecting = getPoliciesForAgent("prospecting-agent").map((p) => p.id);
    expect(prospecting).not.toContain(
      "policy.engagement.quiet-hours-and-channel-preference"
    );
    expect(prospecting).not.toContain("policy.engagement.frequency-cap");
  });

  it("gives the Prospecting & Nurture agent a lead-nurture cadence cap (rate-limited, prospecting only)", () => {
    const prospecting = getPoliciesForAgent("prospecting-agent").map((p) => p.id);
    expect(prospecting).toContain("policy.marketing.nurture-cadence-cap");
    // The nurture cadence cap is a prospecting-side concern; the enrolled-
    // patient frequency cap stays on the engagement agent.
    const engagement = getPoliciesForAgent("engagement-agent").map((p) => p.id);
    expect(engagement).not.toContain("policy.marketing.nurture-cadence-cap");

    const policy = listPolicies().find(
      (p) => p.id === "policy.marketing.nurture-cadence-cap"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("rate-limit");
    expect(policy!.status).toBe("enforced");
  });

  it("the human-approval policy is an enforced block (the prototype never sends)", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.marketing.human-approval-before-send"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("seeds a growth→intake→routing→engagement lifecycle trace so both agents are visible in the console", () => {
    const spans = listTraces({ taskId: "task-seed-growth-lifecycle-001" });
    expect(spans.length).toBeGreaterThanOrEqual(5);
    const agentIds = spans.map((s) => s.agentId);
    expect(agentIds).toContain("prospecting-agent");
    expect(agentIds).toContain("engagement-agent");
    // Ordered by startedAt: prospecting qualifies the audience first,
    // engagement schedules the follow-up last.
    expect(spans[0].agentId).toBe("prospecting-agent");
    expect(spans[spans.length - 1].agentId).toBe("engagement-agent");
    // Honesty invariant: the drafted outreach is never auto-sent.
    const draft = spans.find((s) => s.operation === "prospect.outreach.draft");
    expect(draft?.attributes?.sent).toBe(false);
    expect(draft?.attributes?.humanApprovalRequired).toBe(true);

    // The nurture step is visible in the trace: a scored, cadence-driven
    // touch that is likewise human-approval-gated and unsent.
    const nurture = spans.find((s) => s.operation === "prospect.nurture.advance");
    expect(nurture).toBeDefined();
    expect(nurture!.agentId).toBe("prospecting-agent");
    expect(typeof nurture!.attributes?.leadScore).toBe("number");
    expect(nurture!.attributes?.sent).toBe(false);
    expect(nurture!.attributes?.humanApprovalRequired).toBe(true);
  });
});

describe("Inbound acquisition · Inbound Lead Generation agent", () => {
  it("registers as a prototype Agentforce agent on the acquisition tier", () => {
    const inbound = getAgent("inbound-lead-agent");
    expect(inbound).toBeDefined();
    expect(inbound!.kind).toBe("agentforce");
    expect(inbound!.protocol).toBe("a2a");
    expect(inbound!.provider).toBe("Salesforce");
    expect(inbound!.status).toBe("prototype");
    // Inbound lead gen is the inbound sibling of outbound prospecting;
    // both sit on the patient-acquisition tier.
    expect(inbound!.governanceTier).toBe("patient-acquisition");
  });

  it("gates lead capture on explicit opt-in + source and identity resolution", () => {
    const ids = getPoliciesForAgent("inbound-lead-agent").map((p) => p.id);
    expect(ids).toContain("policy.lead.explicit-optin-and-source-required");
    expect(ids).toContain("policy.lead.identity-resolution-before-create");
    // Still HIPAA-audited like every other agent turn.
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
  });

  it("both inbound-lead policies are enforced blocks", () => {
    for (const id of [
      "policy.lead.explicit-optin-and-source-required",
      "policy.lead.identity-resolution-before-create"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement).toBe("block");
      expect(policy!.status).toBe("enforced");
    }
  });

  it("does NOT carry the outbound nurture/marketing policies (inbound is a different funnel)", () => {
    const ids = getPoliciesForAgent("inbound-lead-agent").map((p) => p.id);
    expect(ids).not.toContain("policy.marketing.nurture-cadence-cap");
    expect(ids).not.toContain("policy.marketing.consent-to-contact-required");
  });

  it("seeds an inbound capture→qualify→resolve→handoff trace ending in intake", () => {
    const spans = listTraces({ taskId: "task-seed-inbound-lead-001" });
    expect(spans.length).toBeGreaterThanOrEqual(5);

    // First three spans are the inbound agent's own capture/qualify/resolve.
    expect(spans[0].agentId).toBe("inbound-lead-agent");
    expect(spans[0].operation).toBe("lead.capture");
    expect(spans.map((s) => s.operation)).toEqual(
      expect.arrayContaining([
        "lead.capture",
        "lead.qualify",
        "lead.identity.resolve",
        "lead.route.handoff"
      ])
    );

    // Honesty invariants: consent captured, deduped (create, not merge),
    // and the ready lead lands in intake.
    const capture = spans.find((s) => s.operation === "lead.capture");
    expect(capture?.attributes?.consentOptIn).toBe(true);
    const resolve = spans.find((s) => s.operation === "lead.identity.resolve");
    expect(resolve?.attributes?.matched).toBe(false);
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("agentforce-intake");
    expect(last.attributes?.convertedFromInboundLead).toBe(true);
  });
});

describe("Lead qualification · Qualification agent", () => {
  it("registers as a prototype Agentforce agent on its own lead-qualification tier", () => {
    const q = getAgent("qualification-agent");
    expect(q).toBeDefined();
    expect(q!.kind).toBe("agentforce");
    expect(q!.protocol).toBe("a2a");
    expect(q!.provider).toBe("Salesforce");
    expect(q!.status).toBe("prototype");
    expect(q!.governanceTier).toBe("lead-qualification");
  });

  it("requires rationale, forbids protected-class criteria, and keeps disqualifications reviewable", () => {
    const ids = getPoliciesForAgent("qualification-agent").map((p) => p.id);
    expect(ids).toContain("policy.qualification.rationale-required");
    expect(ids).toContain("policy.qualification.no-protected-class-criteria");
    expect(ids).toContain("policy.qualification.human-review-on-disqualify");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
  });

  it("enforces rationale + no-protected-class as blocks and disqualify-review as an audit", () => {
    const byId = (id: string) => listPolicies().find((p) => p.id === id)!;
    expect(byId("policy.qualification.rationale-required").enforcement).toBe(
      "block"
    );
    expect(
      byId("policy.qualification.no-protected-class-criteria").enforcement
    ).toBe("block");
    const review = byId("policy.qualification.human-review-on-disqualify");
    expect(review.enforcement).toBe("audit");
    expect(review.status).toBe("enforced");
  });

  it("is the gate before intake on BOTH the inbound and outbound seeded traces", () => {
    for (const taskId of [
      "task-seed-inbound-lead-001",
      "task-seed-growth-lifecycle-001"
    ]) {
      const spans = listTraces({ taskId });
      const decide = spans.find((s) => s.operation === "qualification.decide");
      expect(decide, taskId).toBeDefined();
      expect(decide!.agentId).toBe("qualification-agent");
      expect(decide!.attributes?.decision).toBe("qualified");
      // Honesty invariant: qualification never used a protected-class attribute.
      expect(decide!.attributes?.protectedClassUsed).toBe(false);
      expect(typeof decide!.attributes?.rationale).toBe("string");

      // The qualification decision precedes the intake.complete span.
      const decideIdx = spans.findIndex(
        (s) => s.operation === "qualification.decide"
      );
      const intakeIdx = spans.findIndex((s) => s.operation === "intake.complete");
      expect(intakeIdx).toBeGreaterThan(decideIdx);
    }
  });
});

describe("Validated-instrument assessment · Assessment agent", () => {
  it("registers as a prototype Agentforce agent on the patient-facing tier", () => {
    const a = getAgent("assessment-agent");
    expect(a).toBeDefined();
    expect(a!.kind).toBe("agentforce");
    expect(a!.protocol).toBe("a2a");
    expect(a!.provider).toBe("Salesforce");
    expect(a!.status).toBe("prototype");
    // The Assessment Agent is a clinical, patient-facing agent on the
    // patient-care plane (reuses the intake agent's tier).
    expect(a!.governanceTier).toBe("patient-facing");
    expect(planeForTier(a!.governanceTier)).toBe("patient-care");
    expect(a!.endpoint).toBe("/api/agents/assessment");
  });

  it("carries the validated-instrument block plus the reused PHI/red-flag/audit policies", () => {
    const ids = getPoliciesForAgent("assessment-agent").map((p) => p.id);
    expect(ids).toContain("policy.assessment.validated-instrument-only");
    expect(ids).toContain("policy.phi.no-free-text-pii");
    expect(ids).toContain("policy.intake.red-flag-mandatory");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
  });

  it("the validated-instrument policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.assessment.validated-instrument-only"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks an off-allowlist instrument and allows an allow-listed one", () => {
    const blocked = evaluateGovernance({
      agentId: "assessment-agent",
      task: {
        administersValidatedInstrumentOnly: false,
        containsFreeTextPii: false,
        hasRedFlagScreen: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.assessment.validated-instrument-only"
    );

    const allowed = evaluateGovernance({
      agentId: "assessment-agent",
      task: {
        administersValidatedInstrumentOnly: true,
        containsFreeTextPii: false,
        hasRedFlagScreen: true
      }
    });
    expect(allowed.decision).toBe("allow");
    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "assessment-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds an assessment→intake→routing trace where a real score feeds severity", () => {
    const spans = listTraces({ taskId: "task-seed-assessment-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    expect(spans[0].agentId).toBe("assessment-agent");
    expect(spans[0].operation).toBe("assessment.score");
    // The scored severity feeds the intake, which routes to the Care Router.
    const score = spans.find((s) => s.operation === "assessment.score");
    expect(score?.attributes?.validatedInstrument).toBe(true);
    expect(score?.attributes?.scoringMethod).toBe("deterministic");
    const intake = spans.find((s) => s.operation === "intake.complete");
    expect(intake?.attributes?.severity).toBe(score?.attributes?.normalizedSeverity);
    expect(intake?.attributes?.severitySource).toBe("assessment:mrs");
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("care-router-claude");
  });
});

describe("Benefits & Coverage Verification (EBV) · Benefits agent", () => {
  it("brings the registry to twenty-five agents", () => {
    // Sanity count guard: the funnel + intake + assessment + benefits +
    // scheduling + care-gap-closure + care-plan + medication-adherence +
    // referral-management + member-service + prior-authorization +
    // clinical-summary + sdoh-screening + patient-education +
    // remote-monitoring agents, the Care Router, the platform substrate, and
    // the commercial plane.
    expect(listAgents()).toHaveLength(25);
    expect(listAgents().map((a) => a.id)).toContain("benefits-verification-agent");
  });

  it("registers as a prototype Agentforce agent on its own benefits-verification tier", () => {
    const b = getAgent("benefits-verification-agent");
    expect(b).toBeDefined();
    expect(b!.kind).toBe("agentforce");
    expect(b!.protocol).toBe("a2a");
    expect(b!.provider).toBe("Salesforce");
    expect(b!.status).toBe("prototype");
    expect(b!.governanceTier).toBe("benefits-verification");
    // The EBV agent is a patient-access agent on the patient-care plane.
    expect(planeForTier(b!.governanceTier)).toBe("patient-care");
    expect(b!.endpoint).toBe("/api/agents/benefits-verification");
  });

  it("carries the source-integrity block plus the reused consent + HIPAA-audit policies", () => {
    const ids = getPoliciesForAgent("benefits-verification-agent").map((p) => p.id);
    expect(ids).toContain("policy.benefits.eligibility-source-integrity");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the source-integrity policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.benefits.eligibility-source-integrity"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks a coverage result that doesn't trace to a source, allows one that does", () => {
    const blocked = evaluateGovernance({
      agentId: "benefits-verification-agent",
      task: { eligibilityTracesToSource: false, hasAiDecisionSupportConsent: true }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.benefits.eligibility-source-integrity"
    );

    const allowed = evaluateGovernance({
      agentId: "benefits-verification-agent",
      task: { eligibilityTracesToSource: true, hasAiDecisionSupportConsent: true }
    });
    expect(allowed.decision).toBe("allow");

    // Coverage verification is consent-gated too.
    const noConsent = evaluateGovernance({
      agentId: "benefits-verification-agent",
      task: { eligibilityTracesToSource: true, hasAiDecisionSupportConsent: false }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.data360.consent-required-before-grounding"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "benefits-verification-agent", task: {} })
        .decision
    ).toBe("allow");
  });

  it("seeds a coverage→intake→routing trace where every result is source-backed", () => {
    const spans = listTraces({ taskId: "task-seed-benefits-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    expect(spans[0].agentId).toBe("benefits-verification-agent");
    expect(spans[0].operation).toBe("benefits.verify");
    const verify = spans.find((s) => s.operation === "benefits.verify");
    expect(verify?.attributes?.sourced).toBe(true);
    expect(verify?.attributes?.synthetic).toBe(true);
    // Coverage precedes the intake, which routes to the Care Router.
    const intake = spans.find((s) => s.operation === "intake.complete");
    expect(intake?.attributes?.coverageVerified).toBe(true);
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("care-router-claude");
  });
});

describe("Appointment Scheduling · Care-coordination agent", () => {
  it("registers as a prototype Agentforce agent on its own care-coordination tier", () => {
    const s = getAgent("appointment-scheduling-agent");
    expect(s).toBeDefined();
    expect(s!.kind).toBe("agentforce");
    expect(s!.protocol).toBe("a2a");
    expect(s!.provider).toBe("Salesforce");
    expect(s!.status).toBe("prototype");
    expect(s!.governanceTier).toBe("care-coordination");
    // The scheduling agent is a care-coordination agent on the patient-care plane.
    expect(planeForTier(s!.governanceTier)).toBe("patient-care");
    expect(s!.endpoint).toBe("/api/agents/appointment-scheduling");
  });

  it("carries the two scheduling blocks plus the reused HIPAA-audit policy", () => {
    const ids = getPoliciesForAgent("appointment-scheduling-agent").map(
      (p) => p.id
    );
    expect(ids).toContain("policy.scheduling.no-double-book");
    expect(ids).toContain("policy.scheduling.honor-provider-availability");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("both scheduling policies are enforced blocks", () => {
    for (const id of [
      "policy.scheduling.no-double-book",
      "policy.scheduling.honor-provider-availability"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement).toBe("block");
      expect(policy!.status).toBe("enforced");
    }
  });

  it("blocks a double-book or an out-of-availability slot, allows a free published slot", () => {
    const doubleBook = evaluateGovernance({
      agentId: "appointment-scheduling-agent",
      task: { requestedSlotIsFree: false, slotWithinProviderAvailability: true }
    });
    expect(doubleBook.decision).toBe("block");
    expect(doubleBook.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.scheduling.no-double-book"
    );

    const outOfAvail = evaluateGovernance({
      agentId: "appointment-scheduling-agent",
      task: { requestedSlotIsFree: true, slotWithinProviderAvailability: false }
    });
    expect(outOfAvail.decision).toBe("block");
    expect(outOfAvail.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.scheduling.honor-provider-availability"
    );

    const allowed = evaluateGovernance({
      agentId: "appointment-scheduling-agent",
      task: { requestedSlotIsFree: true, slotWithinProviderAvailability: true }
    });
    expect(allowed.decision).toBe("allow");

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "appointment-scheduling-agent", task: {} })
        .decision
    ).toBe("allow");
  });

  it("seeds a router→booking→engagement trace that closes the loop", () => {
    const spans = listTraces({ taskId: "task-seed-scheduling-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // Care Router recommendation first, engagement reminders last.
    expect(spans[0].agentId).toBe("care-router-claude");
    const book = spans.find((s) => s.operation === "scheduling.book");
    expect(book?.agentId).toBe("appointment-scheduling-agent");
    expect(book?.attributes?.synthetic).toBe(true);
    expect(book?.attributes?.requestedSlotIsFree).toBe(true);
    expect(book?.attributes?.slotWithinProviderAvailability).toBe(true);
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("engagement-agent");
    expect(last.operation).toBe("engagement.reminder.schedule");
  });
});

describe("Care Gap Closure · Preventive-care agent", () => {
  it("registers as a prototype Agentforce agent on its own care-gap tier", () => {
    const c = getAgent("care-gap-closure-agent");
    expect(c).toBeDefined();
    expect(c!.kind).toBe("agentforce");
    expect(c!.protocol).toBe("a2a");
    expect(c!.provider).toBe("Salesforce");
    expect(c!.status).toBe("prototype");
    expect(c!.governanceTier).toBe("care-gap");
    // The Care Gap Closure agent is proactive patient care on the patient-care
    // plane (its own care-gap tier).
    expect(planeForTier(c!.governanceTier)).toBe("patient-care");
    expect(c!.endpoint).toBe("/api/agents/care-gap-closure");
  });

  it("carries the clinical-measure-sourced block plus the reused outreach/consent/audit policies", () => {
    const ids = getPoliciesForAgent("care-gap-closure-agent").map((p) => p.id);
    expect(ids).toContain("policy.caregap.clinical-measure-sourced");
    // Reuses the engagement outreach + consent + grounding-consent + audit
    // policies where they apply.
    expect(ids).toContain("policy.marketing.consent-to-contact-required");
    expect(ids).toContain("policy.marketing.human-approval-before-send");
    expect(ids).toContain("policy.engagement.quiet-hours-and-channel-preference");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the clinical-measure-sourced policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.caregap.clinical-measure-sourced"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks a fabricated (off-catalog) gap, allows one that traces to a clinical measure", () => {
    const blocked = evaluateGovernance({
      agentId: "care-gap-closure-agent",
      task: {
        gapsTraceToClinicalMeasure: false,
        hasContactConsent: true,
        hasAiDecisionSupportConsent: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.caregap.clinical-measure-sourced"
    );

    const allowed = evaluateGovernance({
      agentId: "care-gap-closure-agent",
      task: {
        gapsTraceToClinicalMeasure: true,
        hasContactConsent: true,
        hasAiDecisionSupportConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Outreach is consent-gated too.
    const noConsent = evaluateGovernance({
      agentId: "care-gap-closure-agent",
      task: { gapsTraceToClinicalMeasure: true, hasContactConsent: false }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.marketing.consent-to-contact-required"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "care-gap-closure-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a grounding→detect→draft→engagement-handoff trace", () => {
    const spans = listTraces({ taskId: "task-seed-caregap-001" });
    expect(spans.length).toBeGreaterThanOrEqual(4);
    // Grounding first, engagement handoff last.
    expect(spans[0].agentId).toBe("salesforce-data-360");
    expect(spans[0].operation).toBe("data360.grounding");
    const detect = spans.find((s) => s.operation === "caregap.detect");
    expect(detect?.agentId).toBe("care-gap-closure-agent");
    expect(detect?.attributes?.gapsTraceToClinicalMeasure).toBe(true);
    expect(detect?.attributes?.synthetic).toBe(true);
    // Every drafted outreach is human-approval-gated and never sent.
    const drafts = spans.filter((s) => s.operation === "caregap.outreach.draft");
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.attributes?.humanApprovalRequired).toBe(true);
      expect(d.attributes?.sent).toBe(false);
    }
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("engagement-agent");
    expect(last.operation).toBe("engagement.outreach.handoff");
  });
});

describe("Care Plan · Clinical-decision live-Claude sibling", () => {
  it("registers as a prototype anthropic-claude agent on the clinical-decision tier", () => {
    const c = getAgent("care-plan-agent");
    expect(c).toBeDefined();
    // Live-Claude clinical agent, marked like the Care Router.
    expect(c!.kind).toBe("anthropic-claude");
    expect(c!.protocol).toBe("a2a");
    expect(c!.provider).toBe("Anthropic + Pause-Health.ai");
    expect(c!.status).toBe("prototype");
    // Reuses the Care Router's clinical-decision tier (patient-care plane).
    expect(c!.governanceTier).toBe("clinical-decision");
    expect(planeForTier(c!.governanceTier)).toBe("patient-care");
    expect(c!.endpoint).toBe("/api/agents/care-plan");
  });

  it("carries the template-sourced block plus the reused clinical/model/consent/audit policies", () => {
    const ids = getPoliciesForAgent("care-plan-agent").map((p) => p.id);
    expect(ids).toContain("policy.careplan.template-sourced");
    // Reused from the Care Router by extending appliesTo.
    expect(ids).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    expect(ids).toContain("policy.clinical.no-prescribing");
    expect(ids).toContain("policy.clinical.rationale-required");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the template-sourced policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.careplan.template-sourced"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks a fabricated (off-template) plan, allows one that traces to a template", () => {
    const blocked = evaluateGovernance({
      agentId: "care-plan-agent",
      task: {
        planTracesToTemplate: false,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasRationaleField: true,
        hasAiDecisionSupportConsent: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.careplan.template-sourced"
    );

    const allowed = evaluateGovernance({
      agentId: "care-plan-agent",
      task: {
        planTracesToTemplate: true,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasRationaleField: true,
        hasAiDecisionSupportConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Model allow-list is enforced just like the Care Router.
    const offModel = evaluateGovernance({
      agentId: "care-plan-agent",
      task: { planTracesToTemplate: true, requestedModel: "gpt-4o" }
    });
    expect(offModel.decision).toBe("block");
    expect(offModel.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.model.anthropic-claude-sonnet-allowlisted"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "care-plan-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a router→instantiate→summarize trace showing a deterministic scripted-fallback summary", () => {
    const spans = listTraces({ taskId: "task-seed-careplan-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // Care Router recommendation first, care-plan summary last.
    expect(spans[0].agentId).toBe("care-router-claude");
    const instantiate = spans.find((s) => s.operation === "careplan.instantiate");
    expect(instantiate?.agentId).toBe("care-plan-agent");
    expect(instantiate?.attributes?.planTracesToTemplate).toBe(true);
    expect(instantiate?.attributes?.synthetic).toBe(true);
    const summarize = spans.find((s) => s.operation === "careplan.summarize");
    expect(summarize?.agentId).toBe("care-plan-agent");
    // Seeded example is deterministic: scripted-fallback with a fallbackReason,
    // so it doesn't imply a live Claude call happened at seed time.
    expect(summarize?.attributes?.via).toBe("scripted-fallback");
    expect(typeof summarize?.attributes?.fallbackReason).toBe("string");
  });
});

describe("Medication Adherence · Nudge-only refill/adherence agent", () => {
  it("registers as a prototype Agentforce agent on the patient-engagement tier", () => {
    const m = getAgent("medication-adherence-agent");
    expect(m).toBeDefined();
    expect(m!.kind).toBe("agentforce");
    expect(m!.protocol).toBe("a2a");
    expect(m!.provider).toBe("Salesforce");
    expect(m!.status).toBe("prototype");
    // Proactive patient-engagement agent on the patient-care plane.
    expect(m!.governanceTier).toBe("patient-engagement");
    expect(planeForTier(m!.governanceTier)).toBe("patient-care");
    expect(m!.endpoint).toBe("/api/agents/medication-adherence");
  });

  it("carries the no-autonomous-refill block plus the reused no-prescribing/outreach/consent/audit policies", () => {
    const ids = getPoliciesForAgent("medication-adherence-agent").map((p) => p.id);
    expect(ids).toContain("policy.medication.no-autonomous-refill");
    // Reused clinical + engagement outreach guards.
    expect(ids).toContain("policy.clinical.no-prescribing");
    expect(ids).toContain("policy.marketing.consent-to-contact-required");
    expect(ids).toContain("policy.marketing.human-approval-before-send");
    expect(ids).toContain("policy.engagement.quiet-hours-and-channel-preference");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the no-autonomous-refill policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.medication.no-autonomous-refill"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks an autonomous refill, allows a human-approval-gated nudge", () => {
    const blocked = evaluateGovernance({
      agentId: "medication-adherence-agent",
      task: {
        refillRequiresHumanApproval: false,
        hasContactConsent: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.medication.no-autonomous-refill"
    );

    const allowed = evaluateGovernance({
      agentId: "medication-adherence-agent",
      task: {
        refillRequiresHumanApproval: true,
        hasContactConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Outreach is consent-gated too.
    const noConsent = evaluateGovernance({
      agentId: "medication-adherence-agent",
      task: { refillRequiresHumanApproval: true, hasContactConsent: false }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.marketing.consent-to-contact-required"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "medication-adherence-agent", task: {} })
        .decision
    ).toBe("allow");
  });

  it("seeds an assess→nudge→dropoff→engagement-handoff trace", () => {
    const spans = listTraces({ taskId: "task-seed-medication-adherence-001" });
    expect(spans.length).toBeGreaterThanOrEqual(4);
    // Assessment first, engagement handoff last.
    expect(spans[0].agentId).toBe("medication-adherence-agent");
    expect(spans[0].operation).toBe("medication.adherence.assess");
    expect(spans[0].attributes?.refillRequiresHumanApproval).toBe(true);
    expect(spans[0].attributes?.synthetic).toBe(true);
    // Every drafted nudge is human-approval-gated, nudge-only, and never sent.
    const nudges = spans.filter((s) => s.operation === "medication.nudge.draft");
    expect(nudges.length).toBeGreaterThan(0);
    for (const n of nudges) {
      expect(n.attributes?.humanApprovalRequired).toBe(true);
      expect(n.attributes?.nudgeOnly).toBe(true);
      expect(n.attributes?.sent).toBe(false);
    }
    // The drop-off is flagged to the care team.
    const dropoff = spans.find((s) => s.operation === "medication.dropoff.flag");
    expect(dropoff?.agentId).toBe("medication-adherence-agent");
    expect(dropoff?.attributes?.routedTo).toBe("care-team");
    const last = spans[spans.length - 1];
    expect(last.agentId).toBe("engagement-agent");
    expect(last.operation).toBe("engagement.outreach.handoff");
  });
});

describe("Referral Management · Cosign-gated outbound-referral agent", () => {
  it("registers as a prototype Agentforce agent on the care-coordination tier", () => {
    const r = getAgent("referral-management-agent");
    expect(r).toBeDefined();
    expect(r!.kind).toBe("agentforce");
    expect(r!.protocol).toBe("a2a");
    expect(r!.provider).toBe("Salesforce");
    expect(r!.status).toBe("prototype");
    // Reuses the Scheduling agent's care-coordination tier (patient-care plane).
    expect(r!.governanceTier).toBe("care-coordination");
    expect(planeForTier(r!.governanceTier)).toBe("patient-care");
    expect(r!.endpoint).toBe("/api/agents/referral-management");
  });

  it("carries the clinician-cosign block plus the reused rationale + HIPAA-audit policies", () => {
    const ids = getPoliciesForAgent("referral-management-agent").map((p) => p.id);
    expect(ids).toContain("policy.referral.clinician-cosign");
    // Reused by extending appliesTo.
    expect(ids).toContain("policy.clinical.rationale-required");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the clinician-cosign policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.referral.clinician-cosign"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks a send-without-cosign, allows a cosign-gated draft", () => {
    const blocked = evaluateGovernance({
      agentId: "referral-management-agent",
      task: {
        referralHasClinicianCosign: false,
        hasRationaleField: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.referral.clinician-cosign"
    );

    const allowed = evaluateGovernance({
      agentId: "referral-management-agent",
      task: {
        referralHasClinicianCosign: true,
        hasRationaleField: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // A reasonless referral trips the reused rationale-required block.
    const noReason = evaluateGovernance({
      agentId: "referral-management-agent",
      task: { referralHasClinicianCosign: true, hasRationaleField: false }
    });
    expect(noReason.decision).toBe("block");
    expect(noReason.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.clinical.rationale-required"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "referral-management-agent", task: {} })
        .decision
    ).toBe("allow");
  });

  it("seeds a triage→draft→await-cosign trace generalizing the router handoff", () => {
    const spans = listTraces({ taskId: "task-seed-referral-001" });
    expect(spans.length).toBeGreaterThanOrEqual(4);
    // Triage first, await-cosign last.
    expect(spans[0].agentId).toBe("referral-management-agent");
    expect(spans[0].operation).toBe("referral.triage");
    expect(spans[0].attributes?.referralHasClinicianCosign).toBe(true);
    expect(spans[0].attributes?.referralsTraceToSpecialty).toBe(true);
    expect(spans[0].attributes?.synthetic).toBe(true);
    // Every drafted referral is cosign-gated, drafted, and never sent.
    const drafts = spans.filter((s) => s.operation === "referral.draft");
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.attributes?.requiresClinicianCosign).toBe(true);
      expect(d.attributes?.status).toBe("drafted");
      expect(d.attributes?.sent).toBe(false);
    }
    // Behavioral-health referral generalizes the Care Router handoff.
    expect(drafts.map((d) => d.attributes?.specialtyId)).toContain(
      "referral.behavioral-health"
    );
    const last = spans[spans.length - 1];
    expect(last.operation).toBe("referral.await-cosign");
    expect(last.attributes?.sent).toBe(false);
  });
});

describe("Member Service · Billing/coverage patient-service agent", () => {
  it("registers as a prototype Agentforce agent on the patient-facing tier", () => {
    const m = getAgent("member-service-agent");
    expect(m).toBeDefined();
    expect(m!.kind).toBe("agentforce");
    expect(m!.protocol).toBe("a2a");
    expect(m!.provider).toBe("Salesforce");
    expect(m!.status).toBe("prototype");
    // The Member Service agent is patient-facing self-service on the
    // patient-care plane (reuses the intake agent's tier).
    expect(m!.governanceTier).toBe("patient-facing");
    expect(planeForTier(m!.governanceTier)).toBe("patient-care");
    expect(m!.endpoint).toBe("/api/agents/member-service");
  });

  it("carries the claim-data-sourced block plus the reused no-free-text-pii + HIPAA-audit policies", () => {
    const ids = getPoliciesForAgent("member-service-agent").map((p) => p.id);
    expect(ids).toContain("policy.billing.claim-data-sourced");
    // Reused by extending appliesTo.
    expect(ids).toContain("policy.phi.no-free-text-pii");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the claim-data-sourced policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.billing.claim-data-sourced"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks a billing answer that doesn't trace to a claim, allows one that does", () => {
    const blocked = evaluateGovernance({
      agentId: "member-service-agent",
      task: { billingTracesToClaim: false, containsFreeTextPii: false }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.billing.claim-data-sourced"
    );

    const allowed = evaluateGovernance({
      agentId: "member-service-agent",
      task: { billingTracesToClaim: true, containsFreeTextPii: false }
    });
    expect(allowed.decision).toBe("allow");

    // Free-text PII trips the reused no-free-text-pii block.
    const withPii = evaluateGovernance({
      agentId: "member-service-agent",
      task: { billingTracesToClaim: true, containsFreeTextPii: true }
    });
    expect(withPii.decision).toBe("block");
    expect(withPii.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.phi.no-free-text-pii"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "member-service-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a claim-lookup→answer→route-to-human trace where the answer is claim-sourced", () => {
    const spans = listTraces({ taskId: "task-seed-member-service-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // Lookup first, human handoff last.
    expect(spans[0].agentId).toBe("member-service-agent");
    expect(spans[0].operation).toBe("billing.claim.lookup");
    const answer = spans.find((s) => s.operation === "billing.answer");
    expect(answer?.agentId).toBe("member-service-agent");
    expect(answer?.attributes?.billingTracesToClaim).toBe(true);
    expect(answer?.attributes?.synthetic).toBe(true);
    const route = spans.find((s) => s.operation === "billing.route-to-human");
    expect(route?.attributes?.routeToHuman).toBe(true);
    // Even the handoff is honestly source-clean (asserts no billing figure).
    expect(route?.attributes?.billingTracesToClaim).toBe(true);
  });
});

describe("Prior Authorization · Clinician-gated, documentation-complete PA agent", () => {
  it("registers as a prototype Agentforce agent on the clinical-decision tier", () => {
    const p = getAgent("prior-authorization-agent");
    expect(p).toBeDefined();
    expect(p!.kind).toBe("agentforce");
    expect(p!.protocol).toBe("a2a");
    expect(p!.provider).toBe("Salesforce");
    expect(p!.status).toBe("prototype");
    // Reuses the Care Router / Care Plan clinical-decision tier (patient-care
    // plane) — PA is a clinical / utilization decision.
    expect(p!.governanceTier).toBe("clinical-decision");
    expect(planeForTier(p!.governanceTier)).toBe("patient-care");
    expect(p!.endpoint).toBe("/api/agents/prior-authorization");
  });

  it("carries the two PA blocks plus the reused no-prescribing / consent / HIPAA-audit policies", () => {
    const ids = getPoliciesForAgent("prior-authorization-agent").map((p) => p.id);
    expect(ids).toContain("policy.pa.no-autonomous-submission");
    expect(ids).toContain("policy.pa.documentation-integrity");
    // Reused by extending appliesTo.
    expect(ids).toContain("policy.clinical.no-prescribing");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy.
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("both PA policies are enforced blocks", () => {
    for (const id of [
      "policy.pa.no-autonomous-submission",
      "policy.pa.documentation-integrity"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement).toBe("block");
      expect(policy!.status).toBe("enforced");
    }
  });

  it("blocks an autonomous submission or an incomplete-documentation submission, allows a clinician-gated, complete PA", () => {
    const autonomous = evaluateGovernance({
      agentId: "prior-authorization-agent",
      task: { paHasClinicianApproval: false, paDocumentationComplete: true }
    });
    expect(autonomous.decision).toBe("block");
    expect(autonomous.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.pa.no-autonomous-submission"
    );

    const incompleteDocs = evaluateGovernance({
      agentId: "prior-authorization-agent",
      task: { paHasClinicianApproval: true, paDocumentationComplete: false }
    });
    expect(incompleteDocs.decision).toBe("block");
    expect(incompleteDocs.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.pa.documentation-integrity"
    );

    const allowed = evaluateGovernance({
      agentId: "prior-authorization-agent",
      task: {
        paHasClinicianApproval: true,
        paDocumentationComplete: true,
        hasAiDecisionSupportConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Grounding is consent-gated too.
    const noConsent = evaluateGovernance({
      agentId: "prior-authorization-agent",
      task: {
        paHasClinicianApproval: true,
        paDocumentationComplete: true,
        hasAiDecisionSupportConsent: false
      }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.data360.consent-required-before-grounding"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "prior-authorization-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a criteria-match→docs-assemble→await-clinician trace, never submitted", () => {
    const spans = listTraces({ taskId: "task-seed-prior-authorization-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // Criteria match first, await-clinician last.
    expect(spans[0].agentId).toBe("prior-authorization-agent");
    expect(spans[0].operation).toBe("priorauth.criteria.match");
    const match = spans.find((s) => s.operation === "priorauth.criteria.match");
    expect(match?.attributes?.criteriaComplete).toBe(true);
    expect(match?.attributes?.synthetic).toBe(true);
    const docs = spans.find((s) => s.operation === "priorauth.docs.assemble");
    expect(docs?.attributes?.paDocumentationComplete).toBe(true);
    const last = spans[spans.length - 1];
    expect(last.operation).toBe("priorauth.await-clinician");
    // The honesty invariants: clinician-gated and never autonomously submitted.
    expect(last.attributes?.requiresClinicianApproval).toBe(true);
    expect(last.attributes?.submitted).toBe(false);
  });
});

describe("Clinical Summary · After-visit summary / clinician-handoff live-Claude agent", () => {
  it("registers as a prototype Agentforce agent on the care-coordination tier", () => {
    const c = getAgent("clinical-summary-agent");
    expect(c).toBeDefined();
    // Modeled as an Agentforce for Health documentation feature (Claude-backed).
    expect(c!.kind).toBe("agentforce");
    expect(c!.protocol).toBe("a2a");
    expect(c!.provider).toBe("Salesforce");
    expect(c!.status).toBe("prototype");
    // Reuses the care-coordination tier (patient-care plane) — the summary /
    // handoff is a documentation & coordination artifact, not a new clinical
    // decision.
    expect(c!.governanceTier).toBe("care-coordination");
    expect(planeForTier(c!.governanceTier)).toBe("patient-care");
    expect(c!.endpoint).toBe("/api/agents/clinical-summary");
  });

  it("carries the source-record block plus the reused clinical/model/consent/audit policies", () => {
    const ids = getPoliciesForAgent("clinical-summary-agent").map((p) => p.id);
    expect(ids).toContain("policy.clinical-summary.source-record-sourced");
    // Reused by extending appliesTo.
    expect(ids).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    expect(ids).toContain("policy.clinical.no-prescribing");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy (it touches PHI).
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("the source-record policy is an enforced block", () => {
    const policy = listPolicies().find(
      (p) => p.id === "policy.clinical-summary.source-record-sourced"
    );
    expect(policy).toBeDefined();
    expect(policy!.enforcement).toBe("block");
    expect(policy!.status).toBe("enforced");
  });

  it("blocks an ungrounded (off-source-record) summary, allows one that traces", () => {
    const blocked = evaluateGovernance({
      agentId: "clinical-summary-agent",
      task: {
        summaryTracesToSourceRecords: false,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasAiDecisionSupportConsent: true
      }
    });
    expect(blocked.decision).toBe("block");
    expect(blocked.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.clinical-summary.source-record-sourced"
    );

    const allowed = evaluateGovernance({
      agentId: "clinical-summary-agent",
      task: {
        summaryTracesToSourceRecords: true,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasAiDecisionSupportConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Model allow-list is enforced just like the Care Router / Care Plan.
    const offModel = evaluateGovernance({
      agentId: "clinical-summary-agent",
      task: { summaryTracesToSourceRecords: true, requestedModel: "gpt-4o" }
    });
    expect(offModel.decision).toBe("block");
    expect(offModel.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.model.anthropic-claude-sonnet-allowlisted"
    );

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "clinical-summary-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds an assemble→summarize trace showing a deterministic scripted-fallback composition", () => {
    const spans = listTraces({ taskId: "task-seed-clinical-summary-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const assemble = spans.find((s) => s.operation === "clinical-summary.assemble");
    expect(assemble?.agentId).toBe("clinical-summary-agent");
    expect(assemble?.attributes?.summaryTracesToSourceRecords).toBe(true);
    // It composes clinical context, so every span asserts PHI was accessed.
    for (const s of spans) {
      expect(s.attributes?.phiAccessed, s.operation).toBe(true);
    }
    const summarize = spans.find((s) => s.operation === "clinical-summary.summarize");
    expect(summarize?.agentId).toBe("clinical-summary-agent");
    // Seeded example is deterministic: scripted-fallback with a fallbackReason,
    // so it doesn't imply a live Claude call happened at seed time.
    expect(summarize?.attributes?.via).toBe("scripted-fallback");
    expect(typeof summarize?.attributes?.fallbackReason).toBe("string");
  });
});

describe("SDOH Screening · whole-person-care social-needs + community-referral agent", () => {
  it("registers as a prototype Agentforce agent on the new whole-person-care tier", () => {
    const s = getAgent("sdoh-screening-agent");
    expect(s).toBeDefined();
    expect(s!.kind).toBe("agentforce");
    expect(s!.protocol).toBe("a2a");
    expect(s!.provider).toBe("Salesforce");
    expect(s!.status).toBe("prototype");
    // A NEW whole-person-care tier on the patient-care plane — screening +
    // referral for social needs is distinct work from the clinical-decision
    // and care-coordination agents.
    expect(s!.governanceTier).toBe("whole-person-care");
    expect(planeForTier(s!.governanceTier)).toBe("patient-care");
    expect(GOVERNANCE_TIERS["whole-person-care"].label.length).toBeGreaterThan(0);
    expect(s!.endpoint).toBe("/api/agents/sdoh-screening");
  });

  it("carries the two SDOH blocks plus the reused HIPAA-audit policy (patient-plane)", () => {
    const ids = getPoliciesForAgent("sdoh-screening-agent").map((p) => p.id);
    expect(ids).toContain("policy.sdoh.validated-screener-only");
    expect(ids).toContain("policy.sdoh.consent-before-referral");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy (it touches PHI).
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("both SDOH policies are enforced blocks", () => {
    for (const id of [
      "policy.sdoh.validated-screener-only",
      "policy.sdoh.consent-before-referral"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement, id).toBe("block");
      expect(policy!.status, id).toBe("enforced");
    }
  });

  it("blocks an off-allow-list screener and a referral without consent; allows a validated, consented one", () => {
    const offList = evaluateGovernance({
      agentId: "sdoh-screening-agent",
      task: { usesValidatedSdohScreener: false, sdohReferralHasConsent: true }
    });
    expect(offList.decision).toBe("block");
    expect(offList.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.sdoh.validated-screener-only"
    );

    const noConsent = evaluateGovernance({
      agentId: "sdoh-screening-agent",
      task: { usesValidatedSdohScreener: true, sdohReferralHasConsent: false }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.sdoh.consent-before-referral"
    );

    const allowed = evaluateGovernance({
      agentId: "sdoh-screening-agent",
      task: { usesValidatedSdohScreener: true, sdohReferralHasConsent: true }
    });
    expect(allowed.decision).toBe("allow");

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "sdoh-screening-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a screen→refer trace and a safety-escalation variant, every span phiAccessed", () => {
    const spans = listTraces({ taskId: "task-seed-sdoh-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const screen = spans.find((s) => s.operation === "sdoh.screen");
    expect(screen?.agentId).toBe("sdoh-screening-agent");
    expect(screen?.attributes?.usesValidatedSdohScreener).toBe(true);
    const refer = spans.find((s) => s.operation === "sdoh.refer");
    expect(refer?.attributes?.autonomousEnrollment).toBe(false);
    expect(refer?.attributes?.sent).toBe(false);
    for (const s of spans) {
      expect(s.attributes?.phiAccessed, s.operation).toBe(true);
    }

    const safety = listTraces({ taskId: "task-seed-sdoh-safety-001" });
    const escalate = safety.find((s) => s.operation === "sdoh.safety.escalate");
    expect(escalate?.agentId).toBe("sdoh-screening-agent");
    expect(escalate?.attributes?.handoffTo).toBe("social-worker");
    expect(escalate?.attributes?.requiresHumanEscalation).toBe(true);
  });
});

describe("Patient Education & Health Coaching · evidence-sourced education + live-Claude coaching agent", () => {
  it("registers as a prototype live-Claude agent on the patient-engagement tier", () => {
    const e = getAgent("patient-education-agent");
    expect(e).toBeDefined();
    // The FOURTH live-Claude agent (kind anthropic-claude, like the Care Router
    // / Care Plan / Clinical Summary reference agents).
    expect(e!.kind).toBe("anthropic-claude");
    expect(e!.protocol).toBe("a2a");
    expect(e!.provider).toBe("Anthropic + Pause-Health.ai");
    expect(e!.status).toBe("prototype");
    // Reuses the patient-engagement tier (patient-care plane) — patient-facing
    // education + coaching, not a clinical decision.
    expect(e!.governanceTier).toBe("patient-engagement");
    expect(planeForTier(e!.governanceTier)).toBe("patient-care");
    expect(e!.endpoint).toBe("/api/agents/patient-education");
  });

  it("carries the three education blocks plus the reused model + HIPAA-audit policies (patient-plane)", () => {
    const ids = getPoliciesForAgent("patient-education-agent").map((p) => p.id);
    expect(ids).toContain("policy.education.evidence-sourced");
    expect(ids).toContain("policy.education.no-medical-advice");
    expect(ids).toContain("policy.education.consent-before-outreach");
    // Reused by extending appliesTo — honors the model allow-list on the live
    // Claude call, and is on the HIPAA-audit policy (it is patient-touching).
    expect(ids).toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT on any commercial-plane-only policy (it touches PHI).
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("all three education policies are enforced blocks", () => {
    for (const id of [
      "policy.education.evidence-sourced",
      "policy.education.no-medical-advice",
      "policy.education.consent-before-outreach"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement, id).toBe("block");
      expect(policy!.status, id).toBe("enforced");
    }
  });

  it("blocks a fabricated topic, out-of-scope advice, and a no-consent push; allows a well-formed task", () => {
    // Off-catalog / fabricated education topic.
    const offCatalog = evaluateGovernance({
      agentId: "patient-education-agent",
      task: {
        educationTracesToEvidenceSource: false,
        staysWithinEducationScope: true,
        coachingOutreachHasConsent: true,
        requestedModel: "claude-sonnet-4-5-20250929"
      }
    });
    expect(offCatalog.decision).toBe("block");
    expect(offCatalog.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.education.evidence-sourced"
    );

    // Strays into diagnosis / dosing / individualized medical advice.
    const outOfScope = evaluateGovernance({
      agentId: "patient-education-agent",
      task: {
        educationTracesToEvidenceSource: true,
        staysWithinEducationScope: false,
        coachingOutreachHasConsent: true
      }
    });
    expect(outOfScope.decision).toBe("block");
    expect(outOfScope.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.education.no-medical-advice"
    );

    // Coaching push without consent.
    const noConsent = evaluateGovernance({
      agentId: "patient-education-agent",
      task: {
        educationTracesToEvidenceSource: true,
        staysWithinEducationScope: true,
        coachingOutreachHasConsent: false
      }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.education.consent-before-outreach"
    );

    // Model allow-list is enforced just like the Care Router / Care Plan.
    const offModel = evaluateGovernance({
      agentId: "patient-education-agent",
      task: {
        educationTracesToEvidenceSource: true,
        staysWithinEducationScope: true,
        coachingOutreachHasConsent: true,
        requestedModel: "gpt-4o"
      }
    });
    expect(offModel.decision).toBe("block");
    expect(offModel.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.model.anthropic-claude-sonnet-allowlisted"
    );

    const allowed = evaluateGovernance({
      agentId: "patient-education-agent",
      task: {
        educationTracesToEvidenceSource: true,
        staysWithinEducationScope: true,
        coachingOutreachHasConsent: true,
        requestedModel: "claude-sonnet-4-5-20250929"
      }
    });
    expect(allowed.decision).toBe("allow");

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "patient-education-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a curate→coach trace showing a deterministic scripted-fallback coaching, every span phiAccessed", () => {
    const spans = listTraces({ taskId: "task-seed-patient-education-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const curate = spans.find((s) => s.operation === "patient-education.curate");
    expect(curate?.agentId).toBe("patient-education-agent");
    expect(curate?.attributes?.educationTracesToEvidenceSource).toBe(true);
    expect(curate?.attributes?.staysWithinEducationScope).toBe(true);
    const coach = spans.find((s) => s.operation === "patient-education.coach");
    expect(coach?.agentId).toBe("patient-education-agent");
    // Seeded example is deterministic: scripted-fallback with a fallbackReason,
    // so it doesn't imply a live Claude call happened at seed time.
    expect(coach?.attributes?.via).toBe("scripted-fallback");
    expect(typeof coach?.attributes?.fallbackReason).toBe("string");
    expect(coach?.attributes?.coachingOutreachHasConsent).toBe(true);
    expect(coach?.attributes?.sent).toBe(false);
    // The coaching content touches the patient's clinical context.
    for (const s of spans) {
      if (s.agentId === "patient-education-agent") {
        expect(s.attributes?.phiAccessed, s.operation).toBe(true);
      }
    }
  });
});

describe("Remote Patient Monitoring · longitudinal symptom-trend tracking + clinician-routed escalation agent", () => {
  it("registers as a prototype Agentforce agent on the care-coordination tier", () => {
    const r = getAgent("remote-monitoring-agent");
    expect(r).toBeDefined();
    expect(r!.kind).toBe("agentforce");
    expect(r!.protocol).toBe("a2a");
    expect(r!.provider).toBe("Salesforce");
    expect(r!.status).toBe("prototype");
    // Reuses the care-coordination tier (patient-care plane) — monitoring +
    // coordinating a clinician escalation, not a new clinical decision.
    expect(r!.governanceTier).toBe("care-coordination");
    expect(planeForTier(r!.governanceTier)).toBe("patient-care");
    expect(r!.endpoint).toBe("/api/agents/remote-monitoring");
  });

  it("carries the three RPM blocks plus the reused HIPAA-audit policy (patient-plane)", () => {
    const ids = getPoliciesForAgent("remote-monitoring-agent").map((p) => p.id);
    expect(ids).toContain("policy.rpm.reading-source-integrity");
    expect(ids).toContain("policy.rpm.no-autonomous-escalation");
    expect(ids).toContain("policy.rpm.consent-to-monitor");
    // It touches patient monitoring/clinical context, so it IS HIPAA-audited.
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    // It is NOT a live-Claude agent (no model allow-list) and NOT commercial.
    expect(ids).not.toContain("policy.model.anthropic-claude-sonnet-allowlisted");
    expect(ids).not.toContain("policy.commercial.no-phi-in-commercial-plane");
  });

  it("all three RPM policies are enforced blocks", () => {
    for (const id of [
      "policy.rpm.reading-source-integrity",
      "policy.rpm.no-autonomous-escalation",
      "policy.rpm.consent-to-monitor"
    ]) {
      const policy = listPolicies().find((p) => p.id === id);
      expect(policy, id).toBeDefined();
      expect(policy!.enforcement, id).toBe("block");
      expect(policy!.status, id).toBe("enforced");
    }
  });

  it("blocks a fabricated reading, an autonomous escalation, and a no-consent run; allows a well-formed task", () => {
    // A reading that doesn't trace to a source / catalog metric.
    const fabricated = evaluateGovernance({
      agentId: "remote-monitoring-agent",
      task: {
        readingsTraceToSource: false,
        escalationRoutedToHuman: true,
        monitoringHasConsent: true
      }
    });
    expect(fabricated.decision).toBe("block");
    expect(fabricated.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.rpm.reading-source-integrity"
    );

    // An escalation acted on autonomously instead of routed to a clinician.
    const autonomous = evaluateGovernance({
      agentId: "remote-monitoring-agent",
      task: {
        readingsTraceToSource: true,
        escalationRoutedToHuman: false,
        monitoringHasConsent: true
      }
    });
    expect(autonomous.decision).toBe("block");
    expect(autonomous.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.rpm.no-autonomous-escalation"
    );

    // Monitoring without the patient's consent.
    const noConsent = evaluateGovernance({
      agentId: "remote-monitoring-agent",
      task: {
        readingsTraceToSource: true,
        escalationRoutedToHuman: true,
        monitoringHasConsent: false
      }
    });
    expect(noConsent.decision).toBe("block");
    expect(noConsent.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.rpm.consent-to-monitor"
    );

    const allowed = evaluateGovernance({
      agentId: "remote-monitoring-agent",
      task: {
        readingsTraceToSource: true,
        escalationRoutedToHuman: true,
        monitoringHasConsent: true
      }
    });
    expect(allowed.decision).toBe("allow");

    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "remote-monitoring-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds an ingest→detect-trends→route-to-clinician trace, every span phiAccessed", () => {
    const spans = listTraces({ taskId: "task-seed-remote-monitoring-001" });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const ingest = spans.find((s) => s.operation === "rpm.ingest");
    expect(ingest?.agentId).toBe("remote-monitoring-agent");
    expect(ingest?.attributes?.readingsTraceToSource).toBe(true);
    expect(ingest?.attributes?.monitoringHasConsent).toBe(true);
    const detect = spans.find((s) => s.operation === "rpm.detect-trends");
    expect(detect?.attributes?.escalationRoutedToHuman).toBe(true);
    expect(detect?.attributes?.overallStatus).toBe("escalate");
    const route = spans.find((s) => s.operation === "rpm.route-to-clinician");
    expect(route?.attributes?.routedTo).toBe("clinician-review");
    expect(route?.attributes?.autonomousAction).toBe(false);
    // The whole run touches the patient's monitoring/clinical context.
    for (const s of spans) {
      expect(s.attributes?.phiAccessed, s.operation).toBe(true);
    }
  });
});

describe("Commercial plane · Pipeline + Account Management agents", () => {
  it("registers both as prototype Agentforce agents on the commercial-operations tier", () => {
    for (const id of ["pipeline-management-agent", "account-management-agent"]) {
      const a = getAgent(id);
      expect(a, id).toBeDefined();
      expect(a!.kind).toBe("agentforce");
      expect(a!.provider).toBe("Salesforce");
      expect(a!.status).toBe("prototype");
      expect(a!.governanceTier).toBe("commercial-operations");
    }
  });

  it("both carry the hard PHI-separation block", () => {
    for (const id of ["pipeline-management-agent", "account-management-agent"]) {
      const ids = getPoliciesForAgent(id).map((p) => p.id);
      expect(ids, id).toContain("policy.commercial.no-phi-in-commercial-plane");
    }
    const phiSep = listPolicies().find(
      (p) => p.id === "policy.commercial.no-phi-in-commercial-plane"
    );
    expect(phiSep!.enforcement).toBe("block");
    expect(phiSep!.status).toBe("enforced");
  });

  it("keeps commercial agents OFF the HIPAA audit policy (they never touch PHI)", () => {
    // This is an intentional honesty signal, not an omission: the commercial
    // plane is not PHI-scoped, so it is not on the HIPAA-named audit policy.
    for (const id of ["pipeline-management-agent", "account-management-agent"]) {
      const ids = getPoliciesForAgent(id).map((p) => p.id);
      expect(ids, id).not.toContain("policy.audit.hipaa-log-every-turn");
    }
    // ...whereas every clinical/patient-plane agent IS on it.
    expect(getPoliciesForAgent("agentforce-intake").map((p) => p.id)).toContain(
      "policy.audit.hipaa-log-every-turn"
    );
  });

  it("splits the function-specific policies correctly (forecast → pipeline, contract → account)", () => {
    const pipeline = getPoliciesForAgent("pipeline-management-agent").map((p) => p.id);
    const account = getPoliciesForAgent("account-management-agent").map((p) => p.id);
    expect(pipeline).toContain("policy.commercial.forecast-integrity");
    expect(pipeline).not.toContain("policy.commercial.human-owner-before-contract-change");
    expect(account).toContain("policy.commercial.human-owner-before-contract-change");
    expect(account).not.toContain("policy.commercial.forecast-integrity");
  });

  it("seeds a commercial pipeline→close-won→account trace with PHI never accessed", () => {
    const spans = listTraces({ taskId: "task-seed-commercial-001" });
    expect(spans.length).toBeGreaterThanOrEqual(5);
    expect(spans[0].agentId).toBe("pipeline-management-agent");
    expect(spans.map((s) => s.agentId)).toContain("account-management-agent");

    // Every commercial span asserts it did not touch PHI.
    for (const s of spans) {
      expect(s.attributes?.phiAccessed, s.operation).toBe(false);
    }

    // Forecast is CRM-sourced; the renewal draft is not auto-committed.
    const forecast = spans.find((s) => s.operation === "pipeline.forecast.rollup");
    expect(forecast?.attributes?.sourcedFromCrm).toBe(true);
    const renewal = spans.find((s) => s.operation === "account.renewal.draft");
    expect(renewal?.attributes?.committed).toBe(false);
    expect(renewal?.attributes?.humanOwnerApprovalRequired).toBe(true);
  });
});

describe("Referential integrity · registry ⇄ policy catalog", () => {
  it("every policy's appliesTo names a real registered agent", () => {
    const agentIds = new Set(listAgents().map((a) => a.id));
    for (const p of listPolicies()) {
      for (const target of p.appliesTo) {
        expect(
          agentIds.has(target),
          `policy ${p.id} applies to unknown agent "${target}"`
        ).toBe(true);
      }
    }
  });

  it("every policy id carried by an agent exists in the catalog", () => {
    const policyIds = new Set(listPolicies().map((p) => p.id));
    for (const a of listAgents()) {
      for (const pid of a.policies) {
        expect(
          policyIds.has(pid),
          `agent ${a.id} carries unknown policy "${pid}"`
        ).toBe(true);
      }
    }
  });

  it("every registered agent's governance tier maps to a known plane + label", () => {
    // The console groups the registry by plane; an agent whose tier isn't in
    // GOVERNANCE_TIERS would fall into the defensive "Other" bucket and render
    // a raw slug. This keeps the tier metadata exhaustive against the registry.
    for (const a of listAgents()) {
      const plane = planeForTier(a.governanceTier);
      expect(
        plane,
        `agent ${a.id} has tier "${a.governanceTier}" with no plane mapping`
      ).toBeDefined();
      expect(GOVERNANCE_PLANES[plane!]).toBeDefined();
      expect(GOVERNANCE_TIERS[a.governanceTier].label.length).toBeGreaterThan(0);
    }
  });

  it("every seeded trace span names a real registered agent", () => {
    // Guards the illustrative console traces against drift: a seeded span
    // that references a typo'd or removed agent id would render an
    // orphaned row in the console. All four seed functions run at import.
    const agentIds = new Set(listAgents().map((a) => a.id));
    const seededTaskIds = [
      "task-seed-historical-001",
      "task-seed-growth-lifecycle-001",
      "task-seed-inbound-lead-001",
      "task-seed-commercial-001",
      "task-seed-mcp-bridge-001",
      "task-seed-assessment-001",
      "task-seed-benefits-001",
      "task-seed-scheduling-001",
      "task-seed-caregap-001",
      "task-seed-careplan-001",
      "task-seed-medication-adherence-001",
      "task-seed-referral-001",
      "task-seed-member-service-001",
      "task-seed-prior-authorization-001",
      "task-seed-clinical-summary-001",
      "task-seed-patient-education-001",
      "task-seed-remote-monitoring-001"
    ];
    for (const taskId of seededTaskIds) {
      const spans = listTraces({ taskId });
      expect(spans.length, `${taskId} should be seeded`).toBeGreaterThan(0);
      for (const s of spans) {
        expect(
          agentIds.has(s.agentId),
          `seeded trace ${taskId} span ${s.id} names unknown agent "${s.agentId}"`
        ).toBe(true);
      }
    }
  });
});

describe("evaluateGovernance · Care Router pre-flight", () => {
  it("allows a well-formed task with red-flag screen and approved model", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasRationaleField: true
      }
    });
    expect(out.decision).toBe("allow");
    expect(out.blockingViolations).toEqual([]);
    expect(out.appliesPolicies.length).toBeGreaterThan(0);
  });

  it("blocks when the red-flag screen field is explicitly false", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: false,
        requestedModel: "claude-sonnet-4-5-20250929"
      }
    });
    expect(out.decision).toBe("block");
    expect(out.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.intake.red-flag-mandatory"
    );
  });

  it("does NOT block when hasRedFlagScreen is undefined (caller didn't supply the signal)", () => {
    // The evaluator only blocks when the field is explicitly false,
    // not when it's absent. This is documented behavior -- it lets
    // the /api/agent-fabric/governance/evaluate POST work with
    // partial test fixtures.
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: { requestedModel: "claude-sonnet-4-5-20250929" }
    });
    expect(out.decision).toBe("allow");
  });

  it("blocks when an off-allowlist model is requested", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "gpt-4o-2024-08-06"
      }
    });
    expect(out.decision).toBe("block");
    const violation = out.blockingViolations.find(
      (v) => v.policyId === "policy.model.anthropic-claude-sonnet-allowlisted"
    );
    expect(violation).toBeDefined();
    expect(violation!.reason).toMatch(/gpt-4o/);
  });

  it("accepts claude-opus-* models per the allow-list regex", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "claude-opus-4-7-20251119"
      }
    });
    expect(out.decision).toBe("allow");
  });

  it("blocks when the rationale field is explicitly false", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasRationaleField: false
      }
    });
    expect(out.decision).toBe("block");
    expect(out.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.clinical.rationale-required"
    );
  });

  it("does NOT block when hasRationaleField is undefined (mirrors the red-flag rule)", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "claude-sonnet-4-5-20250929"
      }
    });
    expect(out.decision).toBe("allow");
    expect(out.blockingViolations).toEqual([]);
  });

  it("returns all blocking violations together, not just the first", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: false,
        requestedModel: "gpt-4o",
        hasRationaleField: false
      }
    });
    // red-flag + off-allowlist model + missing rationale = 3 blocks.
    expect(out.blockingViolations).toHaveLength(3);
    expect(out.blockingViolations.map((v) => v.policyId).sort()).toEqual(
      [
        "policy.clinical.rationale-required",
        "policy.intake.red-flag-mandatory",
        "policy.model.anthropic-claude-sonnet-allowlisted"
      ].sort()
    );
  });

  it("an unknown agent has no applicable policies and therefore allows", () => {
    const out = evaluateGovernance({
      agentId: "ghost-agent",
      task: { hasRedFlagScreen: false }
    });
    // No policies apply to a ghost agent -> nothing to violate.
    // Documented behavior: governance is opt-in by agent id.
    expect(out.appliesPolicies).toEqual([]);
    expect(out.decision).toBe("allow");
  });
});

describe("Governance enforcement coverage · no advertised-but-unevaluated blocks", () => {
  it("every enforced-block policy in the catalog is actually evaluated", () => {
    const evaluable = new Set(evaluableBlockPolicyIds());
    const enforcedBlocks = listPolicies().filter(
      (p) => p.enforcement === "block" && p.status === "enforced"
    );
    // Sanity: there ARE enforced blocks to check.
    expect(enforcedBlocks.length).toBeGreaterThan(0);
    for (const p of enforcedBlocks) {
      expect(
        evaluable.has(p.id),
        `${p.id} is an enforced block policy but has no pre-flight evaluator check`
      ).toBe(true);
    }
  });

  it("every evaluator check maps to a real enforced-block policy", () => {
    const byId = new Map(listPolicies().map((p) => [p.id, p]));
    for (const id of evaluableBlockPolicyIds()) {
      const p = byId.get(id);
      expect(p, `${id} has an evaluator check but no catalog policy`).toBeDefined();
      expect(p!.enforcement).toBe("block");
      expect(p!.status).toBe("enforced");
    }
  });

  it("the shared signal metadata is well-formed (unique ids, model handled separately)", () => {
    // BOOLEAN_BLOCK_SIGNALS + the model allow-list == the evaluable set. The
    // /demo console form reads the same metadata, so this keeps the UI, the
    // evaluator, and the catalog on one source of truth.
    const seen = new Set<string>();
    for (const s of BOOLEAN_BLOCK_SIGNALS) {
      expect(seen.has(s.policyId), `duplicate signal for ${s.policyId}`).toBe(
        false
      );
      seen.add(s.policyId);
      // The model policy is a string+regex check, not a boolean signal.
      expect(s.policyId).not.toBe(MODEL_ALLOWLIST_POLICY_ID);
    }
    const expected = new Set([
      ...BOOLEAN_BLOCK_SIGNALS.map((s) => s.policyId),
      MODEL_ALLOWLIST_POLICY_ID
    ]);
    expect(new Set(evaluableBlockPolicyIds())).toEqual(expected);
  });
});

describe("evaluateGovernance · lifecycle + commercial pre-flight", () => {
  it("blocks a Care Router action that commits a clinical action without a clinician", () => {
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        hasRationaleField: true,
        commitsClinicalActionWithoutClinician: true
      }
    });
    expect(out.decision).toBe("block");
    expect(out.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.clinical.no-prescribing"
    );
  });

  it("blocks integration/data-substrate violations (MCP tool + non-FHIR payload)", () => {
    const mcp = evaluateGovernance({
      agentId: "pause-mcp",
      task: { usesUnlistedMcpTool: true, payloadIsFhirR5: false }
    });
    expect(mcp.decision).toBe("block");
    const ids = mcp.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.mcp.tools-allowlisted");
    expect(ids).toContain("policy.data.fhir-r5-only");
  });

  it("blocks Data 360 violations (bulk PHI ingest, missing consent, off-allowlist activation)", () => {
    const out = evaluateGovernance({
      agentId: "salesforce-data-360",
      task: {
        bulkIngestsPhi: true,
        hasAiDecisionSupportConsent: false,
        segmentActivationChannelAllowlisted: false
      }
    });
    expect(out.decision).toBe("block");
    const ids = out.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.data360.zero-copy-federation");
    expect(ids).toContain("policy.data360.consent-required-before-grounding");
    expect(ids).toContain("policy.data360.segment-activation-allowlist");
  });

  it("blocks a patient-facing intake payload carrying free-text PII", () => {
    const out = evaluateGovernance({
      agentId: "agentforce-intake",
      task: { containsFreeTextPii: true }
    });
    expect(out.decision).toBe("block");
    expect(out.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.phi.no-free-text-pii"
    );
    // Structured-only payload passes.
    expect(
      evaluateGovernance({
        agentId: "agentforce-intake",
        task: { containsFreeTextPii: false }
      }).decision
    ).toBe("allow");
  });

  it("blocks a prospecting task that would send without approval or without consent", () => {
    const out = evaluateGovernance({
      agentId: "prospecting-agent",
      task: { autonomousSend: true, hasContactConsent: false }
    });
    expect(out.decision).toBe("block");
    const ids = out.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.marketing.human-approval-before-send");
    expect(ids).toContain("policy.marketing.consent-to-contact-required");
  });

  it("allows a prospecting task when the signals are compliant (and when absent)", () => {
    expect(
      evaluateGovernance({
        agentId: "prospecting-agent",
        task: { autonomousSend: false, hasContactConsent: true }
      }).decision
    ).toBe("allow");
    // Absent signals must not trip the gate (opt-in-by-signal convention).
    expect(
      evaluateGovernance({ agentId: "prospecting-agent", task: {} }).decision
    ).toBe("allow");
  });

  it("blocks an inbound lead missing opt-in/source or identity resolution", () => {
    const out = evaluateGovernance({
      agentId: "inbound-lead-agent",
      task: { hasLeadOptInAndSource: false, identityResolved: false }
    });
    expect(out.decision).toBe("block");
    const ids = out.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.lead.explicit-optin-and-source-required");
    expect(ids).toContain("policy.lead.identity-resolution-before-create");
  });

  it("blocks a qualification decision with protected-class criteria or no rationale", () => {
    const out = evaluateGovernance({
      agentId: "qualification-agent",
      task: { usesProtectedClassCriteria: true, hasRationaleField: false }
    });
    expect(out.decision).toBe("block");
    const ids = out.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.qualification.no-protected-class-criteria");
    expect(ids).toContain("policy.qualification.rationale-required");
  });

  it("blocks a commercial agent that touches PHI or fabricates a forecast", () => {
    const pipeline = evaluateGovernance({
      agentId: "pipeline-management-agent",
      task: { accessesPhi: true, forecastSourcedFromCrm: false }
    });
    expect(pipeline.decision).toBe("block");
    const ids = pipeline.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.commercial.no-phi-in-commercial-plane");
    expect(ids).toContain("policy.commercial.forecast-integrity");
  });

  it("blocks an account contract change without a human owner", () => {
    const out = evaluateGovernance({
      agentId: "account-management-agent",
      task: { commitsContractChangeWithoutHumanOwner: true }
    });
    expect(out.decision).toBe("block");
    expect(out.blockingViolations.map((v) => v.policyId)).toContain(
      "policy.commercial.human-owner-before-contract-change"
    );
  });

  it("does not cross-apply another plane's signals (commercial signal ignored for the Care Router)", () => {
    // The Care Router has no commercial policies, so a commercial-violating
    // signal is simply irrelevant to it.
    const out = evaluateGovernance({
      agentId: "care-router-claude",
      task: { accessesPhi: true, hasRedFlagScreen: true, hasRationaleField: true }
    });
    expect(out.decision).toBe("allow");
  });
});

describe("MCP Bridge · A2A ↔ MCP egress surface", () => {
  it("registers the mcp-bridge agent on the platform plane", () => {
    const bridge = getAgent("mcp-bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.kind).toBe("mcp-bridge");
    expect(bridge!.protocol).toBe("mcp");
    expect(bridge!.provider).toBe("Pause-Health.ai");
    expect(bridge!.status).toBe("prototype");
    expect(bridge!.governanceTier).toBe("integration");
    expect(planeForTier(bridge!.governanceTier)).toBe("platform");
  });

  it("carries the three enforced-block egress policies + the HIPAA audit", () => {
    const ids = getPoliciesForAgent("mcp-bridge").map((p) => p.id);
    expect(ids).toContain("policy.mcp-bridge.remote-allowlist");
    expect(ids).toContain("policy.mcp-bridge.tool-allowlist");
    expect(ids).toContain("policy.mcp-bridge.no-cross-origin-bearer");
    // The bridge brokers patient-context tool calls, so it IS audited.
    expect(ids).toContain("policy.audit.hipaa-log-every-turn");
    for (const id of [
      "policy.mcp-bridge.remote-allowlist",
      "policy.mcp-bridge.tool-allowlist",
      "policy.mcp-bridge.no-cross-origin-bearer"
    ]) {
      const p = listPolicies().find((x) => x.id === id)!;
      expect(p.enforcement, id).toBe("block");
      expect(p.status, id).toBe("enforced");
    }
  });

  it("blocks an unlisted remote, an unlisted tool, or a cross-origin bearer", () => {
    const out = evaluateGovernance({
      agentId: "mcp-bridge",
      task: {
        connectsToAllowlistedRemote: false,
        usesUnlistedMcpTool: true,
        forwardsBearerCrossOrigin: true
      }
    });
    expect(out.decision).toBe("block");
    const ids = out.blockingViolations.map((v) => v.policyId);
    expect(ids).toContain("policy.mcp-bridge.remote-allowlist");
    expect(ids).toContain("policy.mcp-bridge.tool-allowlist");
    expect(ids).toContain("policy.mcp-bridge.no-cross-origin-bearer");
  });

  it("allows a compliant bridge call (and when signals are absent)", () => {
    expect(
      evaluateGovernance({
        agentId: "mcp-bridge",
        task: {
          connectsToAllowlistedRemote: true,
          usesUnlistedMcpTool: false,
          forwardsBearerCrossOrigin: false
        }
      }).decision
    ).toBe("allow");
    expect(
      evaluateGovernance({ agentId: "mcp-bridge", task: {} }).decision
    ).toBe("allow");
  });

  it("seeds a trace where the bridge fails over to loopback and the server runs the tool", () => {
    const spans = listTraces({ taskId: "task-seed-mcp-bridge-001" });
    expect(spans.length).toBeGreaterThanOrEqual(5);
    const bridgeSpans = spans.filter((s) => s.agentId === "mcp-bridge");
    expect(bridgeSpans.length).toBe(2);
    // First attempt is the cross-origin external remote and it fails without
    // forwarding the bearer; the loopback attempt then succeeds.
    const external = bridgeSpans.find(
      (s) => s.attributes?.remoteId === "external-partner-directory"
    );
    const loopback = bridgeSpans.find(
      (s) => s.attributes?.remoteId === "loopback"
    );
    expect(external?.status).toBe("error");
    expect(external?.attributes?.bearerForwarded).toBe(false);
    expect(loopback?.status).toBe("ok");
    expect(loopback?.attributes?.bearerForwarded).toBe(true);
    // The tool ultimately executes on the Pause MCP Server, parented to the
    // successful loopback bridge span.
    const serverSpan = spans.find(
      (s) => s.agentId === "pause-mcp" && s.operation === "mcp.find_menopause_providers"
    );
    expect(serverSpan).toBeDefined();
    expect(serverSpan!.parentSpanId).toBe(loopback!.id);
  });
});

describe("Trace recording · recordSpan + recordInstantSpan", () => {
  it("recordSpan assigns an id and returns the persisted span", () => {
    const taskId = uniqueTaskId("rs");
    const span = recordSpan({
      taskId,
      agentId: "care-router-claude",
      agentName: "Care Router",
      operation: "test.op",
      protocol: "a2a",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      status: "ok"
    });
    expect(span.id).toMatch(/^span-/);

    const traces = listTraces({ taskId });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject<Partial<TraceSpan>>({
      id: span.id,
      taskId,
      operation: "test.op"
    });
  });

  it("recordInstantSpan resolves the agent name from the registry", () => {
    const taskId = uniqueTaskId("ris");
    const span = recordInstantSpan({
      taskId,
      agentId: "care-router-claude",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      attributes: { pathway: "self-care-tracking" }
    });
    expect(span.agentName).toBe("Pause Care Router · Claude Sonnet 4.5");
    expect(span.attributes?.pathway).toBe("self-care-tracking");
    expect(span.durationMs).toBe(0);
  });

  it("recordInstantSpan falls back to agentId when the agent is unknown", () => {
    const taskId = uniqueTaskId("unk");
    const span = recordInstantSpan({
      taskId,
      agentId: "ghost-agent",
      operation: "test.op",
      protocol: "internal"
    });
    expect(span.agentName).toBe("ghost-agent");
  });

  it("recordInstantSpan defaults status to 'ok' but respects an explicit override", () => {
    const taskId = uniqueTaskId("status");
    const ok = recordInstantSpan({
      taskId,
      agentId: "care-router-claude",
      operation: "test.ok",
      protocol: "a2a"
    });
    const err = recordInstantSpan({
      taskId,
      agentId: "care-router-claude",
      operation: "test.err",
      protocol: "a2a",
      status: "error"
    });
    expect(ok.status).toBe("ok");
    expect(err.status).toBe("error");
  });

  it("listTraces filters by taskId and orders by startedAt", () => {
    const taskId = uniqueTaskId("order");
    const t0 = Date.now();
    // Insert out of chronological order on purpose; listTraces must
    // sort by startedAt ascending so trace inspectors render the
    // span timeline left-to-right correctly.
    recordSpan({
      taskId,
      agentId: "care-router-claude",
      agentName: "x",
      operation: "later",
      protocol: "a2a",
      startedAt: new Date(t0 + 5000).toISOString(),
      finishedAt: new Date(t0 + 5100).toISOString(),
      durationMs: 100,
      status: "ok"
    });
    recordSpan({
      taskId,
      agentId: "care-router-claude",
      agentName: "x",
      operation: "earlier",
      protocol: "a2a",
      startedAt: new Date(t0 + 1000).toISOString(),
      finishedAt: new Date(t0 + 1100).toISOString(),
      durationMs: 100,
      status: "ok"
    });

    const traces = listTraces({ taskId });
    expect(traces.map((t) => t.operation)).toEqual(["earlier", "later"]);
  });

  it("listTraces respects the limit option (slices the tail)", () => {
    const taskId = uniqueTaskId("limit");
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      recordSpan({
        taskId,
        agentId: "care-router-claude",
        agentName: "x",
        operation: `op-${i}`,
        protocol: "a2a",
        startedAt: new Date(t0 + i * 100).toISOString(),
        finishedAt: new Date(t0 + i * 100 + 50).toISOString(),
        durationMs: 50,
        status: "ok"
      });
    }
    const tail = listTraces({ taskId, limit: 2 });
    expect(tail.map((t) => t.operation)).toEqual(["op-3", "op-4"]);
  });
});

describe("listRecentTaskIds", () => {
  it("returns the most recently seen task ids (de-duplicated, capped)", () => {
    const taskA = uniqueTaskId("recent-a");
    const taskB = uniqueTaskId("recent-b");
    const t0 = Date.now();
    // Two spans for taskA, then one for taskB. taskB is most recent.
    recordSpan({
      taskId: taskA,
      agentId: "care-router-claude",
      agentName: "x",
      operation: "a1",
      protocol: "a2a",
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date(t0).toISOString(),
      durationMs: 0,
      status: "ok"
    });
    recordSpan({
      taskId: taskA,
      agentId: "care-router-claude",
      agentName: "x",
      operation: "a2",
      protocol: "a2a",
      startedAt: new Date(t0 + 100).toISOString(),
      finishedAt: new Date(t0 + 100).toISOString(),
      durationMs: 0,
      status: "ok"
    });
    recordSpan({
      taskId: taskB,
      agentId: "care-router-claude",
      agentName: "x",
      operation: "b1",
      protocol: "a2a",
      startedAt: new Date(t0 + 200).toISOString(),
      finishedAt: new Date(t0 + 200).toISOString(),
      durationMs: 0,
      status: "ok"
    });

    const ids = listRecentTaskIds(20);
    // Both unique-per-test ids should appear; taskB (most recently
    // recorded) should precede taskA.
    const idxA = ids.indexOf(taskA);
    const idxB = ids.indexOf(taskB);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeLessThan(idxA);
    // Same task id appears at most once.
    expect(ids.filter((x) => x === taskA)).toHaveLength(1);
  });
});
