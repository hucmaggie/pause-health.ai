/**
 * Pause Care Router agent.
 *
 * Given a structured menopause intake record (from the Agentforce
 * Service Agent or its fallback), decide the appropriate care pathway,
 * with rationale and red-flag awareness.
 *
 * Two implementations:
 *
 *   1. scriptedRoute() -- deterministic policy engine. Always available.
 *      Mirrors what a Claude model would return for the standard
 *      symptom clusters. Used as the prototype default and as a
 *      fallback when the Anthropic SDK call fails.
 *
 *   2. claudeRoute() -- real Anthropic SDK call gated by
 *      ANTHROPIC_API_KEY. Model is configurable via
 *      PAUSE_CARE_ROUTER_MODEL (defaults to claude-sonnet-4-5-20250929).
 *      Returns the same RoutingDecision shape.
 *
 * The chosen pathway is one of the five care pathways Pause currently
 * supports. The names match `/demo/routing` so the routing dashboard
 * can highlight the recommended row.
 *
 * When the chosen pathway is an MSCP visit (virtual or in-person), the
 * decision is enriched with a ranked recommended-provider list pulled
 * from the provider graph (NPPES taxonomy filter + MSCP overlay,
 * served behind the /api/mulesoft/providers contract). This is the seam
 * where the provider graph feeds routing, not just the demo directory.
 */

import { getProvidersPreferReal } from "./mulesoft/providers";
import type { ProviderRecord } from "./mulesoft-mocks";
import { lookupZipCentroid } from "./zip-centroids";

export type CarePathway =
  | "self-care-tracking"
  | "mscp-virtual-visit"
  | "mscp-in-person"
  | "urgent-gynecology"
  | "behavioral-health-handoff"
  | "ed-referral";

export type IntakeRecord = {
  preferredName?: string;
  ageBand?: string;
  cycleStatus?: string;
  primarySymptom?: string;
  severity?: "mild" | "moderate" | "severe" | string;
  redFlagsAcknowledged?: "yes" | "no" | "none" | string;
  /** Optional free-form notes appended by the intake agent. */
  notes?: string;
  /**
   * Optional patient ZIP captured at intake. When present, the MSCP
   * provider recommendations are narrowed to the patient's area
   * (3-digit prefix); when absent we surface the top national matches.
   */
  patientZip?: string;
  /**
   * Optional patient insurance plan captured at intake (e.g. "Aetna",
   * "BCBS", "Medicare"). When present, the directory narrows
   * recommendations to providers accepting that plan; common synonyms
   * are normalized inside the directory ("United" → "uhc"). Absent =
   * no insurance filter.
   */
  patientInsurance?: string;
};

/**
 * Subset of the Salesforce Data 360 grounding context the Care Router
 * cares about. Matches the GroundingContext shape in lib/data-360.ts
 * but typed loosely here so we don't create a cross-lib cycle.
 */
export type Data360GroundingHint = {
  unifiedPatientId?: string;
  calculatedInsights?: Array<{
    id: string;
    name: string;
    value: number | string;
    unit?: string;
    /**
     * Source-independent classifier (see InsightKind in lib/data-360.ts). The
     * router matches on this so live vs mock insight-id differences can't
     * silently drop a rationale; typed as a loose string to avoid a cross-lib
     * cycle. May be absent on legacy fixtures — id-aliases cover those.
     */
    kind?: string;
  }>;
  longitudinalObservations?: Array<{
    display: string;
    value: number;
    unit: string;
    trend?: string;
  }>;
  lastClinicianContact?: { daysAgo: number; clinicianType: string };
  cohortComparison?: {
    cohortName: string;
    cohortSize: number;
    patientPercentile: number;
    metric: string;
    /**
     * Provenance of patientPercentile (see CohortBasis in lib/data-360.ts).
     * "intake-estimate" (today's only value) means the percentile is scaled
     * from the patient's own intake score, not a live cohort rank — the
     * rationale hedges accordingly so it isn't presented as segment analytics.
     */
    basis?: string;
  };
};

