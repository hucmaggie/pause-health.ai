/**
 * synthetic / demo
 *
 * Care Plan Agent — menopause care-plan instantiation + progress summary.
 *
 * The domain core the Care Plan Agent (app/api/agents/care-plan) wraps — the
 * Salesforce "Agentforce for Health" / Health Cloud CarePlan + care-plan-
 * summarization analog on Pause's Agent Fabric, and a clinical-plane sibling of
 * the Care Router.
 *
 * Two halves, mirroring the Care Router's two-implementation shape:
 *
 *   1. instantiateCarePlan() — DETERMINISTIC. Given the Care Router's
 *      pathway/severity + the intake, it selects and fills ONE menopause
 *      CarePlanTemplate from a defined catalog (goals, interventions, a
 *      follow-up cadence). There is NO randomness and NO clock: the same
 *      context always yields the same plan, which is what lets the demo, the
 *      seeded trace, and the tests agree. The load-bearing governance property
 *      is integrity — every instantiated plan references a defined template id,
 *      never a fabricated one (planTracesToTemplate() is the honest signal the
 *      route reports to policy.careplan.template-sourced).
 *
 *   2. summarizeCarePlan() — the LIVE-CLAUDE half. Follows lib/care-router.ts
 *      EXACTLY: it calls Claude to produce a concise, NON-PRESCRIPTIVE
 *      patient/clinician progress summary, gated by ANTHROPIC_API_KEY. On a
 *      missing key OR any SDK/transport error it falls back to a DETERMINISTIC
 *      scripted summary and stamps a non-clinical `fallbackReason`. The result
 *      carries `via: "claude-api" | "scripted-fallback"` so the Agent Fabric
 *      trace can show which path served the summary. This makes the Care Plan
 *      agent the SECOND live-Claude agent after the Care Router; it reuses the
 *      same Anthropic model + client setup and the model-allow-list policy.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical care-plan engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The care-plan templates — their goals, interventions, and follow-up
 *  cadences below — are ILLUSTRATIVE, synthetic/demo values chosen to model
 *  the SHAPE of a menopause care plan. They are NOT a certified or clinically-
 *  authoritative care-plan set. The generated summary is a progress summary
 *  only; it is deliberately non-prescriptive (it never adds or changes a
 *  medication, dose, order, or prescription).
 */

import type { CarePathway, IntakeRecord } from "./care-router";

/** A single, measurable-ish care-plan goal (illustrative). */
export type CarePlanGoal = {
  /** Stable goal id within the template. */
  id: string;
  /** Human-readable goal description. */
  description: string;
  /** An illustrative, trackable target for the goal. */
  target: string;
};

/** A care-plan intervention the patient/clinician acts on (illustrative). */
export type CarePlanIntervention = {
  /** Stable intervention id within the template. */
  id: string;
  /** Human-readable intervention description. */
  description: string;
  /**
   * Category of the intervention. Deliberately NON-prescriptive categories:
   * "pharmacologic-review" is a review/reassessment prompt for a clinician,
   * never an order the agent writes itself.
   */
  category:
    | "lifestyle"
    | "monitoring"
    | "education"
    | "clinical-follow-up"
    | "pharmacologic-review";
};

/** How often the plan calls for a follow-up touchpoint (illustrative). */
export type FollowUpCadence = {
  /** Recommended interval between follow-up touchpoints, in days. */
  intervalDays: number;
  /** The modality the follow-up is expected to use. */
  modality: "telehealth" | "in-person" | "async-message";
  /** Human-readable description of the cadence. */
  description: string;
};

/**
 * A menopause care-plan template. This is the ONLY source of legitimate care
 * plans — instantiateCarePlan() selects and fills one of these, so an
 * instantiated plan can never reference a template that isn't defined here.
 * Illustrative/synthetic values; NOT a certified care-plan engine (see header).
 */
