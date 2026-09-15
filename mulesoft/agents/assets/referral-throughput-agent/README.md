# Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp) Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `referral-throughput-agent`
- **Artifact:** `pause-agent-referral-throughput-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** care-coordination
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.referralflow.flow-sourced, policy.referralflow.throughput-optimal, policy.referralflow.no-autonomous-route

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