export type RoutingDecision = {
  pathway: CarePathway;
  pathwayLabel: string;
  acuity: "self-care" | "routine" | "expedited" | "urgent" | "emergent";
  rationale: string[];
  redFlagsTriggered: string[];
  recommendedTargetResponse: string;
  modelProvenance: {
    provider: "anthropic" | "pause-scripted";
    model: string;
    via: "claude-api" | "scripted-fallback";
  };
  /** Data 360 signals that influenced the decision (when grounding present). */
  groundingUsed?: {
    insightsCited: string[];
    cohortName?: string;
    lastClinicianContactDaysAgo?: number;
  };
  /**
   * MSCP provider recommendations from the provider graph. Present only
   * for the mscp-virtual-visit / mscp-in-person pathways. `source`
   * reports whether the rows came from the live MuleSoft Experience API
   * or the NPPES-derived in-process directory.
   */
  recommendedProviders?: {
    source: "live" | "mock";
    modality: "virtual" | "in-person";
    query: { zip: string | null; menopauseOnly: true; insurance: string | null };
    total: number;
    providers: RecommendedProvider[];
  };
};

/** Subset of ProviderRecord surfaced on a routing decision. */
export type RecommendedProvider = Pick<
  ProviderRecord,
  | "npi"
  | "name"
  | "specialty"
  | "credentials"
  | "menopauseCertified"
  | "city"
  | "state"
  | "telehealth"
  | "acceptingNewPatients"
  | "graphScore"
> & {
  /**
   * Great-circle miles from the patient's ZIP centroid. Present when the
   * provider lookup ranked by distance (i.e. the patient ZIP resolved to a
   * Census ZCTA centroid AND the provider has its own coordinates); null
   * otherwise. The UI should fall back to graphScore-only ordering when this
   * is null on every recommendation.
   */
  distanceMiles?: number | null;
  /**
   * Public-registry service-line signals (facog, whnp, cnm, multi-taxonomy,
   * etc.) — empty array when none matched. Useful for sub-ranking the
   * relevant-local tier honestly: a non-certified provider with `facog` is
   * a board-certified OB/GYN, which is meaningful to surface to the patient.
   */
  serviceSignals?: string[];
  /**
   * Plans the provider accepts (e.g. ["medicare", "aetna", "bcbs"]).
   * Synthesized at build time today (no public payer feed); see the OAS
   * `Provider.insuranceAccepted` description for the canonical token list.
   */
  insuranceAccepted?: string[];
};

/**
 * Injectable provider lookup so the enrichment can be unit-tested
 * without touching the network. Defaults to getProvidersPreferReal,
 * which serves the live Mule app when MULESOFT_PROVIDERS_BASE_URL is
 * set and otherwise the NPPES-derived in-process directory.
 */
export type ProviderLookup = (query: {
  zip?: string;
  menopauseOnly?: boolean;
  limit?: number;
  /**
   * Patient ZIP centroid forwarded to the directory so it can rank by
   * Haversine distance. The lookup is responsible for stamping
   * `distanceMiles` on each returned provider when this is supplied.
   */
  zipCentroid?: { latitude: number; longitude: number } | null;
  /**
   * Optional plan name (case-insensitive; synonyms normalized inside the
   * directory). When set, only providers whose insuranceAccepted list
   * contains the plan come back.
   */
  insurance?: string | null;
}) => Promise<{
  source: "live" | "mock";
  result: {
    total: number;
    providers: Array<ProviderRecord & { distanceMiles?: number | null }>;
  };
}>;

export type RouteOptions = {
  providerLookup?: ProviderLookup;
};

const MAX_RECOMMENDED_PROVIDERS = 3;
/** Pull a slightly larger candidate set so modality re-ranking has room. */
const PROVIDER_CANDIDATE_POOL = 8;

function isMscpPathway(p: CarePathway): boolean {
  return p === "mscp-virtual-visit" || p === "mscp-in-person";
}

function toRecommendedProvider(
  p: ProviderRecord & { distanceMiles?: number | null }
): RecommendedProvider {
  return {
    npi: p.npi,
    name: p.name,
    specialty: p.specialty,
    credentials: p.credentials,
    menopauseCertified: p.menopauseCertified,
    city: p.city,
    state: p.state,
    telehealth: p.telehealth,
    acceptingNewPatients: p.acceptingNewPatients,
    graphScore: p.graphScore,
    distanceMiles: p.distanceMiles ?? null,
    serviceSignals: p.serviceSignals ?? [],
    insuranceAccepted: p.insuranceAccepted ?? []
  };
}

/**
 * Stable partition that pulls preference-matching providers to the
 * front while preserving the directory's graphScore ordering within
 * each group. Virtual visits prefer telehealth-capable clinicians;
 * in-person visits prefer those accepting new patients.
 */
