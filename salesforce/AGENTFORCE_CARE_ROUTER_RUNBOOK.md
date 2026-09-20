# Runbook: Care Router Agentforce agent

Builds the **Care Router** fabric agent as a native Agentforce agent in the
`trailsignup` org — agent #4 in the
[AGENTFORCE_FABRIC_AGENTS_SCOPE.md](./AGENTFORCE_FABRIC_AGENTS_SCOPE.md) set.
Follows the proven EBV / Member Service / Appointment Scheduling pattern.

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/care-router?primarySymptom=...&severity=...&redFlagsAcknowledged=...`
— a flat REST alias over the A2A Care Router. Uses the DETERMINISTIC scripted
routing engine (no live Claude) + the SAME Agent Fabric governance gate:
mandatory red-flag screen, allow-listed model, rationale required. Advisory only —
recommends a pathway with rationale; does NOT diagnose/prescribe.

`sf`/`gh` run from **your terminal** (blocked in the Claude sandbox). Ships to prod
on merge. **Verify the route is live before Step 1:**
`https://pause-health.ai/api/agentforce/care-router?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no`
→ expect a JSON routing decision.

---

## 1. Register the External Service
Setup → External Services → Add → From API specification →
- **Service name:** `PauseCareRouter`
- **Named Credential:** `Pause_Provider_API` (reuse)
- **Schema:** upload `salesforce/external-services/pause-care-router.oas.yaml`
- Save → confirm the **`routeCarePathway`** operation imports.

## 2. Build the agent + subagent + action (Agent Builder UI)

> Author in the UI, then `./retrieve.sh` + commit — don't hand-write the
> GenAiPlannerBundle source. Same as the prior agents.

1. **New Agent** → "Pause Care Router" (Agentforce Service Agent template).
2. Add a **Subagent** "Care Routing":
   - **Classification description** (routing nudge upfront, per the #2 lesson):
     > Use this subagent whenever a patient describes menopause or perimenopause symptoms and wants to know what kind of care they need or who to see — "what should I do about my hot flashes", "where do I start", "how urgent is this", triage, pathway, or which type of visit. Prefer this subagent for symptom triage and care-pathway questions.
   - **Reasoning instructions** (the red-flag screen is MANDATORY — call it out):
     > First, ALWAYS ask the mandatory red-flag screening question before routing (any acute chest pain, postmenopausal/unexpected bleeding, new neurological deficits, or thoughts of self-harm). Only after you have the patient's red-flag answer, call routeCarePathway with primarySymptom, severity, cycleStatus, and redFlagsAcknowledged (yes/no). If the response has blocked=true, it means the red-flag screen wasn't captured — ask the red-flag question, do NOT route without it. Otherwise, tell the patient the recommended pathway and acuity in plain language, give the rationale, and if any red flag triggered, convey the urgency clearly. Always state this is an advisory recommendation, not a diagnosis, and that a clinician makes the final decision. Never prescribe or promise a specific treatment.
3. Add the **routeCarePathway** action (Add action → Create a custom action →
   Reference Action Type **API**, Category **External Services**, Reference Action
   **Route Care Pathway**). If only `No_DATA_FOUND` shows, hard-refresh or re-save
   the External Service (Edit → Save & Next) to regenerate the invocable action.
   - **Action Name:** `routeCarePathway`; **Description:** "Recommends a menopause
     care pathway with rationale from a structured intake + red-flag screen."
   - **Inputs:** `redFlagsAcknowledged` (require input — routing is blocked without
     it), `primarySymptom`, `severity`, `cycleStatus`, and the rest optional.
   - **Outputs:** on the **`200`** object, **check "Show in conversation"**, leave
     "Filter from agent context" unchecked.
4. **Save.**

### Verified wiring reference (what the UI emits)
```
subagent Care_Routing:
    actions:
        routeCarePathway: @actions.routeCarePathway
            with redFlagsAcknowledged = <from the mandatory screen>
            with primarySymptom = <collected>
            with severity = <collected>

actions:
    routeCarePathway:
        target: "externalService://PauseCareRouter.routeCarePathway"
        inputs:
            redFlagsAcknowledged: string (is_required: True,  lightning__textType)
            primarySymptom:       string (is_required: False, lightning__textType)
            severity:             string (is_required: False, lightning__textType)
            cycleStatus:          string (is_required: False, lightning__textType)
            ageBand / patientZip / patientInsurance: string (optional)
        outputs:
            "200":        object  (@apexClassType/ExternalService__c__PauseCareRouter_routeCarePathway_OUT_200)
            responseCode: integer
            defaultExc:   string
```

## 3. Test in Preview (Reset Simulator first if you edited after a run)
- "I've been having moderate hot flashes, what should I do?" → agent asks the red-flag question → after "no" → routes to a routine MSCP pathway with rationale.
- "I'm having postmenopausal bleeding" + red flag yes → urgent-gynecology, urgency conveyed.
- If the agent tries to route WITHOUT asking the red-flag question, the action returns blocked → it should ask the question (this is the mandatory-screen gate working).
- Server-side (green): `npx vitest run app/api/agentforce/care-router/route.test.ts`.

## 4. Governance (nothing to configure)
The alias enforces the fabric gate server-side: mandatory red-flag screen
(`policy.intake.red-flag-mandatory`), allow-listed model, rationale required. A
missing red-flag screen returns `{blocked:true, violations:[…]}` with no pathway.

## 5. Activate + capture to repo
Commit Version → Activate → appears in the Agents list. Then (fresh branch off main):
```bash
git branch agentforce-care-router-capture origin/main && git switch agentforce-care-router-capture
cd salesforce && sf project retrieve start \
  --metadata "Bot:Pause_Care_Router" \
  --metadata "GenAiPlannerBundle:Pause_Care_Router_v1" \
  --target-org trailsignup
```
(Confirm exact names with
`sf org list metadata --metadata-type Bot --target-org trailsignup --json | grep fullName | grep -i care`.)
Add `PauseCareRouter` (ExternalServiceRegistration), the Bot, and the
GenAiPlannerBundle to `manifest/package.xml`, then commit.
