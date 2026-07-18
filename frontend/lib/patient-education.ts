/**
 * synthetic / demo
 *
 * Patient Education & Health Coaching Agent — personalized, evidence-sourced
 * menopause/midlife education + lifestyle coaching.
 *
 * The domain core the Patient Education agent (app/api/agents/patient-education)
 * wraps — a patient-facing ENGAGEMENT-tier agent that turns already-produced
 * signals (intake symptoms/severity, an optional validated-instrument
 * assessment, care-plan focus areas, and detected care gaps) into
 * patient-friendly educational guidance and motivational coaching. It is
 * distinct from the Care Plan agent (clinician-authored goals/interventions/
 * cadence) and the Medication Adherence agent (refill/adherence nudges): it
 * only EDUCATES and COACHES on general, evidence-sourced topics.
 *
 * Two halves, mirroring lib/care-plan.ts EXACTLY:
 *
 *   1. buildEducationCurriculum() — DETERMINISTIC. Given the upstream signals it
 *      selects a set of education modules from a defined evidence-sourced
 *      catalog (bone health, cardiovascular risk, sleep hygiene, vasomotor
 *      self-management, mood/stress, nutrition, physical activity). There is NO
 *      randomness and NO clock: the same context always yields the same
 *      curriculum, which is what lets the demo, the seeded trace, and the tests
 *      agree. The load-bearing governance property is integrity — every module
 *      references a defined catalog id AND carries an evidence source, never a
 *      fabricated one (curriculumTracesToEvidenceSource() is the honest signal
 *      the route reports to policy.education.evidence-sourced).
 *
 *   2. coachEducation() — the LIVE-CLAUDE half. Follows lib/care-plan.ts
 *      EXACTLY: it calls Claude to write a warm, motivational coaching message
 *      that draws ONLY on the selected modules, gated by ANTHROPIC_API_KEY. On a
 *      missing key OR any SDK/transport error it falls back to a DETERMINISTIC
 *      scripted coaching message and stamps a non-clinical `fallbackReason`. The
 *      result carries `via: "claude-api" | "scripted-fallback"` so the Agent
 *      Fabric trace can show which path served the message. This makes the
 *      Patient Education agent the FOURTH live-Claude agent (after the Care
 *      Router, the Care Plan agent, and the Clinical Summary agent); it reuses
 *      the same Anthropic model + client setup and the model-allow-list policy.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified patient-education engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The education modules — their key points and SOURCE labels ("The Menopause
 *  Society", "USPSTF", "NAMS/ACOG-style", etc.) below — are ILLUSTRATIVE,
 *  synthetic/demo values chosen to model the SHAPE of evidence-sourced
 *  education. They are NOT verbatim guideline text and the source labels are
 *  synthetic attributions, not citations. The coaching message is general
 *  education only: it is deliberately scoped so it never gives a diagnosis, a
 *  medication dose, or individualized medical advice.
 */

import type { IntakeRecord } from "./care-router";

/**
 * A single evidence-sourced education module. This is the ONLY source of
 * legitimate education content — buildEducationCurriculum() selects from these,
 * so a curriculum can never reference a module that isn't defined here.
 * Illustrative/synthetic values; NOT a certified patient-education engine (see
 * header). The `source` is a clearly-labeled SYNTHETIC attribution.
 */
export type EducationModule = {
  /** Stable catalog id every curriculum module must reference. */
  id: string;
  /** Human-readable module label. */
  label: string;
  /** Focus domain used for deterministic selection. */
  focus:
    | "bone"
    | "cardiovascular"
    | "sleep"
    | "vasomotor"
    | "mood"
    | "nutrition"
    | "activity";
  /** Illustrative one-line description of what the module teaches. */
  summary: string;
  /** A few patient-friendly, general key points (never dosing/diagnosis). */
  keyPoints: string[];
  /**
   * SYNTHETIC evidence-source label the module is attributed to (e.g. "The
   * Menopause Society", "USPSTF", "NAMS/ACOG-style"). Illustrative — NOT a
   * citation. Every module MUST carry a non-empty source; that is the honest
   * property the evidence-sourced policy enforces.
   */
  source: string;
  /** Demo-honesty marker: the module is a synthetic/illustrative topic. */
  synthetic: true;
};

