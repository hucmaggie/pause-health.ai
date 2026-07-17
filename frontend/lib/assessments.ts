/**
 * Validated-instrument assessment scoring.
 *
 * Deterministic, dependency-free scoring for an allow-listed set of
 * validated menopause & mental-health instruments. This is the domain
 * core the Assessment Agent (app/api/agents/assessment) wraps — the
 * Salesforce "Agentforce for Health — Assessments" analog on Pause's
 * Agent Fabric. There is NO LLM here: every score is real cutoff-based
 * math, so the agent is honestly live rather than a stub.
 *
 *   Inbound: an AssessmentResponse (instrument id + per-item responses)
 *   Outbound: an AssessmentResult (per-instrument subscores, total, a
 *             normalized severity band, and any red flags)
 *
 * The result maps onto IntakeRecord.severity via assessmentToIntakeSignal(),
 * so a validated instrument score can drive the existing intake → Care
 * Router spine — a real score behind IntakeRecord.severity makes the
 * routing decision more defensible than a self-reported "mild/moderate/severe".
 *
 * Cutoffs are faithful to each instrument's published scoring where a
 * standard exists (PHQ-9, ISI, MRS). Where an instrument has no widely
 * agreed total-score band (the Greene Climacteric Scale), the inferred
 * cutoff is marked with a `// inferred` comment so the honesty of the
 * mapping is auditable.
 *
 * Everything here is deterministic on its inputs — no randomness, no
 * clock — so a given response set always scores identically. That is
 * what lets the demo, the seeded trace, and the tests agree.
 */

import type { IntakeRecord } from "./care-router";

/** The instruments Pause's Assessment Agent is allowed to administer. */
export type AssessmentInstrument = "mrs" | "greene" | "phq-9" | "isi";

/**
 * The allow-list. The Assessment Agent refuses to administer or score
 * anything not on this list — enforced at the governance boundary by
 * policy.assessment.validated-instrument-only, and defended in depth by
 * scoreAssessment() throwing on an off-list instrument.
 */
export const ALLOWLISTED_INSTRUMENTS: readonly AssessmentInstrument[] = [
  "mrs",
  "greene",
  "phq-9",
  "isi"
] as const;

/** The severity vocabulary IntakeRecord.severity uses. */
export type IntakeSeverity = "mild" | "moderate" | "severe";

/** A captured set of per-item responses for one instrument. */
export type AssessmentResponse = {
  instrument: AssessmentInstrument;
  /**
   * One integer per instrument item, in item order. Each value must be
   * within the instrument's per-item range (validated at scoring time).
   * No free-text fields — only the structured Likert responses cross the
   * boundary, which is what keeps the agent on the no-free-text-PII policy.
   */
  responses: number[];
};

/** A scored subscale within an instrument (MRS/Greene are multi-domain). */
export type AssessmentSubscore = {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  /** Instrument-native subscale band, when the instrument defines one. */
  band?: string;
};

/** A flagged high-risk item (e.g. PHQ-9 item 9 self-harm ideation). */
export type AssessmentRedFlag = {
  /** 0-based index into AssessmentResponse.responses. */
  itemIndex: number;
  code: string;
  description: string;
  /** The response value that tripped the flag. */
  value: number;
};

/** The structured, deterministic output of scoring one instrument. */
export type AssessmentResult = {
  instrument: AssessmentInstrument;
  instrumentName: string;
  total: number;
  maxTotal: number;
  subscores: AssessmentSubscore[];
  /** Instrument-native severity label (e.g. "moderately-severe" for PHQ-9). */
  severityBand: string;
  /** The band mapped onto IntakeRecord.severity's vocabulary. */
  normalizedSeverity: IntakeSeverity;
  redFlags: AssessmentRedFlag[];
  /** One-line, non-clinical interpretation safe to record as a trace attribute. */
  interpretation: string;
};

/** Type guard: is `x` an instrument on the validated allow-list? */
export function isAllowlistedInstrument(x: unknown): x is AssessmentInstrument {
  return (
    typeof x === "string" &&
    (ALLOWLISTED_INSTRUMENTS as readonly string[]).includes(x)
  );
}

type Band = { band: string; normalized: IntakeSeverity };

type InstrumentSpec = {
  id: AssessmentInstrument;
  name: string;
  itemCount: number;
  /** Each item is scored on an integer 0..itemMax Likert scale. */
  itemMax: number;
  /** Multi-domain instruments declare their subscales here (0-based items). */
  subscales: { id: string; label: string; items: number[] }[];
  /** Map a total score to an instrument-native band + normalized severity. */
  band: (total: number) => Band;
  /** Optional per-subscale banding (MRS publishes subscale cutoffs). */
  subscaleBand?: (subscaleId: string, score: number) => string | undefined;
  /** Optional red-flag detector over the raw responses. */
  redFlags?: (responses: number[]) => AssessmentRedFlag[];
  /** How the total relates to symptom burden, for the interpretation line. */
  totalMeaning: string;
};

