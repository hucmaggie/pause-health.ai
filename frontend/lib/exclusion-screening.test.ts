import { describe, expect, it } from "vitest";

import {
  DEMO_SCREENING_CLEAR_REQUEST,
  DEMO_SCREENING_COINCIDENCE_REQUEST,
  DEMO_SCREENING_REQUEST,
  EXCLUSION_RECORDS,
  evaluateScreening,
  exclusionMatchNotOverstated,
  exclusionMatchSourced,
  exclusionNoAutonomousBlockOrClear,
  getExclusionRecord,
  screeningSummary,
  supportableStrength
} from "./exclusion-screening";

describe("evaluateScreening", () => {
  it("reports a confirmed match on an exact NPI hit", () => {
    const d = evaluateScreening(DEMO_SCREENING_REQUEST);
    expect(d.matchStrength).toBe("confirmed");
    expect(d.matchedExclusionId).toBe("leie-1001");
    expect(d.npiMatch).toBe(true);
    expect(d.disposition).toBe("recommend-block-pending-review");
    expect(d.autoBlockedPayment).toBe(false);
    expect(d.autoCleared).toBe(false);
    expect(d.requiresComplianceReview).toBe(true);
  });

  it("reports a possible coincidence on a shared last name the first name / DOB refute", () => {
    const d = evaluateScreening(DEMO_SCREENING_COINCIDENCE_REQUEST);
    expect(d.matchStrength).toBe("possible");
    expect(d.nameMatch).toBe(false);
    expect(d.dobMatch).toBe(false);
    expect(d.disposition).toBe("recommend-review-possible");
  });

  it("reports no-match with no cited record for a clean party", () => {
    const d = evaluateScreening(DEMO_SCREENING_CLEAR_REQUEST);
    expect(d.matchStrength).toBe("no-match");
    expect(d.matchedExclusionId).toBeNull();
    expect(d.disposition).toBe("recommend-clear");
  });

  it("reports a probable match on a full name with no DOB / NPI to confirm", () => {
    // Delgado, Maria has a DOB but no NPI in the catalog; omit DOB in the request.
    const d = evaluateScreening({
      partyRef: "provider-9001",
      lastName: "Delgado",
      firstName: "Maria"
    });
    expect(d.matchStrength).toBe("probable");
    expect(d.nameMatch).toBe(true);
    expect(d.dobMatch).toBeNull();
    expect(d.disposition).toBe("recommend-review-probable");
  });

  it("confirms on full name + DOB even without an NPI", () => {
    const d = evaluateScreening({
      partyRef: "provider-9002",
      lastName: "Delgado",
      firstName: "Maria",
      dob: "1975-11-02"
    });
    expect(d.matchStrength).toBe("confirmed");
    expect(d.dobMatch).toBe(true);
  });

  it("is deterministic — same party yields the same determination", () => {
    expect(evaluateScreening(DEMO_SCREENING_REQUEST)).toEqual(
      evaluateScreening(DEMO_SCREENING_REQUEST)
    );
  });
});

describe("supportableStrength", () => {
  it("confirms on an NPI match regardless of the rest", () => {
    expect(supportableStrength({ npiMatch: true, nameMatch: false, dobMatch: null })).toBe(
      "confirmed"
    );
  });
  it("confirms on name + DOB", () => {
    expect(supportableStrength({ npiMatch: null, nameMatch: true, dobMatch: true })).toBe(
      "confirmed"
    );
  });
  it("caps at probable on name with no DOB", () => {
    expect(supportableStrength({ npiMatch: null, nameMatch: true, dobMatch: null })).toBe(
      "probable"
    );
  });
  it("caps at possible otherwise", () => {
    expect(supportableStrength({ npiMatch: null, nameMatch: false, dobMatch: null })).toBe(
      "possible"
    );
    expect(supportableStrength({ npiMatch: null, nameMatch: true, dobMatch: false })).toBe(
      "possible"
    );
  });
});

