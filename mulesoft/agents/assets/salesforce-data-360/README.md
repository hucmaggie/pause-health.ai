# Salesforce Data 360 · Unified Patient Grounding

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `salesforce-data-360`
- **Artifact:** `pause-agent-salesforce-data-360` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** salesforce-data-360 / REST
- **Governance tier:** data-grounding
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.data360.zero-copy-federation, policy.data360.consent-required-before-grounding, policy.data360.segment-activation-allowlist

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
