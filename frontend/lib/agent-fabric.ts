/**
 * Pause Agent Fabric -- in-memory mock of the MuleSoft Agent Fabric
 * control plane.
 *
 * What MuleSoft Agent Fabric provides in production (announced
 * Dreamforce 2025, GA early 2026):
 *
 *   1. Agent registry -- discoverable catalog of every agent operating
 *      on the customer's Anypoint Platform (Agentforce Service Agents,
 *      partner LLM agents, MCP servers, A2A-speaking agents).
 *   2. Policy enforcement -- per-agent governance (model allow-list,
 *      PHI handling, rate limits, data residency, identity).
 *   3. Observability -- end-to-end trace correlation across agents,
 *      with each tool call and A2A handoff recorded as a span.
 *   4. Security -- identity-based access control between agents,
 *      OAuth / mTLS, secret vault.
 *
 * The prototype mocks (1), (2), and (3) with deterministic in-memory
 * state. (4) is documented in the investor page but not enforced --
 * the prototype is open by default.
 *
 * Persistence model:
 *   The trace ring buffer lives in a module-scoped global so it
 *   survives Next.js dev-mode hot reload AND every API route in the
 *   same Node process sees the same state. In production this becomes
 *   a Redis-backed log shipped to the customer's observability stack.
 */

import { nowIso } from "./a2a";
import { emitSpanEvent } from "./salesforce-platform-event-sink";
import {
  BOOLEAN_BLOCK_SIGNALS,
  MODEL_ALLOWLIST_POLICY_ID,
  type GovernanceTask
} from "./governance-signals";
import type { GovernanceTier } from "./governance-tiers";

export type { GovernanceTask };

export type AgentRecord = {
  id: string;
  name: string;
  kind:
    | "agentforce"
    | "anthropic-claude"
    | "mcp-server"
    | "mcp-bridge"
    | "mulesoft-process"
    | "salesforce-data-360";
  protocol: "a2a" | "mcp" | "rest";
  endpoint: string;
  version: string;
  status: "healthy" | "degraded" | "offline" | "prototype";
  capabilities: string[];
  policies: string[];
  provider: string;
  governanceTier: GovernanceTier;
};

export type PolicyRecord = {
  id: string;
  name: string;
  description: string;
  appliesTo: string[];
  enforcement: "block" | "audit" | "rate-limit" | "redact";
  status: "enforced" | "advisory" | "draft";
};

export type TraceSpan = {
  id: string;
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  agentName: string;
  operation: string;
  protocol: "a2a" | "mcp" | "rest" | "internal";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "ok" | "error" | "in-progress";
  attributes?: Record<string, unknown>;
};

/**
 * Agent seed — everything about an agent EXCEPT its governance policy set.
 *
 * An agent's policies are NOT hand-listed here. They are derived from the
 * single source of truth, `POLICIES[].appliesTo`, via getPoliciesForAgent().
 * Maintaining a second per-agent copy drifted badly: it under-listed several
 * agents (e.g. the Care Router omitted the consent, red-flag, and HIPAA-audit
 * policies it actually enforces) and even referenced a policy id that doesn't
 * exist. listAgents()/getAgent() now attach the derived list so the registry,
 * the Agent Card, and the governance engine can never disagree.
 */
type AgentSeed = Omit<AgentRecord, "policies">;

