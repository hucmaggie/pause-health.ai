/**
 * Drug–Drug Interaction (DDI) Safety Check — the deterministic, transparent clinical-decision layer
 * that screens a PROPOSED medication against the patient's ACTIVE medication list, identifies every
 * interacting pair against a recorded interaction knowledge base, reports the highest interaction
 * severity with its mechanism and management guidance, and decides the disposition — never
 * autonomously HOLDING the order or OVERRIDING the alert; a pharmacist / prescriber acts on or reviews
 * every finding.
 *
 * Deterministic, dependency-free domain core the Drug Interaction Agent (app/api/agents/drug-interaction)
 * wraps — a clinical-decision service on the patient / clinical plane of Pause's Agent Fabric. UNLIKE
 * the recent platform agents there is NO date math, NO dollar waterfall, and NO single-record
 * exception classifier — the heart of the service is a PAIRWISE KNOWLEDGE-BASE LOOKUP + a SEVERITY
 * RANKING. Given a proposed drug + the patient's active medication list, it DETERMINISTICALLY finds
 * every catalog interaction pairing the proposed drug with an active medication, ranks them, and
 * reports the overall severity + disposition.
 *
 *   Inbound:  a DrugInteractionRequest { requestRef, patientRef, proposedDrug, activeMedications }
 *   Outbound: a DrugInteractionDetermination { proposedDrug, activeMedicationCount,
 *             detectedInteractions, interactionCount, overallSeverity, disposition,
 *             requiresClinicianReview:true, autoHeldOrder:false, autoOverrodeAlert:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other clinical / medication agents: distinct from the
 * Controlled Substance / PDMP agent (the TOTAL controlled-substance MME burden across prescribers),
 * the Formulary & DUR Review agent (plan-level coverage / step therapy), the Medication Adherence
 * agent (taking an already-prescribed drug), the Prior Authorization agent (assembling a PA package),
 * and the Immunization agent (the vaccine schedule): this screens whether a NEW drug INTERACTS with
 * what the patient already takes.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every reported interaction traces to the recorded knowledge base.
 * ─────────────────────────────────────────────────────────────────────
 *  A flagged interaction is credible only if it traces to a recorded interaction record — every
 *  reported interaction must resolve in the catalog, and its reported drug pair + severity must match
 *  the record; a fabricated / off-catalog interaction is an alert that erodes trust and drives alert
 *  fatigue. ddiInteractionSourced() reports the honest signal the Agent Fabric enforces via
 *  policy.ddi.interaction-sourced. (Mirrors the Controlled Substance Agent's guideline-sourced and the
 *  Immunization Agent's schedule-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the overall severity is consistent with the detected interactions.
 * ─────────────────────────────────────────────────────────────────────
 *  The reported overall severity must equal the HIGHEST cataloged severity among the detected
 *  interactions — an INFLATED severity drives wrongful order cancellation and alert fatigue, and a
 *  SUPPRESSED severity hides a contraindication. ddiSeverityConsistent() recomputes the maximum
 *  severity from the detected interactions' catalog records and verifies it matches; it reports the
 *  honest signal the Agent Fabric enforces via policy.ddi.severity-consistent. (The load-bearing
 *  correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the OIG Exclusion
 *  Agent's match-not-overstated.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the order is never autonomously held or the alert overridden.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent SCREENS — it never HOLDS / cancels the order (which could deny needed therapy) or
 *  OVERRIDES the alert (which could push through a contraindicated combination) on its own; every
 *  finding is a RECOMMENDATION requiring a pharmacist / prescriber to act on or review.
 *  ddiNoAutonomousHoldOrOverride() reports the honest signal the Agent Fabric enforces via
 *  policy.ddi.no-autonomous-hold-or-override. (Mirrors the Controlled Substance Agent's
 *  no-autonomous-prescribing-decision and the Lab Result Agent's no-autonomous-clinical-action
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — an interaction of any severity OR no interaction detected — is a SAFE, honest OUTPUT:
 *  the task COMPLETES (it carries requiresClinicianReview:true, autoHeldOrder:false,
 *  autoOverrodeAlert:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION
 *  (an off-catalog interaction, an inconsistent overall severity, or an autonomously-held / overridden
 *  / unreviewed determination) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical decision support system.
 * ─────────────────────────────────────────────────────────────────────
 *  The interaction knowledge base + the severity assignments below are clearly-labeled ILLUSTRATIVE
 *  synthetics chosen to model the SHAPE of a DDI screen deterministically in the demo — they are NOT a
 *  complete implementation. Real interaction checking uses a maintained knowledge base (e.g. a licensed
 *  drug-interaction compendium), normalized drug vocabularies (RxNorm), dose / route / timing context,
 *  patient-specific factors, and the pharmacist's / prescriber's clinical judgment. There is NO
 *  randomness and NO clock anywhere here: the determination is a pure function of the request's own
 *  fields, so the same order always yields the same interactions / severity / disposition — which is
 *  what lets the demo, the seeded trace, and the tests agree.
 */

