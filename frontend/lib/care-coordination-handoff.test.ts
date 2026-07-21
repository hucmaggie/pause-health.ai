import { describe, expect, it } from "vitest";
import {
  CARE_SETTINGS,
  DEMO_HANDOFF_ACCEPTED,
  DEMO_HANDOFF_ED_TO_PCP,
  DEMO_HANDOFF_NO_CONSENT,
  DEMO_HANDOFF_SBAR_INCOMPLETE,
  DEMO_HANDOFF_UNCREDENTIALED,
  HANDOFF_REASON_CODES,
  HANDOFF_RULES,
  SBAR_SECTIONS,
  TRANSITION_TYPES,
  evaluateHandoff,
  evaluateHandoffRules,
  getCareSetting,
  getHandoffRule,
  getTransitionType,
  handoffHasConsent,
  isCareSetting,
  isCredentialingStatus,
  isHandoffReasonCode,
  isHandoffRule,
  isTransitionType,
  missingSbarSections,
  receivingClinicianIsCredentialed,
  sbarIsComplete,
  summarizeHandoffDecision
} from "./care-coordination-handoff";

describe("catalogs", () => {
  it("exposes setting + transition + rule + reason catalogs", () => {
    expect(CARE_SETTINGS.length).toBe(8);
    for (const s of CARE_SETTINGS) {
      expect(s.id).toMatch(/^setting\./);
      expect(s.synthetic).toBe(true);
    }
    expect(TRANSITION_TYPES.length).toBe(6);
    for (const t of TRANSITION_TYPES) {
      expect(t.id).toMatch(/^transition\./);
      expect(isCareSetting(t.sendingSettingId)).toBe(true);
      expect(isCareSetting(t.receivingSettingId)).toBe(true);
    }
    expect(HANDOFF_RULES.length).toBe(4);
    expect(HANDOFF_REASON_CODES.length).toBe(4);
    expect(SBAR_SECTIONS).toEqual([
      "situation",
      "background",
      "assessment",
      "recommendation"
    ]);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const s of CARE_SETTINGS) {
      expect(isCareSetting(s.id)).toBe(true);
      expect(getCareSetting(s.id)?.label).toBe(s.label);
    }
    for (const t of TRANSITION_TYPES) {
      expect(isTransitionType(t.id)).toBe(true);
      expect(getTransitionType(t.id)?.label).toBe(t.label);
    }
    for (const r of HANDOFF_RULES) {
      expect(isHandoffRule(r.id)).toBe(true);
      expect(getHandoffRule(r.id)?.label).toBe(r.label);
    }
    expect(isCareSetting("setting.made-up")).toBe(false);
    expect(isTransitionType("transition.made-up")).toBe(false);
    expect(isHandoffRule("rule.made-up")).toBe(false);
    expect(isHandoffReasonCode("reason.HO-100")).toBe(true);
    expect(isHandoffReasonCode("reason.made-up")).toBe(false);
    expect(isCredentialingStatus("current-unsanctioned")).toBe(true);
    expect(isCredentialingStatus("banana")).toBe(false);
  });
});

describe("missingSbarSections", () => {
  it("returns empty when all four sections populated", () => {
    expect(
      missingSbarSections({
        situation: "s",
        background: "b",
        assessment: "a",
        recommendation: "r"
      })
    ).toEqual([]);
  });
  it("returns each empty / missing section", () => {
    const missing = [...missingSbarSections({ situation: "s", background: "" })].sort();
    expect(missing).toEqual(["assessment", "background", "recommendation"]);
  });
});

describe("evaluateHandoffRules", () => {
  it("fires sbar-complete for a full accepted handoff", () => {
    const rules = evaluateHandoffRules(DEMO_HANDOFF_ACCEPTED);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.sbar-complete"]);
    expect(rules[0].reasonCode).toBe("reason.HO-100");
  });

  it("fires sbar-incomplete when sections are blank", () => {
    const rules = evaluateHandoffRules(DEMO_HANDOFF_SBAR_INCOMPLETE);
    expect(rules.map((r) => r.ruleId)).toContain("rule.sbar-incomplete");
  });

  it("fires clinician-not-credentialed when receiving credentialing is expired", () => {
    const rules = evaluateHandoffRules(DEMO_HANDOFF_UNCREDENTIALED);
    expect(rules.map((r) => r.ruleId)).toContain("rule.clinician-not-credentialed");
  });

  it("fires transfer-consent-missing when transition requires it and none on file", () => {
    const rules = evaluateHandoffRules(DEMO_HANDOFF_NO_CONSENT);
    expect(rules.map((r) => r.ruleId)).toContain("rule.transfer-consent-missing");
  });

  it("does NOT require consent for transitions that don't require it (ED→PCP)", () => {
    const rules = evaluateHandoffRules(DEMO_HANDOFF_ED_TO_PCP);
    expect(rules.map((r) => r.ruleId)).not.toContain("rule.transfer-consent-missing");
  });

  it("sorts applied rules by ruleId ascending", () => {
    // Uncredentialed AND missing consent AND missing SBAR
    const rules = evaluateHandoffRules({
      ...DEMO_HANDOFF_NO_CONSENT,
      receivingClinicianCredentialing: "expired",
      sbar: { situation: "s" }
    });
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("rule.transfer-consent-missing");
    expect(ids).toContain("rule.clinician-not-credentialed");
    expect(ids).toContain("rule.sbar-incomplete");
  });
});

