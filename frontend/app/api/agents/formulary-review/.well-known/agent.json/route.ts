import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Formulary & Drug Utilization Review Agent
 * — the deterministic first-pass formulary + DUR pipeline, paired with
 * Prior Auth (broader UM), Medication Adherence (nudge-only refill), and
 * Claims Adjudication (post-service).
 *
 *   GET /api/agents/formulary-review/.well-known/agent.json
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "formulary-review-agent";

const CARD: A2AAgentCard = {
  name: "Formulary & Drug Utilization Review Agent",
  description:
    "Runs the FIRST-PASS payer-side formulary + drug-utilization-review pipeline. For a proposed medication, deterministically looks up the payer's formulary tier, verifies step-therapy sequencing against DOCUMENTED prior-therapy history, applies quantity limits, and screens for drug-drug interactions — classifying each request as preferred-approved / pend-step-therapy / pend-quantity-limit / pend-interaction-review / pend-non-formulary, and routing pends to a clinician (or pharmacist for interactions). It NEVER autonomously overrides a formulary exception — every non-preferred decision is DRAFTED for clinician cosign because formulary exceptions are legally consequential under Medicare Advantage Chapter 6 + Part D (a documented rationale from a prescriber is required). Every proposed drug, applied rule, and reason code must trace to the defined catalogs — no fabricated 'we-just-said-no' rules, no phantom drugs. Menopause-relevant because HRT tier placement varies significantly by plan (transdermal estradiol is often Tier 2 or non-formulary despite being clinically preferred for CVD-risk profiles). Companion to Prior Auth (broader utilization management), Medication Adherence (nudge-only refill), and Claims Adjudication (post-service). The drug catalog, rule catalog, reason-code catalog, step-therapy chains, and interaction pairs are illustrative/synthetic, clearly labeled — NOT Medi-Span, First Databank, RxNorm, an actual payer's formulary file, or a certified DUR engine. Enforces, via the Pause Agent Fabric, that every drug + rule + reason code traces to the catalog (no fabricated formulary rules), that step therapy is honored with a documented prior-therapy trial (no approvals on claimed-but-undocumented history), and that every non-preferred decision requires clinician cosign (no autonomous overrides).",
  url: `${HOST}/api/agents/formulary-review`,
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
      id: "review-formulary-request",
      name: "First-pass formulary + DUR review: tier + step-therapy + quantity + interactions",
      description:
        "Given a proposed medication request (a synthetic requestRef + memberRef, an ISO asOfDate, the drug catalog id, requested quantity, the member's current medications + prior-therapy history), returns a deterministic decision — preferred-approved / pend-step-therapy / pend-quantity-limit / pend-interaction-review / pend-non-formulary — with the applied catalog rules, the primary reason code, the routing target (clinician / pharmacist), and the clinician-cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["formulary", "dur", "prior-auth-companion", "hrt", "menopause"]
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
