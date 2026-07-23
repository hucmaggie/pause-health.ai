import { describe, expect, it } from "vitest";
import {
  DATA_SHARING_REASON_CODES,
  DATA_SHARING_RULES,
  DEMO_DS_NON_TPO_CONSENTED,
  DEMO_DS_NON_TPO_NO_CONSENT,
  DEMO_DS_PATIENT_ACCESS,
  DEMO_DS_TPO_TREATMENT,
  DEMO_DS_UNVERIFIED_PARTICIPANT,
  EXCHANGE_NETWORKS,
  EXCHANGE_PURPOSES,
  evaluateDataSharing,
  evaluateDataSharingRules,
  getDataSharingRule,
  getExchangeNetwork,
  getExchangePurpose,
  isDataSharingReasonCode,
  isDataSharingRule,
  isExchangeNetwork,
  isExchangePurpose,
  participantIdentityVerified,
  purposesTraceToCatalog,
  releaseHonorsNonTpoConsent,
  summarizeDataSharingDecision
} from "./data-sharing-tefca";

describe("catalogs", () => {
  it("exposes network + purpose + rule + reason catalogs", () => {
    expect(EXCHANGE_NETWORKS.length).toBe(4);
    for (const n of EXCHANGE_NETWORKS) {
      expect(n.id).toMatch(/^network\./);
    }
    expect(EXCHANGE_PURPOSES.length).toBe(6);
    for (const p of EXCHANGE_PURPOSES) {
      expect(p.id).toMatch(/^purpose\./);
      expect(typeof p.isTpo).toBe("boolean");
    }
    expect(DATA_SHARING_RULES.length).toBe(5);
    expect(DATA_SHARING_REASON_CODES.length).toBe(5);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const n of EXCHANGE_NETWORKS) {
      expect(isExchangeNetwork(n.id)).toBe(true);
      expect(getExchangeNetwork(n.id)?.label).toBe(n.label);
    }
    for (const p of EXCHANGE_PURPOSES) {
      expect(isExchangePurpose(p.id)).toBe(true);
      expect(getExchangePurpose(p.id)?.label).toBe(p.label);
    }
    for (const r of DATA_SHARING_RULES) {
      expect(isDataSharingRule(r.id)).toBe(true);
      expect(getDataSharingRule(r.id)?.label).toBe(r.label);
    }
    expect(isExchangeNetwork("network.made-up")).toBe(false);
    expect(isExchangePurpose("purpose.made-up")).toBe(false);
    expect(isDataSharingRule("rule.made-up")).toBe(false);
    expect(isDataSharingReasonCode("reason.DS-100")).toBe(true);
    expect(isDataSharingReasonCode("reason.made-up")).toBe(false);
  });

  it("marks the three HIPAA §164.506 TPO purposes as isTpo", () => {
    expect(getExchangePurpose("purpose.treatment")!.isTpo).toBe(true);
    expect(getExchangePurpose("purpose.payment")!.isTpo).toBe(true);
    expect(getExchangePurpose("purpose.operations")!.isTpo).toBe(true);
    expect(getExchangePurpose("purpose.research")!.isTpo).toBe(false);
    expect(getExchangePurpose("purpose.public-health")!.isTpo).toBe(false);
    expect(getExchangePurpose("purpose.patient-request")!.isTpo).toBe(false);
  });
});

describe("evaluateDataSharingRules", () => {
  it("fires tpo-release-authorized for treatment", () => {
    const rules = evaluateDataSharingRules(DEMO_DS_TPO_TREATMENT);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.tpo-release-authorized"]);
    expect(rules[0].reasonCode).toBe("reason.DS-100");
  });

  it("fires non-tpo-consented-release for research with consent", () => {
    const rules = evaluateDataSharingRules(DEMO_DS_NON_TPO_CONSENTED);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.non-tpo-consented-release"]);
    expect(rules[0].reasonCode).toBe("reason.DS-101");
  });

  it("fires non-tpo-consent-missing for research without consent", () => {
    const rules = evaluateDataSharingRules(DEMO_DS_NON_TPO_NO_CONSENT);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.non-tpo-consent-missing"]);
    expect(rules[0].reasonCode).toBe("reason.DS-200");
  });

  it("fires participant-unverified when identity not attested (short-circuits purpose branch)", () => {
    const rules = evaluateDataSharingRules(DEMO_DS_UNVERIFIED_PARTICIPANT);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.participant-unverified"]);
    expect(rules[0].reasonCode).toBe("reason.DS-400");
  });

  it("fires non-catalog-purpose for an off-catalog purpose", () => {
    const rules = evaluateDataSharingRules({
      ...DEMO_DS_TPO_TREATMENT,
      purposeId: "purpose.made-up"
    });
    expect(rules.map((r) => r.ruleId)).toContain("rule.non-catalog-purpose");
  });

  it("sorts applied rules by ruleId ascending", () => {
    // Unverified AND off-catalog
    const rules = evaluateDataSharingRules({
      ...DEMO_DS_UNVERIFIED_PARTICIPANT,
      purposeId: "purpose.made-up"
    });
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("rule.participant-unverified");
    expect(ids).toContain("rule.non-catalog-purpose");
  });
});

