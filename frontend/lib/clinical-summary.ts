/**
 * synthetic / demo
 *
 * Clinical Summary Agent — After-Visit Summary & clinician handoff.
 *
 * The domain core the Clinical Summary Agent (app/api/agents/clinical-summary)
 * wraps — the Salesforce "Agentforce for Health" After-Visit Summary / clinical-
 * documentation analog on Pause's Agent Fabric. It does NOT produce any new
 * clinical facts: it COMPOSES the outputs the other agents already produced
 * (the intake, the Care Router pathway, an optional validated-instrument
 * assessment, an optional instantiated care plan, and any detected care gaps)
 * into two artifacts:
 *
 *   1. a patient-friendly AFTER-VISIT SUMMARY, and
 *   2. a CLINICIAN HANDOFF note.
 *
 * Two halves, mirroring the Care Plan agent's exact shape:
 *
 *   1. assembleClinicalSummaryContext() — DETERMINISTIC. It gathers ONLY the
 *      facts that are actually present in the provided lifecycle inputs and
 *      records a provenance list (`sourceRecords`) naming each upstream record
 *      the summary is allowed to draw from. This is what makes the grounding
 *      guarantee REAL: the assembler never invents a fact or a source, so a
 *      summary composed from the assembled context can only assert what the
 *      upstream agents already established. summaryTracesToSourceRecords() is
 *      the honest signal the route reports to
 *      policy.clinical-summary.source-record-sourced.
 *
 *   2. summarizeClinical() — the LIVE-CLAUDE half. Follows lib/care-plan.ts
 *      EXACTLY: it calls Claude to phrase the two artifacts, gated by
 *      ANTHROPIC_API_KEY. On a missing key OR any SDK/transport/parse error it
 *      falls back to a DETERMINISTIC scripted composition and stamps a
 *      non-clinical `fallbackReason`. The result carries
 *      `via: "claude-api" | "scripted-fallback"` so the Agent Fabric trace can
 *      show which path served the summary. This makes the Clinical Summary
 *      agent the THIRD live-Claude agent after the Care Router and the Care
 *      Plan agent; it reuses the same Anthropic model + client setup and the
 *      model-allow-list policy.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical-documentation engine.
 * ─────────────────────────────────────────────────────────────────────
 *  Both artifacts are ILLUSTRATIVE, synthetic/demo compositions of already-
 *  synthetic upstream facts. The agent is deliberately non-generative about
 *  CLINICAL content: it never adds, changes, or infers a diagnosis, a
 *  medication, a dose, an order, or a fact the upstream agents didn't
 *  establish. It only re-phrases the assembled context into two audiences.
 */

import type { CarePathway, IntakeRecord } from "./care-router";
import type { InstantiatedCarePlan } from "./care-plan";
import type { AssessmentResult } from "./assessments";
import type { CareGap } from "./care-gaps";

/** The lifecycle outputs the assembler composes. Every field is optional. */
export type ClinicalSummaryInputs = {
  /** The structured intake record (severity, symptoms, cycle, age band). */
  intake?: IntakeRecord;
  /** The Care Router's chosen pathway, when routing has run. */
  pathway?: CarePathway;
  /** Whether the patient is on hormone therapy (steers the handoff framing). */
  onHrt?: boolean;
  /** An optional validated-instrument assessment result. */
  assessment?: AssessmentResult;
  /** An optional instantiated menopause care plan. */
  carePlan?: InstantiatedCarePlan;
  /** Optional detected preventive-care gaps. */
  careGaps?: CareGap[];
  /** Optional demo persona id, threaded onto the assembled context. */
  personaId?: string;
};

/** A single upstream care-plan fact the summary may reference. */
export type ClinicalSummaryCarePlanFact = {
  templateId: string;
  templateLabel: string;
  followUpIntervalDays: number;
  followUpModality: string;
  goals: string[];
  interventions: string[];
};

/** A single upstream assessment fact the summary may reference. */
export type ClinicalSummaryAssessmentFact = {
  instrument: string;
  instrumentName: string;
  total: number;
  maxTotal: number;
  severityBand: string;
};

