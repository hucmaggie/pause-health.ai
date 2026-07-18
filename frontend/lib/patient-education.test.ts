import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDUCATION_MODULES,
  buildEducationCurriculum,
  coachEducation,
  coachingStaysWithinEducationScope,
  curriculumTracesToEvidenceSource,
  educationContextFromIntake,
  getEducationModule,
  isCatalogModule,
  scriptedCoachEducation,
  type EducationContext,
  type EducationCurriculum
} from "./patient-education";
import type { IntakeRecord } from "./care-router";

// Controllable mock for the dynamically-imported Anthropic SDK, mirroring
// lib/care-plan.test.ts. `create` is what coachEducation() invokes; each
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
 * Tests for lib/patient-education.ts.
 *
 * Two halves mirror the Care Plan agent's shape:
 *   1. buildEducationCurriculum() — DETERMINISTIC module selection, and the
 *      evidence-source integrity property (every module traces to a defined
 *      catalog module with a source).
 *   2. coachEducation() — the live-Claude half. A mocked SDK success yields
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

describe("buildEducationCurriculum · deterministic module selection", () => {
  it("selects vasomotor + sleep for a vasomotor-dominant presentation", () => {
    const c = buildEducationCurriculum({ primarySymptom: "vasomotor" });
    expect(c.moduleIds).toContain("education.vasomotor");
    expect(c.moduleIds).toContain("education.sleep-hygiene");
  });

  it("selects mood education for a mood-dominant presentation", () => {
    const c = buildEducationCurriculum({ primarySymptom: "mood" });
    expect(c.moduleIds).toContain("education.mood-stress");
  });

  it("adds bone + cardiovascular education for a postmenopausal patient", () => {
    const c = buildEducationCurriculum({ cycleStatus: "stopped>=12mo" });
    expect(c.moduleIds).toContain("education.bone-health");
    expect(c.moduleIds).toContain("education.cardiovascular");
  });

  it("steers a bone-density care gap to bone-health education", () => {
    const c = buildEducationCurriculum({ careGapMeasures: ["DEXA bone-density"] });
    expect(c.moduleIds).toContain("education.bone-health");
  });

  it("always includes the foundational nutrition + activity modules", () => {
    const c = buildEducationCurriculum({});
    expect(c.moduleIds).toContain("education.nutrition");
    expect(c.moduleIds).toContain("education.physical-activity");
    expect(c.moduleIds.length).toBeGreaterThan(0);
  });

  it("is deterministic: identical context yields an identical curriculum", () => {
    const ctx: EducationContext = {
      primarySymptom: "vasomotor",
      severity: "moderate",
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      preferredName: "Ada"
    };
    expect(buildEducationCurriculum(ctx)).toEqual(buildEducationCurriculum(ctx));
  });

  it("orders modules by the catalog and de-duplicates overlapping selections", () => {
    const c = buildEducationCurriculum({
      cycleStatus: "stopped>=12mo",
      carePlanFocusAreas: ["bone health", "cardiovascular risk"],
      careGapMeasures: ["bone-density DEXA"]
    });
    // No duplicate ids even though bone health was selected via three paths.
    expect(new Set(c.moduleIds).size).toBe(c.moduleIds.length);
    // Catalog order is preserved.
    const catalogOrder = EDUCATION_MODULES.map((m) => m.id);
    const filtered = catalogOrder.filter((id) => c.moduleIds.includes(id));
    expect(c.moduleIds).toEqual(filtered);
    expect(c.rationale.length).toBeGreaterThan(0);
  });

  it("falls back to a neutral display name when preferredName is absent", () => {
    const c = buildEducationCurriculum({ primarySymptom: "vasomotor" });
    expect(c.patientDisplayName).toBe("the patient");
  });

  it("builds a context from an intake + upstream signals", () => {
    const ctx = educationContextFromIntake(baseIntake, {
      onHrt: true,
      careGapMeasures: ["lipid panel"]
    });
    expect(ctx.primarySymptom).toBe("vasomotor");
    expect(ctx.severity).toBe("moderate");
    expect(ctx.preferredName).toBe("Test Patient");
    expect(ctx.onHrt).toBe(true);
    expect(ctx.careGapMeasures).toEqual(["lipid panel"]);
  });
});