function rankForModality<P extends ProviderRecord>(
  providers: P[],
  modality: "virtual" | "in-person"
): P[] {
  const prefers = (p: P) =>
    modality === "virtual" ? p.telehealth : p.acceptingNewPatients;
  const preferred = providers.filter(prefers);
  const rest = providers.filter((p) => !prefers(p));
  return [...preferred, ...rest];
}

/**
 * Attach MSCP provider recommendations to a routing decision when the
 * pathway warrants it. Never throws — provider lookup is best-effort
 * enrichment, and the routing decision must stand on its own if the
 * provider graph is unavailable.
 */
export async function attachRecommendedProviders(
  decision: RoutingDecision,
  intake: IntakeRecord,
  opts: RouteOptions = {}
): Promise<RoutingDecision> {
  if (!isMscpPathway(decision.pathway)) return decision;

  const modality: "virtual" | "in-person" =
    decision.pathway === "mscp-virtual-visit" ? "virtual" : "in-person";
  const lookup = opts.providerLookup ?? getProvidersPreferReal;
  const zip = intake.patientZip?.trim() || undefined;
  const zipCentroid = lookupZipCentroid(zip);
  const insurance = intake.patientInsurance?.trim() || undefined;

  try {
    const { source, result } = await lookup({
      zip,
      menopauseOnly: true,
      limit: PROVIDER_CANDIDATE_POOL,
      zipCentroid,
      insurance
    });
    const ranked = rankForModality(result.providers, modality).slice(
      0,
      MAX_RECOMMENDED_PROVIDERS
    );
    if (ranked.length === 0) return decision;

    // The directory ranks by Haversine distance when both centroids are
    // present (every returned row carries distanceMiles); the rationale line
    // calls that out so it's traceable in the agent fabric. When unranked by
    // distance — no patient centroid, or the live Mule worker hasn't been
    // updated to honor it — we say "ranked by graph score" honestly.
    const rankedByDistance = ranked.some(
      (p) => typeof p.distanceMiles === "number"
    );
    const rankingNote = rankedByDistance
      ? "ranked by distance from the patient's ZIP"
      : "ranked by graph score";

    const where = zip ? `near ${zip}` : "nationally";
    const modalityLabel = modality === "virtual" ? "telehealth-capable" : "in-person";
    const planNote = insurance ? ` accepting ${insurance}` : "";
    return {
      ...decision,
      rationale: [
        ...decision.rationale,
        `Provider graph: surfaced ${ranked.length} MSCP-credentialed ${modalityLabel} ${ranked.length === 1 ? "clinician" : "clinicians"}${planNote} ${where} (${source === "live" ? "live MuleSoft directory" : "NPPES-derived directory"}), ${rankingNote}.`
      ],
      recommendedProviders: {
        source,
        modality,
        query: { zip: zip ?? null, menopauseOnly: true, insurance: insurance ?? null },
        total: result.total,
        providers: ranked.map(toRecommendedProvider)
      }
    };
  } catch {
    // Best-effort: a provider-graph failure must not break routing.
    return decision;
  }
}

type InsightMatch = { kind: string; idAliases: string[] };

/**
 * The insights the router branches on, identified the drift-proof way: by
 * `kind` first, with the known mock + live `id`s as a fallback for fixtures
 * that predate the `kind` field. The HRV and last-contact concepts each carry
 * BOTH the mock id and the (different) live id — the exact pair that used to
 * silently drop the rationale the moment an org went live.
 */
const HRV_INSIGHT: InsightMatch = {
  kind: "hrv-variability",
  idAliases: ["insight.hrv-zscore-30d", "insight.hrv-rmssd-30d"]
};
const VASOMOTOR_INSIGHT: InsightMatch = {
  kind: "vasomotor-burden",
  idAliases: ["insight.vasomotor-burden-30d"]
};
const CLINICAL_CONTACT_INSIGHT: InsightMatch = {
  kind: "days-since-clinical-contact",
  idAliases: [
    "insight.days-since-mscp-contact",
    "insight.days-since-last-clinical-contact"
  ]
};

/** Find an insight by kind, falling back to its known id-aliases. */
function findInsight(
  grounding: Data360GroundingHint | undefined,
  match: InsightMatch
): { id: string; value: number } | undefined {
  const insights = grounding?.calculatedInsights;
  if (!insights) return undefined;
  const hit = insights.find(
    (i) => i.kind === match.kind || match.idAliases.includes(i.id)
  );
  if (!hit) return undefined;
  const value = typeof hit.value === "number" ? hit.value : Number(hit.value);
  if (!Number.isFinite(value)) return undefined;
  return { id: hit.id, value };
}

