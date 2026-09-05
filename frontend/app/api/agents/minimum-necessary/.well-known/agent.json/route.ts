import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Minimum Necessary (HIPAA) agent — the data-substrate service
 * that decides whether a PHI disclosure is limited to the minimum necessary for its stated
 * purpose-of-use + requestor role.
 *
 *   GET /api/agents/minimum-necessary/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "minimum-necessary-agent";

const CARD: A2AAgentCard = {
  name: "Minimum Necessary (HIPAA) Agent",
  description:
    "The minimum-necessary layer of the Pause platform & data substrate — a DETERMINISTIC (no-Claude) control-plane service. Given a disclosure request (a requestor role, a purpose-of-use, the specific fields requested — each mapped to a field CATEGORY — and the record scope: single-patient / cohort / bulk), it DETERMINISTICALLY resolves the governing purpose-of-use rule (treatment, payment, healthcare-operations, research, marketing) and decides per field whether it is within the minimum-necessary scope for that purpose (release) or beyond it (withhold), yielding a disclosure limited to the minimum necessary (45 CFR 164.502(b) / 164.514(d)). Treatment / disclosure-to-the-individual / authorized / required-by-law purposes are EXEMPT from the standard. The determination is a pure function of the request + the purpose catalog (no randomness, no clock), so the same request always yields the same field decisions + released/withheld sets + flags. Every disclosure decision must cite a recorded purpose-of-use (no ad-hoc disclosure), every RELEASED field must be within the purpose's permitted categories (releasing an out-of-scope field over-discloses PHI — the load-bearing privacy gate), and an over-scope (narrowed) or bulk / cohort disclosure is a RECOMMENDATION requiring human review — never autonomously released. It COMPLEMENTS — it does not duplicate — the other platform agents: distinct from the Consent & Preferences Management agent (whether a patient may be contacted / data used for a scope), the De-Identification & Safe Harbor agent (whether a dataset is no longer PHI), the Master Patient Index (identity / dedup), the Break-the-Glass agent (emergency PHI access), and the Data Retention agent (records disposition). It is a control-plane / data-substrate service, PHI-bearing (on the HIPAA audit policy). The purpose-of-use catalog, requestor roles, field categories, and allowed-category mappings are illustrative/synthetic, clearly labeled — NOT a certified minimum-necessary engine; a real determination uses the covered entity's role-based access policies and its minimum-necessary standard under 45 CFR 164.502(b) / 164.514(d). Enforces, via the Pause Agent Fabric, that every disclosure cites a recorded purpose-of-use, that a released field is never beyond the minimum-necessary scope, and that an over-scope / bulk disclosure requires human review.",
  url: `${HOST}/api/agents/minimum-necessary`,
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
      id: "evaluate-minimum-necessary",
      name: "Scope a PHI disclosure to the minimum necessary",
      description:
        "Given a disclosure request (requestor role, purpose-of-use, requested fields by category, record scope), deterministically resolves the governing purpose-of-use rule and decides per field release vs. withhold, yielding a disclosure limited to the minimum necessary. Every decision cites a recorded purpose-of-use; every released field is within scope; an over-scope / bulk disclosure requires human review.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "minimum-necessary",
        "hipaa",
        "privacy",
        "purpose-of-use",
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