export type CarePlanTemplate = {
  /** Stable catalog id every instantiated plan must reference. */
  id: string;
  /** Human-readable template label. */
  label: string;
  /** Illustrative description of what the template is for. */
  summary: string;
  goals: CarePlanGoal[];
  interventions: CarePlanIntervention[];
  followUpCadence: FollowUpCadence;
};

/**
 * The care-plan template catalog. Illustrative/synthetic — NOT a certified
 * guideline set. instantiateCarePlan() iterates/selects only from this list,
 * so every instantiated plan.templateId is a catalog id by construction.
 */
export const CARE_PLAN_TEMPLATES: CarePlanTemplate[] = [
  {
    id: "careplan.hrt-management",
    label: "HRT management plan",
    summary:
      "For patients on (or starting) hormone therapy — structured benefit/risk reassessment, symptom tracking, and a periodic follow-up to reassess dose and tolerability. (Illustrative — not a certified care-plan.)",
    goals: [
      {
        id: "goal.hrt-symptom-relief",
        description: "Reduce vasomotor symptom burden while on hormone therapy",
        target: "Patient-reported symptom score down at least one severity band by the follow-up"
      },
      {
        id: "goal.hrt-benefit-risk",
        description: "Keep the hormone-therapy benefit/risk balance under active review",
        target: "A documented benefit/risk reassessment at each follow-up visit"
      }
    ],
    interventions: [
      {
        id: "intervention.hrt-symptom-journal",
        description: "Log symptoms and any side effects in the symptom tracker between visits",
        category: "monitoring"
      },
      {
        id: "intervention.hrt-review",
        description:
          "Clinician reviews hormone-therapy dose, tolerability, and contraindications (review only — no order is written by the agent)",
        category: "pharmacologic-review"
      },
      {
        id: "intervention.hrt-education",
        description: "Review menopause-society education on hormone-therapy expectations and warning signs",
        category: "education"
      }
    ],
    followUpCadence: {
      intervalDays: 90,
      modality: "telehealth",
      description: "Follow-up every ~3 months to reassess the hormone-therapy plan"
    }
  },
  {
    id: "careplan.vasomotor-lifestyle",
    label: "Vasomotor & lifestyle plan",
    summary:
      "For patients managing hot flashes / night sweats with non-pharmacologic, lifestyle-first strategies plus structured symptom tracking. (Illustrative — not a certified care-plan.)",
    goals: [
      {
        id: "goal.vaso-frequency",
        description: "Lower the frequency and intensity of vasomotor episodes",
        target: "Fewer disruptive hot-flash episodes per week by the follow-up"
      },
      {
        id: "goal.vaso-sleep",
        description: "Improve sleep quality disrupted by night sweats",
        target: "Patient reports improved sleep on the check-in"
      }
    ],
    interventions: [
      {
        id: "intervention.vaso-triggers",
        description: "Identify and reduce personal vasomotor triggers (caffeine, alcohol, warm environments)",
        category: "lifestyle"
      },
      {
        id: "intervention.vaso-tracking",
        description: "Track hot-flash frequency and sleep in the symptom tracker",
        category: "monitoring"
      },
      {
        id: "intervention.vaso-education",
        description: "Review lifestyle and behavioral strategies for vasomotor symptom relief",
        category: "education"
      }
    ],
    followUpCadence: {
      intervalDays: 30,
      modality: "async-message",
      description: "Async symptom check-in every ~30 days"
    }
  },
  {
    id: "careplan.bone-health",
    label: "Bone-health plan",
    summary:
      "For postmenopausal / at-risk patients — protect bone density through weight-bearing activity, nutrition, and a periodic screening reminder. (Illustrative — not a certified care-plan.)",
    goals: [
      {
        id: "goal.bone-density",
        description: "Preserve bone density through the menopause transition",
        target: "Bone-density screening kept current per the patient's schedule"
      },
      {
        id: "goal.bone-activity",
        description: "Build a sustainable weight-bearing activity routine",
        target: "Regular weight-bearing activity most days of the week"
      }
    ],
    interventions: [
      {
        id: "intervention.bone-activity",
        description: "Weight-bearing and resistance activity guidance",
        category: "lifestyle"
      },
      {
        id: "intervention.bone-nutrition",
        description: "Calcium and vitamin-D dietary guidance (education only)",
        category: "education"
      },
      {
        id: "intervention.bone-screening",
        description: "Confirm bone-density (DEXA) screening is current and schedule if due",
        category: "clinical-follow-up"
      }
    ],
    followUpCadence: {
      intervalDays: 180,
      modality: "in-person",
      description: "In-person follow-up every ~6 months to review bone-health progress"
    }
  },
  {
    id: "careplan.mood-behavioral",
    label: "Mood & behavioral-health plan",
    summary:
      "For patients whose menopause course is dominated by mood symptoms — coordinated behavioral-health support, structured check-ins, and clear escalation. (Illustrative — not a certified care-plan.)",
    goals: [
      {
        id: "goal.mood-stability",
        description: "Support mood stability through the menopause transition",
        target: "Patient-reported mood improves on the behavioral-health check-in"
      },
      {
        id: "goal.mood-connection",
        description: "Keep the patient connected to behavioral-health support",
        target: "An active behavioral-health touchpoint on the plan"
      }
    ],
    interventions: [
      {
        id: "intervention.mood-checkin",
        description: "Structured mood check-ins between visits",
        category: "monitoring"
      },
      {
        id: "intervention.mood-bh-support",
        description: "Coordinate with behavioral-health support and confirm the patient can reach it",
        category: "clinical-follow-up"
      },
      {
        id: "intervention.mood-education",
        description: "Review education on menopause-related mood changes and when to seek help",
        category: "education"
      }
    ],
    followUpCadence: {
      intervalDays: 14,
      modality: "telehealth",
      description: "Follow-up every ~2 weeks while mood symptoms are the focus"
    }
  }
];

