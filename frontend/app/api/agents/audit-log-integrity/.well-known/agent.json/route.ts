import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Audit Log Integrity (Tamper-Evidence) agent — the data-substrate
 * service that verifies an audit trail is tamper-evident by recomputing its hash chain and
 * checking its sequence for gaps.
 *
 *   GET /api/agents/audit-log-integrity/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "audit-log-integrity-agent";

const CARD: A2AAgentCard = {
  name: "Audit Log Integrity (Tamper-Evidence) Agent",
  description:
    "The tamper-evidence layer of the Pause platform & data substrate — a DETERMINISTIC (no-Claude) control-plane service. Every agent on the fabric writes a HIPAA audit span; THIS agent verifies the audit trail itself. Given an audit log (an ordered list of entries, each with a sequence number, actor, action, target, timestamp, the prior entry's hash, and its own hash), it DETERMINISTICALLY recomputes each entry's hash and the chain links, checks the sequence numbers for gaps, and decides whether the log is verified (hash chain intact AND sequence complete). Verification is a pure function of the log's entries (no randomness, no clock), so the same log always yields the same verified / hash-chain / sequence result. A log may be marked verified only if its hash chain is intact (a single broken link is tampering) and only if its sequence is complete (a gap means a deleted entry — the load-bearing completeness gate), and the agent VERIFIES and FLAGS — it NEVER deletes, rewrites, or repairs an audit entry (that would destroy evidence); a broken log is flagged for human forensic review. It COMPLEMENTS — it does not duplicate — the other platform agents: distinct from the Consent & Preferences Management agent (whether a patient may be contacted / data used), the De-Identification & Safe Harbor agent (whether a dataset is no longer PHI), the Minimum Necessary agent (how much PHI a purpose may see), the Master Patient Index (identity / dedup), the Break-the-Glass agent (emergency PHI access), and the Data Retention agent (records disposition). It is a control-plane / data-substrate service, PHI-bearing (on the HIPAA audit policy — audit entries reference patient targets). The hash is an illustrative NON-cryptographic FNV-1a, clearly labeled — NOT a certified tamper-evidence system; a real control uses a cryptographic hash (SHA-256), append-only / WORM storage, and signed checkpoints. Enforces, via the Pause Agent Fabric, that a log is never marked verified over a broken chain, never marked verified with a sequence gap, and never autonomously redacted / repaired.",
  url: `${HOST}/api/agents/audit-log-integrity`,
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
      id: "verify-audit-log-integrity",
      name: "Verify an audit trail is tamper-evident",
      description:
        "Given an audit log (ordered entries with a sequence number, content, prevHash, and hash), deterministically recomputes the hash chain and checks the sequence for gaps, deciding whether the log is verified (hash chain intact AND sequence complete). A verified label is never asserted over a broken chain or a sequence gap; a broken log is flagged for human forensic review and never repaired.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "audit-log",
        "tamper-evidence",
        "hash-chain",
        "integrity",
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
