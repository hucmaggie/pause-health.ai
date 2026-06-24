# Agentforce Voice — Activation Runbook

**Status (last updated 2026-06-24):** seam shipped in commit `<see git log -- frontend/lib/agentforce-voice.ts>`. Audio round-trip is gated on Agentforce Contact Center licensing + a CCaaS partner instance.

This runbook is the procurement-and-activation checklist for promoting [/proposal/agentforce-voice](https://pause-health.ai/proposal/agentforce-voice) from `designed` to `prototype` to `shipped`. It assumes the deploy-side seam is already wired in main (it is — `lib/agentforce-voice.ts`, `/api/agentforce/voice/config`, `<AgentforceVoiceButton/>`).

## Why this doc exists separate from the proposal page

The proposal page is the investor-readable narrative. This runbook is the operator-readable checklist. They cover overlapping ground intentionally — a customer-org operator about to wire activation should not have to scrape through marketing prose to find the env-var names, and an investor reading the proposal page should not have to wade through CCaaS provisioning steps to understand the value prop.

## What Agentforce Voice actually is

Salesforce announced Agentforce Voice on **2025-10-13** as a native real-time speech pipeline that runs Agentforce subagents over phone, web, and mobile. On **2026-03-10** they shipped **Agentforce Contact Center**, the add-on to Agentforce Service that bundles the voice capabilities plus CCaaS partner integrations.

The product:
- Runs the **same Agentforce subagents** as the text channel — so the Find-a-Provider subagent, the Data 360 grounding query, the Care Router handoff all share one agent.
- Speaks **over phone (PSTN) via a CCaaS partner**: Amazon Connect, Five9, NiCE, or Vonage. Each ships its own contact-flow tooling that binds inbound calls to the Agentforce agent.
- Speaks **over the web** for "click-to-talk" experiences. The web surface is referenced on Salesforce's product page but, **as of 2026-06-24, the partner-web developer surface is sales-gated** — no public LWC, no published Agent API voice endpoint, no SDK index page that survives a curl. Expect this to change; revisit the public docs before activation.

What the seam in `lib/agentforce-voice.ts` is built for: the Salesforce-blessed pattern when those docs land. The CCaaS handshake parameters are partner-side (Amazon Connect Streams, Five9 Adapter SDK, etc.), so the wiring on the Pause side stays the same regardless of which partner the customer org buys.

Authoritative sources for the public claims above:
- https://www.salesforce.com/agentforce/voice/ — product page
- https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/ — GA announcement
- https://www.salesforce.com/news/stories/agentforce-contact-center-announcement/ — Contact Center launch (2026-03-10)

## Phase 0 — verify the seam is in this checkout

Before procuring anything, confirm the seam ships in your branch:

```bash
ls frontend/lib/agentforce-voice.ts
ls frontend/app/api/agentforce/voice/config/route.ts
ls frontend/components/agentforce-voice-button.tsx
ls frontend/app/proposal/agentforce-voice/page.tsx
```

All four must exist. If any are missing, you're on a branch that predates the seam — `git pull origin main`.

Smoke the API contract from a local dev server:

```bash
cd frontend
npm run dev &
curl -sS http://localhost:3000/api/agentforce/voice/config | jq .
# Expected with no env vars set:
# { "meta": { "_source": "designed", "_doc": "..." }, "status": "designed" }
```

If the response shape differs, the seam may have regressed; do NOT proceed.

## Phase 1 — procure (Salesforce + CCaaS)

These steps are **not engineering steps**. They produce the licensing + instance that Phase 2 wires.

### 1a. Buy or activate Agentforce Contact Center

Agentforce Contact Center is an add-on to Agentforce Service that includes the native voice capabilities. It went GA in the US and Canada on 2026-03-10. Path: Salesforce sales (your AE or `https://www.salesforce.com/form/agentforce/contact-us/`).

You need:
- Agentforce Service license on the org that hosts your Service Agent (the one whose deployment API name is in `NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME`).
- Agentforce Contact Center add-on on the same org.

### 1b. Pick a CCaaS partner and contract for an instance

Agentforce Voice on the phone leg runs through a CCaaS partner. Public list of compatible partners (as of the GA announcement):
- Amazon Connect
- Five9
- NiCE
- Vonage

Pause-Health.ai will default to **Amazon Connect** because its Streams client SDK has the most documented partner-web surface — but the seam supports any of the four; the `AGENTFORCE_VOICE_PROVIDER` env var picks which client SDK the button loads at activation time.

You need (Amazon Connect example):
- An Amazon Connect Instance.
- A claimed phone number routed by a Contact Flow.
- The Contact Flow configured to invoke the Salesforce Agentforce action (the Salesforce-Connect integration ships an Amazon Connect Lambda or Contact Block; check current Connect docs at activation).

### 1c. Bind the CCaaS contact flow to your Agentforce agent

The contact flow needs to route turns to your specific Agentforce Service Agent — the same deployment as the text chat (or a different one if you want voice and chat on different agents during pilot).

Note the resulting identifiers; you'll need them in Phase 2:
- **Provider name** (one of: `amazon-connect`, `five9`, `nice`, `vonage`).
- **Base URL** for the partner SDK. Amazon Connect: `https://<alias>.my.connect.aws`. Five9: `https://<region>.app.five9.com`.
- **Deployment ref** (CCaaS-side opaque id). Amazon Connect: Instance ID GUID. Five9: campaign reference.
- **Agent deployment**: the Agentforce Service Agent API name.

## Phase 2 — set the deploy-side env vars

Once the licensing and CCaaS instance exist, the deploy-side activation is six Vercel env vars (five required + one verification flag):

| Env var | Required | Example | Purpose |
|---|---|---|---|
| `AGENTFORCE_VOICE_PROVIDER` | yes | `amazon-connect` | One of: `amazon-connect`, `five9`, `nice`, `vonage`. |
| `AGENTFORCE_VOICE_BASE_URL` | yes | `https://pause.my.connect.aws` | Partner base URL. Must start with `https://`. |
| `AGENTFORCE_VOICE_DEPLOYMENT_REF` | yes | `12345abc-de67-89fa-bcde-f0123456789a` | CCaaS-side identifier resolving to your Agentforce-bound contact flow. |
| `AGENTFORCE_VOICE_AGENT_DEPLOYMENT` | yes | `Pause_Health_Intake_Agent` | Agentforce deployment the contact flow routes voice turns to. |
| `AGENTFORCE_VOICE_LANGUAGE` | optional | `en-US` | ASR + TTS locale. Defaults `en-US` when unset. |
| `AGENTFORCE_VOICE_VERIFIED` | optional | `true` | Promotes status from `prototype` to `shipped` after the operator records a verified end-to-end round-trip (Phase 4). |

Set them via the Vercel CLI:

```bash
cd frontend  # or repo root with a project linked at this level
vercel env add AGENTFORCE_VOICE_PROVIDER         production   # type: amazon-connect, then Enter
vercel env add AGENTFORCE_VOICE_BASE_URL         production   # https://<alias>.my.connect.aws
vercel env add AGENTFORCE_VOICE_DEPLOYMENT_REF   production
vercel env add AGENTFORCE_VOICE_AGENT_DEPLOYMENT production
# Optional:
vercel env add AGENTFORCE_VOICE_LANGUAGE         production   # en-US
```

Then trigger a redeploy so the env reaches the running code:

```bash
vercel --prod --yes
```

## Phase 3 — confirm the status flip

After the deploy is `Ready`:

```bash
curl -sS https://pause-health.ai/api/agentforce/voice/config | jq .
# Expected:
# {
#   "meta": { "_source": "prototype", "_doc": "..." },
#   "status": "prototype",
#   "provider": "amazon-connect",
#   "agentDeployment": "Pause_Health_Intake_Agent",
#   "language": "en-US"
# }
```

Then visit https://pause-health.ai/proposal/agentforce-voice in a browser. The launch button now:
- Renders enabled with a `prototype` pill.
- Names the configured CCaaS provider in the help text.
- On click, surfaces a "verification pending" toast (the real handshake is wired during Phase 4 below).

If you see `status: "designed"` here, the env vars didn't reach this deployment. Re-check `vercel env ls production` and confirm you ran `vercel --prod --yes` AFTER setting them.

## Phase 4 — wire the CCaaS partner SDK + verify

This is where the audio round-trip lands. The work is partner-specific; the Pause seam is partner-agnostic. Steps for the Amazon Connect default:

1. Implement the Amazon Connect Streams handshake inside `<AgentforceVoiceButton/>`'s `handleLaunch` (replacing the current "verification pending" toast). The handshake sequence is documented in the Amazon Connect Streams SDK; the values you'll need from `AgentforceVoicePublicConfig` are `provider`, `agentDeployment`, and `language`. The opaque `baseUrl`/`deploymentRef` stay server-side; the client gets a short-lived signed URL via a new `POST /api/agentforce/voice/session` route that mints the STS token. (That route is **not** in this commit's scope — write it during Phase 4 alongside the SDK wiring.)

2. Add a smoke that proves the round-trip:
   - User clicks the button.
   - Browser captures mic, ships audio to Amazon Connect over WebRTC.
   - Connect contact flow routes to Agentforce.
   - Agentforce returns synthesized speech.
   - Browser plays back the response.

3. Record the verified session — note the date, the agent deployment, the CCaaS instance, and a one-paragraph transcript in `docs/AGENTFORCE_VOICE_REAL_RUN_<YYYY-MM-DD>.md` (mirroring `docs/JHE_REAL_RUN_2026-06-16.md`).

4. Flip the verified flag:

```bash
vercel env add AGENTFORCE_VOICE_VERIFIED production   # true
vercel --prod --yes
```

5. Confirm:

```bash
curl -sS https://pause-health.ai/api/agentforce/voice/config | jq .status
# Expected: "shipped"
```

The proposal page pill now flips to `shipped`. Ship a changelog entry referencing the activation commit, the transcript doc, and the partner used.

## Rollback

If anything in Phase 2–4 goes wrong, the rollback is **always** safe — the seam degrades to `designed` when the env vars are unset:

```bash
vercel env rm AGENTFORCE_VOICE_PROVIDER         production
vercel env rm AGENTFORCE_VOICE_BASE_URL         production
vercel env rm AGENTFORCE_VOICE_DEPLOYMENT_REF   production
vercel env rm AGENTFORCE_VOICE_AGENT_DEPLOYMENT production
vercel env rm AGENTFORCE_VOICE_LANGUAGE         production   # if you set it
vercel env rm AGENTFORCE_VOICE_VERIFIED         production   # if you set it
vercel --prod --yes
```

After the redeploy, `/api/agentforce/voice/config` returns `status: "designed"` and the proposal page button reverts to its disabled state with the activation-plan copy. The text-chat surface is untouched throughout — voice and chat are independent env-var contracts.

## Known unknowns

Things this runbook deliberately does NOT promise, because Salesforce's public docs don't promise them yet:

- **The exact partner-web SDK call**. The Salesforce-blessed pattern for embedding Agentforce Voice on a non-Salesforce site is sales-gated as of 2026-06-24. The seam mounts whichever client SDK the operator chooses; the Streams-style handshake outlined in Phase 4 is the documented Amazon Connect pattern, not necessarily the Salesforce-curated one.
- **The Connected App / OAuth scope names** specific to the voice surface. The chat surface uses four `NEXT_PUBLIC_AGENTFORCE_*` env vars (all public; no secrets); the voice surface may require server-side credentials via an additional Connected App. Re-check Salesforce's help docs at activation time before Phase 4.
- **PSTN-leg test plan**. The seam covers the web-leg activation. A phone-leg pilot (after-hours call routing) is a separate sequence — book a number with the CCaaS partner, point the contact flow at the same Agentforce agent, dial in. Not in scope for this runbook.

When any of these gates lifts, update this runbook in the same PR that turns them into shipped code.