describe("evidence-source integrity · curriculumTracesToEvidenceSource", () => {
  it("every module in the catalog is defined and carries a source", () => {
    for (const m of EDUCATION_MODULES) {
      expect(isCatalogModule(m.id)).toBe(true);
      expect(getEducationModule(m.id)!.source.length).toBeGreaterThan(0);
    }
    const c = buildEducationCurriculum({ primarySymptom: "vasomotor" });
    expect(curriculumTracesToEvidenceSource(c)).toBe(true);
  });

  it("flags a caller-asserted off-catalog (fabricated) module", () => {
    const fabricated = {
      modules: [{ id: "education.totally-invented", source: "made up" }]
    };
    expect(curriculumTracesToEvidenceSource(fabricated)).toBe(false);
    expect(isCatalogModule("education.totally-invented")).toBe(false);
  });

  it("flags a module that is on-catalog but missing an evidence source", () => {
    const noSource = { modules: [{ id: "education.bone-health", source: "" }] };
    expect(curriculumTracesToEvidenceSource(noSource)).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(curriculumTracesToEvidenceSource(null)).toBe(false);
    expect(curriculumTracesToEvidenceSource(undefined)).toBe(false);
    expect(curriculumTracesToEvidenceSource({ modules: [] })).toBe(false);
  });
});

describe("education scope guard · coachingStaysWithinEducationScope", () => {
  it("stays within scope by default and for a well-formed education task", () => {
    expect(coachingStaysWithinEducationScope(null)).toBe(true);
    expect(coachingStaysWithinEducationScope({})).toBe(true);
    expect(coachingStaysWithinEducationScope({ assertsMedicalAdvice: false })).toBe(true);
  });

  it("is out of scope when the caller asserts diagnosis / dosing / medical advice", () => {
    expect(coachingStaysWithinEducationScope({ assertsMedicalAdvice: true })).toBe(false);
  });
});

describe("scriptedCoachEducation · deterministic, general education only", () => {
  it("writes a general coaching message with the module sources and no medical advice", () => {
    const c = buildEducationCurriculum({
      primarySymptom: "vasomotor",
      preferredName: "Ada"
    });
    const message = scriptedCoachEducation(c);
    expect(message).toMatch(/Ada/);
    expect(message).toMatch(/does not diagnose/i);
    expect(message).toMatch(/illustrative|Menopause Society|USPSTF|NAMS/i);
  });
});

describe("coachEducation · fallback path (no key)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("falls back to the scripted coaching with a fallbackReason when the key is unset", async () => {
    const c = buildEducationCurriculum({ primarySymptom: "vasomotor" });
    const out = await coachEducation(c);
    expect(out.via).toBe("scripted-fallback");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The reason is only the leading diagnostic, not patient education text.
    expect(out.fallbackReason).not.toMatch(/Menopause Society/i);
    expect(out.coachingMessage).toBe(scriptedCoachEducation(c));
    expect(out.moduleIds).toEqual(c.moduleIds);
  });
});

describe("coachEducation · live path (mocked SDK)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
  const curriculum: EducationCurriculum = buildEducationCurriculum({
    primarySymptom: "vasomotor",
    preferredName: "Ada"
  });

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("returns a claude-api coaching message on a mocked SDK success", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse("Ada, small steady habits around sleep and movement can help.")
    );
    const out = await coachEducation(curriculum);
    expect(out.via).toBe("claude-api");
    expect(out.modelProvenance.provider).toBe("anthropic");
    expect(out.coachingMessage).toMatch(/Ada, small steady habits/);
    expect(out.fallbackReason).toBeUndefined();
    // Grounding module ids always come from the curriculum, never the model.
    expect(out.moduleIds).toEqual(curriculum.moduleIds);
  });

  it("falls back with a populated fallbackReason when the SDK throws", async () => {
    createMock.mockRejectedValue(new Error("HTTP 529 overloaded"));
    const out = await coachEducation(curriculum);
    expect(out.via).toBe("scripted-fallback");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
    expect(out.fallbackReason).toMatch(/HTTP 529 overloaded/);
    expect(out.coachingMessage).toBe(scriptedCoachEducation(curriculum));
  });

  it("falls back when the SDK returns no text content", async () => {
    createMock.mockResolvedValue({ content: [] });
    const out = await coachEducation(curriculum);
    expect(out.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
  });
});
