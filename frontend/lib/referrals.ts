/**
 * Referral Management — triage + draft outbound specialist referrals.
 *
 * Deterministic, dependency-free domain core the Referral Management Agent
 * (app/api/agents/referral-management) wraps — the Salesforce "Agentforce for
 * Health" Referrals ("Create Referral") analog on Pause's Agent Fabric. It
 * triages and routes referrals to the adjacent specialists menopause commonly
 * touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT,
 * and behavioral health — from intake + Care Router routing signals, and drafts
 * a referral request per recommended specialty. It GENERALIZES the Care Router's
 * behavioral-health-handoff into a full outbound-referral node: what the router
 * expresses as one handoff pathway, this agent expresses as a catalog of
 * cosign-gated referral drafts across the menopause care neighborhood.
 *
 *   Inbound:  a ReferralTriageContext (age/cycle/symptom/severity/red-flag
 *             signals + explicit risk flags + an optional Care Router pathway)
 *   Outbound: ReferralRecommendation[] (each referencing a SPECIALTY CATALOG id
 *             + a documented reason + a priority) and ReferralRequest[] (each
 *             marked requiresClinicianCosign:true, status:"drafted", sent:false)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY: an outbound referral requires clinician sign-off.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may triage and DRAFT a referral for a clinician to review — it must
 *  NEVER "send" an outbound referral without a clinician's sign-off. An outbound
 *  referral is a clinical action that requires a human-in-the-loop. This module
 *  encodes that: every draft is marked requiresClinicianCosign:true, sent:false,
 *  status:"drafted", and referralHasClinicianCosign() reports the honest signal
 *  the Agent Fabric enforces via policy.referral.clinician-cosign (a
 *  caller-asserted send-without-cosign → false → blocked).
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical referral engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The specialties, their typical triggers, and the triage rules below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of referral
 *  triage — they are NOT a certified or clinically-authoritative referral engine
 *  (real referral criteria are individualized and clinician-driven). There is NO
 *  randomness and NO clock anywhere here: triage is a pure function of the
 *  context the caller passes, so the same context always yields the same
 *  recommendations — which is what lets the demo, the seeded trace, and the
 *  tests agree.
 *
 *  The load-bearing integrity property is that EVERY recommended referral
 *  references a defined specialty catalog id AND carries a reason (a referral is
 *  never free-invented and never reasonless). triageReferrals() only ever emits
 *  catalog specialties, and referralsTraceToSpecialty() flags any off-catalog
 *  referral a caller might assert.
 */

/** A specialist referral target in the (illustrative) catalog. */
export type ReferralSpecialty = {
  /** Stable catalog id every referral must reference. */
  id: string;
  /** Human-readable specialty label. */
  label: string;
  /**
   * The (illustrative) trigger that typically routes a menopause patient to
   * this specialty. NOT a certified referral criterion — a demo-honest
   * description of why the specialty appears in a menopause-care neighborhood.
   */
  typicalTrigger: string;
};

/**
 * The specialty catalog. This is the ONLY source of legitimate referrals —
 * triageReferrals() iterates over these, so a returned referral can never
 * reference a specialty that isn't defined here. Illustrative/synthetic values;
 * NOT a certified referral engine (see the module header). The five specialties
 * are the adjacent ones menopause care commonly touches.
 */
export const REFERRAL_SPECIALTIES: ReferralSpecialty[] = [
  {
    id: "referral.behavioral-health",
    label: "Behavioral health",
    typicalTrigger:
      "A red-flag mood signal, or significant mood / anxiety symptoms in the mental-health domain — the full-referral generalization of the Care Router's behavioral-health handoff. (Illustrative — not a certified referral criterion.)"
  },
  {
    id: "referral.cardiology",
    label: "Cardiology / CVD risk",
    typicalTrigger:
      "Elevated cardiovascular risk (high cholesterol, hypertension, or other CVD signals) as estrogen's cardioprotective effect wanes through the menopause transition. (Illustrative — not a certified referral criterion.)"
  },
  {
    id: "referral.endocrinology",
    label: "Endocrinology",
    typicalTrigger:
      "A complex hormonal / thyroid / metabolic picture, or a premature ovarian insufficiency workup (menopause-pattern symptoms under 40). (Illustrative — not a certified referral criterion.)"
  },
  {
    id: "referral.bone-health",
    label: "Bone health / osteoporosis",
    typicalTrigger:
      "Osteoporosis or high fracture risk, or low bone density, as accelerated post-menopausal bone loss raises fracture risk. (Illustrative — not a certified referral criterion.)"
  },
  {
    id: "referral.pelvic-floor-pt",
    label: "Pelvic-floor physical therapy",
    typicalTrigger:
      "Genitourinary syndrome of menopause (GSM), pelvic-floor dysfunction, or urinary incontinence that benefits from pelvic-floor PT. (Illustrative — not a certified referral criterion.)"
  }
];

