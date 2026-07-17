import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_INSTRUMENTS,
  assessmentToIntakeSignal,
  getInstrumentSpec,
  isAllowlistedInstrument,
  scoreAssessment,
  type AssessmentInstrument
} from "./assessments";

/**
 * Tests for lib/assessments.ts — the deterministic validated-instrument
 * scoring behind the Assessment Agent. Scoring is real cutoff-based math
 * (no LLM), so every expectation is an exact number, and the same
 * responses always score identically.
 */

/** Build a length-`n` response vector summing to `total` (each item ≤ max). */
function vectorSummingTo(n: number, total: number, max: number): number[] {
  const out = new Array<number>(n).fill(0);
  let remaining = total;
  for (let i = 0; i < n && remaining > 0; i++) {
    const take = Math.min(max, remaining);
    out[i] = take;
    remaining -= take;
  }
  if (remaining > 0) throw new Error("total exceeds capacity of the vector");
  return out;
}

describe("allow-list", () => {
  it("exposes exactly the four validated instruments", () => {
    expect([...ALLOWLISTED_INSTRUMENTS].sort()).toEqual(
      ["greene", "isi", "mrs", "phq-9"].sort()
    );
  });

  it("isAllowlistedInstrument accepts allow-listed ids and rejects others", () => {
    for (const id of ALLOWLISTED_INSTRUMENTS) {
      expect(isAllowlistedInstrument(id)).toBe(true);
    }
    expect(isAllowlistedInstrument("gad-7")).toBe(false);
    expect(isAllowlistedInstrument("audit-c")).toBe(false);
    expect(isAllowlistedInstrument(undefined)).toBe(false);
    expect(isAllowlistedInstrument(42)).toBe(false);
  });

  it("scoreAssessment rejects an instrument off the allow-list", () => {
    expect(() =>
      scoreAssessment({
        instrument: "gad-7" as unknown as AssessmentInstrument,
        responses: [0, 0, 0, 0, 0, 0, 0]
      })
    ).toThrow(/allow-list/);
  });
});

describe("input validation", () => {
  it("rejects a wrong-length response vector", () => {
    expect(() =>
      scoreAssessment({ instrument: "phq-9", responses: [0, 0, 0] })
    ).toThrow(/expects 9 responses/);
  });

  it("rejects an out-of-range response value", () => {
    expect(() =>
      scoreAssessment({ instrument: "phq-9", responses: [0, 0, 0, 0, 0, 0, 0, 0, 4] })
    ).toThrow(/out of range/);
    expect(() =>
      scoreAssessment({ instrument: "isi", responses: [0, 0, 0, 0, 0, 0, -1] })
    ).toThrow(/out of range/);
  });

  it("rejects a non-integer response value", () => {
    expect(() =>
      scoreAssessment({ instrument: "isi", responses: [1.5, 0, 0, 0, 0, 0, 0] })
    ).toThrow(/out of range/);
  });
});

describe("MRS (Menopause Rating Scale)", () => {
  it("scores an all-zero response as none-to-little / mild", () => {
    const r = scoreAssessment({ instrument: "mrs", responses: new Array(11).fill(0) });
    expect(r.total).toBe(0);
    expect(r.maxTotal).toBe(44);
    expect(r.severityBand).toBe("none-to-little");
    expect(r.normalizedSeverity).toBe("mild");
    expect(r.redFlags).toEqual([]);
    expect(r.subscores.map((s) => s.id)).toEqual([
      "somatic",
      "psychological",
      "urogenital"
    ]);
  });

  it("honors the published total-score band cutoffs (0-4 / 5-8 / 9-16 / 17+)", () => {
    const band = (total: number) =>
      scoreAssessment({
        instrument: "mrs",
        responses: vectorSummingTo(11, total, 4)
      }).severityBand;
    expect(band(4)).toBe("none-to-little");
    expect(band(5)).toBe("mild");
    expect(band(8)).toBe("mild");
    expect(band(9)).toBe("moderate");
    expect(band(16)).toBe("moderate");
    expect(band(17)).toBe("severe");
  });

  it("computes the three subscale scores and their published bands", () => {
    // somatic items [0,1,2,10], psychological [3,4,5,6], urogenital [7,8,9]
    const responses = [4, 4, 1, 3, 3, 0, 0, 2, 1, 1, 2];
    const r = scoreAssessment({ instrument: "mrs", responses });
    const byId = Object.fromEntries(r.subscores.map((s) => [s.id, s]));
    // somatic: 4+4+1+2 = 11 → severe (>=9)
    expect(byId.somatic.score).toBe(11);
    expect(byId.somatic.maxScore).toBe(16);
    expect(byId.somatic.band).toBe("severe");
    // psychological: 3+3+0+0 = 6 → moderate (4-6)
    expect(byId.psychological.score).toBe(6);
    expect(byId.psychological.band).toBe("moderate");
    // urogenital: 2+1+1 = 4 → severe (>=4)
    expect(byId.urogenital.score).toBe(4);
    expect(byId.urogenital.band).toBe("severe");
  });
});

