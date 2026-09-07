import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Information Blocking (21st Century Cures Act / 45 CFR Part 171) agent —
 * a control-plane / data-substrate compliance service on the platform plane.
 *
 *   GET /api/agents/information-blocking/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "information-blocking-agent";

const CARD: A2AAgentCard = {
  name: "Information Blocking (Cures Act / 45 CFR Part 171) Agent",
  description:
    "A control-plane / data-substrate compliance service on the platform plane — a DETERMINISTIC (no-Claude) agent that adjudicates whether an actor's PRACTICE that interfered with the access, exchange, or use of electronic health information (EHI) is INFORMATION BLOCKING under the 21st Century Cures Act / 45 CFR Part 171, or fits one of the eight recorded regulatory EXCEPTIONS. It is the ENFORCEMENT FLIP-SIDE of the HIPAA patient-rights trilogy (Right of Access §164.524, Amendment §164.526, Accounting of Disclosures §164.528 — the RIGHT to get / fix / audit your record): the information-blocking rule prohibits a provider, health-IT developer, or HIE/HIN from INTERFERING with EHI access. UNLIKE the recent agents there is NO date math and NO dollar waterfall — the heart is a CONDITIONS-SATISFACTION classifier. Given a practice review (an actor reference + type, the EHI request type, a short practice description, whether the practice actually interfered with access / exchange / use, an optional claimed exception, and the set of exception CONDITIONS the actor asserts are satisfied), it DETERMINISTICALLY checks the claimed exception against the recorded catalog (preventing harm §171.201, privacy §171.202, security §171.203, infeasibility §171.204, health IT performance §171.205, content & manner §171.301, fees §171.302, licensing §171.303) and verifies that EVERY required condition of that exception is satisfied, then decides the disposition (not-information-blocking-no-interference / not-information-blocking-exception-met / potential-information-blocking-needs-review). The determination is a pure function of the request's own fields (no randomness, no clock), so the same practice review always yields the same exception analysis + disposition. Every claimed exception traces to a recorded catalog entry (an off-catalog exception is blocked), an exception is reported MET only when every required condition is satisfied (an overstated exception that skipped a condition is blocked — the load-bearing correctness gate), and EHI is never autonomously withheld (which could itself be information blocking) or force-released (which could breach privacy) — an autonomous block / release is blocked. It COMPLEMENTS — it does not duplicate — the HIPAA privacy agents: they grant a patient's RIGHTS to their record (get / fix / audit); this enforces that an actor does not INTERFERE with EHI access, exchange, or use. It is EHI-bearing (the review references a request for the patient's electronic health information), so it is on the HIPAA-audit policy. The exception catalog + condition sets are illustrative, clearly labeled — NOT certified information-blocking compliance counsel; real analysis is governed by the 21st Century Cures Act and 45 CFR Part 171 (the full text of the eight exceptions and every sub-condition), the ONC / ASTP rules, and OIG enforcement (§171 penalties / disincentives). Enforces, via the Pause Agent Fabric, that every claimed exception is sourced, no exception is overstated, and EHI is never autonomously withheld or released.",
  url: `${HOST}/api/agents/information-blocking`,
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
      id: "adjudicate-information-blocking",
      name: "Adjudicate whether a practice is information blocking or fits a 45 CFR Part 171 exception",
      description:
        "Given a practice review, deterministically checks the claimed exception against the recorded 45 CFR Part 171 catalog and verifies every required condition is satisfied, then decides the disposition (not-information-blocking-no-interference / not-information-blocking-exception-met / potential-information-blocking-needs-review). Every claimed exception is sourced; no exception is overstated; EHI is never autonomously withheld or released.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "information-blocking",
        "cures-act",
        "45-cfr-part-171",
        "onc",
        "ehi",
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
