import { describe, expect, it } from "vitest";
import {
  ADVERSE_EVENT_REASON_CODES,
  ADVERSE_EVENT_RULES,
  ADVERSE_EVENT_TYPES,
  DEMO_AE_DEATH_LIFE_THREATENING,
  DEMO_AE_MEDWATCH_DRUG,
  DEMO_AE_NON_SERIOUS,
  DEMO_AE_UNVERIFIED_REPORTER,
  DEMO_AE_VAERS_VACCINE,
  SERIOUSNESS_TIERS,
  computeSeriousnessTier,
  evaluateAdverseEvent,
  evaluateAdverseEventRules,
  eventsTraceToCatalog,
  getAdverseEventRule,
  getAdverseEventType,
  getSeriousnessTier,
  isAdverseEventReasonCode,
  isAdverseEventRule,
  isAdverseEventType,
  isReporterType,
  isSeriousnessTier,
  reporterIdentityVerified,
  submissionRequiresRegulatoryTeamCosign,
  summarizeAdverseEventDecision
} from "./adverse-event-reporting";

describe("catalogs", () => {
  it("exposes event-type + seriousness + rule + reason catalogs", () => {
    expect(ADVERSE_EVENT_TYPES.length).toBe(5);
    for (const e of ADVERSE_EVENT_TYPES) {
      expect(e.id).toMatch(/^event\./);
      expect(["medwatch", "vaers"]).toContain(e.targetChannel);
    }
    expect(SERIOUSNESS_TIERS.length).toBe(4);
    for (const s of SERIOUSNESS_TIERS) {
      expect(s.id).toMatch(/^seriousness\./);
      expect(typeof s.rank).toBe("number");
    }
    expect(ADVERSE_EVENT_RULES.length).toBe(4);
    expect(ADVERSE_EVENT_REASON_CODES.length).toBe(4);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const e of ADVERSE_EVENT_TYPES) {
      expect(isAdverseEventType(e.id)).toBe(true);
      expect(getAdverseEventType(e.id)?.label).toBe(e.label);
    }
    for (const s of SERIOUSNESS_TIERS) {
      expect(isSeriousnessTier(s.id)).toBe(true);
      expect(getSeriousnessTier(s.id)?.label).toBe(s.label);
    }
    for (const r of ADVERSE_EVENT_RULES) {
      expect(isAdverseEventRule(r.id)).toBe(true);
      expect(getAdverseEventRule(r.id)?.label).toBe(r.label);
    }
    expect(isAdverseEventType("event.made-up")).toBe(false);
    expect(isSeriousnessTier("seriousness.made-up")).toBe(false);
    expect(isAdverseEventRule("rule.made-up")).toBe(false);
    expect(isAdverseEventReasonCode("reason.AE-100")).toBe(true);
    expect(isAdverseEventReasonCode("reason.made-up")).toBe(false);
    expect(isReporterType("clinician")).toBe(true);
    expect(isReporterType("banana")).toBe(false);
  });
});

describe("computeSeriousnessTier", () => {
  it("returns non-serious when no outcome flag is set", () => {
    expect(computeSeriousnessTier({})).toBe("seriousness.non-serious");
  });
  it("returns serious for hospitalization / disability / birth defect / medically important", () => {
    expect(computeSeriousnessTier({ requiredHospitalization: true })).toBe(
      "seriousness.serious"
    );
    expect(computeSeriousnessTier({ causedDisability: true })).toBe(
      "seriousness.serious"
    );
    expect(computeSeriousnessTier({ medicallyImportant: true })).toBe(
      "seriousness.serious"
    );
  });
  it("returns life-threatening when flagged", () => {
    expect(
      computeSeriousnessTier({
        isLifeThreatening: true,
        requiredHospitalization: true
      })
    ).toBe("seriousness.life-threatening");
  });
  it("returns death (highest precedence)", () => {
    expect(
      computeSeriousnessTier({
        resultedInDeath: true,
        isLifeThreatening: true
      })
    ).toBe("seriousness.death");
  });
});

describe("evaluateAdverseEventRules", () => {
  it("fires medwatch-eligible for a drug ADR", () => {
    const rules = evaluateAdverseEventRules(DEMO_AE_MEDWATCH_DRUG);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.medwatch-eligible"]);
    expect(rules[0].reasonCode).toBe("reason.AE-100");
  });

  it("fires vaers-eligible for a vaccine reaction", () => {
    const rules = evaluateAdverseEventRules(DEMO_AE_VAERS_VACCINE);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.vaers-eligible"]);
    expect(rules[0].reasonCode).toBe("reason.AE-101");
  });

  it("fires reporter-unverified when identity not attested", () => {
    const rules = evaluateAdverseEventRules(DEMO_AE_UNVERIFIED_REPORTER);
    expect(rules.map((r) => r.ruleId)).toContain("rule.reporter-unverified");
  });

  it("fires non-catalog-event for an off-catalog event type", () => {
    const rules = evaluateAdverseEventRules({
      ...DEMO_AE_MEDWATCH_DRUG,
      eventTypeId: "event.made-up"
    });
    expect(rules.map((r) => r.ruleId)).toContain("rule.non-catalog-event");
    // Non-catalog blocks channel eligibility from firing (rules short-circuit).
    expect(rules.map((r) => r.ruleId)).not.toContain("rule.medwatch-eligible");
  });

  it("sorts applied rules by ruleId ascending", () => {
    // Off-catalog AND unverified reporter
    const rules = evaluateAdverseEventRules({
      ...DEMO_AE_UNVERIFIED_REPORTER,
      eventTypeId: "event.made-up"
    });
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("rule.reporter-unverified");
    expect(ids).toContain("rule.non-catalog-event");
  });
});

