import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Accounting of Disclosures (HIPAA §164.528) agent — the control-plane
 * / data-substrate privacy service that assembles a patient's accounting of who their PHI was
 * disclosed to, and for what non-TPO purpose, over the lookback window.
 *
 *   GET /api/agents/accounting-of-disclosures/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "accounting-of-disclosures-agent";

const CARD: A2AAgentCard = {
  name: "Accounting of Disclosures (HIPAA §164.528) Agent",
  description:
    "The accounting-of-disclosures layer of the Pause platform / data substrate — a DETERMINISTIC (no-Claude) privacy service that answers a patient's HIPAA §164.528 RIGHT to an accounting of who their PHI was disclosed to, and for what non-TPO purpose, over the prior years. Given an accounting request (a patient reference, an as-of date, a lookback window in years, and the patient's disclosure log — each disclosure a date, a recipient, and the cited purpose-of-disclosure), it DETERMINISTICALLY classifies each disclosure (in-accounting / excluded-TPO / excluded-authorized / out-of-window) against the §164.528 accountability rules (treatment / payment / operations and patient-authorized disclosures are EXCLUDED from the accounting; non-TPO disclosures — public-health mandates, law enforcement, judicial orders, research without authorization — ARE accountable), filters to the lookback window (as-of date − lookback years), and assembles the accounting. The classification is a pure function of the request's own fields (no randomness, no clock), so the same log always yields the same classification / accounting / counts. Every disclosure's purpose traces to a recorded catalog (an off-catalog purpose is blocked), every accountable in-window disclosure appears in the accounting (dropping one is blocked — the load-bearing completeness gate), and no logged disclosure is autonomously suppressed — the agent classifies and assembles, it never deletes or redacts a disclosure, and the accounting requires privacy-officer review (a suppressed / auto-released accounting is blocked). It COMPLEMENTS — it does not duplicate — the other platform / privacy agents: distinct from the Consent & Preferences Management agent (whether a patient may be contacted / data used), the Minimum Necessary agent (how much PHI a purpose may see), the De-Identification agent (whether a dataset is still PHI), the Data Retention agent (records disposition), and the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident) — this answers WHO the patient's PHI was disclosed to. It is PHI-bearing (on the HIPAA audit policy — disclosures reference patient care). The purpose catalog + accountability rules are illustrative, clearly labeled — NOT a certified accounting-of-disclosures system; a real accounting is governed by HIPAA §164.528 (the full exclusion set, the six-year window, and the electronic-health-record disclosure rules) and the covered entity's Notice of Privacy Practices. Enforces, via the Pause Agent Fabric, that every disclosure's purpose is catalog-sourced, every accountable disclosure appears in the accounting, and no disclosure is autonomously suppressed.",
  url: `${HOST}/api/agents/accounting-of-disclosures`,
  provider: {
    organization: "Salesforce (via Pause-Health.ai)",
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
      id: "assemble-accounting-of-disclosures",
      name: "Assemble a patient's §164.528 accounting of disclosures",
      description:
        "Given a patient's disclosure log (each disclosure a date, a recipient, and the cited purpose-of-disclosure), an as-of date, and a lookback window, deterministically classifies each disclosure against the §164.528 accountability rules, filters to the lookback window, and assembles the accounting of every accountable (non-TPO, non-authorized) disclosure. Every purpose is catalog-sourced; every accountable in-window disclosure appears in the accounting; no disclosure is autonomously suppressed and release requires privacy-officer review.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "accounting-of-disclosures",
        "hipaa",
        "164.528",
        "privacy",
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
