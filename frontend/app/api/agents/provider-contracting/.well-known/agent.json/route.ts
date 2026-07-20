import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "provider-contracting-agent";

const CARD: A2AAgentCard = {
  name: "Provider Contracting & VBC Terms Agent",
  description:
    "Deterministic provider-contracting pipeline: for each provider-network contract, classifies the payment model (fee-for-service, capitation, shared-savings, bundled-payment, MA-value-based, commercial-VBC), computes the VBC quality-gate + spend-benchmark drift for a caller-provided reporting period against a catalog methodology, and classifies as in-good-standing / benchmark-drift-review / draft-term-change / blocked-non-catalog-contract. Non-good-standing cases route to the account manager for drift review; term-change proposals route to the account owner for cosign. Runs on the commercial plane — never accesses PHI, sits alongside the Pipeline Management and Account Management agents. It NEVER autonomously commits a contract-term change; every draft is DRAFTED for a human account owner. Every classified contract traces to the CONTRACT_TYPES + BENCHMARK_METHODOLOGIES catalog. The contract-type catalog, methodology catalog, rules, and reason codes are illustrative/synthetic, NOT Salesforce Health Cloud Provider Network Management, Optum Contract Manager, or a real payer's contract-lifecycle system.",
  url: `${HOST}/api/agents/provider-contracting`,
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
      id: "evaluate-provider-contract",
      name: "Evaluate a provider-network contract against catalog terms and reporting-period benchmarks",
      description:
        "Given a contract request (providerRef, contractRef, contractTypeId, methodologyId, reporting-period start/end, qualityMeasuresMetFraction, benchmark/actual spend cents, optional term-change flag), returns a deterministic decision — in-good-standing / benchmark-drift-review / draft-term-change / blocked-non-catalog-contract — with applied catalog rules, quality-gate + spend-drift analysis, primary reason code, routing target, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["provider-contracting", "value-based-care", "commercial-plane"]
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
