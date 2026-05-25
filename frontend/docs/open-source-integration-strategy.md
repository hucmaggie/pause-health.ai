# Open-Source Integration Strategy

## Objective
Use proven open-source building blocks to accelerate interoperability and reduce implementation risk for provider organizations.

## JupyterHealth for EHR Workflows
- Position JupyterHealth as the interoperability layer for EHR-facing workflows.
- Use it for patient context retrieval, encounter updates, and triage auditability.
- Keep Pause-Health.ai focused on triage intelligence and routing decisions, while JupyterHealth handles healthcare data exchange patterns.

## dbdp for Wearable Integrations
- Use `dbdp` connectors to ingest wearable streams (sleep, heart-rate trends, activity, symptom logs).
- Normalize wearable-derived features before triage scoring.
- Persist feature provenance so clinicians can see what data informed each recommendation.

## Product Benefits
- Faster integration timelines by reusing existing OSS interoperability components.
- Better clinical context by combining EHR history and near-real-time wearable signals.
- Stronger investor narrative through capital-efficient, standards-oriented architecture choices.

## Prototype Mapping
- Intake dashboard includes source-level visibility for EHR vs wearable inputs.
- Patient detail shows merged context from JupyterHealth and dbdp.
- Routing screen demonstrates write-back and watchlist handoff.
- Analytics screen reports integration reliability and wearable coverage.