function groundingRationale(
  grounding: Data360GroundingHint | undefined
): { rationale: string[]; insightsCited: string[] } {
  if (!grounding) return { rationale: [], insightsCited: [] };
  const out: string[] = [];
  const cited: string[] = [];

  const hrv = findInsight(grounding, HRV_INSIGHT);
  if (hrv && hrv.value >= 1.0) {
    out.push(
      `Data 360 grounding: 30-day HRV variability z-score is ${hrv.value.toFixed(2)} (above 1.0 reference); biomarker drift consistent with active menopause transition.`
    );
    cited.push(hrv.id);
  }

  const vaso = findInsight(grounding, VASOMOTOR_INSIGHT);
  if (vaso && vaso.value >= 50) {
    out.push(
      `Data 360 grounding: vasomotor burden index is ${vaso.value} (>=50 indicates clinically significant burden over the last 30 days).`
    );
    cited.push(vaso.id);
  }

  const contact = findInsight(grounding, CLINICAL_CONTACT_INSIGHT);
  if (contact && contact.value >= 365) {
    out.push(
      `Data 360 grounding: no documented clinician contact in ${contact.value} days. Pathway should favor an MSCP touchpoint when symptoms warrant.`
    );
    cited.push(contact.id);
  }

  if (grounding.cohortComparison) {
    const c = grounding.cohortComparison;
    if (c.basis === "data-cloud-segment") {
      out.push(
        `Data 360 cohort: patient sits at the ${c.patientPercentile}th percentile of ${c.cohortName} (n=${c.cohortSize}) by ${c.metric}.`
      );
    } else {
      // "intake-estimate" (or unset): the percentile is scaled from the
      // patient's own intake score, not a live cohort rank — say so plainly.
      out.push(
        `Data 360 cohort: ${c.cohortName} (n=${c.cohortSize}). Patient's intake-reported ${c.metric} maps to an estimated ${c.patientPercentile}th-percentile burden (intake-derived estimate, not a live Data Cloud segment).`
      );
    }
  }

  return { rationale: out, insightsCited: cited };
}

const PATHWAY_LABELS: Record<CarePathway, string> = {
  "self-care-tracking": "Self-care + symptom tracking",
  "mscp-virtual-visit": "Menopause specialist (virtual)",
  "mscp-in-person": "Menopause specialist (in person)",
  "urgent-gynecology": "Urgent gynecology review",
  "behavioral-health-handoff": "Behavioral health handoff",
  "ed-referral": "Emergency department"
};

const PATHWAY_TARGETS: Record<CarePathway, string> = {
  "self-care-tracking": "Self-paced; wearable + symptom tracker enabled",
  "mscp-virtual-visit": "< 7 days",
  "mscp-in-person": "< 14 days",
  "urgent-gynecology": "< 24h",
  "behavioral-health-handoff": "Same day",
  "ed-referral": "Immediate (call 911 or go to ED)"
};

const PATHWAY_ACUITY: Record<CarePathway, RoutingDecision["acuity"]> = {
  "self-care-tracking": "self-care",
  "mscp-virtual-visit": "routine",
  "mscp-in-person": "routine",
  "urgent-gynecology": "expedited",
  "behavioral-health-handoff": "urgent",
  "ed-referral": "emergent"
};

function pathwayLabel(p: CarePathway): string {
  return PATHWAY_LABELS[p];
}

function isRedFlagFlagged(intake: IntakeRecord): boolean {
  const v = intake.redFlagsAcknowledged;
  return v === "yes";
}

/**
 * Deterministic policy engine. Mirrors the decision a clinician (or a
 * well-calibrated LLM) would make on the same intake, using ACOG +
 * Menopause Society clinical guidance as the underlying rubric.
 *
 * Optional `grounding` (from Salesforce Data 360) enriches the
 * rationale and lets us "promote" virtual MSCP visits to in-person
 * when longitudinal biomarkers warrant it.
 */