/**
 * The education-module catalog. Illustrative/synthetic — NOT certified guideline
 * text; the source labels are synthetic attributions. buildEducationCurriculum()
 * selects only from this list, so every curriculum module id is a catalog id by
 * construction.
 */
export const EDUCATION_MODULES: EducationModule[] = [
  {
    id: "education.bone-health",
    label: "Bone health through menopause",
    focus: "bone",
    summary:
      "Why bone density changes around menopause and the general, everyday habits that help protect it. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "Estrogen decline can accelerate bone loss during the menopause transition",
      "Weight-bearing and resistance activity most days supports bone strength",
      "Adequate dietary calcium and vitamin D are part of general bone health",
      "Ask your clinician whether a bone-density (DEXA) screening is due for you"
    ],
    source: "The Menopause Society (illustrative)",
    synthetic: true
  },
  {
    id: "education.cardiovascular",
    label: "Heart & cardiovascular health at midlife",
    focus: "cardiovascular",
    summary:
      "How cardiovascular risk shifts at midlife and the general lifestyle levers that support heart health. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "Cardiovascular risk tends to rise after menopause",
      "Blood pressure, cholesterol, and activity are general levers worth tracking with your clinician",
      "A heart-healthy eating pattern and regular movement support cardiovascular health",
      "Preventive screenings (e.g. lipid panel, blood pressure) are worth keeping current"
    ],
    source: "USPSTF-style (illustrative)",
    synthetic: true
  },
  {
    id: "education.sleep-hygiene",
    label: "Sleep hygiene for midlife",
    focus: "sleep",
    summary:
      "Practical sleep-hygiene habits for disrupted midlife sleep, including night sweats. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "A consistent sleep and wake time helps stabilize sleep",
      "A cool, dark bedroom can ease night sweats and improve sleep quality",
      "Limiting caffeine and alcohol later in the day supports deeper sleep",
      "A wind-down routine away from screens can make falling asleep easier"
    ],
    source: "NAMS/ACOG-style (illustrative)",
    synthetic: true
  },
  {
    id: "education.vasomotor",
    label: "Managing hot flashes & night sweats",
    focus: "vasomotor",
    summary:
      "General, non-pharmacologic self-management strategies for vasomotor symptoms. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "Identifying and easing personal triggers (heat, caffeine, alcohol, stress) can reduce episodes",
      "Layered clothing and cooling strategies help manage hot flashes day-to-day",
      "Paced breathing and stress reduction are general techniques some find helpful",
      "Your clinician can discuss the full range of options if symptoms are disruptive"
    ],
    source: "The Menopause Society (illustrative)",
    synthetic: true
  },
  {
    id: "education.mood-stress",
    label: "Mood & stress during the transition",
    focus: "mood",
    summary:
      "General education on mood changes at midlife and everyday stress-management strategies. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "Mood changes are common during the menopause transition",
      "Regular activity, sleep, and social connection support mood",
      "Mindfulness and stress-reduction practices are general, everyday tools",
      "If low mood persists or worsens, reaching out to your clinician is important"
    ],
    source: "NAMS/ACOG-style (illustrative)",
    synthetic: true
  },
  {
    id: "education.nutrition",
    label: "Nutrition foundations at midlife",
    focus: "nutrition",
    summary:
      "General, foundational nutrition education for midlife health. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "A balanced eating pattern rich in vegetables, whole grains, and lean protein supports midlife health",
      "Adequate calcium and vitamin D are part of general bone and overall health",
      "Staying hydrated and moderating caffeine/alcohol can help with symptoms and sleep",
      "A registered dietitian can tailor general guidance to your preferences"
    ],
    source: "USPSTF-style (illustrative)",
    synthetic: true
  },
  {
    id: "education.physical-activity",
    label: "Physical activity for midlife health",
    focus: "activity",
    summary:
      "General physical-activity guidance for bone, heart, mood, and sleep. (Illustrative — not certified guideline text.)",
    keyPoints: [
      "A mix of aerobic activity and strength training supports bone, heart, and mood",
      "Most days of movement — even short walks — adds up",
      "Building activity gradually and sustainably is more effective than intense bursts",
      "Choosing activities you enjoy makes a routine easier to keep"
    ],
    source: "USPSTF-style (illustrative)",
    synthetic: true
  }
];

