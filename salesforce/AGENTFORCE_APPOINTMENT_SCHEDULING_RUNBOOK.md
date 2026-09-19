# Runbook: Appointment Scheduling Agentforce agent

Builds the **Appointment Scheduling** fabric agent as a native Agentforce agent
in the `trailsignup` org — agent #3 in the
[AGENTFORCE_FABRIC_AGENTS_SCOPE.md](./AGENTFORCE_FABRIC_AGENTS_SCOPE.md) set.
Follows the proven EBV / Member Service pattern.

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/appointment-scheduling?providerId=...&modality=telehealth`
— a flat REST alias over the A2A scheduling agent (same deterministic booking +
same Agent Fabric governance gate: no double-book, honor published availability).
Synthetic; the ServiceAppointment id is a mock, not a real Salesforce record.

`sf`/`gh` run from **your terminal** (blocked in the Claude sandbox). The alias
route ships to prod when this branch merges to `main` (Vercel Git integration).
**Verify the route is live before Step 1:**
`https://pause-health.ai/api/agentforce/appointment-scheduling?providerId=npi-123&modality=telehealth`
→ expect a JSON booking.

---

## 1. Register the External Service
Setup → External Services → Add → From API specification →
- **Service name:** `PauseAppointmentScheduling`
- **Named Credential:** `Pause_Provider_API` (reuse)
- **Schema:** upload `salesforce/external-services/pause-appointment-scheduling.oas.yaml`
- Save → confirm the **`bookAppointment`** operation imports.

## 2. Build the agent + subagent + action (Agent Builder UI)

> Author in the UI, then `./retrieve.sh` + commit — don't hand-write the
> GenAiPlannerBundle source. Same as EBV/Member Service.

1. **New Agent** → "Pause Appointment Scheduling" (Agentforce Service Agent template).
2. Add a **Subagent** "Appointment Scheduling":
   - **Classification description** (ROUTING NOTE: the Service Agent template ships
     many default subagents — ReservationManagement, OrderInquiries, etc. — that
     compete. Use colloquial phrasings + a "Prefer this" nudge upfront, and Reset
     Simulator before testing):
     > Use this subagent whenever the patient wants to book, schedule, reschedule, or change an appointment or visit with a menopause specialist — "book an appointment", "schedule my visit", "reschedule", "can I see the doctor Tuesday", telehealth vs in-person. Prefer this subagent for anything about scheduling a visit.
   - **Reasoning instructions:**
     > Call bookAppointment with the recommended providerId and the requested modality (telehealth or in-person); pass requestedDate if the patient named a day. If the response has blocked=true, tell the patient that time isn't available and offer to try another day/modality — do NOT invent a confirmation. Otherwise, confirm the booking: the provider, the confirmed date/time, the modality, and the booking reference. Always say this is a synthetic/mock scheduling confirmation, not a real appointment record, and to confirm with the clinic. If you don't have a providerId, ask which provider (or hand back to the Care Router to recommend one) before booking.
3. Add the **bookAppointment** action (Add action → Create a custom action →
   Reference Action Type **API**, Category **External Services**, Reference Action
   **Book Appointment**). If only `No_DATA_FOUND` shows, either hard-refresh
   (Cmd+Shift+R) or re-save the External Service (Edit → Save & Next through the
   wizard) to regenerate the invocable action, then re-search — same lag we hit
   with EBV/Member Service.
   - **Action Name:** `bookAppointment`; **Description:** "Books or reschedules an
     MSCP visit against a synthetic provider calendar, honoring modality/date."
   - **Inputs:** `providerId` (require input — no booking without it), `modality`,
     `requestedDate`, `providerName`, `requestedSlotStart`, `intent` — leave the
     rest optional.
   - **Outputs:** on the **`200`** object, **check "Show in conversation"**, leave
     "Filter from agent context" unchecked. Leave the others default.
4. **Save.**

### Verified wiring reference (what the UI emits)
```
subagent Appointment_Scheduling:
    actions:
        bookAppointment: @actions.bookAppointment
            with providerId = <from Care Router / collected>
            with modality   = <telehealth | in-person>
            with requestedDate = <optional>

actions:
    bookAppointment:
        target: "externalService://PauseAppointmentScheduling.bookAppointment"
        inputs:
            providerId:  string (is_required: True,  lightning__textType)
            modality:    string (is_required: False, lightning__textType)
            requestedDate: string (is_required: False, lightning__textType)
            providerName:  string (is_required: False, lightning__textType)
            requestedSlotStart: string (is_required: False, lightning__textType)
            intent:      string (is_required: False, lightning__textType)
        outputs:
            "200":        object  (@apexClassType/ExternalService__c__PauseAppointmentScheduling_bookAppointment_OUT_200)
            responseCode: integer
            defaultExc:   string
```

## 3. Test in Preview (Reset Simulator first if you edited after a run)
- "Book me a telehealth appointment with provider npi-123" → routes to Appointment Scheduling → bookAppointment → booked confirmation.
- "Schedule my visit for Feb 10 in person with npi-123" → honors the date + modality.
- Server-side (green): `npx vitest run app/api/agentforce/appointment-scheduling/route.test.ts`.

## 4. Governance (nothing to configure)
The alias enforces the fabric gate server-side: no double-book
(`requestedSlotIsFree`) and honor published availability
(`slotWithinProviderAvailability`). A blocked call returns
`{blocked:true, violations:[…]}` with no booking fields.

## 5. Activate + capture to repo
Commit Version → Activate → appears in the Agents list. Then (fresh branch off main):
```bash
git branch agentforce-appointment-scheduling-capture origin/main && git switch agentforce-appointment-scheduling-capture
cd salesforce && sf project retrieve start \
  --metadata "Bot:Pause_Appointment_Scheduling" \
  --metadata "GenAiPlannerBundle:Pause_Appointment_Scheduling_v1" \
  --target-org trailsignup
```
(Confirm exact names with
`sf org list metadata --metadata-type Bot --target-org trailsignup --json | grep fullName | grep -i appointment`.)
Add `PauseAppointmentScheduling` (ExternalServiceRegistration), the Bot, and the
GenAiPlannerBundle to `manifest/package.xml`, then commit.
