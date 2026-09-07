import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Right of Access (HIPAA §164.524) agent — a control-plane /
 * data-substrate privacy service on the platform plane.
 *
 *   GET /api/agents/right-of-access/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "right-of-access-agent";

const CARD: A2AAgentCard = {
  name: "Right of Access (HIPAA §164.524) Agent",
  description:
    "A control-plane / data-substrate privacy service on the platform plane — a DETERMINISTIC (no-Claude) agent that adjudicates a patient's HIPAA §164.524 RIGHT to GET a copy of their own PHI, and BY WHEN. Given an access request (a patient reference, the request type, the request date, an as-of date, whether the requested PHI is in a designated record set, an optional cited denial-ground / exception, and whether the single 30-day extension was invoked), it DETERMINISTICALLY computes the §164.524 response deadline (request date + 30 days, or + 60 when the extension is invoked, via pure UTC date math — dates taken as data, no clock), classifies any cited exception against the recorded §164.524 grounds (unreviewable — psychotherapy notes, information compiled for a legal proceeding, a CLIA-exempt lab; reviewable — access reasonably likely to endanger, a reference to another person), and decides the disposition (grant-in-full / deny-unreviewable / deny-reviewable-needs-review / not-accessible-outside-record-set). The determination is a pure function of the request's own fields, so the same request always yields the same deadline / classification / disposition. Every cited denial ground traces to the recorded catalog (an off-catalog ground is blocked), the response deadline equals the request date + 30/60 days (a guessed / mis-stated deadline is blocked — the load-bearing correctness gate), and the record is never autonomously released or denied — every determination is a recommendation requiring a records / privacy officer to fulfill or review (an autonomous release / un-reviewed determination is blocked). It COMPLEMENTS — it does not duplicate — the other platform / privacy agents: distinct from the Accounting of Disclosures agent (WHO the PHI was disclosed to, §164.528), the Consent agent (whether a patient may be contacted / data used), the Minimum Necessary agent (how much PHI a purpose may see), the De-Identification agent (whether a dataset is still PHI), the Data Retention agent (records disposition), and the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident) — this answers the patient's §164.524 RIGHT to GET a copy of their own record. It is PHI-bearing (the access decision references the patient's record), so it is on the HIPAA-audit policy. The exception catalog + 30/60-day math are illustrative, clearly labeled — NOT a certified release-of-information system; real access is governed by HIPAA §164.524, the HITECH electronic-copy rules, and the covered entity's Notice of Privacy Practices. Enforces, via the Pause Agent Fabric, that every denial ground is cataloged, the deadline is computed, and the record is never autonomously released or denied.",
  url: `${HOST}/api/agents/right-of-access`,
  provider: {
    organization: "MuleSoft Anypoint (via Pause-Health.ai)",
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
      id: "adjudicate-right-of-access",
      name: "Adjudicate a patient's §164.524 right-of-access request",
      description:
        "Given an access request (a patient, the request type, the request date, an as-of date, whether the PHI is in a designated record set, an optional cited denial ground, and whether the single extension was invoked), deterministically computes the §164.524 response deadline (30 days, + 30 with the extension), classifies any cited denial ground against the recorded exception catalog, and decides the disposition. Every denial ground is cataloged; the deadline is computed; the record is never autonomously released or denied.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "right-of-access",
        "hipaa-164-524",
        "privacy",
        "release-of-information",
        "data-plane",
        "governance"
      ]
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
