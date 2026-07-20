import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Quality-Measure Attribution agent — pairs
 * with the HEDIS & Quality Reporting agent to decide WHOSE PANEL each
 * patient counts on for value-based-care rate calculations.
 *
 *   GET /api/agents/quality-attribution/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "quality-attribution-agent";

const CARD: A2AAgentCard = {
  name: "Quality-Measure Attribution Agent",
  description:
    "Pairs with the HEDIS & Quality Reporting Agent to decide WHOSE PANEL each patient counts on for value-based-care rate calculations. Deterministically attributes each patient to a provider / clinic / VBC contract under a defined methodology from the ATTRIBUTION_METHODOLOGIES catalog (plurality-of-visits, PCP-of-record, prospective Medicare Advantage, contract-defined window), honors the VBC contract's exclusion terms (age band, network status, exclusion codes) — an attribution against explicit exclusions is blocked — and applies a documented tie-break chain (most-recent-visit-wins then provider-ref-lexical-ascending) when the primary metric ties. Rolls up per-provider counts (attributed, excluded-by-contract, tie-broken) so downstream HEDIS scoring lands on the correct denominator. Attribution is a pure function of the visit history + contract terms + caller-provided asOfDate (no randomness, no clock), so the same context always yields the same attribution + rollup. Distinct from the HEDIS Quality agent (which computes the rates), the Care Team agent (multi-disciplinary team assembly around a patient), and the Provider Credentialing agent (network integrity) — this one is quality ACCOUNTABILITY. The methodology catalog, contract catalog, tie-break rules, and refs are illustrative/synthetic, clearly labeled — NOT CMS Shared Savings Program attribution, an ACO REACH prospective assignment, an NCQA HEDIS attribution appendix, or a real payer's VBC contract terms. Enforces, via the Pause Agent Fabric, that every attribution's methodology + contract trace to the defined catalogs (no bespoke rules), that every attribution honors the contract's exclusion terms (no polluting a contract's scorecard), and that every tie-break is documented and deterministic (no gameable coin-flip).",
  url: `${HOST}/api/agents/quality-attribution`,
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
      id: "attribute-panel-to-providers",
      name: "Attribute a panel of patients to providers / clinics / VBC contracts",
      description:
        "Given a panel of patients (each with a synthetic patientRef, demographic + network flags, a visit history accepted as data, a methodology catalog id, a VBC contract catalog id, and an asOfDate), returns per-patient attributions with the winning provider / clinic, an excludedByContract flag when the contract terms exclude the patient, a documented tie-break trail when the primary metric tied, and a per-provider rollup of attributed / excluded / tie-broken counts.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["attribution", "quality-measure", "hedis", "value-based-care", "menopause"]
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