const MRS_SPEC: InstrumentSpec = {
  id: "mrs",
  name: "Menopause Rating Scale (MRS)",
  itemCount: 11,
  itemMax: 4,
  subscales: [
    // Somato-vegetative: hot flashes/sweating, heart discomfort, sleep
    // problems, joint/muscular discomfort (items 1,2,3,11).
    { id: "somatic", label: "Somato-vegetative", items: [0, 1, 2, 10] },
    // Psychological: depressive mood, irritability, anxiety, exhaustion
    // (items 4,5,6,7).
    { id: "psychological", label: "Psychological", items: [3, 4, 5, 6] },
    // Urogenital: sexual problems, bladder problems, vaginal dryness
    // (items 8,9,10).
    { id: "urogenital", label: "Urogenital", items: [7, 8, 9] }
  ],
  // Published MRS total-score severity classification (Heinemann et al.):
  //   0-4 none/little · 5-8 mild · 9-16 moderate · 17+ severe.
  band: (total) => {
    if (total <= 4) return { band: "none-to-little", normalized: "mild" };
    if (total <= 8) return { band: "mild", normalized: "mild" };
    if (total <= 16) return { band: "moderate", normalized: "moderate" };
    return { band: "severe", normalized: "severe" };
  },
  // Published MRS subscale cutoffs (Heinemann et al.).
  subscaleBand: (subscaleId, score) => {
    switch (subscaleId) {
      case "somatic":
        if (score <= 2) return "none";
        if (score <= 4) return "mild";
        if (score <= 8) return "moderate";
        return "severe";
      case "psychological":
        if (score <= 1) return "none";
        if (score <= 3) return "mild";
        if (score <= 6) return "moderate";
        return "severe";
      case "urogenital":
        if (score <= 0) return "none";
        if (score <= 1) return "mild";
        if (score <= 3) return "moderate";
        return "severe";
      default:
        return undefined;
    }
  },
  totalMeaning: "higher scores indicate greater menopausal symptom burden"
};

const GREENE_SPEC: InstrumentSpec = {
  id: "greene",
  name: "Greene Climacteric Scale",
  itemCount: 21,
  itemMax: 3,
  subscales: [
    // Psychological (items 1-11): anxiety (1-6) + depression (7-11).
    {
      id: "psychological",
      label: "Psychological",
      items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    },
    // Somatic (items 12-18).
    { id: "somatic", label: "Somatic", items: [11, 12, 13, 14, 15, 16, 17] },
    // Vasomotor (items 19-20).
    { id: "vasomotor", label: "Vasomotor", items: [18, 19] },
    // Sexual (item 21).
    { id: "sexual", label: "Sexual", items: [20] }
  ],
  // The Greene Climacteric Scale has no universally agreed total-score
  // severity band (it is designed as a domain profile, not a single index).
  // These total cutoffs across the 0-63 range are inferred for the demo's
  // normalized severity mapping only. // inferred
  band: (total) => {
    if (total <= 12) return { band: "low", normalized: "mild" }; // inferred
    if (total <= 24) return { band: "moderate", normalized: "moderate" }; // inferred
    return { band: "high", normalized: "severe" }; // inferred
  },
  totalMeaning:
    "a symptom-domain profile; higher totals indicate greater climacteric symptom burden"
};

const PHQ9_SPEC: InstrumentSpec = {
  id: "phq-9",
  name: "Patient Health Questionnaire-9 (PHQ-9)",
  itemCount: 9,
  itemMax: 3,
  // PHQ-9 is unidimensional; the total is the score of record.
  subscales: [],
  // Published PHQ-9 severity bands (Kroenke et al.):
  //   0-4 minimal · 5-9 mild · 10-14 moderate · 15-19 moderately-severe ·
  //   20-27 severe.
  band: (total) => {
    if (total <= 4) return { band: "minimal", normalized: "mild" };
    if (total <= 9) return { band: "mild", normalized: "mild" };
    if (total <= 14) return { band: "moderate", normalized: "moderate" };
    if (total <= 19)
      return { band: "moderately-severe", normalized: "severe" };
    return { band: "severe", normalized: "severe" };
  },
  // PHQ-9 item 9 asks about thoughts of self-harm / being better off dead.
  // Any non-zero response is a mandatory safety escalation.
  redFlags: (responses) => {
    const value = responses[8] ?? 0;
    if (value >= 1) {
      return [
        {
          itemIndex: 8,
          code: "phq9-item9-self-harm",
          description:
            "PHQ-9 item 9 (thoughts of self-harm / being better off dead) was endorsed — mandatory safety escalation.",
          value
        }
      ];
    }
    return [];
  },
  totalMeaning: "higher scores indicate greater depressive symptom severity"
};