const TEMPLATE_BY_ID = new Map(CARE_PLAN_TEMPLATES.map((t) => [t.id, t]));

/** Is `id` a defined care-plan template catalog id? */
export function isCatalogTemplate(id: string): boolean {
  return TEMPLATE_BY_ID.has(id);
}

/** Look up a care-plan template by id (undefined for an off-catalog id). */
export function getCarePlanTemplate(id: string): CarePlanTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

/**
 * The inputs the instantiator selects a template from. Derived deterministically
 * from the Care Router's pathway/severity + the intake (no clock, no randomness).
 */
export type CarePlanContext = {
  /** The Care Router's chosen pathway. */
  pathway: CarePathway;
  /** The intake severity band (mild/moderate/severe), when captured. */
  severity?: IntakeRecord["severity"];
  /** Primary reported symptom (e.g. "vasomotor", "mood", "bleeding"). */
  primarySymptom?: string;
  /** Patient display name for the summary (falls back to a neutral phrase). */
  preferredName?: string;
  /** Age band from the unified patient view. */
  ageBand?: string;
  /** Cycle status, e.g. "perimenopausal", "stopped>=12mo". */
  cycleStatus?: string;
  /** Whether the patient is currently on hormone therapy. */
  onHrt?: boolean;
};

/** Build a CarePlanContext from an intake + the Care Router's decision. */
export function carePlanContextFromIntake(
  intake: IntakeRecord,
  decision: { pathway: CarePathway },
  extra: { onHrt?: boolean } = {}
): CarePlanContext {
  return {
    pathway: decision.pathway,
    severity: intake.severity,
    primarySymptom: intake.primarySymptom,
    preferredName: intake.preferredName,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus,
    ...(extra.onHrt !== undefined ? { onHrt: extra.onHrt } : {})
  };
}

