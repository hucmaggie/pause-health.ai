import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Amendment / Correction (HIPAA §164.526) agent — a control-plane /
 * data-substrate privacy service on the platform plane.
 *
 *   GET /api/agents/amendment-request/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "amendment-request-agent";

const CARD: A2AAgentCard = {
  name: "Amendment / Correction (HIPAA §164.526) Agent",
  description:
    "A control-plane / data-substrate privacy service on the platform plane — a DETERMINISTIC (no-Claude) agent that adjudicates a patient's HIPAA §164.526 RIGHT to request an AMENDMENT / CORRECTION of their PHI, and BY WHEN. It CAPSTONES the HIPAA patient-rights trilogy — the third sibling to the Right of Access agent (§164.524 — the right to GET a copy of your record) and the Accounting of Disclosures agent (§164.528 — the right to know WHO your PHI was disclosed to); this answers the §164.526 right to FIX your record. Given an amendment request (a patient reference, the record and request type, the request date, an as-of date, whether the PHI is in a designated record set, whether the covered entity created the PHI and whether the originator is available, whether the PHI is available for access under §164.524, whether the PHI is already accurate and complete, and whether the single 30-day extension was invoked), it DETERMINISTICALLY computes the §164.526 response deadline (request date + 60 days, or + 90 when the extension is invoked, via pure UTC date math — dates taken as data, NO Date.now()), derives which denial ground (if any) applies against the recorded catalog (the covered entity did not create the PHI and the originator is available; the PHI is not part of the designated record set; the PHI is not available for access under §164.524; or the PHI is already accurate and complete), and decides the disposition (recommend-accept / recommend-deny). The determination is a pure function of the request's own fields (no randomness, no clock), so the same request always yields the same deadline + ground + disposition. Every denial traces to a recorded ground (an off-catalog ground is blocked), the deadline is computed not guessed (a mis-stated deadline is blocked — the load-bearing correctness gate), and the record is never autonomously amended (a data write to the medical record) or denied (a legal act carrying the patient's statement-of-disagreement rights) — an autonomous amend / deny is blocked. It COMPLEMENTS — it does not duplicate — the other platform / privacy agents: distinct from the Right of Access agent (§164.524 — GET a copy), the Accounting of Disclosures agent (§164.528 — WHO it was disclosed to), the Consent & Preferences agent (WHETHER a patient may be contacted / data used), the Minimum Necessary agent (HOW MUCH PHI a purpose may see), and the Data Retention agent (records disposition) — this answers the §164.526 right to request an AMENDMENT / CORRECTION of the record. It is PHI-bearing (the amendment decision references the patient's record), so it is on the HIPAA-audit policy. The denial-ground catalog + 60/90-day math are illustrative, clearly labeled — NOT a certified HIM system; real amendment is governed by HIPAA §164.526 (the full denial grounds, the written-denial + statement-of-disagreement + rebuttal process, and the duty to notify other holders of an accepted amendment) and the covered entity's Notice of Privacy Practices. Enforces, via the Pause Agent Fabric, that every denial is ground-sourced, the deadline is computed, and the record is never autonomously amended or denied.",
  url: `${HOST}/api/agents/amendment-request`,
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
      id: "adjudicate-amendment-request",
      name: "Adjudicate a §164.526 amendment request and compute its response deadline",
      description:
        "Given a patient's amendment request, deterministically computes the §164.526 response deadline (60 days, + 30 with the single extension), derives which statutory denial ground (if any) applies against the recorded catalog, and decides the disposition (recommend-accept / recommend-deny with statement-of-disagreement rights). Every denial is ground-sourced; the deadline is computed; the record is never autonomously amended or denied.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "amendment",
        "correction",
        "hipaa-164-526",
        "patient-rights",
        "data-substrate",
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
