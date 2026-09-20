# Agentforce Appointment Scheduling · Book/Reschedule (MSCP)

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`),
published via the Exchange Experience API (`type=agent`).

- **Fabric agent id:** `appointment-scheduling-agent`
- **Asset:** `pause-agent-appointment-scheduling-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** agentforce / A2A
- **Governance tier:** care-coordination
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (3):** policy.audit.hipaa-log-every-turn, policy.scheduling.no-double-book, policy.scheduling.honor-provider-availability

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
