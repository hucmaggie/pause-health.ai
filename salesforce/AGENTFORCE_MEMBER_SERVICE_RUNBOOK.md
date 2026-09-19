# Runbook: Member Service · Billing & Coverage Agentforce agent

Builds the **Member Service · Billing & Coverage** fabric agent as a native
Agentforce agent in the `trailsignup` org — agent #2 in the
[AGENTFORCE_FABRIC_AGENTS_SCOPE.md](./AGENTFORCE_FABRIC_AGENTS_SCOPE.md) set.
Follows the **proven EBV pattern** (see
[AGENTFORCE_BENEFITS_VERIFICATION_RUNBOOK.md](./AGENTFORCE_BENEFITS_VERIFICATION_RUNBOOK.md),
which shipped and tested GROUNDED).

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/member-service?query=...`
— a flat REST alias over the A2A member-service agent (same deterministic
`answerBillingQuestion` + same Agent Fabric governance gate). Synthetic; every
answer traces to a mock claim/EOB — not a real 835/ERA or FHIR ExplanationOfBenefit.

`sf`/`gh` run from **your terminal** (blocked in the Claude sandbox). The alias
route ships to prod when this branch merges to `main` (Vercel Git integration).
**Verify the route is live before Step 1:**
`https://pause-health.ai/api/agentforce/member-service?query=balance` → expect JSON.

---

## 1. Register the External Service (from the OAS)

Setup → External Services → Add → From API specification →
- **Service name:** `PauseMemberService`
- **Named Credential:** `Pause_Provider_API` (reuse; endpoint `https://pause-health.ai`)
- **Schema:** upload `salesforce/external-services/pause-member-service.oas.yaml`
- Save → confirm the **`answerBillingQuestion`** operation imports.

## 2. Build the agent + subagent + action (Agent Builder UI)

> Author in Agent Builder (UI), then `./retrieve.sh` + commit — do NOT hand-write
> the GenAiPlannerBundle source (base64 `.agent`, compiled agentGraph, org-hash
> localActions). Same reason as EBV.

1. **New Agent** → "Pause Member Service" (Agentforce Service Agent template).
2. Add a **Subagent** "Billing & Coverage":
   - **Classification description:**
     > Use this subagent when the member asks about a claim's status, what they owe (patient responsibility / balance), or wants an explanation of an EOB.
   - **Reasoning instructions:**
     > Call answerBillingQuestion with the member's question as `query` (and memberId if known). If the response has blocked=true, tell the member you can't answer right now and briefly why — do NOT invent claim data. If routeToHuman=true, tell the member you're connecting them to a member-services specialist and why (don't attempt the billing answer yourself). Otherwise, give the answer text, and when relevant state the total patient responsibility and which claims it's based on. Always say figures are from synthetic/mock claim records and are not a final bill; tell the member to confirm with Pause member services. If sourced is false, do not state claim details as verified.
3. Add the **answerBillingQuestion** action to the subagent
   (Add action → New Action → Reference Action Type **API**, Category **External
   Services**, Reference Action **Answer Billing Question**). If it isn't in the
   picker yet, hard-refresh (Cmd+Shift+R) — the invocable action propagates a
   moment after the External Service registers.
   - **Action Name:** `answerBillingQuestion`; **Description:** "Answers a member
     billing/coverage question from synthetic claim records, or routes to a human."
   - **Inputs:** `query` (the member's question — the agent collects it), `memberId`
     optional. Leave "Require input" unchecked on both.
   - **Outputs:** on the **`200`** object, **check "Show in conversation"** and leave
     "Filter from agent context" unchecked (so the agent reads intent/answer/
     routeToHuman/patientResponsibility/blocked). Leave responseCode/defaultExc default.
4. **Save.**

### Verified wiring reference (what the UI emits)
```
subagent Billing_and_Coverage:
    actions:
        answerBillingQuestion: @actions.answerBillingQuestion
            with query = <collected from user>
            with memberId = <optional>

actions:
    answerBillingQuestion:
        target: "externalService://PauseMemberService.answerBillingQuestion"
        inputs:
            query:    string  (is_required: False, lightning__textType)
            memberId: string  (is_required: False, lightning__textType)
        outputs:
            "200":        object  (@apexClassType/ExternalService__c__PauseMemberService_answerBillingQuestion_OUT_200)
            responseCode: integer
            defaultExc:   string
```

## 3. Test in Preview
- "What's the status of my most recent claim?" → routes to Billing & Coverage → answerBillingQuestion → claim-status answer.
- "What do I owe?" → balance answer with patient responsibility.
- "Can you refill my prescription?" → routeToHuman=true (out of scope).
- Server-side (green): `npx vitest run app/api/agentforce/member-service/route.test.ts`.

## 4. Governance (nothing to configure)
The alias enforces the fabric gate server-side: answers must trace to a claim
(`policy.billing.claim-data-sourced`) and carry no free-text PII. A blocked call
returns `{blocked:true, violations:[…]}` with no answer fields.

## 5. Activate + capture to repo
Commit Version → Activate → appears in the Agents list. Then:
```bash
cd salesforce && sf project retrieve start \
  --metadata "Bot:Pause_Member_Service" \
  --metadata "GenAiPlannerBundle:Pause_Member_Service_v1" \
  --target-org trailsignup
```
(Confirm the exact Bot/planner API names with
`sf org list metadata --metadata-type Bot --target-org trailsignup --json | grep fullName | grep -i member`.)
Add `PauseMemberService` (ExternalServiceRegistration), the Bot, and the
GenAiPlannerBundle to `manifest/package.xml`, then commit.
