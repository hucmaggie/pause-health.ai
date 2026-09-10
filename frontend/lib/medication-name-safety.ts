/**
 * Medication Name Safety (LASA / Look-Alike-Sound-Alike) — the deterministic, transparent
 * clinical-decision layer that takes a PRESCRIBED / TYPED drug name plus a formulary CATALOG and, using
 * EDIT DISTANCE, finds the nearest catalog name and flags a LOOK-ALIKE / SOUND-ALIKE confusion (a name
 * dangerously close to a DIFFERENT drug, or a near-miss misspelling) for a pharmacist — never
 * autonomously SUBSTITUTING, CORRECTING, or DISPENSING a drug; a pharmacist confirms the intended
 * medication.
 *
 * Deterministic, dependency-free domain core the Medication Name Safety agent
 * (app/api/agents/medication-name-safety) wraps — a clinical-decision service on the patient / clinical
 * plane of Pause's Agent Fabric. UNLIKE the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the
 * Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the
 * Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the
 * Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
 * waterfall, the Drug–Drug Interaction agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's
 * EXACT identity MATCHING (explicitly NO fuzzy / phonetic matching), or the Audit Log Integrity agent's
 * HASH CHAIN — and UNLIKE the DATE-DEADLINE agents that add N days to a single date — the heart of this
 * service is STRING EDIT DISTANCE (the classic Levenshtein dynamic-programming algorithm: the minimum
 * single-character insertions, deletions, and substitutions to turn one name into another). Look-alike /
 * sound-alike medication name confusion (e.g., premarin vs primaxin, hydroxyzine vs hydralazine) is one
 * of the most persistent sources of medication error — the ISMP maintains a LASA list and the Joint
 * Commission requires organizations to manage it; this service surfaces the risk deterministically.
 *
 *   Inbound:  a MedicationNameSafetyRequest { requestRef, patientRef, prescribedName, catalog?, editDistanceThreshold? }
 *   Outbound: a MedicationNameSafetyDetermination { disposition, exactMatch, nearestMatch, confusable[],
 *             normalizedName, catalog[], editDistanceThreshold, catalogSize, requiresPharmacistReview:true,
 *             autoSubstituted:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other medication agents: distinct from the Drug–Drug
 * Interaction agent (whether two drugs INTERACT), the Formulary & Drug Utilization Review agent (whether a
 * drug is COVERED / appropriate), the Controlled-Substance / PDMP agent (opioid MME safety), and the
 * Medication Adherence agent (refill nudges): this catches a name that is CONFUSABLE with a different drug
 * before it becomes a wrong-drug error.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every candidate is sourced from the catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  A name-safety finding is trustworthy only if every candidate it names — the nearest match and every
 *  confusable look-alike — is a REAL catalog drug (its drugId is in the catalog and its echoed name equals
 *  that drug's catalog name). A fabricated candidate would invent a look-alike that doesn't exist, or
 *  mislabel one. lasaCandidatesSourced() verifies it; the Agent Fabric enforces it via
 *  policy.lasa.candidates-sourced. (The sourced gate — mirrors the Drug–Drug Interaction Agent's
 *  pair-sourced and the Schedule Conflict Agent's intervals-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the distances and the finding are exact.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the Levenshtein distance from the prescribed name to every catalog drug must reproduce the
 *  reported nearest match, every reported edit distance, the exact-match flag, the confusable set (exactly
 *  those within the threshold, not counting an exact match), and the disposition. A miscomputed distance,
 *  a wrong nearest match, an omitted look-alike, or a disposition that doesn't follow drives a wrong
 *  finding — the whole point is the arithmetic. lasaDistancesConsistent() recomputes it end-to-end from
 *  the echoed catalog; the Agent Fabric enforces it via policy.lasa.distances-consistent. (The
 *  load-bearing correctness gate — mirrors the Schedule Conflict Agent's conflict-free and the Access
 *  Anomaly Agent's window-count-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a drug is never autonomously substituted / corrected / dispensed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent FLAGS — it never SUBSTITUTES the drug for the nearest match, silently CORRECTS the order, or
 *  DISPENSES (each is a clinical action that must be authorized); every finding is a RECOMMENDATION
 *  requiring a pharmacist to confirm the intended medication. lasaNoAutonomousSubstitution() reports the
 *  honest signal the Agent Fabric enforces via policy.lasa.no-autonomous-substitution. (Mirrors the
 *  Drug–Drug Interaction Agent's no-autonomous-substitution and the Schedule Conflict Agent's
 *  no-autonomous-booking posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — recognized-clear, lasa-warning, or unrecognized — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresPharmacistReview:true, autoSubstituted:false). A GOVERNANCE BLOCK is when
 *  a caller PRESENTS an offending DETERMINATION (one that fabricates a candidate, miscomputes a distance /
 *  disposition, or autonomously substitutes) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified medication-safety system.
 * ─────────────────────────────────────────────────────────────────────
 *  The formulary catalog + names below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the
 *  SHAPE of a LASA edit-distance check deterministically in the demo. Real medication-name safety uses the
 *  ISMP / FDA LASA lists, tall-man lettering, RxNorm / First Databank drug vocabularies, indication and
 *  dose context, barcode scanning, and the pharmacist's judgment. TIME IS DATA: the finding is a pure
 *  function of the request's own name + catalog + threshold (no clock, no randomness), so the same input
 *  always yields the same finding, which is what lets the demo, the seeded trace, and the tests agree.
 */