describe("getExclusionRecord", () => {
  it("resolves a cataloged record", () => {
    expect(getExclusionRecord("leie-1001")?.lastName).toBe("Harmon");
  });
  it("returns undefined off-catalog", () => {
    expect(getExclusionRecord("leie-nope")).toBeUndefined();
  });
  it("every record has an exclusion type + date", () => {
    for (const r of EXCLUSION_RECORDS) {
      expect(r.exclusionType).toBeTruthy();
      expect(r.exclusionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("exclusionMatchSourced", () => {
  it("passes a produced match", () => {
    expect(exclusionMatchSourced(evaluateScreening(DEMO_SCREENING_REQUEST))).toBe(true);
  });
  it("passes no-match with a null record", () => {
    expect(exclusionMatchSourced(evaluateScreening(DEMO_SCREENING_CLEAR_REQUEST))).toBe(true);
  });
  it("fails a match citing no cataloged record", () => {
    expect(exclusionMatchSourced({ matchStrength: "confirmed", matchedExclusionId: null })).toBe(
      false
    );
    expect(
      exclusionMatchSourced({ matchStrength: "confirmed", matchedExclusionId: "leie-nope" })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(exclusionMatchSourced(null)).toBe(false);
  });
});

describe("exclusionMatchNotOverstated", () => {
  it("passes a produced determination", () => {
    expect(exclusionMatchNotOverstated(evaluateScreening(DEMO_SCREENING_COINCIDENCE_REQUEST))).toBe(
      true
    );
  });
  it("fails a name coincidence claimed as confirmed", () => {
    expect(
      exclusionMatchNotOverstated({
        matchStrength: "confirmed",
        npiMatch: null,
        nameMatch: false,
        dobMatch: false
      })
    ).toBe(false);
  });
  it("fails a name-only match claimed as confirmed", () => {
    expect(
      exclusionMatchNotOverstated({
        matchStrength: "confirmed",
        npiMatch: null,
        nameMatch: true,
        dobMatch: null
      })
    ).toBe(false);
  });
  it("passes a probable claim on a name-only match", () => {
    expect(
      exclusionMatchNotOverstated({
        matchStrength: "probable",
        npiMatch: null,
        nameMatch: true,
        dobMatch: null
      })
    ).toBe(true);
  });
  it("passes any no-match", () => {
    expect(exclusionMatchNotOverstated({ matchStrength: "no-match" })).toBe(true);
  });
  it("fails a null / malformed input", () => {
    expect(exclusionMatchNotOverstated(null)).toBe(false);
    expect(exclusionMatchNotOverstated({})).toBe(false);
  });
});

describe("exclusionNoAutonomousBlockOrClear", () => {
  it("passes a produced determination", () => {
    expect(exclusionNoAutonomousBlockOrClear(evaluateScreening(DEMO_SCREENING_REQUEST))).toBe(true);
  });
  it("fails an auto-blocked payment", () => {
    expect(
      exclusionNoAutonomousBlockOrClear({
        autoBlockedPayment: true,
        autoCleared: false,
        requiresComplianceReview: true
      })
    ).toBe(false);
  });
  it("fails an auto-cleared party", () => {
    expect(
      exclusionNoAutonomousBlockOrClear({
        autoBlockedPayment: false,
        autoCleared: true,
        requiresComplianceReview: true
      })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      exclusionNoAutonomousBlockOrClear({
        autoBlockedPayment: false,
        autoCleared: false,
        requiresComplianceReview: false
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(exclusionNoAutonomousBlockOrClear(null)).toBe(false);
  });
});

describe("screeningSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = screeningSummary(evaluateScreening(DEMO_SCREENING_REQUEST));
    expect(s.matchStrength).toBe("confirmed");
    expect(s.matchedExclusionId).toBe("leie-1001");
    expect(s.requiresComplianceReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
