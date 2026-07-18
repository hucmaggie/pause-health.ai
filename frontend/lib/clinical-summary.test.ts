import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleClinicalSummaryContext,
  scriptedSummarizeClinical,
  summarizeClinical,
  summaryTracesToSourceRecords,
  type ClinicalSummaryContext,
  type ClinicalSummaryResult
} from "./clinical-summary";
import {
  carePlanContextFromIntake,
  instantiateCarePlan
} from "./care-plan";
import type { CareGap } from "./care-gaps";
import type { AssessmentResult } from "./assessments";

// Controllable mock for the dynamically-imported Anthropic SDK, mirroring
// lib/care-plan.test.ts. `create` is what summarizeClinical() invokes; each
// live-path test sets its resolved value (a JSON text block) or makes it reject
// to prove the scripted fallback.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

function claudeJsonResponse(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

/**
 * Tests for lib/clinical-summary.ts.
 *
 * Two halves mirror the Care Plan agent's shape:
 *   1. assembleClinicalSummaryContext() — DETERMINISTIC composition that
 *      gathers ONLY facts present in the inputs + a source-record provenance
 *      list, and the grounding property (summaryTracesToSourceRecords).
 *   2. summarizeClinical() — the live-Claude half. A mocked SDK success yields
 *      via: claude-api; a mocked SDK error, a parse failure, and the missing-key
 *      path all yield via: scripted-fallback WITH a fallbackReason.
 */

const carePlan = instantiateCarePlan(
  carePlanContextFromIntake(
    {
      preferredName: "Ada",
      ageBand: "45-49",
      cycleStatus: "perimenopausal",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    { pathway: "mscp-virtual-visit" }
  )
);

const assessment: AssessmentResult = {
  instrument: "mrs",
  instrumentName: "Menopause Rating Scale",
  total: 21,
  maxTotal: 44,
  subscores: [],
  severityBand: "severe",
  normalizedSeverity: "severe",
  redFlags: [],
  interpretation: "Illustrative synthetic score."
};

const careGaps: CareGap[] = [
  {
    measureId: "caregap.bone-density",
    measureLabel: "Bone-density (DEXA) screening",
    status: "overdue",
    lastDone: null,
    priority: "elevated",
    rationale: "No prior DEXA on record."
  }
];

describe("assembleClinicalSummaryContext · deterministic composition", () => {
  it("gathers only the facts present in the inputs", () => {
    const context = assembleClinicalSummaryContext({
      intake: { preferredName: "Ada", severity: "moderate", primarySymptom: "vasomotor" },
      pathway: "mscp-virtual-visit"
    });
    expect(context.patientDisplayName).toBe("Ada");
    expect(context.severity).toBe("moderate");
    expect(context.primarySymptom).toBe("vasomotor");
    expect(context.pathway).toBe("mscp-virtual-visit");
    // Absent inputs are not fabricated.
    expect(context.carePlan).toBeUndefined();
    expect(context.assessment).toBeUndefined();
    expect(context.careGaps).toEqual([]);
    expect(context.synthetic).toBe(true);
  });

  it("records one source record per present upstream lifecycle output", () => {
    const context = assembleClinicalSummaryContext({
      intake: { preferredName: "Ada", severity: "moderate" },
      pathway: "mscp-virtual-visit",
      assessment,
      carePlan,
      careGaps
    });
    expect(context.sourceRecords).toEqual([
      "intake",
      "care-router:mscp-virtual-visit",
      "assessment:mrs",
      `care-plan:${carePlan.templateId}`,
      "care-gap:caregap.bone-density"
    ]);
  });

  it("emits no source records when there are no facts to compose", () => {
    const context = assembleClinicalSummaryContext({});
    expect(context.sourceRecords).toEqual([]);
    expect(context.patientDisplayName).toBe("the patient");
  });

  it("is deterministic: identical inputs yield an identical context", () => {
    const inputs = {
      intake: { preferredName: "Ada", severity: "moderate", primarySymptom: "vasomotor" },
      pathway: "mscp-virtual-visit" as const,
      carePlan
    };
    expect(assembleClinicalSummaryContext(inputs)).toEqual(
      assembleClinicalSummaryContext(inputs)
    );
  });
});

describe("grounding integrity · summaryTracesToSourceRecords", () => {
  const context = assembleClinicalSummaryContext({
    intake: { preferredName: "Ada", severity: "moderate" },
    pathway: "mscp-virtual-visit",
    carePlan
  });

  it("is true for a result whose source records all trace to the context", () => {
    const result: Pick<ClinicalSummaryResult, "sourceRecords"> = {
      sourceRecords: context.sourceRecords
    };
    expect(summaryTracesToSourceRecords(result, context)).toBe(true);
  });

  it("flags a caller-asserted result citing an off-context (fabricated) record", () => {
    const fabricated: Pick<ClinicalSummaryResult, "sourceRecords"> = {
      sourceRecords: ["intake", "care-plan:careplan.totally-invented"]
    };
    expect(summaryTracesToSourceRecords(fabricated, context)).toBe(false);
  });

  it("flags a result that cites no records at all", () => {
    expect(summaryTracesToSourceRecords({ sourceRecords: [] }, context)).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(summaryTracesToSourceRecords(null, context)).toBe(false);
    expect(summaryTracesToSourceRecords(undefined, context)).toBe(false);
  });
});

describe("scriptedSummarizeClinical · deterministic, grounded, non-prescriptive", () => {
  it("composes both artifacts from the context only", () => {
    const context = assembleClinicalSummaryContext({
      intake: { preferredName: "Ada", severity: "moderate", primarySymptom: "vasomotor" },
      pathway: "mscp-virtual-visit",
      onHrt: true,
      assessment,
      carePlan,
      careGaps
    });
    const { patientSummary, clinicianHandoff } = scriptedSummarizeClinical(context);
    expect(patientSummary).toMatch(/After-visit summary for Ada/);
    expect(patientSummary).toMatch(/does not add or change any diagnosis/i);
    expect(clinicianHandoff).toMatch(/Clinician handoff — Ada/);
    expect(clinicianHandoff).toMatch(/Menopause Rating Scale 21\/44/);
    expect(clinicianHandoff).toMatch(/on hormone therapy/);
    expect(clinicianHandoff).toMatch(/requires clinician review/i);
  });

  it("omits sections whose facts are absent from the context", () => {
    const context = assembleClinicalSummaryContext({
      intake: { preferredName: "Ada" }
    });
    const { patientSummary, clinicianHandoff } = scriptedSummarizeClinical(context);
    expect(patientSummary).not.toMatch(/care plan/i);
    expect(clinicianHandoff).not.toMatch(/Validated instrument/);
  });
});

describe("summarizeClinical · fallback path (no key)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("falls back to the scripted composition with a fallbackReason when the key is unset", async () => {
    const context = assembleClinicalSummaryContext({
      intake: { preferredName: "Ada", severity: "moderate" },
      pathway: "mscp-virtual-visit",
      carePlan
    });
    const out = await summarizeClinical(context);
    expect(out.via).toBe("scripted-fallback");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The reason is only the leading diagnostic, not clinical summary text.
    expect(out.fallbackReason).not.toMatch(/handoff/i);
    // Provenance is copied from the context and traces cleanly.
    expect(out.sourceRecords).toEqual(context.sourceRecords);
    expect(summaryTracesToSourceRecords(out, context)).toBe(true);
    expect(out.synthetic).toBe(true);
  });
});