/** A drug in the formulary catalog. */
export type DrugCatalogEntry = {
  /** The catalog drug identifier. */
  drugId: string;
  /** The catalog drug name. */
  name: string;
};

/** A medication-name-safety request. */
export type MedicationNameSafetyRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The prescribed / typed drug name to check. */
  prescribedName: string;
  /** The formulary catalog to check against (defaults to DEFAULT_FORMULARY_CATALOG). */
  catalog?: DrugCatalogEntry[];
  /** The confusability threshold — the max edit distance (1..n) to treat as a look-alike (default 2). */
  editDistanceThreshold?: number;
};

/** A catalog candidate with its edit distance from the prescribed name. */
export type NameCandidate = {
  drugId: string;
  name: string;
  editDistance: number;
};

/** The disposition of a name-safety finding. */
export type MedicationNameSafetyDisposition =
  | "recognized-clear"
  | "lasa-warning"
  | "unrecognized";

/** The deterministic finding the agent returns. */
export type MedicationNameSafetyDetermination = {
  requestRef: string;
  patientRef: string;
  prescribedName: string;
  /** The normalized prescribed name the distances are computed on. */
  normalizedName: string;
  /** The confusability threshold used. */
  editDistanceThreshold: number;
  /** The catalog echoed so the honesty guards can recompute end-to-end. */
  catalog: DrugCatalogEntry[];
  /** The number of catalog entries. */
  catalogSize: number;
  /** Whether the prescribed name exactly matches a catalog drug (distance 0). */
  exactMatch: boolean;
  /** The minimum-distance catalog drug (null only if the catalog is empty). */
  nearestMatch: NameCandidate | null;
  /** The look-alike drugs within the threshold (0 < distance ≤ threshold), sorted. */
  confusable: NameCandidate[];
  /** The disposition. */
  disposition: MedicationNameSafetyDisposition;
  /** Always true — a pharmacist confirms every finding. */
  requiresPharmacistReview: true;
  /** Always false — the agent never autonomously substitutes / corrects / dispenses. */
  autoSubstituted: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** The default confusability threshold (max edit distance to flag as a look-alike). */
export const DEFAULT_EDIT_DISTANCE_THRESHOLD = 2;

/**
 * Normalize a drug name for comparison: lowercase, trim, collapse internal whitespace. Deterministic and
 * shared by the engine + the guards so they compute identical distances.
 */
export function normalizeDrugName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * The classic Levenshtein edit distance (dynamic programming) between two strings — the minimum number of
 * single-character insertions, deletions, and substitutions to turn `a` into `b`. O(a·b) time, O(b)
 * space, fully deterministic.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/** Deterministic candidate ordering: by distance asc, then name asc, then drugId asc. */
function candidateCompare(a: NameCandidate, b: NameCandidate): number {
  if (a.editDistance !== b.editDistance) return a.editDistance - b.editDistance;
  if (a.name !== b.name) return a.name.localeCompare(b.name);
  return a.drugId.localeCompare(b.drugId);
}

/** Compute the full candidate list (every catalog entry with its distance), deterministically ordered. */
function computeCandidates(
  normalizedName: string,
  catalog: DrugCatalogEntry[]
): NameCandidate[] {
  return catalog
    .map((c) => ({
      drugId: c.drugId,
      name: c.name,
      editDistance: levenshtein(normalizedName, normalizeDrugName(c.name))
    }))
    .sort(candidateCompare);
}

/** Derive the disposition from the exact-match flag and whether there are confusable look-alikes. */
function deriveDisposition(exactMatch: boolean, confusableCount: number): MedicationNameSafetyDisposition {
  if (confusableCount > 0) return "lasa-warning";
  if (exactMatch) return "recognized-clear";
  return "unrecognized";
}

/**
 * The deterministic name-safety function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own name + catalog + threshold (no randomness, no clock). It normalizes the prescribed
 * name, computes the Levenshtein edit distance to every catalog drug, finds the nearest match, collects
 * the look-alike drugs within the threshold (0 < distance ≤ threshold, i.e., near but not an exact
 * match), and derives the disposition: recognized-clear (an exact match with no look-alike), lasa-warning
 * (a look-alike within the threshold — a possible wrong-drug confusion or near-miss misspelling), or
 * unrecognized (no exact match and nothing within the threshold). Nothing is substituted — the finding is
 * handed to a pharmacist.
 */
export function evaluateMedicationNameSafety(
  request: MedicationNameSafetyRequest
): MedicationNameSafetyDetermination {
  const catalog = Array.isArray(request.catalog) ? request.catalog : DEFAULT_FORMULARY_CATALOG;
  const threshold =
    typeof request.editDistanceThreshold === "number" &&
    Number.isInteger(request.editDistanceThreshold) &&
    request.editDistanceThreshold >= 1
      ? request.editDistanceThreshold
      : DEFAULT_EDIT_DISTANCE_THRESHOLD;

  const normalizedName = normalizeDrugName(request.prescribedName ?? "");
  const candidates = computeCandidates(normalizedName, catalog);

  const nearestMatch = candidates.length > 0 ? candidates[0] : null;
  const exactMatch = nearestMatch !== null && nearestMatch.editDistance === 0;
  const confusable = candidates.filter((c) => c.editDistance > 0 && c.editDistance <= threshold);
  const disposition = deriveDisposition(exactMatch, confusable.length);

  const reason =
    disposition === "recognized-clear"
      ? `"${request.prescribedName}" matches ${nearestMatch?.name} with no look-alike within edit distance ${threshold}.`
      : disposition === "lasa-warning"
        ? `"${request.prescribedName}" is within edit distance ${threshold} of ${confusable.length} other drug name(s) — possible look-alike / sound-alike confusion: ${confusable
            .map((c) => `${c.name} (distance ${c.editDistance})`)
            .join(", ")}.`
        : `"${request.prescribedName}" does not match any catalog drug within edit distance ${threshold} (nearest: ${nearestMatch ? `${nearestMatch.name}, distance ${nearestMatch.editDistance}` : "none"}).`;

  return {
    requestRef: request.requestRef,
    patientRef: request.patientRef,
    prescribedName: request.prescribedName,
    normalizedName,
    editDistanceThreshold: threshold,
    catalog: catalog.map((c) => ({ drugId: c.drugId, name: c.name })),
    catalogSize: catalog.length,
    exactMatch,
    nearestMatch,
    confusable,
    disposition,
    requiresPharmacistReview: true,
    autoSubstituted: false,
    reason,
    synthetic: true,
    note:
      `Medication name safety ${request.requestRef}: ${disposition.toUpperCase()} for "${request.prescribedName}" against ${catalog.length} catalog drug(s) at edit-distance threshold ${threshold}.` +
      (disposition === "lasa-warning"
        ? ` Look-alike(s): ${confusable.map((c) => `${c.name} (${c.editDistance})`).join(", ")}. A pharmacist must confirm the intended medication.`
        : "") +
      " PHI-bearing — the prescribed name is for a patient's medication order. Synthetic/illustrative catalog — NOT a certified medication-safety system; real LASA safety uses the ISMP / FDA LASA lists, tall-man lettering, RxNorm / First Databank vocabularies, indication / dose context, and barcode scanning. The agent never substitutes, corrects, or dispenses a drug on its own — a pharmacist confirms every finding."
  };
}

/**
 * Candidates-sourced check: does every named candidate (the nearest match + every confusable look-alike)
 * reference a real catalog drug, with its echoed name equal to that drug's catalog name? True only when
 * each candidate's drugId is in the catalog and its name matches. Catches a fabricated or mislabeled
 * candidate. Anything evaluateMedicationNameSafety() produces satisfies it. This is the honest signal the
 * route reports to policy.lasa.candidates-sourced. A non-object / malformed input is a violation.
 */
export function lasaCandidatesSourced(
  decision:
    | {
        catalog?: Array<{ drugId?: unknown; name?: unknown }>;
        nearestMatch?: { drugId?: unknown; name?: unknown } | null;
        confusable?: Array<{ drugId?: unknown; name?: unknown }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const catalog = Array.isArray(decision.catalog) ? decision.catalog : null;
  const confusable = Array.isArray(decision.confusable) ? decision.confusable : null;
  if (!catalog || !confusable) return false;

  const nameOf = new Map<string, string>();
  for (const c of catalog) {
    if (!c || typeof c.drugId !== "string" || typeof c.name !== "string") return false;
    nameOf.set(c.drugId, c.name);
  }

  const sourced = (cand: { drugId?: unknown; name?: unknown }): boolean =>
    !!cand &&
    typeof cand.drugId === "string" &&
    typeof cand.name === "string" &&
    nameOf.get(cand.drugId) === cand.name;

  if (decision.nearestMatch != null && !sourced(decision.nearestMatch)) return false;
  for (const c of confusable) if (!sourced(c)) return false;
  return true;
}

/**
 * Distances-consistent check: recomputing the Levenshtein distances from the prescribed name to the
 * echoed catalog must reproduce the reported nearest match, exact-match flag, confusable set (exactly
 * those within the threshold), every candidate's edit distance, and the disposition. True only when they
 * all match. Catches a miscomputed distance, a wrong nearest match, an omitted / spurious look-alike, or
 * a disposition that doesn't follow. The load-bearing correctness gate — it recomputes from the catalog
 * (using catalog names, not the candidate's echoed name), so it is independent of the sourced check.
 * Anything evaluateMedicationNameSafety() produces satisfies it. A non-object input is a violation.
 */
export function lasaDistancesConsistent(
  decision:
    | {
        normalizedName?: unknown;
        editDistanceThreshold?: unknown;
        catalog?: Array<{ drugId?: unknown; name?: unknown }>;
        exactMatch?: unknown;
        nearestMatch?: { drugId?: unknown; editDistance?: unknown } | null;
        confusable?: Array<{ drugId?: unknown; editDistance?: unknown }>;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.normalizedName !== "string") return false;
  if (
    typeof decision.editDistanceThreshold !== "number" ||
    !Number.isInteger(decision.editDistanceThreshold) ||
    decision.editDistanceThreshold < 1
  ) {
    return false;
  }
  const catalog = Array.isArray(decision.catalog) ? decision.catalog : null;
  const confusable = Array.isArray(decision.confusable) ? decision.confusable : null;
  if (!catalog || !confusable) return false;

  // Recompute distances from the echoed catalog (using catalog names).
  const recomputed: NameCandidate[] = [];
  for (const c of catalog) {
    if (!c || typeof c.drugId !== "string" || typeof c.name !== "string") return false;
    recomputed.push({
      drugId: c.drugId,
      name: c.name,
      editDistance: levenshtein(decision.normalizedName, normalizeDrugName(c.name))
    });
  }
  recomputed.sort(candidateCompare);

  const threshold = decision.editDistanceThreshold;
  const recomputedNearest = recomputed.length > 0 ? recomputed[0] : null;
  const recomputedExact = recomputedNearest !== null && recomputedNearest.editDistance === 0;
  const recomputedConfusable = recomputed.filter((c) => c.editDistance > 0 && c.editDistance <= threshold);
  const recomputedDisposition = deriveDisposition(recomputedExact, recomputedConfusable.length);

  // Nearest match must match (drugId + distance).
  if (recomputedNearest === null) {
    if (decision.nearestMatch != null) return false;
  } else {
    const nm = decision.nearestMatch;
    if (!nm || nm.drugId !== recomputedNearest.drugId || nm.editDistance !== recomputedNearest.editDistance) {
      return false;
    }
  }

  // Exact-match flag.
  if (decision.exactMatch !== recomputedExact) return false;

  // Confusable set (drugId → distance) must match exactly.
  if (confusable.length !== recomputedConfusable.length) return false;
  const recomputedById = new Map(recomputedConfusable.map((c) => [c.drugId, c.editDistance]));
  for (const c of confusable) {
    if (!c || typeof c.drugId !== "string" || typeof c.editDistance !== "number") return false;
    if (recomputedById.get(c.drugId) !== c.editDistance) return false;
  }

  // Disposition.
  if (decision.disposition !== recomputedDisposition) return false;
  return true;
}

/**
 * No-autonomous-substitution check: did the agent avoid autonomously substituting / correcting /
 * dispensing? True unless the determination reports it auto-substituted (autoSubstituted:true) or does
 * not require pharmacist review (requiresPharmacistReview:false). Anything evaluateMedicationNameSafety()
 * produces satisfies it. This is the honest signal the route reports to
 * policy.lasa.no-autonomous-substitution. A non-object input is a violation.
 */
export function lasaNoAutonomousSubstitution(
  decision:
    | { autoSubstituted?: boolean; requiresPharmacistReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoSubstituted === true) return false;
  if (decision.requiresPharmacistReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function medicationNameSafetySummary(decision: MedicationNameSafetyDetermination): {
  requestRef: string;
  patientRef: string;
  disposition: MedicationNameSafetyDisposition;
  exactMatch: boolean;
  nearestName: string | null;
  nearestDistance: number | null;
  confusableCount: number;
  requiresPharmacistReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    patientRef: decision.patientRef,
    disposition: decision.disposition,
    exactMatch: decision.exactMatch,
    nearestName: decision.nearestMatch?.name ?? null,
    nearestDistance: decision.nearestMatch?.editDistance ?? null,
    confusableCount: decision.confusable.length,
    requiresPharmacistReview: decision.requiresPharmacistReview,
    synthetic: decision.synthetic
  };
}

/**
 * An ILLUSTRATIVE synthetic formulary catalog — menopause / midlife-relevant drugs plus a classic LASA
 * pair (premarin vs primaxin, edit distance 2). Clearly labeled synthetic, NOT a real drug vocabulary.
 */
export const DEFAULT_FORMULARY_CATALOG: DrugCatalogEntry[] = [
  { drugId: "drug-estradiol", name: "estradiol" },
  { drugId: "drug-estradiol-valerate", name: "estradiol valerate" },
  { drugId: "drug-progesterone", name: "progesterone" },
  { drugId: "drug-medroxyprogesterone", name: "medroxyprogesterone" },
  { drugId: "drug-premarin", name: "premarin" },
  { drugId: "drug-primaxin", name: "primaxin" },
  { drugId: "drug-paroxetine", name: "paroxetine" },
  { drugId: "drug-gabapentin", name: "gabapentin" },
  { drugId: "drug-hydroxyzine", name: "hydroxyzine" },
  { drugId: "drug-hydralazine", name: "hydralazine" }
];

/** A representative demo request: an exact, clear match with no look-alike. Synthetic. */
export const DEMO_MEDICATION_NAME_SAFETY_REQUEST: MedicationNameSafetyRequest = {
  requestRef: "mns-001",
  patientRef: "patient-5521",
  prescribedName: "gabapentin"
};

/**
 * A representative demo request: an exact match (premarin) that nonetheless has a LASA look-alike
 * (primaxin, edit distance 2) — a lasa-warning. Synthetic.
 */
export const DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST: MedicationNameSafetyRequest = {
  requestRef: "mns-002",
  patientRef: "patient-6640",
  prescribedName: "premarin"
};

/**
 * A representative demo request: an unrecognized name — no exact match and nothing within the threshold.
 * Synthetic.
 */
export const DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST: MedicationNameSafetyRequest = {
  requestRef: "mns-003",
  patientRef: "patient-7712",
  prescribedName: "trelagliptin"
};
