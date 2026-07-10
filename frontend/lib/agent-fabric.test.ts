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

  it("every seeded trace span names a real registered agent", () => {
    // Guards the illustrative console traces against drift: a seeded span
    // that references a typo'd or removed agent id would render an
    // orphaned row in the console. All four seed functions run at import.
    const agentIds = new Set(listAgents().map((a) => a.id));
    const seededTaskIds = [
      "task-seed-historical-001",
      "task-seed-growth-lifecycle-001",
      "task-seed-inbound-lead-001",
      "task-seed-commercial-001"
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