describe("summarizeClinical · live path (mocked SDK)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
  const context: ClinicalSummaryContext = assembleClinicalSummaryContext({
    intake: { preferredName: "Ada", severity: "moderate", primarySymptom: "vasomotor" },
    pathway: "mscp-virtual-visit",
    carePlan
  });

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("returns a claude-api composition on a mocked SDK success", async () => {
    createMock.mockResolvedValue(
      claudeJsonResponse({
        patientSummary: "Ada, here is a friendly recap of your visit.",
        clinicianHandoff: "Ada — moderate vasomotor presentation; virtual MSCP recommended."
      })
    );
    const out = await summarizeClinical(context);
    expect(out.via).toBe("claude-api");
    expect(out.modelProvenance.provider).toBe("anthropic");
    expect(out.patientSummary).toMatch(/friendly recap/);
    expect(out.clinicianHandoff).toMatch(/moderate vasomotor/);
    expect(out.fallbackReason).toBeUndefined();
    // Provenance is still deterministic (never model-derived).
    expect(out.sourceRecords).toEqual(context.sourceRecords);
  });

  it("falls back with a populated fallbackReason when the SDK throws", async () => {
    createMock.mockRejectedValue(new Error("HTTP 529 overloaded"));
    const out = await summarizeClinical(context);
    expect(out.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
    expect(out.fallbackReason).toMatch(/HTTP 529 overloaded/);
    expect(out.patientSummary).toBe(scriptedSummarizeClinical(context).patientSummary);
  });

  it("falls back when the SDK returns unparseable / incomplete JSON", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json at all" }] });
    const out = await summarizeClinical(context);
    expect(out.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
  });

  it("falls back when the JSON is missing a required field", async () => {
    createMock.mockResolvedValue(
      claudeJsonResponse({ patientSummary: "only one field" })
    );
    const out = await summarizeClinical(context);
    expect(out.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
  });
});