const SPECIALTY_BY_ID = new Map(REFERRAL_SPECIALTIES.map((s) => [s.id, s]));

/** Is `id` a defined specialty catalog id? */
export function isCatalogSpecialty(id: string): boolean {
  return SPECIALTY_BY_ID.has(id);
}

/** Look up a catalog specialty by id (undefined for an off-catalog id). */
export function getReferralSpecialty(id: string): ReferralSpecialty | undefined {
  return SPECIALTY_BY_ID.get(id);
}

export type ReferralPriority = "routine" | "expedited" | "urgent";

/**
 * The intake + routing signals the triage reads. Deterministic: a pure function
 * of the context (no randomness, no clock). Mirrors the Care Router's
 * IntakeRecord vocabulary (age band / cycle / symptom / severity / red-flag)
 * plus explicit risk flags and the optional Care Router pathway that generalizes
 * into a behavioral-health referral.
 */
export type ReferralTriageContext = {
  /** Age band, e.g. "46-50", "<40" (mirrors IntakeRecord.ageBand). */
  ageBand?: string;
  /** Cycle status, e.g. "irregular", "stopped>=12mo". */
  cycleStatus?: string;
  /** Primary reported symptom, e.g. "mood", "gsm", "hot_flashes". */
  primarySymptom?: string;
  /** Self-reported severity band. */
  severity?: "mild" | "moderate" | "severe" | string;
  /** Whether the patient acknowledged a red-flag symptom ("yes" = flagged). */
  redFlagsAcknowledged?: "yes" | "no" | "none" | string;
  /**
   * The Care Router pathway this patient landed on, when known. A
   * "behavioral-health-handoff" pathway is the router signal this agent
   * generalizes into a full behavioral-health referral.
   */
  routedPathway?: string;
  /** Explicit risk flags that indicate a specialty referral. */
  riskFlags?: {
    osteoporosisRisk?: boolean;
    highFractureRisk?: boolean;
    cardiovascularRisk?: boolean;
    highCholesterol?: boolean;
    pelvicFloorDysfunction?: boolean;
    thyroidOrMetabolic?: boolean;
  };
};

/** A triage recommendation — always references a catalog specialty + a reason. */
export type ReferralRecommendation = {
  /** The specialty catalog id this referral derives from (never invented). */
  specialtyId: string;
  /** Copied from the catalog for display convenience. */
  specialtyLabel: string;
  /** Human-readable reason the referral was recommended (integrity property). */
  reason: string;
  /** Deterministic priority derived from the driving signal. */
  priority: ReferralPriority;
};

/** Ordinal position of an age band (higher = older). Unknown → -1. */
const AGE_BAND_ORDER: Record<string, number> = {
  "<40": 0,
  "40-45": 1,
  "46-50": 2,
  "51-55": 3,
  "56-60": 4,
  ">60": 5
};

function ageBandAtLeast(ageBand: string | undefined, floor: string): boolean {
  if (!ageBand) return false;
  const a = AGE_BAND_ORDER[ageBand];
  const f = AGE_BAND_ORDER[floor];
  return a !== undefined && f !== undefined && a >= f;
}

function isPostmenopausal(cycleStatus: string | undefined): boolean {
  return cycleStatus === "stopped>=12mo" || cycleStatus === "stopped>12mo";
}

function isRedFlagFlagged(ctx: ReferralTriageContext): boolean {
  return ctx.redFlagsAcknowledged === "yes";
}

/**
 * A single specialty's triage evaluation: does it apply to this context, and if
 * so, with what reason + priority? Deterministic (illustrative, not certified).
 * Returns null when the specialty is not indicated.
 */