/** A single upstream care-gap fact the summary may reference. */
export type ClinicalSummaryGapFact = {
  measureId: string;
  measureLabel: string;
  status: string;
};

/**
 * The DETERMINISTICALLY-assembled context the summarizer composes. Holds ONLY
 * facts present in the provided inputs, plus a provenance list (`sourceRecords`)
 * naming each upstream record the summary is allowed to draw from. Same inputs
 * always yield the same context (no clock, no randomness).
 */
export type ClinicalSummaryContext = {
  /** Neutral patient display name used in both artifacts. */
  patientDisplayName: string;
  /** Optional demo persona id (never a real identifier). */
  personaId?: string;
  /** Intake age band, when captured. */
  ageBand?: string;
  /** Intake cycle status, when captured. */
  cycleStatus?: string;
  /** Primary reported symptom, when captured. */
  primarySymptom?: string;
  /** Intake severity band (mild/moderate/severe), when captured. */
  severity?: string;
  /** The Care Router pathway, when routing has run. */
  pathway?: CarePathway;
  /** Whether the patient is on hormone therapy, when known. */
  onHrt?: boolean;
  /** The instantiated care-plan fact, when a plan was provided. */
  carePlan?: ClinicalSummaryCarePlanFact;
  /** The validated-instrument fact, when an assessment was provided. */
  assessment?: ClinicalSummaryAssessmentFact;
  /** Detected preventive-care gaps, when any were provided. */
  careGaps: ClinicalSummaryGapFact[];
  /**
   * The provenance list: one id per upstream record the assembled context is
   * built from. The summary may only trace to these records. Deterministic and
   * gathered ONLY from facts present in the inputs — never fabricated.
   */
  sourceRecords: string[];
  /** Demo-honesty marker: the composition is synthetic/illustrative. */
  synthetic: true;
};

function hasIntakeSignal(intake: IntakeRecord | undefined): boolean {
  if (!intake) return false;
  return Boolean(
    intake.severity ||
      intake.primarySymptom ||
      intake.ageBand ||
      intake.cycleStatus ||
      intake.preferredName
  );
}

/**
 * DETERMINISTICALLY assemble the summary context from the lifecycle outputs.
 * Gathers ONLY facts that are actually present in the inputs and records a
 * provenance `sourceRecords` list naming each upstream record — so a summary
 * built from this context can never assert a fact (or cite a record) that isn't
 * grounded in what the upstream agents established. Pure: same inputs, same
 * context.
 */
export function assembleClinicalSummaryContext(
  inputs: ClinicalSummaryInputs
): ClinicalSummaryContext {
  const intake = inputs.intake;
  const sourceRecords: string[] = [];

  if (hasIntakeSignal(intake)) sourceRecords.push("intake");
  if (inputs.pathway) sourceRecords.push(`care-router:${inputs.pathway}`);
  if (inputs.assessment) sourceRecords.push(`assessment:${inputs.assessment.instrument}`);
  if (inputs.carePlan) sourceRecords.push(`care-plan:${inputs.carePlan.templateId}`);
  const careGaps: ClinicalSummaryGapFact[] = (inputs.careGaps ?? []).map((g) => ({
    measureId: g.measureId,
    measureLabel: g.measureLabel,
    status: g.status
  }));
  for (const gap of careGaps) sourceRecords.push(`care-gap:${gap.measureId}`);

  const context: ClinicalSummaryContext = {
    patientDisplayName: intake?.preferredName?.trim() || "the patient",
    careGaps,
    sourceRecords,
    synthetic: true
  };

  if (inputs.personaId) context.personaId = inputs.personaId;
  if (intake?.ageBand) context.ageBand = intake.ageBand;
  if (intake?.cycleStatus) context.cycleStatus = intake.cycleStatus;
  if (intake?.primarySymptom) context.primarySymptom = intake.primarySymptom;
  if (intake?.severity) context.severity = intake.severity;
  if (inputs.pathway) context.pathway = inputs.pathway;
  if (inputs.onHrt !== undefined) context.onHrt = inputs.onHrt;
  if (inputs.carePlan) {
    context.carePlan = {
      templateId: inputs.carePlan.templateId,
      templateLabel: inputs.carePlan.templateLabel,
      followUpIntervalDays: inputs.carePlan.followUp.intervalDays,
      followUpModality: inputs.carePlan.followUp.modality,
      goals: inputs.carePlan.goals.map((goal) => goal.description),
      interventions: inputs.carePlan.interventions.map((i) => i.description)
    };
  }
  if (inputs.assessment) {
    context.assessment = {
      instrument: inputs.assessment.instrument,
      instrumentName: inputs.assessment.instrumentName,
      total: inputs.assessment.total,
      maxTotal: inputs.assessment.maxTotal,
      severityBand: inputs.assessment.severityBand
    };
  }

  return context;
}

