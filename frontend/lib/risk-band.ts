/**
 * Risk-band computation for the Pause Demo cohort.
 *
 * Combines the three axes the persona picker surfaces (vasomotor /
 * sleep / mood) into a deterministic band suitable for the clinician
 * Care Detail page. This is intentionally simple and inspectable —
 * the real Pause-Health.ai production stack will replace it with the
 * Data 360 Calculated Insight "menopause_burden_index_30d" and the
 * Care Router's acuity policy.
 *
 * Why a separate module: this calc shows up on /demo/patient (Care
 * Detail) AND will likely surface on /demo/routing once that page
 * gets its persona-aware rebuild. Keeping it pure-data here means
 * the two pages can't drift.
 */

import type { DemoPersona } from "./demo-cohort";

export type RiskBand = "Low" | "Moderate" | "High" | "Critical";

export type RiskAssessment = {
  /** 0-30 (sum of vasomotor + sleep + mood). */
  index: number;
  /** Normalized to 0-1 for visual gauges. */
  indexNormalized: number;
  band: RiskBand;
  /** Human-readable rationale for why this band was assigned. */
  rationale: string;
  /** Per-axis flags surfaced in the UI (axis label -> "elevated" | "high"). */
  axisFlags: Array<{ axis: "Vasomotor" | "Sleep" | "Mood"; level: "elevated" | "high"; score: number }>;
};

/**
 * Compute a risk band from a DemoPersona. Inputs come from the seeded
 * intake scores (0-10 per axis) plus any clinical override hints we
 * encode in the future.
 *
 * Bands (deterministic):
 *   - index >= 22                            -> Critical
 *   - index >= 16   OR  any axis >= 8        -> High
 *   - index >= 10                            -> Moderate
 *   - otherwise                              -> Low
 *
 * The "any axis >= 8" rule promotes the High band even when total
 * burden is moderate, because a single severe axis (e.g. mood = 8
 * for Elena) is itself a routing signal independent of the others.
 */
export function computeRisk(persona: DemoPersona): RiskAssessment {
  const v = persona.vasomotorScore;
  const s = persona.sleepScore;
  const m = persona.moodScore;
  const index = v + s + m;
  const maxAxis = Math.max(v, s, m);

  const axisFlags: RiskAssessment["axisFlags"] = [];
  if (v >= 8) axisFlags.push({ axis: "Vasomotor", level: "high", score: v });
  else if (v >= 6) axisFlags.push({ axis: "Vasomotor", level: "elevated", score: v });
  if (s >= 8) axisFlags.push({ axis: "Sleep", level: "high", score: s });
  else if (s >= 6) axisFlags.push({ axis: "Sleep", level: "elevated", score: s });
  if (m >= 8) axisFlags.push({ axis: "Mood", level: "high", score: m });
  else if (m >= 6) axisFlags.push({ axis: "Mood", level: "elevated", score: m });

  let band: RiskBand;
  let rationale: string;
  if (index >= 22) {
    band = "Critical";
    rationale = `Sum of intake scores ${index}/30 — triggers urgent escalation regardless of pathway.`;
  } else if (index >= 16 || maxAxis >= 8) {
    band = "High";
    rationale =
      maxAxis >= 8
        ? `Single axis ≥8 (${maxAxis}/10) promotes to High band — single-axis severity is a routing signal even when total burden is moderate.`
        : `Sum of intake scores ${index}/30 puts patient in the High band.`;
  } else if (index >= 10) {
    band = "Moderate";
    rationale = `Sum of intake scores ${index}/30 — moderate burden, candidate for MSCP virtual visit.`;
  } else {
    band = "Low";
    rationale = `Sum of intake scores ${index}/30 — low burden, self-care tracking pathway appropriate.`;
  }

  return {
    index,
    indexNormalized: index / 30,
    band,
    rationale,
    axisFlags
  };
}

/**
 * Map a risk band to a recommended Care Router pathway. Mirrors the
 * pathway enum the Anthropic-backed Care Router actually emits — see
 * `frontend/components/latest-care-router-decision.tsx` for the
 * canonical mapping. Kept in sync manually for now; will be extracted
 * into a single source of truth when /demo/routing gets its rebuild.
 */