describe("summarizeAdverseEventDecision", () => {
  it("draft-medwatch when no rules (degenerate default)", () => {
    const s = summarizeAdverseEventDecision([]);
    expect(s.decision).toBe("draft-medwatch");
    expect(s.routedTo).toBe("regulatory-team-medwatch-queue");
  });

  it("blocked-reporter-unverified wins over blocked-non-catalog-event", () => {
    const rules = evaluateAdverseEventRules({
      ...DEMO_AE_UNVERIFIED_REPORTER,
      eventTypeId: "event.made-up"
    });
    const s = summarizeAdverseEventDecision(rules);
    expect(s.decision).toBe("blocked-reporter-unverified");
    expect(s.routedTo).toBe("blocked-hold");
  });

  it("draft-vaers routes to VAERS queue", () => {
    const rules = evaluateAdverseEventRules(DEMO_AE_VAERS_VACCINE);
    const s = summarizeAdverseEventDecision(rules);
    expect(s.decision).toBe("draft-vaers");
    expect(s.routedTo).toBe("regulatory-team-vaers-queue");
  });
});

describe("evaluateAdverseEvent", () => {
  it("is deterministic", () => {
    expect(evaluateAdverseEvent(DEMO_AE_MEDWATCH_DRUG)).toEqual(
      evaluateAdverseEvent(DEMO_AE_MEDWATCH_DRUG)
    );
  });

  it("drafts MedWatch with correct seriousness (serious)", () => {
    const d = evaluateAdverseEvent(DEMO_AE_MEDWATCH_DRUG);
    expect(d.decision).toBe("draft-medwatch");
    expect(d.seriousnessTierId).toBe("seriousness.serious");
    expect(d.requiresRegulatoryTeamCosign).toBe(true);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("regulatory-team-medwatch-queue");
  });

  it("drafts VAERS for a vaccine reaction", () => {
    const d = evaluateAdverseEvent(DEMO_AE_VAERS_VACCINE);
    expect(d.decision).toBe("draft-vaers");
    expect(d.routedTo).toBe("regulatory-team-vaers-queue");
  });

  it("computes life-threatening seriousness", () => {
    const d = evaluateAdverseEvent(DEMO_AE_DEATH_LIFE_THREATENING);
    expect(d.seriousnessTierId).toBe("seriousness.life-threatening");
  });

  it("blocks unverified reporter and requires no cosign", () => {
    const d = evaluateAdverseEvent(DEMO_AE_UNVERIFIED_REPORTER);
    expect(d.decision).toBe("blocked-reporter-unverified");
    expect(d.requiresRegulatoryTeamCosign).toBe(false);
    expect(d.routedTo).toBe("blocked-hold");
  });

  it("drafts MedWatch even for non-serious cases (voluntary 3500)", () => {
    const d = evaluateAdverseEvent(DEMO_AE_NON_SERIOUS);
    expect(d.decision).toBe("draft-medwatch");
    expect(d.seriousnessTierId).toBe("seriousness.non-serious");
  });
});

describe("governance signals", () => {
  const mw = evaluateAdverseEvent(DEMO_AE_MEDWATCH_DRUG);
  const vaers = evaluateAdverseEvent(DEMO_AE_VAERS_VACCINE);
  const unv = evaluateAdverseEvent(DEMO_AE_UNVERIFIED_REPORTER);

  it("eventsTraceToCatalog: true for produced decisions", () => {
    expect(eventsTraceToCatalog(mw)).toBe(true);
    expect(eventsTraceToCatalog(vaers)).toBe(true);
    expect(
      eventsTraceToCatalog({
        eventTypeId: "event.made-up",
        seriousnessTierId: "seriousness.non-serious",
        appliedRules: []
      })
    ).toBe(false);
    expect(
      eventsTraceToCatalog({
        ...mw,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.AE-100" }]
      })
    ).toBe(false);
    expect(eventsTraceToCatalog(null)).toBe(false);
  });

  it("submissionRequiresRegulatoryTeamCosign: true when properly gated / block, false when caller lies", () => {
    expect(submissionRequiresRegulatoryTeamCosign(mw)).toBe(true);
    expect(submissionRequiresRegulatoryTeamCosign(vaers)).toBe(true);
    // Blocked decisions trivially satisfy.
    expect(submissionRequiresRegulatoryTeamCosign(unv)).toBe(true);
    // Caller claims cosigned:true on a draft = lie.
    expect(
      submissionRequiresRegulatoryTeamCosign({
        ...mw,
        cosigned: true as unknown as false
      })
    ).toBe(false);
    expect(
      submissionRequiresRegulatoryTeamCosign({
        ...mw,
        requiresRegulatoryTeamCosign: false
      })
    ).toBe(false);
    expect(submissionRequiresRegulatoryTeamCosign(null)).toBe(false);
  });

  it("reporterIdentityVerified: true when verified / safely blocked, false when caller lies", () => {
    expect(reporterIdentityVerified(mw)).toBe(true);
    // Blocked-reporter-unverified is the SAFE path.
    expect(reporterIdentityVerified(unv)).toBe(true);
    // Caller claims draft-medwatch with unverified reporter = lie.
    expect(
      reporterIdentityVerified({
        decision: "draft-medwatch",
        reporterIdentityVerified: false
      })
    ).toBe(false);
    expect(reporterIdentityVerified(null)).toBe(false);
  });
});
