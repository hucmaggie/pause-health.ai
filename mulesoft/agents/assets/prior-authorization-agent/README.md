# Agentforce Prior Authorization · CareRequest + Utilization Management (Health Cloud)

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`),
published via the Exchange Experience API (`type=agent`).

- **Fabric agent id:** `prior-authorization-agent`
- **Asset:** `pause-agent-prior-authorization-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** clinical-decision
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (5):** policy.audit.hipaa-log-every-turn, policy.clinical.no-prescribing, policy.pa.no-autonomous-submission, policy.pa.documentation-integrity, policy.data360.consent-required-before-grounding

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