const MODULE_BY_ID = new Map(EDUCATION_MODULES.map((m) => [m.id, m]));

/** Is `id` a defined education-module catalog id? */
export function isCatalogModule(id: string): boolean {
  return MODULE_BY_ID.has(id);
}

/** Look up an education module by id (undefined for an off-catalog id). */
export function getEducationModule(id: string): EducationModule | undefined {
  return MODULE_BY_ID.get(id);
}

/**
 * The inputs the curriculum builder selects modules from. Derived
 * deterministically from the intake + already-produced upstream signals (no
 * clock, no randomness). Every field is optional.
 */
export type EducationContext = {
  /** Primary reported symptom (e.g. "vasomotor", "mood", "sleep"). */
  primarySymptom?: string;
  /** The intake severity band (mild/moderate/severe), when captured. */
  severity?: IntakeRecord["severity"];
  /** Age band from the unified patient view. */
  ageBand?: string;
  /** Cycle status, e.g. "perimenopausal", "stopped>=12mo". */
  cycleStatus?: string;
  /** Whether the patient is currently on hormone therapy. */
  onHrt?: boolean;
  /** Patient display name for the coaching message (falls back to a neutral phrase). */
  preferredName?: string;
  /**
   * Focus areas surfaced by the Care Plan agent (illustrative labels/ids the
   * curriculum can key off of, e.g. "bone", "cardiovascular", or a care-plan
   * template id). Used only to steer selection; never trusted as content.
   */
  carePlanFocusAreas?: string[];
  /**
   * Detected care-gap measure ids/labels (e.g. "measure.dexa", "lipid panel").
   * Used only to steer selection toward the relevant education module.
   */
  careGapMeasures?: string[];
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

/** Build an EducationContext from an intake + optional upstream signals. */
export function educationContextFromIntake(
  intake: IntakeRecord,
  extra: {
    onHrt?: boolean;
    carePlanFocusAreas?: string[];
    careGapMeasures?: string[];
  } = {}
): EducationContext {
  return {
    primarySymptom: intake.primarySymptom,
    severity: intake.severity,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus,
    preferredName: intake.preferredName,
    ...(extra.onHrt !== undefined ? { onHrt: extra.onHrt } : {}),
    ...(extra.carePlanFocusAreas ? { carePlanFocusAreas: extra.carePlanFocusAreas } : {}),
    ...(extra.careGapMeasures ? { careGapMeasures: extra.careGapMeasures } : {})
  };
}

/** A deterministically-built education curriculum — always catalog modules. */
export type EducationCurriculum = {
  /** The catalog module ids this curriculum is composed of (never invented). */
  moduleIds: string[];
  /** The selected modules, copied from the catalog for display convenience. */
  modules: EducationModule[];
  /** Neutral patient display name used in the coaching message. */
  patientDisplayName: string;
  /** The distinct focus areas the curriculum covers. */
  focusAreas: string[];
  /** Deterministic, human-readable reasons each module was selected. */
  rationale: string[];
  /** Demo-honesty marker: the curriculum is a synthetic/illustrative selection. */
  synthetic: true;
};

function addModule(
  set: Map<string, EducationModule>,
  rationale: string[],
  id: string,
  reason: string
): void {
  const found = MODULE_BY_ID.get(id);
  if (found && !set.has(id)) {
    set.set(id, found);
    rationale.push(reason);
  }
}

function textIncludes(values: string[] | undefined, needle: string): boolean {
  if (!values) return false;
  return values.some((v) => v.toLowerCase().includes(needle));
}

/**
 * Deterministically choose which education modules apply to a context, with an
 * explicit, layered selection order and a rationale line per chosen module.
 * Pure — same inputs, same module set. Always yields at least one module
 * (physical activity is the universal foundation).
 */
function selectModules(ctx: EducationContext): {
  modules: EducationModule[];
  rationale: string[];
} {
  const set = new Map<string, EducationModule>();
  const rationale: string[] = [];

  // 1. Primary-symptom-driven modules.
  if (ctx.primarySymptom === "vasomotor") {
    addModule(set, rationale, "education.vasomotor", "Primary symptom is vasomotor; included hot-flash/night-sweat self-management.");
    addModule(set, rationale, "education.sleep-hygiene", "Vasomotor symptoms disrupt sleep; included sleep hygiene.");
  }
  if (ctx.primarySymptom === "sleep") {
    addModule(set, rationale, "education.sleep-hygiene", "Primary symptom is sleep; included sleep hygiene.");
  }
  if (ctx.primarySymptom === "mood") {
    addModule(set, rationale, "education.mood-stress", "Primary symptom is in the mood domain; included mood & stress education.");
  }

  // 2. Menopause-stage / age-driven preventive modules.
  if (isPostmenopausal(ctx.cycleStatus) || ageBandAtLeast(ctx.ageBand, "51-55")) {
    addModule(set, rationale, "education.bone-health", "Postmenopausal / older age band; included bone-health education.");
    addModule(set, rationale, "education.cardiovascular", "Postmenopausal / older age band; included cardiovascular-health education.");
  }

  // 3. Upstream care-plan focus areas.
  if (textIncludes(ctx.carePlanFocusAreas, "bone")) {
    addModule(set, rationale, "education.bone-health", "Care-plan focus includes bone health; included bone-health education.");
  }
  if (
    textIncludes(ctx.carePlanFocusAreas, "cardio") ||
    textIncludes(ctx.carePlanFocusAreas, "cvd")
  ) {
    addModule(set, rationale, "education.cardiovascular", "Care-plan focus includes cardiovascular risk; included cardiovascular-health education.");
  }
  if (textIncludes(ctx.carePlanFocusAreas, "mood")) {
    addModule(set, rationale, "education.mood-stress", "Care-plan focus includes mood; included mood & stress education.");
  }

  // 4. Detected care gaps → the matching education module.
  if (
    textIncludes(ctx.careGapMeasures, "dexa") ||
    textIncludes(ctx.careGapMeasures, "bone")
  ) {
    addModule(set, rationale, "education.bone-health", "A bone-density care gap was detected; included bone-health education.");
  }
  if (
    textIncludes(ctx.careGapMeasures, "lipid") ||
    textIncludes(ctx.careGapMeasures, "cholesterol")
  ) {
    addModule(set, rationale, "education.cardiovascular", "A lipid/cardiovascular care gap was detected; included cardiovascular-health education.");
  }

  // 5. Foundational modules everyone gets (nutrition + physical activity).
  addModule(set, rationale, "education.nutrition", "Foundational nutrition education included for every plan.");
  addModule(set, rationale, "education.physical-activity", "Foundational physical-activity education included for every plan.");

  // Keep the output ordered by the catalog for stable, deterministic display.
  const ordered = EDUCATION_MODULES.filter((m) => set.has(m.id));
  return { modules: ordered, rationale };
}

/**
 * Build a menopause/midlife education curriculum from the context.
 * DETERMINISTIC: selects modules from the defined catalog based on the intake +
 * upstream signals — no randomness, no clock. Every module id is a catalog id
 * by construction (the governance-integrity property the Agent Fabric enforces).
 */
export function buildEducationCurriculum(ctx: EducationContext): EducationCurriculum {
  const { modules, rationale } = selectModules(ctx);
  const focusAreas = Array.from(new Set(modules.map((m) => m.focus)));
  return {
    moduleIds: modules.map((m) => m.id),
    // Copy the structured content so a caller can't mutate the catalog.
    modules: modules.map((m) => ({ ...m, keyPoints: m.keyPoints.slice() })),
    patientDisplayName: ctx.preferredName?.trim() || "the patient",
    focusAreas,
    rationale,
    synthetic: true
  };
}

/**
 * Integrity check: does the curriculum derive entirely from defined,
 * evidence-sourced education modules? True for anything
 * buildEducationCurriculum() produces (every module is a catalog module with a
 * non-empty source); the guard that catches a caller-asserted, free-invented
 * (off-catalog) module or one missing an evidence source. This is the honest
 * signal the route reports to policy.education.evidence-sourced.
 */
export function curriculumTracesToEvidenceSource(
  curriculum:
    | Pick<EducationCurriculum, "modules">
    | { modules?: Array<{ id?: unknown; source?: unknown }> }
    | null
    | undefined
): boolean {
  if (!curriculum || !Array.isArray(curriculum.modules)) return false;
  if (curriculum.modules.length === 0) return false;
  return curriculum.modules.every((m) => {
    if (!m || typeof m.id !== "string") return false;
    if (!isCatalogModule(m.id)) return false;
    return typeof m.source === "string" && m.source.trim().length > 0;
  });
}

/**
 * Scope guard: general education/coaching never delivers a diagnosis, a
 * medication dose, or individualized medical advice. Returns false ONLY when the
 * caller asserts the content will do so (which the route reports to
 * policy.education.no-medical-advice), so a well-formed education task stays in
 * scope by construction.
 */
export function coachingStaysWithinEducationScope(
  input: { assertsMedicalAdvice?: boolean } | null | undefined
): boolean {
  if (!input) return true;
  return input.assertsMedicalAdvice !== true;
}

/** Result of coaching — mirrors the Care Plan summary's provenance. */
export type EducationCoachingResult = {
  /** The patient-facing, motivational coaching message. */
  coachingMessage: string;
  /**
   * The module ids the message draws from — copied DETERMINISTICALLY from the
   * curriculum (never model-derived), so the grounding holds regardless of which
   * path served the phrasing.
   */
  moduleIds: string[];
  /** Which path produced the message. */
  via: "claude-api" | "scripted-fallback";
  modelProvenance: {
    provider: "anthropic" | "pause-scripted";
    model: string;
    via: "claude-api" | "scripted-fallback";
  };
  /**
   * Short, non-clinical diagnostic explaining WHY the deterministic scripted
   * coaching was used instead of a live Claude message. Present only when
   * `via === "scripted-fallback"` — carries just the leading diagnostic sentence
   * ("Claude API call failed (…)" / "ANTHROPIC_API_KEY not set…"), never
   * patient-derived clinical text, so it is safe to record as a trace-span
   * attribute. Undefined on a successful `claude-api` message.
   */
  fallbackReason?: string;
  /** Demo-honesty marker: the coaching is synthetic/illustrative. */
  synthetic: true;
};

/**
 * Deterministic scripted coaching message. Always available; used as the
 * fallback when the Anthropic SDK call fails or the key is unset. General
 * education by construction — it draws ONLY on the selected modules' key points
 * and never gives a diagnosis, a dose, or individualized medical advice.
 */
export function scriptedCoachEducation(curriculum: EducationCurriculum): string {
  const name = curriculum.patientDisplayName;
  const topics = curriculum.modules.map((m) => m.label).join("; ");
  const highlights = curriculum.modules
    .map((m) => `${m.label} — ${m.keyPoints[0]} (${m.source})`)
    .join(" ");
  return [
    `Hi ${name}, here is your personalized menopause & midlife education for this check-in, covering: ${topics}.`,
    `A few things to focus on: ${highlights}`,
    `Small, steady habits add up — pick one area to start with this week.`,
    `This is general education and lifestyle coaching only; it does not diagnose a condition, set a medication dose, or replace individualized advice from your clinician.`
  ].join(" ");
}

function scriptedResult(
  curriculum: EducationCurriculum,
  fallbackReason: string
): EducationCoachingResult {
  return {
    coachingMessage: scriptedCoachEducation(curriculum),
    moduleIds: curriculum.moduleIds.slice(),
    via: "scripted-fallback",
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-patient-education-coach@1.0",
      via: "scripted-fallback"
    },
    fallbackReason,
    synthetic: true
  };
}

