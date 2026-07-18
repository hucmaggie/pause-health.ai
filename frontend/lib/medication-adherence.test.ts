import { describe, expect, it } from "vitest";
import {
  AT_RISK_WINDOW_DAYS,
  MEDICATION_CATALOG,
  REFILL_LEAD_DAYS,
  adherenceDropOffs,
  assessAdherence,
  assessAllAdherence,
  draftAdherenceNudge,
  draftAdherenceNudges,
  getMedication,
  hasAdherenceDropOff,
  isCatalogMedication,
  isRefillDue,
  refillRequiresHumanApproval,
  DEMO_MEDICATION_RECORDS,
  type MedicationRecord
} from "./medication-adherence";

/**
 * Tests for lib/medication-adherence.ts — the deterministic adherence + refill
 * detector behind the Medication Adherence Agent. Assessment is a pure function
 * of an explicit as-of date + per-medication days-supply and last-fill (no
 * randomness, no clock), so the same inputs always produce the same result.
 * These pin determinism, the good / at-risk / lapsed status computation, refill
 * -due detection, the consent- and quiet-hours-aware nudge shape (human-
 * approval-gated / not sent / nudge-only), drop-off flagging, and the honest
 * no-autonomous-refill signal.
 */

const AS_OF = "2026-02-02";

describe("medication catalog", () => {
  it("exposes a non-empty catalog with stable ids and positive supplies", () => {
    expect(MEDICATION_CATALOG.length).toBeGreaterThan(0);
    for (const m of MEDICATION_CATALOG) {
      expect(m.id).toMatch(/^med\./);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.rationale.length).toBeGreaterThan(0);
      expect(m.defaultDaysSupply).toBeGreaterThan(0);
    }
  });

  it("includes transdermal + oral HRT and an SSRI/SNRI", () => {
    const classes = MEDICATION_CATALOG.map((m) => m.drugClass);
    expect(classes).toContain("hrt");
    expect(classes.some((c) => c === "ssri" || c === "snri")).toBe(true);
  });

  it("isCatalogMedication / getMedication agree with the catalog", () => {
    for (const m of MEDICATION_CATALOG) {
      expect(isCatalogMedication(m.id)).toBe(true);
      expect(getMedication(m.id)?.label).toBe(m.label);
    }
    expect(isCatalogMedication("med.totally-made-up")).toBe(false);
    expect(getMedication("med.totally-made-up")).toBeUndefined();
  });
});

describe("assessAdherence · determinism", () => {
  it("is deterministic — the same inputs yield the same assessment", () => {
    const med: MedicationRecord = {
      drug: "med.progesterone-oral",
      lastFilledDaysAgo: 27,
      onHrt: true
    };
    expect(assessAdherence(med, AS_OF)).toEqual(assessAdherence(med, AS_OF));
  });

  it("resolves lastFilledDaysAgo against the as-of date consistently", () => {
    const byOffset = assessAdherence(
      { drug: "med.paroxetine-ssri", lastFilledDaysAgo: 41 },
      AS_OF
    );
    // 41 days before 2026-02-02 is 2025-12-23.
    const byDate = assessAdherence(
      { drug: "med.paroxetine-ssri", lastFilled: "2025-12-23" },
      AS_OF
    );
    expect(byOffset.status).toBe(byDate.status);
    expect(byOffset.daysSinceFill).toBe(byDate.daysSinceFill);
    expect(byOffset.daysSinceFill).toBe(41);
  });
});