describe("summarizeDataSharingDecision", () => {
  it("pends when no rules fire (degenerate case)", () => {
    const s = summarizeDataSharingDecision([]);
    expect(s.decision).toBe("pend-purpose-verification");
    expect(s.routedTo).toBe("privacy-officer-review");
  });

  it("participant-unverified wins over non-catalog-purpose", () => {
    const rules = evaluateDataSharingRules({
      ...DEMO_DS_UNVERIFIED_PARTICIPANT,
      purposeId: "purpose.made-up"
    });
    const s = summarizeDataSharingDecision(rules);
    expect(s.decision).toBe("blocked-participant-unverified");
    expect(s.routedTo).toBe("participant-registry-verification");
  });

  it("blocked-consent-required-non-tpo routes to consent-capture", () => {
    const rules = evaluateDataSharingRules(DEMO_DS_NON_TPO_NO_CONSENT);
    const s = summarizeDataSharingDecision(rules);
    expect(s.decision).toBe("blocked-consent-required-non-tpo");
    expect(s.routedTo).toBe("consent-capture");
  });
});

describe("evaluateDataSharing", () => {
  it("is deterministic", () => {
    expect(evaluateDataSharing(DEMO_DS_TPO_TREATMENT)).toEqual(
      evaluateDataSharing(DEMO_DS_TPO_TREATMENT)
    );
  });

  it("authorizes a TPO release with isTpo=true", () => {
    const d = evaluateDataSharing(DEMO_DS_TPO_TREATMENT);
    expect(d.decision).toBe("release-authorized");
    expect(d.isTpo).toBe(true);
    expect(d.requiresPrivacyOfficerCosign).toBe(false);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("auto-release");
  });

  it("authorizes a non-TPO release when consent is on file", () => {
    const d = evaluateDataSharing(DEMO_DS_NON_TPO_CONSENTED);
    expect(d.decision).toBe("release-authorized");
    expect(d.isTpo).toBe(false);
    expect(d.primaryReasonCode).toBe("reason.DS-101");
  });

  it("blocks a non-TPO release without consent", () => {
    const d = evaluateDataSharing(DEMO_DS_NON_TPO_NO_CONSENT);
    expect(d.decision).toBe("blocked-consent-required-non-tpo");
    expect(d.routedTo).toBe("consent-capture");
  });

  it("blocks an unverified participant", () => {
    const d = evaluateDataSharing(DEMO_DS_UNVERIFIED_PARTICIPANT);
    expect(d.decision).toBe("blocked-participant-unverified");
    expect(d.routedTo).toBe("participant-registry-verification");
  });

  it("authorizes patient-request when patient consent is on file", () => {
    const d = evaluateDataSharing(DEMO_DS_PATIENT_ACCESS);
    expect(d.decision).toBe("release-authorized");
    expect(d.primaryReasonCode).toBe("reason.DS-101");
  });
});

describe("governance signals", () => {
  const tpo = evaluateDataSharing(DEMO_DS_TPO_TREATMENT);
  const nonTpoOk = evaluateDataSharing(DEMO_DS_NON_TPO_CONSENTED);
  const nonTpoMiss = evaluateDataSharing(DEMO_DS_NON_TPO_NO_CONSENT);
  const unv = evaluateDataSharing(DEMO_DS_UNVERIFIED_PARTICIPANT);

  it("purposesTraceToCatalog: true for produced decisions", () => {
    expect(purposesTraceToCatalog(tpo)).toBe(true);
    expect(purposesTraceToCatalog(nonTpoOk)).toBe(true);
    expect(purposesTraceToCatalog(nonTpoMiss)).toBe(true);
    // Unverified participant fires only participant-unverified — still catalog-sourced.
    expect(purposesTraceToCatalog(unv)).toBe(true);
    expect(
      purposesTraceToCatalog({
        purposeId: "purpose.made-up",
        networkId: "network.tefca-qhin",
        appliedRules: []
      })
    ).toBe(false);
    expect(
      purposesTraceToCatalog({
        ...tpo,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.DS-100" }]
      })
    ).toBe(false);
    expect(purposesTraceToCatalog(null)).toBe(false);
  });

  it("releaseHonorsNonTpoConsent: true for TPO / non-TPO-consented / safely blocked, false when caller lies", () => {
    expect(releaseHonorsNonTpoConsent(tpo)).toBe(true); // TPO release
    expect(releaseHonorsNonTpoConsent(nonTpoOk)).toBe(true); // consented non-TPO
    expect(releaseHonorsNonTpoConsent(nonTpoMiss)).toBe(true); // safely blocked
    expect(releaseHonorsNonTpoConsent(unv)).toBe(true); // no release happened
    // Caller claims release-authorized for research without consent = lie.
    expect(
      releaseHonorsNonTpoConsent({
        decision: "release-authorized",
        purposeId: "purpose.research",
        isTpo: false,
        consentedPurposeIds: []
      })
    ).toBe(false);
    expect(releaseHonorsNonTpoConsent(null)).toBe(false);
  });

  it("participantIdentityVerified: true when verified / safely blocked, false when caller lies", () => {
    expect(participantIdentityVerified(tpo)).toBe(true);
    expect(participantIdentityVerified(nonTpoOk)).toBe(true);
    // Blocked-participant-unverified is the SAFE path.
    expect(participantIdentityVerified(unv)).toBe(true);
    // Caller claims release-authorized with unverified requester = lie.
    expect(
      participantIdentityVerified({
        decision: "release-authorized",
        requesterIdentityVerified: false
      })
    ).toBe(false);
    expect(participantIdentityVerified(null)).toBe(false);
  });
});
