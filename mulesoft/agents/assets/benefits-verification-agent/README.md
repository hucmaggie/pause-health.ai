# Agentforce Benefits & Coverage Verification · Eligibility (EBV)

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `benefits-verification-agent`
- **Artifact:** `pause-agent-benefits-verification-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** benefits-verification
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (3):** policy.audit.hipaa-log-every-turn, policy.benefits.eligibility-source-integrity, policy.data360.consent-required-before-grounding

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
