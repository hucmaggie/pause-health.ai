import { describe, expect, it } from "vitest";

import {
  DDI_INTERACTIONS,
  DDI_SEVERITY_RANK,
  DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
  DEMO_DRUG_INTERACTION_MODERATE_REQUEST,
  DEMO_DRUG_INTERACTION_NONE_REQUEST,
  DEMO_DRUG_INTERACTION_REQUEST,
  ddiInteractionSourced,
  ddiNoAutonomousHoldOrOverride,
  ddiSeverityConsistent,
  dispositionForSeverity,
  drugInteractionSummary,
  evaluateDrugInteractions,
  findInteractionForPair,
  getDdiInteraction,
  normalizeDrug
} from "./drug-interaction";

describe("DDI_INTERACTIONS catalog", () => {
  it("stores every pair sorted and has stable ids", () => {
    for (const i of DDI_INTERACTIONS) {
      expect(i.pair[0] <= i.pair[1]).toBe(true);
      expect(i.id).toMatch(/^ddi\./);
      expect(DDI_SEVERITY_RANK[i.severity]).toBeGreaterThan(0);
    }
  });
});

describe("normalizeDrug", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeDrug("  Iodinated   Contrast ")).toBe("iodinated contrast");
    expect(normalizeDrug("Paroxetine")).toBe("paroxetine");
  });
});

describe("findInteractionForPair", () => {
  it("is order-independent", () => {
    const a = findInteractionForPair("paroxetine", "tamoxifen");
    const b = findInteractionForPair("tamoxifen", "paroxetine");
    expect(a?.id).toBe("ddi.paroxetine-tamoxifen");
    expect(a?.id).toBe(b?.id);
  });
  it("returns undefined for an uncataloged pair", () => {
    expect(findInteractionForPair("acetaminophen", "calcium")).toBeUndefined();
  });
});

describe("dispositionForSeverity", () => {
  it("maps each severity to its disposition", () => {
    expect(dispositionForSeverity("contraindicated")).toBe("do-not-coadminister-needs-review");
    expect(dispositionForSeverity("major")).toBe("review-required");
    expect(dispositionForSeverity("moderate")).toBe("review-recommended");
    expect(dispositionForSeverity("minor")).toBe("monitor");
    expect(dispositionForSeverity("none")).toBe("no-interaction-detected");
  });
});

describe("evaluateDrugInteractions", () => {
  it("detects a major interaction and requires review", () => {
    const d = evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST);
    expect(d.interactionCount).toBe(1);
    expect(d.overallSeverity).toBe("major");
    expect(d.disposition).toBe("review-required");
    expect(d.detectedInteractions[0].interactionId).toBe("ddi.paroxetine-tamoxifen");
    expect(d.autoHeldOrder).toBe(false);
    expect(d.autoOverrodeAlert).toBe(false);
    expect(d.requiresClinicianReview).toBe(true);
  });

  it("detects a contraindicated combination", () => {
    const d = evaluateDrugInteractions(DEMO_DRUG_INTERACTION_CONTRA_REQUEST);
    expect(d.overallSeverity).toBe("contraindicated");
    expect(d.disposition).toBe("do-not-coadminister-needs-review");
  });

  it("detects a moderate interaction", () => {
    const d = evaluateDrugInteractions(DEMO_DRUG_INTERACTION_MODERATE_REQUEST);
    expect(d.overallSeverity).toBe("moderate");
    expect(d.disposition).toBe("review-recommended");
  });

  it("reports no interaction when nothing is cataloged", () => {
    const d = evaluateDrugInteractions(DEMO_DRUG_INTERACTION_NONE_REQUEST);
    expect(d.interactionCount).toBe(0);
    expect(d.overallSeverity).toBe("none");
    expect(d.disposition).toBe("no-interaction-detected");
  });

  it("takes the highest severity and sorts most-severe first", () => {
    const d = evaluateDrugInteractions({
      requestRef: "ddi-multi",
      patientRef: "p1",
      proposedDrug: "warfarin",
      activeMedications: ["aspirin", "fluconazole"]
    });
    // both are major → overall major, two detected
    expect(d.interactionCount).toBe(2);
    expect(d.overallSeverity).toBe("major");
  });

  it("ignores a duplicate active med and self-pairing", () => {
    const d = evaluateDrugInteractions({
      requestRef: "ddi-dup",
      patientRef: "p1",
      proposedDrug: "paroxetine",
      activeMedications: ["tamoxifen", "tamoxifen", "paroxetine"]
    });
    expect(d.interactionCount).toBe(1);
  });

  it("is deterministic — same request yields the same determination", () => {
    expect(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST)).toEqual(
      evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST)
    );
  });
});

