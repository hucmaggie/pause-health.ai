# Information Blocking (Cures Act / 45 CFR Part 171) Agent

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `information-blocking-agent`
- **Artifact:** `pause-agent-information-blocking-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** mulesoft-process / A2A
- **Governance tier:** data-plane
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.information-blocking.exception-sourced, policy.information-blocking.determination-not-overstated, policy.information-blocking.no-autonomous-block-or-release

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