/** An instantiated menopause care plan — always references a catalog template. */
export type InstantiatedCarePlan = {
  /** The care-plan template catalog id this plan derives from (never invented). */
  templateId: string;
  /** Copied from the catalog for display convenience. */
  templateLabel: string;
  /** Neutral patient display name used in the plan + summary. */
  patientDisplayName: string;
  /** The Care Router pathway this plan was instantiated for. */
  pathway: CarePathway;
  /** The severity band the plan was instantiated for (or "unspecified"). */
  severity: string;
  /** Structured goals filled from the template. */
  goals: CarePlanGoal[];
  /** Structured interventions filled from the template. */
  interventions: CarePlanIntervention[];
  /** The (possibly severity-adjusted) follow-up cadence. */
  followUp: FollowUpCadence;
  /** Deterministic, human-readable reasons this template was selected. */
  rationale: string[];
  /** Demo-honesty marker: the plan is a synthetic/illustrative template fill. */
  synthetic: true;
};

const AGE_BAND_ORDER: Record<string, number> = {
  "<40": 0,
  "40-45": 1,
  "45-49": 2,
  "46-50": 2,
  "50-54": 3,
  "51-55": 3,
  "55-59": 4,
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

/**
 * Deterministically choose which template applies to a context, with an
 * explicit precedence order (mood → HRT → bone-health → vasomotor default) and
 * a rationale line for the chosen branch. Pure — same inputs, same template.
 */
function selectTemplate(ctx: CarePlanContext): {
  template: CarePlanTemplate;
  rationale: string[];
} {
  const rationale: string[] = [];

  // 1. A behavioral-health pathway or a mood-dominant presentation → the
  //    mood/behavioral plan (highest precedence: mood safety leads the plan).
  if (ctx.pathway === "behavioral-health-handoff" || ctx.primarySymptom === "mood") {
    rationale.push(
      ctx.pathway === "behavioral-health-handoff"
        ? "Care Router routed to a behavioral-health handoff; the plan centers on mood support."
        : "Primary symptom is in the mood domain; the plan centers on mood support."
    );
    return { template: TEMPLATE_BY_ID.get("careplan.mood-behavioral")!, rationale };
  }

  // 2. Patient on hormone therapy → the HRT-management plan.
  if (ctx.onHrt === true) {
    rationale.push("Patient is on hormone therapy; the plan manages the HRT course.");
    return { template: TEMPLATE_BY_ID.get("careplan.hrt-management")!, rationale };
  }

  // 3. Postmenopausal or older age band → the bone-health plan.
  if (isPostmenopausal(ctx.cycleStatus) || ageBandAtLeast(ctx.ageBand, "51-55")) {
    rationale.push(
      isPostmenopausal(ctx.cycleStatus)
        ? "Patient is postmenopausal (12+ months amenorrhea); the plan prioritizes bone health."
        : "Patient is in an older menopause age band; the plan prioritizes bone health."
    );
    return { template: TEMPLATE_BY_ID.get("careplan.bone-health")!, rationale };
  }

  // 4. Default: vasomotor / lifestyle plan.
  rationale.push(
    "Vasomotor / lifestyle plan selected as the default menopause management track."
  );
  return { template: TEMPLATE_BY_ID.get("careplan.vasomotor-lifestyle")!, rationale };
}

/**
 * Deterministically adjust the template's follow-up cadence for severity: a
 * severe presentation tightens the interval, a mild one relaxes it. Pure.
 */
function adjustCadenceForSeverity(
  cadence: FollowUpCadence,
  severity: string | undefined
): FollowUpCadence {
  if (severity === "severe") {
    const intervalDays = Math.max(7, Math.round(cadence.intervalDays / 2));
    return {
      ...cadence,
      intervalDays,
      description: `${cadence.description} — tightened to ~${intervalDays} days for a severe presentation`
    };
  }
  if (severity === "mild") {
    const intervalDays = Math.round(cadence.intervalDays * 1.5);
    return {
      ...cadence,
      intervalDays,
      description: `${cadence.description} — relaxed to ~${intervalDays} days for a mild presentation`
    };
  }
  return cadence;
}

/**
 * Instantiate a menopause care plan from a defined template. DETERMINISTIC:
 * selects the template from the Care Router pathway/severity + intake, fills the
 * goals/interventions, and adjusts the follow-up cadence for severity — no
 * randomness, no clock. The returned plan.templateId is always a catalog id by
 * construction (the governance-integrity property the Agent Fabric enforces).
 */
export function instantiateCarePlan(ctx: CarePlanContext): InstantiatedCarePlan {
  const { template, rationale } = selectTemplate(ctx);
  const severity = ctx.severity && ctx.severity.length > 0 ? ctx.severity : "unspecified";
  const followUp = adjustCadenceForSeverity(template.followUpCadence, ctx.severity);

  return {
    templateId: template.id,
    templateLabel: template.label,
    patientDisplayName: ctx.preferredName?.trim() || "the patient",
    pathway: ctx.pathway,
    severity,
    // Copy the structured content so a caller can't mutate the catalog.
    goals: template.goals.map((g) => ({ ...g })),
    interventions: template.interventions.map((i) => ({ ...i })),
    followUp,
    rationale,
    synthetic: true
  };
}

/**
 * Integrity check: does the plan derive from a defined care-plan template
 * catalog id? True for anything instantiateCarePlan() produces; the guard that
 * catches a caller-asserted, free-invented (off-catalog) plan. This is the
 * honest signal the route reports to policy.careplan.template-sourced.
 */
export function planTracesToTemplate(
  plan: Pick<InstantiatedCarePlan, "templateId"> | null | undefined
): boolean {
  if (!plan || typeof plan.templateId !== "string") return false;
  return isCatalogTemplate(plan.templateId);
}

/** Result of summarizing a care plan — mirrors the Care Router's provenance. */
export type CarePlanSummaryResult = {
  /** The patient/clinician-facing progress summary text. */
  summary: string;
  /** Which path produced the summary. */
  via: "claude-api" | "scripted-fallback";
  modelProvenance: {
    provider: "anthropic" | "pause-scripted";
    model: string;
    via: "claude-api" | "scripted-fallback";
  };
  /**
   * Short, non-clinical diagnostic explaining WHY the deterministic scripted
   * summary was used instead of a live Claude summary. Present only when
   * `via === "scripted-fallback"` — carries just the leading diagnostic sentence
   * ("Claude API call failed (…)" / "ANTHROPIC_API_KEY not set…"), never
   * patient-derived clinical text, so it is safe to record as a trace-span
   * attribute. Undefined on a successful `claude-api` summary.
   */
  fallbackReason?: string;
};

const PATHWAY_PROSE: Record<string, string> = {
  "self-care-tracking": "self-care with symptom tracking",
  "mscp-virtual-visit": "a virtual menopause-specialist visit",
  "mscp-in-person": "an in-person menopause-specialist visit",
  "urgent-gynecology": "an urgent gynecology review",
  "behavioral-health-handoff": "a behavioral-health handoff",
  "ed-referral": "an emergency-department referral"
};

/**
 * Deterministic scripted care-plan summary. Always available; used as the
 * fallback when the Anthropic SDK call fails or the key is unset. Non-
 * prescriptive by construction — it reports the plan's goals, interventions,
 * and follow-up cadence and never adds or changes a medication/order.
 */
export function scriptedSummarizeCarePlan(plan: InstantiatedCarePlan): string {
  const pathwayProse = PATHWAY_PROSE[plan.pathway] ?? plan.pathway;
  const goals = plan.goals.map((g) => g.description).join("; ");
  const interventions = plan.interventions.map((i) => i.description).join("; ");
  return [
    `Care-plan progress summary for ${plan.patientDisplayName}: enrolled on the ${plan.templateLabel} (${plan.severity} presentation), following ${pathwayProse}.`,
    `Goals: ${goals}.`,
    `Current interventions: ${interventions}.`,
    `Next follow-up: every ~${plan.followUp.intervalDays} days via ${plan.followUp.modality} (${plan.followUp.description}).`,
    `This is a progress summary only and does not add or change any prescription, medication, dose, or order.`
  ].join(" ");
}

/**
 * Live Anthropic SDK call producing a concise, NON-PRESCRIPTIVE progress
 * summary. Loaded dynamically so @anthropic-ai/sdk only resolves when
 * ANTHROPIC_API_KEY is set — mirrors lib/care-router.ts EXACTLY:
 *
 *   - missing ANTHROPIC_API_KEY short-circuits to the deterministic scripted
 *     summary WITHOUT importing the SDK, stamping a `fallbackReason`;
 *   - any SDK/transport/parse error falls back to the scripted summary and
 *     stamps a `fallbackReason` naming the failure;
 *   - the model is configurable via PAUSE_CARE_PLAN_MODEL and defaults to the
 *     SAME model the Care Router uses (claude-sonnet-4-5-20250929).
 *
 * The summary is free text (not JSON), so no JSON extraction is needed; we take
 * the first text content block. This makes the Care Plan agent the SECOND
 * live-Claude agent after the Care Router.
 */
export async function summarizeCarePlan(
  plan: InstantiatedCarePlan
): Promise<CarePlanSummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const reason =
      "ANTHROPIC_API_KEY not set; using deterministic Pause care-plan summarizer.";
    return {
      summary: scriptedSummarizeCarePlan(plan),
      via: "scripted-fallback",
      modelProvenance: {
        provider: "pause-scripted",
        model: "pause-care-plan-summarizer@1.0",
        via: "scripted-fallback"
      },
      fallbackReason: reason
    };
  }

  const model =
    process.env.PAUSE_CARE_PLAN_MODEL ?? "claude-sonnet-4-5-20250929";

  try {
    const mod = (await import("@anthropic-ai/sdk")).default;
    const client = new mod({ apiKey });

    const systemPrompt = [
      "You are the Pause-Health.ai Care Plan agent.",
      "Given a DETERMINISTICALLY-instantiated menopause care plan (a template",
      "with structured goals, interventions, and a follow-up cadence), write a",
      "concise progress summary for a patient and their clinician.",
      "Rules you must honor without exception:",
      "  - Be NON-PRESCRIPTIVE: never add or change a medication, dose, order,",
      "    prescription, or lab. Summarize the existing plan only.",
      "  - Do not invent goals or interventions beyond the ones provided.",
      "  - Keep it to a short paragraph (3-5 sentences), plain and supportive.",
      "Reply with the summary text only — no preamble, no JSON, no code fences."
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        templateId: plan.templateId,
        templateLabel: plan.templateLabel,
        patient: plan.patientDisplayName,
        pathway: plan.pathway,
        severity: plan.severity,
        goals: plan.goals,
        interventions: plan.interventions,
        followUp: plan.followUp
      },
      null,
      2
    );

    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const textPart = resp.content.find(
      (c: { type: string }) => c.type === "text"
    ) as { type: "text"; text: string } | undefined;
    if (!textPart) throw new Error("Claude response had no text content");
    const summary = textPart.text.trim();
    if (summary.length === 0) throw new Error("Claude response was empty");

    return {
      summary,
      via: "claude-api",
      modelProvenance: { provider: "anthropic", model, via: "claude-api" }
    };
  } catch (err) {
    const reason = `Claude API call failed (${(err as Error).message}); using deterministic Pause care-plan summarizer.`;
    return {
      summary: scriptedSummarizeCarePlan(plan),
      via: "scripted-fallback",
      modelProvenance: {
        provider: "pause-scripted",
        model: "pause-care-plan-summarizer@1.0",
        via: "scripted-fallback"
      },
      fallbackReason: reason
    };
  }
}
