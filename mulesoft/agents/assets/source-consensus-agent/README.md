# Source-of-Truth Consensus / Golden-Record Field Reconciliation Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `source-consensus-agent`
- **Artifact:** `pause-agent-source-consensus-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** mulesoft-process / A2A
- **Governance tier:** data-plane
- **Posture:** non-PHI
- **Policies enforced (3):** policy.consensus.votes-sourced, policy.consensus.consensus-consistent, policy.consensus.no-autonomous-write

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