export function scriptedRoute(
  intake: IntakeRecord,
  grounding?: Data360GroundingHint
): RoutingDecision {
  const rationale: string[] = [];
  const redFlagsTriggered: string[] = [];

  let pathway: CarePathway = "self-care-tracking";

  if (isRedFlagFlagged(intake)) {
    redFlagsTriggered.push("Patient acknowledged at least one red-flag symptom");
    if (intake.primarySymptom === "bleeding") {
      pathway = "urgent-gynecology";
      rationale.push(
        "Postmenopausal or unexpected bleeding requires evaluation within 24 hours per ACOG guidance."
      );
    } else if (intake.primarySymptom === "mood") {
      pathway = "behavioral-health-handoff";
      rationale.push(
        "Active safety concern in the mood / mental-health domain requires same-day behavioral health connection."
      );
    } else {
      pathway = "ed-referral";
      rationale.push(
        "Acknowledged red-flag symptom outside the standard menopause symptom set; emergency evaluation recommended."
      );
    }
  } else if (intake.primarySymptom === "bleeding") {
    pathway = "urgent-gynecology";
    rationale.push(
      "Unexpected bleeding is a high-priority symptom regardless of severity; gynecology review within 24h."
    );
  } else if (intake.primarySymptom === "mood" && intake.severity === "severe") {
    pathway = "behavioral-health-handoff";
    rationale.push(
      "Severe mood symptoms warrant same-day behavioral health connection even without an active safety flag."
    );
  } else if (intake.severity === "severe") {
    pathway = "mscp-in-person";
    rationale.push(
      "Severe symptoms benefit from in-person menopause specialist evaluation to enable physical exam and formal hormone workup."
    );
  } else if (intake.severity === "moderate") {
    pathway = "mscp-virtual-visit";
    rationale.push(
      "Moderate symptoms are well-served by an MSCP-credentialed virtual visit -- highest-confidence menopause-experienced consult."
    );
  } else if (intake.severity === "mild") {
    pathway = "self-care-tracking";
    rationale.push(
      "Mild symptoms with no red flags; structured self-care with wearable tracking and symptom journaling."
    );
  } else {
    pathway = "mscp-virtual-visit";
    rationale.push(
      "Severity not yet captured; defaulting to a virtual menopause specialist visit pending more information."
    );
  }

  if (intake.cycleStatus === "stopped>=12mo" && pathway === "self-care-tracking") {
    rationale.push(
      "Patient is post-menopause (12+ months amenorrhea) -- standing recommendation to maintain MSCP follow-up cadence."
    );
  }

  if (intake.ageBand === "<40" && pathway !== "ed-referral") {
    pathway = "mscp-in-person";
    rationale.push(
      "Patient under 40 with menopause-pattern symptoms -- premature ovarian insufficiency must be ruled out by in-person specialist."
    );
  }

  // Data 360 grounding adjustments: a virtual visit becomes an
  // in-person visit when longitudinal biomarkers + cohort percentile
  // suggest the patient is at the higher-burden end of her cohort.
  const groundingExtras = groundingRationale(grounding);
  const vasoBurden = findInsight(grounding, VASOMOTOR_INSIGHT)?.value;
  const cohortPctile = grounding?.cohortComparison?.patientPercentile;
  if (
    pathway === "mscp-virtual-visit" &&
    ((typeof vasoBurden === "number" && vasoBurden >= 60) ||
      (typeof cohortPctile === "number" && cohortPctile >= 75))
  ) {
    pathway = "mscp-in-person";
    rationale.push(
      "Data 360 longitudinal context shifted this case from virtual to in-person MSCP visit (burden and cohort percentile both elevated)."
    );
  }

  return {
    pathway,
    pathwayLabel: pathwayLabel(pathway),
    acuity: PATHWAY_ACUITY[pathway],
    rationale: [...rationale, ...groundingExtras.rationale],
    redFlagsTriggered,
    recommendedTargetResponse: PATHWAY_TARGETS[pathway],
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-care-router-policy@1.0",
      via: "scripted-fallback"
    },
    groundingUsed: grounding
      ? {
          insightsCited: groundingExtras.insightsCited,
          cohortName: grounding.cohortComparison?.cohortName,
          lastClinicianContactDaysAgo: grounding.lastClinicianContact?.daysAgo
        }
      : undefined
  };
}

/**
 * Real Anthropic SDK call. Loaded dynamically so the package only
 * resolves when ANTHROPIC_API_KEY is set -- keeps build time light
 * and avoids breaking environments without the dep installed.
 *
 * The model is instructed to return strict JSON matching the
 * RoutingDecision shape; on any parsing or transport error we fall
 * back to scriptedRoute() and tag provenance accordingly.
 */
