# Agentforce provider-action runbook

How to make the live `Pause_Health_Intake_Agent` answer "find me a menopause
specialist" by calling the Pause provider directory, instead of deflecting with
generic advice.

## Why the agent deflects today

The live agent is a generic intake-only Service Agent. It has **no action**
wired to the Pause provider graph, so when a patient asks to find a provider it
has nothing to invoke and either returns the no-match fallback or answers from
general world knowledge. The capability exists and is public —
`GET https://pause-health.ai/api/mulesoft/providers` (the NPPES-derived
directory from `provider_ingest`, or the live MuleSoft Experience API when
`MULESOFT_PROVIDERS_BASE_URL` is set) — it's just not connected to Agentforce.

This runbook wires it via **External Services + a Named Credential + a new
agent topic**. No Apex required (the endpoint is a public, no-auth GET).

## What you'll build

```
Named Credential (Pause_Provider_API → https://pause-health.ai)
        │
        ▼
External Service (from pause-provider-directory.oas.yaml)
        │  generates invocable action: findMenopauseProviders
        ▼
Agent topic "Find a Provider"  →  references the action
        │
        ▼
Pause_Health_Intake_Agent  (deactivate → deploy → activate)
```

Repo artifacts (already authored):
- OpenAPI spec: `salesforce/external-services/pause-provider-directory.oas.yaml`
- Named Credential: `salesforce/named-credentials/Pause_Provider_API.namedCredential-meta.xml`

---

## Step 1 — Named Credential

Goal: a callable base URL for the provider endpoint.

**Option A — deploy the repo metadata (legacy, no-auth, simplest):**

```bash
sf project deploy start \
  --source-dir salesforce/named-credentials/Pause_Provider_API.namedCredential-meta.xml \
  --target-org trailsignup
```

**Option B — create it in the UI** (Setup → Named Credentials → New):
- Label / Name: `Pause Provider API` / `Pause_Provider_API`
- URL: `https://pause-health.ai`
- Identity Type: Anonymous · Authentication Protocol: No Authentication
- Generate Authorization Header: unchecked

**Option C — new External Credential model** (if your org blocks legacy no-auth
Named Credentials): create an External Credential `Pause_Provider_API_Cred`
with Authentication Protocol = **Custom** and a Named Principal with no
parameters, then a Named Credential `Pause_Provider_API` (URL
`https://pause-health.ai`) referencing it, with "Generate Authorization Header"
off. Grant the agent's running user access to the External Credential principal
via a permission set.

Verify the host is reachable:

```bash
curl -s "https://pause-health.ai/api/mulesoft/providers?zip=92614&menopause=true&limit=3" | jq '.total, .providers[].name'
```

---

## Step 2 — Register the External Service

Setup → **External Services** → New → **From API Specification**.

- Service Name: `PauseProviderDirectory`
- Named Credential: `Pause_Provider_API` (from Step 1)
- Service Schema: **Upload from local** →
  `salesforce/external-services/pause-provider-directory.oas.yaml`
- Save. Salesforce parses the spec and generates one invocable operation:
  **`findMenopauseProviders`** with inputs `zip` / `menopause` / `limit` and a
  structured output (`total`, `returned`, `providers[]`).

If the parser complains, it's almost always an unsupported OpenAPI feature —
the spec is deliberately lean (OpenAPI 3.0, primitive types, no `$ref`,
`oneOf`, `nullable`, or auth blocks) to avoid this. Don't re-add those.

---

## Step 3 — Add a "Find a Provider" topic + action to the agent

Setup → **Agentforce Agents** → `Pause_Health_Intake_Agent` → open in the
builder. (Deactivate first if the builder requires it — see Step 5.)