const REGISTRY: AgentSeed[] = [
  {
    id: "agentforce-intake",
    name: "Agentforce Service Agent · Patient Intake",
    kind: "agentforce",
    protocol: "a2a",
    endpoint: "salesforce://agentforce/pause-intake@v2",
    version: "2.1.0",
    status: "prototype",
    capabilities: [
      "Symptom capture (vasomotor, sleep, mood, cognition, GSM, bleeding)",
      "Red-flag screening",
      "Structured intake record persistence",
      "Hands captured task off to Care Router via Google A2A"
    ],
    provider: "Salesforce",
    governanceTier: "patient-facing"
  },
  {
    id: "care-router-claude",
    name: "Pause Care Router · Claude Sonnet 4.5",
    kind: "anthropic-claude",
    protocol: "a2a",
    endpoint: "/api/agents/care-router",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Clinical pathway routing (6 pathways)",
      "Red-flag escalation logic",
      "Premature ovarian insufficiency rule (<40 with menopause symptoms)",
      "Returns rationale + provenance with every decision"
    ],
    provider: "Anthropic + Pause-Health.ai",
    governanceTier: "clinical-decision"
  },
  {
    id: "pause-mcp",
    name: "Pause MCP Server",
    kind: "mcp-server",
    protocol: "mcp",
    endpoint: "@pause-health/mcp via stdio",
    // Must track SERVER_VERSION in lib/mcp/tools.ts (the version the MCP
    // server actually reports on `initialize`, on both the stdio and
    // Streamable HTTP transports). Pinned by lib/mcp/registry-parity.test.ts.
    version: "0.3.0",
    status: "prototype",
    capabilities: [
      "get_patient_timeline (FHIR R5 Bundle)",
      "get_patient_intake (structured Agentforce record)",
      "find_menopause_providers (provider graph slice)",
      "experience_api_health (liveness)"
    ],
    provider: "Pause-Health.ai",
    governanceTier: "data-plane"
  },
  {
    id: "mcp-bridge",
    name: "Pause MCP Bridge · A2A ↔ MCP egress",
    kind: "mcp-bridge",
    protocol: "mcp",
    // Not a wire endpoint: the bridge is a per-request MCP host constructed
    // in-process by the Care Router (lib/mcp/host.ts). Its remotes resolve
    // from env: the same-origin loopback (/api/mcp) plus allow-listed
    // externals in PAUSE_MCP_HOST_REMOTES.
    endpoint: "pause://agent-fabric/mcp-bridge → {loopback /api/mcp, PAUSE_MCP_HOST_REMOTES[]}",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Bridges fabric agents (A2A) onto external MCP tool servers via a per-request MCP host — the outbound complement to the inbound Pause MCP Server",
      "Fans out a tool call across an ordered remote list (same-origin loopback first, then allow-listed externals) and returns the first success",
      "Forwards an inbound bearer token ONLY to the same-origin loopback remote — never to a cross-origin external MCP server",
      "Falls back to the direct Experience-API call when no remote is configured or every remote errors, so routing never regresses",
      "Env-gated (PAUSE_MCP_HOST_ENABLED); off by default in the prototype"
    ],
    provider: "Pause-Health.ai",
    governanceTier: "integration"
  },
  {
    id: "mulesoft-ingest",
    name: "MuleSoft Process API · pause-ingest-process-api",
    kind: "mulesoft-process",
    protocol: "rest",
    endpoint: "https://anypoint.example.com/pause-ingest/v1",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Validates Open mHealth payloads",
      "Transforms OMH -> FHIR R5 via DataWeave",
      "POSTs to JupyterHealth Exchange",
      "Triggers DBDP feature compute"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "integration"
  },
  {
    id: "salesforce-data-360",
    name: "Salesforce Data 360 · Unified Patient Grounding",
    kind: "salesforce-data-360",
    protocol: "rest",
    endpoint: "/api/data-360",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Zero-copy federated query across JupyterHealth FHIR, DBDP features, Agentforce intake history, and the customer EHR-of-record",
      "Calculated Insights (30-day HRV z-score, vasomotor burden index, sleep disruption, days since MSCP contact)",
      "Identity Resolution with confidence scoring across federated sources",
      "Population Segments activated to Agentforce, the Agent Fabric, and Health Cloud"
    ],
    provider: "Salesforce",
    governanceTier: "data-grounding"
  },
  {
    id: "prospecting-agent",
    name: "Agentforce Prospecting & Nurture Agent · Menopause Outreach",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce-hosted Agentforce agent:
    // POST /api/agents/prospecting/tasks (card at /.well-known/agent.json).
    endpoint: "/api/agents/prospecting",
    version: "1.1.0",
    status: "prototype",
    capabilities: [
      "Consumes Data 360 population segments as prospect audiences (e.g., the 40-60 vasomotor-burden cohort)",
      "Scores and warms leads across a multi-touch nurture cadence, advancing only prospects who engage",
      "Drafts consent-aware outreach and nurture touches (email / SMS) via Marketing Cloud for human review — never sends autonomously",
      "Suppresses prospects without contact consent, and drops anyone from active sequences the moment they convert or opt out",
      "Hands a sufficiently-warmed prospect onward for qualification and intake via Google A2A"
    ],
    provider: "Salesforce",
    governanceTier: "patient-acquisition"
  },
  {
    id: "inbound-lead-agent",
    name: "Agentforce Inbound Lead Generation · Site & Chat",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce-hosted Agentforce agent:
    // POST /api/agents/inbound-lead/tasks (card at /.well-known/agent.json).
    endpoint: "/api/agents/inbound-lead",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Captures inbound interest from the marketing site, Agentforce web chat, and content/symptom-check forms",
      "Runs a first-pass ICP screen (age band, symptom signals, geography / insurance fit) and scores initial readiness",
      "Creates an opt-in-consented lead in Data 360 with acquisition-source attribution, resolved against existing patients/prospects to avoid duplicates",
      "Hands the captured lead to the Qualification agent for the authoritative qualified/disqualified call — over Google A2A"
    ],
    provider: "Salesforce",
    governanceTier: "patient-acquisition"
  },
  {
    id: "qualification-agent",
    name: "Agentforce Qualification · Lead Scoring & Routing",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce-hosted Agentforce agent:
    // POST /api/agents/qualification/tasks (card at /.well-known/agent.json).
    endpoint: "/api/agents/qualification",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Applies a consistent qualification rubric (menopause-care fit + eligibility + expressed intent/readiness) to inbound and outbound leads alike",
      "Produces a qualified / disqualified decision with human-readable rationale on every lead",
      "Routes qualified-and-ready leads to Patient Intake and qualified-but-warming leads into the Prospecting & Nurture cadence, over Google A2A",
      "Excludes protected-class attributes from qualification criteria; disqualifications are logged for human review"
    ],
    provider: "Salesforce",
    governanceTier: "lead-qualification"
  },
  {
    id: "engagement-agent",
    name: "Agentforce Engagement Agent · Care Continuity",
    kind: "agentforce",
    protocol: "a2a",
    endpoint: "salesforce://agentforce/pause-engagement@v1",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Re-engages enrolled patients with symptom check-ins and care-plan adherence nudges",
      "Schedules follow-up touchpoints from the Care Router's pathway output",
      "Respects quiet-hours, channel preference, and frequency caps sourced from Data 360",
      "Escalates disengagement or emerging-risk signals back to the Care Router"
    ],
    provider: "Salesforce",
    governanceTier: "patient-engagement"
  },
  {
    id: "pipeline-management-agent",
    name: "Agentforce Pipeline Management · Provider-Org Deals",
    kind: "agentforce",
    protocol: "a2a",
    endpoint: "salesforce://agentforce/pause-pipeline@v1",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Manages the B2B opportunity pipeline for provider-organization, health-system, and employer deals in Sales Cloud",
      "Tracks stage progression, deal health, and next-best-action; flags stalled or at-risk opportunities",
      "Rolls up committed / best-case / pipeline forecasts — every figure traces back to CRM opportunity records, never fabricated",
      "Operates only on the commercial CRM plane; has no access to patient PHI or the clinical plane"
    ],
    provider: "Salesforce",
    governanceTier: "commercial-operations"
  },
  {
    id: "account-management-agent",
    name: "Agentforce Account Management · Customer Success",
    kind: "agentforce",
    protocol: "a2a",
    endpoint: "salesforce://agentforce/pause-accounts@v1",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Manages signed provider-organization and employer accounts post-close: health scoring, renewals, and expansion",
      "Surfaces usage / adoption signals and drafts renewal & QBR materials for the account team's review",
      "Flags churn risk and expansion opportunities; never commits a contract or pricing change without a human account owner",
      "Operates only on the commercial CRM plane; has no access to patient PHI or the clinical plane"
    ],
    provider: "Salesforce",
    governanceTier: "commercial-operations"
  },
  {
    id: "assessment-agent",
    name: "Agentforce Assessment Agent · Validated Instruments",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health —
    // Assessments" agent: POST /api/agents/assessment/tasks (card at
    // /.well-known/agent.json). Scoring is deterministic real math (no LLM).
    endpoint: "/api/agents/assessment",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Administers and deterministically scores validated menopause & mental-health instruments (MRS, Greene Climacteric Scale, PHQ-9, ISI) — real cutoff-based math, no LLM",
      "Returns per-instrument subscores, a total, and a severity band normalized onto IntakeRecord's mild/moderate/severe vocabulary",
      "Screens red-flag items (e.g. PHQ-9 item 9 self-harm ideation) and escalates them explicitly",
      "Feeds the scored severity into IntakeRecord.severity so the Care Router decision is backed by a validated instrument rather than a self-report",
      "Refuses to administer or score any instrument outside the validated allow-list"
    ],
    provider: "Salesforce",
    governanceTier: "patient-facing"
  },
  {
    id: "benefits-verification-agent",
    name: "Agentforce Benefits & Coverage Verification · Eligibility (EBV)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health —
    // Eligibility & Benefit Verification" agent: POST
    // /api/agents/benefits-verification/tasks (card at
    // /.well-known/agent.json). The eligibility result is a DETERMINISTIC
    // synthetic EBV round-trip — clearly labeled synthetic, no real EDI/FHIR.
    endpoint: "/api/agents/benefits-verification",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Verifies a patient's insurance eligibility & benefits for a menopause specialist (MSCP) visit — the Salesforce 'Agentforce for Health — Eligibility & Benefit Verification' analog",
      "Returns a structured coverage result: plan status (active/inactive), in/out-of-network, deductible + amount met, coinsurance/copay, and an estimated visit cost + patient out-of-pocket",
      "Runs a DETERMINISTIC synthetic EBV round-trip (mock payer/clearinghouse 270/271) — clearly labeled synthetic; not a real EDI transaction or FHIR eligibility call",
      "Every returned coverage result must trace to a (mock) payer/clearinghouse EBV response — the agent may not fabricate coverage without a source",
      "Feeds the eligibility summary into the intake → Care Router spine so a real coverage check can precede routing"
    ],
    provider: "Salesforce",
    governanceTier: "benefits-verification"
  },
  {
    id: "appointment-scheduling-agent",
    name: "Agentforce Appointment Scheduling · Book/Reschedule (MSCP)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health —
    // Book/Reschedule/Update Appointment" agent: POST
    // /api/agents/appointment-scheduling/tasks (card at
    // /.well-known/agent.json). Bookings resolve against a DETERMINISTIC
    // synthetic provider calendar — clearly labeled synthetic, no real
    // Salesforce Scheduler / ServiceAppointment write.
    endpoint: "/api/agents/appointment-scheduling",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Books (and reschedules) the MSCP menopause-specialist visit the Care Router recommends — the Salesforce 'Agentforce for Health — Book/Reschedule/Update Appointment' analog",
      "Honors the requested modality (telehealth / in-person) against a deterministic synthetic provider availability calendar",
      "Returns a structured booking: a synthetic ServiceAppointment id, the confirmed slot start/end, modality, provider, and status (booked / rescheduled)",
      "Runs against a DETERMINISTIC MOCK calendar (hashed provider + date → stable open slots) — clearly labeled synthetic; not a real Salesforce Scheduler / ServiceAppointment write",
      "Never double-books an already-taken slot and only books within the provider's published availability — both enforced at the Agent Fabric governance boundary",
      "Hands the booked appointment to the Engagement Agent for visit reminders — closing the acquisition → intake → routing → booking → engagement loop"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "care-gap-closure-agent",
    name: "Agentforce Care Gap Closure · Preventive Care (Health Cloud)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" /
    // Health Cloud care-gap-closure agent: POST
    // /api/agents/care-gap-closure/tasks (card at /.well-known/agent.json).
    // Gap detection is DETERMINISTIC and grounded on the synthetic Data 360
    // context; the clinical measures + intervals are illustrative synthetic
    // values, NOT a certified clinical guideline engine.
    endpoint: "/api/agents/care-gap-closure",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Proactively detects menopause-relevant preventive-care gaps — bone-density/DEXA (osteoporosis risk), lipid panel, screening mammogram, and overdue HRT follow-up — grounded on the patient's Data 360 context + age/cycle/symptom signals",
      "Detection is DETERMINISTIC (a pure function of an explicit as-of date + per-measure history; no randomness, no clock) — the same context always yields the same gaps",
      "Every detected gap references a defined clinical-measure catalog id (open/overdue, dueSince/lastDone, priority) — never a fabricated gap; enforced at the Agent Fabric governance boundary",
      "Drafts consent- and quiet-hours-aware outreach for each gap (human-approval-gated, never auto-sent) and hands it to the Engagement Agent for delivery",
      "Runs against ILLUSTRATIVE synthetic clinical measures + intervals — clearly labeled; NOT a certified clinical guideline engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-gap"
  },
  {
    id: "care-plan-agent",
    name: "Pause Care Plan · Claude Sonnet 4.5",
    kind: "anthropic-claude",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" /
    // Health Cloud CarePlan + care-plan-summarization agent: POST
    // /api/agents/care-plan/tasks (card at /.well-known/agent.json). A
    // clinical-plane sibling of the Care Router and the SECOND live-Claude
    // agent: plan instantiation is DETERMINISTIC (a defined template fill), and
    // the progress summary is a live Claude call with a deterministic scripted
    // fallback (same model + allow-list as the Care Router).
    endpoint: "/api/agents/care-plan",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Instantiates a menopause care plan (goals, interventions, follow-up cadence) DETERMINISTICALLY from a defined CarePlanTemplate, selected by the Care Router's pathway/severity + intake — the Salesforce 'Agentforce for Health' / Health Cloud CarePlan analog",
      "Every instantiated plan references a defined care-plan template id (open/structured goals + interventions + cadence) — never a fabricated plan; enforced at the Agent Fabric governance boundary",
      "Generates a concise patient/clinician progress SUMMARY with live Anthropic Claude — the SECOND live-Claude agent after the Care Router — falling back to a DETERMINISTIC scripted summary (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails",
      "Summaries are NON-PRESCRIPTIVE: they report the existing plan's goals/interventions/cadence and never add or change a medication, dose, order, or prescription",
      "Runs against ILLUSTRATIVE synthetic care-plan templates — clearly labeled; NOT a certified clinical care-plan engine"
    ],
    provider: "Anthropic + Pause-Health.ai",
    governanceTier: "clinical-decision"
  },
  {
    id: "medication-adherence-agent",
    name: "Agentforce Medication Adherence · HRT/SSRI Refill & Adherence (Health Cloud)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" /
    // Health Cloud MedicationRequest + MedicationTherapyReview agent: POST
    // /api/agents/medication-adherence/tasks (card at /.well-known/agent.json).
    // Adherence + refill-timing detection is DETERMINISTIC (a pure function of
    // an explicit as-of date + per-med fill history); the medication catalog +
    // days-supply/refill intervals are illustrative synthetics, NOT a certified
    // pharmacy / e-prescribing system. CRITICAL: it can only NUDGE — it never
    // autonomously submits/orders a refill (that requires human approval).
    endpoint: "/api/agents/medication-adherence",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Tracks menopause-medication adherence + refill timing — transdermal/oral HRT (estradiol, oral progesterone) and an SSRI/SNRI for vasomotor symptoms / mood (paroxetine, venlafaxine) — the Salesforce 'Agentforce for Health' / Health Cloud MedicationRequest + MedicationTherapyReview analog",
      "Detection is DETERMINISTIC (a pure function of an explicit as-of date + per-medication days-supply and last-fill; no randomness, no clock) — the same inputs always yield the same good / at-risk / lapsed adherence status and refill-due call",
      "Drafts consent- and quiet-hours-aware refill/adherence nudges for each medication due or off-track (human-approval-gated, never auto-sent) and hands them to the Engagement Agent for delivery",
      "CAN ONLY NUDGE: it may draft a refill/adherence reminder but must NEVER autonomously submit or order a refill — a refill without human approval is blocked at the Agent Fabric governance boundary",
      "Flags adherence drop-off (a lapsed medication) to the care team, and runs against ILLUSTRATIVE synthetic medications + refill intervals — clearly labeled; NOT a certified pharmacy / e-prescribing system"
    ],
    provider: "Salesforce",
    governanceTier: "patient-engagement"
  },
  {
    id: "referral-management-agent",
    name: "Agentforce Referral Management · Specialist Referrals (Health Cloud)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health"
    // Referrals ("Create Referral") agent: POST
    // /api/agents/referral-management/tasks (card at /.well-known/agent.json).
    // Triage is DETERMINISTIC (a pure function of the intake + routing context;
    // no randomness, no clock); the specialty catalog + triage rules are
    // illustrative synthetics, NOT a certified clinical referral engine.
    // CRITICAL: it can only DRAFT — an outbound referral requires a clinician's
    // sign-off before it is "sent" (that is a human-in-the-loop clinical action).
    endpoint: "/api/agents/referral-management",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Triages and routes referrals to the adjacent specialists menopause commonly touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, and behavioral health — from intake + Care Router routing signals — the Salesforce 'Agentforce for Health' Referrals ('Create Referral') analog",
      "GENERALIZES the Care Router's behavioral-health-handoff into a full outbound-referral node: what the router expresses as one handoff pathway, this agent expresses as a catalog of cosign-gated referral drafts across the menopause care neighborhood",
      "Triage is DETERMINISTIC (a pure function of the age/cycle/symptom/severity/red-flag context + risk flags; no randomness, no clock) — the same context always yields the same recommended referral(s)",
      "Every recommended referral references a defined specialty-catalog id AND carries a documented reason — never a fabricated or reasonless referral; enforced at the Agent Fabric governance boundary",
      "CAN ONLY DRAFT: it may draft and triage an outbound referral but must NEVER send it without a clinician's sign-off — a referral asserted as sent without a clinician cosign is blocked at the Agent Fabric governance boundary (policy.referral.clinician-cosign)",
      "Runs against ILLUSTRATIVE synthetic specialties + triage rules — clearly labeled; NOT a certified clinical referral engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "member-service-agent",
    name: "Agentforce Member Service · Billing & Coverage (Patient Service)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" Claims &
    // Coverage / patient-service agent: POST /api/agents/member-service/tasks
    // (card at /.well-known/agent.json). It answers a member's BILLING &
    // COVERAGE self-service questions grounded on DETERMINISTIC synthetic
    // claim/EOB records (hashed member/claim keys → realistic figures; no
    // randomness, no clock) and routes to a human with full billing context when
    // out of scope. CRITICAL: a billing/claim answer must trace to a synthetic
    // claim/EOB record — the agent may never fabricate claim data. Scoped to
    // billing/coverage self-service so it stays distinct from the engagement
    // agent. NOT a real claims / 835-ERA / payer system.
    endpoint: "/api/agents/member-service",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Answers a member's BILLING & COVERAGE self-service questions — claim status, copay / patient responsibility, outstanding balance, and EOB explanation — the Salesforce 'Agentforce for Health' Claims & Coverage / patient-service analog",
      "Grounds every answer on DETERMINISTIC synthetic claim/EOB records (hashed member/claim keys → realistic billed/allowed/plan-paid/patient-responsibility figures across submitted / adjudicated / paid / denied statuses; no randomness, no clock) — clearly labeled synthetic; not a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit",
      "Every billing/claim answer must trace to a specific synthetic claim/EOB record (a cited-claims block) — the agent may not fabricate claim data; enforced at the Agent Fabric governance boundary (policy.billing.claim-data-sourced)",
      "Routes out-of-scope requests (clinical, prescription, or scheduling questions) to a human member-services specialist with a PII-safe billing context bundle — scoped to billing/coverage self-service so it stays distinct from the Engagement Agent",
      "Captures no free-text PII (structured, claim-referenced answers only) and every turn is HIPAA-audited"
    ],
    provider: "Salesforce",
    governanceTier: "patient-facing"
  },
  {
    id: "prior-authorization-agent",
    name: "Agentforce Prior Authorization · CareRequest + Utilization Management (Health Cloud)",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" /
    // Health Cloud CareRequest + Utilization Management agent: POST
    // /api/agents/prior-authorization/tasks (card at /.well-known/agent.json).
    // This is the HEAVIEST agent and the LEAST demo-honest of the set: real PA
    // is a genuinely multi-system EDI/278 (or FHIR PAS) workflow against a
    // payer's utilization-management system. Assembly is DETERMINISTIC (payer
    // criteria + required-documentation checklist hashed from stable request
    // keys; no randomness, no clock), and the criteria + doc checklists are
    // ILLUSTRATIVE synthetics, NOT a certified utilization-management engine.
    // TWO CRITICAL, governance-enforced honesty properties: (1) it must NOT
    // autonomously submit a PA — a clinician must approve before submission; and
    // (2) a PA submission must include the required supporting documentation.
    endpoint: "/api/agents/prior-authorization",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Assembles a prior authorization for a PA-requiring menopause item — systemic HRT / compounded estradiol, a bone-density DEXA scan, or a specialized hormone lab panel — the Salesforce 'Agentforce for Health' / Health Cloud CareRequest + Utilization Management analog; the HEAVIEST agent and the LEAST demo-honest (real PA is a genuinely multi-system EDI/278 or FHIR PAS workflow), so the mock is labeled especially clearly",
      "Pulls the (synthetic) clinical context, DETERMINISTICALLY matches the payer's medical-necessity criteria, and assembles the required supporting-documentation checklist (present vs missing) — every package references defined catalog criteria (no randomness, no clock); clearly labeled synthetic, NOT a real X12 278 / FHIR PAS EDI transaction or payer PA portal",
      "MUST NOT autonomously submit a PA: it may only assemble a clinician-gated draft (requiresClinicianApproval:true, submitted:false) — a clinician must approve before submission, enforced at the Agent Fabric governance boundary (policy.pa.no-autonomous-submission)",
      "Documentation integrity: a PA submission must include the required supporting documentation — a submission missing a required document is blocked at the Agent Fabric governance boundary (policy.pa.documentation-integrity), and the submit path refuses as defense in depth",
      "Tracks a PA status (draft / ready-for-clinician / submitted / approved / denied) and runs against ILLUSTRATIVE synthetic payer criteria + document checklists — clearly labeled; NOT a certified utilization-management engine"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "clinical-summary-agent",
    name: "Agentforce Clinical Summary Agent · After-Visit Summary",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health"
    // After-Visit Summary / clinical-documentation agent: POST
    // /api/agents/clinical-summary/tasks (card at /.well-known/agent.json). It
    // COMPOSES the outputs the other agents already produced (intake, Care
    // Router pathway, optional assessment / care plan / care gaps) into two
    // artifacts — a patient-friendly after-visit summary and a clinician
    // handoff. Assembly is DETERMINISTIC and gathers ONLY facts present in the
    // inputs (the real grounding guarantee); the phrasing is a live Claude call
    // with a deterministic scripted fallback (same model + allow-list as the
    // Care Router / Care Plan) — the THIRD live-Claude agent. The artifacts are
    // illustrative synthetics, NOT a certified clinical-documentation engine.
    endpoint: "/api/agents/clinical-summary",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Composes an After-Visit Summary (patient-friendly) AND a clinician handoff note from the outputs the other agents already produced — the Salesforce 'Agentforce for Health' After-Visit Summary / clinical-documentation analog",
      "Assembly is DETERMINISTIC and gathers ONLY facts present in the provided lifecycle inputs (intake severity/symptoms, Care Router pathway, optional validated-instrument assessment, optional instantiated care plan, optional detected care gaps) — the agent never invents a clinical fact or a source",
      "Every summary must trace to the defined source records the context was assembled from — a fabricated / off-context assertion is blocked at the Agent Fabric governance boundary (policy.clinical-summary.source-record-sourced)",
      "Phrases the two artifacts with live Anthropic Claude — the THIRD live-Claude agent after the Care Router and the Care Plan agent — falling back to a DETERMINISTIC scripted composition (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails",
      "Non-prescriptive and commits no clinical action: it re-states existing synthetic records for two audiences and requires clinician review — the artifacts are ILLUSTRATIVE synthetics, NOT a certified clinical-documentation engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "sdoh-screening-agent",
    name: "Agentforce SDOH Screening Agent · Whole-Person Care",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health"
    // Health-Related Social Needs screening + community-resource referral
    // agent: POST /api/agents/sdoh-screening/tasks (card at
    // /.well-known/agent.json). It screens a patient with a validated,
    // public-domain instrument (the CMS AHC-HRSN core-domain tool), scoring is
    // DETERMINISTIC real rule-based logic (no LLM), and it drafts CONSENT-GATED
    // community-resource referrals — never an autonomous enrollment. The
    // community-resource catalog is illustrative synthetic, NOT a live directory.
    endpoint: "/api/agents/sdoh-screening",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens a patient for health-related social needs / social determinants of health with the CMS Accountable Health Communities HRSN core-domain screening tool (housing instability, food insecurity, transportation needs, utility needs, interpersonal safety) — the 'Agentforce for Health' whole-person-care analog",
      "Screening is DETERMINISTIC real rule-based logic (no LLM): per-domain positive/negative determination, an overall count of positive social-need domains, and cutoff-based scoring (e.g. the HITS interpersonal-safety cutoff) — the same responses always screen identically",
      "Escalates a positive interpersonal-safety screen to a human social worker as a mandatory red flag — mirroring the Assessment Agent's PHQ-9 item 9 handling",
      "Drafts CONSENT-GATED community-resource referrals (211, local food bank, housing assistance, utility assistance, a domestic-violence hotline for safety), each referencing a defined resource-catalog id, human-approval-gated and never sent — NEVER an autonomous enrollment; a referral without patient consent is blocked at the Agent Fabric governance boundary",
      "Refuses to administer any screener outside the validated allow-list, and keeps SDOH SEPARATE from clinical severity — a positive social need raises a care-coordination flag, not an intake clinical severity. Runs against ILLUSTRATIVE synthetic community resources — clearly labeled; NOT a live directory of real programs"
    ],
    provider: "Salesforce",
    governanceTier: "whole-person-care"
  },
  {
    id: "patient-education-agent",
    name: "Pause Patient Education & Health Coaching · Claude Sonnet 4.5",
    kind: "anthropic-claude",
    protocol: "a2a",
    // Runnable A2A stand-in for a patient-facing education & coaching agent:
    // POST /api/agents/patient-education/tasks (card at /.well-known/agent.json).
    // A patient-ENGAGEMENT agent (not a clinical decision): it turns
    // already-produced signals (intake symptoms/severity, assessment, care-plan
    // focus areas, care gaps) into evidence-sourced education + motivational
    // coaching. Module SELECTION is DETERMINISTIC (a defined evidence-sourced
    // catalog), and the coaching message is a live Claude call with a
    // deterministic scripted fallback — the FOURTH live-Claude agent, same model
    // + allow-list as the Care Router / Care Plan / Clinical Summary. It is
    // distinct from the Care Plan agent (clinician-authored plan) and Medication
    // Adherence agent (refill nudges); it only educates and coaches.
    endpoint: "/api/agents/patient-education",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Delivers personalized, evidence-sourced menopause/midlife health education + lifestyle coaching (bone health, cardiovascular risk, sleep hygiene, vasomotor self-management, mood/stress, nutrition, physical activity) — a patient-engagement agent distinct from the clinician-authored Care Plan and the refill-focused Medication Adherence agents",
      "Module SELECTION is DETERMINISTIC (a pure function of the intake symptoms/severity + upstream care-plan focus areas + detected care gaps; no randomness, no clock) — the same context always yields the same curriculum",
      "Every education module references a defined evidence-sourced catalog id AND carries a (synthetic) source label — never a fabricated topic; enforced at the Agent Fabric governance boundary (policy.education.evidence-sourced)",
      "Writes a warm, motivational coaching message with live Anthropic Claude — the FOURTH live-Claude agent — falling back to a DETERMINISTIC scripted message (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails",
      "Stays strictly within general education scope — never a diagnosis, medication dose, or individualized medical advice (policy.education.no-medical-advice) — and any coaching push is consent-gated + human-approval-gated (policy.education.consent-before-outreach). Runs against ILLUSTRATIVE synthetic education modules + source labels — clearly labeled; NOT a certified patient-education engine"
    ],
    provider: "Anthropic + Pause-Health.ai",
    governanceTier: "patient-engagement"
  },
  {
    id: "remote-monitoring-agent",
    name: "Remote Patient Monitoring & Symptom-Trend Tracking Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" /
    // Health Cloud remote-patient-monitoring analog: POST
    // /api/agents/remote-monitoring/tasks (card at /.well-known/agent.json).
    // It ingests LONGITUDINAL (time-series) self-reported or wearable/device
    // readings for a menopause/midlife patient, DETERMINISTICALLY classifies
    // each metric's trend over the reading window (improving / stable /
    // worsening) by comparing a recent window against a baseline window, applies
    // (synthetic) red-flag thresholds, and ROUTES worsening / red-flag trends to
    // a human clinician for review — it NEVER takes an autonomous clinical
    // action. It complements Care Gap Closure (preventive-measure gaps),
    // Medication Adherence (refill nudges), Patient Education (coaching), and
    // Clinical Summary (after-visit narrative): this one is longitudinal
    // monitoring + trend detection + clinician-routed escalation. The monitored
    // metrics + thresholds are ILLUSTRATIVE synthetics, NOT a certified RPM device.
    endpoint: "/api/agents/remote-monitoring",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Ingests longitudinal (time-series) menopause/midlife symptom + vital readings — self-reported or from wearables/devices (hot-flash frequency, sleep duration, mood score, resting heart rate, weight) — the 'Agentforce for Health' remote-patient-monitoring analog",
      "Trend detection is DETERMINISTIC (a pure function of the readings' own timestamps + values against per-metric bands; no randomness, no clock) — it compares a recent window against a baseline window to classify each metric improving / stable / worsening, and applies a (synthetic) red-flag threshold to the most-recent value",
      "Every reading must trace to a device/self-report source AND a defined monitored metric — a fabricated / off-source reading is blocked at the Agent Fabric governance boundary (policy.rpm.reading-source-integrity)",
      "Worsening / red-flag trends are ROUTED to a human clinician for review (routedTo:'clinician-review'), each citing the metric + rule that triggered it — the agent NEVER takes an autonomous clinical action (policy.rpm.no-autonomous-escalation), and longitudinal monitoring is consent-gated (policy.rpm.consent-to-monitor)",
      "Runs against ILLUSTRATIVE synthetic metrics + thresholds — clearly labeled; NOT a certified remote-monitoring device"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "population-health-agent",
    name: "Population Health & Risk Stratification Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" / Health
    // Cloud population-health / risk-stratification analog: POST
    // /api/agents/population-health/tasks (card at /.well-known/agent.json).
    // Unlike every other patient-plane agent (which reasons over a SINGLE
    // patient), this one reasons over a whole PANEL/COHORT at once: it ingests
    // already-produced per-patient signals (intake severity, validated-assessment
    // band, detected care gaps, positive SDOH domains, medication-adherence
    // status, monitored-symptom trend), DETERMINISTICALLY stratifies each patient
    // into a risk tier (low / rising / high) with a TRANSPARENT additive/weighted
    // risk model, and emits a prioritized outreach worklist for a human care
    // manager. It complements Care Gap Closure (single-patient preventive gaps),
    // Remote Patient Monitoring (single-patient time-series), and Clinical Summary
    // (single-patient) — this one is population-level prioritization / care-
    // management triage. The factors + weights + cutoffs are ILLUSTRATIVE
    // synthetics, NOT a certified risk-stratification model.
    endpoint: "/api/agents/population-health",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Reasons over a whole PANEL/COHORT of menopause/midlife patients at once (a new granularity) — the 'Agentforce for Health' population-health / risk-stratification analog, distinct from every single-patient agent",
      "Risk scoring is DETERMINISTIC and TRANSPARENT — a pure, additive/weighted function of a defined set of documented risk factors (intake severity, validated-assessment band, open care gaps, positive SDOH domains, medication non-adherence, worsening monitored trend), each with a weight; the same panel always yields the same tiers + worklist ordering (stable, documented tie-break; no randomness, no clock)",
      "Every patient's tier is EXPLAINABLE by citing its contributing factors and traces to the documented risk-factor spec — an opaque / off-spec score is blocked at the Agent Fabric governance boundary (policy.pophealth.transparent-risk-model)",
      "The risk model may NOT score on a protected-class attribute (race, ethnicity, gender identity, religion, etc.) — a fairness / responsible-AI requirement (policy.pophealth.no-protected-class-factors); and a risk tier is a prioritization signal only, never an autonomous care decision — every tier→action requires human / care-manager review (policy.pophealth.no-autonomous-care-decision)",
      "Runs against ILLUSTRATIVE synthetic risk factors + weights + cutoffs and synthetic/de-identified patient references — clearly labeled; NOT a certified risk-stratification model"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "consent-management-agent",
    name: "Consent & Preferences Management Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // consent service: POST /api/agents/consent-management/tasks (card at
    // /.well-known/agent.json). Unlike every other agent (which CONSUMES consent
    // — the SDOH, Patient Education, Remote Monitoring, Care Gap, and Engagement
    // agents each check a "consent-before-*" gate), this one is the SOURCE OF
    // TRUTH FOR consent: it holds, per patient, a consent LEDGER (a set of
    // consent scopes, each with a status + recorded basis + optional expiry) and
    // communication PREFERENCES (allowed channels, quiet hours, preferred
    // language, frequency cap), and answers one DETERMINISTIC question via
    // evaluateConsent — "may this patient be contacted / have data used for this
    // scope over this channel at this time?" — citing the consent record it
    // relied on. It is a control-plane / data-substrate service (platform plane),
    // NOT a live-Claude agent. The scopes + sources + preferences are
    // ILLUSTRATIVE synthetics, NOT a certified consent-management system.
    endpoint: "/api/agents/consent-management",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The AUTHORITATIVE consent ledger + communication-preference store the rest of the fabric's consent-before-outreach / consent-before-referral / consent-to-monitor gates logically defer to — the source of truth for consent, not a consumer of it",
      "A DETERMINISTIC consent-decision function (evaluateConsent) that denies a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch, or a frequency-cap breach and otherwise allows — a pure function of the ledger + the query's own atTime + priorTouches (no randomness, no clock), citing the consent record it relied on",
      "Every consent state must trace to a recorded consent event/basis — an asserted-but-unrecorded consent is blocked at the Agent Fabric governance boundary (policy.consent.recorded-source)",
      "A revoked / expired consent is honored immediately — a decision may never ALLOW against a revoked / expired scope (policy.consent.honor-revocation); and a decision may never override a withheld scope or borrow consent across scopes (policy.consent.no-scope-override)",
      "Runs against an ILLUSTRATIVE synthetic consent ledger — scopes, recorded sources, preferences, and patient references clearly labeled; NOT a certified consent-management / preference-center system"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "clinical-trials-agent",
    name: "Clinical Trials & Research Matching Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the Salesforce "Agentforce for Health" / Health
    // Cloud clinical-trials / research-matching analog: POST
    // /api/agents/clinical-trials/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) patient-care agent that matches a SINGLE patient
    // against a SYNTHETIC study catalog using structured eligibility criteria
    // (age band, symptom profile, comorbidities, geography, prior therapy, HRT
    // status, postmenopausal status), returns the matching studies ranked with
    // per-criterion explanations, and drafts a CONSENT-GATED outreach that NEVER
    // auto-enrolls (informed consent + a human required). It ties to the Consent
    // & Preferences Management agent's `research` consent scope — deferring to
    // that authoritative research-consent state before any outreach — but does
    // its own eligibility logic. Reuses the existing care-coordination tier
    // (research matching is a care-navigation / coordination activity), not a new
    // tier. The catalog + sponsors + criteria are ILLUSTRATIVE synthetics, NOT a
    // certified trial-eligibility engine.
    endpoint: "/api/agents/clinical-trials",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Matches a SINGLE menopause/midlife patient against a synthetic research-study catalog using STRUCTURED eligibility criteria (age band, symptom profile, comorbidities, geography, prior therapy, HRT status, postmenopausal status) — the 'Agentforce for Health' clinical-trials / research-matching analog, distinct from the population-health, care-gap, remote-monitoring, referral, and education agents",
      "Eligibility matching is DETERMINISTIC — a pure function of the patient context against each study's DEFINED criteria (no randomness, no clock); the same context always yields the same matches + ranking with a stable, documented tie-break (eligible first, then match score, then studyId)",
      "Every eligibility determination traces to a defined study criterion — a fabricated / ad-hoc / off-catalog eligibility is blocked at the Agent Fabric governance boundary (policy.trials.eligibility-criteria-sourced)",
      "Trial outreach is RESEARCH-CONSENT-GATED — it defers to the patient's `research` consent scope (the Consent & Preferences Management agent's, withheld by default) and drafts an active outreach only when research consent is present, otherwise it withholds outreach (policy.trials.research-consent-required); and it NEVER enrolls a patient autonomously — enrollment requires informed consent + a human (policy.trials.no-autonomous-enrollment)",
      "Runs against an ILLUSTRATIVE synthetic study catalog — studies, sponsors, criteria, and patient references clearly labeled; NOT real studies, real sponsors, or a certified trial-eligibility engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "language-access-agent",
    name: "Language Access & Health Equity Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a patient-care EQUITY agent: POST
    // /api/agents/language-access/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) agent that ensures limited-English-proficiency
    // (LEP) patients can understand their care — it determines the patient's
    // PREFERRED LANGUAGE (deferring in copy to the Consent & Preferences
    // Management agent's preferred-language preference), decides whether a
    // QUALIFIED MEDICAL INTERPRETER is required and of which modality (in-person
    // / video / phone), checks whether the needed PATIENT MATERIALS exist in that
    // language (from an approved translated-materials catalog, each with a
    // translation-provenance label), and FLAGS EQUITY / ACCESS GAPS (no qualified
    // interpreter for a language, a consent form only in English). It NEVER
    // substitutes machine translation or an untrained / family interpreter for
    // clinical communication or consent. REUSES the existing whole-person-care
    // tier (the SDOH / equity tier — a health-equity / access activity), not a
    // new tier. The languages, interpreter availability, materials, and
    // provenance labels are ILLUSTRATIVE synthetics, NOT a certified language-
    // access system.
    endpoint: "/api/agents/language-access",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Ensures LEP patients can understand their care — determines the PREFERRED LANGUAGE (deferring to the Consent & Preferences Management agent's preferred-language preference), decides whether a qualified medical interpreter is needed and of which modality (in-person / video / phone), checks approved in-language materials, and flags equity / access gaps — a health-equity / access agent distinct from the SDOH, consent, and clinical agents",
      "Language-access planning is DETERMINISTIC — a pure function of the patient's structured context against the supported-language + approved-materials catalogs (no randomness, no clock); the same context always yields the same assessment (with a stable, documented equity-gap ordering)",
      "Clinical interpretation uses a QUALIFIED medical interpreter only — an untrained / ad-hoc / family interpreter (or machine translation) for clinical communication is blocked at the Agent Fabric governance boundary (policy.langaccess.qualified-interpreter-only); when no qualified interpreter is available the agent escalates to a human coordinator (a safe output), it never substitutes an unqualified option",
      "In-language materials must trace to the approved translated-materials catalog — an unverified / ad-hoc translation presented as official is blocked (policy.langaccess.translated-material-source-integrity); and machine / auto translation may never be used for clinical consent or clinical decision communication (policy.langaccess.no-machine-translation-for-consent)",
      "Runs against ILLUSTRATIVE synthetic supported-language, interpreter-availability, and approved-materials catalogs — languages, availability, materials, and translation provenance clearly labeled; NOT a certified language-access system"
    ],
    provider: "Salesforce",
    governanceTier: "whole-person-care"
  },
  {
    id: "hedis-quality-agent",
    name: "HEDIS & Quality Reporting Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a panel-level QUALITY-REPORTING agent: POST
    // /api/agents/hedis-quality/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) agent that rolls up per-patient signals across a
    // panel into HEDIS / Star measure compliance (numerator, denominator,
    // exclusions, rate) for value-based-care contracts. Unlike the single-patient
    // Care Gap Closure Agent (which drafts outreach for one patient's gaps) and
    // the panel-level Population Health & Risk Stratification Agent (which
    // prioritizes patients), this one reports a PANEL against a defined HEDIS
    // measure catalog. It NEVER autonomously submits a measure package —
    // submission always requires a human quality-team approval. REUSES the
    // existing care-coordination tier — a quality / care-management activity,
    // not a new tier. The measure catalog, thresholds, and exclusion lists are
    // ILLUSTRATIVE synthetics, NOT an NCQA-certified HEDIS engine.
    endpoint: "/api/agents/hedis-quality",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Rolls up per-patient signals across a panel into HEDIS quality measure compliance (numerator, denominator, exclusions, rate) with a per-measure gap list — a panel-level quality-reporting agent distinct from the single-patient Care Gap Closure agent and the panel-level Population Health risk-stratification agent",
      "Quality reporting is DETERMINISTIC — a pure function of the panel signals + the caller-provided `asOfPeriod` accepted as data (no randomness, no clock); the same panel + period always yields the same rates + gap lists, with a stable, documented denominator narrowing per measure",
      "Every scored measure must trace to the defined HEDIS measure catalog — an off-catalog / fabricated measure is blocked at the Agent Fabric governance boundary (policy.hedis.measure-catalog-sourced), and every applied denominator exclusion must trace to a defined catalog exclusion on that measure — an ad-hoc / unlisted exclusion is blocked (policy.hedis.exclusion-integrity), so a rate cannot be quietly inflated by shrinking the denominator",
      "Submission is HUMAN-APPROVED — the agent may only assemble a submission package ready for human quality-team review, never submit autonomously to a payer / CMS / quality registry (policy.hedis.no-autonomous-submission); mirrors the Prior Authorization Agent's clinician-gated draft, the Population Health Agent's no-autonomous-care-decision, and the Clinical Trials Agent's no-autonomous-enrollment posture",
      "Runs against an ILLUSTRATIVE synthetic HEDIS measure catalog + exclusion lists — measures, thresholds, and specs clearly labeled; NOT NCQA-certified specifications, real value sets, or a certified HEDIS engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "advance-care-planning-agent",
    name: "Advance Care Planning Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the ACP touchpoint agent: POST
    // /api/agents/advance-care-planning/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that surfaces which advance directives
    // are on file for a midlife/menopause patient (living will, DPOA-HC, POLST
    // — POLST only when a serious-illness flag is on), flags missing / stale /
    // language-access gaps, and drafts a consent-gated conversation prompt for
    // the care team to deliver. It NEVER creates, updates, or overrides a
    // directive on its own — every directive change requires clinician AND
    // patient sign-off. For an LEP patient it WITHHOLDS the active prompt
    // (a safe answer) until a qualified-interpreter plan is documented,
    // deferring to the Language Access & Health Equity agent. REUSES the
    // existing whole-person-care tier — an equity / preventive whole-person
    // activity, not a new clinical decision. The directive catalog, source
    // labels, and staleness threshold are ILLUSTRATIVE synthetics, NOT a
    // certified directives registry.
    endpoint: "/api/agents/advance-care-planning",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Surfaces which advance directives (living will, DPOA-HC, POLST) are on file for a midlife/menopause patient, flags missing / stale / off-source / language-access gaps, and drafts a consent-gated conversation prompt for the care team — a whole-person-care ACP touchpoint agent, distinct from the Consent Management agent (data-use consent) and the Care Plan agent (active treatment planning)",
      "ACP assessment is DETERMINISTIC — a pure function of the caller-provided asOfDate + directives-on-file against the illustrative ACP directive catalog + approved-source list (no randomness, no clock); the same context always yields the same assessment (with a stable, documented flag ordering)",
      "Every claimed directive on file must trace to the defined ACP directive catalog AND an approved directive-source label with a recorded execution date — an off-catalog directive, an unapproved / verbal source, or a missing execution date is blocked at the Agent Fabric governance boundary (policy.acp.directive-source-integrity), so the agent cannot fabricate a directive to inflate ACP completeness",
      "The agent NEVER autonomously creates, updates, or overrides a directive — every directive change is a clinician + patient sign-off gated proposal, and any autonomous change is blocked (policy.acp.no-autonomous-directive-change); mirrors the Prior Authorization Agent's no-autonomous-submission and the HEDIS Agent's human-approval posture",
      "For a limited-English-proficiency (LEP) patient the agent defers to the Language Access & Health Equity agent and WITHHOLDS the active prompt (a safe answer) until a qualified-interpreter plan is documented — a plan claiming an active ACP conversation for an LEP patient with no interpreter is blocked (policy.acp.language-access-integrity)",
      "Runs against ILLUSTRATIVE synthetic directive-catalog, approved-source, and staleness-threshold values — directives, sources, and thresholds clearly labeled; NOT a certified advance-directives registry or a POLST/MOLST program"
    ],
    provider: "Salesforce",
    governanceTier: "whole-person-care"
  },
  {
    id: "care-team-management-agent",
    name: "Care Team & Case Management Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a care-coordination agent: POST
    // /api/agents/care-team/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) agent that assembles the multi-disciplinary
    // care team around a single high-need menopause/midlife patient — PCP,
    // MSCP, cardiology, endocrinology, bone-health, pelvic-floor PT,
    // behavioral health — assigns a case manager (a stable-hash pick from a
    // synthetic pool), and emits a shared team snapshot. Unlike the panel-
    // level Population Health & Risk Stratification Agent (which PRIORITIZES
    // patients), this one COORDINATES clinicians around a single patient. It
    // NEVER autonomously adds or removes a team member — every change is a
    // case-manager sign-off gated proposal. REUSES the existing care-
    // coordination tier. The care-role catalog, condition→role triggers,
    // case-manager pool, and member refs are ILLUSTRATIVE synthetics, NOT a
    // certified care-team schema.
    endpoint: "/api/agents/care-team",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Assembles the multi-disciplinary care team around a single high-need menopause/midlife patient (PCP, MSCP, cardiology, endocrinology, bone-health, pelvic-floor PT, behavioral health), assigns a case manager, and emits a shared team snapshot — a care-coordination agent, distinct from the panel-level Population Health & Risk Stratification agent",
      "Team assembly is DETERMINISTIC — a pure function of the patient's clinical needs against the illustrative care-role catalog + condition→role trigger map, with the case manager assigned by a stable, documented hash on the patientRef (no randomness, no clock); the same context always yields the same team + case manager + snapshot",
      "Every team role — on the roster and in the needed-roles set — must trace to the defined care-role catalog; an off-catalog / fabricated discipline label is blocked at the Agent Fabric governance boundary (policy.careteam.role-catalog-sourced), so the agent cannot pad a roster or claim coverage for a role that doesn't exist",
      "The agent NEVER autonomously adds or removes a team member — every roster change is a case-manager sign-off gated proposal, and an autonomous change is blocked (policy.careteam.no-autonomous-assignment); mirrors the ACP Agent's no-autonomous-directive-change and the HEDIS Agent's human-approval posture",
      "A legitimate care team must include a PCP (role.pcp) — the continuity-of-care anchor every specialist coordinates around; a roster shipping without an accountable PCP is blocked (policy.careteam.pcp-required), a load-bearing continuity-of-care invariant",
      "Runs against ILLUSTRATIVE synthetic care-role catalog, condition→role triggers, and case-manager pool — roles, responsibilities, and refs clearly labeled; NOT a certified care-team schema, a real provider directory, or a case-management workflow engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "transitions-of-care-agent",
    name: "Discharge & Transitions of Care Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a transitions-of-care agent: POST
    // /api/agents/transitions-of-care/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that closes the loop back to primary
    // care after a hospitalization / ED visit for a menopause/midlife
    // patient: it RECONCILES the discharge medication list against the
    // pre-admit list (added / removed / dose-changed / unchanged), booKS a
    // follow-up (or drafts an appointment-request handoff to Scheduling —
    // never a text recommendation), pulls the encounter-reason red-flag
    // warning signs, emits a teach-back checklist, and assembles the PCP
    // handoff summary. It is distinct from the Care Plan Agent (active
    // treatment planning), the Medication Adherence Agent (nudge-only
    // refill prompts), and the Referral Management Agent (specialist triage)
    // — this one runs the CLOSE-THE-LOOP workflow after an acute event.
    // REUSES the existing care-coordination tier. The encounter categories,
    // red-flag catalog, follow-up window (14 days), approved medication-
    // source labels, and teach-back items are ILLUSTRATIVE synthetics, NOT
    // a certified TOC schema, a real ADT / discharge system, or a clinical
    // guideline registry.
    endpoint: "/api/agents/transitions-of-care",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Assembles the post-encounter transitions-of-care package for a menopause/midlife patient after a hospitalization / ED visit — medication reconciliation, scheduled follow-up (or awaiting-schedule handoff), encounter-reason red-flag warning signs, teach-back checklist, and PCP handoff summary — a care-coordination agent, distinct from the Care Plan, Medication Adherence, and Referral Management agents",
      "The package is DETERMINISTIC — a pure function of the patient context + discharge date + provided medication lists (no randomness, no clock; timestamps are accepted as data); the same context always yields the same reconciliation + red-flag list + teach-back checklist + PCP summary, with a stable, documented reconciliation ordering (sorted by medication id)",
      "Every medication on the reconciliation (pre-admit or discharge) must cite an approved medication source (pre-admit-verified, discharge-order, patient-verified, ehr-scanned-with-provenance) — a verbal / ad-hoc / undocumented source is blocked at the Agent Fabric governance boundary (policy.toc.reconciliation-source-integrity), so the agent cannot let a fabricated medication slip into the reconciliation",
      "The agent NEVER autonomously commits a medication change — every add / remove / dose-change is a clinician sign-off gated proposal, and an autonomous change is blocked (policy.toc.no-autonomous-medication-change); mirrors the Medication Adherence Agent's no-autonomous-refill, the ACP Agent's no-autonomous-directive-change, and the Prior Authorization Agent's no-autonomous-submission posture",
      "A follow-up must be a SCHEDULED slot (slotStart + providerRef + modality), not a text recommendation — 'recommended' follow-ups that never get booked are the classic 30-day-readmission failure mode this guard closes (policy.toc.follow-up-scheduled-not-recommended); the safe interim answer when no slot is available is state:'awaiting-schedule' with a handoff to the Appointment Scheduling agent",
      "Runs against ILLUSTRATIVE synthetic encounter categories, red-flag catalog, follow-up window, approved-source labels, and teach-back items — clearly labeled; NOT a certified TOC schema, a real ADT / discharge system, or a clinical guideline registry"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "grievance-appeals-agent",
    name: "Grievance & Appeals Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a member-service grievance-and-appeals
    // agent: POST /api/agents/grievance-appeals/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) agent that runs
    // the INTAKE half of the regulated grievance-and-appeals process — it
    // classifies a member complaint or coverage-denial appeal (grievance /
    // billing / standard-appeal / expedited-appeal), routes it to the
    // correct human queue (member-services / clinical-review / compliance),
    // and stamps a regulatory deadline that traces to the case-type catalog
    // + received date. It NEVER resolves, approves, or denies a case on
    // its own — every case is queued for human action; a denial-appeal in
    // particular needs a clinician-plus-compliance human review. The
    // routing summary handed to downstream queues is PHI-SAFE (structured
    // only — memberRef, caseType, urgency, queue, deadlineDate). Distinct
    // from the Member Service / Billing agent (billing self-service, one-
    // shot answers) and the Prior Authorization agent (pre-service utili-
    // zation management). The case-type catalog, deadline windows, and
    // queue mapping are ILLUSTRATIVE synthetics, NOT Medicare Advantage
    // Chapter 13 or a real appeal-adjudication engine.
    endpoint: "/api/agents/grievance-appeals",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Classifies member complaints and coverage-denial appeals — grievance / billing / standard-appeal / expedited-appeal — routes each case to the correct human queue (member-services / clinical-review / compliance), and stamps a regulatory deadline that traces to the case-type catalog + received date; a member-service intake agent distinct from the Member Service / Billing agent (billing self-service) and the Prior Authorization agent (pre-service utilization management)",
      "Classification, routing, and deadline stamping are DETERMINISTIC — a pure function of the intake keywords + coverage/service flags + received date accepted as data (no randomness, no clock); the same intake always yields the same case type / urgency / queue / deadline / summary, with a stable, documented case-id shape",
      "The agent NEVER autonomously resolves, approves, or denies a case — every case is queued for human review, and every resolution proposal is human-queue-action gated (requiresHumanQueueAction:true, applied:false); an autonomous resolution is blocked at the Agent Fabric governance boundary (policy.grievance.no-autonomous-resolution), mirroring the ACP Agent's no-autonomous-directive-change and the HEDIS Agent's no-autonomous-submission posture",
      "Every case deadline must trace to the defined case-type catalog + received date and may NOT exceed the regulatory maximum — an off-catalog case-type or a silently-extended deadline is blocked (policy.grievance.deadline-integrity), the load-bearing regulatory-compliance guard against breaching Medicare Advantage Chapter 13 / state-insurance-code timelines",
      "The routing summary handed to the downstream human queue is PHI-SAFE — only the STRUCTURED case-type + urgency + queue + deadline + memberRef, never free-text PHI; a summary containing free-text PHI (patient name / DOB / diagnosis / medication / symptom detail) or an extra free-text key is blocked (policy.grievance.no-phi-in-routing-summary), so the routing payload can be delivered via lower-trust channels (Slack, email, ticketing) without leaking PHI",
      "Runs against ILLUSTRATIVE synthetic case-type catalog, deadline windows, expedited-eligibility rules, and queue mapping — clearly labeled; NOT Medicare Advantage Chapter 13, a certified state-insurance-code process, or a real appeal-adjudication engine"
    ],
    provider: "Salesforce",
    governanceTier: "patient-facing"
  },
  {
    id: "provider-credentialing-agent",
    name: "Provider Credentialing & Directory Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a network-integrity agent: POST
    // /api/agents/provider-credentialing/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) agent that verifies a
    // provider's credentialing status (state license, DEA, board cert,
    // sanctions clearance, NPI) against approved verification sources,
    // maintains the (illustrative) directory profile, and gates every
    // referral / scheduling attempt at the network boundary — a referral
    // to an expired / incomplete / sanctioned provider is blocked here,
    // and a directory response past the No-Surprises-Act freshness window
    // is not returned as authoritative. It sits alongside the data
    // substrate (MuleSoft integration + Data 360 grounding) — the
    // Referral Management, Appointment Scheduling, and Transitions of
    // Care agents can consult this agent for a deterministic yes/no
    // before they hand off. Distinct from every clinical / member-facing
    // agent — this is NETWORK integrity. The catalog, verification
    // sources, NSA freshness window (90 days), and directory schema are
    // ILLUSTRATIVE synthetics, NOT NCQA / CAQH credentialing, a real
    // state-medical-board API, or an OIG-LEIE sanction feed.
    endpoint: "/api/agents/provider-credentialing",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Verifies a provider's credentialing status (state license, DEA, board certification, sanctions clearance, NPI) against approved verification sources, maintains the directory profile, and emits gate flags (canReferPatient / canBookAppointment / canReturnInDirectoryResponse) the Referral Management, Appointment Scheduling, and Transitions of Care agents can consult before handing off — a network-integrity agent, distinct from every clinical / member-facing agent",
      "Verification is DETERMINISTIC — a pure function of the credentials + directory profile + caller-provided asOfDate (no randomness, no clock; timestamps are accepted as data); the same context always yields the same status (verified / incomplete / expired / sanctioned) + gate flags, with a stable, documented precedence (sanctioned > incomplete > expired > verified)",
      "Every credential on file must cite an approved verification source (state-medical-board, dea-registry, abms-board, oig-leie-sanctions, npi-registry) with a recorded verifiedOn date — an unapproved / self-reported / verbal / undocumented source is blocked at the Agent Fabric governance boundary (policy.credentialing.source-integrity), so the agent cannot fabricate a 'verified' status from a hand-typed claim",
      "The fabric NEVER hands a referral or scheduled appointment to a provider whose status is expired / incomplete / sanctioned — a referral or scheduling call for such a provider is blocked (policy.credentialing.no-referral-to-expired-or-sanctioned); this is where the ghost-network problem gets fixed at the network boundary, mirroring the CAQH ProView / NCQA credentialing posture without being certified",
      "Directory responses returned as AUTHORITATIVE must have a verifiedAsOf date within the No-Surprises-Act 90-day accuracy window — a stale directory record returned as authoritative is blocked (policy.credentialing.no-surprises-act-directory-accuracy); the safe interim answer is to route the caller to a directory-refresh workflow, mirroring the NSA directory-accuracy posture",
      "Runs against ILLUSTRATIVE synthetic credential-kind catalog, approved verification sources, and directory schema — clearly labeled; NOT NCQA / CAQH credentialing, a real state-medical-board API, an OIG-LEIE sanction feed, or a live directory"
    ],
    provider: "Salesforce",
    governanceTier: "integration"
  },
  {
    id: "quality-attribution-agent",
    name: "Quality-Measure Attribution Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the OTHER HALF of the HEDIS story: POST
    // /api/agents/quality-attribution/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that pairs with the HEDIS & Quality
    // Reporting Agent — HEDIS computes the RATES, THIS agent decides WHOSE
    // PANEL each patient counts on. It attributes each patient to a
    // provider/clinic under a defined methodology (plurality-of-visits, PCP-
    // of-record, prospective Medicare Advantage, contract-defined window),
    // honors the VBC contract's exclusion terms (age band, network status,
    // exclusion codes), and applies a documented tie-break chain (most-
    // recent-visit-wins → provider-ref-lexical-ascending) when the primary
    // metric ties. It rolls up per-provider counts so the HEDIS agent can
    // score against the correct denominator. Distinct from the Care Team
    // agent (multi-disciplinary team assembly around a patient) and the
    // Provider Credentialing agent (network integrity) — this one is quality
    // ACCOUNTABILITY. REUSES the existing care-coordination tier.
    endpoint: "/api/agents/quality-attribution",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Attributes each patient to a provider / clinic / VBC contract under a defined methodology (plurality-of-visits, PCP-of-record, prospective Medicare Advantage, contract-defined window) and rolls up per-provider counts so downstream HEDIS scoring lands on the correct denominator — a care-coordination / quality-accountability agent, distinct from the HEDIS Quality agent (which computes the rates) and the Care Team / Credentialing agents",
      "Attribution is DETERMINISTIC — a pure function of the visit history + contract terms + caller-provided asOfDate (no randomness, no clock; timestamps and windows are accepted as data); the same context always yields the same attribution + rollup, and every tie is broken by the documented tie-break chain",
      "Every attribution must trace to a defined methodology (plurality-of-visits / pcp-of-record / prospective-medicare-advantage / contract-defined-window) AND a defined VBC contract on the illustrative catalog — a bespoke / off-catalog methodology or contract is blocked at the Agent Fabric governance boundary (policy.attribution.methodology-catalog-sourced), so the agent cannot fabricate a 'we-just-guessed' attribution rule",
      "Every attribution must honor the VBC contract's explicit exclusion terms (age band, network status, exclusion codes) — an attribution that keeps a patient the contract EXCLUDES in the numerator/denominator is blocked (policy.attribution.no-conflicting-contract-terms), so a contract's scorecard is not polluted with patients the contract never covered",
      "Every tie-break must be a documented, deterministic rule (most-recent-visit-wins, provider-ref-lexical-ascending) — an undocumented / opaque / coin-flip tie-break is blocked (policy.attribution.tie-break-documented); this turns tie-break resolution from a gameable non-determinism into a fabric-verifiable invariant",
      "Runs against ILLUSTRATIVE synthetic methodology + contract + tie-break catalogs — clearly labeled; NOT CMS Shared Savings Program attribution, an ACO REACH prospective assignment, an NCQA HEDIS attribution appendix, or a real payer's VBC contract terms"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "complex-care-management-agent",
    name: "Complex Care Management Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the reimbursable-time-tracking half of
    // care management: POST /api/agents/complex-care-management/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude) agent
    // for a Medicare CCM program — it confirms CCM eligibility (2+ catalog-
    // sourced chronic conditions, Medicare age, coverage flag, consent),
    // tracks per-activity time entries against catalog-sourced activity
    // types, maps monthly totals to the CPT ladder (99490/99491 non-complex,
    // 99487/99489 complex), and assembles a billing package for human
    // quality-team review — NEVER autonomously submits a CMS claim. It is
    // distinct from the Care Team agent (multi-disciplinary team assembly)
    // and the Care Plan agent (treatment planning) — this one is the
    // reimbursable TIME-TRACKING piece paired with them. REUSES the
    // existing care-coordination tier.
    endpoint: "/api/agents/complex-care-management",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Confirms Medicare CCM eligibility, tracks per-activity monthly time entries, maps the total to the illustrative CPT ladder (99490/99491 non-complex, 99487/99489 complex), and assembles a billing package for human quality-team review — the reimbursable time-tracking piece of care management, distinct from Care Team (roster) and Care Plan (treatment content)",
      "Eligibility, time totals, and CPT selection are DETERMINISTIC — a pure function of the patient's chronic conditions, Medicare-coverage flag, consent flag, age, and per-activity time entries (no randomness, no clock); the same context always yields the same eligibility + time summary + CPT selection + billing package",
      "Every CCM eligibility claim must trace to the defined chronic-condition catalog (≥ 2 conditions), the Medicare-eligibility age gate, the Medicare-coverage flag, and the consent flag — a fabricated chronic condition or unsupported eligibility is blocked at the Agent Fabric governance boundary (policy.ccm.eligibility-catalog-sourced)",
      "The agent NEVER autonomously submits a CCM claim to CMS — every billing package is requiresQualityTeamApproval:true / submitted:false, and any autonomous submission is blocked (policy.ccm.no-autonomous-billing); mirrors the HEDIS Agent's no-autonomous-submission and the Prior Authorization Agent's no-autonomous-submission posture",
      "Every logged minute must trace to the defined CCM activity catalog (medication reconciliation, care-plan update, patient communication, referral follow-up, care-team coordination, patient education, resource navigation) and the reported total must equal the sum of the per-entry minutes — phantom-minute inflation (the classic CCM audit finding) or an off-catalog activity is blocked (policy.ccm.time-integrity)",
      "Runs against ILLUSTRATIVE synthetic chronic-condition catalog, CCM activity catalog, CPT thresholds, and Medicare eligibility flags — clearly labeled; NOT CMS Chapter 12 / MLN Booklet 909188 CCM billing, an actual CPT coding manual, or a live Medicare claim-submission system"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "claims-adjudication-agent",
    name: "Claims Adjudication Assistant Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side first-pass claims-
    // adjudication piece: POST /api/agents/claims-adjudication/tasks (card
    // at /.well-known/agent.json). A DETERMINISTIC (no-Claude) agent for a
    // health-plan / TPA — it applies payer-specific claim edits (NCCI/PTP
    // unbundling, LCD/NCD coverage, benefit limits, prior-auth linkage,
    // duplicates, network, timely-filing), classifies each claim as
    // clean-pay / pend-clinical-review / pend-adjudicator-review / deny-
    // drafted with a specific catalog reason code, and routes anything non-
    // clean to a human. It NEVER autonomously denies a claim; every denial
    // is DRAFTED for adjudicator cosign. It is distinct from the Prior
    // Authorization agent (pre-service utilization management), the
    // Member Service / Billing agent (member-facing self-service), and the
    // Grievance & Appeals agent (post-denial intake) — this one is the
    // FIRST-PASS PAYER-SIDE adjudicator. REUSES the existing care-
    // coordination tier.
    endpoint: "/api/agents/claims-adjudication",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Applies payer-specific first-pass claim edits (NCCI-PTP unbundling, LCD/NCD coverage, benefit-limit exhaustion, prior-auth missing, duplicate submission, out-of-network, timely-filing) and classifies each claim as clean-pay / pend-clinical-review / pend-adjudicator-review / deny-drafted with a specific catalog reason code — a first-pass payer-side adjudicator, distinct from Prior Auth (pre-service), Member Service (billing self-service), and Grievance & Appeals (post-denial intake)",
      "Adjudication is DETERMINISTIC — a pure function of the claim + member benefits + edit catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + applied edits + reason code, with a documented decision precedence (deny > pend-clinical > pend-adjudicator > clean-pay) and stable edit-id ordering",
      "Every applied edit must trace to the defined CLAIM_EDIT_CATALOG — an off-catalog / fabricated edit is blocked at the Agent Fabric governance boundary (policy.claims.edit-catalog-sourced), so the agent cannot invent a bespoke 'you owe us more' edit",
      "The agent NEVER autonomously finalizes a denial — every denial is DRAFTED for adjudicator cosign (requiresAdjudicatorCosign:true, cosigned:false), and any autonomous denial is blocked (policy.claims.no-autonomous-denial); denial letters are legally consequential under CMS / ERISA / state insurance code and must have a human sign-off. Mirrors the PA Agent's no-autonomous-submission, the HEDIS Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture",
      "Every non-clean-pay decision must cite a specific catalog reason code (CLAIM_REASON_CODE_CATALOG — illustrative CO-97 / CO-50 / CO-96 / CO-119 / CO-197 / CO-18 / CO-242 / CO-29 style) — a denial or pend without a stated reason code is blocked (policy.claims.reason-code-integrity); under Section 1557 / state insurance code / CMS, a denial notice must state the specific reason",
      "Runs against ILLUSTRATIVE synthetic edit catalog + reason-code catalog + benefit-rule shape — clearly labeled; NOT CMS X12 837 claim spec, an NCCI PTP edit table, an LCD/NCD medical-necessity registry, or a real payer's benefit configuration"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "formulary-review-agent",
    name: "Formulary & Drug Utilization Review Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side formulary + DUR pipeline:
    // POST /api/agents/formulary-review/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) agent that for a proposed
    // medication looks up the payer's formulary tier, verifies step-therapy
    // sequencing against documented prior-therapy history, applies quantity
    // limits, and screens for drug-drug interactions — classifying each
    // request as preferred-approved / pend-step-therapy / pend-quantity-
    // limit / pend-interaction-review / pend-non-formulary. It NEVER
    // autonomously overrides a formulary exception; every non-preferred
    // decision is DRAFTED for clinician cosign. Menopause-relevant because
    // HRT tier placement varies significantly by plan (transdermal
    // estradiol is often Tier 2 or non-formulary). REUSES the existing
    // care-coordination tier.
    endpoint: "/api/agents/formulary-review",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Reviews a proposed medication against the payer's formulary — tier lookup, step-therapy sequencing, quantity limits, drug-drug interactions — and classifies as preferred-approved / pend-step-therapy / pend-quantity-limit / pend-interaction-review / pend-non-formulary with routing to a clinician (or pharmacist for interactions). Companion to the Prior Auth (broader UM), Medication Adherence (nudge-only refill), and Claims Adjudication (post-service) agents",
      "Review is DETERMINISTIC — a pure function of the request + patient's prior-therapy + current-medication list + payer formulary catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + applied rules + reason code, with a documented precedence (pend-non-formulary > pend-step-therapy > pend-interaction-review > pend-quantity-limit > preferred-approved)",
      "Every proposed drug + applied rule + reason code must trace to the defined catalogs (FORMULARY_DRUG_CATALOG, FORMULARY_RULE_CATALOG, FORMULARY_REASON_CODE_CATALOG) — a fabricated drug or 'we-just-said-no' rule is blocked at the Agent Fabric governance boundary (policy.formulary.catalog-sourced)",
      "Step therapy must be HONORED — when the plan requires a documented trial of a preferred agent, the agent verifies documented prior-therapy is on file before returning preferred-approved; approving on undocumented / self-reported history is blocked (policy.formulary.step-therapy-honored), a common payer-audit finding",
      "The agent NEVER autonomously overrides a formulary exception — every non-preferred decision is DRAFTED for clinician cosign (requiresClinicianCosign:true, cosigned:false), and any autonomous override is blocked (policy.formulary.no-autonomous-override); formulary exceptions are legally consequential (Medicare Advantage Chapter 6 + Part D require a documented rationale from a prescriber). Mirrors the Claims Adjudication Agent's no-autonomous-denial, the PA Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture",
      "Runs against ILLUSTRATIVE synthetic drug catalog + rule catalog + reason-code catalog + step-therapy chains + interaction pairs — clearly labeled; NOT Medi-Span, First Databank, RxNorm, an actual payer's formulary file, or a certified DUR engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  }
];

