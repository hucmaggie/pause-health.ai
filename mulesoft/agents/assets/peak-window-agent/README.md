# Commercial Peak-Window / Maximum Contiguous Net-Gain Detection Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `peak-window-agent`
- **Artifact:** `pause-agent-peak-window-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** commercial-operations
- **Posture:** non-PHI
- **Policies enforced (3):** policy.peak-window.window-sourced, policy.peak-window.window-optimal, policy.peak-window.no-autonomous-action

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
