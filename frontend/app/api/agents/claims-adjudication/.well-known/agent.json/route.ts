import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Claims Adjudication Assistant — the
 * first-pass payer-side adjudicator, paired with the Prior Auth (pre-
 * service), Member Service (billing self-service), and Grievance & Appeals
 * (post-denial intake) agents.
 *
 *   GET /api/agents/claims-adjudication/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "claims-adjudication-agent";

const CARD: A2AAgentCard = {
  name: "Claims Adjudication Assistant Agent",
  description:
    "Runs the FIRST-PASS payer-side claims-adjudication pipeline for a health-plan / TPA. Deterministically applies payer-specific claim edits (NCCI-PTP unbundling, LCD/NCD coverage, benefit-limit exhaustion, prior-auth missing, duplicate submission, out-of-network, timely-filing) against the defined edit catalog, classifies each claim as clean-pay / pend-clinical-review / pend-adjudicator-review / deny-drafted with a specific catalog reason code, and routes anything non-clean to a human. It NEVER autonomously finalizes a denial — every denial is DRAFTED for adjudicator cosign (denial letters are legally consequential under CMS / ERISA / state insurance code and must have a human sign-off). Every non-clean-pay decision cites a specific catalog reason code (illustrative CO-97 unbundling / CO-50 LCD / CO-96 NCD / CO-119 benefit max / CO-197 no prior auth / CO-18 duplicate / CO-242 out-of-network / CO-29 timely filing) so the member notice satisfies Section 1557 / state insurance code / CMS. It is a DETERMINISTIC (no-Claude) agent: adjudication is a pure function of the claim + member benefits + edit catalog + caller-provided asOfDate (no randomness, no clock), so the same context always yields the same decision + applied edits + reason code with a documented decision precedence (deny > pend-clinical > pend-adjudicator > clean-pay) and stable edit-id ordering. It is distinct from the Prior Authorization agent (pre-service utilization management), the Member Service / Billing agent (member-facing self-service), the Grievance & Appeals agent (post-denial intake), and the FWA / SIU workflow (pattern-based fraud detection) — this one is the first-pass payer-side adjudicator that decides which claims are clean-pay and which need human review. The edit catalog, reason-code catalog, and benefit-rule shape are illustrative/synthetic, clearly labeled — NOT CMS X12 837 claim spec, an NCCI PTP edit table, an LCD/NCD medical-necessity registry, or a real payer's benefit configuration. Enforces, via the Pause Agent Fabric, that every applied edit traces to the catalog (no fabricated 'you owe us more' edits), that every denial requires adjudicator cosign (no autonomous denial letters), and that every non-clean-pay decision cites a specific catalog reason code (no reasonless denials — a Section 1557 / state code requirement).",
  url: `${HOST}/api/agents/claims-adjudication`,
  provider: {
    organization: "Salesforce Agentforce (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "adjudicate-claim-first-pass",
      name: "First-pass claim adjudication: apply catalog edits + classify + route + cite reason codes",
      description:
        "Given a submitted claim (a synthetic claimRef + memberRef, ISO asOfDate + date-of-service, claim lines, and the member's benefit-side context — in-network, prior-auth-on-file, benefit-limit, duplicate fingerprints, timely-filing days, LCD/NCD flags, and NCCI-PTP pairs), returns a deterministic decision — clean-pay / pend-clinical-review / pend-adjudicator-review / deny-drafted — with the sorted applied edits, the primary reason code, the routing target, and the denial-cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["claims", "adjudication", "payer", "hedis", "menopause"]
    }
  ],
  pauseGovernance: {
    fabricRegisteredAs: FABRIC_AGENT_ID,
    policies: getPoliciesForAgent(FABRIC_AGENT_ID).map((p) => p.id)
  }
};

export async function GET() {
  return NextResponse.json(CARD, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
    }
  });
}
