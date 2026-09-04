import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Lab Result & Critical-Value Notification agent — the
 * clinical-decision service that classifies a discrete diagnostic lab result against a
 * reference-range + critical-threshold catalog and, for a critical (panic) value,
 * requires mandatory clinician notification.
 *
 *   GET /api/agents/lab-result/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "lab-result-agent";

const CARD: A2AAgentCard = {
  name: "Lab Result & Critical-Value Notification Agent",
  description:
    "The clinical result-management layer of the Pause patient & clinical plane — a DETERMINISTIC (no-Claude) clinical-decision service, a sibling to the live-Claude Care Router. Given a discrete diagnostic lab result (an analyte id + numeric value + unit, with the patient + ordering-provider references), it DETERMINISTICALLY classifies the value against the analyte's reference range + critical thresholds as normal / abnormal-high / abnormal-low / critical-high / critical-low, flags whether the result requires MANDATORY clinician notification (a critical / panic value) and whether it requires clinician review (any abnormal result). The classification is a pure function of the value + the analyte's catalog range (critical thresholds take precedence over the reference range; no randomness, no clock), so the same result always yields the same classification + notification + review flags. A CRITICAL value can NEVER be suppressed or auto-closed — CLIA §493.1291(g) requires the laboratory to immediately alert the responsible provider — and the agent NEVER autonomously acts on a result (no order, prescription, treatment, or care-plan change; a non-normal result is escalated for clinician review). It COMPLEMENTS — it does not duplicate — the other clinical / care agents: distinct from the Remote Patient Monitoring agent (continuous wearable / RPM streams), the Clinical Summary agent (chart summarization), and the Care Gap Closure agent (missing preventive measures) — this manages DISCRETE diagnostic LAB results + the critical-value notification workflow. It is a clinical-decision service (patient & clinical plane), PHI-bearing (on the HIPAA audit policy). The analyte catalog, reference ranges, units, and critical thresholds are illustrative/synthetic, clearly labeled — NOT a certified laboratory information system or a CLIA-validated critical-value policy; real ranges are method-/instrument-/population-specific and set by each laboratory's medical director under CLIA (42 CFR 493) + CAP accreditation. Enforces, via the Pause Agent Fabric, that a critical value is always notified (never suppressed), that every classification cites a recorded reference range, and that the agent never autonomously acts on a result (it is clinician-review-gated).",
  url: `${HOST}/api/agents/lab-result`,
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
      id: "classify-lab-result",
      name: "Classify a discrete lab result + flag critical-value notification",
      description:
        "Given a discrete diagnostic lab result (an analyte id + numeric value + unit), deterministically classifies the value against the analyte's reference range + critical thresholds as normal / abnormal-high / abnormal-low / critical-high / critical-low, flags whether the result requires mandatory clinician notification (a critical / panic value) and whether it requires clinician review (any abnormal result). A critical value is always notified (never suppressed); every classification cites a recorded reference range; the agent never autonomously acts on a result — a non-normal result is escalated for clinician review.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "lab-result",
        "critical-value",
        "reference-range",
        "clia",
        "clinical-decision",
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