describe("Greene Climacteric Scale", () => {
  it("scores an all-zero response as low / mild with four subscales", () => {
    const r = scoreAssessment({ instrument: "greene", responses: new Array(21).fill(0) });
    expect(r.total).toBe(0);
    expect(r.maxTotal).toBe(63);
    expect(r.severityBand).toBe("low");
    expect(r.normalizedSeverity).toBe("mild");
    expect(r.subscores.map((s) => s.id)).toEqual([
      "psychological",
      "somatic",
      "vasomotor",
      "sexual"
    ]);
  });

  it("uses the inferred total-score bands (0-12 / 13-24 / 25+)", () => {
    const band = (total: number) =>
      scoreAssessment({
        instrument: "greene",
        responses: vectorSummingTo(21, total, 3)
      }).severityBand;
    expect(band(12)).toBe("low");
    expect(band(13)).toBe("moderate");
    expect(band(24)).toBe("moderate");
    expect(band(25)).toBe("high");
  });

  it("partitions items into the correct subscale windows", () => {
    // Put a 3 in exactly one item of each domain window.
    const responses = new Array(21).fill(0);
    responses[0] = 3; // psychological (0-10)
    responses[11] = 3; // somatic (11-17)
    responses[18] = 3; // vasomotor (18-19)
    responses[20] = 3; // sexual (20)
    const r = scoreAssessment({ instrument: "greene", responses });
    const byId = Object.fromEntries(r.subscores.map((s) => [s.id, s]));
    expect(byId.psychological.score).toBe(3);
    expect(byId.psychological.maxScore).toBe(33);
    expect(byId.somatic.score).toBe(3);
    expect(byId.vasomotor.score).toBe(3);
    expect(byId.sexual.score).toBe(3);
    expect(byId.sexual.maxScore).toBe(3);
  });
});

describe("PHQ-9", () => {
  it("honors the published severity bands", () => {
    const band = (total: number) =>
      scoreAssessment({
        instrument: "phq-9",
        responses: vectorSummingTo(9, total, 3)
      }).severityBand;
    expect(band(4)).toBe("minimal");
    expect(band(5)).toBe("mild");
    expect(band(9)).toBe("mild");
    expect(band(10)).toBe("moderate");
    expect(band(14)).toBe("moderate");
    expect(band(15)).toBe("moderately-severe");
    expect(band(19)).toBe("moderately-severe");
    expect(band(20)).toBe("severe");
    expect(band(27)).toBe("severe");
  });

  it("normalizes moderately-severe and severe onto 'severe'", () => {
    expect(
      scoreAssessment({ instrument: "phq-9", responses: vectorSummingTo(9, 16, 3) })
        .normalizedSeverity
    ).toBe("severe");
  });

  it("flags item 9 (self-harm) on any non-zero response", () => {
    const r = scoreAssessment({
      instrument: "phq-9",
      responses: [0, 0, 0, 0, 0, 0, 0, 0, 2]
    });
    expect(r.total).toBe(2);
    expect(r.severityBand).toBe("minimal");
    expect(r.redFlags).toHaveLength(1);
    expect(r.redFlags[0].itemIndex).toBe(8);
    expect(r.redFlags[0].code).toBe("phq9-item9-self-harm");
    expect(r.redFlags[0].value).toBe(2);
    expect(r.interpretation).toMatch(/safety escalation/i);
  });

  it("does not flag item 9 when it is zero", () => {
    const r = scoreAssessment({
      instrument: "phq-9",
      responses: [3, 3, 3, 0, 0, 0, 0, 0, 0]
    });
    expect(r.redFlags).toEqual([]);
  });
});

describe("ISI (Insomnia Severity Index)", () => {
  it("honors the published severity bands", () => {
    const band = (total: number) =>
      scoreAssessment({
        instrument: "isi",
        responses: vectorSummingTo(7, total, 4)
      }).severityBand;
    expect(band(7)).toBe("none");
    expect(band(8)).toBe("subthreshold");
    expect(band(14)).toBe("subthreshold");
    expect(band(15)).toBe("moderate");
    expect(band(21)).toBe("moderate");
    expect(band(22)).toBe("severe");
    expect(band(28)).toBe("severe");
  });

  it("maps none + subthreshold to mild, moderate to moderate, severe to severe", () => {
    const norm = (total: number) =>
      scoreAssessment({
        instrument: "isi",
        responses: vectorSummingTo(7, total, 4)
      }).normalizedSeverity;
    expect(norm(7)).toBe("mild");
    expect(norm(14)).toBe("mild");
    expect(norm(15)).toBe("moderate");
    expect(norm(22)).toBe("severe");
  });
});

describe("assessmentToIntakeSignal", () => {
  it("maps a clean result to its normalized severity + a 'no' red-flag screen", () => {
    const r = scoreAssessment({
      instrument: "isi",
      responses: vectorSummingTo(7, 16, 4)
    });
    expect(assessmentToIntakeSignal(r)).toEqual({
      severity: "moderate",
      redFlagsAcknowledged: "no"
    });
  });

  it("forces severe + 'yes' when a red flag is present, regardless of band", () => {
    const r = scoreAssessment({
      instrument: "phq-9",
      responses: [0, 0, 0, 0, 0, 0, 0, 0, 1]
    });
    // Band is minimal (total 1), but the self-harm red flag overrides.
    expect(r.severityBand).toBe("minimal");
    expect(assessmentToIntakeSignal(r)).toEqual({
      severity: "severe",
      redFlagsAcknowledged: "yes"
    });
  });
});

describe("getInstrumentSpec", () => {
  it("returns item counts and per-item maxima for each instrument", () => {
    expect(getInstrumentSpec("mrs")).toMatchObject({ itemCount: 11, itemMax: 4 });
    expect(getInstrumentSpec("greene")).toMatchObject({ itemCount: 21, itemMax: 3 });
    expect(getInstrumentSpec("phq-9")).toMatchObject({ itemCount: 9, itemMax: 3 });
    expect(getInstrumentSpec("isi")).toMatchObject({ itemCount: 7, itemMax: 4 });
  });
});
