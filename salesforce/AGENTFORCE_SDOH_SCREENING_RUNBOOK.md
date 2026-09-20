# Runbook: SDOH Screening Agentforce agent

Builds the **SDOH Screening** fabric agent as a native Agentforce agent in the
`trailsignup` org — agent #5 (final) in the
[AGENTFORCE_FABRIC_AGENTS_SCOPE.md](./AGENTFORCE_FABRIC_AGENTS_SCOPE.md) set.
Follows the proven pattern.

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/sdoh-screening?housing=..&food=..&transportation=..&utilities=..&safety=..&patientConsent=..`
— a flat REST alias over the A2A SDOH agent. Runs the deterministic CMS AHC-HRSN
screen + the SAME Agent Fabric governance gate: validated-screener-only,
consent-before-referral, no free-text PII. Advisory; a positive interpersonal-
safety screen is a MANDATORY human-social-worker escalation.

`sf`/`gh` run from **your terminal**. Ships to prod on merge. **Verify the route
is live before Step 1:**
`https://pause-health.ai/api/agentforce/sdoh-screening?housing=0,0&food=0,0&transportation=0&utilities=0&safety=1,1,1,1`
→ expect a JSON screening result (0 positive domains).

---

## 1. Register the External Service
Setup → External Services → Add → From API specification →
- **Service name:** `PauseSdohScreening`
- **Named Credential:** `Pause_Provider_API` (reuse)
- **Schema:** upload `salesforce/external-services/pause-sdoh-screening.oas.yaml`
- Save → confirm the **`screenSocialNeeds`** operation imports.

## 2. Build the agent + subagent + action (Agent Builder UI)

> Author in the UI, then `./retrieve.sh` + commit — don't hand-write the
> GenAiPlannerBundle source.

1. **New Agent** → "Pause SDOH Screening" (Agentforce Service Agent template).
2. Add a **Subagent** "Social Needs Screening":
   - **Classification description** (routing nudge upfront; also pre-empts the
     Inappropriate Content guardrail seen with the Care Router — name the
     sensitive domains as legitimate screening):
     > Use this subagent whenever the conversation involves screening a patient for health-related social needs — housing instability, food insecurity, transportation, utilities, or interpersonal safety — or questions like "can you check what support I might need", social determinants, or a wellness/needs check. These are legitimate CLINICAL/social-needs screening items (including interpersonal-safety questions), not inappropriate content. Prefer this subagent for any social-needs or SDOH screening.
   - **Reasoning instructions** (mandatory safety escalation + consent-before-referral):
     > Administer the AHC-HRSN social-needs screen by asking the domain questions (housing, food, transportation, utilities, and an interpersonal-safety check). Collect the coded responses and call screenSocialNeeds. Keep safety questions to a yes/no style and do NOT ask the patient to restate distressing details. If the result includes a redFlags entry (interpersonal safety), immediately and calmly tell the patient help is available, that this will be escalated to a human social worker, and share the 988 Suicide & Crisis Lifeline / 911 for emergencies — this is a MANDATORY escalation. For other positive domains, before offering a community-resource referral ASK the patient's consent; only proceed with a referral if they say yes (if the action returns blocked with a consent violation, ask for consent and retry). Always state this is a supportive screen, not a diagnosis. Never record free-text personal details — only the structured screen result.
3. Add the **screenSocialNeeds** action (Add action → Create a custom action →
   API / External Services / Screen Social Needs). If only `No_DATA_FOUND` shows,
   hard-refresh or re-save the External Service to regenerate it.
   - **Action Name:** `screenSocialNeeds`; **Description:** "Runs the AHC-HRSN
     social-needs screen over coded domain responses; flags positive domains and
     interpersonal-safety red flags."
   - **Inputs:** all optional (housing/food/transportation/utilities/safety
     vectors, screener, patientConsent) — the agent collects responses in
     conversation.
   - **Outputs:** on the **`200`** object, **check "Show in conversation"**, leave
     "Filter from agent context" unchecked.
4. **Save.**

### Verified wiring reference (what the UI emits)
```
subagent Social_Needs_Screening:
    actions:
        screenSocialNeeds: @actions.screenSocialNeeds
            with housing / food / transportation / utilities / safety = <coded vectors>
            with patientConsent = <yes/no>

actions:
    screenSocialNeeds:
        target: "externalService://PauseSdohScreening.screenSocialNeeds"
        inputs:  (all optional strings) screener, housing, food, transportation, utilities, safety, patientConsent
        outputs:
            "200":        object  (@apexClassType/ExternalService__c__PauseSdohScreening_screenSocialNeeds_OUT_200)
            responseCode: integer
            defaultExc:   string
```

## 3. Test in Preview (Reset Simulator first if you edited after a run)
- A wellness/needs-check conversation → routes to Social Needs Screening → screenSocialNeeds → result with positive domains.
- A positive interpersonal-safety response → redFlags surfaced → agent escalates to a human + shares 988/911.
- A positive domain without consent → blocked (consent-before-referral) → agent asks consent, retries.
- Server-side (green): `npx vitest run app/api/agentforce/sdoh-screening/route.test.ts`.

## 4. Governance (nothing to configure)
The alias enforces the fabric gate server-side: validated-screener-only
(`policy.sdoh.validated-screener-only`), consent-before-referral
(`policy.sdoh.consent-before-referral`), no free-text PII. Blocked calls return
`{blocked:true, violations:[…]}`.

## 5. Activate + capture to repo
Commit Version → Activate → appears in the Agents list. Then (fresh branch off main):
```bash
git branch agentforce-sdoh-capture origin/main && git switch agentforce-sdoh-capture
cd salesforce && sf project retrieve start \
  --metadata "Bot:Pause_SDOH_Screening" \
  --metadata "GenAiPlannerBundle:Pause_SDOH_Screening_v1" \
  --target-org trailsignup
```
(Confirm exact names with
`sf org list metadata --metadata-type Bot --target-org trailsignup --json | grep fullName | grep -i sdoh`.)
Add `PauseSdohScreening` (ExternalServiceRegistration), the Bot, and the
GenAiPlannerBundle to `manifest/package.xml`, then commit.