1. **New Topic**
   - Label: `Find a Provider`
   - Classification description: *"The patient wants to find, locate, or be
     referred to a menopause specialist, MSCP-credentialed clinician, OB/GYN,
     or endocrinologist — including questions like 'which healthcare
     professional', 'find a provider near me', or 'who should I see'."*
   - Scope: *"Help the patient find a menopause-credentialed provider using the
     Pause provider directory. Do not give generic 'see your PCP' advice when
     this topic applies."*

2. **Add Action → API (External Service)** → select
   `PauseProviderDirectory.findMenopauseProviders`.
   - Input `menopause`: set a **fixed value `true`** (always prefer
     MSCP-credentialed clinicians).
   - Input `limit`: fixed value `3`.
   - Input `zip`: map from a conversation variable the agent collects (see
     Step 4). Mark optional — the action works without it (returns top
     national matches).

3. **Topic instructions** (paste):

   > When the patient asks to find or be referred to a provider, first ask for
   > their 5-digit ZIP code if you don't already have it, then call
   > findMenopauseProviders with that zip and menopause=true. Present up to
   > three providers by name, specialty, city/state, and whether they offer
   > telehealth or are accepting new patients. If no ZIP is given, call the
   > action without it and say these are top menopause specialists nationally.
   > Never invent providers — only return what the action gives you. If the
   > action returns none, point the patient to The Menopause Society directory.

4. **Example utterances** for the topic classifier: "which healthcare
   professional?", "find a provider that specializes in menopause", "who should
   I see for menopause?", "is there a menopause specialist near 92614?", "find
   me an OB/GYN".

---

## Step 4 — Getting the patient's ZIP to the action

The embedded V2 SDK's `prechatAPI` is a no-op in this org (see
`docs/PHASE_3_RUNBOOK.md`), so the per-patient dossier — including the ZIP we
now capture at intake — is **not** handed to the agent in-band. Until that's
resolved, the agent should **ask the patient for their ZIP** in the topic
instructions (Step 3 already does this). The geo-narrowing then works from the
patient's typed answer. The action is fully functional without a ZIP too; it
just returns top national matches.

(If/when the Flow path populates a `MessagingSession` field with the ZIP, map
that to the `zip` input instead of asking.)

---

## Step 5 — Test, then activate

1. **Builder preview / "Conversation Preview":** type "find a provider near
   92614". Confirm the agent calls `findMenopauseProviders` (you'll see the
   action invocation) and names real providers (e.g. the 926-prefix MSCP
   clinicians).
2. **Activate:** Agentforce requires deactivate → save → **activate** to push
   topic/action changes live (same cycle as `docs/PHASE_3_RUNBOOK.md`).
3. **Live embed:** reload `/demo/intake`, open the chat, ask the same question.
   It should now return local specialists instead of "reach out to your PCP."

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| External Service won't parse the spec | An unsupported OpenAPI feature was added | Keep the spec lean (no `$ref`/`oneOf`/`nullable`/auth); re-upload the repo copy |
| Action returns 401/403 | Named Credential has auth turned on, or pointed at the gated MuleSoft URL | For the public endpoint use No Authentication; for MuleSoft add the JWT there |
| Agent still deflects | Topic not activated, or classifier didn't match | Re-activate; add more example utterances; tighten the classification description |
| Action runs but agent invents providers | Instructions not enforced | Re-paste the "Never invent providers — only return what the action gives you" instruction |
| No local results for a ZIP | That ZIP prefix has no provider in the directory | Expected with the demo fixture; run `provider_ingest` against the national NPPES file for full coverage |
| Agent never has the ZIP | prechat is a no-op (known) | Agent asks the patient for it (Step 4) |

---

## When the live MuleSoft API replaces the public endpoint

Repoint the Named Credential `endpoint` at the gateway/CloudHub base and add the
bearer/JWT auth there (the gateway already enforces Auth0 JWT + rate limiting).
The External Service, action, topic, and agent need no change — same contract,
same operation. Set `MULESOFT_PROVIDERS_BASE_URL` on the Next app so the public
`/api/mulesoft/providers` also proxies live, keeping both paths shape-identical.
