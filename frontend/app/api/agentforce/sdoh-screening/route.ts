import { NextResponse } from "next/server";
import {
  isAllowlistedSdohScreener,
  screenSocialNeeds,
  sdohReferralHasConsent,
  usesValidatedSdohScreener,
  type SdohDomainId,
  type SdohScreener,
  type SdohScreeningResponse
} from "../../../../lib/sdoh";
import { evaluateGovernance } from "../../../../lib/agent-fabric";

/**
 * Agentforce-facing REST alias for the SDOH Screening agent.
 *
 *   GET /api/agentforce/sdoh-screening?housing=1,1&food=0,0&transportation=0&utilities=0&safety=1,1,1,1&patientConsent=true
 *
 * The fabric agent proper speaks Google A2A (`POST /api/agents/sdoh-screening/
 * tasks`). Salesforce Agentforce External Services map a flat REST request, so
 * this alias exposes the SAME deterministic CMS AHC-HRSN screening
 * (`screenSocialNeeds`) and the SAME Agent Fabric governance gate (validated
 * screener; consent required before a community-resource referral; no free-text
 * PII) as a plain GET that returns the flat screening result.
 *
 * Per-domain responses are passed as comma-separated integer vectors, one query
 * param per AHC-HRSN domain (item counts: housing 2, food 2, transportation 1,
 * utilities 1, safety 4 — the HITS interpersonal-safety screen, cutoff >10). A
 * positive safety screen is a MANDATORY human-social-worker escalation, surfaced
 * in redFlags. Pure re-use of lib/sdoh.ts — no new logic. Synthetic/advisory.
 *
 * Registered in Salesforce as the External Service `PauseSdohScreening`
 * (see salesforce/external-services/pause-sdoh-screening.oas.yaml).
 */

const FABRIC_AGENT_ID = "sdoh-screening-agent";
const DOMAIN_IDS: SdohDomainId[] = ["housing", "food", "transportation", "utilities", "safety"];

/** Parse a comma-separated integer vector query param, or undefined if absent. */
function parseVec(v: string | null): number[] | undefined {
  if (v === null || v.trim().length === 0) return undefined;
  const parts = v.split(",").map((s) => Number(s.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.map((n) => Math.trunc(n));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const screenerRaw = (searchParams.get("screener") ?? "ahc-hrsn").trim();
  const screener = screenerRaw as SdohScreener;
  const patientConsent = searchParams.get("patientConsent") === "true";

  const responses: Partial<Record<SdohDomainId, number[]>> = {};
  for (const id of DOMAIN_IDS) {
    const vec = parseVec(searchParams.get(id));
    if (vec) responses[id] = vec;
  }

  const screening: SdohScreeningResponse = { screener, responses };

  // Governance pre-flight — same signals the A2A route enforces: the screener
  // must be on the validated allow-list; a community-resource referral requires
  // explicit patient consent (only gated once a positive domain would draft one);
  // the agent emits structured coded results, never free-text PII.
  let willDraftReferral = false;
  try {
    willDraftReferral =
      isAllowlistedSdohScreener(screener) &&
      screenSocialNeeds(screening).positiveDomains.length > 0;
  } catch {
    willDraftReferral = false;
  }

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      usesValidatedSdohScreener: usesValidatedSdohScreener(screener),
      sdohReferralHasConsent: willDraftReferral
        ? sdohReferralHasConsent({ patientConsent })
        : true,
      containsFreeTextPii: false
    }
  });

  if (governance.decision === "block") {
    return NextResponse.json(
      {
        blocked: true,
        decision: "block",
        violations: governance.blockingViolations.map((v) => ({
          policyId: v.policyId,
          reason: v.reason
        })),
        _note:
          "Pause Agent Fabric blocked this screening (e.g. unvalidated screener, or a positive screen with no referral consent). Synthetic; see the A2A agent at /api/agents/sdoh-screening."
      },
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  // screenSocialNeeds throws on an unvalidated screener or a malformed response
  // vector (wrong item count); surface that as a 400 rather than a 500.
  let result;
  try {
    result = screenSocialNeeds(screening);
  } catch (e) {
    return NextResponse.json(
      {
        error: "invalid-screening-input",
        detail: e instanceof Error ? e.message : String(e),
        _note:
          "Provide one comma-separated integer vector per AHC-HRSN domain with the correct item count (housing 2, food 2, transportation 1, utilities 1, safety 4)."
      },
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  return NextResponse.json(
    {
      screener: result.screener,
      screenerName: result.screenerName,
      positiveDomains: result.positiveDomains,
      positiveDomainCount: result.positiveDomainCount,
      redFlags: result.redFlags,
      interpretation: result.interpretation,
      domains: result.domains.map((d) => ({
        id: d.id,
        label: d.label,
        positive: d.positive,
        detail: d.detail
      })),
      synthetic: true,
      _note:
        "Deterministic CMS AHC-HRSN social-needs screen — advisory, not a diagnosis. A positive interpersonal-safety (redFlags) result is a mandatory escalation to a human social worker. Agentforce alias for the A2A sdoh-screening agent."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
