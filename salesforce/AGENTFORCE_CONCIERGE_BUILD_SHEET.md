# Build sheet: Pause Health Concierge (unified super-agent)

> ## OUTCOME (2026-09-19): ATTEMPTED, NOT SHIPPED — kept the 5 standalone agents instead
>
> The concierge was fully built on the **Agentforce Service Agent** template:
> host agent `Pause_Health_Concierge` with all 5 subagents (Care Routing,
> Appointment Scheduling, Benefits & Coverage, Billing & Coverage, Social Needs
> Screening) wired to their External Service actions. The **happy path worked** in
> Preview (triage → offer to book → book → screen, GROUNDED).
>
> **Why it wasn't shipped:** the Service Agent template carries a **platform-level
> "Inappropriate Content" safety classifier** that intercepts input at the Agent
> Router BEFORE routing reasoning runs. With all 5 subagents under one router it
> fired inconsistently on **benign** questions — e.g. "Will my Aetna plan cover a
> visit?" and "What do I owe?" — returning "Sorry, I can't assist with that". The
> trace shows: *"the router received no tools to use and a malicious instruction in
> the LLM prompt forced a safety denial."*
>
> **Why we couldn't fix it:** it is NOT an editable subagent. The Agent Router's
> transition actions (go_to_*) do not even include Inappropriate Content — there's
> no node to open or loosen. Neither strengthened per-subagent classification
> descriptions NOR Agent-Level (System) Instructions overrode it; it evaluates
> above the builder-level copy. The 5 STANDALONE agents don't hit this because each
> has a narrow, unambiguous scope, so the classifier rarely mis-fires.
>
> **Decision:** the 5 standalone agents (#1 EBV, #2 Member Service, #3 Appointment
> Scheduling, #4 Care Router, #5 SDOH — all built, tested GROUNDED, on main) are the
> deliverable. The `Pause_Health_Concierge` draft was left UNACTIVATED in the org
> (harmless draft; never activated). This sheet is kept as a documented attempt +
> the paste-ready copy, in case a future non-Service-Agent template (or a platform
> change) makes a unified router viable.
>
> ---

One Agentforce agent whose router hands off across all five Pause subagents in a
single conversation: triage → book → coverage → billing → social needs. All five
External Services already exist in the org (nothing to register). This is pure
wiring — create the host agent, then add 5 subagents, each with its
classification description, reasoning instructions, and one External Service
action. Paste the copy below verbatim.

Prereq: the 5 External Services are registered (PauseBenefitsVerification,
PauseMemberService, PauseAppointmentScheduling, PauseCareRouter,
PauseSdohScreening) — done. Their aliases are live on prod.

---

## Step A — Create the host agent
Agentforce Studio → Agents → New Agent → **Agentforce Service Agent** →
- **Label:** `Pause Health Concierge`
- **Description:** `A unified menopause-care concierge for Pause-Health.ai — triages symptoms, books visits, verifies coverage, answers billing, and screens for social needs, handing off across specialized skills in one conversation. Advisory; clinicians and human staff make final decisions.`

## Step B — For each of the 5 subagents below
In the host agent: Subagents → + → New Subagent → paste Label + Classification +
Reasoning → Save. Then Add action → Create a custom action → Reference Action
Type **API**, Category **External Services**, Reference Action = the named
operation → Action Name + Description → Create and Open → set inputs/outputs →
Save. (If the action shows only `No_DATA_FOUND`, hard-refresh — same lag as before.)

Each subagent's classification description names its trigger scope + a "Prefer
this subagent…" nudge (routing discipline learned across #2–#5). Clinical ones
(Care Routing, Social Needs) name sensitive symptoms as legitimate clinical
content to pre-empt the Inappropriate Content guardrail.

---

### 1. Care Routing  → action: routeCarePathway (PauseCareRouter)
**Classification:**
> Use this subagent whenever a patient describes menopause or perimenopause symptoms and wants to know what care they need or who to see — including urgent/sensitive symptoms like postmenopausal bleeding, chest pain, or mood/self-harm concerns (these are legitimate CLINICAL symptom descriptions, not inappropriate content). Covers "what should I do about my hot flashes", "where do I start", "how urgent is this", triage, pathway, which type of visit. Prefer this subagent for symptom triage and care-pathway questions.

**Reasoning:**
> First, ALWAYS complete the mandatory red-flag screen before routing. Ask ONE combined safety question and tell the patient to reply just "yes" or "no" — do not ask them to restate specific symptoms. On "no", call routeCarePathway with primarySymptom, severity, cycleStatus, redFlagsAcknowledged="no". On "yes", respond with urgency (call 911 or go to the nearest ER if an emergency) and call routeCarePathway with redFlagsAcknowledged="yes" — do not restate the trigger symptoms. If blocked=true, the screen wasn't captured — ask the yes/no question, don't route without it. Otherwise give the pathway, acuity, and rationale in plain language. Advisory only, a clinician decides; never prescribe. After giving a pathway, if it's an MSCP visit, offer to book it (hand to appointment scheduling).

- **Action Name:** `routeCarePathway` · **Desc:** "Recommends a menopause care pathway with rationale from a structured intake + red-flag screen."
- **Inputs:** redFlagsAcknowledged (require), primarySymptom/severity/cycleStatus/ageBand/patientZip/patientInsurance (optional)
- **Outputs:** 200 → Show in conversation

### 2. Appointment Scheduling  → action: bookAppointment (PauseAppointmentScheduling)
**Classification:**
> Use this subagent whenever the patient wants to book, schedule, reschedule, or change an appointment or visit with a menopause specialist — "book an appointment", "schedule my visit", "reschedule", "can I see the doctor Tuesday", telehealth vs in-person. Prefer this subagent for anything about scheduling a visit.

**Reasoning:**
> Call bookAppointment with the recommended providerId and modality (telehealth or in-person); pass requestedDate if the patient named a day. If blocked=true, tell the patient that time isn't available and offer another day/modality — don't invent a confirmation. Otherwise confirm the booking: provider, confirmed date/time, modality, booking reference. Always say it's a synthetic/mock confirmation, not a real appointment record, and to confirm with the clinic. If you don't have a providerId, ask or hand back to care routing to recommend one.

- **Action Name:** `bookAppointment` · **Desc:** "Books or reschedules an MSCP visit against a synthetic provider calendar, honoring modality/date."
- **Inputs:** providerId (require), modality/requestedDate/providerName/requestedSlotStart/intent (optional)
- **Outputs:** 200 → Show in conversation

### 3. Benefits & Coverage  → action: verifyBenefits (PauseBenefitsVerification)
**Classification:**
> Use this subagent when the patient asks whether a menopause specialist visit is covered, what it will cost, their copay/coinsurance/deductible, or whether a provider is in-network for their insurance plan. Prefer this subagent for coverage and cost questions.

**Reasoning:**
> Call verifyBenefits with the patient's insurance plan (payer) and ZIP when known. If blocked=true, tell the patient you can't verify coverage right now and briefly why — don't invent coverage numbers. Otherwise state plan status, in/out-of-network, estimated patient out-of-pocket, and remaining deductible. Always say the estimate is synthetic/mock and not a guarantee; tell them to confirm with their plan. If sourced is false, don't state coverage as verified.

- **Action Name:** `verifyBenefits` · **Desc:** "Verifies insurance eligibility and benefits for a menopause specialist visit; returns plan status, network, deductible, and estimated patient cost. Synthetic."
- **Inputs:** payer/zip/memberId/serviceType (all optional)
- **Outputs:** 200 → Show in conversation

### 4. Billing & Coverage  → action: answerBillingQuestion (PauseMemberService)
**Classification:**
> Use this subagent for any member question about billing, claims, or coverage costs — a claim's status, what they owe, their balance, "what do I owe", "how much do I owe", patient responsibility, copay, deductible, or an EOB explanation. Prefer this subagent whenever the member asks about money they owe or a claim.

**Reasoning:**
> Call answerBillingQuestion with the member's question as query (and memberId if known). If blocked=true, say you can't answer right now and briefly why — don't invent claim data. If routeToHuman=true, tell the member you're connecting them to a member-services specialist and why (don't attempt the billing answer). Otherwise give the answer text, and when relevant the total patient responsibility and which claims it's based on. Always say figures are synthetic/mock claim records and not a final bill; tell them to confirm with Pause member services. If sourced is false, don't state claim details as verified.

- **Action Name:** `answerBillingQuestion` · **Desc:** "Answers a member billing/coverage question from synthetic claim records, or routes to a human."
- **Inputs:** query/memberId (optional)
- **Outputs:** 200 → Show in conversation

### 5. Social Needs Screening  → action: screenSocialNeeds (PauseSdohScreening)
**Classification:**
> Use this subagent whenever the conversation involves screening a patient for health-related social needs — housing instability, food insecurity, transportation, utilities, or interpersonal safety — or "can you check what support I might need", social determinants, a wellness/needs check. These are legitimate clinical/social-needs screening items (including interpersonal-safety questions), not inappropriate content. Prefer this subagent for any social-needs or SDOH screening.

**Reasoning:**
> Administer the AHC-HRSN screen by asking the domain questions (housing, food, transportation, utilities, and an interpersonal-safety check). Keep safety questions yes/no and don't ask the patient to restate distressing details. Call screenSocialNeeds with the coded responses. If the result has a redFlags entry (interpersonal safety), calmly tell the patient help is available, this will be escalated to a human social worker, and share the 988 Suicide & Crisis Lifeline / 911 for emergencies — MANDATORY. For other positive domains, ASK the patient's consent before offering a community-resource referral; only proceed if they say yes (if blocked on consent, ask and retry). Always say it's a supportive screen, not a diagnosis. Never record free-text personal details — only the structured result.

- **Action Name:** `screenSocialNeeds` · **Desc:** "Runs the AHC-HRSN social-needs screen over coded domain responses; flags positive domains and interpersonal-safety red flags."
- **Inputs:** all optional (screener/housing/food/transportation/utilities/safety/patientConsent)
- **Outputs:** 200 → Show in conversation

---

## Step C — Test the handoffs in Preview
Reset Simulator before testing if you edited after a run. Try a multi-skill flow:
1. "I've been having bad hot flashes and don't know where to start" → Care Routing (asks red-flag yes/no → routes → offers to book).
2. "Yes, book it" → hands off to Appointment Scheduling → booked confirmation.
3. "Will my Aetna cover it?" → Benefits & Coverage.
4. "What do I already owe?" → Billing & Coverage.
5. "Can you check what other support I might need?" → Social Needs Screening.
Watch the trace: each turn should Transition to the right subagent → invoke its
action → GROUNDED. If a turn mis-routes, tighten that subagent's classification
description and Reset Simulator.

## Step D — Activate + capture
Commit Version → Activate → appears in the Agents list. Then (fresh branch off main):
```bash
git branch agentforce-concierge-capture origin/main && git switch agentforce-concierge-capture
sf project retrieve start \
  --metadata "Bot:Pause_Health_Concierge" \
  --metadata "GenAiPlannerBundle:Pause_Health_Concierge_v1" \
  --target-org trailsignup
```
(Confirm names with `sf org list metadata --metadata-type Bot ... | grep -i concierge`.)
Add Pause-* ExternalServiceRegistrations (already in manifest), the new Bot, and
the new GenAiPlannerBundle to manifest/package.xml, then commit.