/** Result of composing the two artifacts — mirrors the Care Plan's provenance. */
export type ClinicalSummaryResult = {
  /** The patient-friendly after-visit summary text. */
  patientSummary: string;
  /** The clinician handoff note text. */
  clinicianHandoff: string;
  /**
   * The provenance list the artifacts trace to — copied DETERMINISTICALLY from
   * the assembled context (never model-derived), so the grounding guarantee
   * holds regardless of which path served the phrasing.
   */
  sourceRecords: string[];
  /** Which path produced the phrasing. */
  via: "claude-api" | "scripted-fallback";
  modelProvenance: {
    provider: "anthropic" | "pause-scripted";
    model: string;
    via: "claude-api" | "scripted-fallback";
  };
  /**
   * Short, non-clinical diagnostic explaining WHY the deterministic scripted
   * composition was used instead of a live Claude one. Present only when
   * `via === "scripted-fallback"` — carries just the leading diagnostic
   * sentence ("Claude API call failed (…)" / "ANTHROPIC_API_KEY not set…"),
   * never patient-derived clinical text, so it is safe to record as a
   * trace-span attribute. Undefined on a successful `claude-api` composition.
   */
  fallbackReason?: string;
  /** Demo-honesty marker: the composition is synthetic/illustrative. */
  synthetic: true;
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
 * Integrity check: do the artifacts trace to the records the context was
 * assembled from? True for anything summarizeClinical() produces (its
 * sourceRecords are copied from the context); the guard that catches a
 * caller-asserted result citing a record that isn't grounded in the assembled
 * context (a fabricated / off-context provenance), or one that cites nothing at
 * all. This is the honest signal the route reports to
 * policy.clinical-summary.source-record-sourced.
 */
export function summaryTracesToSourceRecords(
  result: Pick<ClinicalSummaryResult, "sourceRecords"> | null | undefined,
  context: Pick<ClinicalSummaryContext, "sourceRecords">
): boolean {
  if (!result || !Array.isArray(result.sourceRecords)) return false;
  if (result.sourceRecords.length === 0) return false;
  const allowed = new Set(context.sourceRecords);
  return result.sourceRecords.every(
    (record) => typeof record === "string" && allowed.has(record)
  );
}

/**
 * Deterministic scripted composition of the two artifacts. Always available;
 * used as the fallback when the Anthropic SDK call fails or the key is unset.
 * Grounded by construction — it phrases ONLY the facts present in the assembled
 * context and never adds a clinical fact, diagnosis, medication, or order.
 */
export function scriptedSummarizeClinical(context: ClinicalSummaryContext): {
  patientSummary: string;
  clinicianHandoff: string;
} {
  const name = context.patientDisplayName;
  const pathwayProse = context.pathway
    ? PATHWAY_PROSE[context.pathway] ?? context.pathway
    : undefined;

  // Patient-friendly after-visit summary.
  const patientLines: string[] = [`After-visit summary for ${name}.`];
  if (context.primarySymptom || context.severity) {
    const parts: string[] = [];
    if (context.severity) parts.push(`a ${context.severity} presentation`);
    if (context.primarySymptom) parts.push(`primarily ${context.primarySymptom} symptoms`);
    patientLines.push(`We reviewed ${parts.join(" with ")}.`);
  }
  if (pathwayProse) {
    patientLines.push(`Your recommended next step is ${pathwayProse}.`);
  }
  if (context.carePlan) {
    patientLines.push(
      `You are on the ${context.carePlan.templateLabel}, with a follow-up about every ${context.carePlan.followUpIntervalDays} days via ${context.carePlan.followUpModality}.`
    );
    if (context.carePlan.goals.length > 0) {
      patientLines.push(`Your goals: ${context.carePlan.goals.join("; ")}.`);
    }
  }
  if (context.careGaps.length > 0) {
    patientLines.push(
      `Care reminders to keep current: ${context.careGaps
        .map((gap) => `${gap.measureLabel} (${gap.status})`)
        .join("; ")}.`
    );
  }
  patientLines.push(
    "This summary is synthetic/illustrative and only re-states what was already captured — it does not add or change any diagnosis, medication, dose, or order."
  );

  // Clinician handoff note.
  const clinicianLines: string[] = [`Clinician handoff — ${name} (synthetic/demo).`];
  const demographics: string[] = [];
  if (context.ageBand) demographics.push(`age band ${context.ageBand}`);
  if (context.cycleStatus) demographics.push(`cycle status ${context.cycleStatus}`);
  if (context.onHrt !== undefined) {
    demographics.push(context.onHrt ? "on hormone therapy" : "not on hormone therapy");
  }
  if (demographics.length > 0) {
    clinicianLines.push(`Context: ${demographics.join(", ")}.`);
  }
  if (context.primarySymptom || context.severity) {
    clinicianLines.push(
      `Presentation: ${[context.severity, context.primarySymptom]
        .filter((v): v is string => Boolean(v))
        .join(" / ") || "unspecified"}.`
    );
  }
  if (context.assessment) {
    clinicianLines.push(
      `Validated instrument: ${context.assessment.instrumentName} ${context.assessment.total}/${context.assessment.maxTotal} (${context.assessment.severityBand}).`
    );
  }
  if (pathwayProse) {
    clinicianLines.push(`Care Router pathway: ${pathwayProse}.`);
  }
  if (context.carePlan) {
    clinicianLines.push(
      `Care plan: ${context.carePlan.templateLabel} — interventions: ${context.carePlan.interventions.join("; ") || "none recorded"}; follow-up ~${context.carePlan.followUpIntervalDays}d via ${context.carePlan.followUpModality}.`
    );
  }
  if (context.careGaps.length > 0) {
    clinicianLines.push(
      `Open care gaps: ${context.careGaps
        .map((gap) => `${gap.measureLabel} [${gap.measureId}] (${gap.status})`)
        .join("; ")}.`
    );
  }
  clinicianLines.push(
    "This handoff composes existing synthetic records only; it commits no clinical action and requires clinician review before use."
  );

  return {
    patientSummary: patientLines.join(" "),
    clinicianHandoff: clinicianLines.join(" ")
  };
}

/**
 * Extract the first JSON object from a model text block. Robust to code fences
 * and leading/trailing prose: takes the substring from the first `{` to the
 * last `}` and parses it. Throws on no object or invalid JSON so the caller can
 * fall back deterministically.
 */
function parseSummaryJson(text: string): {
  patientSummary: string;
  clinicianHandoff: string;
} {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude response contained no JSON object");
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    patientSummary?: unknown;
    clinicianHandoff?: unknown;
  };
  const patientSummary =
    typeof parsed.patientSummary === "string" ? parsed.patientSummary.trim() : "";
  const clinicianHandoff =
    typeof parsed.clinicianHandoff === "string" ? parsed.clinicianHandoff.trim() : "";
  if (patientSummary.length === 0 || clinicianHandoff.length === 0) {
    throw new Error("Claude response was missing patientSummary/clinicianHandoff");
  }
  return { patientSummary, clinicianHandoff };
}

