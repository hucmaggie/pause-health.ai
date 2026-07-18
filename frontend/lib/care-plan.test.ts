import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARE_PLAN_TEMPLATES,
  carePlanContextFromIntake,
  getCarePlanTemplate,
  instantiateCarePlan,
  isCatalogTemplate,
  planTracesToTemplate,
  scriptedSummarizeCarePlan,
  summarizeCarePlan,
  type CarePlanContext,
  type InstantiatedCarePlan
} from "./care-plan";
import type { IntakeRecord } from "./care-router";

// Controllable mock for the dynamically-imported Anthropic SDK, mirroring
// lib/care-router.test.ts. `create` is what summarizeCarePlan() invokes; each
// live-path test sets its resolved value (a text content block) or makes it
// reject to prove the scripted fallback.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

function claudeTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

/**
 * Tests for lib/care-plan.ts.
 *
 * Two halves mirror the Care Router's shape:
 *   1. instantiateCarePlan() — DETERMINISTIC template selection + fill, and the
 *      template-integrity property (every plan references a defined template).
 *   2. summarizeCarePlan() — the live-Claude half. A mocked SDK success yields
 *      via: claude-api; a mocked SDK error and the missing-key path both yield
 *      via: scripted-fallback WITH a fallbackReason.
 */

const baseIntake: IntakeRecord = {
  preferredName: "Test Patient",
  ageBand: "45-49",
  cycleStatus: "perimenopausal",
  primarySymptom: "vasomotor",
  severity: "moderate",
  redFlagsAcknowledged: "no"
};

describe("instantiateCarePlan · deterministic template selection", () => {
  it("selects the vasomotor/lifestyle plan as the default track", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor",
      ageBand: "45-49",
      cycleStatus: "perimenopausal"
    });
    expect(plan.templateId).toBe("careplan.vasomotor-lifestyle");
  });

  it("selects the mood/behavioral plan for a behavioral-health pathway", () => {
    const plan = instantiateCarePlan({
      pathway: "behavioral-health-handoff",
      severity: "severe",
      primarySymptom: "vasomotor"
    });
    expect(plan.templateId).toBe("careplan.mood-behavioral");
  });

  it("selects the mood/behavioral plan for a mood-dominant presentation", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "mood"
    });
    expect(plan.templateId).toBe("careplan.mood-behavioral");
  });

  it("selects the HRT-management plan when the patient is on hormone therapy", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor",
      onHrt: true
    });
    expect(plan.templateId).toBe("careplan.hrt-management");
  });

  it("selects the bone-health plan for a postmenopausal patient", () => {
    const plan = instantiateCarePlan({
      pathway: "self-care-tracking",
      severity: "mild",
      primarySymptom: "vasomotor",
      cycleStatus: "stopped>=12mo"
    });
    expect(plan.templateId).toBe("careplan.bone-health");
  });

  it("is deterministic: identical context yields an identical plan", () => {
    const ctx: CarePlanContext = {
      pathway: "mscp-in-person",
      severity: "severe",
      primarySymptom: "vasomotor",
      preferredName: "Ada",
      ageBand: "45-49"
    };
    expect(instantiateCarePlan(ctx)).toEqual(instantiateCarePlan(ctx));
  });

  it("tightens the follow-up cadence for a severe presentation", () => {
    const moderate = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor"
    });
    const severe = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "severe",
      primarySymptom: "vasomotor"
    });
    expect(severe.followUp.intervalDays).toBeLessThan(moderate.followUp.intervalDays);
  });

  it("fills structured goals + interventions from the chosen template", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor"
    });
    const template = getCarePlanTemplate(plan.templateId)!;
    expect(plan.goals).toEqual(template.goals);
    expect(plan.interventions).toEqual(template.interventions);
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  it("falls back to a neutral display name when preferredName is absent", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      primarySymptom: "vasomotor"
    });
    expect(plan.patientDisplayName).toBe("the patient");
  });

  it("builds a context from an intake + routing decision", () => {
    const ctx = carePlanContextFromIntake(baseIntake, { pathway: "mscp-virtual-visit" });
    expect(ctx.pathway).toBe("mscp-virtual-visit");
    expect(ctx.severity).toBe("moderate");
    expect(ctx.primarySymptom).toBe("vasomotor");
    expect(ctx.preferredName).toBe("Test Patient");
  });
});

describe("template integrity · planTracesToTemplate", () => {
  it("every instantiated plan references a defined catalog template", () => {
    for (const template of CARE_PLAN_TEMPLATES) {
      expect(isCatalogTemplate(template.id)).toBe(true);
    }
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      primarySymptom: "vasomotor"
    });
    expect(planTracesToTemplate(plan)).toBe(true);
    expect(isCatalogTemplate(plan.templateId)).toBe(true);
  });

  it("flags a caller-asserted off-catalog (fabricated) plan", () => {
    const fabricated = {
      templateId: "careplan.totally-invented"
    } as Pick<InstantiatedCarePlan, "templateId">;
    expect(planTracesToTemplate(fabricated)).toBe(false);
    expect(isCatalogTemplate("careplan.totally-invented")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(planTracesToTemplate(null)).toBe(false);
    expect(planTracesToTemplate(undefined)).toBe(false);
  });
});

describe("scriptedSummarizeCarePlan · deterministic, non-prescriptive", () => {
  it("summarizes the plan without adding a prescription", () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor",
      preferredName: "Ada"
    });
    const summary = scriptedSummarizeCarePlan(plan);
    expect(summary).toMatch(/Ada/);
    expect(summary).toMatch(/does not add or change any prescription/i);
    expect(summary).toMatch(/Next follow-up/i);
  });
});

describe("summarizeCarePlan · fallback path (no key)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("falls back to the scripted summary with a fallbackReason when the key is unset", async () => {
    const plan = instantiateCarePlan({
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      primarySymptom: "vasomotor"
    });
    const out = await summarizeCarePlan(plan);
    expect(out.via).toBe("scripted-fallback");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The reason is only the leading diagnostic, not clinical plan text.
    expect(out.fallbackReason).not.toMatch(/follow-up/i);
    expect(out.summary).toBe(scriptedSummarizeCarePlan(plan));
  });
});

describe("summarizeCarePlan · live path (mocked SDK)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  const plan = instantiateCarePlan({
    pathway: "mscp-virtual-visit",
    severity: "moderate",
    primarySymptom: "vasomotor",
    preferredName: "Ada"
  });

  it("returns a claude-api summary on a mocked SDK success", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse("Ada is progressing well on her vasomotor lifestyle plan.")
    );
    const out = await summarizeCarePlan(plan);
    expect(out.via).toBe("claude-api");
    expect(out.modelProvenance.provider).toBe("anthropic");
    expect(out.summary).toMatch(/Ada is progressing well/);
    expect(out.fallbackReason).toBeUndefined();
  });

  it("falls back with a populated fallbackReason when the SDK throws", async () => {
    createMock.mockRejectedValue(new Error("HTTP 529 overloaded"));
    const out = await summarizeCarePlan(plan);
    expect(out.via).toBe("scripted-fallback");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
    expect(out.fallbackReason).toMatch(/HTTP 529 overloaded/);
    // The deterministic summary is preserved.
    expect(out.summary).toBe(scriptedSummarizeCarePlan(plan));
  });

  it("falls back when the SDK returns no text content", async () => {
    createMock.mockResolvedValue({ content: [] });
    const out = await summarizeCarePlan(plan);
    expect(out.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
  });
});
