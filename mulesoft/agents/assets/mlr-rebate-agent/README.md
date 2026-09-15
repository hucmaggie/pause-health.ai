# Medical Loss Ratio (MLR) Rebate Calculation Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `mlr-rebate-agent`
- **Artifact:** `pause-agent-mlr-rebate-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** payer-operations
- **Posture:** non-PHI
- **Policies enforced (3):** policy.mlr.inputs-sourced, policy.mlr.allocation-consistent, policy.mlr.no-autonomous-disbursement

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
