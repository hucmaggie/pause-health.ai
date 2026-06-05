/**
 * Canonical Care Router pathway enum.
 *
 * The Anthropic-backed Care Router agent (see `lib/care-router.ts` for
 * the policy implementation and `app/api/agents/care-router/...` for
 * the A2A endpoint) emits one of these six values on every decision:
 *
 *   self-care-tracking
 *   mscp-virtual-visit
 *   mscp-in-person
 *   urgent-gynecology
 *   behavioral-health-handoff
 *   ed-referral
 *
 * Surfaces that display a pathway -- the live decision card on
 * /demo/routing, the suggested pathway on /demo/patient, the
 * Care Detail "Continue to Routing" CTA -- must use this enum so
 * the user-facing labels stay aligned with what the router actually
 * does.
 *
 * Why a shared module:
 *
 *   Before this module existed, the labels lived inline in
 *   `components/latest-care-router-decision.tsx` (live decision card)
 *   AND were quietly hardcoded as different strings ("Urgent
 *   gynecology review", "Primary care optimization") in the routing
 *   matrix on /demo/routing. The matrix included pathways the router
 *   doesn't actually emit ("Primary care optimization") and missed
 *   ones it does ("Self-care tracking", "MSCP in-person", "ED
 *   referral"). This module is the single source of truth so that
 *   drift cannot happen again.
 *
 *   `frontend/lib/risk-band.ts:suggestedPathway()` also references
 *   the same enum and is the heuristic that powers the suggested
 *   pathway preview on /demo/patient.
 */

export type CareRouterPathway =
  | "self-care-tracking"
  | "mscp-virtual-visit"
  | "mscp-in-person"
  | "urgent-gynecology"
  | "behavioral-health-handoff"
  | "ed-referral";

export type Acuity = "routine" | "elevated" | "urgent" | "emergency";

export type PathwayDescriptor = {
  pathway: CareRouterPathway;
  label: string;
  /** One-line trigger description for the matrix card. */
  trigger: string;
  /** Target response window (SLA) for this pathway. */
  target: string;
  /** Acuity tier as the router reports it. */
  acuity: Acuity;
  /** Loose ordering used by the matrix (lowest -> highest acuity). */
  acuityOrder: number;
  /** Cosmetic hint for color theming in the matrix. */
  tone: "calm" | "moderate" | "elevated" | "urgent" | "critical";
};

export const CARE_ROUTER_PATHWAYS: PathwayDescriptor[] = [
  {
    pathway: "self-care-tracking",
    label: "Self-care + symptom tracking",
    trigger:
      "Low symptom burden, no red flags. Patient self-paces with wearable + symptom tracker; we escalate if any axis rises >2 points.",
    target: "Self-paced; wearable + tracker enabled",
    acuity: "routine",
    acuityOrder: 1,
    tone: "calm"
  },
  {
    pathway: "mscp-virtual-visit",
    label: "Menopause specialist (virtual)",
    trigger:
      "Moderate-to-high symptom burden, no single-axis emergency. MSCP-credentialed virtual visit covers HRT discussion, lifestyle, and follow-up cadence.",
    target: "< 7 days",
    acuity: "elevated",
    acuityOrder: 2,
    tone: "moderate"
  },
  {
    pathway: "mscp-in-person",
    label: "Menopause specialist (in person)",
    trigger:
      "Severe vasomotor symptoms (>=8/10) or complex HRT decision-making benefiting from in-person workup. MSCP in-person visit, often pre-MSCP coordination with PCP.",
    target: "< 14 days",
    acuity: "elevated",
    acuityOrder: 3,
    tone: "elevated"
  },
  {
    pathway: "behavioral-health-handoff",
    label: "Behavioral health handoff",
    trigger:
      "Mood instability, anxiety, or depressive safety indicators alongside menopause-pattern symptoms. Behavioral health co-management while menopause-care continues.",
    target: "Same day",
    acuity: "urgent",
    acuityOrder: 4,
    tone: "urgent"
  },
  {
    pathway: "urgent-gynecology",
    label: "Urgent gynecology review",
    trigger:
      "Critical burden (>=22/30 total), unexpected postmenopausal bleeding, or concerning pelvic symptoms. 24-hour gynecology evaluation required.",
    target: "< 24h",
    acuity: "urgent",
    acuityOrder: 5,
    tone: "urgent"
  },
  {
    pathway: "ed-referral",
    label: "Emergency department",
    trigger:
      "Hemodynamic instability, heavy bleeding with pre-syncope, acute psychiatric safety crisis. Call 911 or go to the ED.",
    target: "Immediate (call 911 or go to ED)",
    acuity: "emergency",
    acuityOrder: 6,
    tone: "critical"
  }
];

const BY_PATHWAY: Record<CareRouterPathway, PathwayDescriptor> = Object.fromEntries(
  CARE_ROUTER_PATHWAYS.map((p) => [p.pathway, p])
) as Record<CareRouterPathway, PathwayDescriptor>;

export function describePathway(
  pathway: string
): PathwayDescriptor | null {
  if ((pathway as CareRouterPathway) in BY_PATHWAY) {
    return BY_PATHWAY[pathway as CareRouterPathway];
  }
  return null;
}

export const PATHWAY_LABELS: Record<CareRouterPathway, string> =
  Object.fromEntries(
    CARE_ROUTER_PATHWAYS.map((p) => [p.pathway, p.label])
  ) as Record<CareRouterPathway, string>;

export const PATHWAY_TARGETS: Record<CareRouterPathway, string> =
  Object.fromEntries(
    CARE_ROUTER_PATHWAYS.map((p) => [p.pathway, p.target])
  ) as Record<CareRouterPathway, string>;
