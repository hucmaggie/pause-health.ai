# Runbook: chain the 5 specialists to the Pause Health Intake Agent

Wires the **existing** `Pause_Health_Intake_Agent` (v11, live in `trailsignup`)
to the five specialist agents — NOT by building a new agent, and NOT by putting
all five under one router. Instead the Intake Agent gets ONE deterministic
handoff action, `handoffToCareRouter`, that fans out to the specialists in a
fixed, auditable order through the Agent Fabric.

## Why this shape (read first)

We already proved a unified "concierge" (all 5 specialists as subagents under one
Agent Router) does NOT work on the Service Agent template: its platform-level
**Inappropriate-Content classifier** intercepts benign coverage/billing questions
at the router and can't be edited or overridden (see
[AGENTFORCE_CONCIERGE_BUILD_SHEET.md](./AGENTFORCE_CONCIERGE_BUILD_SHEET.md)). The
five STANDALONE agents don't trip it because each is narrow-scoped.

So we chain **deterministically** instead of via an LLM router:

- The Intake Agent keeps its current narrow job (capture symptoms + the red-flag
  screen), then calls ONE action — `handoffToCareRouter`.
- That action hits `GET /api/agentforce/route-to-care`, which runs the Care Router
  (always) and optionally chains Benefits, Appointment booking, and SDOH — each a
  deterministic domain lib, each a child span under one Fabric `taskId`.
- No overloaded router → the guardrail condition never arises. The orchestration
  lives in the fabric, where it's testable and observable, not in agent prose.

