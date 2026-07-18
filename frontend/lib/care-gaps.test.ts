import { describe, expect, it } from "vitest";
import {
  CLINICAL_MEASURES,
  detectCareGaps,
  draftAllGapOutreach,
  draftGapOutreach,
  gapsTraceToClinicalMeasure,
  getClinicalMeasure,
  groundingToCareGapContext,
  isCatalogMeasure,
  measureIdsForGaps,
  type CareGapContext
} from "./care-gaps";
import { getGroundingContext } from "./data-360";

/**
 * Tests for lib/care-gaps.ts — the deterministic care-gap detector behind the
 * Care Gap Closure Agent. Detection is a pure function of an explicit as-of
 * date + patient signals + per-measure history (no randomness, no clock), so
 * the same context always produces the same gaps. These tests pin determinism,
 * detection from representative grounding contexts, the catalog-integrity
 * property (every gap references a defined clinical measure), the consent- and
 * quiet-hours-aware outreach draft, and rejection/flagging of off-catalog gaps.
 */

const AS_OF = "2026-02-02";

// A representative postmenopausal patient with an overdue clinical contact and
// no preventive measures on record.
const POSTMENO_NO_HISTORY: CareGapContext = {
  asOf: AS_OF,
  ageBand: "51-55",
  cycleStatus: "stopped>=12mo",
  primarySymptom: "hot_flashes",
  onHrt: true,
  daysSinceClinicalContact: 412,
  measureHistory: {}
};

describe("clinical-measure catalog", () => {
  it("exposes a non-empty catalog with stable ids and positive intervals", () => {
    expect(CLINICAL_MEASURES.length).toBeGreaterThan(0);
    for (const m of CLINICAL_MEASURES) {
      expect(m.id).toMatch(/^measure\./);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.rationale.length).toBeGreaterThan(0);
      expect(m.recommendedIntervalDays).toBeGreaterThan(0);
    }
  });

  it("isCatalogMeasure / getClinicalMeasure agree with the catalog", () => {
    for (const m of CLINICAL_MEASURES) {
      expect(isCatalogMeasure(m.id)).toBe(true);
      expect(getClinicalMeasure(m.id)?.label).toBe(m.label);
    }
    expect(isCatalogMeasure("measure.totally-made-up")).toBe(false);
    expect(getClinicalMeasure("measure.totally-made-up")).toBeUndefined();
  });
});

describe("detectCareGaps · determinism + catalog integrity", () => {
  it("is deterministic — the same context yields the same gaps", () => {
    expect(detectCareGaps(POSTMENO_NO_HISTORY)).toEqual(
      detectCareGaps(POSTMENO_NO_HISTORY)
    );
  });

  it("every detected gap references a defined clinical-measure catalog id", () => {
    const gaps = detectCareGaps(POSTMENO_NO_HISTORY);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(isCatalogMeasure(g.measureId)).toBe(true);
      expect(g.measureLabel).toBe(getClinicalMeasure(g.measureId)!.label);
    }
    // The integrity signal the route reports to governance is true.
    expect(gapsTraceToClinicalMeasure(gaps)).toBe(true);
  });

  it("detects DEXA + lipid + mammogram + HRT follow-up for a postmenopausal patient on HRT with no history", () => {
    const ids = detectCareGaps(POSTMENO_NO_HISTORY).map((g) => g.measureId);
    expect(ids).toContain("measure.bone-density-dexa");
    expect(ids).toContain("measure.lipid-panel");
    expect(ids).toContain("measure.mammogram");
    expect(ids).toContain("measure.hrt-follow-up");
  });

  it("never-done applicable measures come back overdue with lastDone null", () => {
    const gaps = detectCareGaps(POSTMENO_NO_HISTORY);
    for (const g of gaps) {
      expect(g.status).toBe("overdue");
      expect(g.lastDone).toBeNull();
    }
  });
});

describe("detectCareGaps · applicability rules", () => {
  it("does NOT flag HRT follow-up for a patient not on HRT", () => {
    const ids = detectCareGaps({
      ...POSTMENO_NO_HISTORY,
      onHrt: false
    }).map((g) => g.measureId);
    expect(ids).not.toContain("measure.hrt-follow-up");
  });

  it("does NOT flag age/postmenopause-gated measures for a young, pre-menopausal patient", () => {
    const ids = detectCareGaps({
      asOf: AS_OF,
      ageBand: "<40",
      cycleStatus: "irregular",
      onHrt: false,
      measureHistory: {}
    }).map((g) => g.measureId);
    // Under 40, not postmenopausal, no HRT, no risk flags → none apply.
    expect(ids).not.toContain("measure.bone-density-dexa");
    expect(ids).not.toContain("measure.lipid-panel");
    expect(ids).not.toContain("measure.mammogram");
    expect(ids).not.toContain("measure.hrt-follow-up");
  });

  it("an explicit osteoporosis risk flag makes DEXA apply even for a younger band", () => {
    const ids = detectCareGaps({
      asOf: AS_OF,
      ageBand: "40-45",
      cycleStatus: "irregular",
      onHrt: false,
      riskFlags: { osteoporosisRisk: true },
      measureHistory: {}
    }).map((g) => g.measureId);
    expect(ids).toContain("measure.bone-density-dexa");
  });
});

