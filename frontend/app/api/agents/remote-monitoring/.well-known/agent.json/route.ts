import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Remote Patient Monitoring & Symptom-Trend
 * Tracking agent — the Salesforce "Agentforce for Health" / Health Cloud
 * remote-patient-monitoring analog.
 *
 *   GET /api/agents/remote-monitoring/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "remote-monitoring-agent";

const CARD: A2AAgentCard = {
  name: "Remote Patient Monitoring & Symptom-Trend Tracking Agent",
  description:
    "Ingests longitudinal (time-series) menopause/midlife symptom + vital readings — self-reported or from wearables/devices (hot-flash frequency, sleep duration, mood score, resting heart rate, weight) — DETERMINISTICALLY detects each metric's trend over the reading window (improving / stable / worsening) by comparing a recent window against a baseline window, applies (synthetic) red-flag thresholds, and ROUTES worsening / red-flag trends to a human clinician for review — the Salesforce 'Agentforce for Health' / Health Cloud remote-patient-monitoring analog. Trend detection is a pure function of the readings' own timestamps + values (no randomness, no clock), so the same input series always yields the same trends + escalations. The monitored metrics + thresholds are illustrative/synthetic, clearly labeled — NOT a certified remote-monitoring device. Enforces, via the Pause Agent Fabric, that every reading traces to a device/self-report source + a defined metric, that every escalation is routed to a human clinician (never an autonomous clinical action), and that longitudinal monitoring is consent-gated.",
  url: `${HOST}/api/agents/remote-monitoring`,
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
      id: "detect-symptom-trends",
      name: "Detect symptom/vital trends + route escalations to a clinician",
      description:
        "Given a longitudinal reading set (each reading citing a monitored-metric catalog id, an explicit timestamp, a value, and a device/self-report source), returns the deterministically-detected per-metric trends (improving / stable / worsening) with (synthetic) red-flag thresholds, plus worsening / red-flag escalations each routed to a human clinician for review — never an autonomous clinical action — each citing the metric + rule that triggered it.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["remote-monitoring", "rpm", "symptom-tracking", "trend-detection", "menopause", "wearable"]
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