/** Interaction severity, most-to-least severe. */
export type DdiSeverity = "contraindicated" | "major" | "moderate" | "minor";

/** Numeric rank for ordering severities (higher = more severe); "none" ranks 0. */
export const DDI_SEVERITY_RANK: Record<DdiSeverity | "none", number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  major: 3,
  contraindicated: 4
};

/** A recorded drug–drug interaction (a catalog / knowledge-base entry). */
export type DdiInteraction = {
  /** Stable interaction id. */
  id: string;
  /** The two interacting ingredients (normalized, lowercase), stored sorted. */
  pair: [string, string];
  /** The interaction severity. */
  severity: DdiSeverity;
  /** Short mechanism description. */
  mechanism: string;
  /** Short management guidance. */
  management: string;
};

/** Normalize a drug name to a comparison key (lowercase, trimmed, spaces collapsed). */
export function normalizeDrug(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build a sorted pair so lookups are order-independent. */
function sortedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * ILLUSTRATIVE, synthetic drug–drug interaction knowledge base — clearly labeled, NOT a licensed
 * compendium. Ingredient names are normalized (lowercase). A reported interaction must resolve here,
 * and its severity must match.
 */
export const DDI_INTERACTIONS: DdiInteraction[] = [
  {
    id: "ddi.sildenafil-nitroglycerin",
    pair: sortedPair("sildenafil", "nitroglycerin"),
    severity: "contraindicated",
    mechanism: "Additive vasodilation via potentiated nitric-oxide / cGMP signaling.",
    management: "Do not co-administer — risk of severe, refractory hypotension."
  },
  {
    id: "ddi.simvastatin-clarithromycin",
    pair: sortedPair("simvastatin", "clarithromycin"),
    severity: "contraindicated",
    mechanism: "Strong CYP3A4 inhibition markedly raises simvastatin exposure.",
    management: "Do not co-administer — risk of myopathy / rhabdomyolysis; use an alternative."
  },
  {
    id: "ddi.paroxetine-tamoxifen",
    pair: sortedPair("paroxetine", "tamoxifen"),
    severity: "major",
    mechanism: "Strong CYP2D6 inhibition reduces conversion of tamoxifen to active endoxifen.",
    management: "Avoid — select an SSRI that does not strongly inhibit CYP2D6."
  },
  {
    id: "ddi.warfarin-fluconazole",
    pair: sortedPair("warfarin", "fluconazole"),
    severity: "major",
    mechanism: "CYP2C9 inhibition raises warfarin exposure and INR.",
    management: "Avoid or reduce warfarin dose with close INR monitoring."
  },
  {
    id: "ddi.warfarin-aspirin",
    pair: sortedPair("warfarin", "aspirin"),
    severity: "major",
    mechanism: "Additive antiplatelet / anticoagulant effect.",
    management: "Combine only with a clear indication and close bleeding monitoring."
  },
  {
    id: "ddi.estradiol-rifampin",
    pair: sortedPair("estradiol", "rifampin"),
    severity: "moderate",
    mechanism: "Strong enzyme induction lowers estradiol exposure.",
    management: "Anticipate reduced hormonal efficacy; consider an alternative or dose adjustment."
  },
  {
    id: "ddi.metformin-iodinated-contrast",
    pair: sortedPair("metformin", "iodinated contrast"),
    severity: "moderate",
    mechanism: "Contrast-associated renal impairment can precipitate metformin lactic acidosis.",
    management: "Hold metformin around contrast administration per protocol; reassess renal function."
  },
  {
    id: "ddi.lisinopril-potassium",
    pair: sortedPair("lisinopril", "potassium"),
    severity: "moderate",
    mechanism: "ACE inhibition plus supplemental potassium raises hyperkalemia risk.",
    management: "Monitor serum potassium; avoid routine supplementation unless indicated."
  },
  {
    id: "ddi.calcium-levothyroxine",
    pair: sortedPair("calcium", "levothyroxine"),
    severity: "minor",
    mechanism: "Calcium reduces levothyroxine absorption when taken together.",
    management: "Separate administration by ≥ 4 hours."
  }
];

/** Look up an interaction by id (undefined when off-catalog). */
export function getDdiInteraction(id: string): DdiInteraction | undefined {
  return DDI_INTERACTIONS.find((i) => i.id === id);
}

/** Look up the recorded interaction between two drugs (undefined when none is cataloged). */
export function findInteractionForPair(a: string, b: string): DdiInteraction | undefined {
  const [x, y] = sortedPair(normalizeDrug(a), normalizeDrug(b));
  return DDI_INTERACTIONS.find((i) => i.pair[0] === x && i.pair[1] === y);
}

/** A proposed-medication interaction screen request. */
export type DrugInteractionRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The proposed / new drug being ordered (ingredient name). */
  proposedDrug: string;
  /** The patient's active medication list (ingredient names). */
  activeMedications: string[];
};

