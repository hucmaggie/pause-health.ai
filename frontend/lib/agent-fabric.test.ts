import { describe, expect, it } from "vitest";
import {
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
