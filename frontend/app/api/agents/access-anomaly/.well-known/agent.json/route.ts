import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Access Anomaly Detection agent — a control-plane / data-substrate
 * service on the platform & data substrate plane.
 *
 *   GET /api/agents/access-anomaly/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "access-anomaly-agent";

const CARD: A2AAgentCard = {
  name: "Access Anomaly Detection Agent",
  description:
    "A control-plane / data-substrate service on the platform & data substrate plane — a DETERMINISTIC (no-Claude) agent that implements the HIPAA Security Rule's information-system-activity-review safeguard (§164.308(a)(1)(ii)(D)): given an actor's PHI-access events (each a timestamped read of a patient record) plus a window length and a threshold, it counts the accesses within a rolling time window, finds the peak number in any window of that length, and flags an anomalous access volume when the peak exceeds the threshold (a possible snooping / breach pattern). UNLIKE the Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is SLIDING-WINDOW COUNTING over timestamped events (a two-pointer scan for the peak count in any fixed-length window). Time is data: the analysis is a pure function of the events + window + threshold (no real clock), so the same events always yield the same peak + finding, and the detection is WINDOWED (a high daily total spread into small bursts is NOT flagged), not a naive total count. Every event in the peak window traces to a submitted access event (a fabricated / phantom peak is blocked), the window count is exact (recomputing the peak reproduces the count, the window fits the configured length, and the anomaly flag equals whether the peak exceeds the threshold — the load-bearing correctness gate), and no access action is ever taken (an autonomous lock / revoke is blocked). It COMPLEMENTS — it does not duplicate — the other platform agents: distinct from the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident), the Break-the-Glass agent (whether a single emergency access is authorized), the Minimum Necessary agent (how much PHI a purpose may see), the Accounting of Disclosures agent (WHO a patient's PHI was disclosed to), and the Consent agent (whether a patient may be contacted / data used) — this detects an unusual VOLUME of accesses by one actor over time. It is PHI-bearing (the events reference the patients whose records were accessed), so it is on the HIPAA-audit policy. The events + window + threshold are illustrative, clearly labeled — NOT a certified breach-detection / SIEM system; real activity review uses the full audit trail, user-behavior analytics, role / relationship context, and the privacy officer's judgment. Enforces, via the Pause Agent Fabric, that every counted access is sourced, the window count is exact, and no access action is taken autonomously.",
  url: `${HOST}/api/agents/access-anomaly`,
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
      id: "detect-access-anomaly",
      name: "Count an actor's accesses in a rolling window and flag an anomalous volume",
      description:
        "Given an actor's PHI-access events plus a window length and a threshold, deterministically counts the accesses within a rolling time window, finds the peak number in any window of that length, and flags an anomalous access volume when the peak exceeds the threshold. Every counted access is sourced; the window count is exact; no access action is taken autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "access-anomaly",
        "activity-review",
        "hipaa-security",
        "sliding-window",
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