/** A single detected interaction on the determination. */
export type DetectedInteraction = {
  /** The catalog interaction id. */
  interactionId: string;
  /** The active medication the proposed drug interacts with (normalized). */
  withDrug: string;
  /** The interacting ingredient pair (sorted, normalized). */
  pair: [string, string];
  /** The interaction severity. */
  severity: DdiSeverity;
  /** Short mechanism description. */
  mechanism: string;
  /** Short management guidance. */
  management: string;
};

/** How the screen is dispositioned. */
export type DdiDisposition =
  | "no-interaction-detected"
  | "monitor"
  | "review-recommended"
  | "review-required"
  | "do-not-coadminister-needs-review";

/** The deterministic DDI determination the agent returns. */
export type DrugInteractionDetermination = {
  requestRef: string;
  patientRef: string;
  proposedDrug: string;
  /** How many active medications were screened. */
  activeMedicationCount: number;
  /** Every detected interaction, most-severe first. */
  detectedInteractions: DetectedInteraction[];
  /** The number of detected interactions. */
  interactionCount: number;
  /** The highest severity among the detected interactions ("none" when there are none). */
  overallSeverity: DdiSeverity | "none";
  /** The disposition. */
  disposition: DdiDisposition;
  /** Always true — every finding is acted on / reviewed by a pharmacist / prescriber. */
  requiresClinicianReview: true;
  /** Always false — the agent never autonomously holds / cancels the order. */
  autoHeldOrder: false;
  /** Always false — the agent never autonomously overrides the interaction alert. */
  autoOverrodeAlert: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the knowledge base is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Map an overall severity to a disposition. */
export function dispositionForSeverity(severity: DdiSeverity | "none"): DdiDisposition {
  switch (severity) {
    case "contraindicated":
      return "do-not-coadminister-needs-review";
    case "major":
      return "review-required";
    case "moderate":
      return "review-recommended";
    case "minor":
      return "monitor";
    default:
      return "no-interaction-detected";
  }
}

/**
 * The deterministic DDI function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own fields (no randomness, no clock). It pairs the proposed drug with each active
 * medication, looks up every recorded interaction, ranks them by severity, and decides the disposition.
 * Nothing is held or overridden here — every finding is handed to a pharmacist / prescriber.
 */
export function evaluateDrugInteractions(
  request: DrugInteractionRequest
): DrugInteractionDetermination {
  const proposed = normalizeDrug(request.proposedDrug);
  const active = Array.isArray(request.activeMedications) ? request.activeMedications : [];

  const detected: DetectedInteraction[] = [];
  const seen = new Set<string>();
  for (const med of active) {
    const medNorm = normalizeDrug(med);
    if (!medNorm || medNorm === proposed) continue;
    const interaction = findInteractionForPair(proposed, medNorm);
    if (interaction && !seen.has(interaction.id)) {
      seen.add(interaction.id);
      detected.push({
        interactionId: interaction.id,
        withDrug: medNorm,
        pair: interaction.pair,
        severity: interaction.severity,
        mechanism: interaction.mechanism,
        management: interaction.management
      });
    }
  }

  // Most-severe first; ties broken by interaction id for a stable, deterministic order.
  detected.sort((a, b) => {
    const d = DDI_SEVERITY_RANK[b.severity] - DDI_SEVERITY_RANK[a.severity];
    return d !== 0 ? d : a.interactionId.localeCompare(b.interactionId);
  });

  const overallSeverity: DdiSeverity | "none" =
    detected.length === 0 ? "none" : detected[0].severity;
  const disposition = dispositionForSeverity(overallSeverity);

  const findingPhrase =
    detected.length === 0
      ? `no cataloged interaction between ${proposed} and the ${active.length} active medication(s)`
      : `${detected.length} interaction(s) detected — highest severity ${overallSeverity} (${detected[0].withDrug})`;

  const dispositionPhrase =
    disposition === "no-interaction-detected"
      ? "no interaction detected — clinician to confirm and proceed"
      : disposition === "monitor"
        ? "minor interaction — monitor; clinician to review"
        : disposition === "review-recommended"
          ? "moderate interaction — review recommended before dispensing"
          : disposition === "review-required"
            ? "major interaction — prescriber review required before dispensing"
            : "contraindicated combination — do NOT co-administer; prescriber review required";

  const reason = `DDI screen ${request.requestRef} for ${request.patientRef}: proposed ${proposed} vs ${active.length} active med(s); ${findingPhrase}; ${dispositionPhrase}.`;

  return {
    requestRef: request.requestRef,
    patientRef: request.patientRef,
    proposedDrug: proposed,
    activeMedicationCount: active.length,
    detectedInteractions: detected,
    interactionCount: detected.length,
    overallSeverity,
    disposition,
    requiresClinicianReview: true,
    autoHeldOrder: false,
    autoOverrodeAlert: false,
    reason,
    synthetic: true,
    note:
      `DDI screen ${request.requestRef}: ${findingPhrase}; disposition ${disposition}. ` +
      "PHI-bearing — the screen references the patient's active medication list. Synthetic/illustrative interaction knowledge base + severity assignments — NOT a certified clinical decision support system; real interaction checking uses a maintained compendium, normalized drug vocabularies (RxNorm), dose / route / timing context, patient-specific factors, and the pharmacist's / prescriber's clinical judgment. The agent never holds the order or overrides the alert on its own — a pharmacist / prescriber acts on or reviews every finding."
  };
}

/**
 * Interaction-sourced check: does every reported interaction resolve in the recorded knowledge base,
 * with a matching pair + severity? True when no interactions are reported; the guard that catches a
 * fabricated / off-catalog interaction (or a mismatched severity dressed onto a real record). Anything
 * evaluateDrugInteractions() produces satisfies it. This is the honest signal the route reports to
 * policy.ddi.interaction-sourced. A non-object / malformed input is a violation.
 */
export function ddiInteractionSourced(
  decision:
    | { detectedInteractions?: Array<{ interactionId?: string; severity?: string }> }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const list = decision.detectedInteractions;
  if (list === undefined) return true;
  if (!Array.isArray(list)) return false;
  for (const item of list) {
    if (!item || typeof item !== "object") return false;
    const id = typeof item.interactionId === "string" ? item.interactionId : "";
    const record = id ? getDdiInteraction(id) : undefined;
    if (!record) return false;
    if (typeof item.severity === "string" && item.severity !== record.severity) return false;
  }
  return true;
}

/**
 * Severity-consistent check: does the reported overall severity equal the highest cataloged severity
 * among the detected interactions? True unless the overall severity is inflated (alert fatigue,
 * wrongful cancellation) or suppressed (hidden contraindication) relative to the recomputation from
 * the detected interactions' catalog records; the load-bearing correctness gate. Anything
 * evaluateDrugInteractions() produces satisfies it. This is the honest signal the route reports to
 * policy.ddi.severity-consistent. A non-object / malformed input, or an interaction that is not
 * cataloged, is a violation.
 */
export function ddiSeverityConsistent(
  decision:
    | {
        detectedInteractions?: Array<{ interactionId?: string }>;
        overallSeverity?: DdiSeverity | "none";
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const list = Array.isArray(decision.detectedInteractions) ? decision.detectedInteractions : [];
  let maxRank = 0;
  let maxSeverity: DdiSeverity | "none" = "none";
  for (const item of list) {
    const id = item && typeof item.interactionId === "string" ? item.interactionId : "";
    const record = id ? getDdiInteraction(id) : undefined;
    if (!record) return false; // can't verify severity of an off-catalog interaction
    const rank = DDI_SEVERITY_RANK[record.severity];
    if (rank > maxRank) {
      maxRank = rank;
      maxSeverity = record.severity;
    }
  }
  return decision.overallSeverity === maxSeverity;
}

/**
 * No-autonomous-hold-or-override check: did the agent avoid autonomously holding the order or
 * overriding the alert? True unless the determination reports it autonomously held / cancelled the
 * order (autoHeldOrder:true), overrode the alert (autoOverrodeAlert:true), or does not require
 * clinician review (requiresClinicianReview:false); the guard that catches an autonomous hold /
 * override. Anything evaluateDrugInteractions() produces satisfies it. This is the honest signal the
 * route reports to policy.ddi.no-autonomous-hold-or-override. A non-object input is a violation.
 */
export function ddiNoAutonomousHoldOrOverride(
  decision:
    | { autoHeldOrder?: boolean; autoOverrodeAlert?: boolean; requiresClinicianReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoHeldOrder === true) return false;
  if (decision.autoOverrodeAlert === true) return false;
  if (decision.requiresClinicianReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function drugInteractionSummary(decision: DrugInteractionDetermination): {
  requestRef: string;
  patientRef: string;
  proposedDrug: string;
  interactionCount: number;
  overallSeverity: DdiSeverity | "none";
  disposition: DdiDisposition;
  requiresClinicianReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    patientRef: decision.patientRef,
    proposedDrug: decision.proposedDrug,
    interactionCount: decision.interactionCount,
    overallSeverity: decision.overallSeverity,
    disposition: decision.disposition,
    requiresClinicianReview: decision.requiresClinicianReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: proposing paroxetine for a patient on tamoxifen → a MAJOR interaction
 * (CYP2D6 inhibition reduces tamoxifen efficacy) → prescriber review required. Synthetic.
 */
export const DEMO_DRUG_INTERACTION_REQUEST: DrugInteractionRequest = {
  requestRef: "ddi-001",
  patientRef: "patient-8842",
  proposedDrug: "paroxetine",
  activeMedications: ["tamoxifen", "calcium", "vitamin d"]
};

/**
 * A representative demo request: proposing nitroglycerin for a patient on sildenafil → a
 * CONTRAINDICATED combination (severe hypotension). Synthetic.
 */
export const DEMO_DRUG_INTERACTION_CONTRA_REQUEST: DrugInteractionRequest = {
  requestRef: "ddi-002",
  patientRef: "patient-7310",
  proposedDrug: "nitroglycerin",
  activeMedications: ["sildenafil", "lisinopril"]
};

/**
 * A representative demo request: proposing rifampin for a patient on estradiol → a MODERATE interaction
 * (enzyme induction lowers hormonal efficacy). Synthetic.
 */
export const DEMO_DRUG_INTERACTION_MODERATE_REQUEST: DrugInteractionRequest = {
  requestRef: "ddi-003",
  patientRef: "patient-5521",
  proposedDrug: "rifampin",
  activeMedications: ["estradiol", "calcium"]
};

/**
 * A representative demo request: proposing acetaminophen for a patient on unrelated medications → no
 * cataloged interaction. Synthetic.
 */
export const DEMO_DRUG_INTERACTION_NONE_REQUEST: DrugInteractionRequest = {
  requestRef: "ddi-004",
  patientRef: "patient-9017",
  proposedDrug: "acetaminophen",
  activeMedications: ["vitamin d", "calcium"]
};