/**
 * Live Anthropic SDK call producing a warm, motivational coaching message that
 * draws ONLY on the selected modules. Loaded dynamically so @anthropic-ai/sdk
 * only resolves when ANTHROPIC_API_KEY is set — mirrors lib/care-plan.ts EXACTLY:
 *
 *   - missing ANTHROPIC_API_KEY short-circuits to the deterministic scripted
 *     coaching WITHOUT importing the SDK, stamping a `fallbackReason`;
 *   - any SDK/transport error falls back to the scripted coaching and stamps a
 *     `fallbackReason` naming the failure;
 *   - the model is configurable via PAUSE_PATIENT_EDUCATION_MODEL and defaults to
 *     the SAME model the Care Router / Care Plan / Clinical Summary use
 *     (claude-sonnet-4-5-20250929).
 *
 * The message is free text (not JSON), so no JSON extraction is needed; we take
 * the first text content block. This makes the Patient Education agent the
 * FOURTH live-Claude agent. The result's `moduleIds` are ALWAYS the curriculum's
 * — the grounding is deterministic and never taken from the model.
 */
export async function coachEducation(
  curriculum: EducationCurriculum,
  opts: { model?: string } = {}
): Promise<EducationCoachingResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return scriptedResult(
      curriculum,
      "ANTHROPIC_API_KEY not set; using deterministic Pause patient-education coach."
    );
  }

  const model =
    opts.model ??
    process.env.PAUSE_PATIENT_EDUCATION_MODEL ??
    "claude-sonnet-4-5-20250929";

  try {
    const mod = (await import("@anthropic-ai/sdk")).default;
    const client = new mod({ apiKey });

    const systemPrompt = [
      "You are the Pause-Health.ai Patient Education & Health Coaching agent.",
      "Given a DETERMINISTICALLY-selected set of evidence-sourced education",
      "modules (each with key points and a source), write a warm, motivational",
      "coaching message for a patient going through menopause / midlife.",
      "Rules you must honor without exception:",
      "  - GENERAL EDUCATION ONLY: never give a diagnosis, a medication name or",
      "    dose, or individualized medical advice. Encourage the patient to talk",
      "    to their clinician for anything specific to them.",
      "  - Draw ONLY on the provided modules; do not invent facts or sources.",
      "  - Be supportive and motivational, and keep it to a short message",
      "    (3-6 sentences), plain and encouraging.",
      "Reply with the coaching message text only — no preamble, no JSON, no code fences."
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        patient: curriculum.patientDisplayName,
        focusAreas: curriculum.focusAreas,
        modules: curriculum.modules.map((m) => ({
          id: m.id,
          label: m.label,
          keyPoints: m.keyPoints,
          source: m.source
        }))
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
    const coachingMessage = textPart.text.trim();
    if (coachingMessage.length === 0) throw new Error("Claude response was empty");

    return {
      coachingMessage,
      moduleIds: curriculum.moduleIds.slice(),
      via: "claude-api",
      modelProvenance: { provider: "anthropic", model, via: "claude-api" },
      synthetic: true
    };
  } catch (err) {
    return scriptedResult(
      curriculum,
      `Claude API call failed (${(err as Error).message}); using deterministic Pause patient-education coach.`
    );
  }
}
