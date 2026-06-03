import { NextResponse } from "next/server";

import {
  DEMO_COHORT,
  findDemoPersona,
  type DemoPersona
} from "../../../../lib/demo-cohort";
import {
  DEMO_DATA360_PATIENT_ID,
  resolveIdentity
} from "../../../../lib/data-360";
import {
  getGroundingContextPreferReal,
  resolveIdentityFromOrg,
  warnSalesforceDegradationOnce
} from "../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../lib/salesforce/auth";

/**
 * Prechat-context for the live Salesforce Agentforce Service Agent.
 *
 *   GET /api/intake/prechat-context?personaId=anika-patel
 *
 * Returns a flat key/value bag the browser passes to Salesforce
 * Embedded Messaging via:
 *
 *   embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({...})
 *
 * after the `onEmbeddedMessagingReady` event fires and BEFORE the
 * conversation begins. Salesforce surfaces hidden-prechat fields to
 * the Agentforce Service Agent as Conversation Variables, so the
 * agent walks into the conversation already knowing who the patient
 * is and what their menopause-care context looks like.
 *
 * What the route does:
 *   1. Resolves the patient's identity via the same path the rest of
 *      the app uses — real Salesforce when configured, deterministic
 *      mock as a fallback.
 *   2. Pulls the federated grounding context (Health Cloud Phase 1
 *      in the real path; Data 360 simulator in the mock path).
 *   3. Flattens the grounding into ~20 string-typed fields plus one
 *      compact JSON dossier (Patient_Context_JSON) that captures
 *      every signal the agent should be able to cite verbatim.
 *
 * Field schema (all values are strings — Salesforce hidden prechat
 * fields are string-typed):
 *
 *   _firstName, _lastName                    -- Salesforce-standard
 *   Patient_Id                                -- Salesforce Contact.Id when real
 *   Identity_Confidence                       -- 0.0-1.0 as string
 *   Identity_Sources                          -- comma-separated source labels
 *   Identity_Ruleset
 *   Age_Band, Cycle_Status, Primary_Symptom
 *   Vasomotor_Score, Sleep_Score, Mood_Score  -- 0-10 ints as strings
 *   Care_Program_Status                       -- e.g. "Enrolled" | "Not enrolled"
 *   Care_Plan_Status                          -- e.g. "Active" | "None"
 *   Days_Since_Last_Contact
 *   Cohort_Name, Cohort_Size, Patient_Percentile
 *   Grounding_Source                          -- "real" | "mock"
 *   Grounding_Insights_Count
 *   Patient_Context_JSON                      -- compact JSON, <2KB
 *   Demo_Note                                 -- short narrative for the agent
 *
 * Registration: every non-underscore field above must be added to
 * the Messaging Channel's Parameter Mappings in Salesforce Setup
 * before the agent will see it as a Conversation Variable. The
 * underscore-prefixed standard fields are accepted automatically.
 * See docs/PHASE_3_RUNBOOK.md for the click-through.
 *
 * Why GET, not POST: the patient picker on /demo/intake selects a
 * persona, and the resulting hidden-field bag is idempotent for
 * that persona. GET keeps the cache semantics obvious (no body,
 * cacheable per-querystring at the CDN if we want it later).
 *
 * Returns 404 if the personaId doesn't match a known demo persona —
 * the picker is closed-list so this only fires for hand-edited URLs.
 */

const MAX_JSON_BYTES = 1800;

type PrechatContextResponse = {
  meta: {
    _personaId: string;
    _personaFullName: string;
    _identitySource: "real" | "mock";
    _groundingSource: "real" | "mock";
    _salesforceConfigured: boolean;
    _generatedAt: string;
    _note: string;
  };
  prechatFields: Record<string, string>;
};

function clampJson(value: unknown): string {
  const compact = JSON.stringify(value);
  if (compact.length <= MAX_JSON_BYTES) return compact;
  // Last-ditch truncation. We never expect to hit this in the
  // current cohort, but defending against future field bloat keeps
  // the route safe from quietly dropping Salesforce-rejected payloads.
  return compact.slice(0, MAX_JSON_BYTES - 3) + "...";
}

