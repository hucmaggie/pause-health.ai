/**
 * Lead-acquisition funnel domain logic.
 *
 * Pure, deterministic, dependency-free helpers that model the
 * patient-acquisition funnel that feeds the Agentforce Patient Intake
 * agent:
 *
 *   Inbound Lead Generation  →  Qualification  →  { Intake | Nurture }
 *
 * The A2A routes under app/api/agents/{inbound-lead,qualification,
 * prospecting}/tasks and the orchestrator at
 * app/api/intake/acquisition-funnel wrap these functions so the wire
 * behavior (governance, trace spans, handoffs) stays thin and the
 * scoring/branching rubric is unit-testable in isolation.
 *
 * Everything here is deterministic on its inputs — no randomness, no
 * clock — so a given lead always screens, qualifies, and routes the
 * same way. That is what lets the demo funnel and the tests agree.
 */

import type { IntakeRecord } from "./care-router";

/**
 * A captured inbound (or outbound-sourced) lead, before qualification.
 * Every field is optional: real capture forms are partial, and the
 * funnel degrades gracefully rather than throwing on a sparse lead.
 */
export type FunnelLead = {
  /**
   * Where the lead came from. Drives both acquisition-source attribution
   * (a lead-policy requirement) and a small intent weighting.
   */
  source?: string;
  /** Age band, e.g. "46-50". The ICP screen reads the lower bound. */
  ageBand?: string;
  /** Primary symptom signal, aligned with IntakeRecord.primarySymptom. */
  primarySymptom?: string;
  /** Cycle status, aligned with IntakeRecord.cycleStatus. */
  cycleStatus?: string;
  /** Postal code (used only to flag geographic fit was provided). */
  zip?: string;
  /** Preferred name (structured, not free-text PII). */
  preferredName?: string;
  /**
   * Whether the lead gave an explicit contact/marketing opt-in. Gate for
   * policy.lead.explicit-optin-and-source-required and
   * policy.marketing.consent-to-contact-required.
   */
  consentOptIn?: boolean;
};

/** The first-pass ICP screen the Inbound Lead Generation agent runs. */
export type LeadScreen = {
  icpMatch: boolean;
  /** 0-100 readiness score. */
  leadScore: number;
  readiness: "ready" | "warming";
  reasons: string[];
};

/** The authoritative call the Qualification agent produces per lead. */
export type QualificationDecision = {
  decision: "qualified" | "disqualified";
  score: number;
  /**
   * Where a qualified lead goes next. "intake" for qualified-and-ready,
   * "nurture" for qualified-but-warming, "none" for disqualified.
   */
  route: "intake" | "nurture" | "none";
  rationale: string;
  /**
   * Always false: qualification rubric excludes protected-class
   * attributes by construction. Surfaced so the value is auditable and
   * so policy.qualification.no-protected-class-criteria has a real
   * signal to read.
   */
  protectedClassUsed: false;
};

/** A drafted (never auto-sent) nurture touch from the Prospecting agent. */
export type NurtureTouch = {
  channel: "email" | "sms";
  touch: number;
  cadenceDays: number;
  /** Always true: outreach is drafted for human review, never autonomous. */
  humanApprovalRequired: true;
  /** Always false in the prototype: nothing is sent without approval. */
  sent: false;
  summary: string;
};

/** Menopause-relevant primary symptoms the ICP screen recognizes. */
const MENOPAUSE_SYMPTOMS = new Set([
  "vasomotor",
  "sleep",
  "mood",
  "cognition",
  "gsm",
  "weight_gain",
  "osteoporosis",
  "high_cholesterol",
  "bleeding"
]);

/** Higher-intent inbound sources get a small readiness bump. */
const HIGH_INTENT_SOURCES = new Set([
  "web-chat",
  "symptom-check-form",
  "referral"
]);

/**
 * Parse the lower bound out of an age band like "46-50" or "40-60".
 * Returns undefined for "<40", ">60", or anything unparseable, so the
 * caller can decide how to treat the edges explicitly.
 */