describe("getDdiInteraction", () => {
  it("resolves a cataloged interaction", () => {
    expect(getDdiInteraction("ddi.warfarin-aspirin")?.severity).toBe("major");
  });
  it("returns undefined off-catalog", () => {
    expect(getDdiInteraction("ddi.nope")).toBeUndefined();
  });
});

describe("ddiInteractionSourced", () => {
  it("passes a produced determination", () => {
    expect(ddiInteractionSourced(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST))).toBe(true);
  });
  it("passes when there are no interactions", () => {
    expect(ddiInteractionSourced(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_NONE_REQUEST))).toBe(
      true
    );
  });
  it("fails an off-catalog interaction", () => {
    expect(
      ddiInteractionSourced({ detectedInteractions: [{ interactionId: "ddi.nope", severity: "major" }] })
    ).toBe(false);
  });
  it("fails a severity mismatch on a real record", () => {
    expect(
      ddiInteractionSourced({
        detectedInteractions: [{ interactionId: "ddi.estradiol-rifampin", severity: "contraindicated" }]
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(ddiInteractionSourced(null)).toBe(false);
  });
});

describe("ddiSeverityConsistent", () => {
  it("passes a produced determination", () => {
    expect(ddiSeverityConsistent(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_CONTRA_REQUEST))).toBe(
      true
    );
  });
  it("passes 'none' when there are no interactions", () => {
    expect(ddiSeverityConsistent(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_NONE_REQUEST))).toBe(
      true
    );
  });
  it("fails an inflated overall severity", () => {
    expect(
      ddiSeverityConsistent({
        detectedInteractions: [{ interactionId: "ddi.estradiol-rifampin" }],
        overallSeverity: "contraindicated"
      })
    ).toBe(false);
  });
  it("fails a suppressed overall severity", () => {
    expect(
      ddiSeverityConsistent({
        detectedInteractions: [{ interactionId: "ddi.sildenafil-nitroglycerin" }],
        overallSeverity: "minor"
      })
    ).toBe(false);
  });
  it("fails an off-catalog interaction (can't verify)", () => {
    expect(
      ddiSeverityConsistent({
        detectedInteractions: [{ interactionId: "ddi.nope" }],
        overallSeverity: "major"
      })
    ).toBe(false);
  });
});

describe("ddiNoAutonomousHoldOrOverride", () => {
  it("passes a produced determination", () => {
    expect(
      ddiNoAutonomousHoldOrOverride(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST))
    ).toBe(true);
  });
  it("fails an autonomously-held order", () => {
    expect(
      ddiNoAutonomousHoldOrOverride({
        autoHeldOrder: true,
        autoOverrodeAlert: false,
        requiresClinicianReview: true
      })
    ).toBe(false);
  });
  it("fails an autonomously-overridden alert", () => {
    expect(
      ddiNoAutonomousHoldOrOverride({
        autoHeldOrder: false,
        autoOverrodeAlert: true,
        requiresClinicianReview: true
      })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      ddiNoAutonomousHoldOrOverride({
        autoHeldOrder: false,
        autoOverrodeAlert: false,
        requiresClinicianReview: false
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(ddiNoAutonomousHoldOrOverride(null)).toBe(false);
  });
});

describe("drugInteractionSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = drugInteractionSummary(evaluateDrugInteractions(DEMO_DRUG_INTERACTION_REQUEST));
    expect(s.overallSeverity).toBe("major");
    expect(s.disposition).toBe("review-required");
    expect(s.requiresClinicianReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
