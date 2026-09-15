# Agentforce Member Service · Billing & Coverage (Patient Service)

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `member-service-agent`
- **Artifact:** `pause-agent-member-service-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** patient-facing
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (3):** policy.phi.no-free-text-pii, policy.audit.hipaa-log-every-turn, policy.billing.claim-data-sourced

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