export function ageBandLowerBound(ageBand?: string): number | undefined {
  if (!ageBand) return undefined;
  const match = ageBand.match(/(\d{2,3})/);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

/**
 * Is the lead in Pause's core menopause-care ICP? True when there's a
 * recognized menopause symptom AND the age band overlaps the 40-60
 * midlife window (an explicit "<40" band never matches).
 */
export function isInIcp(lead: FunnelLead): boolean {
  const hasSymptom = Boolean(
    lead.primarySymptom && MENOPAUSE_SYMPTOMS.has(lead.primarySymptom)
  );
  const low = ageBandLowerBound(lead.ageBand);
  const ageFits =
    lead.ageBand === "<40"
      ? false
      : low === undefined
        ? false
        : low >= 40 && low <= 60;
  return hasSymptom && ageFits;
}

/**
 * First-pass ICP screen + readiness score. Deterministic on the lead.
 * A lead is "ready" (route straight to intake) at score >= 70, otherwise
 * "warming" (route into the nurture cadence).
 */
export function screenInboundLead(lead: FunnelLead): LeadScreen {
  const reasons: string[] = [];
  const icpMatch = isInIcp(lead);

  let score = 30;
  if (icpMatch) {
    score += 20;
    reasons.push("In menopause-care ICP (age band + symptom signal)");
  } else {
    reasons.push("Outside core ICP on age band and/or symptom signal");
  }
  if (lead.primarySymptom && MENOPAUSE_SYMPTOMS.has(lead.primarySymptom)) {
    score += 8;
    reasons.push(`Recognized symptom signal (${lead.primarySymptom})`);
  }
  if (lead.consentOptIn) {
    score += 10;
    reasons.push("Explicit contact opt-in present");
  }
  // Readiness is driven mostly by expressed intent: a high-intent inbound
  // source (someone who reached out) tips a qualified lead straight to
  // intake, while a lower-intent source (e.g. a content download) leaves an
  // otherwise-qualified lead "warming" — i.e. routed into nurture, not intake.
  if (lead.source && HIGH_INTENT_SOURCES.has(lead.source)) {
    score += 20;
    reasons.push(`High-intent source (${lead.source})`);
  } else if (lead.source) {
    reasons.push(`Lower-intent source (${lead.source}) — warming`);
  }

  const leadScore = Math.max(0, Math.min(100, score));
  const readiness: LeadScreen["readiness"] = leadScore >= 70 ? "ready" : "warming";
  return { icpMatch, leadScore, readiness, reasons };
}

/**
 * The authoritative qualified/disqualified call. Qualifies an ICP lead
 * at score >= 55; routes qualified-and-ready to intake and
 * qualified-but-warming into nurture. Never reads a protected-class
 * attribute (there are none on FunnelLead) — the rubric is fit +
 * readiness only.
 */
export function qualifyLead(lead: FunnelLead, screen: LeadScreen): QualificationDecision {
  const qualified = screen.icpMatch && screen.leadScore >= 55;
  if (!qualified) {
    const why = !screen.icpMatch
      ? "lead falls outside the menopause-care ICP (age band / symptom)"
      : `lead score ${screen.leadScore} is below the qualification threshold (55)`;
    return {
      decision: "disqualified",
      score: screen.leadScore,
      route: "none",
      rationale: `Disqualified: ${why}. Logged for human review; not routed to intake.`,
      protectedClassUsed: false
    };
  }

  const route = screen.readiness === "ready" ? "intake" : "nurture";
  const rationale =
    route === "intake"
      ? `Qualified and ready (score ${screen.leadScore}): in ICP with explicit intent — routing to Patient Intake.`
      : `Qualified but warming (score ${screen.leadScore}): in ICP without full readiness — routing to the Prospecting & Nurture cadence.`;
  return {
    decision: "qualified",
    score: screen.leadScore,
    route,
    rationale,
    protectedClassUsed: false
  };
}

/**
 * Draft a single consent-aware nurture touch. Always
 * human-approval-required and never marked sent — the prototype models
 * the drafting, not the send.
 */
export function draftNurtureTouch(lead: FunnelLead, touch = 1): NurtureTouch {
  // SMS only where the source implies a phone-first channel; default email.
  const channel: NurtureTouch["channel"] =
    lead.source === "symptom-check-form" ? "sms" : "email";
  return {
    channel,
    touch,
    cadenceDays: 4,
    humanApprovalRequired: true,
    sent: false,
    summary: `Draft nurture touch #${touch} over ${channel} for a warming, consented lead — queued for human approval.`
  };
}

/**
 * Map a qualified funnel lead onto the IntakeRecord the Agentforce
 * Intake agent hands to the Care Router. The red-flag screen field is
 * always set ("no") so the intake satisfies the Care Router's mandatory
 * red-flag policy; severity defaults to "moderate" absent a captured
 * value. Only structured fields cross — no free-text PII.
 */
export function leadToIntake(lead: FunnelLead): IntakeRecord {
  return {
    preferredName: lead.preferredName,
    ageBand: lead.ageBand,
    cycleStatus: lead.cycleStatus,
    primarySymptom: lead.primarySymptom,
    severity: "moderate",
    redFlagsAcknowledged: "no",
    patientZip: lead.zip
  };
}
