# Salesforce metadata — Pause Agentforce intake & provider stack

Version-controlled Salesforce DX source for the Pause-Health Agentforce
deployment on the `trailsignup` org. This is the **canonical source of truth**
for the deployable metadata behind the intake agent, the prechat dossier
handoff, and the "Find a Provider" action.

Before Phase 18b this metadata was retrieved ad-hoc to `/tmp` and deployed from
a throwaway `.sf-deploy/` scaffold (the org was the source of truth). That
scaffold is now retired and its contents live here as a proper SFDX project.

---

## Layout

```
salesforce/
├── sfdx-project.json                 # SFDX project root (sourceApiVersion 62.0)
├── deploy.sh                         # deploy the tracked subset to an org
├── retrieve.sh                       # pull the full org source-of-truth back here
├── manifest/
│   ├── package.xml                   # deployable subset that lives in this repo
│   └── package-complete.xml          # full retrieve set (incl. org-managed pieces)
├── external-services/
│   └── pause-provider-directory.oas.yaml   # OAS 3.0 input for the External Service
└── force-app/main/default/
    ├── namedCredentials/Pause_Provider_API.namedCredential-meta.xml
    ├── objects/MessagingSession/fields/Pause_Patient_Zip__c.field-meta.xml
    ├── flows/Pause_Intake_Prechat_Router.flow-meta.xml
    ├── messagingChannels/Messaging_for_In_App_Web.messagingChannel-meta.xml
    └── permissionsets/Pause_Health_Intake_Prechat_Dossier.permissionset-meta.xml
```

---

## What's tracked here vs. still org-managed

**Tracked & deployable from this repo** (everything in `manifest/package.xml`):

| Artifact | Type | Purpose |
| --- | --- | --- |
| `Pause_Provider_API` | NamedCredential | No-auth callout to `https://pause-health.ai` for the Find-a-Provider action |
| `MessagingSession.Pause_Patient_Zip__c` | CustomField | Patient ZIP handed in-band via hidden prechat → bot context → action `zip` input |
| `Pause_Intake_Prechat_Router` | Flow | Routing flow that stamps the prechat dossier onto the MessagingSession |
| `Messaging_for_In_App_Web` | MessagingChannel | Channel with the `Patient_Zip` custom parameter + parameter mapping |
| `Pause_Health_Intake_Prechat_Dossier` | PermissionSet | FLS for the dossier fields on MessagingSession |

**Still org-managed — not yet committed** (pull with `./retrieve.sh`):

- The remaining ~20 `MessagingSession.Pause_*__c` dossier fields (age band, cohort,
  identity confidence, symptom scores, care-plan/program status, grounding source,
  `Pause_Patient_Context_JSON__c`, etc.). The permission set above grants FLS on all
  of them; their `CustomField` definitions were retrieved to `/tmp` historically and
  have not been committed.
- The **Agent** itself: `Pause_Health_Intake_Agent` (`Bot` context variables +
  `GenAiPlannerBundle` topic/reasoning instructions + `GenAiPlugin`/`GenAiFunction`
  topics). The agent is authored in **Agent Builder (UI)**; its reasoning copy lives
  there. Paste-ready copy + the wiring steps are in
  [`docs/PHASE_3_RUNBOOK.md`](../docs/PHASE_3_RUNBOOK.md) and
  [`docs/AGENTFORCE_PROVIDER_ACTION_RUNBOOK.md`](../docs/AGENTFORCE_PROVIDER_ACTION_RUNBOOK.md).
- The `ExternalServiceRegistration` (`PauseProviderDirectory`) created in the org from
  `external-services/pause-provider-directory.oas.yaml`.

---

## Deploy

```bash
./deploy.sh                # → org alias 'trailsignup' (default)
./deploy.sh my-org-alias   # → some other authenticated org
```

This deploys only the members in `manifest/package.xml`. It works against
`trailsignup` because the broader dossier fields already exist there.

**Fresh org?** Run `./retrieve.sh` first (or deploy the dossier fields some other
way) — the permission set references ~21 fields, so deploying it before those
fields exist fails with undefined-field errors.

## Retrieve (make the repo the full source of truth)

```bash
./retrieve.sh              # pulls manifest/package-complete.xml from 'trailsignup'
```

Run this on a network that can reach `*.my.salesforce.com`, review the diff,
**strip XML comments from deployable files** (see the rule below), and commit.
This is the one step that closes the remaining Phase 18b gap.

---

## Gotchas (learned the hard way — see PHASE_3_RUNBOOK Phase 18d)

- **Keep deployable XML comment-free.** A stray `<!-- … -->` inside
  `Pause_Patient_Zip__c.field-meta.xml` once broke `sf project deploy start`
  with `Invalid XML tags. Found at: 'CustomField.description'` (fixed in commit
  `c7895a0`). Put explanations in this README, not in the metadata files.
- **MessagingChannel attachments.** `MessagingChannel` metadata has no element
  for "allowed file types", so any deploy with inbound attachments enabled fails
  validation: `The field value for Allowed file types can't be null or empty if
  Allow Inbound Files is enabled.` The channel here ships with
  `isAttachmentUploadEnabled = false` (intake never uses attachments); re-enable
  in the UI if a deployment needs them.
- **Re-Publish the Embedded Service Deployment.** Deploying the channel + hidden
  field is necessary but not sufficient — the Embedded Service Deployment must be
  re-Published in the UI (then ~5–15 min CDN propagation) before
  `setHiddenPrechatFields` values actually reach the routing Flow.

## Named Credential note

`Pause_Provider_API` is the **legacy no-authentication** Named Credential form —
the simplest deployable artifact for a public GET against
`https://pause-health.ai/api/mulesoft/providers`. Orgs that enforce the External
Credential model can instead create an External Credential (Authentication
Protocol = Custom, no principal) and a Named Credential that references it (see
`docs/AGENTFORCE_PROVIDER_ACTION_RUNBOOK.md`). When the live MuleSoft Experience
API is stood up, repoint `<endpoint>` at the gateway/CloudHub base URL and add
auth there.
