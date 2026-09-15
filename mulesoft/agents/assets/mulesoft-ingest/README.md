# MuleSoft Process API · pause-ingest-process-api

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`),
published via the Exchange Experience API (`type=agent`).

- **Fabric agent id:** `mulesoft-ingest`
- **Asset:** `pause-agent-mulesoft-ingest` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** mulesoft-process / REST
- **Governance tier:** integration
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (5):** policy.audit.hipaa-log-every-turn, policy.phi.bearer-token-required-in-prod, policy.audit.return-mulesoft-correlation-id, policy.network.mtls-required, policy.data.fhir-r5-only

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
