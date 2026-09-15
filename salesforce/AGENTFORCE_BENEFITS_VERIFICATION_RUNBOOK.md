# Runbook: Benefits & Coverage Verification Agentforce agent

Builds the **Benefits & Coverage Verification (EBV)** fabric agent as a native
Agentforce agent in the `trailsignup` org — the first agent in the
[AGENTFORCE_FABRIC_AGENTS_SCOPE.md](./AGENTFORCE_FABRIC_AGENTS_SCOPE.md) set, and
the reusable template for #2–#5.

**Backing endpoint:** `GET https://pause-health.ai/api/agentforce/benefits-verification`
— a flat REST alias over the A2A EBV agent (same deterministic `verifyCoverage`
+ same Agent Fabric governance gate). Synthetic; not a real 270/271 or FHIR call.

`sf` runs from **your terminal** (it can't run in the Claude sandbox). Repo-tracked
metadata deploys via `./deploy.sh`; the reasoning copy is authored in Agent Builder
(UI) and mirrored below.

---

## 1. Register the External Service (from the OAS)

The OAS is committed at
`salesforce/external-services/pause-benefits-verification.oas.yaml`.

In the org: **Setup → External Services → Add** →
- Service name: `PauseBenefitsVerification`
- Named Credential: `Pause_Provider_API` (reuse the existing no-auth credential;
  endpoint `https://pause-health.ai`)
- Schema: upload `pause-benefits-verification.oas.yaml`
- Save → confirm the `verifyBenefits` operation is imported.

(No new Named Credential needed — the alias is on the same host as the provider
directory.)

## 2. Add the action to a topic

In **Agentforce Studio → Agents**, on the target agent (either the existing
**Pause Health Intake Agent** as a new topic, or a new **Benefits & Coverage**
agent cloned from it):

- Topic: **Benefits & Coverage**
- Action: **verifyBenefits** (from the `PauseBenefitsVerification` External
  Service).
- Input mapping:
  - `payer` ← bot context var `Pause_Patient_Insurance` (already handed in-band
    via the prechat dossier — see the intake stack in `README.md`), else ask the
    patient for their plan.
  - `zip` ← `Pause_Patient_Zip` (optional).
  - `memberId`, `serviceType` — leave unmapped (optional).
- Output: map `eligibilityStatus`, `network`, `payerName`, `planName`,
  `deductibleRemaining`, `coinsuranceRate`, `copay`,
  `estimatedPatientResponsibility`, `ebvTransactionId`, `sourced`, `blocked`.

## 3. Reasoning copy (paste-ready)

**Topic classification description:**
> Use this topic when the patient asks whether a menopause specialist visit is
> covered, what it will cost, their copay/coinsurance/deductible, or whether a
> provider is in-network for their insurance plan.

**Topic instructions:**
> Call verifyBenefits with the patient's insurance plan (payer) and ZIP when
> known. If the response has blocked=true, tell the patient you can't verify
> coverage right now and briefly why (e.g. missing consent) — do NOT invent
> coverage numbers. Otherwise, state plan status (active/inactive), whether the
> specialist is in-network, the estimated patient out-of-pocket, and the
> remaining deductible. Always say the estimate is based on synthetic/mock
> eligibility data and is not a guarantee of coverage; tell the patient to
> confirm with their plan. Never present dollar amounts as final or promise
> payment. If sourced is false, do not state coverage as verified.

## 4. Governance note (already enforced server-side)

The alias runs the fabric governance gate: coverage verification is
consent-gated (`policy.data360.consent-required-before-grounding`) and must
trace to an EBV source (`policy.benefits.eligibility-source-integrity`). A
blocked call returns `{blocked:true, violations:[…]}` with NO coverage fields —
the topic instruction above tells the agent to surface that honestly rather than
fabricate. No Agentforce-side policy config is required for this.

## 5. Test

- **Tests tab**: add utterances → expected action `verifyBenefits`:
  - "Is a menopause specialist covered by my Aetna plan?" → verifyBenefits(payer=Aetna)
  - "What will the visit cost with Humana?" → verifyBenefits(payer=Humana) → out-of-network framing
- **Server-side** (already green): `npx vitest run app/api/agentforce/benefits-verification/route.test.ts`
  covers in-network, out-of-network, determinism, and the consent-block path.

## 6. Deploy the repo-tracked bits

Only the OAS is a new repo artifact for this agent; the Named Credential already
exists. If you add any new tracked metadata (e.g. a dedicated permission set),
add it to `manifest/package.xml` and run:

```bash
cd salesforce && ./deploy.sh trailsignup
```

The agent (`Bot`/`GenAiPlannerBundle`) itself is authored in Agent Builder (UI);
mirror its final reasoning copy back into §3 so the repo stays the source of truth.

---

## Template for agents #2–#5

Repeat this runbook with the matching alias + OAS:

| Agent | Alias to add | OAS |
|---|---|---|
| Member Service · Billing & Coverage | `/api/agentforce/member-service` | `pause-member-service.oas.yaml` |
| Appointment Scheduling | `/api/agentforce/appointment-scheduling` | `pause-appointment-scheduling.oas.yaml` |
| Care Router | `/api/agentforce/care-router` | `pause-care-router.oas.yaml` |
| SDOH Screening (stretch) | `/api/agentforce/sdoh-screening` | `pause-sdoh-screening.oas.yaml` |

Each: add a thin REST alias over the A2A `/tasks` endpoint (reusing the agent's
lib fn + governance gate, as `benefits-verification/route.ts` does), a lean OAS,
an External Service registration, a topic + action, reasoning copy, and tests.