export async function claudeRoute(
  intake: IntakeRecord,
  grounding?: Data360GroundingHint
): Promise<RoutingDecision> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const scripted = scriptedRoute(intake, grounding);
    return {
      ...scripted,
      rationale: [
        "ANTHROPIC_API_KEY not set; using deterministic Pause policy engine.",
        ...scripted.rationale
      ]
    };
  }

  const model =
    process.env.PAUSE_CARE_ROUTER_MODEL ?? "claude-sonnet-4-5-20250929";

  try {
    // Dynamic import keeps @anthropic-ai/sdk a soft dependency.
    const mod = (await import("@anthropic-ai/sdk")).default;
    const client = new mod({ apiKey });

    const systemPrompt = [
      "You are the Pause-Health.ai Care Router agent.",
      "Given a structured menopause intake record AND optional Salesforce Data 360 longitudinal grounding context, choose exactly one care pathway:",
      "  self-care-tracking | mscp-virtual-visit | mscp-in-person |",
      "  urgent-gynecology | behavioral-health-handoff | ed-referral.",
      "Honor these clinical rules without exception:",
      "  - Any red-flag acknowledgment with bleeding -> urgent-gynecology.",
      "  - Any red-flag acknowledgment with mood domain -> behavioral-health-handoff.",
      "  - Any other red-flag acknowledgment -> ed-referral.",
      "  - Unexpected bleeding (any severity) -> urgent-gynecology.",
      "  - Age <40 with menopause-pattern symptoms -> mscp-in-person (rule out POI).",
      "When Data 360 grounding is provided, you SHOULD:",
      "  - Cite specific calculated insights or longitudinal observations in your rationale.",
      "  - Prefer mscp-in-person over mscp-virtual-visit when the patient sits at >=75th percentile of her cohort by vasomotor burden, OR when 30-day vasomotor burden >= 60.",
      "  - Note 'days since MSCP contact' when >365 days in your rationale.",
      "Reply with a single JSON object matching this exact TypeScript type:",
      "  { pathway: CarePathway; rationale: string[]; redFlagsTriggered: string[] }",
      "Do not include any prose outside the JSON. Do not include code fences."
    ].join("\n");

    const userPrompt = JSON.stringify(
      { intake, data360Grounding: grounding ?? null },
      null,
      2
    );

    const resp = await client.messages.create({
      model,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const textPart = resp.content.find(
      (c: { type: string }) => c.type === "text"
    ) as { type: "text"; text: string } | undefined;
    if (!textPart) throw new Error("Claude response had no text content");

    const parsed = JSON.parse(textPart.text) as {
      pathway: CarePathway;
      rationale: string[];
      redFlagsTriggered: string[];
    };

    if (!(parsed.pathway in PATHWAY_LABELS)) {
      throw new Error(`Claude returned unknown pathway: ${parsed.pathway}`);
    }

    const groundingExtras = groundingRationale(grounding);
    return {
      pathway: parsed.pathway,
      pathwayLabel: PATHWAY_LABELS[parsed.pathway],
      acuity: PATHWAY_ACUITY[parsed.pathway],
      rationale: parsed.rationale,
      redFlagsTriggered: parsed.redFlagsTriggered ?? [],
      recommendedTargetResponse: PATHWAY_TARGETS[parsed.pathway],
      modelProvenance: {
        provider: "anthropic",
        model,
        via: "claude-api"
      },
      groundingUsed: grounding
        ? {
            insightsCited: groundingExtras.insightsCited,
            cohortName: grounding.cohortComparison?.cohortName,
            lastClinicianContactDaysAgo: grounding.lastClinicianContact?.daysAgo
          }
        : undefined
    };
  } catch (err) {
    const scripted = scriptedRoute(intake, grounding);
    return {
      ...scripted,
      rationale: [
        `Claude API call failed (${(err as Error).message}); using deterministic Pause policy engine.`,
        ...scripted.rationale
      ]
    };
  }
}

/**
 * Public entry point for the API route. Picks between the real Claude
 * call and the scripted fallback based on env. The returned decision
 * always includes modelProvenance so the Agent Fabric trace viewer can
 * show which path was taken.
 */
export async function route(
  intake: IntakeRecord,
  grounding?: Data360GroundingHint,
  opts: RouteOptions = {}
): Promise<RoutingDecision> {
  const decision = process.env.ANTHROPIC_API_KEY
    ? await claudeRoute(intake, grounding)
    : scriptedRoute(intake, grounding);
  return attachRecommendedProviders(decision, intake, opts);
}
