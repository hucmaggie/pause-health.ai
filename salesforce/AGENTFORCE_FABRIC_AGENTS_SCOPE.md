# Scope: bring select fabric agents into Agentforce Studio (properly)

**Goal.** Build a small, high-value set of the Pause fabric agents as **native
Agentforce agents** in the `trailsignup` org — real `Bot` + `GenAiPlannerBundle`
+ topics/actions that call the fabric via External Services — modeled on the
existing **Pause Health Intake Agent**. **Not** a bulk port of all 110.

## Why not all 110 (the constraint that shapes this)

An Agentforce agent is **executable Salesforce metadata** — a `Bot` (context
vars, channel), a `GenAiPlannerBundle` (reasoning/topic-selection instructions),
and `GenAiPlugin`/`GenAiFunction` topics+actions bound to Apex/Flow/External
Service — that runs LLM-planner-driven against org data. Our 110 fabric agents
are **A2A cards** describing deterministic classical-algorithm endpoints. There
is **no A2A→Agentforce converter**, and most of the 110 (batch-partition, RLE,
Fenwick-tree, coverage-heatmap, …) are algorithm *services*, not conversational
Salesforce agents — they belong in Exchange (done) / behind an API, not in
Agentforce Studio. Only the patient/clinical/benefits-facing agents are
genuinely Agentforce-shaped.

## Candidate set (build these, in priority order)

All already carry `kind: agentforce` in the registry and are explicitly designed
as "Agentforce for Health" analogs — the strongest fit:

| # | Fabric agent | Fabric endpoint | Agentforce analog |
|---|---|---|---|
| 1 | **Benefits & Coverage Verification (EBV)** | `/api/agents/benefits-verification` | Agentforce for Health — Eligibility & Benefit Verification |
| 2 | **Member Service · Billing & Coverage** | `/api/agents/member-service` | Claims & Coverage patient-service |
| 3 | **Appointment Scheduling (MSCP)** | `/api/agents/appointment-scheduling` | Book/Reschedule/Update Appointment |
| 4 | **Care Router** | `/api/agents/care-router` | Clinical pathway routing (pairs with the existing Intake agent) |
| 5 | **SDOH Screening** (stretch) | `/api/agents/sdoh-screening` | Whole-person-care screening |

Prior Authorization is intentionally **excluded from v1** — it's the heaviest,
least demo-honest, and governance-gated (`no-autonomous-submission`); revisit
once the pattern is proven.

Rationale for 1–3 first: they're the cleanest request→structured-response shape,
map directly to one External Service action each, and need no clinical-reasoning
copy beyond a topic instruction.

## The build pattern (per agent) — reuse the proven Intake stack

The existing `Pause_Health_Intake_Agent` already establishes every piece; each
new agent repeats it:

1. **OAS slice** in `salesforce/external-services/<agent>.oas.yaml` — lean schema
   declaring only the fields the agent needs from the fabric endpoint (same style
   as `pause-provider-directory.oas.yaml`).
2. **Named Credential** — reuse `Pause_Provider_API` (no-auth GET to
   `pause-health.ai`) or add one per host if paths diverge.
3. **ExternalServiceRegistration** — register the OAS so the endpoint becomes an
   invocable action.
4. **`GenAiFunction` / `GenAiPlugin`** — the topic + action wiring (action inputs
   bound to bot context vars, outputs mapped from the OAS response).
5. **`GenAiPlannerBundle`** — topic-selection + reasoning instructions (paste-ready
   copy authored in Agent Builder UI, mirrored to the runbook).
6. **`Bot`** — context variables + channel assignment; assign an LLM.
7. **Tests** (Agentforce `Tests` tab) — a few utterance→expected-action cases.

Track the deployable metadata in `force-app/` + `manifest/package.xml`; author
the reasoning copy in Agent Builder and mirror it into the runbook (the codebase
convention — reasoning copy lives in the UI, wiring lives in the repo).

## Effort estimate

| Item | Effort | Notes |
|---|---|---|
| OAS slice per agent | Low | Copy the provider-directory pattern; declare I/O fields |
| External Service + action wiring | Low–Med | Proven path; ~1 action per agent |
| Planner/topic reasoning copy | Med | The real authoring work — per-agent instructions + tests |
| Bot + LLM assignment + channel | Low | Clone Intake agent's config |
| First agent (EBV) end-to-end | ~0.5–1 day | Establishes the repeatable template |
| Each subsequent agent | ~0.25–0.5 day | Mostly OAS + reasoning copy + tests |
| **Set of 4–5** | **~2–3 days** | Plus org deploy/test iterations |

## Constraints & gotchas (confirmed from this repo)

- **`sf` CLI can't run from the Claude sandbox** (blocked from writing
  `~/.sf/*.log`). All `sf project deploy/retrieve` runs happen in **your
  terminal** against `trailsignup`. I can author all the metadata + OAS + runbook
  copy; you deploy.
- **Keep deployable XML comment-free** (a stray comment broke a prior deploy).
  Explanations go in README/runbook, not metadata.
- **Fresh-org dependency**: the permission set references ~22 dossier fields;
  deploys cleanly to `trailsignup` (fields exist) — a new org needs `./retrieve.sh`
  first.
- **LLM cost**: each Agentforce agent consumes model calls at runtime — one more
  reason to keep the set small.
- The fabric endpoints are **synthetic/mocked** today; actions will return clearly
  labeled synthetic data (same posture as the fabric).

## Recommended first step

Build **agent #1 (Benefits & Coverage Verification / EBV)** end-to-end as the
template: I author `benefits-verification.oas.yaml`, the External Service + action
+ planner/topic wiring, the `Bot`/`GenAiPlannerBundle` metadata, paste-ready
reasoning copy, and a test spec; you deploy via `./deploy.sh` and finish the
UI-only bits in Agent Builder. Once it's live and tested, agents #2–#5 follow the
same template quickly.