const ISI_SPEC: InstrumentSpec = {
  id: "isi",
  name: "Insomnia Severity Index (ISI)",
  itemCount: 7,
  itemMax: 4,
  // ISI is scored as a single total.
  subscales: [],
  // Published ISI severity bands (Bastien/Morin):
  //   0-7 no clinically significant insomnia · 8-14 subthreshold ·
  //   15-21 moderate clinical insomnia · 22-28 severe clinical insomnia.
  band: (total) => {
    if (total <= 7) return { band: "none", normalized: "mild" };
    if (total <= 14) return { band: "subthreshold", normalized: "mild" };
    if (total <= 21) return { band: "moderate", normalized: "moderate" };
    return { band: "severe", normalized: "severe" };
  },
  totalMeaning: "higher scores indicate greater insomnia severity"
};

const SPECS: Record<AssessmentInstrument, InstrumentSpec> = {
  mrs: MRS_SPEC,
  greene: GREENE_SPEC,
  "phq-9": PHQ9_SPEC,
  isi: ISI_SPEC
};

/** Look up the (immutable) spec for an allow-listed instrument. */
export function getInstrumentSpec(
  instrument: AssessmentInstrument
): { id: AssessmentInstrument; name: string; itemCount: number; itemMax: number } {
  const spec = SPECS[instrument];
  return {
    id: spec.id,
    name: spec.name,
    itemCount: spec.itemCount,
    itemMax: spec.itemMax
  };
}

function sumItems(responses: number[], items: number[]): number {
  return items.reduce((acc, i) => acc + (responses[i] ?? 0), 0);
}

/**
 * Deterministically score a validated instrument.
 *
 * Throws when:
 *   - the instrument is not on the validated allow-list (defense in depth
 *     behind policy.assessment.validated-instrument-only), or
 *   - the response vector is the wrong length or carries an out-of-range
 *     value (garbage in must not silently produce a plausible score).
 */
export function scoreAssessment(input: AssessmentResponse): AssessmentResult {
  if (!isAllowlistedInstrument(input.instrument)) {
    throw new Error(
      `Instrument "${String(
        input.instrument
      )}" is not on the validated allow-list (${ALLOWLISTED_INSTRUMENTS.join(", ")})`
    );
  }
  const spec = SPECS[input.instrument];
  const responses = input.responses;

  if (!Array.isArray(responses) || responses.length !== spec.itemCount) {
    throw new Error(
      `${spec.name} expects ${spec.itemCount} responses; received ${
        Array.isArray(responses) ? responses.length : "non-array"
      }`
    );
  }
  for (let i = 0; i < responses.length; i++) {
    const v = responses[i];
    if (!Number.isInteger(v) || v < 0 || v > spec.itemMax) {
      throw new Error(
        `${spec.name} item ${i + 1} response "${v}" is out of range (0-${spec.itemMax})`
      );
    }
  }

  const total = responses.reduce((acc, v) => acc + v, 0);
  const maxTotal = spec.itemCount * spec.itemMax;

  const subscores: AssessmentSubscore[] = spec.subscales.map((s) => {
    const score = sumItems(responses, s.items);
    return {
      id: s.id,
      label: s.label,
      score,
      maxScore: s.items.length * spec.itemMax,
      band: spec.subscaleBand?.(s.id, score)
    };
  });

  const { band, normalized } = spec.band(total);
  const redFlags = spec.redFlags?.(responses) ?? [];

  const interpretation = `${spec.name}: ${total}/${maxTotal} (${band}); ${spec.totalMeaning}.${
    redFlags.length > 0 ? " Red-flag item endorsed — safety escalation required." : ""
  }`;

  return {
    instrument: spec.id,
    instrumentName: spec.name,
    total,
    maxTotal,
    subscores,
    severityBand: band,
    normalizedSeverity: normalized,
    redFlags,
    interpretation
  };
}

/**
 * Map a scored result onto the intake-severity signal the Care Router
 * consumes. Returns the normalized severity band AND the red-flag screen
 * value, so a validated instrument can drive BOTH IntakeRecord.severity
 * and IntakeRecord.redFlagsAcknowledged in one shot.
 *
 * A red flag forces the severity to "severe" — an endorsed self-harm item
 * (or any future red-flag item) must never be routed as anything milder
 * than its band would otherwise suggest.
 */
export function assessmentToIntakeSignal(
  result: AssessmentResult
): Pick<IntakeRecord, "severity" | "redFlagsAcknowledged"> {
  const hasRedFlag = result.redFlags.length > 0;
  return {
    severity: hasRedFlag ? "severe" : result.normalizedSeverity,
    redFlagsAcknowledged: hasRedFlag ? "yes" : "no"
  };
}