describe("detectCareGaps · open vs overdue against the as-of date", () => {
  it("does NOT flag a measure completed within its interval", () => {
    // Mammogram done 100 days before as-of, interval 730d → up to date.
    const recent = "2025-10-25";
    const ids = detectCareGaps({
      ...POSTMENO_NO_HISTORY,
      measureHistory: { "measure.mammogram": recent }
    }).map((g) => g.measureId);
    expect(ids).not.toContain("measure.mammogram");
  });

  it("flags a measure completed longer ago than its interval as overdue with daysOverdue", () => {
    // Mammogram done ~3 years before as-of; interval 730d → overdue ~365d.
    const gaps = detectCareGaps({
      ...POSTMENO_NO_HISTORY,
      measureHistory: { "measure.mammogram": "2023-02-02" }
    });
    const mammo = gaps.find((g) => g.measureId === "measure.mammogram");
    expect(mammo).toBeDefined();
    expect(mammo!.status).toBe("overdue");
    expect(mammo!.lastDone).toBe("2023-02-02");
    expect(mammo!.dueSince).toBe("2025-02-01");
    expect(mammo!.daysOverdue).toBeGreaterThan(300);
  });

  it("ranks a never-done + long-overdue-contact gap higher than routine", () => {
    const gaps = detectCareGaps(POSTMENO_NO_HISTORY);
    // Never done + >1yr since clinical contact → elevated/urgent, not routine.
    for (const g of gaps) {
      expect(["elevated", "urgent"]).toContain(g.priority);
    }
  });
});

describe("draftGapOutreach · consent- + quiet-hours-aware, never auto-sent", () => {
  it("drafts a human-approval-gated, unsent message on the preferred channel", () => {
    const [gap] = detectCareGaps(POSTMENO_NO_HISTORY);
    const draft = draftGapOutreach(gap, {
      channel: "sms",
      hasContactConsent: true,
      quietHours: { start: "21:00", end: "08:00" }
    });
    expect(draft.measureId).toBe(gap.measureId);
    expect(draft.channel).toBe("sms");
    expect(draft.requiresHumanApproval).toBe(true);
    expect(draft.sent).toBe(false);
    expect(draft.suppressedForNoConsent).toBe(false);
    expect(draft.quietHoursRespected).toBe(true);
    expect(draft.handoffTo).toBe("engagement-agent");
    // sms carries no subject line.
    expect(draft.subject).toBeUndefined();
  });

  it("email drafts carry a subject line", () => {
    const [gap] = detectCareGaps(POSTMENO_NO_HISTORY);
    const draft = draftGapOutreach(gap, { channel: "email", hasContactConsent: true });
    expect(draft.channel).toBe("email");
    expect(typeof draft.subject).toBe("string");
  });

  it("suppresses the draft when the target has no contact consent", () => {
    const [gap] = detectCareGaps(POSTMENO_NO_HISTORY);
    const draft = draftGapOutreach(gap, { hasContactConsent: false });
    expect(draft.suppressedForNoConsent).toBe(true);
    expect(draft.sent).toBe(false);
    expect(draft.body.toLowerCase()).toContain("suppressed");
  });

  it("draftAllGapOutreach drafts one message per gap", () => {
    const gaps = detectCareGaps(POSTMENO_NO_HISTORY);
    const drafts = draftAllGapOutreach(gaps, { channel: "email", hasContactConsent: true });
    expect(drafts).toHaveLength(gaps.length);
    expect(drafts.map((d) => d.measureId).sort()).toEqual(
      gaps.map((g) => g.measureId).sort()
    );
  });
});

describe("gapsTraceToClinicalMeasure · off-catalog rejection", () => {
  it("returns true for detector output and false for a free-invented gap", () => {
    const gaps = detectCareGaps(POSTMENO_NO_HISTORY);
    expect(gapsTraceToClinicalMeasure(gaps)).toBe(true);

    const fabricated = [
      ...gaps,
      { measureId: "measure.completely-made-up" }
    ];
    expect(gapsTraceToClinicalMeasure(fabricated)).toBe(false);
  });

  it("returns false for a non-array input", () => {
    expect(gapsTraceToClinicalMeasure(null)).toBe(false);
    expect(gapsTraceToClinicalMeasure(undefined)).toBe(false);
  });

  it("measureIdsForGaps drops off-catalog ids", () => {
    const ids = measureIdsForGaps([
      { measureId: "measure.mammogram" },
      { measureId: "measure.made-up" }
    ]);
    expect(ids).toEqual(["measure.mammogram"]);
  });
});

describe("groundingToCareGapContext · grounds on the Data 360 context", () => {
  it("derives days-since-clinical-contact from the grounding insight", () => {
    const grounding = getGroundingContext({ patientId: "pause-demo-patient-001" });
    const ctx = groundingToCareGapContext(grounding, {
      asOf: AS_OF,
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      onHrt: true
    });
    // The mock grounding reports 412 days since MSCP contact.
    expect(ctx.daysSinceClinicalContact).toBe(412);
    // And gaps detected from it trace to catalog measures.
    const gaps = detectCareGaps(ctx);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gapsTraceToClinicalMeasure(gaps)).toBe(true);
  });
});