describe("assessAdherence · good / at-risk / lapsed status computation", () => {
  it("is good and not-yet-due when well within supply", () => {
    // 30-day supply, filled 10 days ago → on track, refill not due.
    const a = assessAdherence(
      { drug: "med.progesterone-oral", lastFilledDaysAgo: 10 },
      AS_OF
    );
    expect(a.status).toBe("good");
    expect(a.refillDue).toBe(false);
    expect(a.dropOff).toBe(false);
  });

  it("is good but refill-due as the supply window closes", () => {
    // 30-day supply, filled 25 days ago → still has supply (good) but within
    // the REFILL_LEAD_DAYS window → refill due.
    const a = assessAdherence(
      { drug: "med.progesterone-oral", lastFilledDaysAgo: 30 - REFILL_LEAD_DAYS + 1 },
      AS_OF
    );
    expect(a.status).toBe("good");
    expect(a.refillDue).toBe(true);
  });

  it("is at-risk for a short gap just past the supply window", () => {
    // 30-day supply, filled 38 days ago → 8 days past supply, within AT_RISK.
    const a = assessAdherence(
      { drug: "med.paroxetine-ssri", lastFilledDaysAgo: 30 + 8 },
      AS_OF
    );
    expect(a.status).toBe("at-risk");
    expect(a.refillDue).toBe(true);
    expect(a.dropOff).toBe(false);
  });

  it("is lapsed (a drop-off) for a long gap past the supply window", () => {
    // 30-day supply, filled 30 + AT_RISK_WINDOW_DAYS + 5 days ago → lapsed.
    const a = assessAdherence(
      {
        drug: "med.venlafaxine-snri",
        lastFilledDaysAgo: 30 + AT_RISK_WINDOW_DAYS + 5
      },
      AS_OF
    );
    expect(a.status).toBe("lapsed");
    expect(a.dropOff).toBe(true);
    expect(a.refillDue).toBe(true);
  });

  it("treats a never-filled medication as a lapse", () => {
    const a = assessAdherence({ drug: "med.paroxetine-ssri" }, AS_OF);
    expect(a.status).toBe("lapsed");
    expect(a.dropOff).toBe(true);
    expect(a.lastFilled).toBeNull();
    expect(a.daysSinceFill).toBeNull();
    expect(a.refillDue).toBe(true);
  });

  it("honors an explicit daysSupply override over the catalog default", () => {
    // Estradiol default supply is 84d; override to 30d makes 40d a lapse.
    const a = assessAdherence(
      { drug: "med.estradiol-transdermal", lastFilledDaysAgo: 40, daysSupply: 30 },
      AS_OF
    );
    expect(a.daysSupply).toBe(30);
    expect(a.status).not.toBe("good");
  });

  it("marks HRT medications onHrt by class and computes refillDueOn", () => {
    const a = assessAdherence(
      { drug: "med.estradiol-transdermal", lastFilled: "2026-01-01" },
      AS_OF
    );
    expect(a.onHrt).toBe(true);
    // 2026-01-01 + 84 days = 2026-03-26.
    expect(a.refillDueOn).toBe("2026-03-26");
  });
});

describe("refill-due detection + drop-off flagging", () => {
  it("isRefillDue reflects the assessment's refillDue", () => {
    const due = assessAdherence(
      { drug: "med.progesterone-oral", lastFilledDaysAgo: 29 },
      AS_OF
    );
    expect(isRefillDue(due)).toBe(true);
    const notDue = assessAdherence(
      { drug: "med.progesterone-oral", lastFilledDaysAgo: 5 },
      AS_OF
    );
    expect(isRefillDue(notDue)).toBe(false);
  });

  it("adherenceDropOffs / hasAdherenceDropOff surface only lapsed meds", () => {
    const assessments = assessAllAdherence(DEMO_MEDICATION_RECORDS, AS_OF);
    const drops = adherenceDropOffs(assessments);
    expect(hasAdherenceDropOff(assessments)).toBe(true);
    // The demo venlafaxine record (63d ago, 30d supply) is the lapsed one.
    expect(drops.map((d) => d.drug)).toContain("med.venlafaxine-snri");
    for (const d of drops) {
      expect(d.status).toBe("lapsed");
      expect(d.dropOff).toBe(true);
    }
  });

  it("the demo panel is a representative mix of statuses", () => {
    const statuses = assessAllAdherence(DEMO_MEDICATION_RECORDS, AS_OF).map(
      (a) => a.status
    );
    expect(statuses).toContain("good");
    expect(statuses).toContain("at-risk");
    expect(statuses).toContain("lapsed");
  });
});

