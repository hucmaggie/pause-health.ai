# Pause Patient Education & Health Coaching · Claude Sonnet 4.5

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier `a2a-card`),
published via the Exchange Experience API (`type=agent`).

- **Fabric agent id:** `patient-education-agent`
- **Asset:** `pause-agent-patient-education-agent` `1.0.0` (groupId `56707cc3-a0e3-4318-b110-78126aace370`)
- **Kind / protocol:** anthropic-claude / A2A
- **Governance tier:** patient-engagement
- **Posture:** PHI-adjacent (HIPAA-audit / consent policies apply)
- **Policies enforced (5):** policy.audit.hipaa-log-every-turn, policy.education.evidence-sourced, policy.education.no-medical-advice, policy.education.consent-before-outreach, policy.model.anthropic-claude-sonnet-allowlisted

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (`frontend/lib/agent-fabric.ts`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
