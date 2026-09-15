# Pause Care Router · Claude Sonnet 4.5

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`),
published via the Exchange Experience API (`type=agent`).

- **Fabric agent id:** `care-router-claude`
- **Asset:** `pause-agent-care-router-claude` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** anthropic-claude / A2A
- **Governance tier:** clinical-decision
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (7):** policy.intake.red-flag-mandatory, policy.audit.hipaa-log-every-turn, policy.model.anthropic-claude-sonnet-allowlisted, policy.clinical.no-prescribing, policy.clinical.rationale-required, policy.fallback.deterministic-on-api-failure, policy.data360.consent-required-before-grounding

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