This mirrors the Intake Agent's existing `PauseProviderDirectory.findMenopauseProviders`
action — same "intake agent → External Service → fabric" pattern, already live.

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/route-to-care`
— a flat REST alias that chains the deterministic specialist libs (no live Claude)
behind the SAME Agent Fabric governance gate as the Care Router: the mandatory
red-flag screen must be completed (a missing screen is blocked). Advisory/synthetic
— recommends a pathway, a synthetic cost estimate, and a synthetic booking; does
NOT diagnose, prescribe, guarantee cost, or create a real appointment.

`sf`/`gh` run from **your terminal** (blocked in the Claude sandbox). Ships to prod
on merge to `main`. **Verify the route is live before Step 1:**

```bash
curl -s "https://pause-health.ai/api/agentforce/route-to-care?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&patientInsurance=Aetna&book=true&providerId=npi-123" | jq '{chained, pathway, coverage: .coverage.eligibilityStatus, booked: .scheduling.serviceAppointmentId, taskId}'
```

→ expect `chained: ["care-router","benefits-verification","appointment-scheduling"]`,
a pathway, coverage `active`, a booking id, and a `taskId`.

---

## 1. Register the External Service

Setup → External Services → Add → From API specification →
- **Service name:** `PauseRouteToCare`
- **Named Credential:** `Pause_Provider_API` (reuse — no-auth, endpoint https://pause-health.ai)
- **Schema:** upload `salesforce/external-services/pause-route-to-care.oas.yaml`
- Save → confirm the **`handoffToCareRouter`** operation imports.

## 2. Add the handoff action to the Intake Agent (Agent Builder UI)

> Author in the UI, then retrieve + commit — don't hand-write the
> GenAiPlannerBundle source. Same discipline as the 5 agents.

Open **Pause Health Intake Agent** in Agent Builder. On its existing
**"Menopause Symptom Intake"** subagent (the one that captures symptoms + the
red-flag screen), add the handoff action:

1. **Add action** → Create a custom action → Reference Action Type **API**,
   Category **External Services**, Reference Action **Handoff To Care Router**.
   (If only `No_DATA_FOUND` shows, hard-refresh or re-save the External Service —
   Edit → Save & Next — to regenerate the invocable action.)
   - **Action Name:** `handoffToCareRouter`
   - **Description:** "Hands the completed intake off to the specialist agents —
     routes to a care pathway and optionally verifies coverage, books an
     appointment, and screens for social needs — in one call."
   - **Inputs:** `redFlagsAcknowledged` (**require input** — the handoff is blocked
     without it), `primarySymptom`, `severity`, `cycleStatus` mapped from the
     conversation; `patientInsurance` / `patientZip` from the prechat dossier
     context variables (`Pause_Patient_Insurance__c`, `Pause_Patient_Zip__c`) when
     present; `book`, `verifyCoverage`, `providerId`, `screenSdoh`, `sdohConsent`
     optional (set by the reasoning when the patient asks for those).
   - **Outputs:** on the **`200`** object, **check "Show in conversation"**.

2. Update the subagent's **reasoning instructions** to call the handoff after the
   screen (paste-ready copy in §3).

3. **Save.**

## 3. Reasoning copy for "Menopause Symptom Intake" (paste verbatim)

> After you have captured the patient's top symptom(s) and completed the
> mandatory red-flag screen, call **handoffToCareRouter** with primarySymptom,
> severity, cycleStatus, and redFlagsAcknowledged (yes/no). Ask the red-flag
> screen as ONE combined yes/no safety question and tell the patient to reply
> just "yes" or "no" — do not ask them to restate specific symptoms. If the
> response has blocked=true, the screen wasn't captured — ask the yes/no question
> and do NOT hand off without it.
>
> When the response comes back, tell the patient the recommended pathway and
> acuity in plain language with the rationale. Then, based on what the patient
> wants:
> - If they ask what a visit will cost or whether it's covered, set
>   verifyCoverage=true (or rely on their insurance from context) and read back
>   the coverage.eligibilityStatus, network, and estimatedPatientResponsibility —
>   always saying it's a synthetic estimate, not a guarantee.
> - If they want to book and the pathway is an MSCP visit, set book=true and pass
>   a providerId; confirm the scheduling.serviceAppointmentId, slot, and modality,
>   and say it's a synthetic confirmation to verify with the clinic.
> - If a social-needs check is appropriate, administer the AHC-HRSN screen with
>   yes/no domain questions and pass screenSdoh. If sdoh.safetyEscalation is true,
>   calmly tell the patient help is available, this will be escalated to a human
>   social worker, and share 988 / 911 — MANDATORY. Ask consent (sdohConsent=true)
>   before any community-resource referral.
>
> Everything here is advisory and synthetic — not a diagnosis, a guaranteed cost,
> or a real appointment. A clinician and human staff make the final decisions.
> Never prescribe.

## 4. Test the chain in Preview

Reset Simulator first if you edited after a run. Then:

1. "I've been having bad hot flashes and don't know where to start" → Intake
   captures symptom → asks ONE yes/no red-flag question.
2. "No" → calls `handoffToCareRouter` → returns a routine MSCP pathway + rationale.
3. "Will my Aetna plan cover it, and can you book it?" → same action with
   verifyCoverage + book → reads coverage + confirms a synthetic booking.
4. Watch the trace: one Transition to Menopause Symptom Intake → one
   `handoffToCareRouter` invocation → GROUNDED. Open
   `/demo/agent-fabric?taskId=<taskId from the response>` to see the
   intake → care-router → benefits → scheduling span tree as one correlated trace.

If a benign coverage/billing question ever draws a refusal, that's the
Inappropriate-Content classifier — because this keeps ONE narrow subagent doing
the handoff (not five under a router), it should not fire; if it does, keep the
subagent scope tight and do not add the specialists as separate router subagents.

## 5. Activate + capture

Commit Version → Activate. Then (fresh branch off main):

```bash
git branch intake-chaining-capture origin/main && git switch intake-chaining-capture
sf project retrieve start \
  --metadata "Bot:Pause_Health_Intake_Agent" \
  --metadata "GenAiPlannerBundle:Pause_Health_Intake_Agent_v11" \
  --metadata "ExternalServiceRegistration:PauseRouteToCare" \
  --target-org trailsignup
```

Add `PauseRouteToCare` to the ExternalServiceRegistration members in
`salesforce/manifest/package.xml`, then commit the updated Intake Agent bundle.

## Notes / honesty

- The handoff is DETERMINISTIC (scripted Care Router + deterministic domain libs),
  no live Claude in the alias. The Intake Agent's conversation is Claude; the
  routing/coverage/booking/screening decisions are reproducible.
- SDOH requires a COMPLETE AHC-HRSN screen (housing 2, food 2, transportation 1,
  utilities 1, safety 4); an incomplete screen is skipped and never breaks routing.
- Booking only happens for MSCP pathways with a providerId — the alias will not
  invent a confirmation for a self-care or urgent-referral pathway.
- This does not solve the concierge problem; it sidesteps it. A single
  conversational agent that freely routes across all five specialities still
  needs a non-Service-Agent template (or a platform change) — see the concierge
  build sheet.
