import { describe, expect, it } from "vitest";

import {
  ageBandLowerBound,
  draftNurtureTouch,
  isInIcp,
  leadToIntake,
  qualifyLead,
  screenInboundLead,
  type FunnelLead
} from "./agent-funnel";

const readyLead: FunnelLead = {
  source: "web-chat",
  ageBand: "46-50",
  primarySymptom: "vasomotor",
  cycleStatus: "irregular",
  preferredName: "Casey",
  consentOptIn: true
};

const warmingLead: FunnelLead = {
  source: "content-download",
  ageBand: "51-55",
  primarySymptom: "sleep",
  consentOptIn: true
};

const outOfIcpLead: FunnelLead = {
  source: "web-chat",
  ageBand: "<40",
  primarySymptom: "vasomotor",
  consentOptIn: true
};

describe("ageBandLowerBound", () => {
  it("parses the lower bound of a band", () => {
    expect(ageBandLowerBound("46-50")).toBe(46);
    expect(ageBandLowerBound("51-55")).toBe(51);
  });
  it("returns undefined for an unparseable band", () => {
    expect(ageBandLowerBound(undefined)).toBeUndefined();
    expect(ageBandLowerBound("nope")).toBeUndefined();
  });
});

describe("isInIcp", () => {
  it("is true for a midlife band with a recognized symptom", () => {
    expect(isInIcp(readyLead)).toBe(true);
  });
  it("is false under 40 even with a symptom", () => {
    expect(isInIcp(outOfIcpLead)).toBe(false);
  });
  it("is false with no recognized symptom", () => {
    expect(isInIcp({ ageBand: "46-50" })).toBe(false);
    expect(isInIcp({ ageBand: "46-50", primarySymptom: "toothache" })).toBe(false);
  });
});

describe("screenInboundLead", () => {
  it("scores a high-intent consented ICP lead as ready", () => {
    const screen = screenInboundLead(readyLead);
    expect(screen.icpMatch).toBe(true);
    expect(screen.readiness).toBe("ready");
    expect(screen.leadScore).toBeGreaterThanOrEqual(70);
  });
  it("scores a lower-intent consented ICP lead as warming (qualified, not ready)", () => {
    const screen = screenInboundLead(warmingLead);
    expect(screen.icpMatch).toBe(true);
    expect(screen.readiness).toBe("warming");
    expect(screen.leadScore).toBeGreaterThanOrEqual(55);
    expect(screen.leadScore).toBeLessThan(70);
  });
});

describe("qualifyLead", () => {
  it("routes a ready lead to intake", () => {
    const d = qualifyLead(readyLead, screenInboundLead(readyLead));
    expect(d.decision).toBe("qualified");
    expect(d.route).toBe("intake");
    expect(d.rationale.length).toBeGreaterThan(0);
    expect(d.protectedClassUsed).toBe(false);
  });
  it("routes a warming lead to nurture", () => {
    const d = qualifyLead(warmingLead, screenInboundLead(warmingLead));
    expect(d.decision).toBe("qualified");
    expect(d.route).toBe("nurture");
  });
  it("disqualifies an out-of-ICP lead", () => {
    const d = qualifyLead(outOfIcpLead, screenInboundLead(outOfIcpLead));
    expect(d.decision).toBe("disqualified");
    expect(d.route).toBe("none");
    expect(d.rationale.length).toBeGreaterThan(0);
  });
});

describe("draftNurtureTouch", () => {
  it("always drafts (human-approval-required, never sent)", () => {
    const t = draftNurtureTouch(warmingLead);
    expect(t.humanApprovalRequired).toBe(true);
    expect(t.sent).toBe(false);
    expect(t.channel).toBe("email");
    expect(t.touch).toBe(1);
  });
  it("uses SMS for a phone-first source", () => {
    expect(draftNurtureTouch({ source: "symptom-check-form" }).channel).toBe("sms");
  });
});

describe("leadToIntake", () => {
  it("always sets a red-flag screen field and maps structured fields", () => {
    const intake = leadToIntake(readyLead);
    expect(intake.redFlagsAcknowledged).toBe("no");
    expect(intake.severity).toBe("moderate");
    expect(intake.ageBand).toBe("46-50");
    expect(intake.primarySymptom).toBe("vasomotor");
    expect(intake.preferredName).toBe("Casey");
  });
});
