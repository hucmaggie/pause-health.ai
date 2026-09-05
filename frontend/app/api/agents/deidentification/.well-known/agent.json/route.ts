import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the De-Identification & Safe Harbor agent — the data-substrate
 * service that screens a dataset's fields against the eighteen HIPAA Safe Harbor identifier
 * categories and decides whether the dataset qualifies as de-identified.
 *
 *   GET /api/agents/deidentification/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "deidentification-agent";

const CARD: A2AAgentCard = {
  name: "De-Identification & Safe Harbor Agent",
  description:
    "The de-identification layer of the Pause platform & data substrate — a DETERMINISTIC (no-Claude) control-plane service. Given a dataset described by its FIELDS (each a name, the Safe Harbor identifier category it maps to — or non-identifier — and the action taken: removed / generalized / retained), the chosen de-identification METHOD (safe-harbor or expert-determination), the categories attested absent, and (for expert determination) the cited determination reference, it DETERMINISTICALLY screens the dataset against the eighteen HIPAA Safe Harbor identifier categories (45 CFR 164.514(b)(2)(i)(A)–(R)), computes which categories remain identifiable after the field actions (a retained identifier, or a generalization that does not satisfy Safe Harbor — only geographic → first three ZIP digits and dates → year only qualify), computes whether all eighteen categories were screened (present as a field or attested absent), validates the method citation, and decides whether the dataset qualifies as de-identified: de-identified iff a recognized method is cited, all eighteen categories were screened, and no identifier category remains. The determination is a pure function of the dataset's fields + the category catalog (no randomness, no clock), so the same dataset always yields the same de-identification decision + remaining categories + release flag. Every determination must screen all eighteen Safe Harbor categories (an incomplete screen may hide a re-identifying identifier), must cite a recognized method (Safe Harbor or a qualified Expert Determination with a cited reference), and a re-identifiable dataset (one with a remaining identifier) is NEVER released as de-identified — it is a completed determination requiring human review under a data use agreement. It COMPLEMENTS — it does not duplicate — the other platform agents: the Consent & Preferences Management agent (consent scopes), the Master Patient Index (identity/dedup), the Break-the-Glass agent (emergency PHI access), the Data Retention agent (records disposition), and the Data-Sharing / TEFCA agent (interoperability exchange). It is a control-plane / data-substrate service, PHI-bearing (on the HIPAA audit policy). The Safe Harbor category catalog + generalization rules are illustrative/synthetic, clearly labeled — NOT a certified de-identification engine; a real determination applies the full Safe Harbor method (including the actual-knowledge clause) or a qualified statistician's Expert Determination under 45 CFR 164.514(b). Enforces, via the Pause Agent Fabric, that every determination screens all eighteen categories, cites a recognized method, and never releases a re-identifiable dataset as de-identified.",
  url: `${HOST}/api/agents/deidentification`,
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
      id: "evaluate-deidentification",
      name: "Screen a dataset against the eighteen Safe Harbor categories and decide de-identification",
      description:
        "Given a dataset's fields (each mapped to a Safe Harbor category and an action), the method, the categories attested absent, and any expert-determination reference, deterministically screens the dataset against the eighteen Safe Harbor identifier categories, computes which categories remain identifiable, and decides whether the dataset is de-identified. Every determination screens all eighteen categories, cites a recognized method, and never releases a re-identifiable dataset as de-identified.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "de-identification",
        "safe-harbor",
        "expert-determination",
        "hipaa",
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
