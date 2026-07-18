import { describe, expect, it } from "vitest";
import {
  REFERRAL_SPECIALTIES,
  type ReferralTriageContext,
  DEMO_REFERRAL_CONTEXT,
  draftReferral,
  draftReferrals,
  getReferralSpecialty,
  isCatalogSpecialty,
  referralHasClinicianCosign,
  referralsTraceToSpecialty,
  specialtyIdsForReferrals,
  triageReferrals
} from "./referrals";

/**
 * Tests for lib/referrals.ts — the deterministic referral triage + draft engine
 * behind the Referral Management Agent. Triage is a pure function of the intake
 * + routing context (no randomness, no clock), so the same context always yields
 * the same recommendations. These pin determinism, triage from representative
 * contexts (each recommended referral references a catalog specialty + a reason),
 * the cosign-gated draft shape (not sent), off-catalog rejection, and the honest
 * clinician-cosign signal.
 */

describe("referral specialty catalog", () => {
  it("exposes a non-empty catalog with stable ids and triggers", () => {
    expect(REFERRAL_SPECIALTIES.length).toBeGreaterThan(0);
    for (const s of REFERRAL_SPECIALTIES) {
      expect(s.id).toMatch(/^referral\./);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.typicalTrigger.length).toBeGreaterThan(0);
    }
  });

  it("includes the adjacent menopause specialties", () => {
    const ids = REFERRAL_SPECIALTIES.map((s) => s.id);
    expect(ids).toContain("referral.cardiology");
    expect(ids).toContain("referral.endocrinology");
    expect(ids).toContain("referral.bone-health");
    expect(ids).toContain("referral.pelvic-floor-pt");
    expect(ids).toContain("referral.behavioral-health");
  });

  it("isCatalogSpecialty / getReferralSpecialty agree with the catalog", () => {
    for (const s of REFERRAL_SPECIALTIES) {
      expect(isCatalogSpecialty(s.id)).toBe(true);
      expect(getReferralSpecialty(s.id)?.label).toBe(s.label);
    }
    expect(isCatalogSpecialty("referral.totally-made-up")).toBe(false);
    expect(getReferralSpecialty("referral.totally-made-up")).toBeUndefined();
  });
});

describe("triageReferrals · determinism + representative contexts", () => {
  it("is deterministic — the same context yields the same recommendations", () => {
    expect(triageReferrals(DEMO_REFERRAL_CONTEXT)).toEqual(
      triageReferrals(DEMO_REFERRAL_CONTEXT)
    );
  });

  it("every recommended referral references a catalog specialty + a reason", () => {
    const recs = triageReferrals(DEMO_REFERRAL_CONTEXT);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(isCatalogSpecialty(r.specialtyId)).toBe(true);
      expect(r.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("routes a red-flag mood signal to behavioral health (urgent) — the router-handoff generalization", () => {
    const recs = triageReferrals({
      primarySymptom: "mood",
      severity: "severe",
      redFlagsAcknowledged: "yes",
      routedPathway: "behavioral-health-handoff"
    });
    const bh = recs.find((r) => r.specialtyId === "referral.behavioral-health");
    expect(bh).toBeDefined();
    expect(bh!.priority).toBe("urgent");
  });

  it("routes an osteoporosis / high-fracture-risk flag to bone health", () => {
    const recs = triageReferrals({ riskFlags: { osteoporosisRisk: true } });
    expect(recs.map((r) => r.specialtyId)).toContain("referral.bone-health");
  });

  it("routes high cholesterol / CVD signals to cardiology", () => {
    const recs = triageReferrals({ riskFlags: { highCholesterol: true } });
    expect(recs.map((r) => r.specialtyId)).toContain("referral.cardiology");
  });

  it("routes GSM / pelvic-floor dysfunction to pelvic-floor PT", () => {
    const recs = triageReferrals({ primarySymptom: "gsm" });
    expect(recs.map((r) => r.specialtyId)).toContain("referral.pelvic-floor-pt");
  });

  it("routes menopause-pattern symptoms under 40 to endocrinology (POI workup)", () => {
    const recs = triageReferrals({ ageBand: "<40", cycleStatus: "irregular" });
    expect(recs.map((r) => r.specialtyId)).toContain("referral.endocrinology");
  });

  it("recommends no referral when nothing is indicated", () => {
    const ctx: ReferralTriageContext = {
      ageBand: "46-50",
      cycleStatus: "irregular",
      primarySymptom: "hot_flashes",
      severity: "mild"
    };
    expect(triageReferrals(ctx)).toEqual([]);
  });
});

describe("referralsTraceToSpecialty · integrity guard", () => {
  it("is true for everything triageReferrals produces", () => {
    expect(referralsTraceToSpecialty(triageReferrals(DEMO_REFERRAL_CONTEXT))).toBe(
      true
    );
  });

  it("rejects an off-catalog (fabricated) referral", () => {
    expect(
      referralsTraceToSpecialty([
        { specialtyId: "referral.made-up", reason: "invented" }
      ])
    ).toBe(false);
  });

  it("rejects a reasonless referral", () => {
    expect(
      referralsTraceToSpecialty([
        { specialtyId: "referral.cardiology", reason: "" }
      ])
    ).toBe(false);
  });

  it("specialtyIdsForReferrals keeps only catalog ids", () => {
    const ids = specialtyIdsForReferrals([
      { specialtyId: "referral.cardiology" },
      { specialtyId: "referral.made-up" }
    ]);
    expect(ids).toEqual(["referral.cardiology"]);
  });
});

describe("draftReferral · cosign-gated, never sent", () => {
  const [rec] = triageReferrals({ riskFlags: { osteoporosisRisk: true } });

  it("drafts a cosign-gated, unsent referral that references its specialty", () => {
    const referral = draftReferral(rec);
    expect(referral.specialtyId).toBe(rec.specialtyId);
    expect(referral.requiresClinicianCosign).toBe(true);
    expect(referral.status).toBe("drafted");
    expect(referral.sent).toBe(false);
    expect(referral.reason.trim().length).toBeGreaterThan(0);
    // The body makes the cosign-gated stance explicit.
    expect(referral.body.toLowerCase()).toContain("sign-off");
  });

  it("draftReferrals drafts a cosign-gated referral for every recommendation", () => {
    const recs = triageReferrals(DEMO_REFERRAL_CONTEXT);
    const referrals = draftReferrals(recs);
    expect(referrals.length).toBe(recs.length);
    for (const r of referrals) {
      expect(r.requiresClinicianCosign).toBe(true);
      expect(r.status).toBe("drafted");
      expect(r.sent).toBe(false);
    }
  });
});

describe("referralHasClinicianCosign · cosign-gated honesty signal", () => {
  it("is true for a draft (or no action) — the only thing the agent does", () => {
    expect(referralHasClinicianCosign()).toBe(true);
    expect(referralHasClinicianCosign(null)).toBe(true);
    expect(referralHasClinicianCosign({ kind: "draft" })).toBe(true);
  });

  it("is false for an autonomous send (no clinician cosign)", () => {
    expect(referralHasClinicianCosign({ kind: "send" })).toBe(false);
    expect(
      referralHasClinicianCosign({ kind: "send", clinicianCosigned: false })
    ).toBe(false);
  });

  it("is true for a clinician-cosigned send", () => {
    expect(
      referralHasClinicianCosign({ kind: "send", clinicianCosigned: true })
    ).toBe(true);
  });
});
