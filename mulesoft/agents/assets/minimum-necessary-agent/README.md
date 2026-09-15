# Minimum Necessary (HIPAA) Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `minimum-necessary-agent`
- **Artifact:** `pause-agent-minimum-necessary-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** mulesoft-process / A2A
- **Governance tier:** data-plane
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.minnec.purpose-of-use-sourced, policy.minnec.minimum-necessary-scoped, policy.minnec.no-autonomous-over-disclosure

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
