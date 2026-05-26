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
 */

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
};

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
 */
export function scriptedRoute(intake: IntakeRecord): RoutingDecision {
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

  return {
    pathway,
    pathwayLabel: pathwayLabel(pathway),
    acuity: PATHWAY_ACUITY[pathway],
    rationale,
    redFlagsTriggered,
    recommendedTargetResponse: PATHWAY_TARGETS[pathway],
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-care-router-policy@1.0",
      via: "scripted-fallback"
    }
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
export async function claudeRoute(intake: IntakeRecord): Promise<RoutingDecision> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const scripted = scriptedRoute(intake);
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
      "Given a structured menopause intake record, choose exactly one care pathway:",
      "  self-care-tracking | mscp-virtual-visit | mscp-in-person |",
      "  urgent-gynecology | behavioral-health-handoff | ed-referral.",
      "Honor these clinical rules without exception:",
      "  - Any red-flag acknowledgment with bleeding -> urgent-gynecology.",
      "  - Any red-flag acknowledgment with mood domain -> behavioral-health-handoff.",
      "  - Any other red-flag acknowledgment -> ed-referral.",
      "  - Unexpected bleeding (any severity) -> urgent-gynecology.",
      "  - Age <40 with menopause-pattern symptoms -> mscp-in-person (rule out POI).",
      "Reply with a single JSON object matching this exact TypeScript type:",
      "  { pathway: CarePathway; rationale: string[]; redFlagsTriggered: string[] }",
      "Do not include any prose outside the JSON. Do not include code fences."
    ].join("\n");

    const userPrompt = JSON.stringify(intake, null, 2);

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
      }
    };
  } catch (err) {
    const scripted = scriptedRoute(intake);
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
export async function route(intake: IntakeRecord): Promise<RoutingDecision> {
  if (process.env.ANTHROPIC_API_KEY) {
    return claudeRoute(intake);
  }
  return scriptedRoute(intake);
}
