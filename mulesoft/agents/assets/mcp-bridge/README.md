# Pause MCP Bridge · A2A ↔ MCP egress

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`).

- **Fabric agent id:** `mcp-bridge`
- **Artifact:** `pause-agent-mcp-bridge` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** mcp-bridge / MCP
- **Governance tier:** integration
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (4):** policy.audit.hipaa-log-every-turn, policy.mcp-bridge.remote-allowlist, policy.mcp-bridge.tool-allowlist, policy.mcp-bridge.no-cross-origin-bearer

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
