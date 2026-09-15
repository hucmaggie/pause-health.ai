# Provider Contracting & VBC Terms Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `provider-contracting-agent`
- **Artifact:** `pause-agent-provider-contracting-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** commercial-operations
- **Posture:** non-PHI
- **Policies enforced (4):** policy.commercial.no-phi-in-commercial-plane, policy.contracting.contract-type-catalog-sourced, policy.contracting.no-autonomous-term-change, policy.contracting.benchmark-methodology-catalog-sourced

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