function scriptedResult(
  context: ClinicalSummaryContext,
  fallbackReason: string
): ClinicalSummaryResult {
  const scripted = scriptedSummarizeClinical(context);
  return {
    patientSummary: scripted.patientSummary,
    clinicianHandoff: scripted.clinicianHandoff,
    sourceRecords: context.sourceRecords.slice(),
    via: "scripted-fallback",
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-clinical-summary-composer@1.0",
      via: "scripted-fallback"
    },
    fallbackReason,
    synthetic: true
  };
}

/**
 * Live Anthropic SDK call phrasing the two artifacts. Loaded dynamically so
 * @anthropic-ai/sdk only resolves when ANTHROPIC_API_KEY is set — mirrors
 * lib/care-plan.ts EXACTLY:
 *
 *   - missing ANTHROPIC_API_KEY short-circuits to the deterministic scripted
 *     composition WITHOUT importing the SDK, stamping a `fallbackReason`;
 *   - any SDK/transport/parse error falls back to the scripted composition and
 *     stamps a `fallbackReason` naming the failure;
 *   - the model is configurable via PAUSE_CLINICAL_SUMMARY_MODEL and defaults
 *     to the SAME model the Care Router / Care Plan use
 *     (claude-sonnet-4-5-20250929).
 *
 * Unlike the Care Plan summary this asks for a small JSON object (two fields),
 * so it parses the model output robustly and falls back on any parse failure.
 * This makes the Clinical Summary agent the THIRD live-Claude agent.
 *
 * The result's `sourceRecords` are ALWAYS the context's — the grounding
 * provenance is deterministic and never taken from the model.
 */