function evaluateSpecialty(
  specialtyId: string,
  ctx: ReferralTriageContext
): { reason: string; priority: ReferralPriority } | null {
  switch (specialtyId) {
    case "referral.behavioral-health": {
      // Generalizes the Care Router's behavioral-health-handoff: a red-flag mood
      // signal, a severe mood symptom, or a router pathway of behavioral-health.
      const redFlagMood = isRedFlagFlagged(ctx) && ctx.primarySymptom === "mood";
      const severeMood =
        ctx.primarySymptom === "mood" && ctx.severity === "severe";
      const routerHandoff = ctx.routedPathway === "behavioral-health-handoff";
      if (redFlagMood) {
        return {
          reason:
            "red-flag mood signal in the mental-health domain — same-day behavioral-health connection (generalizes the Care Router behavioral-health handoff)",
          priority: "urgent"
        };
      }
      if (severeMood) {
        return {
          reason:
            "severe mood symptoms warrant a behavioral-health referral even without an active safety flag",
          priority: "expedited"
        };
      }
      if (routerHandoff) {
        return {
          reason:
            "Care Router routed this patient to a behavioral-health handoff — expressed here as a full outbound behavioral-health referral",
          priority: "expedited"
        };
      }
      return null;
    }
    case "referral.cardiology": {
      if (ctx.riskFlags?.cardiovascularRisk || ctx.riskFlags?.highCholesterol) {
        return {
          reason:
            "elevated cardiovascular risk (high cholesterol / CVD signals) as estrogen's cardioprotective effect wanes through the transition",
          priority: "routine"
        };
      }
      return null;
    }
    case "referral.endocrinology": {
      // POI workup (menopause-pattern symptoms under 40) or an explicit
      // thyroid / metabolic flag.
      const poi =
        ctx.ageBand === "<40" &&
        (ctx.cycleStatus === "irregular" || isPostmenopausal(ctx.cycleStatus));
      if (poi) {
        return {
          reason:
            "menopause-pattern symptoms under 40 — endocrinology workup to rule out premature ovarian insufficiency",
          priority: "expedited"
        };
      }
      if (ctx.riskFlags?.thyroidOrMetabolic) {
        return {
          reason:
            "a complex thyroid / metabolic picture that warrants endocrinology co-management",
          priority: "routine"
        };
      }
      return null;
    }
    case "referral.bone-health": {
      if (
        ctx.riskFlags?.osteoporosisRisk ||
        ctx.riskFlags?.highFractureRisk ||
        (isPostmenopausal(ctx.cycleStatus) && ageBandAtLeast(ctx.ageBand, "51-55"))
      ) {
        return {
          reason:
            "osteoporosis / high fracture risk (or postmenopausal in an older age band) — accelerated post-menopausal bone loss raises fracture risk",
          priority: "routine"
        };
      }
      return null;
    }
    case "referral.pelvic-floor-pt": {
      if (
        ctx.riskFlags?.pelvicFloorDysfunction ||
        ctx.primarySymptom === "gsm"
      ) {
        return {
          reason:
            "genitourinary syndrome of menopause / pelvic-floor dysfunction that benefits from pelvic-floor physical therapy",
          priority: "routine"
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Triage recommended referral(s) from an intake + routing context.
 * DETERMINISTIC: iterates the specialty catalog in order and emits a referral
 * for each indicated specialty, each referencing a catalog specialty id and
 * carrying a documented reason. A specialty that isn't indicated is skipped.
 *
 * Because it only ever iterates REFERRAL_SPECIALTIES, every returned
 * recommendation.specialtyId is a catalog id by construction — the
 * governance-integrity property the Agent Fabric relies on.
 */
export function triageReferrals(
  ctx: ReferralTriageContext
): ReferralRecommendation[] {
  const out: ReferralRecommendation[] = [];
  for (const specialty of REFERRAL_SPECIALTIES) {
    const hit = evaluateSpecialty(specialty.id, ctx);
    if (!hit) continue;
    out.push({
      specialtyId: specialty.id,
      specialtyLabel: specialty.label,
      reason: hit.reason,
      priority: hit.priority
    });
  }
  return out;
}

/**
 * Integrity check: does EVERY recommended referral reference a defined specialty
 * catalog id AND carry a non-empty reason? True for anything triageReferrals()
 * produces; the guard that catches a caller-asserted, free-invented (off-catalog
 * or reasonless) referral.
 */
export function referralsTraceToSpecialty(
  referrals:
    | Array<Pick<ReferralRecommendation, "specialtyId" | "reason">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(referrals)) return false;
  return referrals.every(
    (r) =>
      isCatalogSpecialty(r.specialtyId) &&
      typeof r.reason === "string" &&
      r.reason.trim().length > 0
  );
}

/** The specialty ids referenced by a set of referrals (catalog-only survive). */
export function specialtyIdsForReferrals(
  referrals: Array<Pick<ReferralRecommendation, "specialtyId">>
): string[] {
  return referrals
    .map((r) => r.specialtyId)
    .filter((id) => isCatalogSpecialty(id));
}

export type ReferralStatus = "drafted" | "sent";

/**
 * A drafted outbound referral request. EXPLICITLY cosign-gated: the agent drafts
 * this for a clinician to review + sign, and never sends it itself.
 */
export type ReferralRequest = {
  /** The specialty catalog id this referral is about. */
  specialtyId: string;
  specialtyLabel: string;
  /** The documented reason the referral was drafted (integrity property). */
  reason: string;
  /** Deterministic priority carried from triage. */
  priority: ReferralPriority;
  /** Human-readable referral body (no free-text PII; specialty + reason only). */
  body: string;
  /**
   * Always true — an outbound referral requires a clinician's sign-off before it
   * is sent. The agent may draft; a clinician signs and sends.
   */
  requiresClinicianCosign: true;
  /** Always "drafted" — the agent never advances a referral to "sent" itself. */
  status: "drafted";
  /** Always false — nothing is sent autonomously. */
  sent: false;
};

/**
 * A referral-related action a caller might ask the agent to take. The agent
 * itself only ever DRAFTS a cosign-gated referral; a "send" is admissible only
 * with a clinician cosign. A caller-asserted autonomous send (no cosign) is the
 * exact thing the Agent Fabric blocks.
 */
export type ReferralActionRequest = {
  kind: "draft" | "send";
  /** For a send, whether a clinician signed off on the referral. */
  clinicianCosigned?: boolean;
};

/**
 * The honest governance signal: does this referral-related action carry the
 * required clinician sign-off? TRUE for a draft (the only thing the agent does)
 * and for a clinician-cosigned send; FALSE for a caller-asserted AUTONOMOUS send
 * (no cosign). The route reports this to policy.referral.clinician-cosign, which
 * blocks when it is false — so the agent can never send an outbound referral
 * without a clinician's sign-off.
 */
export function referralHasClinicianCosign(
  action?: ReferralActionRequest | null
): boolean {
  if (!action || action.kind === "draft") return true;
  // A send is only permissible when a clinician explicitly cosigned it.
  return action.kind === "send" ? action.clinicianCosigned === true : true;
}

/**
 * Draft a single cosign-gated outbound referral for a recommended specialty.
 * Deterministic on its inputs. The draft is ALWAYS clinician-cosign-gated and
 * never sent (requiresClinicianCosign: true, status: "drafted", sent: false) —
 * it is prepared for a clinician to review and sign; the agent never sends it.
 */
export function draftReferral(
  recommendation: Pick<
    ReferralRecommendation,
    "specialtyId" | "specialtyLabel" | "reason" | "priority"
  >
): ReferralRequest {
  const specialty = getReferralSpecialty(recommendation.specialtyId);
  const label = specialty?.label ?? recommendation.specialtyLabel;

  const body =
    `Referral to ${label} (${recommendation.priority}). Reason: ${recommendation.reason}. ` +
    `Drafted for clinician review — awaiting sign-off before it is sent.`;

  return {
    specialtyId: recommendation.specialtyId,
    specialtyLabel: label,
    reason: recommendation.reason,
    priority: recommendation.priority,
    body,
    requiresClinicianCosign: true,
    status: "drafted",
    sent: false
  };
}

/** Draft a cosign-gated referral for every recommendation (convenience). */
export function draftReferrals(
  recommendations: ReferralRecommendation[]
): ReferralRequest[] {
  return recommendations.map((r) => draftReferral(r));
}

/**
 * A representative, deterministic demo triage context (illustrative). A
 * postmenopausal patient with a red-flag mood signal and osteoporosis risk —
 * routes to behavioral-health (urgent) and bone-health, exercising the
 * router-handoff generalization and a risk-flag referral.
 */
export const DEMO_REFERRAL_CONTEXT: ReferralTriageContext = {
  ageBand: "56-60",
  cycleStatus: "stopped>=12mo",
  primarySymptom: "mood",
  severity: "severe",
  redFlagsAcknowledged: "yes",
  routedPathway: "behavioral-health-handoff",
  riskFlags: { osteoporosisRisk: true, highCholesterol: true }
};