const POLICIES: PolicyRecord[] = [
  {
    id: "policy.phi.no-free-text-pii",
    name: "No free-text PII in intake",
    description:
      "Patient-facing intake agents may not capture or persist free-text PII (full names, SSNs, addresses). Structured fields only.",
    appliesTo: ["agentforce-intake", "assessment-agent", "member-service-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.intake.red-flag-mandatory",
    name: "Red-flag screen is non-optional",
    description:
      "Every intake task must include the standardized red-flag screening question. Tasks without it are rejected by the Care Router.",
    appliesTo: ["agentforce-intake", "care-router-claude", "assessment-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.audit.hipaa-log-every-turn",
    name: "HIPAA audit log",
    description:
      "Every agent turn is logged with a tamper-evident correlation id. Logs are exported to the customer's SIEM via MuleSoft.",
    appliesTo: [
      "agentforce-intake",
      "care-router-claude",
      "pause-mcp",
      "mulesoft-ingest",
      "salesforce-data-360",
      "prospecting-agent",
      "engagement-agent",
      "inbound-lead-agent",
      "qualification-agent",
      "mcp-bridge",
      "assessment-agent",
      "benefits-verification-agent",
      "appointment-scheduling-agent",
      "care-gap-closure-agent",
      "care-plan-agent",
      "medication-adherence-agent",
      "referral-management-agent",
      "member-service-agent",
      "prior-authorization-agent",
      "clinical-summary-agent",
      "sdoh-screening-agent",
      "patient-education-agent",
      "remote-monitoring-agent",
      "population-health-agent",
      "consent-management-agent",
      "clinical-trials-agent",
      "language-access-agent",
      "hedis-quality-agent",
      "advance-care-planning-agent",
      "care-team-management-agent",
      "transitions-of-care-agent",
      "grievance-appeals-agent",
      "provider-credentialing-agent",
      "quality-attribution-agent",
      "complex-care-management-agent",
      "claims-adjudication-agent",
      "formulary-review-agent"
    ],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.assessment.validated-instrument-only",
    name: "Validated instruments only",
    description:
      "The Assessment Agent may only administer and score instruments on the validated allow-list (Menopause Rating Scale, Greene Climacteric Scale, PHQ-9, Insomnia Severity Index). A request to administer or score anything else is rejected before any scoring runs — no ad-hoc or unvalidated questionnaire feeds an intake severity signal.",
    appliesTo: ["assessment-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.sdoh.validated-screener-only",
    name: "Validated SDOH screeners only",
    description:
      "The SDOH Screening Agent may only administer and score screeners on the validated allow-list (the CMS Accountable Health Communities HRSN core-domain screening tool). A request to administer or score anything else is rejected before any screening runs — no ad-hoc or unvalidated social-needs questionnaire feeds a care-coordination flag. Mirrors the Assessment Agent's validated-instrument policy.",
    appliesTo: ["sdoh-screening-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.sdoh.consent-before-referral",
    name: "Patient consent required before a community referral",
    description:
      "The SDOH Screening Agent may draft a community-resource referral only with the patient's explicit consent — a community referral without consent is rejected before any draft is prepared for action, and the agent never autonomously enrolls a patient in a program. Every referral is a consent-gated, human-approval-gated DRAFT (211, food bank, housing/utility assistance, a domestic-violence hotline for the interpersonal-safety domain), never an autonomous enrollment. (In the prototype the community-resource catalog is a clearly-labeled illustrative synthetic, NOT a live directory of real programs; in production this is the customer's governed closed-loop referral network.)",
    appliesTo: ["sdoh-screening-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.benefits.eligibility-source-integrity",
    name: "Eligibility results must trace to a payer/clearinghouse EBV response",
    description:
      "Every coverage/eligibility result the Benefits Verification Agent returns must trace to a (mock) payer/clearinghouse EBV response — the agent may not fabricate coverage without a source. A returned result that carries no source provenance is rejected before it can drive a benefit estimate or precede routing. (In the prototype the EBV round-trip is a clearly-labeled deterministic synthetic; in production this is a real 270/271 or FHIR CoverageEligibilityResponse.)",
    appliesTo: ["benefits-verification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.scheduling.no-double-book",
    name: "No double-booking a taken slot",
    description:
      "The Appointment Scheduling Agent may not book a slot that is already taken on the provider's calendar. A request that targets an already-booked slot is rejected before any ServiceAppointment is written — the scheduler never double-books. (In the prototype the calendar is a clearly-labeled deterministic synthetic; in production this is a real Salesforce Scheduler / calendar availability check.)",
    appliesTo: ["appointment-scheduling-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.scheduling.honor-provider-availability",
    name: "Book only within published provider availability",
    description:
      "The Appointment Scheduling Agent may only book a slot that falls within the provider's published availability for the requested modality. A request for a time the provider does not publish (outside business hours, a non-offered modality, or a day with no availability) is rejected before any ServiceAppointment is written. (In the prototype availability is a deterministic synthetic calendar; in production this is the provider's real Salesforce Scheduler availability.)",
    appliesTo: ["appointment-scheduling-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.caregap.clinical-measure-sourced",
    name: "Care gaps must derive from a defined clinical measure",
    description:
      "Every care gap the Care Gap Closure Agent acts on must derive from a defined clinical measure in the measure catalog — it may not act on a fabricated / off-catalog gap. A gap that doesn't trace to a defined clinical measure is rejected before any outreach is drafted or handed to the Engagement Agent, so the agent can never invent a preventive-care need. (In the prototype the clinical measures + intervals are clearly-labeled illustrative synthetics, not a certified guideline engine; in production this is the customer's governed clinical-measure / HEDIS-style registry.)",
    appliesTo: ["care-gap-closure-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.careplan.template-sourced",
    name: "Care plans must derive from a defined template",
    description:
      "Every care plan the Care Plan Agent instantiates must derive from a defined CarePlanTemplate in the template catalog — it may not act on a fabricated / off-catalog plan. A plan that doesn't trace to a defined template is rejected before it is summarized or returned, so the agent can never invent a care plan. (In the prototype the templates + their goals/interventions/cadences are clearly-labeled illustrative synthetics, not a certified care-plan engine; in production this is the customer's governed Health Cloud CarePlan template library.)",
    appliesTo: ["care-plan-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical-summary.source-record-sourced",
    name: "Summaries must trace to source records (no fabrication)",
    description:
      "Every after-visit summary / clinician handoff the Clinical Summary Agent produces must trace to the defined source records the context was assembled from — it may not assert a clinical fact (or cite a record) that isn't grounded in what the upstream agents established. A summary that doesn't trace to a source record (a fabricated / off-context assertion, or one citing nothing at all) is rejected before it is returned, so the agent can never invent a clinical fact. The assembler gathers ONLY facts present in the provided lifecycle inputs, so this grounding property is real. (In the prototype the composed records are clearly-labeled synthetics, not a certified clinical-documentation engine; in production this is the customer's governed Health Cloud clinical record.)",
    appliesTo: ["clinical-summary-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.education.evidence-sourced",
    name: "Education must trace to a defined evidence source",
    description:
      "Every education module the Patient Education & Health Coaching Agent delivers must trace to a defined evidence-sourced module in the education catalog — it may not act on a fabricated / off-catalog topic, and every module must carry a source label. A module that doesn't trace to a defined evidence source is rejected before any coaching is written or returned, so the agent can never invent a health-education topic. (In the prototype the education modules + their source labels — The Menopause Society, USPSTF, NAMS/ACOG-style — are clearly-labeled illustrative synthetics, not a certified patient-education engine; in production this is the customer's governed, clinically-reviewed education library.)",
    appliesTo: ["patient-education-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.education.no-medical-advice",
    name: "General education only — no diagnosis, dosing, or individualized medical advice",
    description:
      "The Patient Education & Health Coaching Agent may deliver only general, evidence-sourced education and lifestyle coaching. It may NOT diagnose, prescribe or dose medication, or give individualized medical advice beyond general education. A task that asserts it will cross into diagnosis, medication dosing, or individualized medical advice is rejected before any coaching is written — the agent stays strictly within education scope and defers clinical decisions to a clinician.",
    appliesTo: ["patient-education-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.education.consent-before-outreach",
    name: "Patient consent required before a coaching outreach push",
    description:
      "The Patient Education & Health Coaching Agent may draft coaching content only with the patient's explicit consent to coaching outreach — a coaching push without consent is rejected before any draft is prepared for action, and the agent never autonomously sends a message. Every coaching outreach is a consent-gated, human-approval-gated DRAFT, never an autonomous send. Mirrors the SDOH Screening Agent's consent-before-referral policy.",
    appliesTo: ["patient-education-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.medication.no-autonomous-refill",
    name: "No autonomous medication refill",
    description:
      "The Medication Adherence Agent may draft a refill/adherence nudge but may NOT autonomously submit or order a medication refill. Any refill action that lacks a human-in-the-loop approval is rejected before it can be committed — the agent only ever nudges a human to refill; a clinician/pharmacist orders the refill. (In the prototype the medication catalog + days-supply/refill intervals are clearly-labeled illustrative synthetics, not a certified pharmacy / e-prescribing system; in production this is the customer's governed Health Cloud MedicationRequest / e-prescribing workflow.)",
    appliesTo: ["medication-adherence-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.rpm.reading-source-integrity",
    name: "Monitoring readings must trace to a device/self-report source",
    description:
      "Every longitudinal reading the Remote Patient Monitoring Agent ingests must trace to a recognized device/self-report source (self-report, wearable, device, clinic-device) AND a defined monitored metric — it may not act on a fabricated / off-source reading. A reading that doesn't trace to a source (or references an off-catalog metric) is rejected before any trend is detected or escalated, so the agent can never trend or escalate on invented data. (In the prototype the monitored metrics + thresholds are clearly-labeled illustrative synthetics, not a certified remote-monitoring device; in production this is the customer's governed device-integration / RPM feed.)",
    appliesTo: ["remote-monitoring-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.rpm.no-autonomous-escalation",
    name: "No autonomous clinical escalation/action — route to a clinician",
    description:
      "The Remote Patient Monitoring Agent may detect a worsening / red-flag trend but may NOT act on it autonomously — every escalation must be routed to a human clinician for review (routedTo:'clinician-review'). Any escalation asserted as an autonomous clinical action (auto-ordering, auto-medication, auto-titration) is rejected before it can leave the fabric — the agent only ever monitors and routes; a clinician reviews and acts. Mirrors the Medication Adherence Agent's no-autonomous-refill posture.",
    appliesTo: ["remote-monitoring-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.rpm.consent-to-monitor",
    name: "Patient consent required before longitudinal monitoring",
    description:
      "The Remote Patient Monitoring Agent may ingest longitudinal readings and route trend-based escalations only for a patient who has consented to be monitored — monitoring / trend outreach without the patient's monitoring consent is rejected before any assessment is acted on, and the agent never monitors a patient who hasn't opted in. Every monitoring run is consent-gated. Mirrors the SDOH Screening Agent's consent-before-referral policy.",
    appliesTo: ["remote-monitoring-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pophealth.transparent-risk-model",
    name: "Risk stratification must trace to a transparent, documented risk model",
    description:
      "Every patient's risk tier the Population Health & Risk Stratification Agent assigns must trace to the documented risk-factor spec — a transparent, additive/weighted function of a defined set of risk factors, each explainable by citing its contributing factors. It may not stratify on an opaque / black-box / off-spec score. A tier that doesn't trace to the defined factors (an off-catalog factor, a score that doesn't sum from its factors, or a tier that doesn't follow from the cutoffs) is rejected before any worklist is acted on, so the agent can never prioritize a patient on an unexplainable score. (In the prototype the risk factors + weights + cutoffs are clearly-labeled illustrative synthetics, not a certified risk-adjustment model; in production this is the customer's governed, validated risk-stratification model.)",
    appliesTo: ["population-health-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pophealth.no-protected-class-factors",
    name: "No protected-class attributes as risk factors (fairness / responsible-AI)",
    description:
      "The Population Health & Risk Stratification Agent's risk model may NOT use a protected-class attribute (race, ethnicity, gender identity, religion, national origin, disability status, sexual orientation, marital status) as a scoring factor — a fairness / responsible-AI requirement. A model that asserts a protected-class attribute was used as a scoring factor is rejected before any stratification is acted on; the model may score only on permitted clinical / care-management factors. This makes the risk stratification defensible against discriminatory-scoring concerns.",
    appliesTo: ["population-health-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pophealth.no-autonomous-care-decision",
    name: "No autonomous care decision — a tier requires human review",
    description:
      "The Population Health & Risk Stratification Agent may assign a risk tier but may NOT let that tier autonomously trigger a care action — a risk tier is a prioritization signal only. Any tier→action asserted as autonomous (auto-enrollment in a program, an auto-committed outreach or intervention) is rejected before it can leave the fabric; every tier→action requires human / care-manager review (routedTo:'care-manager-review'). The agent only ever produces a prioritized worklist for a human; a care manager reviews and acts. Mirrors the Remote Patient Monitoring Agent's no-autonomous-escalation posture.",
    appliesTo: ["population-health-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.consent.recorded-source",
    name: "Every consent state must trace to a recorded consent event/basis",
    description:
      "Every consent state the Consent & Preferences Management Agent holds or acts on must trace to a recorded consent event/basis — a recognized scope + status, a timestamp, and a non-empty recorded source (patient-portal, signed-hipaa-authorization, care-plan-enrollment, unsubscribe-link, etc.). An asserted-but-unrecorded consent (an off-catalog scope, an unrecognized status, or a state with no recorded source) is rejected before any decision is acted on, so the authoritative ledger can never hold consent it can't evidence. (In the prototype the consent scopes + recorded sources are clearly-labeled illustrative synthetics, not a certified consent-management system; in production this is the customer's governed consent ledger / preference center with a signed audit trail.)",
    appliesTo: ["consent-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.consent.honor-revocation",
    name: "A revoked or expired consent must be honored immediately",
    description:
      "The Consent & Preferences Management Agent must honor a revocation — or an expiry — immediately: a consent decision may NEVER ALLOW outreach / data-use against a scope whose relied-on consent is revoked or expired. A decision that would allow against a revoked / expired scope is rejected before it can leave the fabric, so a patient who revokes (or whose authorization lapses) is never contacted against that scope. This is the load-bearing property the other agents' consent-before-outreach / consent-to-monitor gates depend on. Mirrors the Remote Patient Monitoring Agent's no-autonomous-escalation posture — the safe answer is enforced, not merely advised.",
    appliesTo: ["consent-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.consent.no-scope-override",
    name: "A decision may not override a scope's consent",
    description:
      "The Consent & Preferences Management Agent may NOT let a decision override a withheld scope, or borrow consent for a scope the patient never granted — an ALLOW requires a granted, current consent record for that EXACT scope. A decision that would allow against a withheld or ungranted scope is rejected before it can leave the fabric, so consent granted for one purpose can never be silently reused for another. Consent is per-scope and non-transferable; this keeps the authoritative ledger defensible against scope-creep concerns.",
    appliesTo: ["consent-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trials.eligibility-criteria-sourced",
    name: "Trial eligibility must trace to defined criteria",
    description:
      "Every trial-eligibility determination the Clinical Trials & Research Matching Agent makes must trace to the study catalog's DEFINED eligibility criteria — a fabricated / ad-hoc / off-catalog eligibility (a matched or failed criterion that isn't a defined criterion) is rejected before any match is acted on, so the agent can never invent eligibility a study protocol doesn't define. Mirrors the Care Gap Closure Agent's clinical-measure-sourced integrity posture. (In the prototype the study catalog + criteria are clearly-labeled illustrative synthetics, not real studies or a certified eligibility engine; in production this is the customer's governed trial registry / eligibility rule set.)",
    appliesTo: ["clinical-trials-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trials.research-consent-required",
    name: "Research consent required before trial outreach",
    description:
      "The Clinical Trials & Research Matching Agent may NOT draft an active trial outreach — or take any enrollment step — without the patient's RESEARCH consent. An active (drafted) outreach asserted without research consent is rejected before it can leave the fabric; when research consent is absent the agent WITHHOLDS outreach (a safe completed answer, not a block). It defers to the `research` consent scope the Consent & Preferences Management Agent holds (withheld by default in the demo ledger). Mirrors the SDOH / Patient Education / Remote Monitoring consent-before-outreach gates.",
    appliesTo: ["clinical-trials-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trials.no-autonomous-enrollment",
    name: "No autonomous trial enrollment",
    description:
      "The Clinical Trials & Research Matching Agent may NEVER enroll a patient in a study autonomously — enrollment requires informed consent AND a human. Every outreach the agent drafts is requiresHuman:true / enrolled:false (there is no 'enrolled' state); an outreach asserted as enrolled, or one that doesn't require a human, is rejected before it can leave the fabric. Mirrors the Remote Patient Monitoring Agent's no-autonomous-escalation and the Prior Authorization Agent's no-autonomous-submission posture — the agent proposes a consent-gated invitation to consider, a human enrolls.",
    appliesTo: ["clinical-trials-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.langaccess.qualified-interpreter-only",
    name: "Clinical interpretation requires a qualified medical interpreter",
    description:
      "The Language Access & Health Equity Agent may only propose a QUALIFIED medical interpreter for clinical communication — an untrained / ad-hoc / family interpreter (or a minor, or machine translation) for clinical communication or consent is rejected before it can leave the fabric. When no qualified interpreter is available for a language the agent ESCALATES to a human language-access coordinator (a safe completed answer, not a block) — it NEVER substitutes an unqualified fallback. Mirrors the Remote Patient Monitoring Agent's no-autonomous-escalation and the Clinical Trials Agent's no-autonomous-enrollment posture — the safe answer is enforced, not merely advised. (In the prototype the interpreter roster is a clearly-labeled illustrative synthetic; in production this is the customer's governed qualified-interpreter program.)",
    appliesTo: ["language-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.langaccess.translated-material-source-integrity",
    name: "In-language materials must trace to an approved translated source",
    description:
      "Every in-language patient material the Language Access & Health Equity Agent presents as official must trace to the APPROVED translated-materials catalog — an unverified / ad-hoc translation presented as an official document, or an off-catalog document, is rejected before it can leave the fabric, so the agent can never pass off an unapproved translation as official. Mirrors the Care Gap Closure Agent's clinical-measure-sourced and the Clinical Trials Agent's eligibility-criteria-sourced integrity posture. (In the prototype the approved-materials catalog + provenance labels are clearly-labeled illustrative synthetics, not a real translated-document library; in production this is the customer's governed translated-materials library.)",
    appliesTo: ["language-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.langaccess.no-machine-translation-for-consent",
    name: "No machine translation for clinical consent",
    description:
      "The Language Access & Health Equity Agent may NOT use machine / auto translation for clinical consent or clinical decision communication — a plan that would machine-translate clinical consent is rejected before it can leave the fabric. Clinical consent and clinical-decision communication for an LEP patient go through a qualified human interpreter or an approved translated document, never an unmonitored machine translation. Mirrors the qualified-interpreter-only posture — a patient-safety / equity requirement, enforced not merely advised.",
    appliesTo: ["language-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.hedis.measure-catalog-sourced",
    name: "HEDIS measures must trace to the defined catalog",
    description:
      "Every HEDIS quality measure in a report the HEDIS & Quality Reporting Agent produces (and every measure id in the submission package it assembles) must trace to the defined HEDIS measure catalog — an off-catalog / fabricated measure is rejected before it can leave the fabric, so the agent can never quietly report against a measure it invented. Mirrors the Care Gap Closure Agent's clinical-measure-sourced, the Clinical Trials Agent's eligibility-criteria-sourced, and the Population Health Agent's transparent-risk-model integrity posture. (In the prototype the measure catalog is a clearly-labeled illustrative synthetic — NOT NCQA-certified HEDIS specifications, real value sets, or a certified HEDIS engine; in production this is the customer's licensed HEDIS measure library.)",
    appliesTo: ["hedis-quality-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.hedis.exclusion-integrity",
    name: "HEDIS exclusions must trace to a catalog exclusion",
    description:
      "Every denominator exclusion the HEDIS & Quality Reporting Agent applies to a measure must trace to a defined exclusion entry on that measure's catalog spec — an ad-hoc / unlisted exclusion is rejected before it can leave the fabric. This is the load-bearing rate-integrity guard: inflating a compliance rate by shrinking the denominator with an unlisted exclusion is a classic HEDIS-integrity violation. Mirrors the Prior Authorization Agent's documentation-integrity and the Care Gap Closure Agent's clinical-measure-sourced posture — an integrity property enforced, not merely advised.",
    appliesTo: ["hedis-quality-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.hedis.no-autonomous-submission",
    name: "No autonomous HEDIS submission",
    description:
      "The HEDIS & Quality Reporting Agent may NEVER autonomously submit a quality-measure package to a payer / CMS / a quality registry — every submission requires a human quality-team approval. Every submission package the agent produces is requiresQualityTeamApproval:true / submitted:false (there is no autonomous 'submitted' state); a caller-asserted plan that claims already-submitted or bypasses the human approval gate is rejected before it can leave the fabric. Mirrors the Prior Authorization Agent's no-autonomous-submission, the Population Health Agent's no-autonomous-care-decision, and the Clinical Trials Agent's no-autonomous-enrollment posture — the agent proposes a package, a human files it.",
    appliesTo: ["hedis-quality-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.acp.directive-source-integrity",
    name: "ACP directives must trace to the catalog and an approved source",
    description:
      "Every advance directive the Advance Care Planning Agent reports as ON FILE for a patient must trace to the defined ACP directive catalog AND to an approved directive-source label with a recorded execution date — an off-catalog directive id, an unapproved / verbal / ad-hoc source, or a missing execution date is rejected before it can leave the fabric, so the agent cannot fabricate a directive on file to inflate ACP completeness. Mirrors the Care Gap Closure Agent's clinical-measure-sourced, the HEDIS Agent's measure-catalog-sourced, and the Clinical Trials Agent's eligibility-criteria-sourced integrity posture. (In the prototype the directive catalog + approved-source labels are clearly-labeled illustrative synthetics — NOT a certified advance-directives registry; in production this is the customer's governed directives library.)",
    appliesTo: ["advance-care-planning-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.acp.no-autonomous-directive-change",
    name: "No autonomous advance-directive change",
    description:
      "The Advance Care Planning Agent may NEVER autonomously create, update, or override a patient's advance directive — a directive is a legal / clinical instrument, not an agent action. Every directive-change proposal is requiresClinicianAndPatientSignoff:true / applied:false; a caller-asserted plan that would autonomously apply a directive change or bypass the sign-off gate is rejected before it can leave the fabric. Mirrors the Prior Authorization Agent's no-autonomous-submission, the Medication Adherence Agent's no-autonomous-refill, the HEDIS Agent's no-autonomous-submission, and the Clinical Trials Agent's no-autonomous-enrollment posture — the agent proposes a conversation, a clinician + the patient sign off on any change.",
    appliesTo: ["advance-care-planning-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.acp.language-access-integrity",
    name: "ACP conversation must satisfy language access for LEP patients",
    description:
      "For a limited-English-proficiency (LEP) patient — preferred language other than the clinical default (English) — the Advance Care Planning Agent must not draft an ACTIVE conversation prompt without a documented QUALIFIED-INTERPRETER plan; an ACP conversation is legally consequential and must not be held in a language the patient cannot participate in. When no interpreter plan is documented the agent WITHHOLDS the active prompt (a safe completed answer — state:'withheld-language-access-required'), deferring to the Language Access & Health Equity agent. A caller-asserted plan claiming an active drafted prompt for an LEP patient with no interpreter plan is rejected before it can leave the fabric. Mirrors the Language Access Agent's qualified-interpreter-only and no-machine-translation-for-consent posture — patient-safety / equity requirement, enforced not merely advised.",
    appliesTo: ["advance-care-planning-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.careteam.role-catalog-sourced",
    name: "Care-team roles must trace to the defined catalog",
    description:
      "Every care-team role the Care Team & Case Management Agent lists — both the members it puts on the roster and the roles it claims are needed for the patient — must trace to the defined care-role catalog; an off-catalog / fabricated discipline or role label is rejected before it can leave the fabric, so the agent cannot pad a roster with an invented 'concierge liaison' or claim coverage for a needed role that doesn't exist. Mirrors the HEDIS Agent's measure-catalog-sourced, the ACP Agent's directive-source-integrity, and the Care Gap Closure Agent's clinical-measure-sourced posture — a load-bearing integrity property, enforced not merely advised. (In the prototype the care-role catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed discipline schema.)",
    appliesTo: ["care-team-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.careteam.no-autonomous-assignment",
    name: "No autonomous care-team assignment",
    description:
      "The Care Team & Case Management Agent may NEVER autonomously add or remove a clinician from the care team (or reassign the case manager) — every roster change requires the assigned case manager's approval. Every team-change proposal the agent produces is requiresCaseManagerApproval:true / applied:false; a caller-asserted plan that would autonomously apply a team change or bypass the case manager is rejected before it can leave the fabric. Mirrors the ACP Agent's no-autonomous-directive-change, the Prior Authorization Agent's no-autonomous-submission, and the HEDIS Agent's no-autonomous-submission posture — the agent proposes a change, a human coordinator approves it.",
    appliesTo: ["care-team-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.careteam.pcp-required",
    name: "Care team must include a PCP anchor",
    description:
      "A legitimate multi-disciplinary care team must include a primary care physician (role.pcp) — the continuity-of-care anchor every specialist coordinates around. A roster shipping without an accountable PCP is rejected before it can leave the fabric. This is a load-bearing continuity-of-care invariant: it prevents an assembly from quietly shipping a specialist-only team with no accountable primary-care owner. (In the prototype the PCP role is a clearly-labeled illustrative catalog id; in production this is the customer's governed PCP-of-record definition.)",
    appliesTo: ["care-team-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.toc.reconciliation-source-integrity",
    name: "TOC reconciliation medications must cite an approved source",
    description:
      "Every medication on the transitions-of-care reconciliation (pre-admit or discharge) must cite an approved medication source (pre-admit-verified, discharge-order, patient-verified, ehr-scanned-with-provenance) — a verbal / ad-hoc / undocumented source is rejected before it can leave the fabric. This is the load-bearing safety property that prevents a fabricated medication from slipping into the reconciliation. Mirrors the ACP Agent's directive-source-integrity, the HEDIS Agent's measure-catalog-sourced, and the Medication Adherence Agent's source posture. (In the prototype the approved-source list is a clearly-labeled illustrative synthetic; in production this is the customer's governed medication-source policy.)",
    appliesTo: ["transitions-of-care-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.toc.no-autonomous-medication-change",
    name: "No autonomous TOC medication change",
    description:
      "The Discharge & Transitions of Care Agent may NEVER autonomously commit a medication add / remove / dose-change on the reconciliation — every change requires clinician sign-off. Every reconciliation-change proposal is requiresClinicianSignoff:true / applied:false; a caller-asserted plan that would autonomously apply a medication change or bypass the sign-off gate is rejected before it can leave the fabric. Mirrors the Medication Adherence Agent's no-autonomous-refill, the ACP Agent's no-autonomous-directive-change, the Prior Authorization Agent's no-autonomous-submission, and the HEDIS Agent's no-autonomous-submission posture.",
    appliesTo: ["transitions-of-care-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.toc.follow-up-scheduled-not-recommended",
    name: "TOC follow-up must be a scheduled slot, not a recommendation",
    description:
      "The Discharge & Transitions of Care Agent's follow-up must be a SCHEDULED appointment (slotStart + providerRef + modality) or explicitly awaiting-schedule (state:'awaiting-schedule', a safe interim answer with a handoff to the Appointment Scheduling agent) — a package claiming a 'scheduled' or 'complete' follow-up without a real slot is rejected before it can leave the fabric. This is the load-bearing 30-day-readmission property: 'recommended' follow-ups that never get booked are the classic transitions-of-care failure mode. (In the prototype the follow-up window is a clearly-labeled illustrative synthetic; in production this is the customer's governed transitions-of-care SLA.)",
    appliesTo: ["transitions-of-care-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.grievance.no-autonomous-resolution",
    name: "No autonomous grievance / appeal resolution",
    description:
      "The Grievance & Appeals Agent may NEVER autonomously resolve, approve, or deny a grievance / appeal case — every case is queued for human review, and every resolution proposal requires the assigned human queue (member-services / clinical-review / compliance) to action it. Every proposal is requiresHumanQueueAction:true / applied:false; a caller-asserted plan that would autonomously resolve a case or bypass the queue is rejected before it can leave the fabric. A denial-appeal decision in particular needs a clinician-plus-compliance human review. Mirrors the Prior Authorization Agent's no-autonomous-submission, the ACP Agent's no-autonomous-directive-change, the Care Team Agent's no-autonomous-assignment, and the HEDIS Agent's no-autonomous-submission posture — the agent proposes, humans resolve.",
    appliesTo: ["grievance-appeals-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.grievance.deadline-integrity",
    name: "Grievance / appeal deadlines must trace to the catalog",
    description:
      "Every grievance / appeal case must have a regulatory deadline that traces to the case-type catalog (which specifies the deadline window in days from received date) and does NOT exceed the catalog's regulatory maximum — an off-catalog case-type or a silently-extended deadline is rejected before it can leave the fabric. This is the load-bearing regulatory-compliance property: silently extending a regulatory deadline past the maximum is a common way cases quietly breach Medicare Advantage Chapter 13 or state-insurance-code timelines. (In the prototype the case-type catalog + windows are clearly-labeled illustrative synthetics — 3d for expedited coverage-denial appeals, 30d for standard appeals and grievances is the SHAPE of regulation, not certified; in production this is the customer's governed regulatory-timeline policy.)",
    appliesTo: ["grievance-appeals-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.grievance.no-phi-in-routing-summary",
    name: "Grievance routing summary must be PHI-safe",
    description:
      "The routing summary the Grievance & Appeals Agent hands to the receiving human queue (member-services / clinical-review / compliance) must be STRUCTURED only (memberRef + caseType + urgency + queue + deadlineDate + phiSafe) and MUST NOT contain free-text PHI (patient full name, DOB, address, MRN, diagnosis codes, medication names, symptom detail) or an extra free-text key — a routing summary containing free-text PHI, or an extra key beyond the allow-list, is rejected before it can leave the fabric. This lets compliance / member-services queues be reached via lower-trust channels (Slack, email, ticketing) without leaking PHI; the free-text complaint stays on the case record itself. Mirrors the phi-no-free-text-pii posture on the intake / assessment agents.",
    appliesTo: ["grievance-appeals-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.credentialing.source-integrity",
    name: "Provider credentials must cite an approved verification source",
    description:
      "Every credential on a provider's record (state license, DEA, board certification, sanctions clearance, NPI) that the Provider Credentialing & Directory Agent surfaces must cite an approved verification source (state-medical-board, dea-registry, abms-board, oig-leie-sanctions, npi-registry) with a recorded verifiedOn date — a self-reported / verbal / undocumented / off-catalog source is rejected before it can leave the fabric. This closes the load-bearing safety failure of fabricating a 'verified' status from a hand-typed claim. Mirrors the ACP Agent's directive-source-integrity, the HEDIS Agent's measure-catalog-sourced, and the TOC Agent's reconciliation-source-integrity posture — an integrity property enforced, not merely advised.",
    appliesTo: ["provider-credentialing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.credentialing.no-referral-to-expired-or-sanctioned",
    name: "No referral or booking to an expired / incomplete / sanctioned provider",
    description:
      "The Pause Agent Fabric may NEVER hand a referral or a scheduled appointment to a provider whose credentialing status is expired, incomplete, or sanctioned — the Provider Credentialing & Directory Agent gates the network boundary here. A referral / scheduling call to such a provider is rejected before it can leave the fabric. This is where the ghost-network problem gets fixed: the Referral Management, Appointment Scheduling, and Transitions of Care agents consult this gate before every handoff. Mirrors the CAQH ProView / NCQA credentialing posture — a network-integrity requirement enforced, not merely advised.",
    appliesTo: ["provider-credentialing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.credentialing.no-surprises-act-directory-accuracy",
    name: "Directory responses must satisfy No-Surprises-Act freshness",
    description:
      "A provider directory record the Provider Credentialing & Directory Agent returns as AUTHORITATIVE must have a verifiedAsOf date within the No-Surprises-Act 90-day accuracy window from the caller's asOfDate — a stale directory record returned as authoritative is rejected before it can leave the fabric. The safe interim answer when the record is stale is to route the caller to a directory-refresh workflow, not return the same authoritative record. Mirrors the No-Surprises-Act directory-accuracy posture — a regulatory / patient-protection requirement enforced, not merely advised. (In the prototype the freshness window is a clearly-labeled illustrative synthetic; in production this is the customer's governed NSA compliance window.)",
    appliesTo: ["provider-credentialing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.attribution.methodology-catalog-sourced",
    name: "Attribution methodology + contract must trace to the catalog",
    description:
      "Every patient attribution the Quality-Measure Attribution Agent produces must trace to a defined attribution methodology on the ATTRIBUTION_METHODOLOGIES catalog (plurality-of-visits, PCP-of-record, prospective Medicare Advantage, contract-defined window) AND a defined VBC contract on the VBC_CONTRACTS catalog — a bespoke / off-catalog / 'we-just-guessed' methodology or contract is rejected before it can leave the fabric. Mirrors the HEDIS Agent's measure-catalog-sourced, the ACP Agent's directive-source-integrity, and the Credentialing Agent's source-integrity posture — an integrity property enforced, not merely advised. (In the prototype the methodology and contract catalogs are clearly-labeled illustrative synthetics; in production these are the customer's governed VBC methodology and contract libraries.)",
    appliesTo: ["quality-attribution-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.attribution.no-conflicting-contract-terms",
    name: "Attributions must honor the VBC contract's exclusion terms",
    description:
      "The Quality-Measure Attribution Agent may NEVER assert an in-numerator attribution against a patient whose VBC contract terms (age band, network status, exclusion code) EXCLUDE them — a caller-asserted excludedByContract:false on a patient the contract would actually exclude is rejected before it can leave the fabric. This closes the load-bearing failure of polluting a contract's scorecard with patients the contract never covered. The agent's own analysis correctly sets excludedByContract:true when the contract terms exclude a patient (downstream HEDIS scoring then drops that attribution from the denominator); this policy catches a caller who overrides the flag dishonestly.",
    appliesTo: ["quality-attribution-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.attribution.tie-break-documented",
    name: "Attribution tie-breaks must be documented and deterministic",
    description:
      "When an attribution methodology ties on its primary metric (e.g. two providers with equal primary-care visit counts under plurality-of-visits), the tie-break rule applied must be one of the DOCUMENTED_TIE_BREAKS (most-recent-visit-wins, then provider-ref-lexical-ascending) — a coin-flip / opaque / undocumented tie-break is rejected before it can leave the fabric. This turns tie-break resolution from a gameable non-determinism into a fabric-verifiable invariant. (In the prototype the documented tie-break rules are clearly-labeled illustrative synthetics; in production this is the customer's governed VBC attribution tie-break policy.)",
    appliesTo: ["quality-attribution-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ccm.eligibility-catalog-sourced",
    name: "CCM eligibility must trace to the chronic-condition catalog",
    description:
      "Every Medicare CCM eligibility determination the Complex Care Management Agent produces must cite chronic conditions from the defined CHRONIC_CONDITION_CATALOG — an off-catalog / fabricated chronic condition is rejected before it can leave the fabric. Mirrors the ACP Agent's directive-source-integrity, the HEDIS Agent's measure-catalog-sourced, the Credentialing Agent's source-integrity, and the Attribution Agent's methodology-catalog-sourced posture — an integrity property enforced, not merely advised. (In the prototype the chronic-condition catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed CMS-aligned chronic-condition list.)",
    appliesTo: ["complex-care-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ccm.no-autonomous-billing",
    name: "No autonomous CCM claim submission",
    description:
      "The Complex Care Management Agent may NEVER autonomously submit a Medicare CCM claim (CPT 99490 / 99491 / 99487 / 99489) — every billing package requires a human quality-team approval. Every package the agent produces is requiresQualityTeamApproval:true / submitted:false; a caller-asserted plan that claims already-submitted or bypasses the human approval gate is rejected before it can leave the fabric. Mirrors the HEDIS Agent's no-autonomous-submission, the Prior Authorization Agent's no-autonomous-submission, and the ACP Agent's no-autonomous-directive-change posture — the agent proposes a package, a human files it with CMS.",
    appliesTo: ["complex-care-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ccm.time-integrity",
    name: "CCM time entries must add up and cite catalog activities",
    description:
      "Every logged CCM minute the Complex Care Management Agent tracks must trace to a defined activity on CCM_ACTIVITY_CATALOG (medication reconciliation, care-plan update, patient communication, referral follow-up, care-team coordination, patient education, resource navigation) — an off-catalog activity is rejected — AND the reported monthly total must equal the sum of the per-entry minutes. Phantom-minute inflation is the classic CCM audit finding this guard closes. (In the prototype the CCM activity catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed CMS-aligned care-coordination activity list.)",
    appliesTo: ["complex-care-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claims.edit-catalog-sourced",
    name: "Claim edits must trace to the edit catalog",
    description:
      "Every claim edit the Claims Adjudication Assistant applies must cite one of the defined CLAIM_EDIT_CATALOG entries (NCCI-PTP unbundling, LCD coverage, NCD coverage, benefit-limit exhausted, prior-auth missing, duplicate submission, out-of-network, timely-filing-window) — an off-catalog / fabricated 'you owe us more' edit is rejected before it can leave the fabric. Mirrors the ACP Agent's directive-source-integrity, the HEDIS Agent's measure-catalog-sourced, the Credentialing Agent's source-integrity, the Attribution Agent's methodology-catalog-sourced, and the CCM Agent's eligibility-catalog-sourced posture — an integrity property enforced, not merely advised. (In the prototype the edit catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed NCCI / LCD / NCD / benefit-config policy.)",
    appliesTo: ["claims-adjudication-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claims.no-autonomous-denial",
    name: "No autonomous claim denial",
    description:
      "The Claims Adjudication Assistant may NEVER autonomously finalize a claim denial — every denial is DRAFTED for adjudicator cosign. Every deny-drafted decision the agent produces is requiresAdjudicatorCosign:true / cosigned:false; a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. Denial letters are legally consequential under CMS / ERISA / state insurance code — a member is entitled to a written notice with appeal rights, which then goes to the Grievance & Appeals agent (the intake side). Mirrors the PA Agent's no-autonomous-submission, the HEDIS Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture.",
    appliesTo: ["claims-adjudication-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claims.reason-code-integrity",
    name: "Claim decisions must cite a specific catalog reason code",
    description:
      "Every non-clean-pay claim decision the Claims Adjudication Assistant returns must cite a specific reason code from the defined CLAIM_REASON_CODE_CATALOG (illustrative CO-97 unbundling / CO-50 LCD / CO-96 NCD / CO-119 benefit max / CO-197 no prior auth / CO-18 duplicate / CO-242 out-of-network / CO-29 timely filing) — a denial or pend with no reason code, or an off-catalog reason code, is rejected before it can leave the fabric. Under Section 1557 (non-discrimination), state insurance code, and CMS, a denial notice must state the specific reason — this policy enforces that at the fabric level. (In the prototype the reason-code catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed X12 CARC/RARC library.)",
    appliesTo: ["claims-adjudication-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.formulary.catalog-sourced",
    name: "Formulary drugs + rules must trace to the catalog",
    description:
      "Every proposed drug + applied rule + reason code in a formulary review must trace to the defined catalogs (FORMULARY_DRUG_CATALOG, FORMULARY_RULE_CATALOG, FORMULARY_REASON_CODE_CATALOG) — a fabricated drug, a 'we-just-said-no' rule, or an off-catalog reason code is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the ACP Agent's directive-source-integrity, the HEDIS Agent's measure-catalog-sourced, and the CCM Agent's eligibility-catalog-sourced posture. (In the prototype the formulary + rule catalogs are clearly-labeled illustrative synthetics; in production these are the customer's governed formulary file, DUR rules, and X12 CARC/RARC library.)",
    appliesTo: ["formulary-review-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.formulary.step-therapy-honored",
    name: "Step therapy must be honored with a documented prior-therapy trial",
    description:
      "When the plan requires step therapy for the proposed drug (a documented trial of a preferred agent before this non-preferred one), the Formulary & Drug Utilization Review Agent must verify DOCUMENTED prior-therapy history is on file — self-reported / undocumented / claimed-but-unverified therapy does NOT satisfy step therapy, and a decision approving on that basis is rejected before it can leave the fabric. Skipping step therapy or approving on undocumented history is a common payer-audit finding.",
    appliesTo: ["formulary-review-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.formulary.no-autonomous-override",
    name: "No autonomous formulary override / exception",
    description:
      "The Formulary & Drug Utilization Review Agent may NEVER autonomously override a formulary exception, non-preferred drug, or manual tier-lower — every non-preferred-approved decision is DRAFTED for clinician cosign (requiresClinicianCosign:true, cosigned:false); a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. Formulary exceptions are legally consequential (Medicare Advantage Chapter 6 + Part D require a documented rationale from a prescriber). Mirrors the Claims Adjudication Agent's no-autonomous-denial, the PA Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture.",
    appliesTo: ["formulary-review-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.model.anthropic-claude-sonnet-allowlisted",
    name: "Model allow-list",
    description:
      "Only models on the customer's approved list may serve clinical-decision agents. Default allow-list: claude-sonnet-4-5, claude-opus-4-7. Other models are blocked at policy evaluation time.",
    appliesTo: [
      "care-router-claude",
      "care-plan-agent",
      "clinical-summary-agent",
      "patient-education-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.no-prescribing",
    name: "No autonomous prescribing",
    description:
      "Clinical-decision agents may recommend pathways but may not write prescriptions, order labs, or commit clinical actions without a human-in-the-loop clinician. This also covers the Medication Adherence Agent: it may nudge a patient to refill but may not autonomously commit a refill order; and the Prior Authorization Agent: it may assemble a clinician-gated PA draft but may not autonomously submit a PA.",
    appliesTo: [
      "care-router-claude",
      "care-plan-agent",
      "medication-adherence-agent",
      "prior-authorization-agent",
      "clinical-summary-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.rationale-required",
    name: "Rationale required on every decision",
    description:
      "Every routing decision must include human-readable rationale. Decisions without rationale are rejected and re-issued to the model. This also covers the Referral Management Agent: every recommended outbound referral must carry a documented reason — a reasonless referral is rejected.",
    appliesTo: ["care-router-claude", "care-plan-agent", "referral-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.referral.clinician-cosign",
    name: "Clinician sign-off before an outbound referral is sent",
    description:
      "The Referral Management Agent may triage and draft an outbound referral but may NOT send it without a clinician's sign-off. A referral asserted as sent without a clinician cosign is rejected before it can leave the fabric — the agent only ever drafts a cosign-gated referral; a clinician reviews, signs, and sends it. (In the prototype the specialty catalog + triage are clearly-labeled illustrative synthetics, not a certified clinical referral engine; in production this is the customer's governed referral / order-entry workflow.)",
    appliesTo: ["referral-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.billing.claim-data-sourced",
    name: "Billing answers must trace to a claim/EOB record",
    description:
      "Every billing/claim answer the Member Service / Billing Agent returns must trace to a synthetic claim/EOB record — the agent may not fabricate claim data (a copay, balance, claim status, or EOB figure without a source). A caller-asserted billing answer that cites no claim record is rejected before it can be returned to a member, so the agent can never invent claim data. (In the prototype the claim/EOB records are clearly-labeled deterministic synthetics, not a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit; in production this is the customer's governed claims / payer system of record.)",
    appliesTo: ["member-service-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pa.no-autonomous-submission",
    name: "No autonomous prior-authorization submission",
    description:
      "The Prior Authorization Agent may assemble a prior authorization but may NOT autonomously submit it — a clinician must approve before submission. A PA submission asserted without a clinician's approval is rejected before it can leave the fabric; the agent only ever assembles a clinician-gated draft (requiresClinicianApproval:true, submitted:false), and a clinician reviews and submits it. (In the prototype the PA package is a clearly-labeled deterministic synthetic, NOT a real X12 278 / FHIR PAS EDI transaction or payer PA portal submission; in production this is the customer's governed utilization-management / CareRequest workflow.)",
    appliesTo: ["prior-authorization-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pa.documentation-integrity",
    name: "A PA submission must include the required supporting documentation",
    description:
      "A prior authorization the Prior Authorization Agent submits must include the required supporting documentation for the item — a submission missing a required document is rejected before it can leave the fabric, so the agent can never file an incomplete PA. Assembling a DRAFT with missing documentation is allowed (the draft honestly lists what is still outstanding); only a submission must be documentation-complete. (In the prototype the required-documentation checklist is a clearly-labeled illustrative synthetic, NOT a certified utilization-management requirement; in production this is the payer's real documentation-requirements rules — e.g. Da Vinci DTR.)",
    appliesTo: ["prior-authorization-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.fallback.deterministic-on-api-failure",
    name: "Deterministic fallback on model failure",
    description:
      "If the model API is unreachable or returns malformed output, the Care Router falls back to the deterministic Pause policy engine. Provenance always records which path served the decision.",
    appliesTo: ["care-router-claude"],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.mcp.tools-allowlisted",
    name: "MCP tool allow-list",
    description:
      "Only the four declared Pause MCP tools are callable. Any other tool invocation is rejected at the MCP server boundary.",
    appliesTo: ["pause-mcp"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mcp-bridge.remote-allowlist",
    name: "MCP Bridge remote allow-list",
    description:
      "The bridge may only connect to the same-origin loopback MCP server and the remotes explicitly declared in PAUSE_MCP_HOST_REMOTES. An arbitrary or unlisted remote URL is refused before any tool call is made.",
    appliesTo: ["mcp-bridge"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mcp-bridge.tool-allowlist",
    name: "MCP Bridge egress tool allow-list",
    description:
      "Only declared Pause tool names may be invoked through the bridge. This mirrors the server-side allow-list on the egress (client) side, so a compromised or misconfigured remote can't be coaxed into running an unlisted tool.",
    appliesTo: ["mcp-bridge"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mcp-bridge.no-cross-origin-bearer",
    name: "No cross-origin bearer forwarding",
    description:
      "An inbound bearer token is forwarded ONLY to the same-origin loopback remote, never to a cross-origin external MCP server. Credentials must not leak across the trust boundary. (Enforced in lib/mcp/host.ts today.)",
    appliesTo: ["mcp-bridge"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.phi.bearer-token-required-in-prod",
    name: "Bearer token required in production",
    description:
      "Production MCP calls must carry PAUSE_MCP_API_KEY tied to the customer's OAuth provider. The prototype is open by default; production deployments enforce this at the MuleSoft API gateway.",
    appliesTo: ["pause-mcp", "mulesoft-ingest"],
    enforcement: "block",
    status: "advisory"
  },
  {
    id: "policy.audit.return-mulesoft-correlation-id",
    name: "Correlation id round-trip",
    description:
      "Every MCP and MuleSoft API response carries a correlation id that is propagated into the A2A trace.",
    appliesTo: ["pause-mcp", "mulesoft-ingest"],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.network.mtls-required",
    name: "mTLS for system-to-system",
    description:
      "All Process / Experience API calls inside MuleSoft require mTLS. Enforced at the Anypoint API gateway.",
    appliesTo: ["mulesoft-ingest"],
    enforcement: "block",
    status: "advisory"
  },
  {
    id: "policy.data.fhir-r5-only",
    name: "FHIR R5 substrate",
    description:
      "Clinical data crossing MuleSoft Process / Experience tiers must be FHIR R5. Non-conforming payloads are rejected.",
    appliesTo: ["mulesoft-ingest", "pause-mcp"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.zero-copy-federation",
    name: "Zero-copy federation only",
    description:
      "Data 360 must federate into JupyterHealth, the customer's EHR, and the DBDP feature store via the Federation / Iceberg connector. Bulk ingestion of PHI into Salesforce is disallowed.",
    appliesTo: ["salesforce-data-360"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.consent-required-before-grounding",
    name: "Consent required before grounding",
    description:
      "Care Router grounding calls must be accompanied by an active 'ai-decision-support' consent in the patient's Data 360 consent ledger. Calls without consent are rejected with a redaction.",
    appliesTo: [
      "salesforce-data-360",
      "care-router-claude",
      "benefits-verification-agent",
      "care-gap-closure-agent",
      "care-plan-agent",
      "prior-authorization-agent",
      "clinical-summary-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.segment-activation-allowlist",
    name: "Segment activation allow-list",
    description:
      "Data 360 segments may activate only to the customer's approved downstream channels (Agentforce, Agent Fabric, Health Cloud, Marketing Cloud). Activations to unapproved channels are blocked.",
    appliesTo: ["salesforce-data-360"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.marketing.consent-to-contact-required",
    name: "Contact consent required for outreach",
    description:
      "Prospecting and engagement agents may only contact an individual who carries an active contact/marketing consent in the Data 360 consent ledger. Individuals without consent are suppressed from every audience before a message is ever drafted.",
    appliesTo: [
      "prospecting-agent",
      "engagement-agent",
      "care-gap-closure-agent",
      "medication-adherence-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.marketing.human-approval-before-send",
    name: "Human approval before any patient message",
    description:
      "Outreach and engagement messages are drafted for human review. No message is delivered to a prospect or patient without a human-in-the-loop approval — the prototype never sends autonomously.",
    appliesTo: [
      "prospecting-agent",
      "engagement-agent",
      "care-gap-closure-agent",
      "medication-adherence-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.marketing.nurture-cadence-cap",
    name: "Lead-nurture cadence cap + convert/opt-out suppression",
    description:
      "Prospect nurture sequences are capped in length and cadence (no more than the configured number of touches per rolling window). A prospect is removed from every active nurture sequence the moment they convert to intake, unsubscribe, or revoke contact consent — no post-conversion nurture noise. Excess touches are rate-limited until the window resets.",
    appliesTo: ["prospecting-agent"],
    enforcement: "rate-limit",
    status: "enforced"
  },
  {
    id: "policy.engagement.quiet-hours-and-channel-preference",
    name: "Quiet-hours + channel preference honored",
    description:
      "Engagement touches must fall inside the patient's quiet-hours window and use a channel the patient has opted into. Touches outside the window or on an unpreferred channel are blocked.",
    appliesTo: [
      "engagement-agent",
      "care-gap-closure-agent",
      "medication-adherence-agent"
    ],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.engagement.frequency-cap",
    name: "Engagement frequency cap",
    description:
      "No more than the configured number of engagement touches per patient per rolling window. Additional touches are rate-limited until the window resets.",
    appliesTo: ["engagement-agent"],
    enforcement: "rate-limit",
    status: "enforced"
  },
  {
    id: "policy.lead.explicit-optin-and-source-required",
    name: "Inbound lead needs explicit opt-in + source",
    description:
      "An inbound lead may only be persisted with an explicit, timestamped opt-in consent and a recorded acquisition source (site, web chat, or form). Anonymous or un-consented captures are discarded at the boundary and never stored.",
    appliesTo: ["inbound-lead-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lead.identity-resolution-before-create",
    name: "Identity resolution before lead creation",
    description:
      "Every inbound lead is resolved against Data 360 Identity Resolution before a record is created, so a returning patient or an existing prospect is merged rather than duplicated. Creation is blocked until the resolution step runs.",
    appliesTo: ["inbound-lead-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.qualification.rationale-required",
    name: "Qualification rationale required",
    description:
      "Every qualification decision — qualified OR disqualified — must carry a human-readable rationale naming the criteria that drove it. Decisions without rationale are rejected and re-issued.",
    appliesTo: ["qualification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.qualification.no-protected-class-criteria",
    name: "No protected-class qualification criteria",
    description:
      "Qualification may not use protected-class attributes (race, ethnicity, disability, sexual orientation, and the like) as criteria. Only care-fit, clinical eligibility, consent status, and expressed intent are permitted inputs.",
    appliesTo: ["qualification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.qualification.human-review-on-disqualify",
    name: "Disqualifications are reviewable",
    description:
      "Every disqualification is logged with its rationale and surfaced for human review. A lead is never permanently excluded on an automated decision alone.",
    appliesTo: ["qualification-agent"],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.commercial.no-phi-in-commercial-plane",
    name: "Commercial plane is PHI-free",
    description:
      "Commercial-operations agents (pipeline, account management) run on Sales Cloud commercial data only. They may not read, join, or derive patient PHI — the commercial plane and the clinical/PHI plane are strictly separated, and any cross-plane read is blocked. (This is also why these agents are NOT on the HIPAA audit policy: they never touch PHI.)",
    appliesTo: ["pipeline-management-agent", "account-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.commercial.forecast-integrity",
    name: "Forecast figures must trace to CRM",
    description:
      "Every forecast roll-up must derive from committed / best-case / pipeline CRM opportunity records. The agent may not fabricate or inflate pipeline; unsourced or synthetic figures are rejected.",
    appliesTo: ["pipeline-management-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.commercial.human-owner-before-contract-change",
    name: "Human owner before any contract change",
    description:
      "No renewal, pricing, or contract change is committed without a human account owner's approval. The agent drafts and recommends; a person commits.",
    appliesTo: ["account-management-agent"],
    enforcement: "block",
    status: "enforced"
  }
];

const TRACE_RING_CAP = 200;

type FabricStore = {
  traces: TraceSpan[];
};

const globalKey = "__pause_agent_fabric_store__" as const;
type GlobalWithStore = typeof globalThis & {
  [globalKey]?: FabricStore;
};

function store(): FabricStore {
  const g = globalThis as GlobalWithStore;
  if (!g[globalKey]) g[globalKey] = { traces: [] };
  return g[globalKey]!;
}

// Seed the ring buffer with one historical trace so the console isn't
// empty on first load. Real customer deployments would populate this
// from the persistent log store.
(function seedHistoricalTrace() {
  const s = store();
  if (s.traces.length > 0) return;
  const t0 = Date.now() - 1000 * 60 * 4;
  const taskId = "task-seed-historical-001";
  s.traces.push(
    {
      id: "span-seed-001",
      taskId,
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "rest",
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date(t0 + 1820).toISOString(),
      durationMs: 1820,
      status: "ok",
      attributes: { capturedFields: 6, redFlag: false }
    },
    {
      id: "span-seed-002",
      taskId,
      parentSpanId: "span-seed-001",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(t0 + 1820).toISOString(),
      finishedAt: new Date(t0 + 4140).toISOString(),
      durationMs: 2320,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        policiesEvaluated: 4
      }
    },
    {
      id: "span-seed-003",
      taskId,
      parentSpanId: "span-seed-002",
      agentId: "pause-mcp",
      agentName: "Pause MCP Server",
      operation: "mcp.get_patient_timeline",
      protocol: "mcp",
      startedAt: new Date(t0 + 4140).toISOString(),
      finishedAt: new Date(t0 + 4490).toISOString(),
      durationMs: 350,
      status: "ok",
      attributes: { entries: 5, mulesoftCorrelationId: "mule-corr-9d3b2a" }
    }
  );

  // A second illustrative trace showing the patient-lifecycle agents
  // (Prospecting & Nurture + Engagement) in one end-to-end flow: a Data
  // 360 segment produces a consented prospect, the Prospecting & Nurture
  // agent drafts outreach and advances a multi-touch nurture cadence
  // (human-approval-gated, never auto-sent), the warmed prospect converts
  // into a real intake + Care Router decision, and the Engagement Agent
  // schedules the follow-up cadence from that pathway. Like the trace
  // above, this is seed data — production populates the ring buffer from
  // the persistent log store.
  const g0 = Date.now() - 1000 * 60 * 9;
  const growthTaskId = "task-seed-growth-lifecycle-001";
  const prospectingName = "Agentforce Prospecting & Nurture Agent · Menopause Outreach";
  s.traces.push(
    {
      id: "span-growth-001",
      taskId: growthTaskId,
      agentId: "prospecting-agent",
      agentName: prospectingName,
      operation: "prospect.audience.qualify",
      protocol: "rest",
      startedAt: new Date(g0).toISOString(),
      finishedAt: new Date(g0 + 640).toISOString(),
      durationMs: 640,
      status: "ok",
      attributes: {
        segment: "vasomotor-burden-40-60",
        audienceSize: 214,
        consentSuppressed: 37,
        source: "salesforce-data-360"
      }
    },
    {
      id: "span-growth-002",
      taskId: growthTaskId,
      parentSpanId: "span-growth-001",
      agentId: "prospecting-agent",
      agentName: prospectingName,
      operation: "prospect.outreach.draft",
      protocol: "rest",
      startedAt: new Date(g0 + 640).toISOString(),
      finishedAt: new Date(g0 + 1180).toISOString(),
      durationMs: 540,
      status: "ok",
      attributes: {
        channel: "email",
        template: "menopause-education-v1",
        nurtureSequence: "menopause-education",
        touch: 1,
        humanApprovalRequired: true,
        sent: false
      }
    },
    {
      id: "span-growth-003",
      taskId: growthTaskId,
      parentSpanId: "span-growth-002",
      agentId: "prospecting-agent",
      agentName: prospectingName,
      operation: "prospect.nurture.advance",
      protocol: "rest",
      startedAt: new Date(g0 + 1180).toISOString(),
      finishedAt: new Date(g0 + 1700).toISOString(),
      durationMs: 520,
      status: "ok",
      attributes: {
        nurtureSequence: "menopause-education",
        touch: 2,
        leadScore: 72,
        scoreDelta: 18,
        cadenceDays: 4,
        humanApprovalRequired: true,
        sent: false
      }
    },
    {
      id: "span-growth-004",
      taskId: growthTaskId,
      parentSpanId: "span-growth-003",
      agentId: "qualification-agent",
      agentName: "Agentforce Qualification · Lead Scoring & Routing",
      operation: "qualification.decide",
      protocol: "a2a",
      startedAt: new Date(g0 + 1700).toISOString(),
      finishedAt: new Date(g0 + 2140).toISOString(),
      durationMs: 440,
      status: "ok",
      attributes: {
        decision: "qualified",
        score: 88,
        rationale: "ICP fit + expressed intent after 2 nurture touches; consent on file",
        protectedClassUsed: false,
        route: "intake"
      }
    },
    {
      id: "span-growth-005",
      taskId: growthTaskId,
      parentSpanId: "span-growth-004",
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "a2a",
      startedAt: new Date(g0 + 2140).toISOString(),
      finishedAt: new Date(g0 + 3970).toISOString(),
      durationMs: 1830,
      status: "ok",
      attributes: {
        capturedFields: 6,
        redFlag: false,
        convertedFromProspect: true,
        nurtureTouches: 2
      }
    },
    {
      id: "span-growth-006",
      taskId: growthTaskId,
      parentSpanId: "span-growth-005",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(g0 + 3970).toISOString(),
      finishedAt: new Date(g0 + 6180).toISOString(),
      durationMs: 2210,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929"
      }
    },
    {
      id: "span-growth-007",
      taskId: growthTaskId,
      parentSpanId: "span-growth-006",
      agentId: "engagement-agent",
      agentName: "Agentforce Engagement Agent · Care Continuity",
      operation: "engagement.followup.schedule",
      protocol: "rest",
      startedAt: new Date(g0 + 6180).toISOString(),
      finishedAt: new Date(g0 + 6860).toISOString(),
      durationMs: 680,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        cadenceDays: 14,
        channel: "sms",
        quietHoursRespected: true,
        humanApprovalRequired: true
      }
    }
  );

  // A third illustrative trace showing the INBOUND acquisition path
  // (the complement to the outbound prospecting flow above): a visitor
  // arrives via Agentforce web chat, the Inbound Lead Generation agent
  // captures an opt-in-consented lead, qualifies it against the
  // menopause-care ICP, resolves it against Data 360 Identity Resolution
  // (no duplicate), and — because the lead is ready — hands it straight
  // to Patient Intake over A2A. A not-yet-ready lead would instead be
  // enrolled into the Prospecting & Nurture cadence. Seed data.
  const i0 = Date.now() - 1000 * 60 * 6;
  const inboundTaskId = "task-seed-inbound-lead-001";
  const inboundName = "Agentforce Inbound Lead Generation · Site & Chat";
  s.traces.push(
    {
      id: "span-inbound-001",
      taskId: inboundTaskId,
      agentId: "inbound-lead-agent",
      agentName: inboundName,
      operation: "lead.capture",
      protocol: "rest",
      startedAt: new Date(i0).toISOString(),
      finishedAt: new Date(i0 + 300).toISOString(),
      durationMs: 300,
      status: "ok",
      attributes: {
        source: "web-chat",
        consentOptIn: true,
        consentAt: new Date(i0).toISOString()
      }
    },
    {
      id: "span-inbound-002",
      taskId: inboundTaskId,
      parentSpanId: "span-inbound-001",
      agentId: "inbound-lead-agent",
      agentName: inboundName,
      operation: "lead.qualify",
      protocol: "rest",
      startedAt: new Date(i0 + 300).toISOString(),
      finishedAt: new Date(i0 + 780).toISOString(),
      durationMs: 480,
      status: "ok",
      attributes: {
        icpMatch: true,
        ageBand: "46-50",
        leadScore: 81,
        readiness: "ready"
      }
    },
    {
      id: "span-inbound-003",
      taskId: inboundTaskId,
      parentSpanId: "span-inbound-002",
      agentId: "inbound-lead-agent",
      agentName: inboundName,
      operation: "lead.identity.resolve",
      protocol: "rest",
      startedAt: new Date(i0 + 780).toISOString(),
      finishedAt: new Date(i0 + 1120).toISOString(),
      durationMs: 340,
      status: "ok",
      attributes: {
        matched: false,
        action: "create",
        source: "salesforce-data-360"
      }
    },
    {
      id: "span-inbound-004",
      taskId: inboundTaskId,
      parentSpanId: "span-inbound-003",
      agentId: "inbound-lead-agent",
      agentName: inboundName,
      operation: "lead.route.handoff",
      protocol: "a2a",
      startedAt: new Date(i0 + 1120).toISOString(),
      finishedAt: new Date(i0 + 1360).toISOString(),
      durationMs: 240,
      status: "ok",
      attributes: {
        destination: "qualification-agent",
        readiness: "ready"
      }
    },
    {
      id: "span-inbound-005",
      taskId: inboundTaskId,
      parentSpanId: "span-inbound-004",
      agentId: "qualification-agent",
      agentName: "Agentforce Qualification · Lead Scoring & Routing",
      operation: "qualification.decide",
      protocol: "a2a",
      startedAt: new Date(i0 + 1360).toISOString(),
      finishedAt: new Date(i0 + 1760).toISOString(),
      durationMs: 400,
      status: "ok",
      attributes: {
        decision: "qualified",
        score: 84,
        rationale: "ICP fit (age band 46-50 + vasomotor signal) with active opt-in; ready to convert",
        protectedClassUsed: false,
        route: "intake"
      }
    },
    {
      id: "span-inbound-006",
      taskId: inboundTaskId,
      parentSpanId: "span-inbound-005",
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "a2a",
      startedAt: new Date(i0 + 1760).toISOString(),
      finishedAt: new Date(i0 + 3580).toISOString(),
      durationMs: 1820,
      status: "ok",
      attributes: { capturedFields: 6, redFlag: false, convertedFromInboundLead: true }
    }
  );

  // A fourth illustrative trace on the COMMERCIAL plane (Pause's own
  // B2B go-to-market), deliberately separate from the patient-care
  // traces above: the Pipeline Management agent works a provider-org
  // opportunity through to close-won, then hands the new customer to
  // the Account Management agent for onboarding + health scoring. Every
  // span carries phiAccessed:false — the commercial plane never touches
  // patient PHI. Seed data.
  const c0 = Date.now() - 1000 * 60 * 12;
  const commercialTaskId = "task-seed-commercial-001";
  const pipelineName = "Agentforce Pipeline Management · Provider-Org Deals";
  const accountName = "Agentforce Account Management · Customer Success";
  s.traces.push(
    {
      id: "span-comm-001",
      taskId: commercialTaskId,
      agentId: "pipeline-management-agent",
      agentName: pipelineName,
      operation: "pipeline.opportunity.review",
      protocol: "rest",
      startedAt: new Date(c0).toISOString(),
      finishedAt: new Date(c0 + 520).toISOString(),
      durationMs: 520,
      status: "ok",
      attributes: {
        opportunity: "Northwell Menopause Program",
        stage: "Proposal",
        dealHealth: "at-risk",
        nextBestAction: "schedule executive review",
        phiAccessed: false
      }
    },
    {
      id: "span-comm-002",
      taskId: commercialTaskId,
      parentSpanId: "span-comm-001",
      agentId: "pipeline-management-agent",
      agentName: pipelineName,
      operation: "pipeline.forecast.rollup",
      protocol: "rest",
      startedAt: new Date(c0 + 520).toISOString(),
      finishedAt: new Date(c0 + 980).toISOString(),
      durationMs: 460,
      status: "ok",
      attributes: {
        committed: 4,
        bestCase: 7,
        pipelineCount: 14,
        sourcedFromCrm: true,
        phiAccessed: false
      }
    },
    {
      id: "span-comm-003",
      taskId: commercialTaskId,
      parentSpanId: "span-comm-002",
      agentId: "pipeline-management-agent",
      agentName: pipelineName,
      operation: "pipeline.opportunity.close-won",
      protocol: "rest",
      startedAt: new Date(c0 + 980).toISOString(),
      finishedAt: new Date(c0 + 1240).toISOString(),
      durationMs: 260,
      status: "ok",
      attributes: {
        opportunity: "Northwell Menopause Program",
        stage: "Closed Won",
        planSeats: 1200,
        phiAccessed: false
      }
    },
    {
      id: "span-comm-004",
      taskId: commercialTaskId,
      parentSpanId: "span-comm-003",
      agentId: "account-management-agent",
      agentName: accountName,
      operation: "account.onboard",
      protocol: "a2a",
      startedAt: new Date(c0 + 1240).toISOString(),
      finishedAt: new Date(c0 + 1680).toISOString(),
      durationMs: 440,
      status: "ok",
      attributes: {
        account: "Northwell Menopause Program",
        planSeats: 1200,
        phiAccessed: false
      }
    },
    {
      id: "span-comm-005",
      taskId: commercialTaskId,
      parentSpanId: "span-comm-004",
      agentId: "account-management-agent",
      agentName: accountName,
      operation: "account.renewal.draft",
      protocol: "rest",
      startedAt: new Date(c0 + 1680).toISOString(),
      finishedAt: new Date(c0 + 2080).toISOString(),
      durationMs: 400,
      status: "ok",
      attributes: {
        account: "Northwell Menopause Program",
        healthScore: 78,
        churnRisk: "low",
        expansionSignal: true,
        renewalDraft: true,
        humanOwnerApprovalRequired: true,
        committed: false,
        phiAccessed: false
      }
    }
  );

  // A trace showing the MCP Bridge in action: an intake hands off to the
  // Care Router, which resolves providers by calling find_menopause_providers
  // THROUGH the bridge rather than the directory directly. The bridge tries
  // its ordered remote list — a configured external partner directory first
  // errors (unreachable), then the same-origin loopback (the Pause MCP Server)
  // succeeds; the bearer is forwarded only to that loopback. The tool then
  // executes on the Pause MCP Server. Seed data; production populates the ring
  // buffer from the persistent log store.
  const b0 = Date.now() - 1000 * 60 * 2;
  const bridgeTaskId = "task-seed-mcp-bridge-001";
  const bridgeName = "Pause MCP Bridge · A2A ↔ MCP egress";
  s.traces.push(
    {
      id: "span-bridge-001",
      taskId: bridgeTaskId,
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "rest",
      startedAt: new Date(b0).toISOString(),
      finishedAt: new Date(b0 + 1500).toISOString(),
      durationMs: 1500,
      status: "ok",
      attributes: { capturedFields: 6, redFlag: false }
    },
    {
      id: "span-bridge-002",
      taskId: bridgeTaskId,
      parentSpanId: "span-bridge-001",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(b0 + 1500).toISOString(),
      finishedAt: new Date(b0 + 3900).toISOString(),
      durationMs: 2400,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        policiesEvaluated: 4,
        mcpHostEnabled: true,
        mcpHostRemoteCount: 2
      }
    },
    {
      id: "span-bridge-003",
      taskId: bridgeTaskId,
      parentSpanId: "span-bridge-002",
      agentId: "mcp-bridge",
      agentName: bridgeName,
      operation: "mcp.bridge.find_menopause_providers",
      protocol: "mcp",
      startedAt: new Date(b0 + 3900).toISOString(),
      finishedAt: new Date(b0 + 4020).toISOString(),
      durationMs: 120,
      status: "error",
      attributes: {
        tool: "find_menopause_providers",
        remoteId: "external-partner-directory",
        crossOrigin: true,
        bearerForwarded: false,
        ok: false,
        error: "remote unreachable"
      }
    },
    {
      id: "span-bridge-004",
      taskId: bridgeTaskId,
      parentSpanId: "span-bridge-002",
      agentId: "mcp-bridge",
      agentName: bridgeName,
      operation: "mcp.bridge.find_menopause_providers",
      protocol: "mcp",
      startedAt: new Date(b0 + 4020).toISOString(),
      finishedAt: new Date(b0 + 4180).toISOString(),
      durationMs: 160,
      status: "ok",
      attributes: {
        tool: "find_menopause_providers",
        remoteId: "loopback",
        crossOrigin: false,
        bearerForwarded: true,
        toolAllowlisted: true,
        ok: true
      }
    },
    {
      id: "span-bridge-005",
      taskId: bridgeTaskId,
      parentSpanId: "span-bridge-004",
      agentId: "pause-mcp",
      agentName: "Pause MCP Server",
      operation: "mcp.find_menopause_providers",
      protocol: "mcp",
      startedAt: new Date(b0 + 4180).toISOString(),
      finishedAt: new Date(b0 + 4520).toISOString(),
      durationMs: 340,
      status: "ok",
      attributes: { providers: 3, mulesoftCorrelationId: "mule-corr-7c1f5e" }
    }
  );

  // A trace showing the Assessment Agent upgrading the intake → Care
  // Router spine: the agent administers and DETERMINISTICALLY scores a
  // validated instrument (here the MRS, total 21/44 → "severe"), the
  // scored severity feeds IntakeRecord.severity, and the enriched intake
  // hands off to the Care Router — so the routing decision is backed by a
  // real instrument score rather than a self-reported band. Scoring is
  // real math, not an LLM. Seed data; production populates the ring buffer
  // from the persistent log store.
  const a0 = Date.now() - 1000 * 60 * 3;
  const assessmentTaskId = "task-seed-assessment-001";
  const assessmentName = "Agentforce Assessment Agent · Validated Instruments";
  s.traces.push(
    {
      id: "span-assess-001",
      taskId: assessmentTaskId,
      agentId: "assessment-agent",
      agentName: assessmentName,
      operation: "assessment.score",
      protocol: "rest",
      startedAt: new Date(a0).toISOString(),
      finishedAt: new Date(a0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        instrument: "mrs",
        instrumentName: "Menopause Rating Scale (MRS)",
        total: 21,
        maxTotal: 44,
        severityBand: "severe",
        normalizedSeverity: "severe",
        redFlag: false,
        validatedInstrument: true,
        scoringMethod: "deterministic"
      }
    },
    {
      id: "span-assess-002",
      taskId: assessmentTaskId,
      parentSpanId: "span-assess-001",
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "a2a",
      startedAt: new Date(a0 + 40).toISOString(),
      finishedAt: new Date(a0 + 1600).toISOString(),
      durationMs: 1560,
      status: "ok",
      attributes: {
        capturedFields: 5,
        redFlag: false,
        severity: "severe",
        severitySource: "assessment:mrs"
      }
    },
    {
      id: "span-assess-003",
      taskId: assessmentTaskId,
      parentSpanId: "span-assess-002",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(a0 + 1600).toISOString(),
      finishedAt: new Date(a0 + 3900).toISOString(),
      durationMs: 2300,
      status: "ok",
      attributes: {
        pathway: "mscp-in-person",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        severityFromAssessment: "severe"
      }
    }
  );

  // A trace showing the Benefits & Coverage Verification (EBV) Agent
  // running a coverage check before intake hands off to routing: the
  // agent verifies eligibility for the MSCP visit (a DETERMINISTIC
  // synthetic EBV round-trip against a mock payer/clearinghouse — here
  // Aetna, in-network, deductible met, $60 estimated patient
  // responsibility), the eligibility summary is attached to the intake,
  // and the enriched intake hands off to the Care Router. Every returned
  // result traces to its (mock) EBV source — the honesty invariant the
  // source-integrity policy guards. Seed data; production populates the
  // ring buffer from the persistent log store.
  const v0 = Date.now() - 1000 * 60 * 5;
  const benefitsTaskId = "task-seed-benefits-001";
  const benefitsName =
    "Agentforce Benefits & Coverage Verification · Eligibility (EBV)";
  s.traces.push(
    {
      id: "span-benefits-001",
      taskId: benefitsTaskId,
      agentId: "benefits-verification-agent",
      agentName: benefitsName,
      operation: "benefits.verify",
      protocol: "rest",
      startedAt: new Date(v0).toISOString(),
      finishedAt: new Date(v0 + 60).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        payer: "Aetna",
        planName: "Aetna Choice PPO",
        eligibilityStatus: "active",
        network: "in-network",
        deductibleTotal: 1500,
        deductibleMet: 1500,
        deductibleRemaining: 0,
        coinsuranceRate: 0.2,
        estimatedVisitCost: 300,
        estimatedPatientResponsibility: 60,
        ebvTransactionId: "ebv-seed-aetna",
        sourced: true,
        synthetic: true
      }
    },
    {
      id: "span-benefits-002",
      taskId: benefitsTaskId,
      parentSpanId: "span-benefits-001",
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "a2a",
      startedAt: new Date(v0 + 60).toISOString(),
      finishedAt: new Date(v0 + 1600).toISOString(),
      durationMs: 1540,
      status: "ok",
      attributes: {
        capturedFields: 6,
        redFlag: false,
        coverageVerified: true,
        coverageNetwork: "in-network",
        estimatedPatientResponsibility: 60
      }
    },
    {
      id: "span-benefits-003",
      taskId: benefitsTaskId,
      parentSpanId: "span-benefits-002",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(v0 + 1600).toISOString(),
      finishedAt: new Date(v0 + 3800).toISOString(),
      durationMs: 2200,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        coverageVerifiedBeforeRouting: true
      }
    }
  );

  // A trace showing the Appointment Scheduling Agent closing the loop:
  // the Care Router recommends an MSCP telehealth visit, the scheduler
  // books the first open slot on the provider's (DETERMINISTIC synthetic)
  // calendar — honoring the requested modality, never double-booking, and
  // only booking within published availability — and then hands the booked
  // ServiceAppointment to the Engagement Agent for visit reminders. This is
  // the acquisition → intake → routing → BOOKING → engagement close. The
  // calendar is a MOCK, not a real Salesforce Scheduler write. Seed data;
  // production populates the ring buffer from the persistent log store.
  const sc0 = Date.now() - 1000 * 60 * 1;
  const schedulingTaskId = "task-seed-scheduling-001";
  const schedulingName =
    "Agentforce Appointment Scheduling · Book/Reschedule (MSCP)";
  s.traces.push(
    {
      id: "span-sched-001",
      taskId: schedulingTaskId,
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(sc0).toISOString(),
      finishedAt: new Date(sc0 + 2200).toISOString(),
      durationMs: 2200,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        recommendedProviders: 3,
        modality: "telehealth"
      }
    },
    {
      id: "span-sched-002",
      taskId: schedulingTaskId,
      parentSpanId: "span-sched-001",
      agentId: "appointment-scheduling-agent",
      agentName: schedulingName,
      operation: "scheduling.book",
      protocol: "rest",
      startedAt: new Date(sc0 + 2200).toISOString(),
      finishedAt: new Date(sc0 + 2320).toISOString(),
      durationMs: 120,
      status: "ok",
      attributes: {
        providerId: "1720394857",
        providerName: "Dr. Elena Vasquez, MD, MSCP",
        modality: "telehealth",
        serviceAppointmentId: "sa-seed-telehealth",
        slotStart: "2026-02-02T09:30:00",
        slotEnd: "2026-02-02T10:00:00",
        status: "booked",
        requestedSlotIsFree: true,
        slotWithinProviderAvailability: true,
        synthetic: true
      }
    },
    {
      id: "span-sched-003",
      taskId: schedulingTaskId,
      parentSpanId: "span-sched-002",
      agentId: "engagement-agent",
      agentName: "Agentforce Engagement Agent · Care Continuity",
      operation: "engagement.reminder.schedule",
      protocol: "a2a",
      startedAt: new Date(sc0 + 2320).toISOString(),
      finishedAt: new Date(sc0 + 2900).toISOString(),
      durationMs: 580,
      status: "ok",
      attributes: {
        serviceAppointmentId: "sa-seed-telehealth",
        remindersScheduled: 2,
        cadence: "24h + 1h before visit",
        channel: "sms",
        quietHoursRespected: true,
        humanApprovalRequired: true
      }
    }
  );

  // A trace showing the Care Gap Closure Agent working PROACTIVELY (not part of
  // the reactive intake→router flow): it grounds on the patient's Data 360
  // context, DETERMINISTICALLY detects menopause-relevant preventive-care gaps
  // (here bone-density/DEXA + mammogram), each sourced to a defined clinical
  // measure (never fabricated), drafts consent- and quiet-hours-aware outreach
  // per gap (human-approval-gated, never auto-sent), and hands the drafts to the
  // Engagement Agent for delivery. The clinical measures + intervals are
  // ILLUSTRATIVE synthetics, not a certified guideline engine. Seed data;
  // production populates the ring buffer from the persistent log store.
  const cg0 = Date.now() - 1000 * 60 * 7;
  const careGapTaskId = "task-seed-caregap-001";
  const careGapName =
    "Agentforce Care Gap Closure · Preventive Care (Health Cloud)";
  s.traces.push(
    {
      id: "span-caregap-001",
      taskId: careGapTaskId,
      agentId: "salesforce-data-360",
      agentName: "Salesforce Data 360 · Unified Patient Grounding",
      operation: "data360.grounding",
      protocol: "rest",
      startedAt: new Date(cg0).toISOString(),
      finishedAt: new Date(cg0 + 320).toISOString(),
      durationMs: 320,
      status: "ok",
      attributes: {
        unifiedPatientId: "pause-demo-patient-001",
        daysSinceClinicalContact: 412,
        cohort: "Cohort: 51-55 · primary hot_flashes"
      }
    },
    {
      id: "span-caregap-002",
      taskId: careGapTaskId,
      parentSpanId: "span-caregap-001",
      agentId: "care-gap-closure-agent",
      agentName: careGapName,
      operation: "caregap.detect",
      protocol: "rest",
      startedAt: new Date(cg0 + 320).toISOString(),
      finishedAt: new Date(cg0 + 360).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        asOf: "2026-02-02",
        gapsDetected: 2,
        measures: ["measure.bone-density-dexa", "measure.mammogram"],
        priorities: ["urgent", "elevated"],
        gapsTraceToClinicalMeasure: true,
        synthetic: true
      }
    },
    {
      id: "span-caregap-003",
      taskId: careGapTaskId,
      parentSpanId: "span-caregap-002",
      agentId: "care-gap-closure-agent",
      agentName: careGapName,
      operation: "caregap.outreach.draft",
      protocol: "rest",
      startedAt: new Date(cg0 + 360).toISOString(),
      finishedAt: new Date(cg0 + 420).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        measureId: "measure.bone-density-dexa",
        channel: "email",
        quietHoursRespected: true,
        humanApprovalRequired: true,
        suppressedForNoConsent: false,
        sent: false
      }
    },
    {
      id: "span-caregap-004",
      taskId: careGapTaskId,
      parentSpanId: "span-caregap-002",
      agentId: "care-gap-closure-agent",
      agentName: careGapName,
      operation: "caregap.outreach.draft",
      protocol: "rest",
      startedAt: new Date(cg0 + 420).toISOString(),
      finishedAt: new Date(cg0 + 480).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        measureId: "measure.mammogram",
        channel: "email",
        quietHoursRespected: true,
        humanApprovalRequired: true,
        suppressedForNoConsent: false,
        sent: false
      }
    },
    {
      id: "span-caregap-005",
      taskId: careGapTaskId,
      parentSpanId: "span-caregap-002",
      agentId: "engagement-agent",
      agentName: "Agentforce Engagement Agent · Care Continuity",
      operation: "engagement.outreach.handoff",
      protocol: "a2a",
      startedAt: new Date(cg0 + 480).toISOString(),
      finishedAt: new Date(cg0 + 900).toISOString(),
      durationMs: 420,
      status: "ok",
      attributes: {
        gapsHandedOff: 2,
        channels: ["email", "email"],
        humanApprovalRequired: true,
        sent: false
      }
    }
  );

  // A trace showing the Care Plan Agent working POST-VISIT, downstream of the
  // Care Router: the Router recommends a pathway, the Care Plan Agent
  // DETERMINISTICALLY instantiates a menopause care plan from a defined template
  // (here the vasomotor/lifestyle plan) — every plan traces to a template, never
  // fabricated — and then generates a patient/clinician progress SUMMARY. This
  // seeded example shows the DETERMINISTIC scripted-fallback path (via:
  // scripted-fallback, with a fallbackReason) so it doesn't imply a live Claude
  // call happened at seed time; at run time the summary is a live Claude call
  // with the same scripted fallback. The templates are ILLUSTRATIVE synthetics,
  // not a certified care-plan engine. Seed data; production populates the ring
  // buffer from the persistent log store.
  const cp0 = Date.now() - 1000 * 60 * 8;
  const carePlanTaskId = "task-seed-careplan-001";
  const carePlanName = "Pause Care Plan · Claude Sonnet 4.5";
  s.traces.push(
    {
      id: "span-careplan-001",
      taskId: carePlanTaskId,
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cp0).toISOString(),
      finishedAt: new Date(cp0 + 2200).toISOString(),
      durationMs: 2200,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        severity: "moderate"
      }
    },
    {
      id: "span-careplan-002",
      taskId: carePlanTaskId,
      parentSpanId: "span-careplan-001",
      agentId: "care-plan-agent",
      agentName: carePlanName,
      operation: "careplan.instantiate",
      protocol: "a2a",
      startedAt: new Date(cp0 + 2200).toISOString(),
      finishedAt: new Date(cp0 + 2240).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        templateId: "careplan.vasomotor-lifestyle",
        pathway: "mscp-virtual-visit",
        severity: "moderate",
        goals: 2,
        interventions: 3,
        followUpIntervalDays: 30,
        planTracesToTemplate: true,
        synthetic: true
      }
    },
    {
      id: "span-careplan-003",
      taskId: carePlanTaskId,
      parentSpanId: "span-careplan-002",
      agentId: "care-plan-agent",
      agentName: carePlanName,
      operation: "careplan.summarize",
      protocol: "a2a",
      startedAt: new Date(cp0 + 2240).toISOString(),
      finishedAt: new Date(cp0 + 2260).toISOString(),
      durationMs: 20,
      status: "ok",
      attributes: {
        templateId: "careplan.vasomotor-lifestyle",
        provider: "pause-scripted",
        model: "pause-care-plan-summarizer@1.0",
        via: "scripted-fallback",
        // Present ONLY on a scripted-fallback summary — the non-clinical
        // diagnostic explaining why the live Claude call was not used. This
        // seeded example is deterministic on purpose (no live call at seed time).
        fallbackReason:
          "ANTHROPIC_API_KEY not set; using deterministic Pause care-plan summarizer.",
        nonPrescriptive: true
      }
    }
  );

  // A trace showing the Clinical Summary Agent working POST-VISIT, downstream of
  // the whole lifecycle: it COMPOSES the outputs the other agents produced
  // (here the intake + Care Router pathway + the instantiated care plan) into a
  // patient-friendly After-Visit Summary and a clinician handoff. Assembly is
  // DETERMINISTIC and gathers ONLY facts present in the inputs (every summary
  // traces to a defined source record — never fabricated), and this seeded
  // example shows the DETERMINISTIC scripted-fallback path (via:
  // scripted-fallback, with a fallbackReason) so it doesn't imply a live Claude
  // call happened at seed time; at run time the phrasing is a live Claude call
  // with the same scripted fallback. It touches clinical context, so every span
  // sets phiAccessed:true. The artifacts are ILLUSTRATIVE synthetics, not a
  // certified clinical-documentation engine. Seed data; production populates the
  // ring buffer from the persistent log store.
  const cs0 = Date.now() - 1000 * 60 * 6;
  const clinicalSummaryTaskId = "task-seed-clinical-summary-001";
  const clinicalSummaryName = "Agentforce Clinical Summary Agent · After-Visit Summary";
  s.traces.push(
    {
      id: "span-clinsum-001",
      taskId: clinicalSummaryTaskId,
      agentId: "clinical-summary-agent",
      agentName: clinicalSummaryName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cs0).toISOString(),
      finishedAt: new Date(cs0 + 60).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-clinsum-002",
      taskId: clinicalSummaryTaskId,
      parentSpanId: "span-clinsum-001",
      agentId: "clinical-summary-agent",
      agentName: clinicalSummaryName,
      operation: "clinical-summary.assemble",
      protocol: "a2a",
      startedAt: new Date(cs0 + 60).toISOString(),
      finishedAt: new Date(cs0 + 90).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        sourceRecords: 3,
        summaryTracesToSourceRecords: true,
        // Composes existing synthetic clinical records for two audiences.
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-clinsum-003",
      taskId: clinicalSummaryTaskId,
      parentSpanId: "span-clinsum-002",
      agentId: "clinical-summary-agent",
      agentName: clinicalSummaryName,
      operation: "clinical-summary.summarize",
      protocol: "a2a",
      startedAt: new Date(cs0 + 90).toISOString(),
      finishedAt: new Date(cs0 + 110).toISOString(),
      durationMs: 20,
      status: "ok",
      attributes: {
        provider: "pause-scripted",
        model: "pause-clinical-summary-composer@1.0",
        via: "scripted-fallback",
        // Present ONLY on a scripted-fallback composition — the non-clinical
        // diagnostic explaining why the live Claude call was not used. This
        // seeded example is deterministic on purpose (no live call at seed time).
        fallbackReason:
          "ANTHROPIC_API_KEY not set; using deterministic Pause clinical-summary composer.",
        nonPrescriptive: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Medication Adherence Agent working PROACTIVELY (like
  // Care Gap Closure, not part of the reactive intake→router flow): it
  // DETERMINISTICALLY assesses the patient's menopause medications against an
  // explicit as-of date (here estradiol on-track, oral progesterone refill-due,
  // paroxetine at-risk, venlafaxine lapsed), drafts consent- and
  // quiet-hours-aware refill/adherence NUDGES for the ones due or off-track
  // (human-approval-gated, never auto-sent, and explicitly nudge-only — it never
  // autonomously orders a refill), flags the lapsed medication as an adherence
  // drop-off to the care team, and hands the nudges to the Engagement Agent for
  // delivery. The medications + refill intervals are ILLUSTRATIVE synthetics,
  // not a certified pharmacy system. Seed data; production populates the ring
  // buffer from the persistent log store.
  const ma0 = Date.now() - 1000 * 60 * 10;
  const medAdherenceTaskId = "task-seed-medication-adherence-001";
  const medAdherenceName =
    "Agentforce Medication Adherence · HRT/SSRI Refill & Adherence (Health Cloud)";
  s.traces.push(
    {
      id: "span-medadh-001",
      taskId: medAdherenceTaskId,
      agentId: "medication-adherence-agent",
      agentName: medAdherenceName,
      operation: "medication.adherence.assess",
      protocol: "rest",
      startedAt: new Date(ma0).toISOString(),
      finishedAt: new Date(ma0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        asOf: "2026-02-02",
        medicationsAssessed: 4,
        medications: [
          "med.estradiol-transdermal",
          "med.progesterone-oral",
          "med.paroxetine-ssri",
          "med.venlafaxine-snri"
        ],
        statuses: ["good", "good", "at-risk", "lapsed"],
        refillsDue: 3,
        dropOffs: 1,
        // The honesty invariant: every refill action is human-approval-gated —
        // the agent only ever nudges, never autonomously orders a refill.
        refillRequiresHumanApproval: true,
        synthetic: true
      }
    },
    {
      id: "span-medadh-002",
      taskId: medAdherenceTaskId,
      parentSpanId: "span-medadh-001",
      agentId: "medication-adherence-agent",
      agentName: medAdherenceName,
      operation: "medication.nudge.draft",
      protocol: "rest",
      startedAt: new Date(ma0 + 40).toISOString(),
      finishedAt: new Date(ma0 + 100).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        drug: "med.progesterone-oral",
        status: "good",
        refillDue: true,
        channel: "sms",
        quietHoursRespected: true,
        humanApprovalRequired: true,
        nudgeOnly: true,
        suppressedForNoConsent: false,
        sent: false
      }
    },
    {
      id: "span-medadh-003",
      taskId: medAdherenceTaskId,
      parentSpanId: "span-medadh-001",
      agentId: "medication-adherence-agent",
      agentName: medAdherenceName,
      operation: "medication.nudge.draft",
      protocol: "rest",
      startedAt: new Date(ma0 + 100).toISOString(),
      finishedAt: new Date(ma0 + 160).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        drug: "med.venlafaxine-snri",
        status: "lapsed",
        refillDue: true,
        channel: "sms",
        quietHoursRespected: true,
        humanApprovalRequired: true,
        nudgeOnly: true,
        suppressedForNoConsent: false,
        sent: false
      }
    },
    {
      id: "span-medadh-004",
      taskId: medAdherenceTaskId,
      parentSpanId: "span-medadh-001",
      agentId: "medication-adherence-agent",
      agentName: medAdherenceName,
      operation: "medication.dropoff.flag",
      protocol: "rest",
      startedAt: new Date(ma0 + 160).toISOString(),
      finishedAt: new Date(ma0 + 220).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        dropOffs: 1,
        medications: ["med.venlafaxine-snri"],
        routedTo: "care-team",
        synthetic: true
      }
    },
    {
      id: "span-medadh-005",
      taskId: medAdherenceTaskId,
      parentSpanId: "span-medadh-001",
      agentId: "engagement-agent",
      agentName: "Agentforce Engagement Agent · Care Continuity",
      operation: "engagement.outreach.handoff",
      protocol: "a2a",
      startedAt: new Date(ma0 + 220).toISOString(),
      finishedAt: new Date(ma0 + 620).toISOString(),
      durationMs: 400,
      status: "ok",
      attributes: {
        nudgesHandedOff: 2,
        channels: ["sms", "sms"],
        humanApprovalRequired: true,
        nudgeOnly: true,
        sent: false
      }
    }
  );

  // A trace showing the Referral Management Agent working standalone (it
  // complements the Care Router rather than sitting on the reactive
  // intake→router spine): it DETERMINISTICALLY triages a patient's intake +
  // routing signals into recommended specialist referrals (here behavioral
  // health — generalizing the Care Router's behavioral-health handoff into a
  // full outbound referral — and bone health from an osteoporosis-risk flag),
  // each referencing a defined specialty-catalog id + a documented reason,
  // drafts a cosign-gated referral request per recommendation (every one marked
  // requiresClinicianCosign:true, status:"drafted", sent:false), and parks them
  // on an await-cosign marker. The load-bearing honesty invariant: an outbound
  // referral requires a clinician's sign-off before it is sent — the agent only
  // ever drafts. The specialties + triage are ILLUSTRATIVE synthetics, not a
  // certified referral engine. Seed data; production populates the ring buffer
  // from the persistent log store.
  const rf0 = Date.now() - 1000 * 60 * 11;
  const referralTaskId = "task-seed-referral-001";
  const referralName =
    "Agentforce Referral Management · Specialist Referrals (Health Cloud)";
  const referralTriageSpanId = "span-referral-001";
  s.traces.push(
    {
      id: referralTriageSpanId,
      taskId: referralTaskId,
      agentId: "referral-management-agent",
      agentName: referralName,
      operation: "referral.triage",
      protocol: "rest",
      startedAt: new Date(rf0).toISOString(),
      finishedAt: new Date(rf0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        referralsRecommended: 2,
        specialties: ["referral.behavioral-health", "referral.bone-health"],
        priorities: ["urgent", "routine"],
        referralsTraceToSpecialty: true,
        // The honesty invariant: every outbound referral is cosign-gated.
        referralHasClinicianCosign: true,
        generalizesCareRouterHandoff: true,
        synthetic: true
      }
    },
    {
      id: "span-referral-002",
      taskId: referralTaskId,
      parentSpanId: referralTriageSpanId,
      agentId: "referral-management-agent",
      agentName: referralName,
      operation: "referral.draft",
      protocol: "rest",
      startedAt: new Date(rf0 + 40).toISOString(),
      finishedAt: new Date(rf0 + 80).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        specialtyId: "referral.behavioral-health",
        priority: "urgent",
        requiresClinicianCosign: true,
        status: "drafted",
        sent: false
      }
    },
    {
      id: "span-referral-003",
      taskId: referralTaskId,
      parentSpanId: referralTriageSpanId,
      agentId: "referral-management-agent",
      agentName: referralName,
      operation: "referral.draft",
      protocol: "rest",
      startedAt: new Date(rf0 + 80).toISOString(),
      finishedAt: new Date(rf0 + 120).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        specialtyId: "referral.bone-health",
        priority: "routine",
        requiresClinicianCosign: true,
        status: "drafted",
        sent: false
      }
    },
    {
      id: "span-referral-004",
      taskId: referralTaskId,
      parentSpanId: referralTriageSpanId,
      agentId: "referral-management-agent",
      agentName: referralName,
      operation: "referral.await-cosign",
      protocol: "rest",
      startedAt: new Date(rf0 + 120).toISOString(),
      finishedAt: new Date(rf0 + 160).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        referralsAwaitingCosign: 2,
        requiresClinicianCosign: true,
        sent: false,
        synthetic: true
      }
    }
  );

  // A trace showing the Member Service / Billing Agent working standalone as a
  // patient-service node (the Salesforce "Agentforce for Health" Claims &
  // Coverage analog): it looks up the member's DETERMINISTIC synthetic claim
  // records, answers an in-scope billing question grounded on a specific claim
  // (here a copay / patient-responsibility question that cites an adjudicated
  // claim — every billing answer must trace to a claim/EOB record, never
  // fabricated), and then routes an out-of-scope follow-up (a clinical /
  // prescription request) to a human member-services specialist with a PII-safe
  // billing context bundle. Scoped to billing/coverage self-service, distinct
  // from the engagement agent. The claim/EOB records are ILLUSTRATIVE synthetics,
  // NOT a real claims / 835-ERA / payer system. Seed data; production populates
  // the ring buffer from the persistent log store.
  const ms0 = Date.now() - 1000 * 60 * 13;
  const memberServiceTaskId = "task-seed-member-service-001";
  const memberServiceName =
    "Agentforce Member Service · Billing & Coverage (Patient Service)";
  const memberLookupSpanId = "span-member-service-001";
  s.traces.push(
    {
      id: memberLookupSpanId,
      taskId: memberServiceTaskId,
      agentId: "member-service-agent",
      agentName: memberServiceName,
      operation: "billing.claim.lookup",
      protocol: "rest",
      startedAt: new Date(ms0).toISOString(),
      finishedAt: new Date(ms0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        memberId: "member-demo-001",
        claimsConsidered: 5,
        synthetic: true
      }
    },
    {
      id: "span-member-service-002",
      taskId: memberServiceTaskId,
      parentSpanId: memberLookupSpanId,
      agentId: "member-service-agent",
      agentName: memberServiceName,
      operation: "billing.answer",
      protocol: "rest",
      startedAt: new Date(ms0 + 40).toISOString(),
      finishedAt: new Date(ms0 + 80).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        intent: "patient-responsibility",
        kind: "billing-answer",
        citedClaimIds: ["clm-seed-adjudicated"],
        citedClaimCount: 1,
        patientResponsibility: 84,
        // The honesty invariant: every billing answer traces to a claim record.
        billingTracesToClaim: true,
        routeToHuman: false,
        synthetic: true
      }
    },
      {
        id: "span-member-service-003",
        taskId: memberServiceTaskId,
        parentSpanId: memberLookupSpanId,
        agentId: "member-service-agent",
        agentName: memberServiceName,
        operation: "billing.route-to-human",
        protocol: "a2a",
        startedAt: new Date(ms0 + 80).toISOString(),
        finishedAt: new Date(ms0 + 160).toISOString(),
        durationMs: 80,
        status: "ok",
        attributes: {
          intent: "out-of-scope",
          reason:
            "Out of scope for billing/coverage self-service (a clinical / prescription request) — handed to a human with the member's recent claim context",
          queue: "member-services-billing",
          // The route-to-human handoff asserts no billing figure, so it is
          // honestly source-clean.
          billingTracesToClaim: true,
          routeToHuman: true,
          synthetic: true
        }
      }
    );

  // A trace showing the Prior Authorization Agent — the HEAVIEST and LEAST
  // demo-honest agent on the fabric — assembling a PA WITHOUT submitting it: it
  // DETERMINISTICALLY matches the payer's medical-necessity criteria for a
  // PA-requiring item (here systemic HRT / compounded estradiol — all criteria
  // met), assembles the required supporting-documentation checklist (here
  // complete), and then parks the package on an await-clinician marker. The
  // load-bearing honesty invariants: the agent never autonomously submits (a
  // clinician must approve — requiresClinicianApproval:true, submitted:false),
  // and a submission must be documentation-complete. Real PA is a genuinely
  // multi-system EDI/278 (or FHIR PAS) workflow; this is a MOCK, NOT a real
  // 278/EDI or payer PA portal. Seed data; production populates the ring buffer
  // from the persistent log store.
  const pa0 = Date.now() - 1000 * 60 * 14;
  const priorAuthTaskId = "task-seed-prior-authorization-001";
  const priorAuthName =
    "Agentforce Prior Authorization · CareRequest + Utilization Management (Health Cloud)";
  const paMatchSpanId = "span-priorauth-001";
  s.traces.push(
    {
      id: paMatchSpanId,
      taskId: priorAuthTaskId,
      agentId: "prior-authorization-agent",
      agentName: priorAuthName,
      operation: "priorauth.criteria.match",
      protocol: "rest",
      startedAt: new Date(pa0).toISOString(),
      finishedAt: new Date(pa0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        itemId: "pa.systemic-hrt",
        criteriaTotal: 3,
        criteriaMet: 3,
        criteriaComplete: true,
        criteriaTraceToCatalog: true,
        synthetic: true
      }
    },
    {
      id: "span-priorauth-002",
      taskId: priorAuthTaskId,
      parentSpanId: paMatchSpanId,
      agentId: "prior-authorization-agent",
      agentName: priorAuthName,
      operation: "priorauth.docs.assemble",
      protocol: "rest",
      startedAt: new Date(pa0 + 40).toISOString(),
      finishedAt: new Date(pa0 + 80).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        itemId: "pa.systemic-hrt",
        documentsRequired: 3,
        documentsPresent: 3,
        documentsMissing: 0,
        paDocumentationComplete: true,
        careRequestId: "care-req-seed-hrt",
        synthetic: true
      }
    },
    {
      id: "span-priorauth-003",
      taskId: priorAuthTaskId,
      parentSpanId: paMatchSpanId,
      agentId: "prior-authorization-agent",
      agentName: priorAuthName,
      operation: "priorauth.await-clinician",
      protocol: "rest",
      startedAt: new Date(pa0 + 80).toISOString(),
      finishedAt: new Date(pa0 + 120).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        itemId: "pa.systemic-hrt",
        status: "ready-for-clinician",
        // The honesty invariants: never autonomously submitted; a submission
        // must be documentation-complete.
        requiresClinicianApproval: true,
        paHasClinicianApproval: true,
        paDocumentationComplete: true,
        submitted: false,
        synthetic: true
      }
    }
  );

  // A trace showing the SDOH Screening Agent doing WHOLE-PERSON care alongside
  // the clinical agents: it screens a patient with the validated CMS AHC-HRSN
  // core-domain tool (DETERMINISTIC real rule-based logic, no LLM), here
  // flagging food insecurity + a transportation barrier, then drafts
  // CONSENT-GATED community-resource referrals (211 + food bank + transportation
  // assistance) — each referencing a defined resource-catalog id,
  // human-approval-gated, and never an autonomous enrollment. It touches the
  // patient's social/clinical context, so every span sets phiAccessed:true. The
  // community-resource catalog is an ILLUSTRATIVE synthetic, NOT a live
  // directory. Seed data; production populates the ring buffer from the
  // persistent log store.
  const sd0 = Date.now() - 1000 * 60 * 5;
  const sdohTaskId = "task-seed-sdoh-001";
  const sdohName = "Agentforce SDOH Screening Agent · Whole-Person Care";
  s.traces.push(
    {
      id: "span-sdoh-001",
      taskId: sdohTaskId,
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(sd0).toISOString(),
      finishedAt: new Date(sd0 + 70).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-sdoh-002",
      taskId: sdohTaskId,
      parentSpanId: "span-sdoh-001",
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "sdoh.screen",
      protocol: "a2a",
      startedAt: new Date(sd0 + 70).toISOString(),
      finishedAt: new Date(sd0 + 100).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        screener: "ahc-hrsn",
        usesValidatedSdohScreener: true,
        positiveDomainCount: 2,
        positiveDomains: ["food", "transportation"],
        safetyEscalation: false,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-sdoh-003",
      taskId: sdohTaskId,
      parentSpanId: "span-sdoh-002",
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "sdoh.refer",
      protocol: "a2a",
      startedAt: new Date(sd0 + 100).toISOString(),
      finishedAt: new Date(sd0 + 150).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        referralsDrafted: 3,
        resources: [
          "resource.food-bank",
          "resource.transportation-assistance",
          "resource.211-helpline"
        ],
        // The honesty invariants: consent-gated, human-approval-gated, and never
        // an autonomous enrollment.
        sdohReferralHasConsent: true,
        requiresHumanApproval: true,
        autonomousEnrollment: false,
        sent: false,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A second SDOH trace: the interpersonal-safety RED FLAG variant. A positive
  // HITS interpersonal-safety screen is a mandatory escalation to a human social
  // worker (mirroring the Assessment Agent's PHQ-9 item 9 handling); the agent
  // records the escalation span and hands the confidential DV/safety referral to
  // a human social worker — it never acts autonomously. Synthetic; phiAccessed.
  const sd1 = Date.now() - 1000 * 60 * 4;
  const sdohSafetyTaskId = "task-seed-sdoh-safety-001";
  s.traces.push(
    {
      id: "span-sdoh-safety-001",
      taskId: sdohSafetyTaskId,
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(sd1).toISOString(),
      finishedAt: new Date(sd1 + 70).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-sdoh-safety-002",
      taskId: sdohSafetyTaskId,
      parentSpanId: "span-sdoh-safety-001",
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "sdoh.screen",
      protocol: "a2a",
      startedAt: new Date(sd1 + 70).toISOString(),
      finishedAt: new Date(sd1 + 100).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        screener: "ahc-hrsn",
        usesValidatedSdohScreener: true,
        positiveDomainCount: 1,
        positiveDomains: ["safety"],
        safetyEscalation: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-sdoh-safety-003",
      taskId: sdohSafetyTaskId,
      parentSpanId: "span-sdoh-safety-002",
      agentId: "sdoh-screening-agent",
      agentName: sdohName,
      operation: "sdoh.safety.escalate",
      protocol: "a2a",
      startedAt: new Date(sd1 + 100).toISOString(),
      finishedAt: new Date(sd1 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        redFlag: "ahc-hrsn-interpersonal-safety",
        handoffTo: "social-worker",
        // A positive interpersonal-safety screen is a mandatory human escalation.
        requiresHumanEscalation: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Patient Education & Health Coaching Agent working
  // downstream of the lifecycle: it turns already-produced signals (intake
  // vasomotor symptoms + a postmenopausal status + a bone-density care gap) into
  // an evidence-sourced education curriculum, then writes a warm, motivational
  // coaching message. Module SELECTION is DETERMINISTIC (a pure function of the
  // inputs against a defined evidence-sourced catalog — every module traces to a
  // catalog id AND carries a source label, never a fabricated topic), and this
  // seeded example shows the DETERMINISTIC scripted-fallback path (via:
  // scripted-fallback, with a fallbackReason) so it doesn't imply a live Claude
  // call happened at seed time; at run time the phrasing is a live Claude call
  // (the FOURTH live-Claude agent) with the same scripted fallback. The coaching
  // draft is consent-gated + human-approval-gated (never auto-sent), stays
  // strictly within general education scope (no diagnosis/dosing/individualized
  // medical advice), and is handed to the Engagement Agent for delivery. It
  // touches the patient's clinical context, so every span sets phiAccessed:true.
  // The education modules + source labels are ILLUSTRATIVE synthetics, not a
  // certified patient-education engine. Seed data; production populates the ring
  // buffer from the persistent log store.
  const ed0 = Date.now() - 1000 * 60 * 3;
  const educationTaskId = "task-seed-patient-education-001";
  const educationName =
    "Agentforce Patient Education & Health Coaching · Menopause/Midlife";
  s.traces.push(
    {
      id: "span-education-001",
      taskId: educationTaskId,
      agentId: "patient-education-agent",
      agentName: educationName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ed0).toISOString(),
      finishedAt: new Date(ed0 + 60).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-education-002",
      taskId: educationTaskId,
      parentSpanId: "span-education-001",
      agentId: "patient-education-agent",
      agentName: educationName,
      operation: "patient-education.curate",
      protocol: "a2a",
      startedAt: new Date(ed0 + 60).toISOString(),
      finishedAt: new Date(ed0 + 90).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        modulesSelected: 6,
        modules: [
          "education.vasomotor",
          "education.sleep-hygiene",
          "education.bone-health",
          "education.cardiovascular",
          "education.nutrition",
          "education.physical-activity"
        ],
        // The honesty invariants: every module traces to a defined evidence
        // source, and the curriculum stays strictly within education scope.
        educationTracesToEvidenceSource: true,
        staysWithinEducationScope: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-education-003",
      taskId: educationTaskId,
      parentSpanId: "span-education-002",
      agentId: "patient-education-agent",
      agentName: educationName,
      operation: "patient-education.coach",
      protocol: "a2a",
      startedAt: new Date(ed0 + 90).toISOString(),
      finishedAt: new Date(ed0 + 110).toISOString(),
      durationMs: 20,
      status: "ok",
      attributes: {
        provider: "pause-scripted",
        model: "pause-patient-education-coach@1.0",
        via: "scripted-fallback",
        // Present ONLY on a scripted-fallback composition — the non-clinical
        // diagnostic explaining why the live Claude call was not used. This
        // seeded example is deterministic on purpose (no live call at seed time).
        fallbackReason:
          "ANTHROPIC_API_KEY not set; using deterministic Pause patient-education coach.",
        // The honesty invariants: consent-gated, human-approval-gated, general
        // education only, and never auto-sent.
        coachingOutreachHasConsent: true,
        staysWithinEducationScope: true,
        requiresHumanApproval: true,
        sent: false,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-education-004",
      taskId: educationTaskId,
      parentSpanId: "span-education-001",
      agentId: "engagement-agent",
      agentName: "Agentforce Engagement Agent · Care Continuity",
      operation: "engagement.outreach.handoff",
      protocol: "a2a",
      startedAt: new Date(ed0 + 110).toISOString(),
      finishedAt: new Date(ed0 + 470).toISOString(),
      durationMs: 360,
      status: "ok",
      attributes: {
        coachingDraftsHandedOff: 1,
        channel: "secure-message",
        coachingOutreachHasConsent: true,
        humanApprovalRequired: true,
        sent: false
      }
    }
  );

  // A trace showing the Remote Patient Monitoring & Symptom-Trend Tracking Agent
  // ingesting a longitudinal reading set (hot-flash frequency, sleep, mood,
  // resting HR — self-reported + wearable, every reading tracing to a source),
  // DETERMINISTICALLY detecting per-metric trends over the reading window, and
  // ROUTING the worsening trends (hot-flash frequency climbing, sleep declining)
  // to a human clinician for review — never taking an autonomous clinical action.
  // Trend detection is a pure function of the readings' own timestamps + values
  // (no randomness, no clock). It touches the patient's clinical/monitoring
  // context, so every span sets phiAccessed:true. The monitored metrics +
  // thresholds are ILLUSTRATIVE synthetics, not a certified remote-monitoring
  // device. Seed data; production populates the ring buffer from the persistent
  // log store.
  const rm0 = Date.now() - 1000 * 60 * 2;
  const rpmTaskId = "task-seed-remote-monitoring-001";
  const rpmName = "Remote Patient Monitoring & Symptom-Trend Tracking Agent";
  s.traces.push(
    {
      id: "span-rpm-001",
      taskId: rpmTaskId,
      agentId: "remote-monitoring-agent",
      agentName: rpmName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(rm0).toISOString(),
      finishedAt: new Date(rm0 + 60).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-rpm-002",
      taskId: rpmTaskId,
      parentSpanId: "span-rpm-001",
      agentId: "remote-monitoring-agent",
      agentName: rpmName,
      operation: "rpm.ingest",
      protocol: "a2a",
      startedAt: new Date(rm0 + 60).toISOString(),
      finishedAt: new Date(rm0 + 90).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        readingsIngested: 16,
        metrics: [
          "metric.hot-flash-frequency",
          "metric.sleep-hours",
          "metric.mood-score",
          "metric.resting-heart-rate"
        ],
        sources: ["self-report", "wearable"],
        // The honesty invariants: every reading traces to a source, and
        // monitoring is consent-gated.
        readingsTraceToSource: true,
        monitoringHasConsent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-rpm-003",
      taskId: rpmTaskId,
      parentSpanId: "span-rpm-002",
      agentId: "remote-monitoring-agent",
      agentName: rpmName,
      operation: "rpm.detect-trends",
      protocol: "a2a",
      startedAt: new Date(rm0 + 90).toISOString(),
      finishedAt: new Date(rm0 + 120).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        metricsMonitored: 4,
        trends: {
          "metric.hot-flash-frequency": "worsening",
          "metric.sleep-hours": "worsening",
          "metric.mood-score": "improving",
          "metric.resting-heart-rate": "stable"
        },
        escalationsRaised: 2,
        overallStatus: "escalate",
        // The honesty invariant: escalations are routed to a human clinician.
        escalationRoutedToHuman: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-rpm-004",
      taskId: rpmTaskId,
      parentSpanId: "span-rpm-003",
      agentId: "remote-monitoring-agent",
      agentName: rpmName,
      operation: "rpm.route-to-clinician",
      protocol: "a2a",
      startedAt: new Date(rm0 + 120).toISOString(),
      finishedAt: new Date(rm0 + 300).toISOString(),
      durationMs: 180,
      status: "ok",
      attributes: {
        escalationsRouted: 2,
        metrics: ["metric.hot-flash-frequency", "metric.sleep-hours"],
        triggeringRules: ["rule.worsening-trend"],
        routedTo: "clinician-review",
        // The honesty invariant: never an autonomous clinical action.
        autonomousAction: false,
        escalationRoutedToHuman: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Population Health & Risk Stratification Agent ingesting a
  // PANEL of already-produced per-patient signals, DETERMINISTICALLY scoring each
  // patient with the transparent additive risk model, stratifying them into risk
  // tiers (low / rising / high), and building a prioritized outreach worklist for
  // a human care manager — never an autonomous care decision. Scoring is a pure
  // function of the panel signals (no randomness, no clock). It reasons over the
  // whole panel's clinical/care-management context, so every span sets
  // phiAccessed:true. The risk factors + weights + cutoffs + patientRefs are
  // ILLUSTRATIVE synthetics, not a certified risk-stratification model. Seed data;
  // production populates the ring buffer from the persistent log store.
  const ph0 = Date.now() - 1000 * 60 * 2;
  const phTaskId = "task-seed-population-health-001";
  const phName = "Population Health & Risk Stratification Agent";
  s.traces.push(
    {
      id: "span-pophealth-001",
      taskId: phTaskId,
      agentId: "population-health-agent",
      agentName: phName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ph0).toISOString(),
      finishedAt: new Date(ph0 + 60).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pophealth-002",
      taskId: phTaskId,
      parentSpanId: "span-pophealth-001",
      agentId: "population-health-agent",
      agentName: phName,
      operation: "pophealth.ingest-panel",
      protocol: "a2a",
      startedAt: new Date(ph0 + 60).toISOString(),
      finishedAt: new Date(ph0 + 90).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientsIngested: 5,
        scoringFactors: [
          "factor.intake-severity",
          "factor.assessment-band",
          "factor.care-gaps",
          "factor.sdoh-burden",
          "factor.medication-nonadherence",
          "factor.monitoring-trend"
        ],
        // The honesty invariant: the model scores on NO protected-class attribute.
        excludesProtectedAttributes: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pophealth-003",
      taskId: phTaskId,
      parentSpanId: "span-pophealth-002",
      agentId: "population-health-agent",
      agentName: phName,
      operation: "pophealth.score",
      protocol: "a2a",
      startedAt: new Date(ph0 + 90).toISOString(),
      finishedAt: new Date(ph0 + 120).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientsScored: 5,
        // The honesty invariant: every tier traces to the documented factors.
        riskScoreTracesToFactors: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pophealth-004",
      taskId: phTaskId,
      parentSpanId: "span-pophealth-003",
      agentId: "population-health-agent",
      agentName: phName,
      operation: "pophealth.stratify",
      protocol: "a2a",
      startedAt: new Date(ph0 + 120).toISOString(),
      finishedAt: new Date(ph0 + 150).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        tierCounts: { high: 1, rising: 2, low: 2 },
        riskScoreTracesToFactors: true,
        tierReviewedByHuman: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pophealth-005",
      taskId: phTaskId,
      parentSpanId: "span-pophealth-004",
      agentId: "population-health-agent",
      agentName: phName,
      operation: "pophealth.build-worklist",
      protocol: "a2a",
      startedAt: new Date(ph0 + 150).toISOString(),
      finishedAt: new Date(ph0 + 300).toISOString(),
      durationMs: 150,
      status: "ok",
      attributes: {
        worklistLength: 5,
        routedTo: "care-manager-review",
        // The honesty invariant: a tier never triggers an autonomous care action.
        autonomousCareDecision: false,
        tierReviewedByHuman: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Consent & Preferences Management Agent — the
  // authoritative, cross-cutting consent service the rest of the fabric's
  // consent gates defer to — loading a patient's consent LEDGER, evaluating a
  // DETERMINISTIC consent decision for a scope + channel at an explicit time
  // (evaluateConsent is a pure function of the ledger + the query's own atTime +
  // priorTouches — no randomness, no clock), and returning a decision that cites
  // the consent record it relied on. It holds patient consent data, so every
  // span sets phiAccessed:true. The consent scopes + sources + preferences are
  // ILLUSTRATIVE synthetics, not a certified consent-management system. Seed
  // data; production populates the ring buffer from the persistent log store.
  const cm0 = Date.now() - 1000 * 60 * 1;
  const cmTaskId = "task-seed-consent-management-001";
  const cmName = "Consent & Preferences Management Agent";
  s.traces.push(
    {
      id: "span-consent-001",
      taskId: cmTaskId,
      agentId: "consent-management-agent",
      agentName: cmName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cm0).toISOString(),
      finishedAt: new Date(cm0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-consent-002",
      taskId: cmTaskId,
      parentSpanId: "span-consent-001",
      agentId: "consent-management-agent",
      agentName: cmName,
      operation: "consent.load-ledger",
      protocol: "a2a",
      startedAt: new Date(cm0 + 40).toISOString(),
      finishedAt: new Date(cm0 + 70).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "consent-patient-001",
        recordedScopes: 5,
        // The honesty invariant: every consent state traces to a recorded basis.
        consentTracesToRecord: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-consent-003",
      taskId: cmTaskId,
      parentSpanId: "span-consent-002",
      agentId: "consent-management-agent",
      agentName: cmName,
      operation: "consent.evaluate",
      protocol: "a2a",
      startedAt: new Date(cm0 + 70).toISOString(),
      finishedAt: new Date(cm0 + 100).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        scope: "contact-outreach",
        channel: "sms",
        atTime: "2026-03-01T15:00:00Z",
        // The honesty invariants: a revocation/expiry is honored and no scope is
        // overridden.
        honorsRevocation: true,
        respectsConsentScope: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-consent-004",
      taskId: cmTaskId,
      parentSpanId: "span-consent-003",
      agentId: "consent-management-agent",
      agentName: cmName,
      operation: "consent.decision",
      protocol: "a2a",
      startedAt: new Date(cm0 + 100).toISOString(),
      finishedAt: new Date(cm0 + 160).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        scope: "contact-outreach",
        channel: "sms",
        allowed: true,
        matchedConsentEventId: "consent-evt-contact-001",
        honorsRevocation: true,
        respectsConsentScope: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Clinical Trials & Research Matching Agent — the
  // "Agentforce for Health" clinical-trials / research-matching analog — loading
  // the SYNTHETIC study catalog, DETERMINISTICALLY matching a single patient's
  // structured context against each study's DEFINED eligibility criteria
  // (matchTrials is a pure function of the context — no randomness, no clock),
  // and drafting a CONSENT-GATED outreach that never auto-enrolls (informed
  // consent + a human required). It reads patient clinical context, so every
  // span sets phiAccessed:true. The catalog + sponsors + criteria are
  // ILLUSTRATIVE synthetics, not a certified trial-eligibility engine. Seed
  // data; production populates the ring buffer from the persistent log store.
  const ct0 = Date.now() - 1000 * 60 * 1;
  const ctTaskId = "task-seed-clinical-trials-001";
  const ctName = "Clinical Trials & Research Matching Agent";
  s.traces.push(
    {
      id: "span-trials-001",
      taskId: ctTaskId,
      agentId: "clinical-trials-agent",
      agentName: ctName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ct0).toISOString(),
      finishedAt: new Date(ct0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-trials-002",
      taskId: ctTaskId,
      parentSpanId: "span-trials-001",
      agentId: "clinical-trials-agent",
      agentName: ctName,
      operation: "trials.load-catalog",
      protocol: "a2a",
      startedAt: new Date(ct0 + 40).toISOString(),
      finishedAt: new Date(ct0 + 70).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        studiesLoaded: 4,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-trials-003",
      taskId: ctTaskId,
      parentSpanId: "span-trials-002",
      agentId: "clinical-trials-agent",
      agentName: ctName,
      operation: "trials.match",
      protocol: "a2a",
      startedAt: new Date(ct0 + 70).toISOString(),
      finishedAt: new Date(ct0 + 110).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "trial-patient-001",
        eligibleCount: 3,
        recommendedStudyIds: [
          "study.hrt-initiation-rct",
          "study.vms-nonhormonal-rct",
          "study.sleep-cbt-observational"
        ],
        // The honesty invariant: every eligibility determination traces to a
        // defined study criterion.
        eligibilityTracesToCriteria: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-trials-004",
      taskId: ctTaskId,
      parentSpanId: "span-trials-003",
      agentId: "clinical-trials-agent",
      agentName: ctName,
      operation: "trials.draft-outreach",
      protocol: "a2a",
      startedAt: new Date(ct0 + 110).toISOString(),
      finishedAt: new Date(ct0 + 170).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        outreachState: "drafted",
        // The honesty invariants: outreach is research-consent-gated and the
        // agent never enrolls a patient autonomously.
        researchConsentPresent: true,
        enrollmentRequiresHuman: true,
        enrolled: false,
        phiAccessed: true,
        synthetic: true
      }
    }
  );

  // A trace showing the Language Access & Health Equity Agent — a patient-care
  // EQUITY agent — determining a patient's PREFERRED LANGUAGE, DETERMINISTICALLY
  // deciding a qualified-medical-interpreter need + modality, checking approved
  // in-language materials, and FLAGGING equity / access gaps. This seed shows
  // the EQUITY-GAP example: a patient preferring a rare language with no
  // qualified-interpreter pool and no approved translated materials, so the
  // agent ESCALATES to a human coordinator (a safe completed answer) rather than
  // substituting an unqualified interpreter or machine translation. It reads
  // patient context, so every span sets phiAccessed:true. The languages,
  // availability, and materials are ILLUSTRATIVE synthetics, not a certified
  // language-access system. Seed data; production populates the ring buffer from
  // the persistent log store.
  const la0 = Date.now() - 1000 * 60 * 1;
  const laTaskId = "task-seed-language-access-001";
  const laName = "Language Access & Health Equity Agent";
  s.traces.push(
    {
      id: "span-langaccess-001",
      taskId: laTaskId,
      agentId: "language-access-agent",
      agentName: laName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(la0).toISOString(),
      finishedAt: new Date(la0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-langaccess-002",
      taskId: laTaskId,
      parentSpanId: "span-langaccess-001",
      agentId: "language-access-agent",
      agentName: laName,
      operation: "langaccess.detect-language",
      protocol: "a2a",
      startedAt: new Date(la0 + 35).toISOString(),
      finishedAt: new Date(la0 + 60).toISOString(),
      durationMs: 25,
      status: "ok",
      attributes: {
        patientRef: "langaccess-patient-002",
        // Preferred language deferred to the Consent & Preferences Management
        // agent's preferred-language preference (a rare, unstaffed language).
        preferredLanguageCode: "ff",
        preferredLanguageLabel: "Fulfulde (Pular)",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-langaccess-003",
      taskId: laTaskId,
      parentSpanId: "span-langaccess-002",
      agentId: "language-access-agent",
      agentName: laName,
      operation: "langaccess.assess",
      protocol: "a2a",
      startedAt: new Date(la0 + 60).toISOString(),
      finishedAt: new Date(la0 + 110).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        interpreterNeeded: true,
        qualifiedInterpreterAvailable: false,
        // An equity-gap example: no qualified interpreter + consent form only in
        // English are flagged (a safe output, escalated to a human).
        equityGapCount: 5,
        // The honesty invariants hold: materials trace to the approved catalog
        // and no machine translation is used for clinical consent.
        materialsTraceToApprovedSource: true,
        noMachineTranslationForConsent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-langaccess-004",
      taskId: laTaskId,
      parentSpanId: "span-langaccess-003",
      agentId: "language-access-agent",
      agentName: laName,
      operation: "langaccess.arrange-interpreter",
      protocol: "a2a",
      startedAt: new Date(la0 + 110).toISOString(),
      finishedAt: new Date(la0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        interpreterState: "equity-gap-escalation",
        // The load-bearing invariant: clinical interpretation is qualified-only —
        // when none is available the agent escalates, never an unqualified fallback.
        usesQualifiedInterpreter: true,
        escalated: true,
        routedTo: "language-access-coordinator",
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// HEDIS & Quality Reporting seed — a panel-level roll-up ending in a human-
// approval-gated submission package, mirroring the shape a live task produces.
// The measurement period is illustrative and clearly labeled; this is not a
// certified HEDIS engine. Seed data; production populates the ring buffer from
// the persistent log store.
// Advance Care Planning seed — a midlife-touchpoint ACP assessment with a
// drafted conversation prompt (the English happy path), mirroring the shape a
// live task produces. Illustrative; not a certified directives registry. Seed
// data; production populates the ring buffer from the persistent log store.
(function seedAdvanceCarePlanningTrace() {
  const s = store();
  const ac0 = Date.now() - 1000 * 60 * 1;
  const acTaskId = "task-seed-acp-001";
  const acName = "Advance Care Planning Agent";
  s.traces.push(
    {
      id: "span-acp-001",
      taskId: acTaskId,
      agentId: "advance-care-planning-agent",
      agentName: acName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ac0).toISOString(),
      finishedAt: new Date(ac0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-acp-002",
      taskId: acTaskId,
      parentSpanId: "span-acp-001",
      agentId: "advance-care-planning-agent",
      agentName: acName,
      operation: "acp.assess",
      protocol: "a2a",
      startedAt: new Date(ac0 + 40).toISOString(),
      finishedAt: new Date(ac0 + 100).toISOString(),
      durationMs: 60,
      status: "ok",
      attributes: {
        patientRef: "acp-patient-001",
        asOfDate: "2026-07-01",
        preferredLanguageCode: "en",
        qualifiedInterpreterPlanned: false,
        // DPOA-HC on file, living will missing — completeness 0.5.
        completeness: 0.5,
        flagCount: 1,
        // The honesty invariants: directives are catalog-sourced and the
        // language-access gate is trivially satisfied (English patient).
        directivesTraceToCatalog: true,
        languageAccessSatisfied: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-acp-003",
      taskId: acTaskId,
      parentSpanId: "span-acp-002",
      agentId: "advance-care-planning-agent",
      agentName: acName,
      operation: "acp.draft-conversation",
      protocol: "a2a",
      startedAt: new Date(ac0 + 100).toISOString(),
      finishedAt: new Date(ac0 + 150).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        conversationPromptState: "drafted",
        actionable: true,
        // The load-bearing invariant: every directive change is clinician +
        // patient sign-off gated — the agent never autonomously applies one.
        directiveChangeRequiresHumanSignoff: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Care Team & Case Management seed — a multi-disciplinary team assembly on a
// high-need midlife patient, mirroring the shape a live task produces.
// Illustrative; not a certified care-team schema. Seed data; production
// populates the ring buffer from the persistent log store.
// Transitions of Care seed — a cardiovascular hospitalization discharge with
// a scheduled follow-up + a clinician-signoff-gated reconciliation, mirroring
// the shape a live task produces. Illustrative; not a certified TOC system.
// Seed data; production populates the ring buffer from the persistent log
// store.
// Grievance & Appeals seed — an expedited coverage-denial appeal intake with
// a 3-day deadline + PHI-safe routing to the clinical-review queue, mirroring
// the shape a live task produces. Illustrative; not a certified regulatory
// process. Seed data; production populates the ring buffer from the
// persistent log store.
// Provider Credentialing & Directory seed — a fully-verified MSCP with all
// gates open + fresh NSA directory record, mirroring the shape a live task
// produces. Illustrative; not a certified credentialing / directory system.
// Seed data; production populates the ring buffer from the persistent log
// store.
// Quality-Measure Attribution seed — a five-patient panel attribution with
// a tie-break resolved by most-recent-visit-wins and one contract-excluded
// attribution, mirroring the shape a live task produces. Illustrative; not
// a certified attribution engine. Seed data; production populates the ring
// buffer from the persistent log store.
// Complex Care Management seed — a Medicare-eligible 68-year-old patient
// with three chronic conditions + 35min of catalog-sourced activities →
// CPT 99490 non-complex CCM package ready for human quality-team review,
// mirroring the shape a live task produces. Illustrative; not a certified
// CCM billing engine. Seed data; production populates the ring buffer from
// the persistent log store.
// Claims Adjudication seed — a duplicate-submission claim → deny-drafted
// with CO-18, requires adjudicator cosign. Illustrative; not certified
// adjudication. Seed data; production populates the ring buffer from the
// persistent log store.
// Formulary & DUR Review seed — a step-therapy pend for a Tier 2 estradiol
// patch when no documented oral trial is on file. Illustrative; not
// certified DUR. Seed data; production populates the ring buffer from the
// persistent log store.
(function seedFormularyReviewTrace() {
  const s = store();
  const fr0 = Date.now() - 1000 * 60 * 1;
  const frTaskId = "task-seed-formulary-001";
  const frName = "Formulary & Drug Utilization Review Agent";
  s.traces.push(
    {
      id: "span-formulary-001",
      taskId: frTaskId,
      agentId: "formulary-review-agent",
      agentName: frName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(fr0).toISOString(),
      finishedAt: new Date(fr0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-formulary-002",
      taskId: frTaskId,
      parentSpanId: "span-formulary-001",
      agentId: "formulary-review-agent",
      agentName: frName,
      operation: "formulary.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(fr0 + 40).toISOString(),
      finishedAt: new Date(fr0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "formulary-req-2026-07-002",
        memberRef: "member-002",
        proposedDrugId: "drug.estradiol-patch-0.05mg",
        appliedRuleCount: 1,
        // The honesty invariants: every rule + drug traces to the catalog.
        // Step therapy is not honored here (self-reported only), which is
        // WHY the decision is pend-step-therapy — the signal is trivially
        // satisfied because the agent is NOT claiming step therapy.
        rulesTraceToCatalog: true,
        stepTherapyIsHonored: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-formulary-003",
      taskId: frTaskId,
      parentSpanId: "span-formulary-002",
      agentId: "formulary-review-agent",
      agentName: frName,
      operation: "formulary.decide",
      protocol: "a2a",
      startedAt: new Date(fr0 + 90).toISOString(),
      finishedAt: new Date(fr0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "pend-step-therapy",
        tier: "2",
        primaryReasonCode: "reason.PF-200",
        routedTo: "clinician-review",
        requiresClinicianCosign: true,
        // The load-bearing invariant: the decision requires clinician cosign
        // for any non-preferred-approved outcome.
        exceptionRequiresClinicianCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedClaimsAdjudicationTrace() {
  const s = store();
  const ca0 = Date.now() - 1000 * 60 * 1;
  const caTaskId = "task-seed-claims-001";
  const caName = "Claims Adjudication Assistant Agent";
  s.traces.push(
    {
      id: "span-claims-001",
      taskId: caTaskId,
      agentId: "claims-adjudication-agent",
      agentName: caName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ca0).toISOString(),
      finishedAt: new Date(ca0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claims-002",
      taskId: caTaskId,
      parentSpanId: "span-claims-001",
      agentId: "claims-adjudication-agent",
      agentName: caName,
      operation: "claims.evaluate-edits",
      protocol: "a2a",
      startedAt: new Date(ca0 + 40).toISOString(),
      finishedAt: new Date(ca0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        claimRef: "claim-2026-07-002",
        memberRef: "member-001",
        appliedEditCount: 1,
        // The honesty invariant: every applied edit traces to the catalog.
        editsTraceToCatalog: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claims-003",
      taskId: caTaskId,
      parentSpanId: "span-claims-002",
      agentId: "claims-adjudication-agent",
      agentName: caName,
      operation: "claims.decide",
      protocol: "a2a",
      startedAt: new Date(ca0 + 90).toISOString(),
      finishedAt: new Date(ca0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "deny-drafted",
        primaryReasonCode: "reason.CO-18",
        routedTo: "adjudicator",
        requiresAdjudicatorCosign: true,
        // The load-bearing invariants: the denial requires adjudicator
        // cosign and cites a catalog reason code.
        denialRequiresAdjudicatorCosign: true,
        decisionsCiteReasonCodes: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedComplexCareManagementTrace() {
  const s = store();
  const cc0 = Date.now() - 1000 * 60 * 1;
  const ccTaskId = "task-seed-ccm-001";
  const ccName = "Complex Care Management Agent";
  s.traces.push(
    {
      id: "span-ccm-001",
      taskId: ccTaskId,
      agentId: "complex-care-management-agent",
      agentName: ccName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cc0).toISOString(),
      finishedAt: new Date(cc0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ccm-002",
      taskId: ccTaskId,
      parentSpanId: "span-ccm-001",
      agentId: "complex-care-management-agent",
      agentName: ccName,
      operation: "ccm.evaluate-eligibility",
      protocol: "a2a",
      startedAt: new Date(cc0 + 40).toISOString(),
      finishedAt: new Date(cc0 + 80).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "ccm-patient-001",
        month: "2026-07",
        eligible: true,
        qualifyingConditionCount: 3,
        eligibilityTracesToCatalog: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ccm-003",
      taskId: ccTaskId,
      parentSpanId: "span-ccm-002",
      agentId: "complex-care-management-agent",
      agentName: ccName,
      operation: "ccm.summarize-time",
      protocol: "a2a",
      startedAt: new Date(cc0 + 80).toISOString(),
      finishedAt: new Date(cc0 + 130).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        totalMinutes: 35,
        activityCount: 3,
        everyActivityIsCatalogSourced: true,
        // The load-bearing invariant: the reported total equals the sum of
        // the entries (no phantom minutes) and every activity is catalog-
        // sourced.
        timeEntriesAddUp: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ccm-004",
      taskId: ccTaskId,
      parentSpanId: "span-ccm-003",
      agentId: "complex-care-management-agent",
      agentName: ccName,
      operation: "ccm.assemble-billing-package",
      protocol: "a2a",
      startedAt: new Date(cc0 + 130).toISOString(),
      finishedAt: new Date(cc0 + 180).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        cptCode: "99490",
        state: "ready-for-quality-team-review",
        // The load-bearing invariant: the agent never autonomously submits
        // a CMS claim.
        billingRequiresHumanApproval: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedQualityAttributionTrace() {
  const s = store();
  const qa0 = Date.now() - 1000 * 60 * 1;
  const qaTaskId = "task-seed-attribution-001";
  const qaName = "Quality-Measure Attribution Agent";
  s.traces.push(
    {
      id: "span-attribution-001",
      taskId: qaTaskId,
      agentId: "quality-attribution-agent",
      agentName: qaName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(qa0).toISOString(),
      finishedAt: new Date(qa0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-attribution-002",
      taskId: qaTaskId,
      parentSpanId: "span-attribution-001",
      agentId: "quality-attribution-agent",
      agentName: qaName,
      operation: "attribution.attribute",
      protocol: "a2a",
      startedAt: new Date(qa0 + 40).toISOString(),
      finishedAt: new Date(qa0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        panelSize: 5,
        attributedCount: 4,
        excludedByContractCount: 1,
        tieBrokenCount: 1,
        unattributableCount: 0,
        // The load-bearing invariants: every methodology + contract traces
        // to the catalog, every attribution honors contract terms, every
        // tie-break is documented and deterministic.
        attributionsTraceToCatalog: true,
        attributionsHonorContractTerms: true,
        attributionTieBreaksAreDocumented: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-attribution-003",
      taskId: qaTaskId,
      parentSpanId: "span-attribution-002",
      agentId: "quality-attribution-agent",
      agentName: qaName,
      operation: "attribution.rollup",
      protocol: "a2a",
      startedAt: new Date(qa0 + 110).toISOString(),
      finishedAt: new Date(qa0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        providerCount: 4,
        contractRef: "contract.commercial-vbc-my2026",
        methodologyId: "methodology.plurality-of-visits",
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedProviderCredentialingTrace() {
  const s = store();
  const pc0 = Date.now() - 1000 * 60 * 1;
  const pcTaskId = "task-seed-credentialing-001";
  const pcName = "Provider Credentialing & Directory Agent";
  s.traces.push(
    {
      id: "span-credentialing-001",
      taskId: pcTaskId,
      agentId: "provider-credentialing-agent",
      agentName: pcName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(pc0).toISOString(),
      finishedAt: new Date(pc0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-credentialing-002",
      taskId: pcTaskId,
      parentSpanId: "span-credentialing-001",
      agentId: "provider-credentialing-agent",
      agentName: pcName,
      operation: "credentialing.verify",
      protocol: "a2a",
      startedAt: new Date(pc0 + 40).toISOString(),
      finishedAt: new Date(pc0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        providerRef: "provider-mscp-001",
        asOfDate: "2026-07-01",
        intent: "referral",
        status: "verified",
        sanctioned: false,
        canReferPatient: true,
        canBookAppointment: true,
        canReturnInDirectoryResponse: true,
        // The load-bearing invariants: every credential traces to an approved
        // source, no expired/sanctioned referral slips through, and the
        // directory record is within the NSA freshness window.
        credentialsTraceToVerifiedSource: true,
        noReferralToExpiredOrSanctioned: true,
        directoryIsFresh: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedGrievanceAppealsTrace() {
  const s = store();
  const ga0 = Date.now() - 1000 * 60 * 1;
  const gaTaskId = "task-seed-grievance-001";
  const gaName = "Grievance & Appeals Agent";
  s.traces.push(
    {
      id: "span-grievance-001",
      taskId: gaTaskId,
      agentId: "grievance-appeals-agent",
      agentName: gaName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ga0).toISOString(),
      finishedAt: new Date(ga0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-grievance-002",
      taskId: gaTaskId,
      parentSpanId: "span-grievance-001",
      agentId: "grievance-appeals-agent",
      agentName: gaName,
      operation: "grievance.classify",
      protocol: "a2a",
      startedAt: new Date(ga0 + 40).toISOString(),
      finishedAt: new Date(ga0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        memberRef: "member-001",
        receivedDate: "2026-07-01",
        caseType: "case.appeal-expedited-coverage-denial",
        urgency: "expedited",
        deadlineDate: "2026-07-04",
        // The honesty invariant: deadline traces to the case-type catalog.
        deadlineTracesToCatalog: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-grievance-003",
      taskId: gaTaskId,
      parentSpanId: "span-grievance-002",
      agentId: "grievance-appeals-agent",
      agentName: gaName,
      operation: "grievance.route-to-queue",
      protocol: "a2a",
      startedAt: new Date(ga0 + 110).toISOString(),
      finishedAt: new Date(ga0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        queue: "clinical-review",
        state: "queued-for-human-review",
        // The load-bearing invariants: every resolution is human-queue gated
        // and the routing summary is PHI-safe (structured only).
        caseResolutionRequiresHumanQueue: true,
        routingSummaryIsPhiSafe: true,
        routingSummary: {
          memberRef: "member-001",
          caseType: "case.appeal-expedited-coverage-denial",
          urgency: "expedited",
          queue: "clinical-review",
          deadlineDate: "2026-07-04",
          phiSafe: true
        },
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedTransitionsOfCareTrace() {
  const s = store();
  const to0 = Date.now() - 1000 * 60 * 1;
  const toTaskId = "task-seed-toc-001";
  const toName = "Discharge & Transitions of Care Agent";
  s.traces.push(
    {
      id: "span-toc-001",
      taskId: toTaskId,
      agentId: "transitions-of-care-agent",
      agentName: toName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(to0).toISOString(),
      finishedAt: new Date(to0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-toc-002",
      taskId: toTaskId,
      parentSpanId: "span-toc-001",
      agentId: "transitions-of-care-agent",
      agentName: toName,
      operation: "toc.reconcile",
      protocol: "a2a",
      startedAt: new Date(to0 + 40).toISOString(),
      finishedAt: new Date(to0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        patientRef: "toc-patient-001",
        dischargeDate: "2026-07-01",
        reconciliationLines: 3,
        reconciliationChanges: 2,
        // The honesty invariants: every med cites an approved source.
        medicationsTraceToApprovedSource: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-toc-003",
      taskId: toTaskId,
      parentSpanId: "span-toc-002",
      agentId: "transitions-of-care-agent",
      agentName: toName,
      operation: "toc.assemble-package",
      protocol: "a2a",
      startedAt: new Date(to0 + 110).toISOString(),
      finishedAt: new Date(to0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        encounterKind: "hospitalization",
        encounterReasonCategory: "cardiovascular",
        redFlagCount: 3,
        teachBackCount: 4,
        packageState: "ready-for-clinician-signoff",
        followUpScheduled: true,
        followUpAwaitingSchedule: false,
        // The load-bearing invariants: every med change is clinician-signoff
        // gated and the follow-up is a real scheduled slot, not a text
        // recommendation.
        reconciliationChangeRequiresClinician: true,
        followUpScheduledNotRecommended: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedCareTeamTrace() {
  const s = store();
  const ct0 = Date.now() - 1000 * 60 * 1;
  const ctTaskId = "task-seed-careteam-001";
  const ctName = "Care Team & Case Management Agent";
  s.traces.push(
    {
      id: "span-careteam-001",
      taskId: ctTaskId,
      agentId: "care-team-management-agent",
      agentName: ctName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ct0).toISOString(),
      finishedAt: new Date(ct0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-careteam-002",
      taskId: ctTaskId,
      parentSpanId: "span-careteam-001",
      agentId: "care-team-management-agent",
      agentName: ctName,
      operation: "careteam.assemble",
      protocol: "a2a",
      startedAt: new Date(ct0 + 40).toISOString(),
      finishedAt: new Date(ct0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        patientRef: "careteam-patient-001",
        asOfDate: "2026-07-01",
        rosterCount: 4,
        neededRoleCount: 6,
        gapCount: 2,
        caseManagerId: "cm.001",
        // The honesty invariants: every role is catalog-sourced and the
        // roster includes an accountable PCP anchor.
        rolesTraceToCatalog: true,
        teamIncludesPcp: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-careteam-003",
      taskId: ctTaskId,
      parentSpanId: "span-careteam-002",
      agentId: "care-team-management-agent",
      agentName: ctName,
      operation: "careteam.draft-proposals",
      protocol: "a2a",
      startedAt: new Date(ct0 + 110).toISOString(),
      finishedAt: new Date(ct0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        proposalCount: 0,
        // The load-bearing invariant: every roster change is case-manager
        // sign-off gated — the agent never autonomously adds or removes a
        // member.
        teamChangeRequiresCaseManager: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedHedisQualityTrace() {
  const s = store();
  const hq0 = Date.now() - 1000 * 60 * 1;
  const hqTaskId = "task-seed-hedis-quality-001";
  const hqName = "HEDIS & Quality Reporting Agent";
  s.traces.push(
    {
      id: "span-hedis-001",
      taskId: hqTaskId,
      agentId: "hedis-quality-agent",
      agentName: hqName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(hq0).toISOString(),
      finishedAt: new Date(hq0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-hedis-002",
      taskId: hqTaskId,
      parentSpanId: "span-hedis-001",
      agentId: "hedis-quality-agent",
      agentName: hqName,
      operation: "hedis.rollup",
      protocol: "a2a",
      startedAt: new Date(hq0 + 40).toISOString(),
      finishedAt: new Date(hq0 + 110).toISOString(),
      durationMs: 70,
      status: "ok",
      attributes: {
        asOfPeriod: "MY2026",
        panelSize: 6,
        measureCount: 5,
        // The honesty invariants hold: measures + exclusions trace to the
        // defined catalog spec.
        measuresTraceToCatalog: true,
        exclusionsTraceToCatalog: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-hedis-003",
      taskId: hqTaskId,
      parentSpanId: "span-hedis-002",
      agentId: "hedis-quality-agent",
      agentName: hqName,
      operation: "hedis.assemble-submission",
      protocol: "a2a",
      startedAt: new Date(hq0 + 110).toISOString(),
      finishedAt: new Date(hq0 + 160).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        submissionState: "ready-for-quality-team-review",
        // The load-bearing invariant: submission requires human approval,
        // never autonomously filed.
        requiresQualityTeamApproval: true,
        submitted: false,
        submissionRequiresHumanApproval: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

/**
 * Attach an agent's governance policy ids, derived from the policy catalog's
 * appliesTo membership. This is the ONLY place the per-agent policy list is
 * produced, so it always matches what evaluateGovernance() enforces and what
 * the Agent Card advertises.
 */
function withPolicies(seed: AgentSeed): AgentRecord {
  return { ...seed, policies: getPoliciesForAgent(seed.id).map((p) => p.id) };
}

export function listAgents(): AgentRecord[] {
  return REGISTRY.map(withPolicies);
}

export function getAgent(id: string): AgentRecord | undefined {
  const seed = REGISTRY.find((a) => a.id === id);
  return seed ? withPolicies(seed) : undefined;
}

export function listPolicies(): PolicyRecord[] {
  return POLICIES.slice();
}

export function getPoliciesForAgent(agentId: string): PolicyRecord[] {
  return POLICIES.filter((p) => p.appliesTo.includes(agentId));
}

export function recordSpan(span: Omit<TraceSpan, "id">): TraceSpan {
  const id = `span-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const finalSpan: TraceSpan = { ...span, id };
  const s = store();
  s.traces.push(finalSpan);
  if (s.traces.length > TRACE_RING_CAP) {
    s.traces.splice(0, s.traces.length - TRACE_RING_CAP);
  }
  // Best-effort Salesforce Platform Event egress. emitSpanEvent
  // never throws and short-circuits to "skipped" when unconfigured,
  // so the agent fabric is unchanged in the default (designed)
  // posture. We intentionally don't await — telemetry must not
  // delay the routing decision the span describes.
  void emitSpanEvent(finalSpan);
  return finalSpan;
}

export function listTraces(opts: { taskId?: string; limit?: number } = {}): TraceSpan[] {
  const s = store();
  let rows = s.traces.slice();
  if (opts.taskId) rows = rows.filter((t) => t.taskId === opts.taskId);
  rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (opts.limit && opts.limit > 0) rows = rows.slice(-opts.limit);
  return rows;
}

export function listRecentTaskIds(limit = 10): string[] {
  const s = store();
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = s.traces.length - 1; i >= 0 && ids.length < limit; i--) {
    const t = s.traces[i];
    if (!seen.has(t.taskId)) {
      seen.add(t.taskId);
      ids.push(t.taskId);
    }
  }
  return ids;
}

/**
 * Per-policy pre-flight checks for EVERY enforced-block policy in the catalog.
 * Each returns a human-readable reason when the task violates the policy, or
 * null otherwise, using the "explicitly-violating-only" convention (a check
 * fires ONLY when its signal is explicitly present and violating -- never when
 * absent -- so partial fixtures don't trip a gate by omission).
 *
 * The boolean-signal checks are generated from the shared BOOLEAN_BLOCK_SIGNALS
 * metadata (lib/governance-signals.ts), which the /demo console form also reads
 * -- so the UI can never advertise a different signal set than the gate checks.
 * The lone string+regex check (model allow-list) is spelled out below.
 *
 * Every enforced block policy MUST have an entry here: a block policy with no
 * check would be advertised-but-never-evaluated -- the exact drift this table
 * prevents, guarded by a test via evaluableBlockPolicyIds().
 */
const BLOCK_POLICY_CHECKS: Record<
  string,
  (task: GovernanceTask) => string | null
> = {
  ...Object.fromEntries(
    BOOLEAN_BLOCK_SIGNALS.map((s) => [
      s.policyId,
      (t: GovernanceTask) => (t[s.signal] === s.violatingValue ? s.reason : null)
    ])
  ),
  [MODEL_ALLOWLIST_POLICY_ID]: (t) =>
    t.requestedModel && !/^claude-(sonnet|opus)-/i.test(t.requestedModel)
      ? `Requested model "${t.requestedModel}" is not on the approved list`
      : null
};

/**
 * The set of block-policy ids the pre-flight evaluator actually checks.
 * Exported so a test can assert every enforced-block policy in the catalog is
 * genuinely evaluated (not advertised-only).
 */
export function evaluableBlockPolicyIds(): string[] {
  return Object.keys(BLOCK_POLICY_CHECKS);
}

/**
 * Pre-flight governance gate. Called by the Care Router before it accepts an
 * A2A task, and by the /api/agent-fabric/governance/evaluate route for any
 * agent. Returns the policies that apply and any enforced-block policies the
 * incoming task violates.
 */
export function evaluateGovernance(opts: {
  agentId: string;
  task: GovernanceTask;
}): {
  appliesPolicies: PolicyRecord[];
  blockingViolations: { policyId: string; reason: string }[];
  decision: "allow" | "block";
} {
  const policies = getPoliciesForAgent(opts.agentId);
  const blockingViolations: { policyId: string; reason: string }[] = [];

  for (const p of policies) {
    if (p.status !== "enforced" || p.enforcement !== "block") continue;
    const check = BLOCK_POLICY_CHECKS[p.id];
    if (!check) continue;
    const reason = check(opts.task);
    if (reason) blockingViolations.push({ policyId: p.id, reason });
  }

  return {
    appliesPolicies: policies,
    blockingViolations,
    decision: blockingViolations.length > 0 ? "block" : "allow"
  };
}

/**
 * Convenience helper for API routes -- captures a span with the
 * current wall-clock as both start and end. Use the lower-level
 * recordSpan() when measuring real durations.
 */
export function recordInstantSpan(args: {
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  operation: string;
  protocol: TraceSpan["protocol"];
  status?: TraceSpan["status"];
  attributes?: Record<string, unknown>;
}): TraceSpan {
  const agent = getAgent(args.agentId);
  return recordSpan({
    taskId: args.taskId,
    parentSpanId: args.parentSpanId,
    agentId: args.agentId,
    agentName: agent?.name ?? args.agentId,
    operation: args.operation,
    protocol: args.protocol,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationMs: 0,
    status: args.status ?? "ok",
    attributes: args.attributes
  });
}
