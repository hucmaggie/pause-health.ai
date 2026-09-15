# Formulary & Drug Utilization Review Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `formulary-review-agent`
- **Artifact:** `pause-agent-formulary-review-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** payer-operations
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.formulary.catalog-sourced, policy.formulary.step-therapy-honored, policy.formulary.no-autonomous-override

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