describe("draftAdherenceNudge · consent- + quiet-hours-aware, nudge-only", () => {
  const [assessment] = assessAllAdherence(
    [{ drug: "med.progesterone-oral", lastFilledDaysAgo: 29 }],
    AS_OF
  );

  it("drafts a human-approval-gated, unsent, nudge-only message on the preferred channel", () => {
    const nudge = draftAdherenceNudge(assessment, {
      channel: "sms",
      hasContactConsent: true,
      quietHours: { start: "21:00", end: "08:00" }
    });
    expect(nudge.drug).toBe(assessment.drug);
    expect(nudge.channel).toBe("sms");
    expect(nudge.requiresHumanApproval).toBe(true);
    expect(nudge.sent).toBe(false);
    expect(nudge.nudgeOnly).toBe(true);
    expect(nudge.suppressedForNoConsent).toBe(false);
    expect(nudge.quietHoursRespected).toBe(true);
    expect(nudge.handoffTo).toBe("engagement-agent");
    // sms carries no subject line.
    expect(nudge.subject).toBeUndefined();
    // The body makes the nudge-only stance explicit.
    expect(nudge.body.toLowerCase()).toContain("can't order a refill");
  });

  it("email nudges carry a subject line", () => {
    const nudge = draftAdherenceNudge(assessment, {
      channel: "email",
      hasContactConsent: true
    });
    expect(nudge.channel).toBe("email");
    expect(typeof nudge.subject).toBe("string");
  });

  it("suppresses the nudge when the target has no contact consent", () => {
    const nudge = draftAdherenceNudge(assessment, { hasContactConsent: false });
    expect(nudge.suppressedForNoConsent).toBe(true);
    expect(nudge.sent).toBe(false);
    expect(nudge.nudgeOnly).toBe(true);
    expect(nudge.body.toLowerCase()).toContain("suppressed");
  });

  it("draftAdherenceNudges drafts only for meds due or off-track (not on-track)", () => {
    const assessments = assessAllAdherence(DEMO_MEDICATION_RECORDS, AS_OF);
    const nudges = draftAdherenceNudges(assessments, {
      channel: "sms",
      hasContactConsent: true
    });
    // The on-track estradiol (20d since fill, 84d supply, not due) is skipped.
    const drugsNudged = nudges.map((n) => n.drug);
    expect(drugsNudged).not.toContain("med.estradiol-transdermal");
    // The due / off-track ones are drafted.
    expect(drugsNudged).toContain("med.progesterone-oral");
    expect(drugsNudged).toContain("med.paroxetine-ssri");
    expect(drugsNudged).toContain("med.venlafaxine-snri");
    for (const n of nudges) {
      expect(n.requiresHumanApproval).toBe(true);
      expect(n.sent).toBe(false);
      expect(n.nudgeOnly).toBe(true);
    }
  });
});

describe("refillRequiresHumanApproval · nudge-only honesty signal", () => {
  it("is true for a nudge (or no action) — the only thing the agent does", () => {
    expect(refillRequiresHumanApproval()).toBe(true);
    expect(refillRequiresHumanApproval(null)).toBe(true);
    expect(refillRequiresHumanApproval({ kind: "nudge" })).toBe(true);
  });

  it("is false for an autonomous submit-refill (no human approval)", () => {
    expect(refillRequiresHumanApproval({ kind: "submit-refill" })).toBe(false);
    expect(
      refillRequiresHumanApproval({ kind: "submit-refill", humanApproved: false })
    ).toBe(false);
  });

  it("is true for a human-approved submit-refill", () => {
    expect(
      refillRequiresHumanApproval({ kind: "submit-refill", humanApproved: true })
    ).toBe(true);
  });
});