export function suggestedPathway(
  persona: DemoPersona,
  assessment: RiskAssessment
): {
  pathway: string;
  pathwayLabel: string;
  rationale: string;
} {
  // Mood-predominant high band -> behavioral-health handoff
  const moodLed =
    persona.moodScore >= 7 && persona.moodScore >= persona.vasomotorScore;
  if (moodLed && (assessment.band === "High" || assessment.band === "Critical")) {
    return {
      pathway: "behavioral-health-handoff",
      pathwayLabel: "Behavioral health handoff",
      rationale:
        "Mood-axis severity ≥7 with overall High/Critical burden. Co-manage with behavioral health while menopause-care continues."
    };
  }

  // Critical band -> urgent gynecology
  if (assessment.band === "Critical") {
    return {
      pathway: "urgent-gynecology",
      pathwayLabel: "Urgent gynecology",
      rationale:
        "Sum of intake scores ≥22/30 OR critical clinical flag. 24-hour gynecology review required."
    };
  }

  // High band, vasomotor-led -> in-person MSCP
  if (assessment.band === "High" && persona.vasomotorScore >= 8) {
    return {
      pathway: "mscp-in-person",
      pathwayLabel: "MSCP in-person visit",
      rationale:
        "Severe vasomotor symptoms (≥8/10) warrant in-person MSCP evaluation; complex HRT decision-making benefits from in-person workup."
    };
  }

  // High band, mixed -> MSCP virtual
  if (assessment.band === "High") {
    return {
      pathway: "mscp-virtual-visit",
      pathwayLabel: "MSCP virtual visit",
      rationale:
        "High symptom burden but no single-axis emergency. MSCP-credentialed virtual visit within the week."
    };
  }

  // Moderate band -> MSCP virtual (lower priority)
  if (assessment.band === "Moderate") {
    return {
      pathway: "mscp-virtual-visit",
      pathwayLabel: "MSCP virtual visit",
      rationale:
        "Moderate burden — MSCP virtual visit appropriate, schedule within 2-4 weeks."
    };
  }

  // Low band -> self-care tracking
  return {
    pathway: "self-care-tracking",
    pathwayLabel: "Self-care tracking",
    rationale:
      "Low symptom burden. Self-care tracking pathway with wearable + intake check-ins; escalate if any axis rises >2 points."
  };
}

/**
 * HRT suitability heuristic. Mirrors menopause-society clinical
 * decision tooling: HRT is usually appropriate for symptomatic
 * perimenopausal and recently postmenopausal patients without CVD
 * red flags, deferred when postmenopausal bleeding or BMI/comorbid
 * red flags are present.
 *
 * The current demo personas don't carry comorbidity flags explicitly
 * — we read them out of the `profileNote` text. This is intentionally
 * a heuristic so the demo can illustrate the *shape* of the decision
 * without pretending to be a clinical-grade rule engine.
 */
export function hrtSuitability(persona: DemoPersona): {
  label: string;
  detail: string;
} {
  const note = persona.profileNote.toLowerCase();
  const isPostmeno = persona.cycleStatus.toLowerCase().includes("postmeno");

  // CVD/BMI red flags in the narrative
  if (/cvd|cardiometabolic|bmi 3\d/.test(note)) {
    return {
      label: "Defer — cardiometabolic review first",
      detail:
        "Profile flags CVD / BMI ≥30. Per menopause society guidance, complete cardiometabolic risk workup before considering systemic HRT; topical / non-hormonal options remain on the table."
    };
  }

  // Postmenopausal bleeding in the narrative
  if (/bleed/.test(note)) {
    return {
      label: "Defer — diagnostic workup first",
      detail:
        "Unexpected bleeding in a postmenopausal patient must be worked up before HRT is initiated."
    };
  }

  // GSM-predominant postmenopausal patients
  if (/gsm|vaginal/.test(note)) {
    return {
      label: "Local therapy first-line",
      detail:
        "GSM-predominant presentation. Local vaginal estrogen is first-line and carries no systemic exposure concerns."
    };
  }

  // Mood-predominant
  if (/mood|behavioral/.test(note)) {
    return {
      label: "Co-management with behavioral health",
      detail:
        "Mood-predominant presentation — combination of HRT consideration and behavioral health co-management. Discuss in MSCP visit."
    };
  }

  // Joint pain / musculoskeletal
  if (/musculoskeletal|joint/.test(note)) {
    return {
      label: "Lifestyle + PT; HRT a secondary consideration",
      detail:
        "Musculoskeletal-predominant. HRT can help joint symptoms but lifestyle / PT referral is the primary lever first."
    };
  }

  // Default: perimenopausal candidate
  return {
    label: isPostmeno ? "Candidate — discuss in MSCP visit" : "Candidate — discuss in MSCP visit",
    detail:
      "No cardiometabolic or bleeding red flags. Symptomatic perimenopausal / recently postmenopausal patients are typical HRT candidates; final decision in MSCP visit factoring patient preference."
  };
}