async function buildPrechatFields(
  persona: DemoPersona
): Promise<{
  fields: Record<string, string>;
  identitySource: "real" | "mock";
  groundingSource: "real" | "mock";
}> {
  let identitySource: "real" | "mock" = "mock";
  let identity = resolveIdentity({
    preferredName: persona.firstName,
    ageBand: persona.ageBand,
    cycleStatus: persona.cycleStatus
  });

  if (isSalesforceConfigured()) {
    try {
      const real = await resolveIdentityFromOrg({
        preferredName: persona.firstName,
        ageBand: persona.ageBand,
        cycleStatus: persona.cycleStatus
      });
      if (real) {
        identity = real;
        identitySource = "real";
      }
    } catch (err) {
      warnSalesforceDegradationOnce("prechat.identity.resolve", err);
    }
  }

  const { source: groundingSource, grounding } = await getGroundingContextPreferReal({
    patientId: identity.unifiedPatientId || DEMO_DATA360_PATIENT_ID,
    hint: {
      ageBand: persona.ageBand,
      primarySymptom: persona.primarySymptom,
      cycleStatus: persona.cycleStatus
    }
  });

  const careProgramInsight = grounding.calculatedInsights.find(
    (i) => i.id === "insight.active-care-program"
  );
  const carePlanInsight = grounding.calculatedInsights.find(
    (i) => i.id === "insight.active-care-plan-status"
  );

  // Compact dossier for the agent. Includes the human narrative
  // (profileNote) and the structured longitudinal observations so
  // the agent can answer questions like "what's her HRV trend?"
  // without an extra round-trip.
  const dossier = {
    persona: {
      id: persona.id,
      name: `${persona.firstName} ${persona.lastName}`,
      ageBand: persona.ageBand,
      cycleStatus: persona.cycleStatus,
      primarySymptom: persona.primarySymptom,
      intakeScores: {
        vasomotor: persona.vasomotorScore,
        sleep: persona.sleepScore,
        mood: persona.moodScore
      },
      profileNote: persona.profileNote
    },
    identity: {
      unifiedPatientId: identity.unifiedPatientId,
      confidence: identity.confidence,
      ruleset: identity.resolutionRuleset,
      matchedSources: identity.matchedSources,
      source: identitySource
    },
    grounding: {
      source: groundingSource,
      cohort: grounding.cohortComparison.cohortName,
      cohortSize: grounding.cohortComparison.cohortSize,
      patientPercentile: grounding.cohortComparison.patientPercentile,
      lastClinicianContactDaysAgo: grounding.lastClinicianContact.daysAgo,
      careProgram:
        careProgramInsight?.value !== undefined
          ? String(careProgramInsight.value)
          : "Unknown",
      carePlan:
        carePlanInsight?.value !== undefined
          ? String(carePlanInsight.value)
          : "Unknown",
      insights: grounding.calculatedInsights.map((i) => ({
        name: i.name,
        value: i.value,
        unit: i.unit
      })),
      longitudinal: grounding.longitudinalObservations.map((o) => ({
        display: o.display,
        value: o.value,
        unit: o.unit,
        trend: o.trend
      }))
    }
  };

  // Resolve a couple of plain-string projections the agent prompt
  // can reference directly without parsing JSON. These are the
  // first-class hidden fields the customer will register in
  // Parameter Mappings; everything else is in Patient_Context_JSON.
  const careProgramStatus =
    careProgramInsight?.value !== undefined
      ? String(careProgramInsight.value)
      : "Unknown";
  const carePlanStatus =
    carePlanInsight?.value !== undefined
      ? String(carePlanInsight.value)
      : "Unknown";

  const daysSinceContact = grounding.lastClinicianContact.daysAgo;

  const fields: Record<string, string> = {
    _firstName: persona.firstName,
    _lastName: persona.lastName,
    Patient_Id: identity.unifiedPatientId,
    Identity_Confidence: identity.confidence.toFixed(2),
    Identity_Sources: identity.matchedSources.join(", "),
    Identity_Ruleset: identity.resolutionRuleset,
    Age_Band: persona.ageBand,
    Cycle_Status: persona.cycleStatus,
    Primary_Symptom: persona.primarySymptom,
    Vasomotor_Score: String(persona.vasomotorScore),
    Sleep_Score: String(persona.sleepScore),
    Mood_Score: String(persona.moodScore),
    Care_Program_Status: careProgramStatus,
    Care_Plan_Status: carePlanStatus,
    Days_Since_Last_Contact: String(daysSinceContact),
    Cohort_Name: grounding.cohortComparison.cohortName,
    Cohort_Size: String(grounding.cohortComparison.cohortSize),
    Patient_Percentile: String(grounding.cohortComparison.patientPercentile),
    Grounding_Source: groundingSource,
    Grounding_Insights_Count: String(
      grounding.groundingProvenance.computedInsightsCount
    ),
    Demo_Note: `Pre-resolved Pause-Health demo patient. ${persona.profileNote} The patient already opened the chat from a clinician's dashboard, so begin by acknowledging what you already know rather than asking for identity again.`,
    Patient_Context_JSON: clampJson(dossier)
  };

  return { fields, identitySource, groundingSource };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const personaId = (url.searchParams.get("personaId") || "").trim();

  if (!personaId) {
    return NextResponse.json(
      {
        error:
          "Missing personaId. Pass one of: " +
          DEMO_COHORT.map((p) => p.id).join(", ")
      },
      { status: 400 }
    );
  }

  const persona = findDemoPersona(personaId);
  if (!persona) {
    return NextResponse.json(
      {
        error: `Unknown personaId: ${personaId}. Known: ${DEMO_COHORT.map((p) => p.id).join(", ")}`
      },
      { status: 404 }
    );
  }

  try {
    const { fields, identitySource, groundingSource } = await buildPrechatFields(
      persona
    );

    const response: PrechatContextResponse = {
      meta: {
        _personaId: persona.id,
        _personaFullName: `${persona.firstName} ${persona.lastName}`,
        _identitySource: identitySource,
        _groundingSource: groundingSource,
        _salesforceConfigured: isSalesforceConfigured(),
        _generatedAt: new Date().toISOString(),
        _note:
          identitySource === "real" && groundingSource === "real"
            ? "Live resolution against your Salesforce Health Cloud org plus federated grounding. The agent will see real Contact.Id and real care-plan / care-program state."
            : "Deterministic mock dossier. Set SF_INSTANCE_URL / SF_CLIENT_ID / SF_CLIENT_SECRET and seed the demo cohort to enable real identity + grounding."
      },
      prechatFields: fields
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to build prechat context",
        detail: err instanceof Error ? err.message : String(err)
      },
      { status: 500 }
    );
  }
}