describe("summarizeHandoffDecision", () => {
  it("handoff-accepted when no rules", () => {
    const s = summarizeHandoffDecision([]);
    expect(s.decision).toBe("handoff-accepted");
    expect(s.routedTo).toBe("receiving-clinician-inbox");
  });

  it("blocked-no-consent wins over blocked-clinician-not-credentialed", () => {
    const rules = [
      {
        ruleId: "rule.clinician-not-credentialed",
        ruleLabel: "x",
        reasonCode: "reason.HO-300",
        reasonLabel: "y",
        detail: "z"
      },
      {
        ruleId: "rule.transfer-consent-missing",
        ruleLabel: "x",
        reasonCode: "reason.HO-400",
        reasonLabel: "y",
        detail: "z"
      }
    ];
    const s = summarizeHandoffDecision(rules);
    expect(s.decision).toBe("blocked-no-consent");
    expect(s.routedTo).toBe("consent-capture");
  });

  it("blocked-clinician-not-credentialed wins over pend-sbar-incomplete", () => {
    const rules = evaluateHandoffRules({
      ...DEMO_HANDOFF_UNCREDENTIALED,
      sbar: { situation: "s" } // missing 3 sections
    });
    const s = summarizeHandoffDecision(rules);
    expect(s.decision).toBe("blocked-clinician-not-credentialed");
    expect(s.routedTo).toBe("credentialing-remediation");
  });
});

describe("evaluateHandoff", () => {
  it("is deterministic", () => {
    expect(evaluateHandoff(DEMO_HANDOFF_ACCEPTED)).toEqual(
      evaluateHandoff(DEMO_HANDOFF_ACCEPTED)
    );
  });

  it("accepts a complete-SBAR + credentialed + consented handoff", () => {
    const d = evaluateHandoff(DEMO_HANDOFF_ACCEPTED);
    expect(d.decision).toBe("handoff-accepted");
    expect(d.missingSbarSections).toEqual([]);
    expect(d.requiresReceivingClinicianCosign).toBe(true);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("receiving-clinician-inbox");
  });

  it("pends an incomplete SBAR handoff to sending-clinician-completion", () => {
    const d = evaluateHandoff(DEMO_HANDOFF_SBAR_INCOMPLETE);
    expect(d.decision).toBe("pend-sbar-incomplete");
    expect(d.missingSbarSections).toEqual(["assessment", "recommendation"]);
    expect(d.routedTo).toBe("sending-clinician-completion");
  });

  it("blocks an uncredentialed receiving clinician", () => {
    const d = evaluateHandoff(DEMO_HANDOFF_UNCREDENTIALED);
    expect(d.decision).toBe("blocked-clinician-not-credentialed");
    expect(d.routedTo).toBe("credentialing-remediation");
  });

  it("blocks a consent-required transition without consent", () => {
    const d = evaluateHandoff(DEMO_HANDOFF_NO_CONSENT);
    expect(d.decision).toBe("blocked-no-consent");
    expect(d.routedTo).toBe("consent-capture");
  });

  it("accepts an ED→PCP handoff even without transfer consent", () => {
    const d = evaluateHandoff(DEMO_HANDOFF_ED_TO_PCP);
    expect(d.decision).toBe("handoff-accepted");
  });
});

describe("governance signals", () => {
  const accepted = evaluateHandoff(DEMO_HANDOFF_ACCEPTED);
  const pend = evaluateHandoff(DEMO_HANDOFF_SBAR_INCOMPLETE);
  const uncred = evaluateHandoff(DEMO_HANDOFF_UNCREDENTIALED);
  const nocon = evaluateHandoff(DEMO_HANDOFF_NO_CONSENT);
  const edpcp = evaluateHandoff(DEMO_HANDOFF_ED_TO_PCP);

  it("sbarIsComplete: true for produced decisions", () => {
    expect(sbarIsComplete(accepted)).toBe(true);
    // Pend is the SAFE path — the agent surfaced the gap.
    expect(sbarIsComplete(pend)).toBe(true);
    expect(sbarIsComplete(uncred)).toBe(true); // full SBAR on this fixture
    // A handoff-accepted claim with missing sections is a lie.
    expect(
      sbarIsComplete({
        decision: "handoff-accepted",
        missingSbarSections: ["recommendation"]
      })
    ).toBe(false);
    expect(sbarIsComplete(null)).toBe(false);
  });

  it("receivingClinicianIsCredentialed: true when credentialed OR safely blocked", () => {
    expect(receivingClinicianIsCredentialed(accepted)).toBe(true);
    expect(receivingClinicianIsCredentialed(pend)).toBe(true);
    // Blocked-clinician-not-credentialed is the SAFE path.
    expect(receivingClinicianIsCredentialed(uncred)).toBe(true);
    // Caller claims accepted while credentialing is expired = lie.
    expect(
      receivingClinicianIsCredentialed({
        decision: "handoff-accepted",
        receivingClinicianCredentialing: "expired"
      })
    ).toBe(false);
    expect(receivingClinicianIsCredentialed(null)).toBe(false);
  });

  it("handoffHasConsent: true when consented / not-required / safely blocked, false when caller lies", () => {
    expect(handoffHasConsent(accepted)).toBe(true);
    expect(handoffHasConsent(pend)).toBe(true);
    // Blocked-no-consent is the SAFE path.
    expect(handoffHasConsent(nocon)).toBe(true);
    // ED→PCP doesn't require consent.
    expect(handoffHasConsent(edpcp)).toBe(true);
    // Caller claims handoff-accepted for a consent-required transition without consent = lie.
    expect(
      handoffHasConsent({
        decision: "handoff-accepted",
        transitionTypeId: "transition.home-to-hospice",
        transferConsentOnFile: false
      })
    ).toBe(false);
    expect(handoffHasConsent(null)).toBe(false);
  });
});