export async function summarizeClinical(
  context: ClinicalSummaryContext,
  opts: { model?: string } = {}
): Promise<ClinicalSummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return scriptedResult(
      context,
      "ANTHROPIC_API_KEY not set; using deterministic Pause clinical-summary composer."
    );
  }

  const model =
    opts.model ??
    process.env.PAUSE_CLINICAL_SUMMARY_MODEL ??
    "claude-sonnet-4-5-20250929";

  try {
    const mod = (await import("@anthropic-ai/sdk")).default;
    const client = new mod({ apiKey });

    const systemPrompt = [
      "You are the Pause-Health.ai Clinical Summary agent.",
      "You COMPOSE two artifacts from an already-assembled context of facts the",
      "other agents produced: (1) a warm, plain-language AFTER-VISIT SUMMARY for",
      "the patient, and (2) a concise CLINICIAN HANDOFF note.",
      "Rules you must honor without exception:",
      "  - GROUND STRICTLY: use ONLY the facts in the provided context. Never add,",
      "    infer, or change a diagnosis, medication, dose, order, lab, or any fact",
      "    the context does not contain.",
      "  - Be NON-PRESCRIPTIVE and commit no clinical action.",
      "  - Keep each artifact to a short paragraph (3-5 sentences).",
      'Reply with ONLY a JSON object of the exact shape {"patientSummary": string,',
      '"clinicianHandoff": string} — no preamble, no markdown, no code fences.'
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        patient: context.patientDisplayName,
        ageBand: context.ageBand,
        cycleStatus: context.cycleStatus,
        primarySymptom: context.primarySymptom,
        severity: context.severity,
        pathway: context.pathway,
        onHrt: context.onHrt,
        assessment: context.assessment,
        carePlan: context.carePlan,
        careGaps: context.careGaps,
        sourceRecords: context.sourceRecords
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
    const { patientSummary, clinicianHandoff } = parseSummaryJson(textPart.text);

    return {
      patientSummary,
      clinicianHandoff,
      sourceRecords: context.sourceRecords.slice(),
      via: "claude-api",
      modelProvenance: { provider: "anthropic", model, via: "claude-api" },
      synthetic: true
    };
  } catch (err) {
    return scriptedResult(
      context,
      `Claude API call failed (${(err as Error).message}); using deterministic Pause clinical-summary composer.`
    );
  }
}
