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
    id: "caseload-balancing-agent",
    name: "Caseload Balancing (Care-Manager Panel Assignment) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the care-coordination caseload-balancing piece:
    // POST /api/agents/caseload-balancing/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) care-coordination agent that takes a panel of
    // MEMBERS (each with an acuity weight) and a set of CARE MANAGERS (each with a
    // weighted-slot CAPACITY) and ALLOCATES the members across the managers
    // WITHOUT exceeding any manager's capacity — balancing the load and
    // WAITLISTING the overflow. UNLIKE the Access Anomaly agent's SLIDING-WINDOW
    // COUNTING, the Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION,
    // the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation
    // agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
    // waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log
    // Integrity agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely
    // Filing, Right of Access, Amendment) that add N days to a single date — the
    // heart of this service is GREEDY ALLOCATION UNDER A CAPACITY CONSTRAINT (a
    // bin-packing / worst-fit-decreasing assignment of weighted items into
    // capacity-limited bins). It COMPLEMENTS the other care-coordination agents —
    // distinct from the Care Team & Case Management agent (which assembles the team
    // around ONE patient and picks that patient's case manager), the Complex Care
    // Management agent (CCM time-tracking for ONE patient), the Transitions of Care
    // agent (moving ONE patient), and the Population Health agent (which
    // PRIORITIZES a panel): this ALLOCATES a whole panel across the managers'
    // finite capacity — the balancing of caseloads. An allocation is a
    // RECOMMENDATION requiring a care-management lead to confirm; the agent never
    // autonomously COMMITS the assignment, reassigns a patient, or overrides a
    // manager's caseload. It is PHI-bearing (the members reference the patients on
    // the panel). REUSES the existing care-coordination tier. The members +
    // managers + acuity + capacity are ILLUSTRATIVE, NOT a certified caseload /
    // staffing system.
    endpoint: "/api/agents/caseload-balancing",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a panel of members (each with an acuity weight) and a set of care managers (each with a weighted-slot capacity) and allocates the members across the managers without exceeding any manager's capacity — balancing the load and waitlisting the overflow. A deterministic care-coordination agent; distinct from the Care Team & Case Management agent (assembling the team around ONE patient), the Complex Care Management agent (CCM time-tracking for ONE patient), the Transitions of Care agent (moving ONE patient), and the Population Health agent (prioritizing a panel) — this ALLOCATES a whole panel across the managers' finite capacity",
      "The allocation is DETERMINISTIC — a pure function of the request's own members + managers (no randomness, no clock; not a sliding-window count, an interval merge, a topological sort, a set-difference, a dollar waterfall, an identity match, or a hash chain but GREEDY ALLOCATION UNDER A CAPACITY CONSTRAINT — a worst-fit-decreasing bin-packing that processes members by descending acuity and places each into the manager with the greatest remaining capacity that can fit it, tie-broken by id); the same panel always yields the same assignment",
      "Every member must be accounted for exactly once — the assigned set and the waitlisted set must be disjoint and together cover every submitted member (no dropped member, no double-assignment); a dropped or double-counted member is blocked at the Agent Fabric governance boundary (policy.caseload.assignment-complete, the completeness gate); and capacity must be respected — each manager's assigned acuity must equal the sum of their assigned members' acuities, must not exceed capacity, the remaining capacity must be exact, and every waitlist must be justified (the member's acuity exceeds every manager's final remaining capacity); an over-loaded manager, a miscounted load, or an unjust waitlist is blocked (policy.caseload.capacity-respected, the load-bearing correctness gate). Mirrors the Enrollment Reconciliation Agent's reconciliation-complete + the Member Cost-Share Agent's math-consistent posture",
      "The agent RECOMMENDS — it NEVER commits an assignment, reassigns a patient, or overrides a manager's caseload (each is a care-ownership decision that must be authorized) on its own; an allocation that auto-commits or is not review-gated is blocked (policy.caseload.no-autonomous-assignment), and every allocation is a recommendation requiring a care-management lead to confirm. Mirrors the Care Team Agent's no-autonomous-assignment and the Coverage Continuity Agent's no-autonomous-determination posture",
      "Runs against ILLUSTRATIVE synthetic members + managers + acuity + capacity — clearly labeled; NOT a certified caseload / staffing system (real panel assignment uses validated acuity instruments, care-manager licensure / specialty / language fit, geographic match, and continuity of an existing relationship). PHI-bearing — the members reference the patients on the panel"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "pcp-matching-agent",
    name: "Primary Care Provider (PCP) Assignment / Member–Provider Matching Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the PCP-assignment piece: POST
    // /api/agents/pcp-matching/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) care-coordination agent that takes a panel of
    // unassigned MEMBERS (each with a ranked list of preferred primary care
    // providers) plus a set of PROVIDERS (each with a panel CAPACITY and a
    // ranked list of the members it would accept) and produces a STABLE
    // assignment of members to providers — a matching in which no member and
    // provider who both prefer each other over their current assignment are left
    // apart (no BLOCKING pair) and no provider is over capacity. UNLIKE the
    // Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier
    // Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition
    // agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's
    // PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER
    // APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the
    // Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict
    // agent's GREEDY INTERVAL SELECTION, the Access Anomaly agent's
    // SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING,
    // the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity
    // agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Caseload Balancing agent's
    // GREEDY BIN-PACKING (worst-fit allocation of a panel across managers'
    // capacity by acuity, with NO preferences and NO stability guarantee) — the
    // heart of this service is TWO-SIDED STABLE MATCHING: the Gale–Shapley
    // DEFERRED-ACCEPTANCE algorithm (the member-proposing, many-to-one
    // "hospitals/residents" variant) that, from both sides' preference lists +
    // provider capacities, produces the member-optimal STABLE matching — the
    // unique assignment with no blocking pair. An assignment that leaves a member
    // and provider who each prefer the other over their current lot (a blocking
    // pair) is UNSTABLE — it unravels as the pair defects, leaving a patient
    // without a real PCP. A matching is a RECOMMENDATION requiring a
    // care-coordination lead to confirm — the agent never autonomously COMMITS an
    // assignment, REASSIGNS a patient, or overrides a provider's panel. It
    // COMPLEMENTS the other care-coordination agents — distinct from the Caseload
    // Balancing agent (which BIN-PACKS a panel across managers' capacity to
    // balance load, no preferences), the Care Team & Case Management agent (the
    // team around ONE patient), and the Population Health agent (prioritizing a
    // panel): this produces a STABLE two-sided matching of members to PCPs. It is
    // PHI-bearing (the members are patients). REUSES the existing
    // care-coordination tier. The panel is ILLUSTRATIVE, NOT a certified
    // panel-management system.
    endpoint: "/api/agents/pcp-matching",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a panel of unassigned members (each with a ranked list of preferred primary care providers) plus a set of providers (each with a panel capacity and a ranked list of acceptable members) and produces a STABLE assignment of members to providers — reporting each member's assigned provider + preference rank, the provider loads, the matched / unmatched tallies, and the disposition (all-matched / partial-match). A deterministic care-coordination agent; it COMPLEMENTS the Caseload Balancing agent (which BIN-PACKS a panel across managers' capacity to balance load, no preferences), the Care Team & Case Management agent (the team around ONE patient), and the Population Health agent (prioritizing a panel) — this produces a STABLE two-sided matching of members to PCPs",
      "The matching is DETERMINISTIC — a pure function of the request's own preferences + capacities (no randomness, no clock; not a geospatial distance, a checksum, a union-find, a percentile, an identity match, a largest-remainder apportionment, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but TWO-SIDED STABLE MATCHING — the member-proposing Gale–Shapley deferred-acceptance algorithm producing the member-optimal stable matching); the same panel always yields the same matching",
      "Every assignment must be built from the submitted panel — one assignment per submitted member (all present, none dropped or invented), every assigned provider a submitted one, and the provider loads echoing the submitted capacities + actual counts; a phantom member / provider is blocked at the Agent Fabric governance boundary (policy.pcp.matching-sourced, the sourced + completeness gate); and the matching must be stable — recomputing the Gale–Shapley deferred acceptance from the preferences + capacities must reproduce the assignment + each member's rank, no provider may be over capacity, and there must be NO blocking pair; an unstable / mis-recomputed matching is blocked (policy.pcp.matching-stable, the load-bearing correctness gate). Mirrors the Network Adequacy Agent's distances-consistent + providers-sourced posture",
      "The agent PROPOSES a matching — it NEVER commits an assignment, reassigns a patient, or overrides a provider's panel (each is a care-ownership decision that must be authorized) on its own; a matching that auto-assigns or is not review-gated is blocked (policy.pcp.no-autonomous-assignment), and every matching is confirmed by a care-coordination lead. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Care Team Agent's no-autonomous-assignment posture",
      "Runs against ILLUSTRATIVE synthetic members + providers + preferences + capacities — clearly labeled; NOT a certified panel-management system (real PCP assignment also weighs geography, language, continuity of care, plan-network rules, and member choice, and runs against a live attribution system). PHI-bearing — the members are patients"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "reportable-condition-agent",
    name: "Reportable / Notifiable Condition Case Classification Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical / public-health-compliance
    // case-classification piece: POST /api/agents/reportable-condition/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude)
    // care-coordination agent that takes a patient CASE's structured facts plus a
    // public-health CASE DEFINITION — an ordered list of classifications
    // (confirmed / probable / suspect), each expressed as a nested boolean
    // CRITERIA TREE of all-of (AND) / any-of (OR) / not (NOT) over leaf
    // predicates ("confirmed = lab-positive OR (clinically-compatible AND
    // epi-linked)") — and DETERMINISTICALLY classifies the case by evaluating
    // each classification's tree and taking the highest-precedence one that
    // holds. UNLIKE the PCP Matching agent's TWO-SIDED STABLE MATCHING
    // (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE
    // DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM,
    // the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
    // Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate
    // agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM
    // TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT
    // DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the
    // Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's
    // SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING,
    // the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity
    // agent's HASH CHAIN — the heart of this service is RECURSIVE BOOLEAN
    // EXPRESSION-TREE EVALUATION: the recursive walk of a nested all-of / any-of
    // / not tree whose leaves are predicates over the case's facts, the exact
    // shape a public-health case definition takes, plus a documented
    // classification precedence (the highest-precedence met tree wins). A
    // mis-evaluated tree over-reports a notifiable condition (a false alarm to
    // public health) or under-reports it (a missed case) — so the agent
    // evaluates the tree deterministically and hands the classification to a
    // human; a classification is a RECOMMENDATION requiring an epidemiologist /
    // infection-preventionist to confirm — the agent never autonomously REPORTS
    // the case to a public-health authority. It COMPLEMENTS the other compliance
    // / clinical agents — distinct from the Adverse-Event Reporting agent (which
    // DRAFTS a MedWatch / VAERS report for a drug / vaccine event), the
    // Utilization Review agent (medical-necessity criteria for a service), and
    // the Lab Result agent (a single analyte vs a reference range): this
    // classifies a case against a nested public-health CASE DEFINITION. It is
    // PHI-bearing (the case is a patient's clinical data). REUSES the existing
    // care-coordination tier. The condition + definition are ILLUSTRATIVE, NOT a
    // certified surveillance / case-reporting system.
    endpoint: "/api/agents/reportable-condition",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a patient case's structured facts plus a public-health case definition (an ordered list of classifications — confirmed / probable / suspect — each a nested boolean criteria tree of all-of / any-of / not over leaf predicates) and DETERMINISTICALLY classifies the case — reporting the selected classification, whether it is reportable, each classification's met flag, the referenced facts, and the reason. A deterministic care-coordination / compliance agent; it COMPLEMENTS the Adverse-Event Reporting agent (which DRAFTS a MedWatch / VAERS report for a drug / vaccine event), the Utilization Review agent (medical-necessity criteria for a service), and the Lab Result agent (a single analyte vs a reference range) — this classifies a case against a nested public-health CASE DEFINITION",
      "The classification is DETERMINISTIC — a pure function of the request's own facts + definition (no randomness, no clock; not a stable matching, a geospatial distance, a checksum, a union-find, a percentile, an identity match, a largest-remainder apportionment, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION — the recursive walk of a nested all-of / any-of / not tree over the case's facts, with a documented classification precedence); the same case always yields the same classification",
      "Every criterion must be sourced — each leaf predicate must reference a SUBMITTED fact (no fabricated criterion inventing a requirement the definition never stated), the reported classification results must be exactly the definition's classifications in order, and the referenced-fact set must match the definition's actual leaves; a fabricated criterion / mis-enumerated definition is blocked at the Agent Fabric governance boundary (policy.reportable.facts-sourced, the sourced + completeness gate); and the classification must recompute — re-evaluating each criteria tree from the facts must reproduce each met flag, the selected classification, and the reportable flag; a mis-evaluated tree (an over- or under-reported condition) is blocked (policy.reportable.classification-consistent, the load-bearing correctness gate). Mirrors the PCP Matching Agent's matching-stable + matching-sourced posture",
      "The agent CLASSIFIES — it NEVER reports the case to a public-health authority (a consequential legal action that must be authorized) on its own; a classification that auto-reports or is not review-gated is blocked (policy.reportable.no-autonomous-report), and every classification is confirmed by an epidemiologist / infection-preventionist. Mirrors the Adverse-Event Reporting Agent's human-review posture and the HEDIS Agent's no-autonomous-submission posture",
      "Runs against an ILLUSTRATIVE synthetic condition + case definition + facts — clearly labeled; NOT a certified surveillance / case-reporting system (real notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions, eCR / eICR electronic case reporting, and an epidemiologist's judgment). PHI-bearing — the case is a patient's clinical data"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "timeline-merge-agent",
    name: "Clinical Event Timeline Merge / Multi-Source Record Reconciliation Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the data-substrate record-reconciliation piece:
    // POST /api/agents/timeline-merge/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) platform / data-plane agent that takes a patient's
    // clinical EVENTS as they arrive in several already-sorted source STREAMS (an
    // EHR, another EHR, a pharmacy, a claims feed — each stream in ascending time
    // order) and merges them into ONE chronologically-ordered unified TIMELINE,
    // flagging the DUPLICATES (the SAME clinical event reported by more than one
    // source). UNLIKE the Reportable Condition agent's RECURSIVE BOOLEAN
    // EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE
    // MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL
    // GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC
    // CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS,
    // the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR
    // Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's
    // FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT
    // DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the
    // Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's
    // SLIDING-WINDOW COUNTING, the Care Pathway agent's TOPOLOGICAL ORDERING, the
    // Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log
    // Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Coverage
    // Continuity agent's INTERVAL MERGING (which merges OVERLAPPING date SPANS into
    // continuous coverage; this merges POINT events from many streams into one
    // order) and the Master-Patient-Index agent's WEIGHTED identity MATCHING
    // (which resolves WHO a record belongs to; this runs AFTER identity is known,
    // merging that patient's already-resolved event streams) — the heart of this
    // service is the K-WAY MERGE OF SORTED STREAMS: the classic "merge k sorted
    // lists" / external-sort merge phase that repeatedly takes the earliest head
    // across the k stream cursors to produce one globally-ordered sequence in
    // linear time, plus a content-key DEDUPLICATION pass that flags the
    // second-and-later report of the same clinical event. A mis-ordered or
    // mis-deduplicated timeline corrupts the record — a duplicated med looks like
    // a double dose, an out-of-order lab hides a trend — so the agent merges
    // deterministically and hands the timeline to a data steward; a merge is a
    // RECOMMENDATION and the agent never autonomously WRITES the timeline back to
    // a source of record, PURGES a duplicate, or overwrites a chart. It
    // COMPLEMENTS the other data / provider agents — distinct from the Master
    // Patient Index agent (which RESOLVES identity across systems), the Enrollment
    // Reconciliation agent (a KEYED SET-DIFFERENCE between two rosters), and the
    // Transitions of Care agent (medication reconciliation for ONE encounter):
    // this MERGES a patient's already-resolved event streams into one timeline. It
    // is PHI-bearing (the events are the patient's clinical data). REUSES the
    // existing data-plane tier (platform plane). The events are ILLUSTRATIVE, NOT
    // a certified record-reconciliation / EMPI system.
    endpoint: "/api/agents/timeline-merge",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a patient's clinical events in several already-sorted source streams (EHR, EHR, pharmacy, claims) and merges them into ONE chronologically-ordered unified timeline, flagging the duplicates (the same clinical event reported by more than one source) — reporting the merged timeline, each event's duplicate-of link, the per-source contributions, the kept / duplicate / total tallies, and the disposition (clean-merge / duplicates-found). A deterministic data-substrate agent; it COMPLEMENTS the Master Patient Index agent (which RESOLVES identity across systems), the Enrollment Reconciliation agent (a keyed set-difference between two rosters), and the Transitions of Care agent (medication reconciliation for ONE encounter) — this MERGES a patient's already-resolved event streams into one timeline",
      "The merge is DETERMINISTIC — a pure function of the request's own streams (no randomness, no clock; not a recursive boolean tree, a stable matching, a geospatial distance, a checksum, a union-find, a percentile, an identity match, a largest-remainder apportionment, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but the K-WAY MERGE OF SORTED STREAMS — repeatedly taking the earliest head across the stream cursors, plus a content-key dedup pass); the same streams always yield the same timeline",
      "Every timeline event must be sourced — each entry must trace to a SUBMITTED stream event (same source + eventId + timestamp + kind; no fabricated event), every submitted event must appear exactly once (none dropped, none double-listed), and the per-source contributions + tallies must add up; a fabricated or dropped event is blocked at the Agent Fabric governance boundary (policy.timeline.events-sourced, the sourced + completeness gate); and the merge must recompute — re-running the k-way merge from the streams must reproduce the reported chronological order and the reported duplicate flags; a mis-ordered or mis-deduplicated timeline is blocked (policy.timeline.merge-consistent, the load-bearing correctness gate). Mirrors the Enrollment Reconciliation Agent's reconciliation-complete + the Reportable Condition Agent's classification-consistent posture",
      "The agent MERGES — it NEVER writes the merged timeline back to a source system of record, purges a duplicate, or overwrites a chart (each is a data-integrity action that must be authorized) on its own; a merge that auto-writes or is not review-gated is blocked (policy.timeline.no-autonomous-merge), and every merge is confirmed by a data steward. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Audit Log Integrity Agent's read-only posture",
      "Runs against ILLUSTRATIVE synthetic event streams — clearly labeled; NOT a certified record-reconciliation / EMPI system (real reconciliation resolves identity first via an EMPI, reconciles with FHIR resource provenance, and applies source-of-truth precedence rules). PHI-bearing — the events are a patient's clinical data"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "quality-shift-agent",
    name: "Clinical Quality-Measure Shift Detection (Statistical Process Control) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical / quality-analytics
    // change-point-detection piece: POST /api/agents/quality-shift/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) care-coordination /
    // quality-analytics agent that watches a time-ordered series of a clinical
    // QUALITY MEASURE (a weekly mammography-screening rate, a monthly
    // HbA1c-control rate, a daily lab-QC value) and detects whether the measure
    // has drifted into a SUSTAINED SHIFT away from its established TARGET. UNLIKE
    // the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable
    // Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP
    // Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network
    // Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation
    // agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's
    // UNION-FIND CONNECTED COMPONENTS, the MLR Rebate agent's LARGEST-REMAINDER
    // APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the
    // Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict
    // agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY
    // BIN-PACKING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity
    // agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Provider Benchmarking agent's
    // PERCENTILE / RANK STATISTICS (which ranks one value against a static peer
    // distribution; this watches ONE series evolve over time) and the Access
    // Anomaly agent's SLIDING-WINDOW COUNTING (which counts events in a fixed
    // recent window to catch a spike; this accumulates a running deviation to
    // catch a SUSTAINED small shift a window would miss) — the heart of this
    // service is CHANGE-POINT DETECTION via a two-sided TABULAR CUSUM
    // (cumulative-sum) control chart: it accumulates a one-sided upper sum SH_i =
    // max(0, SH_{i-1} + (x_i − target) − k) and a one-sided lower sum SL_i =
    // max(0, SL_{i-1} + (target − x_i) − k), where k is the slack, and SIGNALS the
    // first observation whose SH or SL exceeds the decision threshold h. A missed
    // shift lets a quality measure decay unnoticed; a false alarm sends a team
    // chasing noise — so the chart signals DETERMINISTICALLY and hands the finding
    // to a human; a signal is a RECOMMENDATION and the agent never launches a
    // corrective action, a recall campaign, or a process change on its own. It
    // COMPLEMENTS the other quality / clinical agents — distinct from the HEDIS
    // agent (which COMPUTES a measure rate), the Population Health agent (which
    // PRIORITIZES a panel by risk), the Provider Benchmarking agent (which RANKS a
    // value against peers), and the Remote Monitoring agent (which checks ONE
    // patient's vitals against a threshold): this watches a quality-measure series
    // for a SUSTAINED shift over time. It charts DE-IDENTIFIED aggregate rate
    // series, but because the measures are derived from patient clinical data it
    // reuses the care-coordination tier and IS on the HIPAA-audit policy. REUSES
    // the existing care-coordination tier (patient / clinical plane). The measures
    // are ILLUSTRATIVE, NOT a certified SPC / quality-surveillance platform.
    endpoint: "/api/agents/quality-shift",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Watches a time-ordered series of a clinical quality measure (a weekly screening rate, a monthly control rate, a daily lab-QC value) and detects whether it has drifted into a SUSTAINED shift away from its target — reporting the charted CUSUM points, the signal (in-control / shift-up-detected / shift-down-detected), the first-alarm index + direction, and the peak sums. A deterministic quality-analytics agent; it COMPLEMENTS the HEDIS agent (which COMPUTES a measure rate), the Population Health agent (which PRIORITIZES a panel by risk), the Provider Benchmarking agent (which RANKS a value against peers), and the Remote Monitoring agent (which checks ONE patient's vitals against a threshold) — this watches a quality-measure series for a sustained shift over time",
      "The detection is DETERMINISTIC — a pure function of the request's own observations + parameters (no randomness, no clock; not a k-way merge, a recursive boolean tree, a stable matching, a geospatial distance, a checksum, a union-find, a percentile / rank, a largest-remainder apportionment, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but CHANGE-POINT DETECTION via a two-sided tabular CUSUM control chart); the same series always yields the same signal",
      "Every charted point must be sourced — each must trace to a SUBMITTED observation (same index + value; no fabricated point), every submitted observation must appear exactly once (none dropped, none double-charted), and the chart parameters must be present; a fabricated or dropped point is blocked at the Agent Fabric governance boundary (policy.quality.observations-sourced, the sourced + completeness gate); and the CUSUM must recompute — re-running the two-sided tabular CUSUM from the observations must reproduce every charted SH_i / SL_i, the first-alarm index, the direction, and the signal; a mis-charted CUSUM (a faked or hidden shift) is blocked (policy.quality.cusum-consistent, the load-bearing correctness gate). Mirrors the Timeline Merge Agent's events-sourced + merge-consistent posture",
      "The agent DETECTS — it NEVER launches a corrective action, a recall / outreach campaign, or a process change (each is a consequential action that must be authorized) on its own; a detection that auto-actions or is not review-gated is blocked (policy.quality.no-autonomous-intervention), and every signal is confirmed by a quality reviewer. Mirrors the HEDIS Agent's no-autonomous-submission and the Care Gap Agent's human-review posture",
      "Runs against ILLUSTRATIVE synthetic aggregate rate series — clearly labeled; NOT a certified SPC / quality-surveillance platform (real statistical process control tunes k and h to a target ARL, combines CUSUM with Shewhart / EWMA charts, and accounts for autocorrelation and measure specifications). Charts de-identified aggregate rates derived from patient clinical data — on the HIPAA-audit policy"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "schedule-conflict-agent",
    name: "Scheduling Conflict / Double-Booking Guard Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the care-coordination scheduling-integrity
    // piece: POST /api/agents/schedule-conflict/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) care-coordination agent that
    // takes a RESOURCE (a provider's clinic day, an infusion chair, an imaging
    // machine) and a BATCH of requested appointment INTERVALS (each a start/end
    // time for a patient) and computes the MAXIMUM CONFLICT-FREE SCHEDULE that
    // fits without double-booking, WAITLISTING the requests that collide. UNLIKE
    // the Caseload Balancing agent's GREEDY BIN-PACKING under a capacity
    // constraint, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the
    // Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION (that one
    // MERGES overlapping intervals; THIS one SELECTS a maximum NON-overlapping
    // subset), the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's
    // SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING,
    // or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the DATE-
    // DEADLINE agents (Timely Filing, Right of Access, Amendment) that add N
    // days to a single date — the heart of this service is GREEDY INTERVAL
    // SELECTION (the classic activity-selection algorithm: sort by earliest
    // finish time and admit each interval that doesn't overlap the last
    // admitted, provably maximizing the count of non-overlapping appointments).
    // It COMPLEMENTS the Appointment Scheduling agent (which BOOKS a SINGLE slot
    // and never double-books THAT slot): this validates a WHOLE BATCH for a
    // resource, computes the conflict-free schedule + the waitlist, and hands it
    // to a scheduler — the double-booking guard for a day, not the booker of one
    // appointment. A schedule is a RECOMMENDATION requiring a scheduler to
    // confirm; the agent never autonomously BOOKS, CANCELS, or BUMPS an
    // appointment. It is PHI-bearing (the requests reference the patients being
    // scheduled). REUSES the existing care-coordination tier. The resource +
    // intervals are ILLUSTRATIVE, NOT a certified scheduling system.
    endpoint: "/api/agents/schedule-conflict",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a resource (a provider's clinic day, an infusion chair, an imaging machine) and a batch of requested appointment intervals (each a start/end time for a patient) and computes the maximum conflict-free schedule that fits without double-booking, waitlisting the requests that collide. A deterministic care-coordination agent; it COMPLEMENTS the Appointment Scheduling agent (which BOOKS a SINGLE slot and never double-books THAT slot) — this validates a WHOLE BATCH for a resource and produces the conflict-free schedule + the waitlist",
      "The schedule is DETERMINISTIC — a pure function of the request's own intervals (time is data: ISO strings or epoch-ms, no real clock; not a bin-packing, a sliding-window count, an interval MERGE, a topological sort, a set-difference, a dollar waterfall, an identity match, or a hash chain but GREEDY INTERVAL SELECTION — the classic activity-selection algorithm, sort by earliest finish and admit each interval that doesn't overlap the last admitted, provably maximizing the number of non-overlapping appointments); the same batch always yields the same schedule",
      "Every scheduled / waitlisted appointment must trace to a submitted request (same id, member, start, end) and every request must be accounted for exactly once across the scheduled and conflict sets — a fabricated appointment, a dropped patient, or a double-count is blocked at the Agent Fabric governance boundary (policy.schedule.intervals-sourced, the sourced + completeness gate); and the schedule must be conflict-free — the scheduled appointments must be pairwise NON-overlapping (no double-booking), every waitlisted appointment must genuinely overlap the scheduled one it names, and the counts must add up; a double-booked resource or a request waitlisted while it actually fit is blocked (policy.schedule.conflict-free, the load-bearing correctness gate). Mirrors the Caseload Balancing Agent's assignment-complete + capacity-respected posture",
      "The agent RECOMMENDS — it NEVER books, cancels, or bumps an appointment (each is a scheduling action that must be authorized) on its own; a schedule that auto-books or is not review-gated is blocked (policy.schedule.no-autonomous-booking), and every schedule is a recommendation requiring a scheduler to confirm. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Appointment Scheduling Agent's governance posture",
      "Runs against ILLUSTRATIVE synthetic resource + intervals — clearly labeled; NOT a certified scheduling system (real scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, and room / equipment constraints). PHI-bearing — the requests reference the patients being scheduled"
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
    governanceTier: "payer-operations"
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
    governanceTier: "payer-operations"
  },
  {
    id: "fwa-detection-agent",
    name: "Fraud, Waste & Abuse Detection Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side FWA screener: POST
    // /api/agents/fwa-detection/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that screens each claim / prior-
    // auth against a defined FWA pattern catalog (unbundling, upcoding,
    // duplicate billing, quantity outliers, impossible-day billing,
    // phantom services), classifies each hit by severity, and routes to
    // the SIU (Special Investigations Unit) for HUMAN review. It NEVER
    // autonomously denies a claim, opens an investigation, or freezes
    // payment — every flagged claim goes to human review with due-process
    // protections. Distinct from the Claims Adjudication Assistant (which
    // AUTO-denies routine catalog edits like NCCI-PTP unbundling with a
    // specific reason code): FWA is about SUSPICIOUS PATTERNS that need
    // investigation, not mechanical edits. REUSES the care-coordination
    // tier.
    endpoint: "/api/agents/fwa-detection",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens claims / prior-auths against a defined FWA pattern catalog (unbundling, upcoding, duplicate billing, quantity outliers, impossible-day billing, phantom services), classifies each hit by severity, and routes to the SIU for HUMAN review. Distinct from the Claims Adjudication Assistant (mechanical edits with immediate deny) — this is about pattern-level suspicion that needs investigation, not routine catalog edits",
      "Screening is DETERMINISTIC — a pure function of the claim + provider peer-baseline + pattern catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same flags + primary pattern + severity, with a documented precedence (high > medium > low; lexical tie-break by pattern-id) and stable flag ordering",
      "Every applied FWA flag must trace to the defined FWA_PATTERNS catalog — a fabricated 'we-just-don't-like-this-provider' flag or a category-of-one pattern is blocked at the Agent Fabric governance boundary (policy.fwa.pattern-catalog-sourced), so the agent cannot raise arbitrary suspicion",
      "The agent NEVER autonomously denies a claim, opens an investigation, or freezes payment — every report is requiresSiuReview:true (when flagged) / investigationOpened:false / paymentFrozen:false, and any autonomous action is blocked (policy.fwa.no-autonomous-denial); denying a claim on unproven suspicion is a Section 1557 / state insurance code / due-process failure. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the PA Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture",
      "The pattern-detection engine may NOT use protected-class attributes (race, ethnicity, religion, national origin, disability, gender identity, sexual orientation, marital status) or provider-demographic proxies as detection factors — a factor list including any of those is blocked (policy.fwa.no-protected-class-factors), a documented compliance failure in real payer FWA systems. Mirrors the Population Health Agent's no-protected-class-factors posture",
      "Runs against ILLUSTRATIVE synthetic pattern catalog + peer baselines + severity thresholds — clearly labeled; NOT SAS Detection and Investigation, LexisNexis Provider Insight, an actual payer SIU rule set, or a certified fraud-detection engine"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "trial-payments-agent",
    name: "Clinical Trial Payments & Stipends Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the trial-payments workflow: POST
    // /api/agents/trial-payments/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that pairs with the Clinical Trials
    // Matching agent (which selects candidates) — this one handles the
    // reimbursable/regulated PAYMENTS side. For each visit, it looks up
    // the IRB-approved compensation schedule, verifies the participant
    // has research-payment consent on file, computes the stipend + travel
    // reimbursement, and routes non-standard payments (missed visit,
    // out-of-range travel, extra procedure) to the study coordinator for
    // cosign. NEVER autonomously deviates from an IRB-approved schedule.
    // NEVER issues a payment without participant consent (45 CFR 46).
    endpoint: "/api/agents/trial-payments",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Computes per-visit participant stipends and travel reimbursement against IRB-approved schedules; classifies each request as schedule-approved / pend-coordinator-review / blocked-no-consent with a specific reason code and routes non-standard payments to the study coordinator for cosign. Pairs with the Clinical Trials Matching agent (patient-to-trial matching) — this handles the payments side",
      "Payment computation is DETERMINISTIC — a pure function of the trial protocol + visit type + participant consent + travel miles + IRB schedule (no randomness, no clock); the same context always yields the same decision + amounts + reason code, with a documented decision precedence (blocked-no-consent > pend-coordinator-review > schedule-approved) and stable rule-id ordering",
      "Every payment must trace to the defined IRB-approved schedule catalog (trial + visit type + rule + reason code) — an off-catalog / ad-hoc payment is blocked at the Agent Fabric governance boundary (policy.trial-payments.schedule-catalog-sourced), so the agent cannot issue arbitrary compensation",
      "The agent NEVER autonomously deviates from an IRB-approved schedule — every non-standard payment (missed visit, out-of-range travel, extra procedure) is DRAFTED for study-coordinator cosign, and any autonomous deviation is blocked (policy.trial-payments.no-autonomous-irb-deviation); autonomous IRB deviations are a research-ethics failure that could invalidate the study. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, and the FWA Agent's no-autonomous-denial posture",
      "No payment may be issued to a participant without research-payment informed consent on file — a payment approved without consent is blocked (policy.trial-payments.participant-consented), a Common Rule / 45 CFR 46 requirement. The safe answer when consent is missing is decision:'blocked-no-consent' with zero payment",
      "Runs against ILLUSTRATIVE synthetic trial schedules + visit types + rules + reason codes — clearly labeled; NOT IRBNet, WCG IRB, Advarra IRB, an actual sponsor's payment protocol, or a certified trial-payments engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "utilization-review-agent",
    name: "Utilization Review Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the utilization-review workflow: POST
    // /api/agents/utilization-review/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent that runs the PRE-SERVICE medical-
    // necessity screen against catalog criteria sets (MCG-analog /
    // InterQual-analog) for a proposed procedure or inpatient admission,
    // classifies as approves-meets-criteria / pend-for-clinical-review /
    // require-peer-to-peer / blocked-non-covered, and routes non-approved
    // cases to a clinical reviewer or peer-to-peer with a catalog-sourced
    // SLA deadline. NEVER autonomously denies — every non-approved decision
    // is DRAFTED for clinician cosign. Distinct from Prior Authorization
    // (which assembles a clinician-gated PA package) and Claims
    // Adjudication (post-service mechanical edits): this is pre-service
    // medical necessity.
    endpoint: "/api/agents/utilization-review",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens each proposed procedure / inpatient admission against catalog medical-necessity criteria and classifies as approves-meets-criteria / pend-for-clinical-review / require-peer-to-peer / blocked-non-covered with a specific reason code; routes non-approved cases to a clinical reviewer or peer-to-peer with a catalog-sourced SLA deadline (standard 72h, urgent 24h, concurrent-review 24h). Pairs with Prior Authorization (assembly), Claims Adjudication (post-service edits), and Grievance & Appeals (post-denial intake)",
      "Screening is DETERMINISTIC — a pure function of the request + criteria evidence + urgency + catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + criteria-met/missing lists + primary reason + SLA deadline, with a documented decision precedence (blocked-non-covered > require-peer-to-peer > pend-for-clinical-review > approves-meets-criteria) and stable rule-id ordering",
      "Every applied criterion + rule + reason code must trace to the defined UR criteria catalog (service type + criteria set + rule + reason) — a fabricated / off-catalog 'we-just-decided-you-don't-need-it' criterion is blocked at the Agent Fabric governance boundary (policy.ur.criteria-catalog-sourced), so the agent cannot invent medical-necessity requirements",
      "The agent NEVER autonomously denies a UR case — every non-approved decision is DRAFTED for clinician cosign, and any autonomous denial is blocked (policy.ur.no-autonomous-denial); UR denial letters are legally consequential under Medicare Advantage / state utilization-review-agent codes with notice + due-process rights, and denying medical necessity on the agent's own authority is a Section 1557 / state-code violation. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, the FWA Agent's no-autonomous-denial, and the Trial Payments Agent's no-autonomous-irb-deviation posture",
      "Every UR case has a catalog-sourced regulatory SLA deadline that traces to urgency + received asOfDate — a silently-extended deadline is blocked (policy.ur.sla-integrity); silently extending a UR deadline breaches Medicare Advantage Chapter 4 / state UR-agent timelines. Mirrors the Grievance & Appeals Agent's deadline-integrity posture",
      "Runs against ILLUSTRATIVE synthetic service-type + criteria + rules + reason codes + SLA windows — clearly labeled; NOT MCG (Milliman Care Guidelines / Indicia), InterQual, an actual payer's UR rule set, or a certified medical-necessity engine"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "provider-contracting-agent",
    name: "Provider Contracting & VBC Terms Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the contracting workflow: POST
    // /api/agents/provider-contracting/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent on the commercial-operations plane
    // that classifies provider-network contracts, computes the VBC
    // quality-gate + spend-benchmark for a reporting period, and drafts
    // term-change proposals for account-owner cosign. Sits alongside the
    // Quality-Measure Attribution agent (attribution) and HEDIS agent
    // (scoring) — this one handles the CONTRACT ITSELF. NEVER autonomously
    // commits a contract-term change; every draft is DRAFTED for a human
    // account owner to sign off on.
    endpoint: "/api/agents/provider-contracting",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Classifies a provider-network contract (fee-for-service, capitation, shared-savings, bundled-payment, MA-value-based, commercial-VBC), computes the VBC quality-gate + spend-benchmark drift for a caller-provided reporting period against a catalog methodology, and classifies as in-good-standing / benchmark-drift-review / draft-term-change / blocked-non-catalog-contract with a specific reason code",
      "Contracting is DETERMINISTIC — a pure function of the request + catalog + caller-provided reporting-period (no randomness, no clock); the same context always yields the same decision + benchmark drift + quality-gate outcome + reason code, with a documented decision precedence (blocked-non-catalog-contract > draft-term-change > benchmark-drift-review > in-good-standing) and stable rule-id ordering",
      "Every classified contract must trace to the CONTRACT_TYPES + BENCHMARK_METHODOLOGIES catalog with applied rules from CONTRACTING_RULES — an off-catalog / bespoke payment model is blocked at the Agent Fabric governance boundary (policy.contracting.contract-type-catalog-sourced), so the agent cannot invent a 'we-made-up-a-payment-model' contract",
      "The agent NEVER autonomously commits a contract-term change (rate, quality-gate threshold, benchmark formula, network status) — every draft-term-change decision is DRAFTED for account-owner cosign, and any autonomous commit is blocked (policy.contracting.no-autonomous-term-change); a contract-term change is legally consequential under state insurance code, provider-contract law, and CMS Medicare Advantage. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, and the Account Management Agent's human-owner-before-contract-change posture",
      "Every VBC contract's quality-gate threshold + spend-drift tolerance must trace to a defined BENCHMARK_METHODOLOGIES entry — a bespoke / opaque / 'we-picked-a-number' benchmark is blocked (policy.contracting.benchmark-methodology-catalog-sourced), because an opaque benchmark polluts every downstream shared-savings / bonus / clawback calculation",
      "Runs against ILLUSTRATIVE synthetic contract-type catalog + methodology catalog + rules + reason codes — clearly labeled; NOT Salesforce Health Cloud Provider Network Management, Optum Contract Manager, an actual payer's contract-lifecycle system, or a certified VBC benchmarking engine. Because it operates on business-side contract terms rather than patient PHI, this agent lives on the commercial-operations plane (NOT patient-care)"
    ],
    provider: "Salesforce",
    governanceTier: "commercial-operations"
  },
  {
    id: "provider-benchmarking-agent",
    name: "Provider Cost & Quality Percentile Benchmarking Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the provider-benchmarking workflow: POST
    // /api/agents/provider-benchmarking/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent on the commercial-operations plane that
    // takes a target provider's metric value plus a PEER COHORT and computes
    // WHERE the provider falls in the DISTRIBUTION — its percentile rank, the
    // cohort median, and a performance band — flagging an unfavorable band for
    // network review. UNLIKE the Claim Lifecycle agent's FSM TRANSITION
    // VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the
    // Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing
    // agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW
    // COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care
    // Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's
    // KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
    // waterfall, the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG
    // Exclusion agent's EXACT identity MATCHING, or the Audit Log Integrity
    // agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely Filing,
    // Right of Access, Amendment) that add N days to a single date — the heart of
    // this service is PERCENTILE / RANK STATISTICS over a numeric distribution:
    // sort the cohort, compute the target's percentile rank (midpoint method),
    // the median, and a quartile band. It COMPLEMENTS the other provider /
    // quality agents — distinct from the Provider Contracting agent (a single VBC
    // benchmark-DRIFT vs a contract threshold), the HEDIS Quality agent (the
    // measure RATES), the Quality-Measure Attribution agent (the DENOMINATOR),
    // and the Provider Credentialing agent (network integrity): this ranks a
    // provider within a peer DISTRIBUTION via percentile. A finding is a
    // RECOMMENDATION requiring a network manager to confirm; the agent never
    // autonomously TIERS, penalizes, or de-networks a provider. DELIBERATELY NOT
    // PHI-BEARING — it operates on provider-level aggregate metrics, not patient
    // PHI, so (like the OIG Exclusion agent) it is NOT on the HIPAA-audit policy.
    // REUSES the existing commercial-operations tier. The cohorts are
    // ILLUSTRATIVE, NOT a certified benchmarking system.
    endpoint: "/api/agents/provider-benchmarking",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a target provider's metric value plus a peer cohort of providers' values and computes where the provider falls in the distribution — its percentile rank (midpoint method), the direction-adjusted effective percentile, the cohort median, and a performance band (top-quartile / above-median / below-median / bottom-quartile) — flagging an unfavorable band for network review. A deterministic commercial-operations agent; it COMPLEMENTS the Provider Contracting agent (a single VBC benchmark-DRIFT vs a contract threshold), the HEDIS Quality agent (the measure RATES), the Quality-Measure Attribution agent (the DENOMINATOR), and the Provider Credentialing agent (network integrity) — this ranks a provider within a peer DISTRIBUTION via percentile",
      "The finding is DETERMINISTIC — a pure function of the request's own value + cohort + metric direction (no randomness, no clock; not an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, a dollar waterfall, a pairwise KB lookup, an exact identity match, or a hash chain but PERCENTILE / RANK STATISTICS over a numeric distribution — sort the cohort, compute the midpoint percentile rank, the median, and a quartile band); the same input always yields the same finding, and the metric direction (higher-is-better for quality, lower-is-better for cost) is honored so a higher effective percentile always means better",
      "The peer cohort must be intact — every cohort member a well-formed { providerId, numeric value }, the reported cohort size equal to the actual cohort, the target value numeric; a phantom / omitted peer that mis-sizes the denominator is blocked at the Agent Fabric governance boundary (policy.benchmark.cohort-sourced, the sourced gate); and the statistics must be exact — recomputing the rank statistics from the cohort must reproduce the reported counts, percentile rank, effective percentile, median, band, and disposition; a miscomputed percentile or a band that doesn't follow is blocked (policy.benchmark.stats-consistent, the load-bearing correctness gate). Mirrors the Claim Lifecycle Agent's states-sourced + transition-consistent posture",
      "The agent BENCHMARKS — it NEVER tiers the provider, adjusts their payment, or removes them from the network (each is a commercially consequential action that must be authorized) on its own; a finding that auto-tiers or is not review-gated is blocked (policy.benchmark.no-autonomous-tiering), and every finding is a recommendation requiring a network manager to confirm. Mirrors the Provider Contracting Agent's no-autonomous-term-change and the Timely Filing Agent's no-autonomous-write-off posture",
      "Runs against ILLUSTRATIVE synthetic peer cohorts + metric values — clearly labeled; NOT a certified benchmarking system (real provider benchmarking uses risk / case-mix adjustment, statistically valid peer grouping, minimum denominators, confidence intervals, and the network team's judgment). Because it operates on provider-level aggregate metrics rather than patient PHI, this agent lives on the commercial-operations plane and is NOT PHI-bearing (NOT on the HIPAA-audit policy)"
    ],
    provider: "Salesforce",
    governanceTier: "commercial-operations"
  },
  {
    id: "deal-desk-agent",
    name: "Deal Desk / Quote Approval Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for Pause's OWN go-to-market deal-desk workflow: POST
    // /api/agents/deal-desk/tasks (card at /.well-known/agent.json). A DETERMINISTIC
    // (no-Claude) agent on the strictly PHI-separated commercial-operations plane.
    // This is Pause's own quoting tooling (selling the platform to health systems /
    // payers / employers), NOT a patient-facing agent — it runs on Sales Cloud
    // commercial data only and never reads, joins, or derives patient PHI. Given a
    // proposed quote (an account reference and a set of line items, each a product,
    // its list price, a quantity, and a proposed discount %), it DETERMINISTICALLY
    // prices each line, sums the list / net / discount totals, computes the effective
    // blended discount, checks each line's discount against its product's max
    // auto-approve guardrail, and decides whether the quote AUTO-APPROVES (every line
    // within guardrail) or must ESCALATE to a human deal-desk owner (any line out of
    // guardrail) — NEVER autonomously approving an out-of-guardrail discount. It
    // COMPLEMENTS the other commercial-operations agents — distinct from the Pipeline
    // Management agent (the B2B opportunity pipeline / forecast roll-up), the Account
    // Management agent (post-close renewals / expansion / health), and the Provider
    // Contracting agent (the payer↔provider network CONTRACT): this validates a
    // proposed SALES QUOTE's pricing + discounting against the deal-desk guardrails.
    // REUSES the existing commercial-operations tier; it is on the commercial no-PHI
    // policy, NOT the HIPAA-audit policy (it never touches PHI).
    endpoint: "/api/agents/deal-desk",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Validates a proposed B2B enterprise quote against the deal-desk pricing / discount-guardrail catalog — prices each line, sums the list / net / discount totals, computes the effective blended discount, checks each line's discount against its product's max auto-approve guardrail, and decides whether the quote auto-approves (every line within guardrail) or must escalate to a human deal-desk owner (any line out of guardrail). Companion to the Pipeline Management (opportunity pipeline / forecast), Account Management (post-close renewals / expansion), and Provider Contracting (payer↔provider network contract) agents — this validates a proposed SALES QUOTE's pricing + discounting",
      "The decision is DETERMINISTIC — a pure function of the quote's own line items + the catalog (no randomness, no clock); the totals + effective discount are computed from the lines, and the same quote always yields the same totals + guardrail result + disposition",
      "Every line must price from the recorded pricing catalog — an ad-hoc / off-catalog product is blocked at the Agent Fabric governance boundary (policy.dealdesk.pricing-catalog-sourced); and the quote totals must equal the recomputed line sums — a guessed / hidden total is blocked (policy.dealdesk.discount-math-consistent, the load-bearing correctness gate). Mirrors the Provider Contracting Agent's contract-type-catalog-sourced and the Good Faith Estimate Agent's math-consistent posture",
      "An out-of-guardrail discount is NEVER autonomously approved — a quote with any line whose discount exceeds its product's max auto-approve guardrail must escalate to a human deal-desk owner; a determination that auto-approves an out-of-guardrail quote is blocked (policy.dealdesk.no-autonomous-out-of-guardrail-approval). Mirrors the Account Management Agent's human-owner-before-contract-change and the Provider Contracting Agent's no-autonomous-term-change posture",
      "Runs against ILLUSTRATIVE synthetic Pause-Health product catalog + guardrail percentages — clearly labeled; NOT a certified CPQ / pricing system (real quoting is governed by the company's CPQ — e.g. Salesforce Revenue Cloud — its approved price book, and its deal-desk / finance discount-approval matrix). Because it operates on commercial quote data rather than patient PHI, this agent lives on the commercial-operations plane (NOT patient-care)"
    ],
    provider: "Salesforce",
    governanceTier: "commercial-operations"
  },
  {
    id: "care-coordination-handoff-agent",
    name: "Care Coordination Handoff Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the cross-setting handoff workflow: POST
    // /api/agents/care-coordination-handoff/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) agent for ANY cross-setting patient
    // transition (hospital → SNF, SNF → home, home → hospice, ED → PCP,
    // PCP → specialist / behavioral health). Assembles a Joint-Commission-
    // NPSG-2 SBAR handoff, verifies the receiving clinician is
    // credentialed, and confirms transfer consent is on file for
    // transitions that require it. NEVER autonomously accepts on behalf
    // of the receiving clinician; every accepted handoff is
    // requiresReceivingClinicianCosign:true / cosigned:false. Distinct
    // from Transitions of Care (post-discharge hospital→home + med
    // reconciliation) and Referral Management (outbound specialist
    // referral).
    endpoint: "/api/agents/care-coordination-handoff",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Deterministically assembles a Joint-Commission-NPSG-2 SBAR handoff (situation, background, assessment, recommendation) for any cross-setting patient transition and classifies as handoff-accepted / pend-sbar-incomplete / blocked-clinician-not-credentialed / blocked-no-consent with a specific reason code. Distinct from Transitions of Care (post-discharge hospital→home + med reconciliation) and Referral Management (outbound specialist referral) — this is any cross-setting handoff",
      "Handoff evaluation is DETERMINISTIC — a pure function of the request + catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + missing-sections list + primary reason, with a documented decision precedence (blocked-no-consent > blocked-clinician-not-credentialed > pend-sbar-incomplete > handoff-accepted) and stable rule-id ordering",
      "Every handoff-accepted decision must have all four SBAR sections populated — the Joint Commission NPSG-2 requires standardized handoff communication; a handoff-accepted decision missing a section is blocked (policy.handoff.sbar-completeness), and the safe answer when incomplete is decision:'pend-sbar-incomplete' routed to sending-clinician-completion",
      "The receiving clinician must be credentialed (current, unsanctioned) — a handoff to an expired / incomplete / sanctioned clinician is a ghost-network variant and a Section 1557 / due-process failure (policy.handoff.receiving-clinician-credentialed); the safe answer is decision:'blocked-clinician-not-credentialed' routed to credentialing-remediation. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture",
      "Transitions that share PHI with a new setting (hospital→SNF, SNF→home, home→hospice, PCP→behavioral-health) require documented transfer consent — a handoff without it is a HIPAA disclosure failure (policy.handoff.consent-on-file); the safe answer is decision:'blocked-no-consent' routed to consent-capture. Mirrors the Consent & Preferences Management Agent's consent-scope posture",
      "Runs against ILLUSTRATIVE synthetic care-setting + transition-type + rule + reason catalogs — clearly labeled; NOT Epic Care Everywhere, Cerner CareAware, an actual health system's handoff protocol, or a certified Joint Commission / ONC-approved handoff module"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "adverse-event-reporting-agent",
    name: "Adverse Event Reporting Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the pharmacovigilance / device-safety
    // reporting workflow: POST /api/agents/adverse-event-reporting/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude)
    // pharmacovigilance analog — classifies drug ADRs, vaccine
    // reactions, device malfunctions, medication errors, and
    // therapeutic failures into the MedWatch (3500/3500A) or VAERS
    // channel, computes the 21-CFR-314.80 seriousness tier, and drafts
    // for regulatory-team cosign. NEVER autonomously files to the FDA.
    // NEVER drafts on an unverified reporter (FDA reporting requires an
    // attested reporter).
    endpoint: "/api/agents/adverse-event-reporting",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Classifies each reported adverse event (drug ADR, vaccine reaction, device malfunction, medication error, therapeutic failure) into the FDA MedWatch (3500 / 3500A) or VAERS channel, computes the 21-CFR-314.80 seriousness tier (non-serious / serious / life-threatening / death), verifies reporter identity attestation, and classifies as draft-medwatch / draft-vaers / blocked-non-catalog-event / blocked-reporter-unverified with a specific reason code",
      "Classification is DETERMINISTIC — a pure function of the request + catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + channel + seriousness + primary reason, with a documented decision precedence (blocked-reporter-unverified > blocked-non-catalog-event > draft-medwatch / draft-vaers) and stable rule-id ordering",
      "Every draft must trace to the ADVERSE_EVENT_TYPES + SERIOUSNESS_TIERS + ADVERSE_EVENT_RULES + ADVERSE_EVENT_REASON_CODES catalog — an off-catalog event type or made-up severity is blocked at the Agent Fabric governance boundary (policy.adverse-event.event-catalog-sourced), because a bespoke event doesn't map to an FDA channel and poisons pharmacovigilance signal",
      "The agent NEVER autonomously submits a MedWatch or VAERS report to the FDA — every draft decision is DRAFTED for regulatory-team cosign, and any autonomous submission is blocked (policy.adverse-event.no-autonomous-submission); FDA submissions are legally consequential under 21 CFR 314.80 (mandatory reporting) with sponsor / manufacturer / clinician liability. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Trial Payments Agent's no-autonomous-irb-deviation, and the HEDIS Agent's no-autonomous-submission posture",
      "Reporter identity must be attested (name / credentials / contact) — an anonymous or unverified reporter is not admissible under FDA reporting requirements and is blocked (policy.adverse-event.reporter-verified). The safe answer when unverified is decision:'blocked-reporter-unverified' routed to blocked-hold",
      "Runs against ILLUSTRATIVE synthetic event-type catalog + seriousness tiers + rules + reason codes — clearly labeled; NOT FDA MedWatch, VAERS, EudraVigilance, an actual sponsor's pharmacovigilance database, or a certified 21 CFR 314.80 submission pipeline"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "data-sharing-tefca-agent",
    name: "Data-Sharing / TEFCA Interoperability Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the interoperability workflow: POST
    // /api/agents/data-sharing-tefca/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) TEFCA / Carequality / CommonWell analog
    // — classifies each cross-org PHI exchange by purpose, verifies the
    // counterparty is a Trusted Exchange Framework participant, applies
    // the patient's data-sharing consent scopes from the Consent agent,
    // and authorizes or blocks the release. NEVER autonomously releases
    // PHI for a non-TPO purpose without explicit consent (HIPAA §164.506).
    // NEVER releases to an unverified counterparty (45 CFR 171 / TEFCA
    // Common Agreement).
    endpoint: "/api/agents/data-sharing-tefca",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Classifies each cross-organization PHI exchange request (TEFCA QHIN, Carequality, CommonWell, Direct Secure Messaging) by purpose (treatment / payment / operations / patient-request / public-health / research), verifies the counterparty against the participant registry, applies the patient's data-sharing consent scopes, and classifies as release-authorized / pend-purpose-verification / blocked-non-catalog-purpose / blocked-participant-unverified / blocked-consent-required-non-tpo with a specific reason code",
      "Exchange evaluation is DETERMINISTIC — a pure function of the request + catalog + caller-provided asOfDate (no randomness, no clock); the same context always yields the same decision + primary reason, with a documented decision precedence (blocked-participant-unverified > blocked-non-catalog-purpose > blocked-consent-required-non-tpo > pend-purpose-verification > release-authorized) and stable rule-id ordering",
      "Every classified exchange must trace to the EXCHANGE_PURPOSES + EXCHANGE_NETWORKS + DATA_SHARING_RULES catalog — an off-catalog / bespoke exchange purpose is blocked at the Agent Fabric governance boundary (policy.data-sharing.purpose-catalog-sourced), because a bespoke purpose doesn't map to a HIPAA disclosure permission and would open the network to unauthorized aggregation",
      "The agent NEVER autonomously releases PHI for a non-TPO purpose without an active consent scope — every non-TPO release without consent is DRAFTED for consent capture, and any autonomous release is blocked (policy.data-sharing.no-autonomous-non-tpo-release); this is the load-bearing HIPAA §164.506 boundary — TPO (treatment / payment / operations) doesn't need consent, everything else does. Mirrors the Consent & Preferences Management Agent's no-scope-override, the Grievance & Appeals Agent's no-phi-in-routing-summary, and the Handoff Agent's transfer-consent posture",
      "The requester participant must be identity-attested against the TEFCA / Carequality / CommonWell participant registry — an unverified counterparty is blocked (policy.data-sharing.participant-verified), because under 45 CFR 171 + the TEFCA Common Agreement a QHIN / participant / sub-participant must be identity-attested before a cross-org exchange is authorized. Mirrors the Provider Credentialing Agent's source-integrity, the Adverse Event Reporting Agent's reporter-verified, and the Handoff Agent's receiving-clinician-credentialed posture",
      "Runs against ILLUSTRATIVE synthetic exchange-network + exchange-purpose + rule + reason catalogs — clearly labeled; NOT an actual TEFCA QHIN implementation, the Carequality Interoperability Framework, the CommonWell Health Alliance node stack, an ONC-certified data-sharing gateway, or a certified 45 CFR 171 information-blocking-safe release engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "risk-adjustment-agent",
    name: "Risk Adjustment & HCC Coding Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for a value-based-care documentation-integrity agent:
    // POST /api/agents/risk-adjustment/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) agent that reviews a patient's clinical context and
    // identifies suspected / confirmed HIERARCHICAL CONDITION CATEGORIES (HCCs) for
    // risk adjustment — mapping each to the documented clinical evidence that
    // supports it, computing a RAF-style risk score from the confirmed set, and
    // flagging coding gaps (suspected-but-unconfirmed) and unsupported / over-coded
    // entries. It is a RECOMMENDER + integrity checker: every suspected code is a
    // recommendation requiring clinician validation, and it NEVER autonomously
    // submits codes or adjusts a claim / RAF for reimbursement. It COMPLEMENTS — it
    // does NOT duplicate — the HEDIS & Quality Reporting and Quality-Measure
    // Attribution agents (those score quality MEASURES; this is risk-adjustment
    // CONDITION coding). REUSES the existing care-coordination tier (a quality /
    // care-management activity), not a new tier. The HCC catalog, illustrative RAF
    // weights, and supporting-evidence catalog are ILLUSTRATIVE synthetics, NOT the
    // certified CMS-HCC model, real RAF coefficients, or a certified coding engine.
    endpoint: "/api/agents/risk-adjustment",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Reviews a SINGLE patient's clinical context and identifies suspected / confirmed HCCs for risk adjustment (each mapped to the documented clinical evidence that supports it), computes a RAF-style risk score from the confirmed set, and flags coding gaps + unsupported / over-coded entries — a clinical-documentation-integrity agent that COMPLEMENTS, not duplicates, the HEDIS & Quality Reporting and Quality-Measure Attribution agents (quality MEASURES) with risk-adjustment CONDITION coding",
      "HCC suspicion + RAF scoring is DETERMINISTIC — a pure function of the structured clinical context against the HCC + supporting-evidence catalogs (no randomness, no clock; any dates are taken as data); the same context always yields the same assessment, with confirmed = coded + evidence-supported, suspected = evidence-supported but uncoded (a coding gap), and unsupported = coded but not evidence-supported (over-coded)",
      "Every confirmed / suspected HCC must trace to documented clinical evidence in the catalog — a fabricated / unsupported code presented as supported (upcoding) is blocked at the Agent Fabric governance boundary (policy.riskadj.evidence-supported-coding); a coding gap or an unsupported / over-coded flag is a SAFE, honest OUTPUT surfaced for a clinician to validate / correct, NOT a block",
      "Every suspected code is a RECOMMENDATION requiring clinician validation before use — a suspected code finalized without clinician validation is blocked (policy.riskadj.clinician-validation-required); and the agent NEVER autonomously submits codes or adjusts a claim / RAF for reimbursement — an autonomous submission is blocked (policy.riskadj.no-autonomous-submission). Mirrors the Prior Authorization Agent's clinician-approval + no-autonomous-submission posture",
      "Runs against an ILLUSTRATIVE synthetic HCC catalog, RAF weights, and supporting-evidence catalog — clearly labeled; NOT the certified CMS-HCC model, real RAF coefficients, ICD-10 → HCC crosswalks, or a certified risk-adjustment / coding engine"
    ],
    provider: "Salesforce",
    governanceTier: "care-coordination"
  },
  {
    id: "master-patient-index-agent",
    name: "Master Patient Index / Identity Resolution Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // identity service: POST /api/agents/master-patient-index/tasks (card at
    // /.well-known/agent.json). The identity/dedup layer of the data substrate:
    // given an INCOMING patient record plus a set of CANDIDATE records, it
    // DETERMINISTICALLY scores each candidate against a TRANSPARENT weighted
    // demographic feature set (name, DOB, administrative sex, address, phone,
    // member/MRN identifiers), classifies each as match / possible-match /
    // no-match by FIXED thresholds, and recommends a resolution action (link /
    // merge / manual-review / no-action). It is a RECOMMENDER + integrity gate:
    // a high-confidence match at/above the auto-match threshold surfaces a
    // link/merge recommendation, but a merge below that threshold is a
    // manual-review recommendation requiring a human steward — there is never an
    // 'auto-merged' state, and it NEVER autonomously merges a low-confidence
    // pair. It COMPLEMENTS the other platform agents (salesforce-data-360,
    // consent-management, mulesoft-ingest) — it is the identity/dedup layer,
    // distinct from all of them. It is a control-plane / data-substrate service
    // (platform plane), NOT a live-Claude agent. The match features + weights +
    // thresholds + patient records are ILLUSTRATIVE synthetics, NOT a certified
    // EMPI algorithm.
    endpoint: "/api/agents/master-patient-index",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The identity/dedup layer of the data substrate — resolves a patient's identity across source systems by scoring an INCOMING record against a set of CANDIDATE records, complementing (not duplicating) Data 360 grounding, the Consent & Preferences Management agent, and the MuleSoft ingest process",
      "Matching is DETERMINISTIC and TRANSPARENT — a pure, additive/weighted function of a defined demographic feature set (name, DOB, member/MRN identifier, address, phone, administrative sex), each with a documented weight; the same incoming + candidates always yield the same scores + classifications + recommendation (stable, documented candidateId tie-break; no randomness, no clock)",
      "Every match decision is EXPLAINABLE by citing its matched features and traces to the defined match-feature spec — an opaque / off-spec / black-box match is blocked at the Agent Fabric governance boundary (policy.mpi.transparent-matching)",
      "A merge below the auto-match threshold is NEVER performed autonomously — it is a manual-review recommendation requiring a human steward (policy.mpi.no-autonomous-merge); and the matching feature set may NOT use a protected-class attribute (race, ethnicity, religion, etc.) — a fairness / responsible-AI requirement (policy.mpi.no-protected-class-matching)",
      "Runs against ILLUSTRATIVE synthetic match features + weights + thresholds and synthetic/de-identified patient records — clearly labeled; NOT a certified enterprise master-patient-index (EMPI) algorithm"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "identifier-validation-agent",
    name: "Provider Identifier (NPI) Validation & Integrity Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the data-substrate identifier-integrity piece:
    // POST /api/agents/identifier-validation/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) platform / data-plane
    // agent that takes a BATCH of National Provider Identifiers and validates
    // each one with the CMS check-digit algorithm — the Luhn (mod-10) checksum
    // computed over the "80840" prefix + the 9-digit base — classifying each as
    // valid / invalid-format / invalid-checksum and flagging the invalid ones for
    // a data steward. UNLIKE the Household Composition agent's UNION-FIND
    // CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK
    // STATISTICS, the Master-Patient-Index agent's WEIGHTED identity MATCHING, the
    // Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name
    // Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY
    // INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the
    // Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity
    // agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the
    // Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log
    // Integrity agent's HASH CHAIN — the heart of this service is a
    // MODULAR-ARITHMETIC CHECKSUM: the Luhn (mod-10) check-digit computation that
    // the NPI standard uses. An NPI with a transposed or mistyped digit fails the
    // checksum; catching it before it lands on a claim or in a provider directory
    // prevents a claim rejection or a ghost-directory entry. A determination is a
    // RECOMMENDATION requiring a data steward to confirm — the agent never
    // autonomously REJECTS a claim, REMOVES a provider, or CORRECTS a number. It
    // COMPLEMENTS the other provider-data agents — distinct from the Provider
    // Credentialing agent (which cites an npi-registry as a verification SOURCE
    // but does not validate the check digit) and the OIG Exclusion agent (which
    // MATCHES an NPI against the sanctions list): this validates that the NPI
    // itself is well-formed and its check digit is correct. It is DELIBERATELY NOT
    // PHI-BEARING — an NPI is a provider identifier, not patient health
    // information — so, like the OIG Exclusion agent, it is NOT on the HIPAA-audit
    // policy. REUSES the existing data-plane tier (platform plane). The
    // identifiers are ILLUSTRATIVE, NOT a certified NPPES / registry lookup.
    endpoint: "/api/agents/identifier-validation",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a batch of National Provider Identifiers and validates each one with the CMS check-digit algorithm — the Luhn (mod-10) checksum computed over the '80840' prefix + the 9-digit base — classifying each as valid / invalid-format / invalid-checksum and reporting the per-kind counts and the batch disposition (all-valid / invalids-flagged). A deterministic data-substrate integrity agent; it COMPLEMENTS the Provider Credentialing agent (which cites an npi-registry as a verification SOURCE but does not validate the check digit) and the OIG Exclusion agent (which MATCHES an NPI against the sanctions list) — this validates that the NPI itself is well-formed and its check digit is correct",
      "The validation is DETERMINISTIC — a pure function of the request's own identifiers (no randomness, no clock; not a percentile, a union-find, an identity match, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but a MODULAR-ARITHMETIC CHECKSUM — the Luhn / mod-10 check digit the NPI standard uses); the same batch always yields the same result",
      "Every result must be built from the submitted batch — one result per submitted identifier (same NPI, same order; no fabricated result, no dropped identifier), with the reported counts summing to the total and the disposition following; a fabricated or dropped identifier is blocked at the Agent Fabric governance boundary (policy.identifier.identifiers-sourced, the sourced + completeness gate); and the checksums must recompute — recomputing each identifier's format classification and Luhn check digit from the NPI must reproduce the reported disposition, expected check digit, and counts; a miscomputed checksum (a mistyped NPI waved through, or a correct one failed) is blocked (policy.identifier.checksum-consistent, the load-bearing correctness gate). Mirrors the Household Composition Agent's links-sourced + the Provider Benchmarking Agent's stats-consistent posture",
      "The agent VALIDATES and FLAGS — it NEVER rejects a claim, removes a provider from the directory, or corrects a number (each is a consequential action that must be authorized) on its own; a determination that auto-rejects or is not review-gated is blocked (policy.identifier.no-autonomous-reject), and every finding is confirmed by a data steward. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned and the Enrollment Reconciliation Agent's no-autonomous-change posture",
      "Runs against ILLUSTRATIVE synthetic identifiers — clearly labeled; validates the NPI's STRUCTURE + Luhn check digit only, NOT a certified NPPES / registry lookup (it does NOT confirm the NPI is assigned, active, or belongs to a particular provider). DELIBERATELY NOT PHI-bearing — an NPI is a provider identifier, not patient health information"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "break-the-glass-agent",
    name: "Break-the-Glass / Emergency Access Governance Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // security service: POST /api/agents/break-the-glass/tasks (card at
    // /.well-known/agent.json). Governs emergency "break-the-glass" override
    // access to PHI: given an ACCESS REQUEST — requester role, target patient,
    // stated purpose, an emergency flag, and a free-text clinical justification —
    // it DETERMINISTICALLY decides whether to grant emergency access, and if so
    // returns a TIME-BOXED, MINIMUM-NECESSARY grant (a scoped field set + a
    // derived expiry), ALWAYS emitting a mandatory audit event and flagging the
    // grant for mandatory post-access review. It NEVER grants standing / broad /
    // full-record access and never grants without a recorded justification. A
    // DENY (no emergency, no justification, or an off-catalog purpose) is a SAFE,
    // completed answer — NOT a block. It COMPLEMENTS the other platform agents —
    // distinct from the Consent & Preferences Management agent (patient consent
    // scopes for outreach / data-sharing) and the Master Patient Index (identity
    // / dedup): this governs EMERGENCY clinician access under HIPAA
    // minimum-necessary + audit. It is a control-plane / data-substrate service
    // (platform plane), NOT a live-Claude agent. The purpose catalog, scopes,
    // durations, and audit ids are ILLUSTRATIVE synthetics, NOT a certified
    // break-the-glass system.
    endpoint: "/api/agents/break-the-glass",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The emergency-access governance layer of the data substrate — governs break-the-glass override access to PHI, complementing (not duplicating) the Consent & Preferences Management agent (consent scopes) and the Master Patient Index (identity/dedup)",
      "Access decisions are DETERMINISTIC — a pure function of the request + its own atTime (no randomness, no clock); a grant is ALWAYS time-boxed (an expiry derived from atTime + the purpose's duration) and minimum-necessary (the purpose's scoped field set — never the full chart), and the same request always yields the same grant/deny + scope + expiry + audit id",
      "No emergency access without a recorded, non-empty clinical justification — an asserted-but-unjustified grant is blocked at the Agent Fabric governance boundary (policy.btg.justification-required)",
      "Every grant is minimum-necessary + time-boxed — a standing / full-record / non-expiring grant is blocked (policy.btg.minimum-necessary-time-boxed); and every emergency access must emit a mandatory audit event AND be flagged for post-access review — un-audited access is blocked (policy.btg.mandatory-audit-review)",
      "Runs against an ILLUSTRATIVE synthetic purpose catalog + minimum-necessary scopes + access durations + audit ids — clearly labeled; NOT a certified break-the-glass / emergency-access system"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "records-retention-agent",
    name: "Data Retention & Records Lifecycle Management Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // records-management service: POST /api/agents/records-retention/tasks (card
    // at /.well-known/agent.json). Manages the lifecycle of records against
    // RETENTION SCHEDULES and LEGAL HOLDS: given a RECORD — its type/category,
    // patient, created and last-touched dates (evaluated against a provided
    // atTime), jurisdiction, and any active legal hold — it DETERMINISTICALLY
    // produces a disposition RECOMMENDATION (retain / eligible-for-purge / hold),
    // citing the governing retention rule and the computed retention expiry. It
    // NEVER autonomously purges: an eligible-for-purge is a RECOMMENDATION
    // requiring human approval, and an active LEGAL HOLD ALWAYS overrides a purge
    // (a held record is `hold`, never eligible-for-purge). An eligible-for-purge
    // RECOMMENDATION is a SAFE, completed answer — NOT a block, and never a
    // deletion. It COMPLEMENTS the other platform agents — distinct from the
    // Consent & Preferences Management agent (patient consent scopes for outreach
    // / data-sharing), the Master Patient Index (identity / dedup), and the
    // Break-the-Glass / Emergency Access Governance agent (emergency PHI access):
    // this governs records RETENTION / DISPOSITION under records-management +
    // legal-hold obligations. It is a control-plane / data-substrate service
    // (platform plane), NOT a live-Claude agent. The retention schedules, periods,
    // and rule ids are ILLUSTRATIVE synthetics, NOT a certified records-management
    // system — real retention is jurisdiction-specific and legally reviewed.
    endpoint: "/api/agents/records-retention",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The records-disposition layer of the data substrate — manages the lifecycle of records against retention schedules and legal holds, complementing (not duplicating) the Consent & Preferences Management agent (consent scopes), the Master Patient Index (identity/dedup), and the Break-the-Glass agent (emergency PHI access)",
      "Dispositions are DETERMINISTIC — a pure function of the record's dates + the request's own atTime (no randomness, no clock); the retention expiry is derived from the record dates + the schedule period, and the same record always yields the same recommendation (retain / eligible-for-purge / hold) + cited rule + expiry",
      "A legal hold ALWAYS overrides a purge — a record under an active legal hold is retained on hold and is never marked eligible-for-purge; a purge asserted while under a hold is blocked at the Agent Fabric governance boundary (policy.retention.legal-hold-overrides-purge)",
      "Every disposition must cite a recorded retention schedule — an ad-hoc / un-sourced disposition is blocked (policy.retention.schedule-sourced); and a destructive purge is never executed autonomously — an eligible-for-purge is a RECOMMENDATION requiring human approval, and an autonomous / unapproved purge is blocked (policy.retention.no-autonomous-purge)",
      "Runs against ILLUSTRATIVE synthetic retention schedules + periods + rule ids — clearly labeled; NOT a certified records-management system (real retention is jurisdiction-specific and legally reviewed)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "deidentification-agent",
    name: "De-Identification & Safe Harbor Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // de-identification service: POST /api/agents/deidentification/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) data-substrate agent.
    // Given a dataset described by its FIELDS (each a name, the Safe Harbor
    // identifier category it maps to — or non-identifier — and the action taken:
    // removed / generalized / retained), the chosen de-identification METHOD
    // (safe-harbor or expert-determination), the categories attested absent, and
    // (for expert determination) the cited determination reference, it
    // DETERMINISTICALLY screens the dataset against the eighteen HIPAA Safe Harbor
    // identifier categories (45 CFR 164.514(b)(2)), computes which categories
    // remain identifiable after the field actions, computes whether all eighteen
    // categories were screened, validates the method citation, and decides whether
    // the dataset qualifies as de-identified. It COMPLEMENTS the other platform
    // agents — distinct from the Consent & Preferences Management agent (consent
    // scopes), the Master Patient Index (identity/dedup), the Break-the-Glass
    // agent (emergency PHI access), the Data Retention agent (records disposition),
    // and the Data-Sharing / TEFCA agent (interoperability exchange): this decides
    // whether a dataset is DE-IDENTIFIED (no longer PHI) under Safe Harbor before a
    // secondary use / disclosure. It is a control-plane / data-substrate service
    // (platform plane). The category catalog + generalization rules are ILLUSTRATIVE
    // synthetics, NOT a certified de-identification engine.
    endpoint: "/api/agents/deidentification",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The de-identification layer of the data substrate — screens a dataset's fields against the eighteen HIPAA Safe Harbor identifier categories (45 CFR 164.514(b)(2)) and decides whether the dataset qualifies as de-identified, complementing (not duplicating) the Consent & Preferences Management agent (consent scopes), the Master Patient Index (identity/dedup), the Break-the-Glass agent (emergency PHI access), the Data Retention agent (records disposition), and the Data-Sharing / TEFCA agent (interoperability exchange)",
      "Determinations are DETERMINISTIC — a pure function of the dataset's fields + the category catalog (no randomness, no clock); the same dataset always yields the same de-identification decision + remaining identifier categories + release flag",
      "A de-identification determination must screen ALL eighteen Safe Harbor categories — an incomplete screen that skips a category is blocked at the Agent Fabric governance boundary (policy.deid.all-categories-screened); and it must cite a recognized method — Safe Harbor or a qualified Expert Determination with a cited reference — an ad-hoc / un-cited de-identification is blocked (policy.deid.method-cited). Mirrors the Good Faith Estimate Agent's expected-items-complete and the Data Retention Agent's schedule-sourced posture",
      "A re-identifiable dataset is NEVER released as de-identified — a dataset that still contains a remaining identifier (a retained identifier, or a generalization that does not satisfy Safe Harbor) marked de-identified / release-approved is blocked (policy.deid.no-release-of-reidentifiable); a not-de-identified dataset is a completed determination requiring human review under a data use agreement. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Master Patient Index Agent's no-autonomous-merge posture",
      "Runs against an ILLUSTRATIVE synthetic Safe Harbor category catalog + generalization rules — clearly labeled; NOT a certified de-identification engine (a real determination applies the full Safe Harbor method including the actual-knowledge clause, or a qualified statistician's Expert Determination under 45 CFR 164.514(b))"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "minimum-necessary-agent",
    name: "Minimum Necessary (HIPAA) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // minimum-necessary service: POST /api/agents/minimum-necessary/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) data-substrate agent.
    // Given a disclosure request (a requestor role, a purpose-of-use, the specific
    // fields requested — each mapped to a field CATEGORY — and the record scope:
    // single-patient / cohort / bulk), it DETERMINISTICALLY resolves the governing
    // purpose-of-use rule and decides per field whether it is within the
    // minimum-necessary scope for that purpose (release) or beyond it (withhold),
    // yielding a disclosure limited to the minimum necessary (45 CFR 164.502(b) /
    // 164.514(d)). Treatment / to-the-individual / authorized / required-by-law
    // purposes are EXEMPT from the standard. It COMPLEMENTS the other platform
    // agents — distinct from the Consent & Preferences Management agent (WHETHER a
    // patient may be contacted / data used for a scope), the De-Identification agent
    // (whether a dataset is no longer PHI), the Master Patient Index
    // (identity/dedup), the Break-the-Glass agent (emergency PHI access), and the
    // Data Retention agent (records disposition): this decides HOW MUCH of an
    // identified patient's PHI a given purpose-of-use may see. REUSES the existing
    // data-plane tier (platform plane). The purpose-of-use catalog + role + category
    // mappings are ILLUSTRATIVE synthetics, NOT a certified minimum-necessary engine.
    endpoint: "/api/agents/minimum-necessary",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The minimum-necessary layer of the data substrate — decides whether a PHI disclosure is limited to the minimum necessary for its stated purpose-of-use + requestor role (45 CFR 164.502(b) / 164.514(d)), releasing only the permitted field categories and withholding the rest, complementing (not duplicating) the Consent & Preferences Management agent (whether a patient may be contacted / data used), the De-Identification agent (whether a dataset is no longer PHI), the Master Patient Index (identity/dedup), the Break-the-Glass agent (emergency PHI access), and the Data Retention agent (records disposition)",
      "Determinations are DETERMINISTIC — a pure function of the request + the purpose-of-use catalog (no randomness, no clock); the same request always yields the same field decisions + released/withheld sets + flags",
      "Every disclosure decision must cite a recorded purpose-of-use — an ad-hoc / un-sourced disclosure is blocked at the Agent Fabric governance boundary (policy.minnec.purpose-of-use-sourced); and every RELEASED field must be within the purpose's permitted categories — releasing an out-of-scope field over-discloses PHI and is blocked (policy.minnec.minimum-necessary-scoped, the load-bearing privacy gate). Mirrors the De-Identification Agent's method-cited + no-release-of-reidentifiable posture",
      "An over-scope (narrowed) or bulk / cohort disclosure is a RECOMMENDATION requiring human review — it is never autonomously released; a not-minimum-necessary or bulk determination that does not require human review is blocked (policy.minnec.no-autonomous-over-disclosure). Mirrors the De-Identification Agent's no-release-of-reidentifiable and the Balance Billing Agent's no-autonomous-balance-bill posture",
      "Runs against an ILLUSTRATIVE synthetic purpose-of-use catalog + requestor roles + field categories — clearly labeled; NOT a certified minimum-necessary engine (a real determination uses the covered entity's role-based access policies and its minimum-necessary standard under 45 CFR 164.502(b) / 164.514(d))"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "audit-log-integrity-agent",
    name: "Audit Log Integrity (Tamper-Evidence) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // audit-log-integrity service: POST /api/agents/audit-log-integrity/tasks (card
    // at /.well-known/agent.json). A DETERMINISTIC (no-Claude) data-substrate agent.
    // Every agent on the fabric writes a HIPAA audit span; THIS agent verifies the
    // audit trail itself. Given an audit log (an ordered list of entries, each with a
    // sequence number, actor, action, target, timestamp, the prior entry's hash, and
    // its own hash), it DETERMINISTICALLY recomputes each entry's hash and the chain
    // links, checks the sequence numbers for gaps, and decides whether the log is
    // verified (hash chain intact AND sequence complete), flagging any break for human
    // forensic review while NEVER rewriting the log itself. It COMPLEMENTS the other
    // platform agents — distinct from the Consent agent (whether a patient may be
    // contacted / data used), the De-Identification agent (whether a dataset is no
    // longer PHI), the Minimum Necessary agent (how much PHI a purpose may see), the
    // Master Patient Index (identity/dedup), the Break-the-Glass agent (emergency PHI
    // access), and the Data Retention agent (records disposition): this verifies that
    // the AUDIT TRAIL of everything the fabric did has not been tampered with. REUSES
    // the existing data-plane tier (platform plane). The hash is an ILLUSTRATIVE
    // non-cryptographic FNV-1a, NOT a certified tamper-evidence system.
    endpoint: "/api/agents/audit-log-integrity",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The tamper-evidence layer of the data substrate — verifies that an audit trail is intact by recomputing its hash chain and checking its sequence numbers for gaps, deciding whether the log is verified (hash chain intact AND sequence complete), complementing (not duplicating) the Consent agent (whether a patient may be contacted / data used), the De-Identification agent (whether a dataset is no longer PHI), the Minimum Necessary agent (how much PHI a purpose may see), the Master Patient Index (identity/dedup), the Break-the-Glass agent (emergency PHI access), and the Data Retention agent (records disposition)",
      "Verification is DETERMINISTIC — a pure function of the log's entries (no randomness, no clock); the same log always yields the same verified / hash-chain / sequence result",
      "A log may be marked verified only if its hash chain is intact — asserting a verified log over a broken chain hides tampering and is blocked at the Agent Fabric governance boundary (policy.auditlog.hash-chain-verified); and only if its sequence is complete — asserting a verified log with a sequence gap hides a deleted entry and is blocked (policy.auditlog.sequence-complete, the load-bearing completeness gate). Mirrors the Minimum Necessary Agent's minimum-necessary-scoped posture",
      "The agent VERIFIES and FLAGS — it NEVER deletes, rewrites, or repairs an audit entry (that would destroy evidence); a determination that claims it repaired / mutated the log is blocked (policy.auditlog.no-autonomous-redaction), and a broken log is flagged for human forensic review. Mirrors the Data Retention Agent's no-autonomous-purge and the Minimum Necessary Agent's no-autonomous-over-disclosure posture",
      "Runs against an ILLUSTRATIVE synthetic NON-cryptographic FNV-1a hash chain — clearly labeled; NOT a certified tamper-evidence system (a real control uses a cryptographic hash such as SHA-256, append-only / WORM storage, and signed checkpoints)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "accounting-of-disclosures-agent",
    name: "Accounting of Disclosures (HIPAA §164.528) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // accounting-of-disclosures service: POST /api/agents/accounting-of-disclosures/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude) data-substrate
    // agent that answers a patient's HIPAA §164.528 RIGHT to an accounting of who
    // their PHI was disclosed to, and for what non-TPO purpose, over the prior years.
    // Given an accounting request (a patient reference, an as-of date, a lookback
    // window in years, and the patient's disclosure log — each disclosure a date, a
    // recipient, and the cited purpose-of-disclosure), it DETERMINISTICALLY classifies
    // each disclosure (in-accounting / excluded-TPO / excluded-authorized /
    // out-of-window) against the §164.528 accountability rules (treatment / payment /
    // operations and patient-authorized disclosures are EXCLUDED; non-TPO disclosures
    // — public-health mandates, law enforcement, judicial orders, research without
    // authorization — ARE accountable), filters to the lookback window (as-of date −
    // lookback years), and assembles the accounting, NEVER autonomously suppressing a
    // logged disclosure. It COMPLEMENTS the other platform agents — distinct from the
    // Consent agent (whether a patient may be contacted / data used), the Minimum
    // Necessary agent (how much PHI a purpose may see), the De-Identification agent
    // (whether a dataset is still PHI), the Data Retention agent (records disposition),
    // and the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident):
    // this answers WHO the patient's PHI was disclosed to. REUSES the existing
    // data-plane tier (platform plane). The purpose catalog + accountability rules are
    // ILLUSTRATIVE, NOT a certified §164.528 system.
    endpoint: "/api/agents/accounting-of-disclosures",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The accounting-of-disclosures layer of the data substrate — given a patient's disclosure log, classifies each disclosure (in-accounting / excluded-TPO / excluded-authorized / out-of-window) against the §164.528 accountability rules, filters to the lookback window, and assembles the accounting of every accountable (non-TPO, non-authorized) disclosure. Complements (not duplicates) the Consent agent (whether a patient may be contacted / data used), the Minimum Necessary agent (how much PHI a purpose may see), the De-Identification agent (whether a dataset is still PHI), the Data Retention agent (records disposition), and the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident) — this answers WHO the patient's PHI was disclosed to",
      "The accounting is DETERMINISTIC — a pure function of the request's own fields (no randomness, no clock); the window is the as-of date − the lookback years, and the same log always yields the same classification + accounting + counts",
      "Every disclosure's purpose must trace to a recorded catalog — an off-catalog purpose can't be correctly classified and is blocked at the Agent Fabric governance boundary (policy.accounting.purpose-category-sourced); and every accountable, in-window disclosure must appear in the accounting — dropping one understates the accounting and is blocked (policy.accounting.accountable-disclosures-complete, the load-bearing completeness gate). Mirrors the Minimum Necessary Agent's purpose-of-use-sourced and the Audit Log Integrity Agent's sequence-complete posture",
      "The agent CLASSIFIES and ASSEMBLES — it NEVER deletes, redacts, or suppresses a logged disclosure (that would falsify the accounting and destroy evidence); a determination that suppresses a disclosure or auto-releases the accounting is blocked (policy.accounting.no-autonomous-suppression), and the assembled accounting is a recommendation requiring privacy-officer review. Mirrors the Audit Log Integrity Agent's no-autonomous-redaction and the Minimum Necessary Agent's no-autonomous-over-disclosure posture",
      "Runs against an ILLUSTRATIVE synthetic purpose catalog + accountability rules — clearly labeled; NOT a certified accounting-of-disclosures system (a real accounting is governed by HIPAA §164.528 — the full exclusion set, the six-year window, and the electronic-health-record disclosure rules — and the covered entity's Notice of Privacy Practices)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "right-of-access-agent",
    name: "Right of Access (HIPAA §164.524) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // right-of-access service: POST /api/agents/right-of-access/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) data-substrate agent
    // that adjudicates a patient's HIPAA §164.524 RIGHT to GET a copy of their own
    // PHI, and BY WHEN. Given an access request (a patient reference, the request
    // type, the request date, an as-of date, whether the requested PHI is in a
    // designated record set, an optional cited denial-ground / exception, and
    // whether the single 30-day extension was invoked), it DETERMINISTICALLY
    // computes the §164.524 response deadline (request date + 30 days, or + 60 with
    // the extension, via pure UTC date math — dates as data, NO Date.now()),
    // classifies any cited exception against the §164.524 grounds (unreviewable —
    // psychotherapy notes, legal-proceeding compilation, CLIA-exempt lab; reviewable
    // — endangerment, reference to another person), and decides the disposition
    // (grant-in-full / deny-unreviewable / deny-reviewable-needs-review /
    // not-accessible-outside-record-set), NEVER autonomously releasing the record or
    // issuing a denial. It COMPLEMENTS the other platform agents — distinct from the
    // Accounting of Disclosures agent (WHO the PHI was disclosed to, §164.528), the
    // Consent agent (whether a patient may be contacted / data used), the Minimum
    // Necessary agent (how much PHI a purpose may see), the De-Identification agent
    // (whether a dataset is still PHI), the Data Retention agent (records
    // disposition), and the Audit Log Integrity agent (whether the audit TRAIL is
    // tamper-evident): this answers the patient's §164.524 RIGHT to GET a copy of
    // their own record. REUSES the existing data-plane tier (platform plane). The
    // exception catalog + 30/60-day math are ILLUSTRATIVE, NOT a certified HIM /
    // release-of-information system.
    endpoint: "/api/agents/right-of-access",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The right-of-access layer of the data substrate — given a patient's access request, confirms the PHI is in a designated record set, computes the §164.524 response deadline (30 days, + 30 with the single extension), classifies any cited denial ground (unreviewable / reviewable) against the recorded exception catalog, and decides the disposition (grant-in-full / deny-unreviewable / deny-reviewable-needs-review / not-accessible-outside-record-set). Complements (not duplicates) the Accounting of Disclosures agent (WHO the PHI was disclosed to, §164.528), the Consent agent (whether a patient may be contacted / data used), the Minimum Necessary agent (how much PHI a purpose may see), and the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident) — this answers the patient's §164.524 RIGHT to GET a copy of their own record, and BY WHEN",
      "The determination is DETERMINISTIC — a pure function of the request's own fields (no randomness, no clock — dates taken as data); the deadline is the request date + 30 (or + 60 with the extension), and the same request always yields the same deadline + classification + disposition",
      "Every cited denial ground must trace to the recorded §164.524 exception catalog — an off-catalog ground is not a lawful basis to withhold a patient's own record and is blocked at the Agent Fabric governance boundary (policy.access.ground-sourced); and the response deadline must equal the request date + 30/60 days — a guessed / mis-stated deadline is blocked (policy.access.deadline-computed, the load-bearing correctness gate). Mirrors the Accounting of Disclosures Agent's purpose-category-sourced and the Timely Filing Agent's deadline-computed posture",
      "The agent ADJUDICATES — it NEVER releases the record (a privacy risk) or issues a denial (a legal act with appeal rights) on its own; a determination that auto-releases the record or is not review-gated is blocked (policy.access.no-autonomous-denial-or-release), and every determination is a recommendation requiring a records / privacy officer to fulfill or review. Mirrors the Accounting of Disclosures Agent's no-autonomous-suppression and the Minimum Necessary Agent's no-autonomous-over-disclosure posture",
      "Runs against an ILLUSTRATIVE synthetic exception catalog + 30/60-day math — clearly labeled; NOT a certified release-of-information system (real access is governed by HIPAA §164.524 — the full set of grounds for denial, the reviewable-denial review process, the fee limits, and the designated-record-set definition — the HITECH electronic-copy rules, and the covered entity's Notice of Privacy Practices)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "amendment-request-agent",
    name: "Amendment / Correction (HIPAA §164.526) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // amendment / correction service: POST /api/agents/amendment-request/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude)
    // data-substrate agent that adjudicates a patient's HIPAA §164.526 RIGHT to
    // request an AMENDMENT / CORRECTION of their PHI, and BY WHEN. It CAPSTONES
    // the HIPAA PATIENT-RIGHTS TRILOGY — the third sibling to the Right of Access
    // agent (§164.524 — GET a copy) and the Accounting of Disclosures agent
    // (§164.528 — WHO it was disclosed to); this answers the §164.526 right to
    // FIX the record. Given an amendment request (a patient reference, the record
    // and request type, the request date, an as-of date, whether the PHI is in a
    // designated record set, whether the CE created the PHI and whether the
    // originator is available, whether the PHI is available for access under
    // §164.524, whether the PHI is already accurate and complete, and whether the
    // single 30-day extension was invoked), it DETERMINISTICALLY computes the
    // §164.526 response deadline (request date + 60 days, or + 90 with the
    // extension, via pure UTC date math — dates as data, NO Date.now()), derives
    // which denial ground (if any) applies against the recorded catalog
    // (not-originator, not-in-designated-record-set, not-available-for-access,
    // accurate-and-complete), and decides the disposition (recommend-accept /
    // recommend-deny), NEVER autonomously amending the record (a data write) or
    // issuing a denial (a legal act with statement-of-disagreement rights).
    // REUSES the existing data-plane tier (platform plane). The denial-ground
    // catalog + 60/90-day math are ILLUSTRATIVE, NOT a certified HIM system.
    endpoint: "/api/agents/amendment-request",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The amendment / correction layer of the data substrate — given a patient's §164.526 amendment request, computes the response deadline (60 days, + 30 with the single extension), derives which statutory denial ground (if any) applies against the recorded catalog (not-originator / not-in-designated-record-set / not-available-for-access / accurate-and-complete), and decides the disposition (recommend-accept / recommend-deny with statement-of-disagreement rights). CAPSTONES the HIPAA patient-rights trilogy alongside the Right of Access agent (§164.524 — GET a copy) and the Accounting of Disclosures agent (§164.528 — WHO it was disclosed to) — this answers the §164.526 right to FIX the record, and BY WHEN",
      "The determination is DETERMINISTIC — a pure function of the request's own fields (no randomness, no clock — dates taken as data); the deadline is the request date + 60 (or + 90 with the extension), and the same request always yields the same deadline + ground + disposition",
      "Every denial must trace to the recorded §164.526 ground catalog — an off-catalog ground is not a lawful basis to refuse a patient's amendment and is blocked at the Agent Fabric governance boundary (policy.amendment.ground-sourced); and the response deadline must equal the request date + 60/90 days — a guessed / mis-stated deadline is blocked (policy.amendment.deadline-computed, the load-bearing correctness gate). Mirrors the Right of Access Agent's ground-sourced and deadline-computed posture",
      "The agent ADJUDICATES — it NEVER amends the record (a data write to the medical record that ripples to every downstream holder) or issues a denial (a legal act with statement-of-disagreement rights) on its own; a determination that auto-amends / auto-denies or is not review-gated is blocked (policy.amendment.no-autonomous-write-or-denial), and every determination is a recommendation requiring a records / privacy officer to act on or review. Mirrors the Right of Access Agent's no-autonomous-denial-or-release and the Minimum Necessary Agent's no-autonomous-over-disclosure posture",
      "Runs against an ILLUSTRATIVE synthetic denial-ground catalog + 60/90-day math — clearly labeled; NOT a certified HIM system (real amendment is governed by HIPAA §164.526 — the full denial grounds, the written-denial + statement-of-disagreement + rebuttal process, and the duty to notify other holders of an accepted amendment — and the covered entity's Notice of Privacy Practices)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "information-blocking-agent",
    name: "Information Blocking (Cures Act / 45 CFR Part 171) Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // information-blocking service: POST /api/agents/information-blocking/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude)
    // data-substrate agent that adjudicates whether an actor's PRACTICE that
    // interfered with the access, exchange, or use of electronic health
    // information (EHI) is INFORMATION BLOCKING under the 21st Century Cures Act
    // / 45 CFR Part 171, or fits one of the eight recorded regulatory EXCEPTIONS.
    // It is the ENFORCEMENT FLIP-SIDE of the HIPAA patient-rights trilogy (Right
    // of Access §164.524, Amendment §164.526, Accounting of Disclosures §164.528
    // — the RIGHT to get / fix / audit your record): the information-blocking
    // rule prohibits a provider, health-IT developer, or HIE/HIN from
    // INTERFERING with EHI access. UNLIKE the recent agents there is NO date math
    // and NO dollar waterfall — the heart is a CONDITIONS-SATISFACTION classifier.
    // Given a practice review (an actor reference + type, the EHI request type,
    // whether the practice actually interfered, an optional claimed exception,
    // and the set of exception CONDITIONS the actor asserts are satisfied), it
    // DETERMINISTICALLY checks the claimed exception against the recorded catalog
    // (preventing harm, privacy, security, infeasibility, health IT performance,
    // content & manner, fees, licensing) and verifies EVERY required condition is
    // met, then decides the disposition (not-information-blocking-no-interference
    // / not-information-blocking-exception-met /
    // potential-information-blocking-needs-review), NEVER autonomously withholding
    // EHI (which could itself be information blocking) or force-releasing it
    // (which could breach privacy). It COMPLEMENTS — it does not duplicate — the
    // HIPAA privacy agents: they grant a patient's RIGHTS to their record; this
    // enforces that an actor does not INTERFERE with EHI access. REUSES the
    // existing data-plane tier (platform plane). The exception catalog + condition
    // sets are ILLUSTRATIVE, NOT certified compliance counsel.
    endpoint: "/api/agents/information-blocking",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The information-blocking layer of the data substrate — given a practice review, checks the claimed 45 CFR Part 171 exception against the recorded catalog and verifies every required condition is satisfied, then decides the disposition (not-information-blocking-no-interference / not-information-blocking-exception-met / potential-information-blocking-needs-review). It is the ENFORCEMENT FLIP-SIDE of the HIPAA patient-rights trilogy (Right of Access §164.524, Amendment §164.526, Accounting of Disclosures §164.528 — the RIGHT to get / fix / audit your record): the Cures Act rule prohibits a provider, health-IT developer, or HIE/HIN from INTERFERING with EHI access, exchange, or use unless a recorded exception fully applies",
      "The determination is DETERMINISTIC — a pure function of the request's own fields (no randomness, no clock, and — unlike the recent agents — no date math and no dollar waterfall; it is a conditions-satisfaction classifier); the same practice review always yields the same exception analysis + disposition",
      "Every claimed exception must trace to the recorded 45 CFR Part 171 catalog — an off-catalog exception is not a lawful basis to interfere with EHI and is blocked at the Agent Fabric governance boundary (policy.information-blocking.exception-sourced); and an exception may be reported as MET only when EVERY required condition is satisfied — an overstated exception that skipped a condition is blocked (policy.information-blocking.determination-not-overstated, the load-bearing correctness gate). Mirrors the Right of Access Agent's ground-sourced and the OIG Exclusion Agent's match-not-overstated posture",
      "The agent ADJUDICATES — it NEVER withholds EHI (which could itself be information blocking, or delay urgent care) or force-releases EHI (which could breach privacy) on its own; a determination that auto-blocks / auto-releases EHI or is not review-gated is blocked (policy.information-blocking.no-autonomous-block-or-release), and every determination is a recommendation requiring a compliance officer to confirm and act. Mirrors the OIG Exclusion Agent's no-autonomous-block-or-clear and the Right of Access Agent's no-autonomous-denial-or-release posture",
      "Runs against an ILLUSTRATIVE synthetic exception catalog + condition sets — clearly labeled; NOT certified information-blocking compliance counsel (real analysis is governed by the 21st Century Cures Act and 45 CFR Part 171 — the full text of the eight exceptions and every sub-condition — the ONC / ASTP rules, and OIG enforcement / disincentives)"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "coordination-of-benefits-agent",
    name: "Coordination of Benefits Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side coordination-of-benefits piece:
    // POST /api/agents/coordination-of-benefits/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) agent for a health-plan / TPA —
    // when a patient carries more than one coverage, it ORDERS the coverages
    // (primary → secondary → tertiary) by applying the NAIC-model order-of-
    // benefits rules + Medicare Secondary Payer + the birthday rule, citing the
    // governing COB rule for every ordering decision. It NEVER autonomously
    // adjudicates or pays — an order-of-benefits determination is a RECOMMENDATION
    // that sets payer order and requires human cosign. It is distinct from the
    // Claims Adjudication Assistant (per-claim edits AFTER the payer order is
    // known), the Benefits & Coverage Verification / EBV agent (single-plan
    // eligibility), and the Utilization Review agent (medical necessity) — this
    // decides the ORDER OF BENEFITS ACROSS coverages BEFORE a claim is
    // adjudicated. REUSES the existing payer-operations tier.
    endpoint: "/api/agents/coordination-of-benefits",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Orders a patient's multiple coverages (primary → secondary → tertiary) for a health-plan / TPA, citing the governing COB rule for every ordering decision — companion to the Claims Adjudication (per-claim edits after payer order is known), Benefits & Coverage Verification / EBV (single-plan eligibility), and Utilization Review (medical necessity) agents; this decides the ORDER OF BENEFITS across coverages BEFORE adjudication",
      "Ordering is DETERMINISTIC — a pure function of the coverages + the request's own context (no randomness, no clock); the same coverages always yield the same order + cited rules, applying a documented precedence (custody-decree > Medicaid-payer-of-last-resort > Medicare-secondary-payer > subscriber-before-dependent > active-before-inactive > birthday-rule > longer-coverage tie-break)",
      "A custody / court decree ALWAYS overrides the birthday rule — when an active decree names a dependent child's primary coverage, that plan is primary; a determination that ignores the decree is blocked at the Agent Fabric governance boundary (policy.cob.custody-decree-overrides-birthday). Mirrors the Data Retention Agent's legal-hold-overrides-purge — a legal instrument overrides the default rule",
      "Every ordering decision must cite a recorded COB rule from the rule catalog — an ad-hoc / un-sourced ordering is blocked (policy.cob.order-of-benefits-rule-sourced); and the agent NEVER autonomously adjudicates or pays — an order-of-benefits determination is a RECOMMENDATION requiring human cosign (requiresHumanCosign:true), and any autonomous adjudication is blocked (policy.cob.no-autonomous-adjudication). Mirrors the Claims Adjudication Agent's no-autonomous-denial posture",
      "Runs against ILLUSTRATIVE synthetic COB rule catalog + plan types + payer labels — clearly labeled; NOT a certified coordination-of-benefits engine (real COB is governed by the NAIC COB Model Regulation, Medicare Secondary Payer 42 CFR 411, Medicaid third-party liability 42 CFR 433.139, ERISA plan documents, and state insurance code)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "overpayment-recovery-agent",
    name: "Claims Overpayment & Recovery Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side post-payment integrity piece:
    // POST /api/agents/overpayment-recovery/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) agent for a health-plan / TPA —
    // given a PAID claim (paid vs correct amount, recovery reason, paid date), it
    // computes the overpayment, cites the governing recovery reason, derives the
    // recovery deadline from the reason's statutory lookback window, and classifies
    // the claim as recoverable / not-recoverable-within-window / no-overpayment. It
    // NEVER autonomously claws back or offsets a payment — a recoverable overpayment
    // is a RECOMMENDATION requiring human review with member/provider notice, and a
    // claim past its lookback window is NEVER recoverable. It is distinct from the
    // Claims Adjudication Assistant (first-pass PRE-payment adjudication), the FWA
    // Detection agent (suspected fraud patterns), and the Coordination of Benefits
    // agent (which decides payer ORDER) — this is POST-payment recovery of a
    // legitimate overpayment already made. REUSES the existing payer-operations tier.
    endpoint: "/api/agents/overpayment-recovery",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Evaluates a PAID claim for a health-plan / TPA — computes the overpayment (paid − correct), cites the governing recovery reason, derives the recovery deadline from the reason's statutory lookback, and classifies as recoverable / not-recoverable-within-window / no-overpayment. Companion to the Claims Adjudication (pre-payment), FWA Detection (suspected fraud), and Coordination of Benefits (payer order) agents — this is POST-payment recovery",
      "Evaluation is DETERMINISTIC — a pure function of the claim's amounts + dates + the request's own asOfDate (no randomness, no clock); the recovery deadline is derived from the paid date + the reason's lookback window, and the same claim always yields the same overpayment + cited reason + recoverability",
      "A recovery must be WITHIN the statutory lookback window — an overpayment past its window (paid date + lookback days) is NEVER recoverable; a clawback asserted past the window is blocked at the Agent Fabric governance boundary (policy.recovery.within-lookback-window), because recouping beyond the statutory lookback is an unlawful recoupment. Mirrors the Data Retention Agent's legal-hold-overrides-purge — a window bounds the action",
      "Every recovery must cite a recorded recovery reason — an ad-hoc / un-sourced clawback is blocked (policy.recovery.reason-catalog-sourced); and a clawback is never executed autonomously — a recoverable overpayment is a RECOMMENDATION requiring human review with member/provider notice, and an autonomous / unreviewed clawback is blocked (policy.recovery.no-autonomous-clawback). Mirrors the FWA Agent's no-autonomous-denial and the Data Retention Agent's no-autonomous-purge posture",
      "Runs against ILLUSTRATIVE synthetic recovery reason catalog + lookback windows + reason ids — clearly labeled; NOT a certified payment-integrity system (real overpayment recovery is governed by the ACA §6402 60-day rule, CMS recovery rules, ERISA, and state insurance code)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "financial-assistance-agent",
    name: "Patient Financial Assistance & Charity Care Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the patient-access / charity-care piece:
    // POST /api/agents/financial-assistance/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) agent for a provider's patient
    // financial experience — given a household size + annual income (+ the FPL year,
    // an optional presumptive-eligibility signal, whether the FAP application is
    // complete, and whether an extraordinary collection action is being requested), it
    // computes the household's income as a percentage of the Federal Poverty Level,
    // cites the governing FAP tier from a schedule, and classifies the patient as
    // full-charity / partial-charity / not-eligible under an IRS 501(r) Financial
    // Assistance Policy. It NEVER autonomously DENIES assistance (a not-eligible
    // determination is a RECOMMENDATION requiring human review with written notice +
    // appeal rights) and NEVER lets an extraordinary collection action proceed before
    // financial screening is complete (501(r)(6)). It COMPLEMENTS, not duplicates, the
    // Benefits & Coverage Verification / EBV agent (which verifies plan eligibility +
    // estimates the covered visit cost): this screens the patient-responsibility
    // remainder for CHARITY CARE. REUSES the existing benefits-verification tier.
    endpoint: "/api/agents/financial-assistance",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens a self-pay / underinsured patient for hospital financial assistance (charity care) under an IRS 501(r) FAP — computes the household's income as a percentage of the Federal Poverty Level, cites the governing FAP tier, and classifies as full-charity / partial-charity / not-eligible with a discount percentage. A sibling to the Benefits & Coverage Verification / EBV agent on the patient-access tier: EBV verifies what the plan covers; this screens the patient-responsibility remainder for charity care",
      "Screening is DETERMINISTIC — a pure function of the household size + income + FPL year + the request's own flags (no randomness, no clock); the FPL percentage is derived from the household size's FPL base, and the same household always yields the same tier + discount + eligibility",
      "An extraordinary collection action (ECA — collections, credit reporting, a lien) may NEVER proceed before financial-assistance screening is complete — an ECA asserted before screening is blocked at the Agent Fabric governance boundary (policy.finassist.no-eca-before-screening), because IRS 501(r)(6) requires reasonable efforts to determine FAP eligibility before any ECA. Mirrors the Data Retention Agent's legal-hold-overrides-purge — a legal precondition bounds the action",
      "Every determination must cite a recorded FAP tier or a presumptive-eligibility reason — an ad-hoc / un-sourced eligibility decision is blocked (policy.finassist.fap-schedule-sourced); and a denial of charity care is never autonomous — a not-eligible determination is a RECOMMENDATION requiring human review with written notice + appeal rights (501(r)(4)), and an autonomous denial is blocked (policy.finassist.no-autonomous-denial). Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced + no-autonomous-clawback posture",
      "Runs against ILLUSTRATIVE synthetic FAP tier schedule + discount percentages + FPL table + presumptive-eligibility reasons — clearly labeled; NOT a certified financial-assistance system (real hospital FAPs are governed by IRS 501(r) / 26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and each hospital's Board-approved FAP + state charity-care law)"
    ],
    provider: "Salesforce",
    governanceTier: "benefits-verification"
  },
  {
    id: "lab-result-agent",
    name: "Lab Result & Critical-Value Notification Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical result-management piece:
    // POST /api/agents/lab-result/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) clinical-decision agent, a sibling to the live-Claude
    // Care Router — given a discrete lab result (analyte id + numeric value + unit), it
    // classifies the value against the analyte's reference range + critical thresholds
    // as normal / abnormal-high / abnormal-low / critical-high / critical-low, flags
    // whether the result requires mandatory clinician notification (a CRITICAL / panic
    // value), and flags whether it requires clinician review. It NEVER autonomously acts
    // on a result (no order, prescription, treatment, or care-plan change — an abnormal /
    // critical result is escalated to a clinician), and a CRITICAL value can NEVER be
    // suppressed or auto-closed (CLIA §493.1291). It is distinct from the Remote Patient
    // Monitoring agent (continuous wearable / RPM streams), the Clinical Summary agent
    // (chart summarization), and the Care Gap Closure agent (missing preventive
    // measures) — this manages DISCRETE diagnostic LAB results + critical-value
    // notification. REUSES the existing clinical-decision tier.
    endpoint: "/api/agents/lab-result",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Classifies a discrete diagnostic lab result for a clinician — computes normal / abnormal-high / abnormal-low / critical-high / critical-low against the analyte's reference range + critical thresholds, flags mandatory clinician notification for a critical (panic) value, and flags clinician review for any abnormal result. A deterministic clinical-decision sibling to the Care Router; distinct from Remote Patient Monitoring (RPM streams), Clinical Summary (chart summarization), and Care Gap Closure (preventive measures)",
      "Classification is DETERMINISTIC — a pure function of the value + the analyte's catalog range (no randomness, no clock); critical thresholds take precedence over the reference range, so the same result always yields the same classification + notification + review flags",
      "A CRITICAL (panic) value must trigger mandatory clinician notification — it can NEVER be suppressed or auto-closed; a critical result asserted as not requiring notification is blocked at the Agent Fabric governance boundary (policy.lab.critical-value-notified), because CLIA §493.1291(g) requires the laboratory to immediately alert the responsible provider. Mirrors the Care Coordination Handoff Agent's SBAR-completeness — a life-safety obligation that cannot be skipped",
      "Every classification must cite a recorded analyte reference range — an ad-hoc / un-sourced result interpretation is blocked (policy.lab.reference-range-sourced); and the agent never autonomously acts on a result — an abnormal / critical result is a flag escalated for clinician review (requiresClinicianReview:true), and an autonomous action on a non-normal result is blocked (policy.lab.no-autonomous-clinical-action). Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Utilization Review Agent's no-autonomous-denial posture",
      "Runs against an ILLUSTRATIVE synthetic analyte catalog + reference ranges + units + critical thresholds — clearly labeled; NOT a certified laboratory information system or CLIA-validated critical-value policy (real ranges are method-/instrument-/population-specific and set by the laboratory's medical director under CLIA / 42 CFR 493)"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "good-faith-estimate-agent",
    name: "Good Faith Estimate (No Surprises Act) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the patient-access GFE piece:
    // POST /api/agents/good-faith-estimate/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) patient-access agent, a sibling to the Benefits &
    // Coverage Verification (EBV) and Patient Financial Assistance & Charity Care agents
    // on the patient-access (benefits-verification) tier. Given a scheduled primary
    // service + the expected line items (each a charge-master service id + quantity), it
    // prices each line item from the charge master, verifies every reasonably-expected
    // co-item for the primary service is included, sums the total, and returns a Good
    // Faith Estimate that is an ESTIMATE (never a binding bill) requiring patient
    // confirmation, with the NSA $400 dispute threshold recorded. It COMPLEMENTS — it
    // does not duplicate — the EBV agent (plan eligibility + estimated COVERED cost) and
    // the Financial Assistance agent (charity screening on the patient-responsibility
    // remainder): this assembles the itemized SELF-PAY / uninsured estimate required
    // BEFORE care under the No Surprises Act. REUSES the existing benefits-verification
    // (patient-access) tier.
    endpoint: "/api/agents/good-faith-estimate",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Assembles an itemized Good Faith Estimate of expected charges for a self-pay / uninsured patient BEFORE care — prices each expected line item from the charge master, verifies every reasonably-expected co-item for the primary service is included, sums the total, and returns an ESTIMATE (never a binding bill) with the No Surprises Act $400 dispute threshold recorded. A deterministic patient-access sibling to the Benefits & Coverage Verification (EBV) and Patient Financial Assistance & Charity Care agents; the third leg of the patient-access triad (plan eligibility → itemized self-pay estimate → charity screening)",
      "The estimate is DETERMINISTIC — a pure function of the request's line items + the charge master (no randomness, no clock); the same request always yields the same total + completeness + sourcing flags",
      "Every priced line item must be charge-master-sourced — an off-catalog service id or an amount that doesn't match the charge master is blocked at the Agent Fabric governance boundary (policy.gfe.charge-master-sourced); and the estimate must be COMPLETE — an estimate missing the primary service or a reasonably-expected co-item is blocked (policy.gfe.expected-items-complete), because the No Surprises Act (45 CFR 149.610) requires the convening provider to include items/services reasonably expected to be furnished, and an incomplete estimate understates the total and misleads the patient. Mirrors the Care Coordination Handoff Agent's SBAR-completeness and the Lab Result Agent's critical-value-notified posture",
      "A GFE is an ESTIMATE requiring patient confirmation, NEVER a binding / final bill — a determination presented as a binding bill is blocked (policy.gfe.estimate-not-binding), and if the actual bill exceeds the GFE by $400 or more the patient has NSA dispute rights. Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Financial Assistance Agent's no-autonomous-denial posture — the agent recommends, a human confirms",
      "Runs against an ILLUSTRATIVE synthetic charge master + categories + amounts + expected-co-item rules — clearly labeled; NOT a certified hospital chargemaster, machine-readable price-transparency file, or a real provider's charges (a real GFE is governed by the No Surprises Act / 45 CFR 149.610, the provider's actual charges, and HHS guidance)"
    ],
    provider: "Salesforce",
    governanceTier: "benefits-verification"
  },
  {
    id: "balance-billing-agent",
    name: "Balance Billing Protection (No Surprises Act) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side NSA balance-billing piece:
    // POST /api/agents/balance-billing/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) payer & plan operations agent. Given a claim (its
    // protection basis — the service setting / provider network status — plus the service
    // type, whether it is ancillary, the billed charge, the in-network allowed / QPA, and
    // whether a valid notice-and-consent waiver was obtained), it decides whether the No
    // Surprises Act PROHIBITS balance billing, computes the patient's cost-share BASIS
    // (in-network QPA for a protected claim, never the billed charge), and computes the
    // balance-bill amount (0 + prohibited for a protected claim). It is distinct from the
    // Claims Adjudication (per-claim edits), Coordination of Benefits (payer order),
    // Overpayment & Recovery (post-payment clawback), Utilization Review (medical
    // necessity), and FWA (fraud) agents; and it is the CLAIM-time complement to the
    // patient-access Good Faith Estimate agent (the two sides of the No Surprises Act).
    // REUSES the existing payer-operations tier.
    endpoint: "/api/agents/balance-billing",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Decides whether the No Surprises Act prohibits balance-billing an out-of-network claim — resolves the protection basis (emergency, out-of-network at an in-network facility, air ambulance, ground ambulance, in-network), applies any effective notice-and-consent waiver (valid only for a waivable, non-ancillary service), computes the patient's cost-share BASIS (in-network QPA for a protected claim), and computes the balance-bill amount (0 + prohibited for a protected claim). A deterministic payer-plane agent; the claim-time complement to the Good Faith Estimate agent",
      "The determination is DETERMINISTIC — a pure function of the request + the basis catalog (no randomness, no clock); the same claim always yields the same protection + cost-share basis + balance-bill flags",
      "Every determination must cite a recorded protection basis — an ad-hoc / un-sourced protection call is blocked at the Agent Fabric governance boundary (policy.balancebill.protection-basis-sourced); and for a PROTECTED claim the patient's cost-share must be computed on the in-network (QPA) basis, never the out-of-network billed charge — a protected patient's cost-share based on the billed charge over-charges them and is blocked (policy.balancebill.cost-share-in-network-basis, 45 CFR 149.110–149.130). Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced + within-lookback-window posture",
      "A PROTECTED claim can NEVER be balance-billed — the difference between the billed charge and the allowed amount may not be billed to the patient, and a balance bill allowed on a protected claim is blocked (policy.balancebill.no-autonomous-balance-bill); a permitted balance bill on a NON-protected claim (a valid waiver, ground ambulance) requires human review. Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback and the Lab Result Agent's no-autonomous-clinical-action posture",
      "Runs against ILLUSTRATIVE synthetic protection bases + waiver rules + ancillary handling + QPA amounts — clearly labeled; NOT a certified No Surprises Act engine (a real determination uses the actual Qualifying Payment Amount, the federal IDR process, the notice-and-consent requirements, and the provider's network contracts under 45 CFR 149)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "immunization-agent",
    name: "Immunization Forecasting (ACIP) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical-decision immunization-forecasting
    // piece: POST /api/agents/immunization/tasks (card at /.well-known/
    // agent.json). A DETERMINISTIC (no-Claude) clinical-decision agent. Given a
    // patient (a synthetic reference, a birth date, an immunization history, and
    // any recorded contraindications) evaluated against a provided asOfDate, it
    // computes the patient's age and forecasts each vaccine (up-to-date / due /
    // overdue / contraindicated / not-indicated) against an ACIP-style schedule
    // (influenza, Tdap booster, zoster/RZV at 50+, pneumococcal at 65+, COVID-19),
    // citing the governing schedule rule + the next-due date. A contraindicated
    // vaccine is NEVER recommended; a due / overdue vaccine is a RECOMMENDATION
    // requiring a clinician order — never autonomously administered. It COMPLEMENTS
    // the other clinical / care agents — distinct from the Care Gap Closure agent
    // (broad missing preventive measures), the Lab Result agent (discrete
    // diagnostic results), the Care Plan agent (the longitudinal plan), and the
    // Care Router (triage): this forecasts the specific vaccine schedule. REUSES the
    // existing clinical-decision tier.
    endpoint: "/api/agents/immunization",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Forecasts a patient's vaccines against an ACIP-style schedule (up-to-date / due / overdue / contraindicated / not-indicated) — computes age from the birth date + asOfDate, then per schedule rule (influenza, Tdap booster, zoster/RZV at 50+, pneumococcal at 65+, COVID-19) applies age-eligibility, dose-series / booster-interval logic, and recorded contraindications, citing the governing schedule rule + the next-due date. A deterministic clinical-decision agent; distinct from the Care Gap Closure, Lab Result, Care Plan, and Care Router agents",
      "The forecast is DETERMINISTIC — a pure function of the request + its own asOfDate + the schedule catalog (no randomness, no clock); the same patient always yields the same forecast + cited rules + next-due dates",
      "Every forecast entry must cite a recorded ACIP schedule rule — an ad-hoc / un-sourced recommendation is blocked at the Agent Fabric governance boundary (policy.immunization.schedule-sourced); and a vaccine the patient is contraindicated for is NEVER recommended — it is withheld and flagged, and a recommended contraindicated vaccine is blocked (policy.immunization.contraindication-honored, the load-bearing safety gate). Mirrors the Lab Result Agent's reference-range-sourced + critical-value-notified posture",
      "A due / overdue vaccine is a RECOMMENDATION requiring a clinician order — the agent never administers, orders, or records a vaccine autonomously; a determination with due / overdue vaccines that does not require a clinician order is blocked (policy.immunization.no-autonomous-administration). Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Balance Billing Agent's no-autonomous-balance-bill posture",
      "Runs against an ILLUSTRATIVE synthetic ACIP-style schedule + age-eligibility + dose intervals — clearly labeled; NOT a certified immunization forecaster (a real forecast uses the current ACIP recommendations, the CDC immunization schedules, and the patient's full clinical context)"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "timely-filing-agent",
    name: "Timely Filing Compliance Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side timely-filing piece: POST
    // /api/agents/timely-filing/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent for a health-plan
    // / TPA / provider billing office — given a claim (a date of service, a
    // submission date, and the cited payer filing-limit rule), it DETERMINISTICALLY
    // computes the filing DEADLINE (date of service + the rule's limit in days),
    // compares the submission date to it, computes how many days late an untimely
    // claim is, honors a recognized filing-limit EXCEPTION when one is claimed, and
    // decides the disposition (accept / appeal-with-exception / write-off-review).
    // It NEVER autonomously writes off the balance — an untimely claim is a
    // RECOMMENDATION requiring human review. It COMPLEMENTS the other
    // payer-operations agents — distinct from the Claims Adjudication Assistant
    // (per-claim edits / medical-necessity adjudication), the Coordination of
    // Benefits agent (payer ORDER across coverages), the Claims Overpayment &
    // Recovery agent (POST-payment clawback), the FWA Detection agent (suspected
    // fraud), and the Utilization Review agent (medical necessity): this decides one
    // narrow, purely temporal question — was the claim FILED IN TIME. REUSES the
    // existing payer-operations tier.
    endpoint: "/api/agents/timely-filing",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Decides whether a claim was filed within its payer's timely-filing limit for a health-plan / TPA / billing office — computes the deadline (date of service + the rule's limit days), compares the submission date, computes how many days late an untimely claim is, honors a recognized exception when claimed, and decides the disposition (accept / appeal-with-exception / write-off-review). Companion to the Claims Adjudication (per-claim edits), Coordination of Benefits (payer order), Overpayment Recovery (post-payment clawback), FWA Detection (fraud), and Utilization Review (medical necessity) agents — this decides one narrow, purely temporal question: was the claim FILED IN TIME",
      "The decision is DETERMINISTIC — a pure function of the claim's dates + the cited rule (no randomness, no clock); the deadline is computed from the date of service + the rule's limit days, and the same claim always yields the same deadline + timely flag + disposition",
      "Every timeliness decision must cite a recorded filing-limit rule — an ad-hoc / un-sourced limit is blocked at the Agent Fabric governance boundary (policy.timelyfiling.filing-limit-sourced); and the deadline must equal the computed date of service + limit — a guessed / hidden deadline is blocked (policy.timelyfiling.deadline-computed, the load-bearing correctness gate). Mirrors the Overpayment Recovery Agent's reason-catalog-sourced and the Good Faith Estimate Agent's math-consistent posture",
      "An untimely claim is a RECOMMENDATION (appeal with an exception, or a write-off decision) requiring human review — the agent NEVER autonomously writes off the balance or bills the patient; a determination that marks a claim written-off, or reports an untimely claim without requiring review, is blocked (policy.timelyfiling.no-autonomous-write-off). Mirrors the Overpayment Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture",
      "Runs against ILLUSTRATIVE synthetic filing-limit rules + day windows + exception catalog — clearly labeled; NOT a certified timely-filing engine (real limits are governed by each payer's provider contract, Medicare — generally 12 months / 42 CFR 424.44 — state Medicaid rules, and state prompt-pay law)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "claim-lifecycle-agent",
    name: "Claim Lifecycle / Status-Transition Guard Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side claim-status-lifecycle piece:
    // POST /api/agents/claim-lifecycle/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) claims / payer-operations agent that takes a
    // claim's CURRENT status plus a REQUESTED next status and, against a
    // claim-status STATE MACHINE, decides whether the transition is a LEGAL
    // single step, whether the requested status is REACHABLE at all (and by what
    // shortest path), or whether it can NEVER follow the current status. UNLIKE
    // the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule
    // Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's
    // GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the
    // Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's
    // TOPOLOGICAL ORDERING (which orders a DAG's nodes), the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's
    // SEQUENTIAL dollar waterfall, the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP,
    // the OIG Exclusion agent's EXACT identity MATCHING, or the Audit Log
    // Integrity agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely
    // Filing, Right of Access, Amendment) that add N days to a single date — the
    // heart of this service is FINITE-STATE-MACHINE TRANSITION VALIDATION: a
    // transition-table lookup plus a BREADTH-FIRST SEARCH over the state graph
    // for reachability + the shortest legal path. It COMPLEMENTS the other claim
    // agents — distinct from the Claims Adjudication Assistant (per-claim edits),
    // the Coordination of Benefits agent (payer ORDER), the Overpayment Recovery
    // agent (POST-payment clawback), the Timely Filing agent (was it FILED IN
    // TIME), and the Subrogation agent (third-party liability): this validates one
    // narrow, purely STRUCTURAL question — is this STATUS TRANSITION legal, and if
    // not, is the target even reachable. A finding is a RECOMMENDATION requiring
    // an adjuster to confirm; the agent never autonomously ADVANCES, PAYS, or
    // FINALIZES a claim. It is PHI-bearing (the claim references a patient).
    // REUSES the existing payer-operations tier. The state machine is
    // ILLUSTRATIVE, NOT a certified claims-processing system.
    endpoint: "/api/agents/claim-lifecycle",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a claim's current status plus a requested next status and, against a claim-status state machine, decides whether the transition is a legal single step (transition-allowed), whether the requested status is reachable at all and by what shortest path (transition-illegal-but-reachable), or whether it can never follow the current status (transition-unreachable). A deterministic payer-operations agent; it COMPLEMENTS the Claims Adjudication Assistant (per-claim edits), the Coordination of Benefits (payer order), the Overpayment Recovery (post-payment clawback), the Timely Filing (was it filed in time), and the Subrogation (third-party liability) agents — this validates one narrow, purely STRUCTURAL question: is this STATUS TRANSITION legal, and if not, is the target even reachable",
      "The finding is DETERMINISTIC — a pure function of the request's own statuses + state machine (no randomness, no clock; not an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, a dollar waterfall, a pairwise KB lookup, an exact identity match, or a hash chain but FINITE-STATE-MACHINE TRANSITION VALIDATION — a transition-table lookup plus a breadth-first search over the state graph for reachability + the shortest legal path); the same input always yields the same finding",
      "Every status named in the finding — in the allowed-next set and in the shortest path — must be a defined state of the state machine, and every shortest-path step must be a real transition; a fabricated lifecycle state or an invented legal move is blocked at the Agent Fabric governance boundary (policy.claim.states-sourced, the sourced gate); and the transition logic must be exact — recomputing the transition table + BFS must reproduce the reported direct-edge flag, reachability flag, allowed-next set, shortest-path length + endpoints, and disposition; a wrong direct-edge flag (which would wave through an illegal transition that skips adjudication), a wrong reachability / path, or a bad disposition is blocked (policy.claim.transition-consistent, the load-bearing correctness gate). Mirrors the Care Pathway Agent's steps-sourced + sequence-valid posture",
      "The agent VALIDATES — it NEVER advances the claim to the next status, posts a payment, or finalizes a denial (each is a payer action that must be authorized) on its own; a finding that auto-advances or is not review-gated is blocked (policy.claim.no-autonomous-advance), and every finding is a recommendation requiring an adjuster to confirm the transition. Mirrors the Timely Filing Agent's no-autonomous-write-off and the Overpayment Recovery Agent's no-autonomous-clawback posture",
      "Runs against an ILLUSTRATIVE synthetic claim-status state machine — clearly labeled; NOT a certified claims-processing system (real claim-status management uses the X12 277 claim-status category / status codes, the payer's adjudication system, and the plan's business rules). PHI-bearing — the claim references a patient"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "subrogation-agent",
    name: "Subrogation / Third-Party Liability Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side subrogation / TPL piece: POST
    // /api/agents/subrogation/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent for a health-plan
    // / TPA. When a plan pays claims for an injury caused by a LIABLE THIRD PARTY
    // (an auto accident, a slip-and-fall, a defective product, a work injury), the
    // plan generally has a subrogation / reimbursement RIGHT to recover its payments
    // out of the third party's settlement. Given a subrogation case (whether the
    // claim is injury-related, the accident type, whether a liable third party is
    // identified, what the plan PAID, the cited subrogation basis, the settlement
    // amount if known, and whether the made-whole / common-fund doctrines apply), it
    // DETERMINISTICALLY decides eligibility, computes a BOUNDED recoverable amount
    // (never more than the plan paid, never more than the settlement, barred by the
    // made-whole doctrine, reduced by the common-fund attorney-fee share), and
    // decides the disposition — NEVER autonomously asserting a lien or reducing the
    // member's recovery. It COMPLEMENTS the other payer-operations agents — distinct
    // from the Claims Adjudication Assistant (per-claim edits / medical necessity),
    // the Coordination of Benefits agent (the ORDER of coverages that both cover the
    // member), the Claims Overpayment & Recovery agent (POST-payment clawback of the
    // plan's OWN overpayment), the Timely Filing agent (was the claim filed in time),
    // and the FWA agent (suspected fraud): this recovers the plan's injury-claim
    // payments from a LIABLE THIRD PARTY's settlement. REUSES the existing
    // payer-operations tier.
    endpoint: "/api/agents/subrogation",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Decides whether a plan has a subrogation / third-party-liability interest in a liable third party's settlement for injury claims it paid — decides eligibility (injury-related AND a liable third party AND a real accident AND a recovery-allowing basis), computes a BOUNDED recoverable amount (capped at the plan's paid amount, capped again at the settlement, barred by the made-whole doctrine, reduced by the common-fund attorney-fee share), and decides the disposition (no-subrogation-interest / notify-made-whole-bar / assert-lien-with-review). Companion to the Claims Adjudication (per-claim edits), Coordination of Benefits (payer order), Overpayment Recovery (post-payment clawback of the plan's OWN overpayment), Timely Filing (was the claim filed in time), and FWA Detection (fraud) agents — this recovers the plan's injury-claim payments from a LIABLE THIRD PARTY's settlement",
      "The determination is DETERMINISTIC — a pure function of the case's own fields (no randomness, no clock); the recoverable is computed and bounded from the plan's paid amount, the settlement, and the doctrine reductions, and the same case always yields the same eligibility + recoverable + disposition",
      "Every recovery decision must cite a recorded subrogation basis — an ad-hoc / un-sourced basis is blocked at the Agent Fabric governance boundary (policy.subrogation.basis-sourced); and the recoverable must never exceed the plan's paid amount or the settlement — a lien asserted as PROFIT rather than reimbursement is blocked (policy.subrogation.recoverable-within-paid, the load-bearing correctness gate). Mirrors the Overpayment Recovery Agent's reason-catalog-sourced and the Good Faith Estimate Agent's math-consistent posture",
      "A subrogation interest is a RECOMMENDATION requiring a subrogation specialist / plan counsel to review — the agent NEVER autonomously asserts or perfects a lien, reduces the member's settlement, or recovers funds; a determination that auto-asserts a lien, or finds an interest without requiring review, is blocked (policy.subrogation.no-autonomous-lien). Mirrors the Overpayment Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture",
      "Runs against ILLUSTRATIVE synthetic subrogation bases + made-whole / common-fund reductions — clearly labeled; NOT a certified subrogation engine (real subrogation is governed by the plan document — for a self-funded ERISA plan, 29 U.S.C. §1132(a)(3) and cases such as US Airways v. McCutchen and Montanile — state subrogation / made-whole / common-fund law, and state workers-compensation statutes)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "member-cost-share-agent",
    name: "Member Cost-Share / EOB Calculation Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side member cost-share / EOB piece: POST
    // /api/agents/member-cost-share/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent that splits an
    // adjudicated in-network claim's ALLOWED AMOUNT into the member's cost-share
    // (deductible + coinsurance) and the plan-paid portion, running the classic
    // deductible → coinsurance → out-of-pocket-maximum WATERFALL against the
    // member's plan benefit design + current accumulators — producing the EOB
    // cost-share BREAKDOWN a claims system / human finalizes, NEVER autonomously
    // posting a charge to the member. It COMPLEMENTS the other payer-operations
    // agents — distinct from the Claims Adjudication agent (WHAT the allowed
    // amount is — it produces the allowed amount this agent consumes), the
    // Coordination of Benefits agent (the ORDER of coverages), the Subrogation
    // agent (recovery from a liable third party), the Good Faith Estimate agent
    // (the pre-service uninsured / self-pay estimate), and the Balance Billing
    // agent (surprise-bill protection): this splits the ALREADY-adjudicated
    // allowed amount into member vs. plan responsibility using the benefit design
    // + accumulators. REUSES the existing payer-operations tier. The plan catalog
    // + waterfall are ILLUSTRATIVE, NOT a certified claims / adjudication system.
    endpoint: "/api/agents/member-cost-share",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Splits an adjudicated in-network claim's allowed amount into the member's cost-share (deductible + coinsurance) and the plan-paid portion — runs the deductible → coinsurance → out-of-pocket-maximum waterfall against the member's plan benefit design + current accumulators (deductible-met, OOP-met), capping the member at the remaining OOP maximum. Companion to the Claims Adjudication (produces the allowed amount), Coordination of Benefits (payer order), Subrogation (third-party recovery), Good Faith Estimate (pre-service uninsured estimate), and Balance Billing (surprise-bill protection) agents — this splits the ALREADY-adjudicated allowed amount into member vs. plan responsibility",
      "The split is DETERMINISTIC — a pure function of the claim's own fields + the plan (no randomness, no clock); the deductible is applied first, the remainder is split by the coinsurance rate, and the member's total is capped at the remaining OOP maximum, so the same claim always yields the same member / plan split",
      "The benefit design must trace to the recorded plan catalog — an off-catalog plan can't be correctly cost-shared and is blocked at the Agent Fabric governance boundary (policy.costshare.benefit-design-sourced); and the split must add up and stay bounded — the member + plan must equal the allowed amount, the member share must be non-negative and within the allowed / remaining OOP maximum, and a split that doesn't add up is blocked (policy.costshare.math-consistent, the load-bearing correctness gate). Mirrors the Good Faith Estimate Agent's charge-master-sourced + math-consistent and the Subrogation Agent's recoverable-within-paid posture",
      "The EOB cost-share is an ESTIMATE / BREAKDOWN — the agent NEVER posts a charge, an invoice, or a balance to the member; a determination that posts a member charge, or that is not review-gated, is blocked (policy.costshare.no-autonomous-member-charge), and every breakdown is finalized by the claims system / a human. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability posture",
      "Runs against an ILLUSTRATIVE synthetic plan catalog + deductible / coinsurance / OOP-max waterfall (no copays, tiering, family accumulators, or out-of-network penalties) — clearly labeled; NOT a certified claims / adjudication system (real cost-share is governed by the member's certificate of coverage / SBC, the payer's adjudication system, and applicable state / federal law)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "mlr-rebate-agent",
    name: "Medical Loss Ratio (MLR) Rebate Calculation Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side ACA Medical Loss Ratio piece: POST
    // /api/agents/mlr-rebate/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent that computes a
    // plan's Medical Loss Ratio for a market, decides whether it meets the ACA
    // standard (80% individual / small-group, 85% large-group; 45 CFR Part 158),
    // and — when it falls short — APPORTIONS the total rebate owed across the
    // plan's subscribers penny-exactly (largest-remainder / Hamilton method).
    // UNLIKE the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG
    // Exclusion agent's identity MATCHING, or the Drug Interaction agent's
    // pairwise LOOKUP, the heart of this service is a RATIO-vs-THRESHOLD test + an
    // EXACT PROPORTIONAL APPORTIONMENT (the allocated cents sum EXACTLY to the
    // total — no penny lost or invented). A determination is a RECOMMENDATION
    // requiring a treasury / compliance reviewer to confirm and issue payment —
    // the agent never autonomously DISBURSES a rebate. It COMPLEMENTS the other
    // payer-operations agents — distinct from the Claims Adjudication agent (the
    // allowed amount), the Member Cost-Share agent (splitting ONE claim's allowed
    // amount into member vs. plan), the Coordination of Benefits agent (the order
    // of coverages), the Overpayment & Recovery agent (clawing back an
    // overpayment), and the Subrogation agent (third-party recovery): this
    // computes a PLAN-YEAR-level rebate owed to subscribers under the ACA MLR
    // rule and apportions it fairly. It is NOT PHI-bearing — it works on
    // aggregate plan-year financials + a subscriber premium roster, no patient
    // health information, so it is NOT on the HIPAA-audit policy. REUSES the
    // existing payer-operations tier. The market standards + simplified MLR
    // formula are ILLUSTRATIVE, NOT a certified MLR filing system.
    endpoint: "/api/agents/mlr-rebate",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Computes a plan's Medical Loss Ratio for a market, decides whether it meets the ACA standard (80% individual / small-group, 85% large-group), and — when it falls short — apportions the total rebate owed across the plan's subscribers penny-exactly (largest-remainder method). A deterministic payer-operations agent; distinct from the Claims Adjudication agent (the allowed amount), the Member Cost-Share agent (splitting one claim), the Coordination of Benefits, Overpayment & Recovery, and Subrogation agents — this computes a PLAN-YEAR rebate owed to subscribers under the ACA MLR rule (45 CFR Part 158)",
      "The determination is DETERMINISTIC — a pure function of the request's data + the market standard (no randomness, no clock; not a sequential waterfall or an identity match but a RATIO-vs-THRESHOLD test + an EXACT PROPORTIONAL APPORTIONMENT); the same plan year always yields the same MLR + rebate + apportionment",
      "The applied standard must trace to the recorded market catalog — an off-catalog market or a mis-stated standard (wrongly triggering or avoiding a rebate) is blocked at the Agent Fabric governance boundary (policy.mlr.inputs-sourced); and the MLR must equal (claims + quality improvement) / (earned premium − taxes & fees), the total rebate must equal max(0, standard − MLR) × earned premium, and the per-subscriber allocations must sum EXACTLY to the total rebate — a rebate that doesn't add up or an apportionment that loses / invents pennies is blocked (policy.mlr.allocation-consistent, the load-bearing correctness gate). Mirrors the Member Cost-Share Agent's benefit-design-sourced + math-consistent posture",
      "The rebate is a RECOMMENDATION — the agent NEVER disburses / pays a rebate on its own (a movement of money to members that must be authorized); a determination that auto-disburses, or is not review-gated, is blocked (policy.mlr.no-autonomous-disbursement), and every determination is confirmed + issued by a treasury / compliance reviewer. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the OIG Exclusion Agent's no-autonomous-block-or-clear posture",
      "Runs against an ILLUSTRATIVE synthetic set of ACA MLR standards + a simplified MLR formula (no NAIC MLR Annual Reporting Form, credibility adjustments, multi-year averaging, or permitted claim / premium adjustments) — clearly labeled; NOT a certified MLR filing system (real MLR reporting is governed by 45 CFR Part 158). NON-PHI — aggregate financials + a subscriber premium roster, no patient health information"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "enrollment-reconciliation-agent",
    name: "Eligibility & Enrollment (834) Reconciliation Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side enrollment-reconciliation piece:
    // POST /api/agents/enrollment-reconciliation/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) claims /
    // payer-operations agent that compares a group's SOURCE-OF-TRUTH enrollment
    // roster (the employer / HR feed) against the CARRIER's current roster and
    // produces the reconciliation actions (enroll / terminate / update /
    // no-change) that bring the carrier into agreement. UNLIKE the Member
    // Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's
    // identity MATCHING, the Drug Interaction agent's pairwise LOOKUP, or the MLR
    // Rebate agent's RATIO + apportionment, the heart of this service is a KEYED
    // SET-DIFFERENCE + a FIELD-LEVEL COMPARISON: it keys both rosters by member
    // id, walks the UNION, and classifies each member (in source only → enroll;
    // in carrier only → terminate; in both with a differing field → update, with
    // the field deltas; in both and identical → no-change). A determination is a
    // RECOMMENDATION requiring a benefits administrator to confirm and post — the
    // agent never autonomously APPLIES an enrollment change. It COMPLEMENTS the
    // other payer-operations agents — distinct from the Claims Adjudication agent
    // (the allowed amount), the Member Cost-Share agent (splitting a claim), the
    // Coordination of Benefits agent (the order of coverages), the MLR Rebate
    // agent (a plan-year rebate), and the OIG Exclusion agent (screening a party
    // against the sanctions list): this reconciles WHO is enrolled — the
    // membership roster itself — between the employer and the carrier. It is
    // PHI-bearing (the rosters reference members + their coverage). REUSES the
    // existing payer-operations tier. The rosters + compared fields are
    // ILLUSTRATIVE, NOT a certified 834 / enrollment system.
    endpoint: "/api/agents/enrollment-reconciliation",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Compares a group's source-of-truth enrollment roster (the employer / HR feed) against the carrier's current roster and produces the reconciliation actions — enroll (in source only), terminate (in carrier only), update (in both with a differing field, listing the deltas), no-change (identical) — that bring the carrier into agreement. A deterministic payer-operations agent; distinct from the Claims Adjudication agent (the allowed amount), the Member Cost-Share agent (splitting a claim), the Coordination of Benefits, MLR Rebate, and OIG Exclusion agents — this reconciles WHO is enrolled, the membership roster itself, between the employer and the carrier",
      "The reconciliation is DETERMINISTIC — a pure function of the two rosters (no randomness, no clock; not a dollar waterfall, an identity match, or a ratio but a KEYED SET-DIFFERENCE + a FIELD-LEVEL COMPARISON over the union of member ids); the same two rosters always yield the same actions",
      "The reconciliation must account for every member EXACTLY once — the per-kind counts must sum to the number of actions, the total-members count must equal the number of actions, and no member may appear twice; a reconciliation that drops, duplicates, or miscounts a member (a terminated employee who keeps coverage, or a new hire who never gets enrolled) is blocked at the Agent Fabric governance boundary (policy.enrollment.reconciliation-complete, the load-bearing correctness gate); and every action must be sourced — every UPDATE must carry at least one genuinely-differing field and every NO-CHANGE / ENROLL / TERMINATE must carry none, so a fabricated discrepancy is blocked (policy.enrollment.actions-sourced). Mirrors the MLR Rebate Agent's allocation-consistent and the OIG Exclusion Agent's match-not-overstated posture",
      "The reconciliation is a RECOMMENDATION — the agent NEVER applies an enrollment change to the system of record (enrolling / terminating / updating a member is a coverage decision that must be authorized); a determination that auto-applies, or is not review-gated, is blocked (policy.enrollment.no-autonomous-change), and every action is confirmed + posted by a benefits administrator. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the MLR Rebate Agent's no-autonomous-disbursement posture",
      "Runs against ILLUSTRATIVE synthetic rosters + compared fields — clearly labeled; NOT a certified 834 / enrollment system (real reconciliation uses the full X12 834 transaction set, effective-dating / retroactivity rules, dependent / COBRA / qualifying-event handling, and the carrier's eligibility system). PHI-bearing — the rosters reference members and their coverage"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "household-composition-agent",
    name: "Household / Family-Unit Composition Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side household-composition piece: POST
    // /api/agents/household-composition/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) claims / payer-operations agent that takes a
    // batch of plan MEMBERS plus a set of PAIRWISE relationship LINKS (shared
    // subscriber, shared address, a tax-dependent tie) and groups the members
    // into HOUSEHOLDS by computing the CONNECTED COMPONENTS of the relationship
    // graph — so a member linked to a member linked to a third all land in ONE
    // household even when the first and third are not directly linked
    // (transitivity). UNLIKE the Provider Benchmarking agent's PERCENTILE / RANK
    // STATISTICS, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the
    // Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict
    // agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY
    // BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the
    // Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's
    // TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED
    // SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall,
    // the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, or the Audit Log Integrity
    // agent's HASH CHAIN — and CRUCIALLY distinct from the Master-Patient-Index
    // agent's identity MATCHING (which links records of the SAME person across
    // systems) — the heart of this service is UNION-FIND / DISJOINT-SET CONNECTED
    // COMPONENTS: it clusters DIFFERENT people who share a household by taking the
    // transitive closure of the relationship links. A household drives a family
    // deductible / out-of-pocket maximum, household outreach, and consent scoping;
    // a wrong grouping mis-applies a family accumulator or leaks one member's data
    // to another. A determination is a RECOMMENDATION requiring a data steward to
    // confirm — the agent never autonomously MERGES member records, changes
    // enrollment, or applies a family accumulator. It COMPLEMENTS the other
    // member / enrollment agents — distinct from the Master-Patient-Index agent
    // (same-person matching), the Enrollment Reconciliation agent (WHO is enrolled
    // via a set-difference), and the Coordination of Benefits agent (the ORDER of
    // a member's coverages): this GROUPS distinct members into family units. It is
    // PHI-bearing (the members are patients). REUSES the existing payer-operations
    // tier. The members + links are ILLUSTRATIVE, NOT a certified enrollment / MDM
    // system.
    endpoint: "/api/agents/household-composition",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a batch of plan members plus a set of pairwise relationship links (shared subscriber, shared address, a tax-dependent tie) and groups the members into households by computing the connected components of the relationship graph — so a member linked to a member linked to a third all land in one household even when the first and third are not directly linked (transitivity) — reporting the households, the household count, the largest-household size, and the disposition (all-singletons / households-formed). A deterministic payer-operations agent; it COMPLEMENTS the Master-Patient-Index agent (which matches records of the SAME person), the Enrollment Reconciliation agent (WHO is enrolled via a keyed set-difference), and the Coordination of Benefits agent (the ORDER of a member's coverages) — this GROUPS distinct members into family units",
      "The grouping is DETERMINISTIC — a pure function of the request's own members + links (no randomness, no clock; not a percentile, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, a dollar waterfall, a pairwise KB lookup, or a hash chain but UNION-FIND / DISJOINT-SET CONNECTED COMPONENTS — the transitive closure of the relationship links); the same members + links always yield the same households, with deterministic household ids (assigned by each component's minimum member)",
      "The grouping must be built from the submitted batch — every link must connect two submitted members (no phantom relationship), and the households must PARTITION exactly the submitted members (each member in exactly one household, all covered, none invented); a phantom link or a dropped / invented member is blocked at the Agent Fabric governance boundary (policy.household.links-sourced, the sourced + completeness gate); and the partition must be the correct connected components — recomputing the union-find must reproduce the reported households, counts, and disposition; a wrong grouping (two unlinked members merged, or two linked members split) is blocked (policy.household.partition-consistent, the load-bearing correctness gate). Mirrors the Enrollment Reconciliation Agent's reconciliation-complete + the Provider Benchmarking Agent's stats-consistent posture",
      "The agent PROPOSES a household grouping — it NEVER merges member records, changes enrollment, or applies a family accumulator (each is a consequential action that must be authorized) on its own; a determination that auto-merges or is not review-gated is blocked (policy.household.no-autonomous-merge), and every grouping is confirmed by a data steward. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Master-Patient-Index Agent's no-autonomous-merge posture",
      "Runs against ILLUSTRATIVE synthetic members + links — clearly labeled; NOT a certified enrollment / MDM system (real household / family-unit composition uses the 834 subscriber / dependent structure, address normalization, tax-household rules, and a master-data-management steward's judgment). PHI-bearing — the members are patients"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "network-adequacy-agent",
    name: "Network Adequacy / Time-and-Distance Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side network-adequacy piece: POST
    // /api/agents/network-adequacy/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent that takes a
    // MEMBER's location plus the plan's IN-NETWORK PROVIDERS and decides whether
    // the network meets the applicable TIME-AND-DISTANCE adequacy standard for a
    // required specialty — it computes the GREAT-CIRCLE (haversine) distance from
    // the member to each in-network provider of that specialty, finds the
    // NEAREST, and flags an adequacy GAP when the nearest exceeds the standard.
    // UNLIKE the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM (the
    // NPI Luhn check digit), the Household Composition agent's UNION-FIND
    // CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK
    // STATISTICS, the Master-Patient-Index agent's WEIGHTED identity MATCHING, the
    // Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name
    // Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY
    // INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the
    // Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity
    // agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the
    // Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log
    // Integrity agent's HASH CHAIN — the heart of this service is GEOSPATIAL
    // GREAT-CIRCLE DISTANCE: the haversine formula that converts two (lat, lon)
    // pairs into a distance in miles, plus a NEAREST-NEIGHBOR scan and a THRESHOLD
    // comparison against the regulatory standard. A member with no in-network
    // specialist within the standard distance has a network-adequacy GAP — a
    // compliance failure (CMS 42 CFR 422.116 / state QHP time-and-distance
    // standards) and an access-to-care failure; a wrong distance understates the
    // gap. A determination is a RECOMMENDATION requiring a network manager to
    // confirm — the agent never autonomously CERTIFIES the network, CLOSES a gap,
    // or ADDS / REMOVES a provider. It COMPLEMENTS the other provider / network
    // agents — distinct from the Provider Credentialing agent (whether a provider
    // is QUALIFIED and in the directory), the Referral Management agent (routing a
    // specific referral), and the Provider Benchmarking agent (a provider's cost /
    // quality percentile): this measures whether the network is geographically
    // ADEQUATE. It is PHI-bearing (the member's location + the specialty they need
    // is health information). REUSES the existing payer-operations tier. The
    // member + providers + coordinates are ILLUSTRATIVE, NOT a certified
    // network-adequacy engine (no drive-time, county-designation, or capacity
    // rules).
    endpoint: "/api/agents/network-adequacy",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a member's location plus the plan's in-network providers and decides whether the network meets the applicable time-and-distance adequacy standard for a required specialty — it computes the great-circle (haversine) distance from the member to each in-network provider of that specialty, finds the nearest, and flags an adequacy gap when the nearest exceeds the standard — reporting the evaluated providers with distances, the nearest, the matching-provider count, and the disposition (adequacy-met / adequacy-gap). A deterministic payer-operations agent; it COMPLEMENTS the Provider Credentialing agent (whether a provider is QUALIFIED and in the directory), the Referral Management agent (routing a specific referral), and the Provider Benchmarking agent (a provider's cost / quality percentile) — this measures whether the network is geographically ADEQUATE",
      "The finding is DETERMINISTIC — a pure function of the request's own coordinates + standard (no randomness, no clock; not a checksum, a union-find, a percentile, an identity match, an FSM transition, an edit distance, an interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, or a hash chain but GEOSPATIAL GREAT-CIRCLE DISTANCE — the haversine formula plus a nearest-neighbor scan and a threshold comparison); the same request always yields the same result",
      "Every evaluated provider must be built from the submitted in-network providers — a submitted provider of the required specialty (same id + coordinates), all such providers evaluated, none dropped or invented; a phantom provider fabricating coverage is blocked at the Agent Fabric governance boundary (policy.adequacy.providers-sourced, the sourced + completeness gate); and the distances must recompute — recomputing the haversine distance from the member to each provider's coordinates must reproduce the reported distances, the nearest, and the disposition; a mis-measured distance (understating a gap into false adequacy) is blocked (policy.adequacy.distances-consistent, the load-bearing correctness gate). Mirrors the Medication Name Safety Agent's distances-consistent + the Identifier Validation Agent's identifiers-sourced posture",
      "The agent ASSESSES adequacy — it NEVER certifies the network to a regulator, closes a gap, or adds / removes a provider (each is a consequential action that must be authorized) on its own; a determination that auto-certifies or is not review-gated is blocked (policy.adequacy.no-autonomous-network-change), and every finding is confirmed by a network manager. Mirrors the Provider Benchmarking Agent's no-autonomous-tiering and the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture",
      "Runs against ILLUSTRATIVE synthetic member + providers + coordinates + standards — clearly labeled; computes STRAIGHT-LINE great-circle distance only, NOT a certified network-adequacy engine (real time-and-distance adequacy uses drive-time isochrones, county type, minimum provider counts, and telehealth credits). PHI-bearing — the member's location + the specialty they need is health information"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "coverage-continuity-agent",
    name: "Creditable Coverage Continuity Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side coverage-continuity piece: POST
    // /api/agents/coverage-continuity/tasks (card at /.well-known/agent.json). A
    // DETERMINISTIC (no-Claude) claims / payer-operations agent that takes a
    // member's COVERAGE SEGMENTS (each a start/end date), MERGES the overlapping
    // / adjacent ones into continuous spans, totals the covered days, and
    // measures the GAPS between spans — flagging a SIGNIFICANT BREAK in
    // creditable coverage (a gap longer than 63 days, the HIPAA / ACA rule).
    // UNLIKE the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
    // Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's
    // SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or
    // the MLR Rebate agent's RATIO + apportionment — and UNLIKE the DATE-DEADLINE
    // agents (Timely Filing, Right of Access, Amendment) that add N days to a
    // single date — the heart of this service is INTERVAL MERGING + GAP DETECTION
    // over a set of date ranges. It COMPLEMENTS the other payer-operations agents
    // — distinct from the Benefits Verification agent (is coverage active NOW),
    // the Coordination of Benefits agent (the ORDER of concurrent coverages), the
    // Enrollment Reconciliation agent (employer-vs-carrier roster drift), the
    // Member Cost-Share agent (splitting a claim), and the MLR Rebate agent (a
    // plan-year rebate): this measures the CONTINUITY of a member's coverage OVER
    // TIME. A determination is a RECOMMENDATION requiring an eligibility reviewer
    // to confirm; the agent never autonomously ISSUES a creditable-coverage
    // determination, denies special enrollment, or imposes a late-enrollment
    // penalty. It is PHI-bearing (the segments reference the member's coverage
    // history). REUSES the existing payer-operations tier. The segments +
    // threshold are ILLUSTRATIVE, NOT a certified creditable-coverage system.
    endpoint: "/api/agents/coverage-continuity",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a member's coverage segments (each a start/end date from an employer, individual, or public plan), merges the overlapping / adjacent ones into continuous spans, totals the inclusive covered days, measures the gaps between consecutive spans, and flags a significant break in creditable coverage when a gap exceeds the threshold (63 days by the HIPAA / ACA rule). A deterministic payer-operations agent; distinct from the Benefits Verification agent (is coverage active NOW), the Coordination of Benefits agent (the ORDER of concurrent coverages), the Enrollment Reconciliation agent (roster drift), and the Member Cost-Share agent (splitting a claim) — this measures the CONTINUITY of coverage OVER TIME",
      "The analysis is DETERMINISTIC — a pure function of the member's segments + the request's own asOfDate (time is data; no real clock; not a topological sort, a set-difference, a dollar waterfall, a ratio, or a single-date deadline but INTERVAL MERGING + GAP DETECTION over date ranges); the same segments always yield the same spans + gaps + determination",
      "Every merged span must trace to submitted segments — each span boundary must come from a real segment boundary and every segment must fall within a span; fabricated coverage (a span not backed by a segment) or a dropped segment is blocked at the Agent Fabric governance boundary (policy.coverage.segments-sourced); and the coverage math must be exact — the total covered days must equal the sum of the spans' inclusive lengths, each gap must equal the exact distance between consecutive spans, and the significant-break flag must equal whether any gap exceeds the threshold; a miscounted total, a mis-measured gap, or a mismatched break flag is blocked (policy.coverage.math-consistent, the load-bearing correctness gate). Mirrors the Member Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent posture",
      "The agent MEASURES — it NEVER issues a creditable-coverage determination, denies a special enrollment, or imposes a late-enrollment penalty (each is a coverage decision that must be authorized) on its own; a determination that auto-issues or is not review-gated is blocked (policy.coverage.no-autonomous-determination), and every determination is a recommendation requiring an eligibility reviewer to confirm. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the MLR Rebate Agent's no-autonomous-disbursement posture",
      "Runs against ILLUSTRATIVE synthetic segments + threshold — clearly labeled; NOT a certified creditable-coverage system (real determination uses the certificate of creditable coverage, plan-specific rules, and the full HIPAA / ACA / Medicare Part D frameworks). PHI-bearing — the segments reference the member's coverage history"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "access-anomaly-agent",
    name: "Access Anomaly Detection Agent",
    kind: "mulesoft-process",
    protocol: "a2a",
    // Runnable A2A stand-in for the MuleSoft control-plane / data-substrate
    // access-anomaly-detection service: POST /api/agents/access-anomaly/tasks
    // (card at /.well-known/agent.json). A DETERMINISTIC (no-Claude)
    // data-substrate agent that implements the HIPAA Security Rule's
    // information-system-activity-review safeguard (§164.308(a)(1)(ii)(D)):
    // given an actor's PHI-ACCESS EVENTS (each a timestamped read of a patient
    // record) plus a window length and a threshold, it COUNTS the accesses
    // within a ROLLING TIME WINDOW, finds the PEAK number in any window of the
    // configured length, and flags an ANOMALY when that peak exceeds the
    // threshold (a possible snooping / breach pattern). UNLIKE the Coverage
    // Continuity agent's INTERVAL MERGING + GAP DETECTION, the Care Pathway
    // agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED
    // SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall,
    // the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity
    // agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely Filing,
    // Right of Access, Amendment) that add N days to a single date — the heart
    // of this service is SLIDING-WINDOW COUNTING over timestamped events (a
    // two-pointer scan for the peak count in any fixed-length window). It
    // COMPLEMENTS the other platform agents — distinct from the Audit Log
    // Integrity agent (whether the audit TRAIL is tamper-evident), the
    // Break-the-Glass agent (whether a single emergency access is authorized),
    // the Minimum Necessary agent (how much PHI a purpose may see), the
    // Accounting of Disclosures agent (WHO a patient's PHI was disclosed to),
    // and the Consent agent (whether a patient may be contacted / data used):
    // this detects an unusual VOLUME of accesses by one actor over time. A flag
    // is a RECOMMENDATION requiring a privacy officer to review; the agent never
    // autonomously LOCKS the actor's account, revokes their access, or
    // disciplines them. It is PHI-bearing (the events reference the patients
    // whose records were accessed). REUSES the existing data-plane tier
    // (platform plane). The events + window + threshold are ILLUSTRATIVE, NOT a
    // certified breach-detection / SIEM system.
    endpoint: "/api/agents/access-anomaly",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "The information-system-activity-review layer of the data substrate — given an actor's PHI-access events plus a window length and a threshold, counts the accesses within a rolling time window, finds the peak number in any window of that length, and flags an anomalous access volume when the peak exceeds the threshold (a possible snooping / breach pattern under HIPAA §164.308(a)(1)(ii)(D)). Complements (not duplicates) the Audit Log Integrity agent (whether the audit TRAIL is tamper-evident), the Break-the-Glass agent (whether a single emergency access is authorized), the Minimum Necessary agent (how much PHI a purpose may see), the Accounting of Disclosures agent (WHO a patient's PHI was disclosed to), and the Consent agent (whether a patient may be contacted / data used) — this detects an unusual VOLUME of accesses by one actor over time",
      "The detection is DETERMINISTIC — a pure function of the actor's events + the window + the threshold (time is data; no real clock; not an interval merge, a topological sort, a set-difference, a dollar waterfall, an identity match, or a hash chain but SLIDING-WINDOW COUNTING via a two-pointer scan); the same events always yield the same peak + finding, and the detection is WINDOWED (a high daily total spread into small bursts is NOT flagged), not a naive total count",
      "Every event in the reported peak window must trace to a submitted access event — the peak window's event ids must be a subset of the submitted events and its count must equal the number of those ids; a fabricated peak event or a phantom count is blocked at the Agent Fabric governance boundary (policy.access.events-sourced); and the window count must be exact — recomputing the sliding-window peak must reproduce the reported count, the peak window's events must all fall within a span of at most windowMinutes, and the anomaly flag must equal whether the peak exceeds the threshold; a miscounted peak, an over-wide window, or a mismatched flag is blocked (policy.access.window-count-consistent, the load-bearing correctness gate). Mirrors the Coverage Continuity Agent's segments-sourced + math-consistent posture",
      "The agent MEASURES — it NEVER locks the actor's account, revokes their access, or disciplines them (each is an access / employment action that must be authorized) on its own; a finding that auto-locks / auto-revokes, or that is not review-gated, is blocked (policy.access.no-autonomous-action), and every flag is a recommendation requiring a privacy officer to review. Mirrors the Coverage Continuity Agent's no-autonomous-determination and the Audit Log Integrity Agent's no-autonomous-redaction posture",
      "Runs against ILLUSTRATIVE synthetic events + window + threshold — clearly labeled; NOT a certified breach-detection / SIEM system (real activity review uses the full audit trail, user-behavior analytics, role / relationship context — is there a treatment relationship? — and the privacy officer's judgment). PHI-bearing — the events reference the patients whose records were accessed"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "data-plane"
  },
  {
    id: "exclusion-screening-agent",
    name: "OIG Exclusion / Sanctions Screening Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the payer-side exclusion / sanctions-screening
    // piece: POST /api/agents/exclusion-screening/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) claims /
    // payer-operations agent that screens a party (a provider, a vendor, an
    // employee) against the OIG List of Excluded Individuals / Entities (LEIE)
    // BEFORE a plan pays or contracts with them, computing an HONEST match
    // strength from explicit identifier signals — never OVERSTATING a name
    // coincidence into a confirmed exclusion, and never autonomously blocking a
    // payment or clearing a party. It COMPLEMENTS the other agents — distinct
    // from the Provider Credentialing agent (whether a provider is QUALIFIED),
    // the Claims Adjudication agent (the allowed amount), and the FWA agent
    // (suspected fraud on a claim): this screens a party's IDENTITY against the
    // OIG exclusion list to prevent an improper PAYMENT to a sanctioned party.
    // REUSES the existing payer-operations tier. Deliberately NOT PHI-bearing
    // (it screens a provider / vendor's identity against a public exclusion
    // list, not a patient's health information) — so it is NOT on the
    // HIPAA-audit policy. The exclusion catalog + match rules are ILLUSTRATIVE,
    // NOT a certified exclusion-screening system.
    endpoint: "/api/agents/exclusion-screening",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens a party (a provider / vendor / employee) against the OIG List of Excluded Individuals / Entities (LEIE) before a plan pays or contracts with them — required because the Social Security Act §1128 / §1128A(a)(6) and 42 CFR §1001 prohibit federal-program payment for items or services furnished, ordered, or prescribed by an OIG-excluded party. Given a screening request (a party reference and the party's identifiers — last name, first name, and optionally an NPI and a date of birth), it computes a match STRENGTH grounded in which identifiers actually matched (no-match / possible / probable / confirmed) and a recommended disposition. Companion to the Provider Credentialing (whether a provider is QUALIFIED), Claims Adjudication (the allowed amount), and FWA Detection (fraud) agents — this screens a party's IDENTITY against the exclusion list to prevent an improper PAYMENT",
      "The match is DETERMINISTIC — a pure function of the request's own fields + the catalog (no randomness, no clock); a confirmed match requires an NPI match OR a full-name AND date-of-birth match, a full-name match with no DOB / NPI is probable, and a last-name coincidence the first name / DOB doesn't corroborate is possible — so the same party always yields the same match strength",
      "A reported match must trace to a recorded LEIE record — a match asserted without a sourced exclusion record is blocked at the Agent Fabric governance boundary (policy.exclusion.match-record-sourced); and the reported match strength must never exceed what the identifier signals support — a name coincidence dressed up as a confirmed exclusion is blocked (policy.exclusion.match-not-overstated, the load-bearing correctness gate). Mirrors the Right of Access Agent's ground-sourced and the Member Cost-Share Agent's math-consistent posture",
      "The screening is a RECOMMENDATION — the agent NEVER autonomously blocks a payment (which denies a legitimate provider income) or clears a party (which risks paying a sanctioned party); a determination that auto-blocks / auto-clears, or that is not review-gated, is blocked (policy.exclusion.no-autonomous-block-or-clear), and a compliance officer confirms the identity and acts. Mirrors the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability and the Member Cost-Share Agent's no-autonomous-member-charge posture",
      "Deliberately NOT PHI-bearing — it screens a provider / vendor's identity against a public exclusion list, not a patient's health information, so it is NOT on the HIPAA-audit policy. Runs against an ILLUSTRATIVE synthetic LEIE catalog + match rules (no fuzzy / phonetic matching, no monthly LEIE reload, no SAM.gov / state Medicaid exclusion lists, no reinstatement handling) — clearly labeled; NOT a certified exclusion-screening system (real screening is governed by the OIG LEIE, the OIG Special Advisory Bulletin on the effect of exclusion, and the payer's screening policy)"
    ],
    provider: "Salesforce",
    governanceTier: "payer-operations"
  },
  {
    id: "controlled-substance-agent",
    name: "Controlled Substance / PDMP Safety Check Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical-decision controlled-substance /
    // PDMP piece: POST /api/agents/controlled-substance/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) clinical-decision
    // agent. Given a proposed controlled-substance prescription (a drug, its
    // class, its dose in MME/day, days supply, prescriber, pharmacy) and the
    // patient's active PDMP history, it DETERMINISTICALLY sums the total opioid
    // MME/day (proposed + concurrent), flags a concurrent opioid+benzodiazepine
    // combination and multi-prescriber / multi-pharmacy patterns, compares the
    // total against the cited guideline's caution (50) and high-risk (90)
    // MME/day thresholds, and classifies the risk (low / elevated / high). A
    // risk finding is a RECOMMENDATION requiring prescriber review — the agent
    // never autonomously approves, denies, dispenses, or writes the
    // prescription. It COMPLEMENTS the other clinical / medication agents —
    // distinct from the Formulary & DUR Review agent (plan-level coverage / step
    // therapy / DUR alerts), the Medication Adherence agent (taking an
    // already-prescribed drug), the Prior Authorization agent (assembling a PA
    // package), and the Immunization agent (vaccine schedule): this screens the
    // TOTAL controlled-substance burden across ALL prescribers per the PDMP.
    // REUSES the existing clinical-decision tier. The MME thresholds + figures
    // are ILLUSTRATIVE, NOT a certified PDMP or clinical decision support.
    endpoint: "/api/agents/controlled-substance",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens a proposed controlled-substance prescription against the patient's PDMP history for a prescriber / pharmacy — sums the total opioid MME/day (proposed + concurrent), flags a concurrent opioid+benzodiazepine combination and multi-prescriber / multi-pharmacy patterns, compares the total against the guideline's caution (50) and high-risk (90) MME/day thresholds, and classifies the risk (low / elevated / high). A deterministic clinical-decision agent; distinct from the Formulary & DUR Review, Medication Adherence, Prior Authorization, and Immunization agents — this screens the TOTAL controlled-substance burden across ALL prescribers",
      "The risk finding is DETERMINISTIC — a pure function of the request's data + the cited guideline (no randomness, no clock); the total MME/day is the sum of the proposed opioid contribution + the concurrent opioid MME/day, and the same request always yields the same total + risk + disposition",
      "Every risk threshold must cite a recorded guideline — an ad-hoc / un-sourced threshold is blocked at the Agent Fabric governance boundary (policy.controlledsubstance.guideline-sourced); and the total MME/day must equal the computed proposed + concurrent sum — a guessed / hidden dose is blocked (policy.controlledsubstance.mme-computed, the load-bearing correctness gate). Mirrors the Immunization Agent's schedule-sourced and the Timely Filing Agent's deadline-computed posture",
      "A controlled-substance risk finding is a RECOMMENDATION requiring prescriber review — the agent never autonomously approves, denies, dispenses, or writes the prescription; a determination that auto-decides, or reports an elevated / high-risk finding without requiring review, is blocked (policy.controlledsubstance.no-autonomous-prescribing-decision). Mirrors the Immunization Agent's no-autonomous-administration and the Lab Result Agent's no-autonomous-clinical-action posture",
      "Runs against an ILLUSTRATIVE synthetic MME threshold catalog + drug classes + MME/day figures — clearly labeled; NOT a certified PDMP or clinical decision support (real monitoring uses the state PDMP, the CDC MME conversion factors, the CDC 2022 opioid-prescribing guideline, and the prescriber's clinical judgment)"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "drug-interaction-agent",
    name: "Drug–Drug Interaction (DDI) Safety Check Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical-decision drug-interaction piece:
    // POST /api/agents/drug-interaction/tasks (card at /.well-known/agent.json).
    // A DETERMINISTIC (no-Claude) clinical-decision agent. Given a proposed /
    // new drug and the patient's active medication list, it DETERMINISTICALLY
    // pairs the proposed drug with each active medication, looks up every
    // recorded interaction in the knowledge base, ranks them by severity
    // (contraindicated > major > moderate > minor), reports the overall severity
    // + mechanism + management, and decides the disposition
    // (no-interaction-detected / monitor / review-recommended / review-required /
    // do-not-coadminister-needs-review). UNLIKE the recent platform agents there
    // is NO date math, NO dollar waterfall, and NO single-record exception
    // classifier — the heart is a PAIRWISE KNOWLEDGE-BASE LOOKUP + a SEVERITY
    // RANKING. A finding is a RECOMMENDATION requiring a pharmacist / prescriber
    // to act on or review — the agent never autonomously HOLDS / cancels the
    // order or OVERRIDES the alert. It COMPLEMENTS the other clinical /
    // medication agents — distinct from the Controlled Substance / PDMP agent
    // (the TOTAL controlled-substance MME burden across prescribers), the
    // Formulary & DUR Review agent (plan-level coverage / step therapy), the
    // Medication Adherence agent (taking an already-prescribed drug), the Prior
    // Authorization agent (assembling a PA package), and the Immunization agent
    // (the vaccine schedule): this screens whether a NEW drug INTERACTS with what
    // the patient already takes. REUSES the existing clinical-decision tier. The
    // interaction knowledge base + severity assignments are ILLUSTRATIVE, NOT a
    // certified clinical decision support system.
    endpoint: "/api/agents/drug-interaction",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Screens a proposed / new drug against the patient's active medication list — pairs the proposed drug with each active medication, looks up every recorded interaction in the knowledge base, ranks them by severity (contraindicated / major / moderate / minor), reports the overall severity + mechanism + management, and decides the disposition (no-interaction-detected / monitor / review-recommended / review-required / do-not-coadminister-needs-review). A deterministic clinical-decision agent; distinct from the Controlled Substance / PDMP agent (the TOTAL controlled-substance MME burden), the Formulary & DUR Review, Medication Adherence, Prior Authorization, and Immunization agents — this screens whether a NEW drug INTERACTS with what the patient already takes",
      "The finding is DETERMINISTIC — a pure function of the request's data (no randomness, no clock; no date math and no dollar waterfall — it is a pairwise knowledge-base lookup + severity ranking); the same proposed drug + active list always yields the same interactions + overall severity + disposition",
      "Every reported interaction must trace to the recorded knowledge base with a matching pair + severity — a fabricated / off-catalog interaction is blocked at the Agent Fabric governance boundary (policy.ddi.interaction-sourced); and the overall severity must equal the highest cataloged severity among the detected interactions — an inflated (alert fatigue, wrongful cancellation) or suppressed (hidden contraindication) severity is blocked (policy.ddi.severity-consistent, the load-bearing correctness gate). Mirrors the Controlled Substance Agent's guideline-sourced and the Member Cost-Share Agent's math-consistent posture",
      "The agent SCREENS — it NEVER holds / cancels the order (which could deny needed therapy) or overrides the alert (which could push through a contraindicated combination) on its own; a determination that auto-holds / auto-overrides or is not review-gated is blocked (policy.ddi.no-autonomous-hold-or-override), and every finding is a recommendation requiring a pharmacist / prescriber to act on or review. Mirrors the Controlled Substance Agent's no-autonomous-prescribing-decision and the Lab Result Agent's no-autonomous-clinical-action posture",
      "Runs against an ILLUSTRATIVE synthetic interaction knowledge base + severity assignments — clearly labeled; NOT a certified clinical decision support system (real interaction checking uses a maintained compendium, normalized drug vocabularies like RxNorm, dose / route / timing context, patient-specific factors, and the pharmacist's / prescriber's clinical judgment)"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "medication-name-safety-agent",
    name: "Medication Name Safety (LASA) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical-decision medication-name-safety
    // piece: POST /api/agents/medication-name-safety/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) clinical-decision
    // agent that takes a PRESCRIBED / TYPED drug name plus a formulary CATALOG
    // and, using EDIT DISTANCE, finds the nearest catalog name and flags a
    // LOOK-ALIKE / SOUND-ALIKE (LASA) confusion — a name dangerously close to a
    // DIFFERENT drug, or a near-miss misspelling — for a pharmacist. UNLIKE the
    // Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing
    // agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW
    // COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care
    // Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's
    // KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
    // waterfall, the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG
    // Exclusion agent's EXACT identity MATCHING (explicitly NO fuzzy matching),
    // or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the DATE-
    // DEADLINE agents (Timely Filing, Right of Access, Amendment) that add N days
    // to a single date — the heart of this service is STRING EDIT DISTANCE (the
    // classic Levenshtein dynamic-programming algorithm). It COMPLEMENTS the
    // other medication agents — distinct from the DDI agent (whether two drugs
    // INTERACT), the Formulary & DUR agent (whether a drug is COVERED /
    // appropriate), the Controlled-Substance / PDMP agent (opioid MME safety),
    // and the Medication Adherence agent (refill nudges): this catches a name
    // that is CONFUSABLE with a different drug before it becomes a wrong-drug
    // error. A finding is a RECOMMENDATION requiring a pharmacist to confirm the
    // intended medication; the agent never autonomously SUBSTITUTES, CORRECTS, or
    // DISPENSES a drug. It is PHI-bearing (the prescribed name is for a patient's
    // medication order). REUSES the existing clinical-decision tier. The catalog
    // + names are ILLUSTRATIVE, NOT a certified medication-safety system.
    endpoint: "/api/agents/medication-name-safety",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Takes a prescribed / typed drug name plus a formulary catalog and, using edit distance, finds the nearest catalog name and flags a look-alike / sound-alike (LASA) confusion — a name dangerously close to a different drug, or a near-miss misspelling — for a pharmacist. A deterministic clinical-decision agent; it COMPLEMENTS the DDI agent (whether two drugs INTERACT), the Formulary & DUR agent (whether a drug is COVERED), the Controlled-Substance / PDMP agent (opioid MME safety), and the Medication Adherence agent (refill nudges) — this catches a name CONFUSABLE with a different drug before it becomes a wrong-drug error",
      "The finding is DETERMINISTIC — a pure function of the request's own name + catalog + threshold (no randomness, no clock; not a greedy interval selection, a bin-packing, a sliding-window count, an interval merge, a topological sort, a set-difference, a dollar waterfall, a pairwise KB lookup, an exact identity match, or a hash chain but STRING EDIT DISTANCE — the classic Levenshtein dynamic-programming algorithm, the minimum single-character edits to turn one name into another); the same input always yields the same finding",
      "Every candidate — the nearest match and every confusable look-alike — must trace to a real catalog drug (drugId in the catalog, echoed name matching); a fabricated or mislabeled candidate is blocked at the Agent Fabric governance boundary (policy.lasa.candidates-sourced, the sourced gate); and the distances must be exact — recomputing the Levenshtein distance to the catalog must reproduce the reported nearest match, every distance, the exact-match flag, the confusable set (exactly those within the threshold), and the disposition; a miscomputed distance, a wrong nearest match, an omitted look-alike, or a bad disposition is blocked (policy.lasa.distances-consistent, the load-bearing correctness gate). Mirrors the DDI Agent's interaction-sourced + severity-consistent posture",
      "The agent FLAGS — it NEVER substitutes the drug for the nearest match, silently corrects the order, or dispenses (each is a clinical action that must be authorized) on its own; a finding that auto-substitutes or is not review-gated is blocked (policy.lasa.no-autonomous-substitution), and every finding is a recommendation requiring a pharmacist to confirm the intended medication. Mirrors the DDI Agent's no-autonomous-hold-or-override and the Schedule Conflict Agent's no-autonomous-booking posture",
      "Runs against an ILLUSTRATIVE synthetic formulary catalog + names — clearly labeled; NOT a certified medication-safety system (real LASA safety uses the ISMP / FDA LASA lists, tall-man lettering, RxNorm / First Databank vocabularies, indication / dose context, and barcode scanning). PHI-bearing — the prescribed name is for a patient's medication order"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "care-pathway-agent",
    name: "Care Pathway Sequencing Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the clinical-decision care-pathway-sequencing
    // piece: POST /api/agents/care-pathway/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) clinical-decision
    // agent that takes a clinical pathway's STEPS — each declaring the
    // prerequisite steps that must precede it — and produces a valid EXECUTION
    // ORDER that respects every dependency, detecting DEPENDENCY CYCLES (no valid
    // order exists) and MISSING PREREQUISITES (a step depends on a step absent
    // from the pathway). UNLIKE the Enrollment Reconciliation agent's KEYED
    // SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall,
    // the OIG Exclusion agent's identity MATCHING, the Drug Interaction agent's
    // pairwise LOOKUP, or the MLR Rebate agent's RATIO + apportionment, the heart
    // of this service is a TOPOLOGICAL ORDERING (Kahn's algorithm) over a
    // dependency graph + CYCLE DETECTION. It COMPLEMENTS the other clinical
    // agents — distinct from the Care Plan agent (which AUTHORS a plan's goals /
    // interventions / cadence from a template), the Transitions of Care and Care
    // Coordination Handoff agents (moving a patient between settings / teams), the
    // Prior Authorization agent (assembling a PA package), and the Drug
    // Interaction / Controlled Substance agents (medication safety): this ORDERS
    // the steps of a pathway so no step is scheduled before its prerequisites. A
    // determination — a sequenced pathway, a detected cycle, or a missing
    // prerequisite — is a RECOMMENDATION requiring a clinician to confirm and
    // order; the agent never autonomously EXECUTES a step. It is PHI-bearing (the
    // pathway references the patient). REUSES the existing clinical-decision tier.
    // The pathways + steps are ILLUSTRATIVE, NOT a certified clinical pathway
    // engine.
    endpoint: "/api/agents/care-pathway",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Sequences a clinical pathway's steps — each declaring its prerequisite steps — into a valid execution order that respects every dependency, detecting dependency cycles (no valid order exists) and missing prerequisites (a step depends on a step absent from the pathway), and reporting each step's stage (0-based longest-prerequisite-chain depth). A deterministic clinical-decision agent; distinct from the Care Plan agent (which AUTHORS a plan from a template), the Transitions of Care / Care Coordination Handoff agents (moving a patient between settings / teams), and the Drug Interaction / Controlled Substance agents (medication safety) — this ORDERS the steps of a pathway so no step is scheduled before its prerequisites",
      "The sequencing is DETERMINISTIC — a pure function of the pathway's steps (no randomness, no clock; not a set-difference, an identity match, a lookup, or a ratio but a TOPOLOGICAL ORDERING via Kahn's algorithm + CYCLE DETECTION, ties broken by step id); the same pathway always yields the same order",
      "Every step id in the output must reference a submitted pathway step — a fabricated / dangling step id is blocked at the Agent Fabric governance boundary (policy.pathway.steps-sourced); and the sequence must be valid — when sequenced, the ordered steps are a complete permutation of the pathway and every step appears AFTER all its prerequisites (ordering a treatment step before its safety-screening prerequisite is the worst failure mode), and when un-sequenceable no order is asserted; a sequence that violates a prerequisite, drops a step, or asserts an impossible order is blocked (policy.pathway.sequence-valid, the load-bearing correctness gate). Mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Member Cost-Share Agent's math-consistent posture",
      "The agent SEQUENCES — it NEVER executes / orders / administers a step (ordering a lab, a screening, or a therapy is a clinical action that must be authorized) on its own; a determination that auto-executes or is not review-gated is blocked (policy.pathway.no-autonomous-execution), and every determination is a recommendation requiring a clinician to confirm and order. Mirrors the Drug Interaction Agent's no-autonomous-hold-or-override and the Lab Result Agent's no-autonomous-clinical-action posture",
      "Runs against ILLUSTRATIVE synthetic pathways + steps — clearly labeled; NOT a certified clinical pathway engine (real pathway management uses evidence-based order sets, the patient's clinical context, scheduling / timing constraints, and the care team's judgment). PHI-bearing — the pathway references the patient"
    ],
    provider: "Salesforce",
    governanceTier: "clinical-decision"
  },
  {
    id: "advance-beneficiary-notice-agent",
    name: "Advance Beneficiary Notice (Medicare ABN) Agent",
    kind: "agentforce",
    protocol: "a2a",
    // Runnable A2A stand-in for the patient-access Medicare ABN piece: POST
    // /api/agents/advance-beneficiary-notice/tasks (card at
    // /.well-known/agent.json). A DETERMINISTIC (no-Claude) patient-access /
    // benefits-verification agent. Given a proposed service (the cited Medicare
    // coverage rule, whether the service meets its coverage criteria or exceeds a
    // frequency limit, and whether an ABN was issued and signed BEFORE the
    // service), it DETERMINISTICALLY assesses coverage (likely-covered /
    // likely-non-covered / statutorily-excluded), decides whether a signed
    // pre-service ABN (Form CMS-R-131) is required, computes whether a valid
    // pre-service ABN is on file, decides whether the beneficiary may be billed,
    // assigns the CMS liability modifier (GA / GZ / GY), and decides the
    // disposition. It NEVER autonomously assigns patient financial liability — a
    // non-covered / excluded determination is a RECOMMENDATION requiring human
    // review. It COMPLEMENTS the other patient-access / financial agents — distinct
    // from the Good Faith Estimate agent (the No Surprises Act self-pay estimate),
    // the Balance Billing agent (the No Surprises Act claim-time surprise-bill
    // prohibition), the Benefits & Coverage Verification (EBV) agent (plan
    // eligibility), and the Financial Assistance agent (501(r) charity care): this
    // decides one narrow Medicare question — is a signed pre-service ABN required
    // before a likely-denied service, and may the beneficiary be billed. REUSES the
    // existing benefits-verification tier.
    endpoint: "/api/agents/advance-beneficiary-notice",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Decides, for a Medicare service likely to be denied as not-reasonable-and-necessary (or statutorily excluded), whether a signed pre-service ABN (Form CMS-R-131) is required, whether the beneficiary may be billed, and which CMS liability modifier applies (GA / GZ / GY) — assessing coverage from the cited rule, computing whether a valid pre-service ABN is on file, and deciding the disposition (proceed-covered / issue-abn-before-service / bill-beneficiary-with-abn / notify-statutory-exclusion). Companion to the Good Faith Estimate (NSA self-pay estimate), Balance Billing (NSA surprise-bill prohibition), Benefits & Coverage Verification (plan eligibility), and Financial Assistance (501(r) charity care) agents — this decides one narrow Medicare ABN question",
      "The determination is DETERMINISTIC — a pure function of the request's own fields + the cited coverage rule (no randomness, no clock); the same service always yields the same coverage assessment + ABN requirement + modifier + disposition",
      "Every non-coverage decision must cite a recorded Medicare coverage rule — an ad-hoc / un-sourced rule is blocked at the Agent Fabric governance boundary (policy.abn.coverage-rule-sourced); and a likely-non-covered service must require a signed pre-service ABN — a determination that marks it as needing no ABN is blocked (policy.abn.abn-required-when-noncovered, the load-bearing completeness gate). Mirrors the Good Faith Estimate Agent's charge-master-sourced + expected-items-complete posture",
      "Patient financial liability is NEVER assigned autonomously — the beneficiary may be billed for a non-covered service ONLY with a valid pre-service ABN (the GA modifier), otherwise the PROVIDER is liable (the GZ modifier), and every liability decision requires human review; a determination that bills the beneficiary without a valid ABN, or auto-assigns liability, is blocked (policy.abn.no-autonomous-beneficiary-liability). Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Timely Filing Agent's no-autonomous-write-off posture",
      "Runs against ILLUSTRATIVE synthetic Medicare coverage rules + categories + modifier logic — clearly labeled; NOT a certified Medicare coverage engine (real ABN decisions are governed by the Medicare NCD/LCD, the Social Security Act §1862(a), the CMS Medicare Claims Processing Manual Ch. 30, and Form CMS-R-131)"
    ],
    provider: "Salesforce",
    governanceTier: "benefits-verification"
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
      "formulary-review-agent",
      "fwa-detection-agent",
      "trial-payments-agent",
      "utilization-review-agent",
      "care-coordination-handoff-agent",
      "adverse-event-reporting-agent",
      "data-sharing-tefca-agent",
      "risk-adjustment-agent",
      "master-patient-index-agent",
      "break-the-glass-agent",
      "records-retention-agent",
      "deidentification-agent",
      "coordination-of-benefits-agent",
      "overpayment-recovery-agent",
      "financial-assistance-agent",
      "lab-result-agent",
      "good-faith-estimate-agent",
      "balance-billing-agent",
      "immunization-agent",
      "minimum-necessary-agent",
      "audit-log-integrity-agent",
      "timely-filing-agent",
      "controlled-substance-agent",
      "advance-beneficiary-notice-agent",
      "accounting-of-disclosures-agent",
      "subrogation-agent",
      "right-of-access-agent",
      "member-cost-share-agent",
      "amendment-request-agent",
      "information-blocking-agent",
      "drug-interaction-agent",
      "enrollment-reconciliation-agent",
      "care-pathway-agent",
      "coverage-continuity-agent",
      "access-anomaly-agent",
      "caseload-balancing-agent",
      "schedule-conflict-agent",
      "medication-name-safety-agent",
      "claim-lifecycle-agent",
      "household-composition-agent",
      "network-adequacy-agent",
      "pcp-matching-agent",
      "reportable-condition-agent",
      "timeline-merge-agent",
      "quality-shift-agent"
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
    id: "policy.fwa.pattern-catalog-sourced",
    name: "FWA flags must trace to the pattern catalog",
    description:
      "Every FWA flag the Fraud, Waste & Abuse Detection Agent raises must cite a pattern on FWA_PATTERNS (unbundling, upcoding, duplicate-billing, quantity-outlier, impossible-day-billing, phantom-service) — a fabricated 'we-just-don't-like-this-provider' flag or category-of-one pattern is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the Formulary Agent's catalog-sourced, the ACP Agent's directive-source-integrity, and the CCM Agent's eligibility-catalog-sourced posture — an integrity property enforced, not merely advised. (In the prototype the pattern catalog is a clearly-labeled illustrative synthetic; in production this is the customer's governed SIU rule set.)",
    appliesTo: ["fwa-detection-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.fwa.no-autonomous-denial",
    name: "No autonomous denial / investigation / payment freeze",
    description:
      "The Fraud, Waste & Abuse Detection Agent may NEVER autonomously deny a claim, open an investigation, or freeze payment — every flagged claim goes to SIU (Special Investigations Unit) HUMAN review. Every report is requiresSiuReview:true (when flagged) / investigationOpened:false / paymentFrozen:false; a caller-asserted plan that claims any of those true is rejected before it can leave the fabric. Denying a claim on unproven suspicion is a Section 1557 / state insurance code / due-process failure — payers cannot deny claims on suspicion without notice + appeal rights. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the PA Agent's no-autonomous-submission, and the CCM Agent's no-autonomous-billing posture — the agent surfaces suspicion; humans investigate.",
    appliesTo: ["fwa-detection-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.fwa.no-protected-class-factors",
    name: "FWA detection must not use protected-class factors",
    description:
      "The Fraud, Waste & Abuse Detection Agent's pattern-detection engine may NEVER score on protected-class attributes (race, ethnicity, gender identity, religion, national origin, disability status, sexual orientation, marital status) or provider-demographic proxies (provider race/ethnicity, clinic-neighborhood race composition) — a factor list including any of these is rejected before it can leave the fabric. Bias in FWA is a well-documented compliance failure: multiple algorithmic-audit reports have found payer systems that disproportionately targeted minority-owned clinics, and the audit results led to consent decrees. Mirrors the Population Health Agent's no-protected-class-factors posture — a fairness / responsible-AI requirement, enforced not merely advised.",
    appliesTo: ["fwa-detection-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trial-payments.schedule-catalog-sourced",
    name: "Trial payments must trace to the IRB-approved schedule catalog",
    description:
      "Every clinical-trial payment the Trial Payments & Stipends Agent issues must trace to the defined TRIAL_PAYMENT_SCHEDULES catalog (trial + IRB approval ref) AND to a defined visit type on TRIAL_VISIT_TYPES AND to an applied rule on TRIAL_PAYMENT_RULES — an ad-hoc / off-catalog payment is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the Formulary Agent's catalog-sourced, and the FWA Agent's pattern-catalog-sourced posture. (In the prototype the schedule catalog is a clearly-labeled illustrative synthetic; in production this is the sponsor's IRB-approved payment protocol.)",
    appliesTo: ["trial-payments-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trial-payments.no-autonomous-irb-deviation",
    name: "No autonomous IRB deviation",
    description:
      "The Trial Payments & Stipends Agent may NEVER autonomously deviate from an IRB-approved payment schedule — every non-standard payment (missed visit, out-of-range travel, extra procedure) requires study-coordinator cosign. Every non-schedule-approved decision is requiresCoordinatorCosign:true / cosigned:false; a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. IRB deviations are a research-ethics failure that could invalidate the study. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, and the FWA Agent's no-autonomous-denial posture.",
    appliesTo: ["trial-payments-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.trial-payments.participant-consented",
    name: "Trial payments require participant informed consent",
    description:
      "The Trial Payments & Stipends Agent may NEVER issue a payment to a participant whose research-payment informed consent is not on file (or has been withdrawn) — this is a Common Rule / 45 CFR 46 requirement. When consent is missing, the safe answer is decision:'blocked-no-consent' with zero payment; a payment approved without consent is rejected before it can leave the fabric. Payments to non-consented participants are a serious research-ethics violation.",
    appliesTo: ["trial-payments-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ur.criteria-catalog-sourced",
    name: "UR decisions must trace to the criteria catalog",
    description:
      "Every utilization-review decision the Utilization Review Agent issues must trace to the defined UR_SERVICE_TYPES catalog (service type + criteria set) AND to applied rules on UR_RULES AND to reason codes on UR_REASON_CODES — an off-catalog / ad-hoc / fabricated criterion or rule is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the Formulary Agent's catalog-sourced, the FWA Agent's pattern-catalog-sourced, and the Trial Payments Agent's schedule-catalog-sourced posture. (In the prototype the criteria catalog is a clearly-labeled illustrative synthetic; in production this is the customer's licensed MCG / InterQual criteria set — the agent may not invent medical-necessity requirements.)",
    appliesTo: ["utilization-review-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ur.no-autonomous-denial",
    name: "No autonomous UR denial — clinician cosign required",
    description:
      "The Utilization Review Agent may NEVER autonomously finalize a non-approved decision — every pend-for-clinical-review or require-peer-to-peer decision requires clinician cosign. Every non-approved decision is requiresClinicianCosign:true / cosigned:false; a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. UR denial letters are legally consequential under Medicare Advantage / state utilization-review-agent codes with notice + due-process rights, and denying medical necessity on the agent's own authority is a Section 1557 / state-code violation. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, the FWA Agent's no-autonomous-denial, and the Trial Payments Agent's no-autonomous-irb-deviation posture.",
    appliesTo: ["utilization-review-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ur.sla-integrity",
    name: "UR SLA deadlines must trace to the urgency catalog + received date",
    description:
      "Every Utilization Review case deadline must trace to the catalog urgency window (standard 72h, urgent 24h, concurrent-review 24h) applied against the received asOfDate — a deadline that doesn't match the catalog OR one that has been silently extended past the regulatory maximum is rejected before it can leave the fabric. Silently extending a UR deadline breaches Medicare Advantage Chapter 4 / state utilization-review-agent timelines. Mirrors the Grievance & Appeals Agent's deadline-integrity posture.",
    appliesTo: ["utilization-review-agent"],
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
    id: "policy.riskadj.evidence-supported-coding",
    name: "HCC coding must trace to documented clinical evidence (no upcoding)",
    description:
      "Every confirmed / suspected HCC the Risk Adjustment & HCC Coding Agent reports must trace to the documented clinical evidence in the supporting-evidence catalog that supports it — a fabricated / unsupported code PRESENTED AS supported (an off-catalog HCC, or a confirmed / suspected HCC whose evidence doesn't cover the catalog's required set) is rejected before it can leave the fabric, so the agent can never upcode by asserting a condition the record does not support. A coding gap (a suspected HCC — clinical evidence documented but no diagnosis code on the claim) and an unsupported / over-coded flag (a code on the claim but the evidence not documented) are SAFE, honest OUTPUTS surfaced for a clinician to validate / correct — NOT blocks; the block is only for presenting an unsupported code as supported. Mirrors the Care Gap Closure Agent's clinical-measure-sourced, the HEDIS Agent's measure-catalog-sourced, and the Clinical Trials Agent's eligibility-criteria-sourced integrity posture. (In the prototype the HCC catalog + RAF weights + supporting-evidence catalog are clearly-labeled illustrative synthetics — NOT the certified CMS-HCC model, real RAF coefficients, or an ICD-10 → HCC crosswalk; in production this is the customer's licensed risk-adjustment model.)",
    appliesTo: ["risk-adjustment-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.riskadj.clinician-validation-required",
    name: "Suspected codes require clinician validation",
    description:
      "Every suspected risk-adjustment code the Risk Adjustment & HCC Coding Agent produces is a RECOMMENDATION only and requires a human clinician to validate it before use — a suspected code finalized / submitted without clinician validation is rejected before it can leave the fabric. The agent may only surface a suspected code for clinician validation, never treat it as a confirmed, reimbursable code on its own. Mirrors the Prior Authorization Agent's no-autonomous-submission clinician-approval gate and the HEDIS Agent's no-autonomous-submission posture — a human-in-the-loop requirement enforced, not merely advised.",
    appliesTo: ["risk-adjustment-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.riskadj.no-autonomous-submission",
    name: "No autonomous code submission or claim adjustment",
    description:
      "The Risk Adjustment & HCC Coding Agent may NEVER autonomously submit risk-adjustment codes or adjust a claim / RAF for reimbursement — it is a recommender + integrity checker, so a caller-asserted autonomous submission / claim adjustment is rejected before it can leave the fabric. Every assessment is submitted:false; a code submission is a human action taken after clinician validation, never the agent's. Mirrors the Prior Authorization Agent's no-autonomous-submission, the HEDIS Agent's no-autonomous-submission, and the Complex Care Management Agent's no-autonomous-billing posture — the agent proposes, a human files.",
    appliesTo: ["risk-adjustment-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mpi.transparent-matching",
    name: "Identity matching must trace to a transparent, documented feature spec",
    description:
      "Every match decision the Master Patient Index / Identity Resolution Agent makes must trace to the documented match-feature spec — a transparent, additive/weighted function of a defined demographic feature set (name, DOB, member/MRN identifier, address, phone, administrative sex), each candidate's classification explainable by citing its matched features. It may not resolve identity on an opaque / black-box / off-spec score. A match that doesn't trace to the defined features (an off-catalog feature, a score that doesn't sum from its matched features, or a classification that doesn't follow from the thresholds) is rejected before any link / merge is acted on, so the agent can never merge patients on an unexplainable score. (In the prototype the match features + weights + thresholds are clearly-labeled illustrative synthetics, NOT a certified EMPI algorithm; in production this is the customer's governed, validated identity-resolution model.)",
    appliesTo: ["master-patient-index-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mpi.no-autonomous-merge",
    name: "No autonomous merge — a merge below the auto threshold requires a human steward",
    description:
      "The Master Patient Index / Identity Resolution Agent may recommend a link / merge, but a merge below the auto-match threshold may NOT be performed autonomously — it requires a human steward to review. A resolution that would merge / link a pair whose best match is below the auto-match threshold without requiring human review (an autonomous merge) is rejected before it can leave the fabric; there is never an 'auto-merged' state, and the agent never autonomously merges a low-confidence pair. A possible-match is a manual-review recommendation with requiresHumanReview:true (a safe answer, not a block). Mirrors the Population Health Agent's no-autonomous-care-decision and the Remote Patient Monitoring Agent's no-autonomous-escalation posture — the safe answer is enforced, not merely advised.",
    appliesTo: ["master-patient-index-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mpi.no-protected-class-matching",
    name: "No protected-class attributes as matching features (fairness / responsible-AI)",
    description:
      "The Master Patient Index / Identity Resolution Agent's matching feature set may NOT use a protected-class attribute (race, ethnicity, religion, national origin, gender identity, sexual orientation, disability status, marital status) as a matching feature — a fairness / responsible-AI requirement. A feature set that asserts a protected-class attribute was used as a matching feature is rejected before any resolution is acted on; identity matching may use only permitted demographic / administrative identifiers. This keeps identity resolution defensible against discriminatory-matching concerns. (Distinct from the Population Health Agent's no-protected-class-factors — this governs the identity-matching feature set, not a risk model.)",
    appliesTo: ["master-patient-index-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.btg.justification-required",
    name: "No emergency access without a recorded clinical justification",
    description:
      "The Break-the-Glass / Emergency Access Governance Agent may NEVER grant emergency override access to PHI without a recorded, non-empty clinical justification — an asserted-but-unjustified break-the-glass grant is rejected before any access can leave the fabric, so the authoritative emergency-access log can never hold access it can't evidence with a documented clinical reason. A DENY for a missing justification is a safe completed answer; the block fires only on a granted access that carries no recorded justification. (In the prototype the purpose catalog + scopes + audit ids are clearly-labeled illustrative synthetics, not a certified break-the-glass system; in production this is the customer's governed emergency-access control with a signed audit trail.)",
    appliesTo: ["break-the-glass-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.btg.minimum-necessary-time-boxed",
    name: "Every emergency grant must be minimum-necessary and time-boxed",
    description:
      "An emergency grant the Break-the-Glass / Emergency Access Governance Agent issues must be scoped to a MINIMUM-NECESSARY field set AND TIME-BOXED with a derived expiry — never a standing / broad / full-record / non-expiring grant. A grant that would open the full chart (an over-broad or full-record scope) or grant access with no expiry is rejected before it can leave the fabric, so a break-the-glass override can never become a standing back-door into the record. This is the HIPAA §164.502 minimum-necessary property enforced, not merely advised. Mirrors the Master Patient Index Agent's no-autonomous-merge and the Population Health Agent's no-autonomous-care-decision posture — the safe answer is enforced. (In the prototype the minimum-necessary scopes + access durations are clearly-labeled illustrative synthetics; in production this is the customer's governed minimum-necessary determination.)",
    appliesTo: ["break-the-glass-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.btg.mandatory-audit-review",
    name: "Every emergency access must be logged and post-access reviewed",
    description:
      "Every emergency access the Break-the-Glass / Emergency Access Governance Agent grants must emit a mandatory audit event AND be flagged for mandatory post-access review — there is no un-audited break-the-glass access. A granted access that is not logged or not flagged for post-access review is rejected before it can leave the fabric, so a break-the-glass override always leaves a reviewable trail. This is the HIPAA §164.312 audit-controls property enforced, not merely advised. (In the prototype the audit-event ids are clearly-labeled illustrative synthetics, not a certified tamper-evident audit trail; in production this exports to the customer's SIEM via MuleSoft with a signed audit trail.)",
    appliesTo: ["break-the-glass-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.retention.legal-hold-overrides-purge",
    name: "A legal hold always overrides a purge",
    description:
      "The Data Retention & Records Lifecycle Management Agent may NEVER mark a record under an active legal hold as eligible-for-purge (or assert a purge of a held record) — a legal hold ALWAYS overrides a purge, so a held record is retained on `hold`, never eligible-for-purge, no matter how far past its retention expiry it is. A disposition that would purge a record on legal hold is rejected before it can leave the fabric, so the fabric can never authorize spoliation of evidence under a preservation obligation. This is the legal-hold / litigation-hold property enforced, not merely advised. (In the prototype the retention schedules + rule ids are clearly-labeled illustrative synthetics, not a certified records-management system; real retention is jurisdiction-specific and legally reviewed.)",
    appliesTo: ["records-retention-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.retention.schedule-sourced",
    name: "Every disposition must cite a recorded retention schedule",
    description:
      "Every records-disposition decision (retain / eligible-for-purge / hold) the Data Retention & Records Lifecycle Management Agent produces must cite a recorded retention rule from the schedule catalog — there is no ad-hoc, un-sourced disposition. A disposition with a missing or off-catalog retention rule is rejected before it can leave the fabric, so the records-lifecycle log can never hold a disposition it can't evidence with a defined schedule. Mirrors the Master Patient Index Agent's transparent-matching and the HEDIS Agent's measure-catalog-sourced posture — every decision traces to a defined source. (In the prototype the retention schedules are clearly-labeled illustrative synthetics; in production this is the customer's legally-reviewed, jurisdiction-specific retention schedule.)",
    appliesTo: ["records-retention-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.retention.no-autonomous-purge",
    name: "A purge is never autonomous — it is human-approval-gated",
    description:
      "The Data Retention & Records Lifecycle Management Agent may NEVER execute a destructive purge autonomously — an eligible-for-purge disposition is a RECOMMENDATION requiring human approval (requiresHumanApproval:true), and a purge only happens after a human approves it. A disposition that asserts an autonomous / unapproved purge is rejected before it can leave the fabric, so a records-retention recommendation can never become an unattended deletion. Mirrors the Master Patient Index Agent's no-autonomous-merge, the Break-the-Glass Agent's minimum-necessary-time-boxed, and the Population Health Agent's no-autonomous-care-decision posture — the safe answer is enforced. (In the prototype the schedules + periods are clearly-labeled illustrative synthetics; in production this is the customer's governed records-disposition workflow with a human-in-the-loop approval + a signed audit trail.)",
    appliesTo: ["records-retention-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.deid.all-categories-screened",
    name: "A de-identification screen must cover all eighteen Safe Harbor categories",
    description:
      "Every de-identification determination the De-Identification & Safe Harbor Agent produces must screen ALL EIGHTEEN HIPAA Safe Harbor identifier categories (45 CFR 164.514(b)(2)) — every category must be accounted for, either present as a field or explicitly attested absent. A determination whose screen skips a category is rejected before it can leave the fabric, because an un-screened category may hide a re-identifying identifier, so a dataset can never be claimed de-identified against an incomplete screen. This is the load-bearing completeness gate — it mirrors the Good Faith Estimate Agent's expected-items-complete and the Lab Result Agent's critical-value-notified: a completeness obligation that cannot be skipped. (In the prototype the category catalog is a clearly-labeled illustrative synthetic; in production this is the full Safe Harbor method including the actual-knowledge clause.)",
    appliesTo: ["deidentification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.deid.method-cited",
    name: "A de-identification decision must cite a recognized method",
    description:
      "Every de-identification determination the De-Identification & Safe Harbor Agent produces must cite a recognized method — either HIPAA Safe Harbor (§164.514(b)(2)) or a qualified Expert Determination with a cited determination reference (§164.514(b)(1)) — there is no ad-hoc, un-cited de-identification. A determination with an un-recognized method, or an expert determination that cites no reference, is rejected before it can leave the fabric, so a de-identification claim can never rest on an undocumented method. Mirrors the Data Retention Agent's schedule-sourced and the Balance Billing Agent's protection-basis-sourced posture — every decision traces to a defined method. (In the prototype the method handling is a clearly-labeled illustrative synthetic; in production this is the customer's governed de-identification method + expert-determination record.)",
    appliesTo: ["deidentification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.deid.no-release-of-reidentifiable",
    name: "A re-identifiable dataset is never released as de-identified",
    description:
      "The De-Identification & Safe Harbor Agent may NEVER mark a dataset de-identified / release-approved while an identifier category still remains (a retained identifier, or a generalization that does not satisfy Safe Harbor) — a re-identifiable dataset is NOT de-identified and may never be released as de-identified. A determination that asserts a remaining identifier alongside a de-identified / released dataset is rejected before it can leave the fabric, so re-identifiable data can never leave the fabric labeled de-identified; releasing re-identifiable data requires human review under a data use agreement (requiresHumanReview:true). Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Master Patient Index Agent's no-autonomous-merge posture — the harmful action is enforced-off. (In the prototype the category catalog + generalization rules are clearly-labeled illustrative synthetics; in production this is the customer's governed de-identification workflow with a human-in-the-loop review + a signed audit trail.)",
    appliesTo: ["deidentification-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.immunization.schedule-sourced",
    name: "Every vaccine recommendation must cite a recorded schedule rule",
    description:
      "Every per-vaccine forecast the Immunization Forecasting Agent produces must cite a recorded ACIP schedule rule from the catalog — there is no ad-hoc, un-sourced vaccine recommendation. A forecast with a missing or off-catalog rule id is rejected before it can leave the fabric, so an immunization recommendation can never rest on anything other than a defined schedule rule. Mirrors the Lab Result Agent's reference-range-sourced and the Data Retention Agent's schedule-sourced posture — every decision traces to a defined source. (In the prototype the schedule catalog is a clearly-labeled illustrative synthetic; in production this is the current ACIP recommendations + CDC immunization schedules.)",
    appliesTo: ["immunization-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.immunization.contraindication-honored",
    name: "A contraindicated vaccine is never recommended",
    description:
      "The Immunization Forecasting Agent may NEVER recommend (due / overdue) a vaccine for which the patient has a recorded contraindication — a contraindicated vaccine is withheld and flagged for clinician review, never recommended. A forecast that recommends a contraindicated vaccine is rejected before it can leave the fabric, so the fabric can never surface a recommendation that would endanger the patient. This is the load-bearing patient-safety gate — it mirrors the Lab Result Agent's critical-value-notified: a clinical-safety obligation that cannot be skipped. (In the prototype the schedule + contraindication handling are clearly-labeled illustrative synthetics; in production this is the current ACIP contraindications + the patient's full clinical context.)",
    appliesTo: ["immunization-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.immunization.no-autonomous-administration",
    name: "A vaccine is never autonomously administered — it is clinician-order-gated",
    description:
      "The Immunization Forecasting Agent may NEVER administer, order, or record a vaccine autonomously — a due / overdue vaccine is a RECOMMENDATION requiring a clinician order (requiresClinicianOrder:true). A determination that reports due / overdue vaccines but does not require a clinician order is rejected before it can leave the fabric, so an immunization forecast can never become an unattended administration. Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Balance Billing Agent's no-autonomous-balance-bill posture — the safe answer is enforced. (In the prototype the schedule + intervals are clearly-labeled illustrative synthetics; in production this is the customer's governed immunization workflow with a clinician order + a signed audit trail.)",
    appliesTo: ["immunization-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.minnec.purpose-of-use-sourced",
    name: "Every disclosure decision must cite a recorded purpose-of-use",
    description:
      "Every determination the Minimum Necessary Agent produces must cite a recorded purpose-of-use rule from the catalog — there is no ad-hoc, un-sourced disclosure. A determination with a missing or off-catalog purpose id is rejected before it can leave the fabric, so a PHI disclosure can never rest on anything other than a defined purpose-of-use. Mirrors the De-Identification Agent's method-cited and the Data Retention Agent's schedule-sourced posture — every decision traces to a defined source. (In the prototype the purpose-of-use catalog is a clearly-labeled illustrative synthetic; in production this is the covered entity's role-based access policies under 45 CFR 164.502(b) / 164.514(d).)",
    appliesTo: ["minimum-necessary-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.minnec.minimum-necessary-scoped",
    name: "A released field is never beyond the minimum-necessary scope",
    description:
      "The Minimum Necessary Agent may NEVER release a field whose category is beyond what the stated purpose-of-use permits — every released field must be within the purpose's allowed categories (unless the purpose is minimum-necessary exempt: treatment, disclosure to the individual, an authorized disclosure, or one required by law). A determination that releases an out-of-scope field is rejected before it can leave the fabric, so the fabric can never over-disclose PHI beyond the minimum necessary. This is the load-bearing privacy gate — it mirrors the De-Identification Agent's no-release-of-reidentifiable: a privacy obligation that cannot be skipped. (In the prototype the purpose + category mappings are clearly-labeled illustrative synthetics; in production this is the covered entity's minimum-necessary standard under 45 CFR 164.502(b) / 164.514(d).)",
    appliesTo: ["minimum-necessary-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.minnec.no-autonomous-over-disclosure",
    name: "An over-scope / bulk disclosure is never autonomously released",
    description:
      "The Minimum Necessary Agent may NEVER autonomously release an over-scope (narrowed) or bulk / cohort disclosure — a request that is not minimum-necessary as submitted (fields had to be withheld) or that is a bulk / cohort scope is a RECOMMENDATION requiring human review (requiresHumanReview:true). A determination that is not-minimum-necessary or bulk but does not require human review is rejected before it can leave the fabric, so an over-broad or bulk PHI disclosure can never become an unattended release. Mirrors the De-Identification Agent's no-release-of-reidentifiable and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off. (In the prototype the purpose + scope rules are clearly-labeled illustrative synthetics; in production this is the customer's governed disclosure workflow with a human-in-the-loop review + a signed audit trail.)",
    appliesTo: ["minimum-necessary-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.auditlog.hash-chain-verified",
    name: "An audit log is never marked verified over a broken hash chain",
    description:
      "The Audit Log Integrity Agent may NEVER mark a log VERIFIED while its hash chain is not intact — every entry's recomputed hash must match and every link's prevHash must match the prior entry's hash. A determination that asserts a verified log over a broken chain is rejected before it can leave the fabric, so tampering can never be hidden behind a verified label. Mirrors the Minimum Necessary Agent's minimum-necessary-scoped posture — an integrity obligation that cannot be skipped. (In the prototype the hash is a clearly-labeled illustrative non-cryptographic FNV-1a; in production this is a cryptographic hash — SHA-256 — over an append-only / WORM store with signed checkpoints.)",
    appliesTo: ["audit-log-integrity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.auditlog.sequence-complete",
    name: "An audit log is never marked verified with a sequence gap",
    description:
      "The Audit Log Integrity Agent may NEVER mark a log VERIFIED while its sequence numbers are not contiguous — a gap means an entry was deleted, which the hash chain alone would not catch if the deletion were at the tail. A determination that asserts a verified log with a sequence gap is rejected before it can leave the fabric, so a deleted audit record can never be hidden behind a verified label. This is the load-bearing completeness gate for a tamper-evident audit trail. (In the prototype the sequence check is a clearly-labeled illustrative synthetic; in production this is enforced by an append-only, monotonically-sequenced audit store.)",
    appliesTo: ["audit-log-integrity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.auditlog.no-autonomous-redaction",
    name: "An audit log is never autonomously redacted or repaired",
    description:
      "The Audit Log Integrity Agent may NEVER delete, rewrite, re-seal, or otherwise 'repair' an audit entry — it VERIFIES and FLAGS only; a broken log is flagged for human forensic review (requiresForensicReview:true). A determination that claims it repaired / mutated the log is rejected before it can leave the fabric, so the audit trail — the evidence — can never be altered by the agent that checks it. Mirrors the Data Retention Agent's no-autonomous-purge and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off. (In the prototype the entries are clearly-labeled illustrative synthetics; in production this is the customer's append-only audit store with a human-in-the-loop forensic workflow.)",
    appliesTo: ["audit-log-integrity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timelyfiling.filing-limit-sourced",
    name: "Every timeliness decision cites a recorded filing-limit rule",
    description:
      "The Timely Filing Agent may NEVER decide a claim's timeliness without citing a recorded payer filing-limit rule from the catalog — a missing or off-catalog rule id is an ad-hoc / un-sourced limit and is not a real deadline. A determination with no recorded rule is rejected before it can leave the fabric. Mirrors the Overpayment Recovery Agent's reason-catalog-sourced and the Data Retention Agent's schedule-sourced posture. (In the prototype the filing-limit catalog is a clearly-labeled illustrative synthetic; in production the limit comes from the payer's provider contract, Medicare / Medicaid rules, and state prompt-pay law.)",
    appliesTo: ["timely-filing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timelyfiling.deadline-computed",
    name: "The filing deadline is computed, never guessed",
    description:
      "The Timely Filing Agent's stated deadline may NEVER differ from the computed date of service + the rule's limit in days — a guessed / hidden deadline is how a claim is wrongly called timely or untimely. A determination whose deadline does not match the recomputed deadline is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Good Faith Estimate Agent's math-consistent posture. (Time is taken as data — no clock; the deadline is a pure function of the date of service + the limit days.)",
    appliesTo: ["timely-filing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timelyfiling.no-autonomous-write-off",
    name: "An untimely claim is never autonomously written off",
    description:
      "The Timely Filing Agent may NEVER autonomously write off an untimely claim, adjust it to zero, or bill the patient — an untimely claim is a RECOMMENDATION (file an appeal with a recognized exception, or route to a write-off decision) requiring human review (requiresHumanReview:true). A determination that marks a claim written-off, or that reports an untimely claim without requiring human review, is rejected before it can leave the fabric. Mirrors the Overpayment Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off. (In the prototype the disposition is a clearly-labeled illustrative synthetic; in production the write-off / appeal workflow is the plan's / provider's human-in-the-loop process.)",
    appliesTo: ["timely-filing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.controlledsubstance.guideline-sourced",
    name: "Every controlled-substance risk finding cites a recorded guideline",
    description:
      "The Controlled Substance Agent may NEVER produce a risk finding without citing a recorded guideline from the catalog — a missing or off-catalog guideline id is an ad-hoc / un-sourced MME threshold and is not a real clinical standard. A determination with no recorded guideline is rejected before it can leave the fabric. Mirrors the Immunization Agent's schedule-sourced and the Lab Result Agent's reference-range-sourced posture. (In the prototype the guideline catalog is a clearly-labeled illustrative synthetic; in production the thresholds come from the CDC 2022 Clinical Practice Guideline for Prescribing Opioids and the state PDMP.)",
    appliesTo: ["controlled-substance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.controlledsubstance.mme-computed",
    name: "The total MME/day is computed, never guessed",
    description:
      "The Controlled Substance Agent's stated total MME/day may NEVER differ from the computed proposed opioid contribution + the concurrent opioid MME/day — a guessed / hidden dose is how an over-threshold prescription is wrongly called safe. A determination whose total does not match the recomputed sum is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Timely Filing Agent's deadline-computed and the Good Faith Estimate Agent's math-consistent posture. (The MME figures are illustrative — a real screen uses the CDC MME conversion factors — but the SUM is always exact.)",
    appliesTo: ["controlled-substance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.controlledsubstance.no-autonomous-prescribing-decision",
    name: "A controlled-substance risk finding never makes an autonomous prescribing decision",
    description:
      "The Controlled Substance Agent may NEVER autonomously approve, deny, dispense, or write a prescription — a risk finding is a RECOMMENDATION requiring prescriber review (requiresPrescriberReview:true for any elevated / high-risk finding). A determination that auto-decides (autoDecision:true), or that reports an elevated / high-risk finding without requiring prescriber review, is rejected before it can leave the fabric. Mirrors the Immunization Agent's no-autonomous-administration and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off. (In the prototype the PDMP history is a clearly-labeled illustrative synthetic; in production the prescribing decision is the prescriber's, informed by the state PDMP.)",
    appliesTo: ["controlled-substance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ddi.interaction-sourced",
    name: "Every reported drug interaction traces to the recorded knowledge base",
    description:
      "The Drug Interaction Agent may NEVER report an interaction that is off-catalog, or dress a mismatched severity onto a recorded interaction — every flagged interaction must resolve in the recorded knowledge base with a matching drug pair + severity, because a fabricated interaction erodes clinician trust and drives alert fatigue. A determination that reports an off-catalog or mismatched interaction is rejected before it can leave the fabric. Mirrors the Controlled Substance Agent's guideline-sourced and the Immunization Agent's schedule-sourced posture. (In the prototype the interaction knowledge base is a clearly-labeled illustrative synthetic; in production it is a maintained drug-interaction compendium.)",
    appliesTo: ["drug-interaction-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ddi.severity-consistent",
    name: "The overall severity is consistent with the detected interactions",
    description:
      "The Drug Interaction Agent's overall severity must equal the highest cataloged severity among the detected interactions — an INFLATED severity drives wrongful order cancellation and alert fatigue, and a SUPPRESSED severity hides a contraindication. A determination whose overall severity fails the recomputation from the detected interactions' catalog records is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the OIG Exclusion Agent's match-not-overstated posture.",
    appliesTo: ["drug-interaction-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.ddi.no-autonomous-hold-or-override",
    name: "The order is never autonomously held or the alert overridden",
    description:
      "The Drug Interaction Agent may NEVER hold / cancel the order (autoHeldOrder:true — which could deny needed therapy), override the interaction alert (autoOverrodeAlert:true — which could push through a contraindicated combination), or skip clinician review (requiresClinicianReview:true) — the agent SCREENS, and every finding is a RECOMMENDATION requiring a pharmacist / prescriber to act on or review. A determination that auto-holds / auto-overrides, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Controlled Substance Agent's no-autonomous-prescribing-decision and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off.",
    appliesTo: ["drug-interaction-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mlr.inputs-sourced",
    name: "The applicable MLR standard traces to the recorded market catalog",
    description:
      "The MLR Rebate Agent may NEVER apply a standard that is off-catalog or does not match its market — the applicable standard (80% individual / small-group, 85% large-group) must resolve in the recorded MLR_STANDARDS catalog for the market, because a mis-stated standard wrongly triggers or wrongly avoids a rebate. A determination that applies an off-catalog or mismatched standard is rejected before it can leave the fabric. Mirrors the Member Cost-Share Agent's benefit-design-sourced and the Good Faith Estimate Agent's charge-master-sourced posture. (In the prototype the standards + formula are clearly-labeled illustrative synthetics; in production MLR reporting is governed by 45 CFR Part 158.)",
    appliesTo: ["mlr-rebate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mlr.allocation-consistent",
    name: "The MLR, the rebate, and the apportionment are exact",
    description:
      "The MLR Rebate Agent's MLR must equal (claims + quality improvement) / (earned premium − taxes & fees), its total rebate must equal max(0, standard − MLR) × earned premium, and the per-subscriber allocations must sum EXACTLY (to the penny) to the total rebate with every allocation non-negative. A rebate that doesn't add up, or an apportionment that loses / invents pennies, is a compliance and accounting defect and is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the Risk Adjustment Agent's score-consistent posture.",
    appliesTo: ["mlr-rebate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.mlr.no-autonomous-disbursement",
    name: "The rebate is never autonomously disbursed",
    description:
      "The MLR Rebate Agent may NEVER disburse / pay a rebate on its own (autoDisbursed:true — a movement of money to members that must be authorized) or skip treasury review (requiresTreasuryReview:true) — the agent CALCULATES, and every determination is a RECOMMENDATION requiring a treasury / compliance reviewer to confirm and issue payment. A determination that auto-disburses, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the OIG Exclusion Agent's no-autonomous-block-or-clear posture — the harmful action is enforced-off.",
    appliesTo: ["mlr-rebate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.enrollment.reconciliation-complete",
    name: "The reconciliation accounts for every member exactly once",
    description:
      "The Enrollment Reconciliation Agent must account for EVERY member present in either roster EXACTLY once — the per-kind counts must sum to the number of actions, the total-members count must equal the number of actions, the counts must match the actual per-kind tallies, and no member may appear twice. A reconciliation that drops, duplicates, or miscounts a member (a terminated employee who keeps coverage, or a new hire who never gets enrolled) is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent posture.",
    appliesTo: ["enrollment-reconciliation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.enrollment.actions-sourced",
    name: "Every reconciliation action is sourced — no fabricated discrepancy",
    description:
      "The Enrollment Reconciliation Agent's every UPDATE action must carry at least one genuinely-differing field (each listed delta's source value actually differs from its carrier value), and every NO-CHANGE / ENROLL / TERMINATE must carry none. A fabricated discrepancy (an 'update' whose fields don't actually differ, or a 'no-change' that hides a real difference) drives wrong enrollment writes and is rejected before it can leave the fabric. Mirrors the OIG Exclusion Agent's match-not-overstated and the Drug Interaction Agent's interaction-sourced posture.",
    appliesTo: ["enrollment-reconciliation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.enrollment.no-autonomous-change",
    name: "An enrollment change is never autonomously applied",
    description:
      "The Enrollment Reconciliation Agent may NEVER apply an enrollment change to the system of record (autoApplied:true — enrolling / terminating / updating a member is a coverage decision that must be authorized) or skip benefits-admin review (requiresBenefitsAdminReview:true) — the agent RECONCILES, and every determination is a RECOMMENDATION requiring a benefits administrator to confirm and post. A determination that auto-applies, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the MLR Rebate Agent's no-autonomous-disbursement posture — the harmful action is enforced-off.",
    appliesTo: ["enrollment-reconciliation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pathway.steps-sourced",
    name: "Every sequenced step is sourced — no fabricated step",
    description:
      "The Care Pathway Sequencing Agent's every step id appearing in the output — the ordered sequence, the stage map, the reported cycle members, the missing-prerequisite holders — must reference a step actually submitted in the pathway. A fabricated / dangling step id would order or flag care that doesn't exist and is rejected before it can leave the fabric. Mirrors the Drug Interaction Agent's interaction-sourced and the Enrollment Reconciliation Agent's actions-sourced posture.",
    appliesTo: ["care-pathway-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pathway.sequence-valid",
    name: "The sequence respects every prerequisite",
    description:
      "The Care Pathway Sequencing Agent's determination must be consistent with its steps — when reported SEQUENCED, the ordered steps must be a complete permutation of the pathway's steps (none dropped or duplicated) and every step must appear AFTER all of its prerequisites (ordering a treatment step before its safety-screening prerequisite is the worst failure mode); when reported un-sequenceable (a dependency cycle or a missing prerequisite), no order may be asserted. A sequence that violates a prerequisite, drops a step, or asserts an impossible order is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the Enrollment Reconciliation Agent's reconciliation-complete posture.",
    appliesTo: ["care-pathway-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pathway.no-autonomous-execution",
    name: "A pathway step is never autonomously executed",
    description:
      "The Care Pathway Sequencing Agent may NEVER execute / order / administer a step on its own (autoExecuted:true — ordering a lab, a screening, or a therapy is a clinical action that must be authorized) or skip clinician review (requiresClinicianReview:true) — the agent SEQUENCES, and every determination is a RECOMMENDATION requiring a clinician to confirm and order. A determination that auto-executes, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Drug Interaction Agent's no-autonomous-hold-or-override and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off.",
    appliesTo: ["care-pathway-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.coverage.segments-sourced",
    name: "Every merged coverage span is sourced — no fabricated coverage",
    description:
      "The Creditable Coverage Continuity Agent's every merged span must trace to submitted segments — each span's start / end must come from a real segment boundary, and every submitted segment must fall within a merged span. Fabricated coverage (a span not backed by a segment) would wrongly certify continuity; dropped coverage would wrongly find a break. A determination with an unsourced span or a dropped segment is rejected before it can leave the fabric. Mirrors the Care Pathway Agent's steps-sourced and the Drug Interaction Agent's interaction-sourced posture.",
    appliesTo: ["coverage-continuity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.coverage.math-consistent",
    name: "The coverage math is exact",
    description:
      "The Creditable Coverage Continuity Agent's merged spans must be ordered + non-overlapping (each start ≤ end, strictly gapped from the previous), the total covered days must equal the sum of the spans' inclusive lengths, each reported gap must equal the exact day distance between consecutive spans, and the significant-break flag must equal whether any gap exceeds the threshold. A miscounted covered-day total, a mis-measured gap, or a break flag that doesn't match the threshold drives a wrong creditable-coverage determination and is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent posture.",
    appliesTo: ["coverage-continuity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.coverage.no-autonomous-determination",
    name: "A coverage determination is never autonomously issued",
    description:
      "The Creditable Coverage Continuity Agent may NEVER issue a creditable-coverage determination, deny a special enrollment, or impose a late-enrollment penalty on its own (autoDetermined:true — each is a coverage decision that must be authorized) or skip eligibility review (requiresEligibilityReview:true) — the agent MEASURES, and every determination is a RECOMMENDATION requiring an eligibility reviewer to confirm. A determination that auto-issues, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the MLR Rebate Agent's no-autonomous-disbursement posture — the harmful action is enforced-off.",
    appliesTo: ["coverage-continuity-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.events-sourced",
    name: "Every counted access is sourced — no fabricated access",
    description:
      "The Access Anomaly Detection Agent's every event in the reported peak window must trace to a submitted access event — the peak window's event ids must be a subset of the submitted events and its count must equal the number of those ids. A fabricated access (an event in the peak not backed by a submitted one) would manufacture a false anomaly; a phantom count would overstate the spike. A finding with an unsourced peak event or a mismatched count is rejected before it can leave the fabric. Mirrors the Coverage Continuity Agent's segments-sourced and the Audit Log Integrity Agent's hash-chain-verified posture.",
    appliesTo: ["access-anomaly-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.window-count-consistent",
    name: "The window count is exact",
    description:
      "The Access Anomaly Detection Agent's reported peak must be the true maximum number of events in any window of the configured length — recomputing the sliding-window peak from the events must reproduce the reported peak count, the peak window's events must all fall within a span of at most windowMinutes, and the anomaly flag must equal whether the peak exceeds the threshold. A miscounted peak, a window wider than the configured length, or an anomaly flag that doesn't match the threshold drives a wrong finding and is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Coverage Continuity Agent's math-consistent and the Audit Log Integrity Agent's sequence-complete posture.",
    appliesTo: ["access-anomaly-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.no-autonomous-action",
    name: "An access action is never autonomously taken",
    description:
      "The Access Anomaly Detection Agent may NEVER lock the actor's account, revoke their access, or discipline them on its own (autoLockedAccount:true / autoRevokedAccess:true — each is an access / employment action that must be authorized) or skip privacy review (requiresPrivacyReview:true) — the agent MEASURES, and every flag is a RECOMMENDATION requiring a privacy officer to review. A finding that auto-locks / auto-revokes, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Coverage Continuity Agent's no-autonomous-determination and the Audit Log Integrity Agent's no-autonomous-redaction posture — the harmful action is enforced-off.",
    appliesTo: ["access-anomaly-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.caseload.assignment-complete",
    name: "Every member is accounted for exactly once",
    description:
      "The Caseload Balancing Agent's allocation must account for EVERY submitted member exactly once — the assigned set and the waitlisted set must be disjoint and together cover every member (no dropped member, no double-assignment), and the reported counts must match. A dropped member is a patient who falls through the cracks with no manager owning their care; a double-assigned member is confused ownership. An allocation that drops or double-counts a member is rejected before it can leave the fabric. This is the completeness gate. Mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Accounting of Disclosures Agent's accountable-disclosures-complete posture.",
    appliesTo: ["caseload-balancing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.caseload.capacity-respected",
    name: "No manager is over capacity, and the loads add up",
    description:
      "The Caseload Balancing Agent's allocation must respect every manager's capacity — each manager's assigned acuity must equal the sum of their assigned members' acuities, must not exceed their capacity, and the remaining capacity must be exact; and every waitlisted member's acuity must exceed EVERY manager's final remaining capacity (a member waitlisted while a manager had room is a wrong, unsafe allocation). An over-loaded panel is a patient-safety risk. An allocation that over-loads a manager, miscounts a load, or waitlists a member who fit is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Access Anomaly Agent's window-count-consistent and the Member Cost-Share Agent's math-consistent posture.",
    appliesTo: ["caseload-balancing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.caseload.no-autonomous-assignment",
    name: "An assignment is never autonomously committed",
    description:
      "The Caseload Balancing Agent may NEVER commit an assignment, reassign a patient, or override a manager's caseload on its own (autoAssigned:true — each is a care-ownership decision that must be authorized) or skip care-lead review (requiresCareLeadReview:true) — the agent RECOMMENDS, and every allocation is a RECOMMENDATION requiring a care-management lead to confirm. An allocation that auto-commits, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Care Team Agent's no-autonomous-assignment and the Coverage Continuity Agent's no-autonomous-determination posture — the harmful action is enforced-off.",
    appliesTo: ["caseload-balancing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.schedule.intervals-sourced",
    name: "Every appointment is sourced, and every request accounted for once",
    description:
      "The Scheduling Conflict Agent's schedule must trace every appointment — scheduled or waitlisted — to a submitted request (same id, member, start, end), and must account for every request exactly once across the scheduled set and the conflict set (disjoint, covering every request — no fabricated appointment, no dropped patient, no double-count). A fabricated appointment invents a booking; a dropped patient is turned away silently. A schedule that fabricates, drops, or double-counts an appointment is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Caseload Balancing Agent's assignment-complete and the Coverage Continuity Agent's segments-sourced posture.",
    appliesTo: ["schedule-conflict-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.schedule.conflict-free",
    name: "The scheduled set is conflict-free, and every waitlist is justified",
    description:
      "The Scheduling Conflict Agent's scheduled appointments must be pairwise NON-overlapping (no double-booking on the resource), every waitlisted appointment must genuinely overlap the scheduled appointment named in its conflictsWith, and the counts must add up. A scheduled pair that overlaps double-books the resource; a request waitlisted while it actually fit turns a patient away for nothing. A schedule that double-books or waitlists a request that fit is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Caseload Balancing Agent's capacity-respected and the Access Anomaly Agent's window-count-consistent posture.",
    appliesTo: ["schedule-conflict-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.schedule.no-autonomous-booking",
    name: "An appointment is never autonomously booked / cancelled / bumped",
    description:
      "The Scheduling Conflict Agent may NEVER book, cancel, or bump an appointment on its own (autoBooked:true — each is a scheduling action that must be authorized) or skip scheduler review (requiresSchedulerReview:true) — the agent RECOMMENDS, and every schedule is a RECOMMENDATION requiring a scheduler to confirm. A schedule that auto-books, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Appointment Scheduling Agent's governance posture — the harmful action is enforced-off.",
    appliesTo: ["schedule-conflict-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lasa.candidates-sourced",
    name: "Every look-alike candidate is sourced from the catalog",
    description:
      "The Medication Name Safety Agent must trace every candidate it names — the nearest match and every confusable look-alike — to a real catalog drug (its drugId in the catalog, its echoed name equal to that drug's catalog name). A fabricated candidate invents a look-alike that doesn't exist; a mislabeled one attaches the wrong name. A finding that names an unsourced or mislabeled candidate is rejected before it can leave the fabric. This is the sourced gate. Mirrors the Drug–Drug Interaction Agent's interaction-sourced and the Schedule Conflict Agent's intervals-sourced posture.",
    appliesTo: ["medication-name-safety-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lasa.distances-consistent",
    name: "The edit distances and the finding are exact",
    description:
      "The Medication Name Safety Agent's finding must recompute exactly: recomputing the Levenshtein edit distance from the prescribed name to the catalog must reproduce the reported nearest match, every reported distance, the exact-match flag, the confusable set (exactly those within the threshold, not counting an exact match), and the disposition. A miscomputed distance, a wrong nearest match, an omitted or spurious look-alike, or a disposition that doesn't follow drives a wrong finding — the whole point is the arithmetic. A finding whose distances don't add up is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Schedule Conflict Agent's conflict-free and the Access Anomaly Agent's window-count-consistent posture.",
    appliesTo: ["medication-name-safety-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lasa.no-autonomous-substitution",
    name: "A drug is never autonomously substituted / corrected / dispensed",
    description:
      "The Medication Name Safety Agent may NEVER substitute the drug for the nearest match, silently correct the order, or dispense on its own (autoSubstituted:true — each is a clinical action that must be authorized) or skip pharmacist review (requiresPharmacistReview:true) — the agent FLAGS, and every finding is a RECOMMENDATION requiring a pharmacist to confirm the intended medication. A finding that auto-substitutes, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Drug–Drug Interaction Agent's no-autonomous-hold-or-override and the Schedule Conflict Agent's no-autonomous-booking posture — the harmful action is enforced-off.",
    appliesTo: ["medication-name-safety-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claim.states-sourced",
    name: "Every lifecycle state and transition is sourced from the state machine",
    description:
      "The Claim Lifecycle Agent must trace every status it names — in the allowed-next set and in the shortest path — to a defined state of the state machine, and every shortest-path step must be a real transition. A fabricated state invents a lifecycle stage that doesn't exist; a fabricated edge invents a legal move that isn't allowed. A finding that names an unsourced state or an invented transition is rejected before it can leave the fabric. This is the sourced gate. Mirrors the Care Pathway Agent's steps-sourced and the Medication Name Safety Agent's candidates-sourced posture.",
    appliesTo: ["claim-lifecycle-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claim.transition-consistent",
    name: "The transition logic is exact",
    description:
      "The Claim Lifecycle Agent's finding must recompute exactly: recomputing the transition table + the BFS from the state machine must reproduce the reported direct-edge flag, the reachability flag, the allowed-next set, the shortest-path length + endpoints, and the disposition. A wrong direct-edge flag would wave through an illegal transition (e.g., draft → paid, skipping adjudication) or block a legal one; a wrong reachability / path would misroute the claim. A finding whose transition logic doesn't add up is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Care Pathway Agent's sequence-valid and the Medication Name Safety Agent's distances-consistent posture.",
    appliesTo: ["claim-lifecycle-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.claim.no-autonomous-advance",
    name: "A claim is never autonomously advanced / paid / finalized",
    description:
      "The Claim Lifecycle Agent may NEVER advance the claim to the next status, post a payment, or finalize a denial on its own (autoAdvanced:true — each is a payer action that must be authorized) or skip adjuster review (requiresAdjusterReview:true) — the agent VALIDATES, and every finding is a RECOMMENDATION requiring an adjuster to confirm the transition. A finding that auto-advances, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Timely Filing Agent's no-autonomous-write-off and the Overpayment Recovery Agent's no-autonomous-clawback posture — the harmful action is enforced-off.",
    appliesTo: ["claim-lifecycle-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.benchmark.cohort-sourced",
    name: "The peer cohort is sourced and intact",
    description:
      "The Provider Benchmarking Agent must keep its peer cohort intact: every cohort member a well-formed { providerId, numeric value }, the reported cohort size equal to the actual cohort, and the target value numeric. A phantom or omitted peer silently mis-sizes the denominator and misrepresents the percentile. A finding whose cohort is malformed or mis-sized is rejected before it can leave the fabric. This is the sourced gate. Mirrors the Claim Lifecycle Agent's states-sourced and the Access Anomaly Agent's events-sourced posture.",
    appliesTo: ["provider-benchmarking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.benchmark.stats-consistent",
    name: "The rank statistics are exact",
    description:
      "The Provider Benchmarking Agent's finding must recompute exactly: recomputing the rank statistics from the cohort must reproduce the reported counts, percentile rank, direction-adjusted effective percentile, median, performance band, and disposition. A miscomputed percentile or a band that doesn't follow mis-tiers the provider — the whole point is the arithmetic. A finding whose statistics don't add up is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Claim Lifecycle Agent's transition-consistent and the Member Cost-Share Agent's math-consistent posture.",
    appliesTo: ["provider-benchmarking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.benchmark.no-autonomous-tiering",
    name: "A provider is never autonomously tiered / penalized / de-networked",
    description:
      "The Provider Benchmarking Agent may NEVER tier the provider, adjust their payment, or remove them from the network on its own (autoTiered:true — each is a commercially consequential action that must be authorized) or skip network review (requiresNetworkReview:true) — the agent BENCHMARKS, and every finding is a RECOMMENDATION requiring a network manager to confirm. A finding that auto-tiers, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Provider Contracting Agent's no-autonomous-term-change and the Timely Filing Agent's no-autonomous-write-off posture — the harmful action is enforced-off.",
    appliesTo: ["provider-benchmarking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.household.links-sourced",
    name: "The links + household partition are sourced and complete",
    description:
      "The Household Composition Agent's grouping must be built from the submitted batch: every relationship link must connect two SUBMITTED members (no phantom relationship to a member not in the batch), and the households must PARTITION exactly the submitted members — each member in exactly one household, all covered, none invented. A phantom link or a dropped / invented member silently mis-groups a family. A finding that references a phantom member or does not partition the batch is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete posture.",
    appliesTo: ["household-composition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.household.partition-consistent",
    name: "The partition is the correct connected components",
    description:
      "The Household Composition Agent's grouping must recompute exactly: recomputing the union-find / connected components from the members + links must reproduce the reported households (same ids, members, sizes), household count, largest-household size, member count, and disposition. A wrong grouping — two unlinked members merged, or two linked members split apart — mis-applies a family accumulator or leaks one member's data to another. A finding whose partition doesn't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Provider Benchmarking Agent's stats-consistent and the Claim Lifecycle Agent's transition-consistent posture.",
    appliesTo: ["household-composition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.household.no-autonomous-merge",
    name: "Member records are never autonomously merged",
    description:
      "The Household Composition Agent may NEVER merge member records, change enrollment, or apply a family accumulator on its own (autoMerged:true — each is a consequential action that must be authorized) or skip steward review (requiresStewardReview:true) — the agent PROPOSES a grouping, and every finding is a RECOMMENDATION requiring a data steward to confirm. A finding that auto-merges, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Master-Patient-Index Agent's no-autonomous-merge posture — the harmful action is enforced-off.",
    appliesTo: ["household-composition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adequacy.providers-sourced",
    name: "Every evaluated provider is a submitted in-network provider",
    description:
      "The Network Adequacy Agent must evaluate exactly the submitted in-network providers of the required specialty — every evaluated provider must be a submitted one (same id, coordinates, and the required specialty; no phantom provider fabricating coverage that isn't in the network), every submitted provider of that specialty must be evaluated (none dropped), the counts must agree, and the nearest must be one of the evaluated. A phantom nearby provider turns a real access GAP into false adequacy. A finding that evaluates a phantom or drops a provider is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Identifier Validation Agent's identifiers-sourced and the Household Composition Agent's links-sourced posture. (In the prototype the member + providers + coordinates are clearly-labeled illustrative synthetics.)",
    appliesTo: ["network-adequacy-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adequacy.distances-consistent",
    name: "The great-circle distances recompute correctly",
    description:
      "The Network Adequacy Agent's distances must recompute exactly: recomputing the haversine great-circle distance from the member to each evaluated provider's own coordinates must reproduce every reported distance, the ascending order, the nearest provider, the nearest distance, and the adequacy disposition against the standard. A mis-measured distance understates a gap (falsely certifying adequacy so a member can't reach care) or overstates one. A finding whose distances don't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Medication Name Safety Agent's distances-consistent and the Provider Benchmarking Agent's stats-consistent posture.",
    appliesTo: ["network-adequacy-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adequacy.no-autonomous-network-change",
    name: "The network is never autonomously certified or changed",
    description:
      "The Network Adequacy Agent may NEVER certify the network as adequate to a regulator, close a gap, or add / remove a provider on its own (autoCertified:true — each is a consequential action that must be authorized) or skip network review (requiresNetworkReview:true) — the agent ASSESSES adequacy, and every finding is a RECOMMENDATION requiring a network manager to confirm. A finding that auto-certifies, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Provider Benchmarking Agent's no-autonomous-tiering and the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture — the harmful action is enforced-off.",
    appliesTo: ["network-adequacy-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pcp.matching-sourced",
    name: "Every assignment is a submitted member matched to a submitted provider",
    description:
      "The PCP Matching Agent must assign exactly the submitted panel — one assignment per SUBMITTED member (all present, no duplicate, none dropped or invented), every assigned provider a SUBMITTED provider, the provider loads echoing the submitted capacities with an assignedCount equal to the actual number of assignments to that provider, and the matched / unmatched / total tallies agreeing with the assignments. A phantom assignment (a member not in the panel, or a provider not in the network) corrupts the panel. A determination that assigns a phantom or miscounts is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Network Adequacy Agent's providers-sourced and the Caseload Balancing Agent's assignment-complete posture. (In the prototype the members + providers + preferences are clearly-labeled illustrative synthetics.)",
    appliesTo: ["pcp-matching-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pcp.matching-stable",
    name: "The matching is stable (recomputes, no blocking pair)",
    description:
      "The PCP Matching Agent's matching must be stable: recomputing the member-proposing Gale–Shapley deferred acceptance from the echoed preferences + capacities must reproduce the reported assignment and each member's reported preference rank, no provider may be over capacity, and there must be NO blocking pair (a member and provider who both prefer each other over their current assignment). An unstable matching unravels as the pair defects, leaving a patient without a real PCP — the whole point is the stability. A determination whose matching doesn't recompute, is over capacity, or has a blocking pair is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Network Adequacy Agent's distances-consistent and the Household Composition Agent's partition-consistent posture.",
    appliesTo: ["pcp-matching-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.pcp.no-autonomous-assignment",
    name: "No assignment is ever autonomously committed",
    description:
      "The PCP Matching Agent may NEVER commit an assignment, reassign a patient, or override a provider's panel on its own (autoAssigned:true — each is a care-ownership decision that must be authorized) or skip coordinator review (requiresCoordinatorReview:true) — the agent PROPOSES a matching, and every matching is a RECOMMENDATION requiring a care-coordination lead to confirm. A matching that auto-assigns, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Care Team Agent's no-autonomous-assignment posture — the harmful action is enforced-off.",
    appliesTo: ["pcp-matching-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.reportable.facts-sourced",
    name: "Every criterion is sourced and the definition is complete",
    description:
      "The Reportable Condition Agent must classify the submitted case against the submitted definition — every leaf predicate in the criteria trees must reference a SUBMITTED fact (no fabricated criterion inventing a requirement the definition never stated), the reported classification results must be exactly the definition's classifications in order, the referenced-fact set must match the definition's actual leaves, and the reported classification must be a defined one (or not-a-case). A fabricated criterion over- or under-states the case definition. A determination that references an undefined fact or mis-enumerates the definition is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the PCP Matching Agent's matching-sourced and the Network Adequacy Agent's providers-sourced posture. (In the prototype the condition + definition + facts are clearly-labeled illustrative synthetics.)",
    appliesTo: ["reportable-condition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.reportable.classification-consistent",
    name: "The classification recomputes (recursive boolean evaluation)",
    description:
      "The Reportable Condition Agent's classification must recompute: re-running the RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION (nested all-of / any-of / not over the case's facts) of each classification's criteria tree from the facts must reproduce each reported met flag, the selected classification (the highest-precedence tree that holds, else not-a-case), and the reportable flag. A mis-evaluated tree raises a false alarm to public health (over-reports) or misses a notifiable case (under-reports) — the whole point is the boolean logic. A determination whose classification doesn't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the PCP Matching Agent's matching-stable and the Care Pathway Agent's sequence-valid posture.",
    appliesTo: ["reportable-condition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.reportable.no-autonomous-report",
    name: "No case is ever autonomously reported to public health",
    description:
      "The Reportable Condition Agent may NEVER report the case to a public-health authority on its own (autoReported:true — a consequential legal action that must be authorized) or skip epidemiologist review (requiresEpiReview:true) — the agent CLASSIFIES, and every classification is a RECOMMENDATION requiring an epidemiologist / infection-preventionist to confirm before any report is filed. A classification that auto-reports, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Adverse-Event Reporting Agent's human-review posture and the HEDIS Agent's no-autonomous-submission posture — the harmful action is enforced-off.",
    appliesTo: ["reportable-condition-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timeline.events-sourced",
    name: "Every timeline event is sourced and every stream event is accounted for",
    description:
      "The Timeline Merge Agent must build the timeline from the submitted streams — every timeline entry must trace to a SUBMITTED stream event (same source + eventId + timestamp + kind; no fabricated event), every submitted event must appear EXACTLY ONCE (none dropped, none double-listed), the per-source contributions must echo the submitted counts + actual kept / duplicate tallies, and the kept + duplicate + total counts must add up. A fabricated or dropped event silently corrupts the clinical record. A determination that fabricates, drops, or miscounts an event is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete posture. (In the prototype the events are clearly-labeled illustrative synthetics.)",
    appliesTo: ["timeline-merge-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timeline.merge-consistent",
    name: "The merge order + dedup recompute (k-way merge of sorted streams)",
    description:
      "The Timeline Merge Agent's timeline must recompute: re-running the K-WAY MERGE OF SORTED STREAMS from the submitted streams must reproduce the reported chronological order (timestamps non-decreasing, ties broken by source then eventId) and the reported duplicate flags (an event flagged duplicate genuinely repeats an earlier kept event with the same content key; a kept event genuinely does not). A mis-ordered timeline hides a trend and a mis-flagged duplicate fakes a double dose. A determination whose order or dedup doesn't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Reportable Condition Agent's classification-consistent and the Care Pathway Agent's sequence-valid posture.",
    appliesTo: ["timeline-merge-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.timeline.no-autonomous-merge",
    name: "No timeline is ever autonomously written back",
    description:
      "The Timeline Merge Agent may NEVER write the merged timeline back to a source system of record, purge a duplicate, or overwrite a chart on its own (autoWritten:true — each is a data-integrity action that must be authorized) or skip steward review (requiresStewardReview:true) — the agent MERGES, and every merge is a RECOMMENDATION requiring a data steward to confirm. A merge that auto-writes, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Audit Log Integrity Agent's read-only posture — the harmful action is enforced-off.",
    appliesTo: ["timeline-merge-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.quality.observations-sourced",
    name: "Every charted point is sourced and every observation is accounted for",
    description:
      "The Quality Shift Agent must draw its control chart from the submitted observations — every charted point must trace to a SUBMITTED observation (same index + value; no fabricated point), every submitted observation must appear EXACTLY ONCE (none dropped, none double-charted), and the chart parameters (target, slack, threshold) must be present numbers. A fabricated or dropped point silently rewrites the trend. A determination that fabricates, drops, or double-charts a point is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Timeline Merge Agent's events-sourced and the Enrollment Reconciliation Agent's reconciliation-complete posture. (In the prototype the measures are clearly-labeled illustrative synthetics.)",
    appliesTo: ["quality-shift-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.quality.cusum-consistent",
    name: "The CUSUM recomputes (two-sided tabular CUSUM change-point detection)",
    description:
      "The Quality Shift Agent's detection must recompute: re-running the two-sided TABULAR CUSUM from the submitted observations + parameters must reproduce every charted SH_i / SL_i, the first-alarm index, the alarm direction, the signal (in-control / shift-up-detected / shift-down-detected), and the peak sums. A mis-charted CUSUM fakes a shift that isn't there or hides one that is. A determination whose chart or signal doesn't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Timeline Merge Agent's merge-consistent and the Provider Benchmarking Agent's stats-consistent posture.",
    appliesTo: ["quality-shift-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.quality.no-autonomous-intervention",
    name: "No corrective action is ever launched autonomously",
    description:
      "The Quality Shift Agent may NEVER launch a corrective action, a recall / outreach campaign, or a process change on its own (autoActioned:true — each is a consequential action that must be authorized) or skip quality review (requiresQualityReview:true) — the agent DETECTS, and every signal is a RECOMMENDATION requiring a quality reviewer to confirm. A detection that auto-actions, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the HEDIS Agent's no-autonomous-submission and the Care Gap Agent's human-review posture — the harmful action is enforced-off.",
    appliesTo: ["quality-shift-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.identifier.identifiers-sourced",
    name: "Every validation result traces to a submitted identifier",
    description:
      "The Provider Identifier (NPI) Validation Agent must report exactly what was submitted — one result per submitted identifier (same NPI, same order; no fabricated result, no dropped identifier), with the reported total equal to the identifier count, the per-kind counts summing to the total, and the batch disposition following from the counts. A dropped or invented identifier silently mis-states the integrity of the batch. A finding that fabricates or drops an identifier is rejected before it can leave the fabric. This is the sourced + completeness gate. Mirrors the Household Composition Agent's links-sourced and the Enrollment Reconciliation Agent's reconciliation-complete posture. (In the prototype the identifiers are clearly-labeled illustrative synthetics.)",
    appliesTo: ["identifier-validation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.identifier.checksum-consistent",
    name: "The Luhn check digit recomputes correctly",
    description:
      "The Provider Identifier (NPI) Validation Agent's checksums must recompute exactly: recomputing each identifier's format classification and Luhn (CMS mod-10 over the 80840 prefix) check digit from the NPI itself must reproduce the reported disposition, expected check digit, and per-kind counts. A miscomputed checksum waves through a mistyped NPI — a claim rejection or a ghost-directory entry waiting to happen — or fails a correct one. A finding whose checksums don't recompute is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Provider Benchmarking Agent's stats-consistent and the OIG Exclusion Agent's match-not-overstated posture.",
    appliesTo: ["identifier-validation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.identifier.no-autonomous-reject",
    name: "A claim / provider is never autonomously rejected",
    description:
      "The Provider Identifier (NPI) Validation Agent may NEVER reject a claim, remove a provider from the directory, or correct a number on its own (autoRejected:true — each is a consequential action that must be authorized) or skip steward review (requiresStewardReview:true) — the agent VALIDATES and FLAGS, and every finding is a RECOMMENDATION requiring a data steward to confirm. A finding that auto-rejects, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned and the Enrollment Reconciliation Agent's no-autonomous-change posture — the harmful action is enforced-off.",
    appliesTo: ["identifier-validation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.abn.coverage-rule-sourced",
    name: "Every non-coverage decision cites a recorded Medicare coverage rule",
    description:
      "The Advance Beneficiary Notice Agent may NEVER decide a service's coverage / ABN requirement without citing a recorded Medicare coverage rule from the catalog — a missing or off-catalog rule id is an ad-hoc / un-sourced coverage decision and is not a real determination. A determination with no recorded rule is rejected before it can leave the fabric. Mirrors the Good Faith Estimate Agent's charge-master-sourced and the Timely Filing Agent's filing-limit-sourced posture. (In the prototype the coverage catalog is a clearly-labeled illustrative synthetic; in production coverage comes from the Medicare NCD/LCD and the Social Security Act §1862(a).)",
    appliesTo: ["advance-beneficiary-notice-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.abn.abn-required-when-noncovered",
    name: "A likely-non-covered service requires a signed pre-service ABN",
    description:
      "When the Advance Beneficiary Notice Agent assesses a service as likely NON-covered, it must require a signed ABN (Form CMS-R-131) issued BEFORE the service (abnRequired:true) — a determination that a likely-denied Medicare service needs no ABN understates the beneficiary's financial exposure and is how a surprise denial lands on the patient. A likely-non-covered determination with abnRequired:false is rejected before it can leave the fabric. This is the load-bearing completeness gate. Mirrors the Good Faith Estimate Agent's expected-items-complete posture. (In the prototype the coverage assessment is a clearly-labeled illustrative synthetic; in production it is governed by the Medicare NCD/LCD and the CMS Medicare Claims Processing Manual Ch. 30.)",
    appliesTo: ["advance-beneficiary-notice-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.abn.no-autonomous-beneficiary-liability",
    name: "Patient financial liability is never assigned autonomously",
    description:
      "The Advance Beneficiary Notice Agent may NEVER autonomously assign patient financial liability — the beneficiary may be billed for a likely-non-covered service ONLY when a valid pre-service ABN is on file (the GA modifier); without a valid ABN the PROVIDER is liable (the GZ modifier / write-off), and every non-covered / excluded determination is a RECOMMENDATION requiring human review (requiresHumanReview:true). A determination that auto-assigns liability, bills the beneficiary for a non-covered service without a valid ABN, or assigns liability without requiring human review, is rejected before it can leave the fabric. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Timely Filing Agent's no-autonomous-write-off posture — the harmful action is enforced-off. (In the prototype the modifier logic is a clearly-labeled illustrative synthetic; in production the liability workflow is the provider's human-in-the-loop billing process under Form CMS-R-131.)",
    appliesTo: ["advance-beneficiary-notice-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.accounting.purpose-category-sourced",
    name: "Every disclosure's purpose traces to the recorded catalog",
    description:
      "The Accounting of Disclosures Agent may NEVER classify a disclosure whose purpose-of-disclosure is off-catalog (a missing or unrecognized purpose id) — an ad-hoc purpose cannot be correctly decided as accountable or excluded under §164.528. A determination classifying an off-catalog purpose is rejected before it can leave the fabric. Mirrors the Minimum Necessary Agent's purpose-of-use-sourced and the Data Retention Agent's schedule-sourced posture. (In the prototype the purpose catalog is a clearly-labeled illustrative synthetic; in production the purpose taxonomy comes from the covered entity's Notice of Privacy Practices and the §164.528 exclusion set.)",
    appliesTo: ["accounting-of-disclosures-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.accounting.accountable-disclosures-complete",
    name: "Every accountable, in-window disclosure appears in the accounting",
    description:
      "The Accounting of Disclosures Agent may NEVER omit an accountable, in-window disclosure from the accounting — a non-TPO, non-authorized disclosure within the lookback window MUST appear (classified in-accounting). A determination that drops an accountable, in-window disclosure understates the accounting and defeats the patient's §164.528 right, and is rejected before it can leave the fabric. This is the load-bearing completeness gate. Mirrors the Good Faith Estimate Agent's expected-items-complete and the Audit Log Integrity Agent's sequence-complete posture. (Treatment / payment / operations and patient-authorized disclosures are legitimately excluded; only accountable disclosures are required.)",
    appliesTo: ["accounting-of-disclosures-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.accounting.no-autonomous-suppression",
    name: "A logged disclosure is never autonomously suppressed",
    description:
      "The Accounting of Disclosures Agent may NEVER delete, redact, or suppress a logged disclosure (autonomousSuppression:true) — that would falsify the accounting and destroy evidence — and it may never release the accounting without privacy-officer review (requiresPrivacyOfficerReview:true). A determination that suppresses a logged disclosure, or that does not require privacy-officer review, is rejected before it can leave the fabric. Mirrors the Audit Log Integrity Agent's no-autonomous-redaction and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off. (In the prototype the release workflow is a clearly-labeled illustrative synthetic; in production release is the privacy officer's human-in-the-loop process under §164.528.)",
    appliesTo: ["accounting-of-disclosures-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.ground-sourced",
    name: "Every denial ground traces to the recorded §164.524 catalog",
    description:
      "The Right of Access Agent may NEVER deny access (in part or full) on a cited ground that is off-catalog (a missing or unrecognized exception id) — a §164.524 denial is permitted only on a recorded statutory ground (psychotherapy notes, information compiled for a legal proceeding, a CLIA-exempt lab, an endangerment or reference-to-another-person reviewable ground), and an ad-hoc / un-sourced ground is not a lawful basis to withhold a patient's own record. A determination denying on an off-catalog ground is rejected before it can leave the fabric. Mirrors the Accounting of Disclosures Agent's purpose-category-sourced and the Minimum Necessary Agent's purpose-of-use-sourced posture. (In the prototype the exception catalog is a clearly-labeled illustrative synthetic; in production the grounds come from HIPAA §164.524 and the covered entity's Notice of Privacy Practices.)",
    appliesTo: ["right-of-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.deadline-computed",
    name: "The response deadline is the request date + 30/60 days",
    description:
      "The Right of Access Agent's response deadline must equal the request date + 30 days (+ 30 more when the single extension is invoked) — a guessed / mis-stated deadline is how an access request quietly runs past its §164.524 legal clock. A determination whose deadline (or days-until) does not match the recomputation from its own fields is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Timely Filing Agent's deadline-computed and the Good Faith Estimate Agent's math-consistent posture.",
    appliesTo: ["right-of-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.access.no-autonomous-denial-or-release",
    name: "The record is never autonomously released or denied",
    description:
      "The Right of Access Agent may NEVER release the record (autoReleased:true) or issue a denial on its own, and may never skip human review (requiresHumanReview:true) — the agent ADJUDICATES; releasing the record is a privacy risk and a denial is a legal act with appeal rights, so every determination is a RECOMMENDATION requiring a records / privacy officer to fulfill or review. A determination that auto-releases the record, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Accounting of Disclosures Agent's no-autonomous-suppression and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off.",
    appliesTo: ["right-of-access-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.amendment.ground-sourced",
    name: "Every amendment denial traces to a recorded §164.526 ground",
    description:
      "The Amendment / Correction Agent may NEVER deny a request (or assert a denial ground) that is off-catalog — a §164.526 denial is permitted only on a recorded statutory ground (the covered entity did not create the PHI and the originator is available; the PHI is not part of the designated record set; the PHI is not available for access under §164.524; or the PHI is already accurate and complete), and an ad-hoc / un-sourced ground is not a lawful basis to refuse a patient's amendment. A denied determination that cites an off-catalog ground is rejected before it can leave the fabric. Mirrors the Right of Access Agent's ground-sourced and the Accounting of Disclosures Agent's purpose-category-sourced posture. (In the prototype the ground catalog is a clearly-labeled illustrative synthetic; in production the grounds are the full §164.526 set.)",
    appliesTo: ["amendment-request-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.information-blocking.exception-sourced",
    name: "Every claimed information-blocking exception traces to the recorded catalog",
    description:
      "The Information Blocking Agent may NEVER claim an exception that is off-catalog — a practice escapes the 21st Century Cures Act information-blocking rule only on a recorded 45 CFR Part 171 exception (preventing harm §171.201, privacy §171.202, security §171.203, infeasibility §171.204, health IT performance §171.205, content & manner §171.301, fees §171.302, licensing §171.303), and an ad-hoc / un-sourced exception is not a lawful basis to interfere with EHI. A determination that claims an off-catalog exception is rejected before it can leave the fabric. Mirrors the Right of Access Agent's ground-sourced and the Amendment Agent's ground-sourced posture. (In the prototype the exception catalog is a clearly-labeled illustrative synthetic; in production the exceptions are the full 45 CFR Part 171 set.)",
    appliesTo: ["information-blocking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.information-blocking.determination-not-overstated",
    name: "An exception is never reported as met unless every condition is satisfied",
    description:
      "The Information Blocking Agent may report a 45 CFR Part 171 exception as SATISFIED only when EVERY required condition of that exception is met — reporting an exception as met (or under-reporting its missing conditions) when a condition is missing is how unlawful interference with EHI is dressed up as a compliant practice. A determination whose exceptionSatisfied / missingConditions fails the recomputation from the claimed exception + the asserted conditions is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the OIG Exclusion Agent's match-not-overstated and the Member Cost-Share Agent's math-consistent posture.",
    appliesTo: ["information-blocking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.information-blocking.no-autonomous-block-or-release",
    name: "EHI is never autonomously withheld or released",
    description:
      "The Information Blocking Agent may NEVER withhold EHI (autoBlockedEhi:true — which could itself be information blocking, or delay urgent care), force-release EHI (autoReleasedEhi:true — which could breach privacy), or skip compliance review (requiresComplianceReview:true) — the agent ADJUDICATES, and every determination is a RECOMMENDATION requiring a compliance officer to confirm and act. A determination that auto-blocks / auto-releases EHI, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the OIG Exclusion Agent's no-autonomous-block-or-clear and the Right of Access Agent's no-autonomous-denial-or-release posture — the harmful action is enforced-off.",
    appliesTo: ["information-blocking-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.amendment.deadline-computed",
    name: "The amendment response deadline is computed, not guessed",
    description:
      "The Amendment / Correction Agent's §164.526 response deadline must equal the request date + 60 days (+ 30 more when the single extension is invoked, with written notice). A guessed / mis-stated deadline is how an amendment request quietly runs past its §164.526 legal clock, and a determination whose deadline (or days-until) fails the recomputation from its own fields is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Right of Access Agent's deadline-computed and the Timely Filing Agent's deadline-computed posture.",
    appliesTo: ["amendment-request-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.amendment.no-autonomous-write-or-denial",
    name: "The record is never autonomously amended or denied",
    description:
      "The Amendment / Correction Agent may NEVER amend the record (autoAmended:true — a data write to the medical record that ripples to every downstream holder the PHI was shared with), issue a denial on its own (autoDenied:true — a legal act carrying the patient's right to submit a statement of disagreement), or skip human review (requiresHumanReview:true) — the agent ADJUDICATES, and every determination is a RECOMMENDATION requiring a records / privacy officer to act on or review. A determination that auto-amends / auto-denies, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Right of Access Agent's no-autonomous-denial-or-release and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off.",
    appliesTo: ["amendment-request-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.subrogation.basis-sourced",
    name: "Every subrogation recovery decision cites a recorded legal basis",
    description:
      "The Subrogation Agent may NEVER decide a recovery on an off-catalog subrogation basis (a missing or unrecognized basis id) — a subrogation interest exists only under a recorded legal basis (an ERISA plan reimbursement clause, a state subrogation statute, a workers-comp lien, a contractual reimbursement provision), and an ad-hoc / un-sourced basis is not a real legal right. A determination citing an off-catalog basis is rejected before it can leave the fabric. Mirrors the Claims Overpayment & Recovery Agent's reason-catalog-sourced and the Timely Filing Agent's filing-limit-sourced posture. (In the prototype the basis catalog is a clearly-labeled illustrative synthetic; in production the bases come from the plan document and state subrogation law.)",
    appliesTo: ["subrogation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.subrogation.recoverable-within-paid",
    name: "The recoverable never exceeds what the plan paid or the settlement",
    description:
      "The Subrogation Agent's asserted recoverable amount may NEVER be negative, exceed the plan's paid amount, or exceed the third-party settlement — a subrogation lien is REIMBURSEMENT, not profit: the plan may recover at most what it PAID, and never more than the member actually received in settlement. A determination whose recoverable breaches this bound is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Good Faith Estimate Agent's math-consistent and the Timely Filing Agent's deadline-computed posture. (The made-whole and common-fund doctrines further reduce the recoverable; the illustrative reductions are clearly labeled.)",
    appliesTo: ["subrogation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.subrogation.no-autonomous-lien",
    name: "A subrogation lien is never autonomously asserted",
    description:
      "The Subrogation Agent may NEVER autonomously assert or perfect a lien, reduce the member's settlement, or recover funds (autoAssertedLien:true), and may never find a subrogation interest (eligible:true) without requiring human review (requiresHumanReview:true) — a subrogation determination is a RECOMMENDATION requiring a subrogation specialist / plan counsel to review, because asserting a lien against a member's personal-injury recovery is legally consequential and doctrine-sensitive (made-whole, common-fund). A determination that auto-asserts a lien, or finds an interest without requiring review, is rejected before it can leave the fabric. Mirrors the Claims Overpayment & Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off.",
    appliesTo: ["subrogation-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.costshare.benefit-design-sourced",
    name: "Every cost-share computes from the recorded plan benefit design",
    description:
      "The Member Cost-Share Agent may NEVER compute a split from an off-catalog plan (a missing or unrecognized plan id) — the deductible, coinsurance rate, and out-of-pocket maximum must come from the member's recorded plan benefit design, and an ad-hoc plan cannot be correctly cost-shared. A determination computed from an off-catalog plan is rejected before it can leave the fabric. Mirrors the Good Faith Estimate Agent's charge-master-sourced and the Deal Desk Agent's pricing-catalog-sourced posture. (In the prototype the plan catalog is a clearly-labeled illustrative synthetic; in production the benefit design comes from the member's certificate of coverage / SBC and the payer's benefit configuration.)",
    appliesTo: ["member-cost-share-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.costshare.math-consistent",
    name: "The member / plan split adds up and stays bounded",
    description:
      "The Member Cost-Share Agent's split must add up and stay bounded — the member responsibility + the plan-paid must equal the allowed amount, the member share must be non-negative and never exceed the allowed amount or the remaining out-of-pocket maximum, and the member total must equal the deductible + coinsurance less the OOP-cap reduction. A split that doesn't add up is how a member is silently over-charged, and a determination whose split fails the recomputation is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Good Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid posture.",
    appliesTo: ["member-cost-share-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.costshare.no-autonomous-member-charge",
    name: "A member charge is never autonomously posted",
    description:
      "The Member Cost-Share Agent may NEVER post a charge, an invoice, or a balance to the member (autoPostedCharge:true), and may never skip adjudication review (requiresAdjudicationReview:true) — the EOB cost-share is an ESTIMATE / BREAKDOWN, and the claims system / a human finalizes it. A determination that posts a member charge, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability posture — the harmful action is enforced-off.",
    appliesTo: ["member-cost-share-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.exclusion.match-record-sourced",
    name: "Every exclusion match traces to a recorded LEIE record",
    description:
      "The OIG Exclusion Screening Agent may NEVER report a match (anything other than no-match) without citing a matchedExclusionId that resolves in the recorded LEIE catalog — a match asserted without a sourced exclusion record is not a lawful basis to hold a payment. A determination that reports a match with no sourced record is rejected before it can leave the fabric. Mirrors the Right of Access Agent's ground-sourced and the Subrogation Agent's basis-sourced posture. (In the prototype the LEIE catalog is a clearly-labeled illustrative synthetic; in production the match traces to the OIG's monthly LEIE download and the party's verified identifiers.)",
    appliesTo: ["exclusion-screening-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.exclusion.match-not-overstated",
    name: "A match strength is never stronger than the signals support",
    description:
      "The OIG Exclusion Screening Agent's reported match strength must never exceed what the identifier signals support — a confirmed match requires an NPI match OR a full-name AND date-of-birth match, a full-name match with no DOB / NPI is at most probable, and a last-name coincidence the first name / DOB doesn't corroborate is at most possible. Overstating a match is how a legitimate provider's payment is wrongly held on a shared name, and a determination whose reported strength exceeds the recomputed supportable strength is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Member Cost-Share Agent's math-consistent and the Subrogation Agent's recoverable-within-paid posture.",
    appliesTo: ["exclusion-screening-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.exclusion.no-autonomous-block-or-clear",
    name: "A payment is never autonomously blocked, and a party is never autonomously cleared",
    description:
      "The OIG Exclusion Screening Agent may NEVER autonomously block a payment (autoBlockedPayment:true), clear a party (autoCleared:true), or skip compliance review (requiresComplianceReview:true) — the screening is a RECOMMENDATION, and a compliance officer confirms the identity and acts, because a wrongful block denies a legitimate provider income and a wrongful clear risks paying a sanctioned party. A determination that auto-blocks / auto-clears, or that is not review-gated, is rejected before it can leave the fabric. Mirrors the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability and the Member Cost-Share Agent's no-autonomous-member-charge posture — the harmful action is enforced-off.",
    appliesTo: ["exclusion-screening-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.cob.custody-decree-overrides-birthday",
    name: "A custody / court decree always overrides the birthday rule",
    description:
      "The Coordination of Benefits Agent may NEVER let the birthday rule override an active custody / court decree — when a decree assigns primary responsibility for a dependent child's health coverage to a specific parent's plan, THAT plan is primary, no matter whose birthday falls earlier in the year. A determination that orders the coverages against an active decree is rejected before it can leave the fabric, so the fabric can never coordinate benefits contrary to a binding court order. Mirrors the Data Retention Agent's legal-hold-overrides-purge — a legal instrument overrides the default rule. (In the prototype the COB rule catalog is a clearly-labeled illustrative synthetic; real COB is governed by the NAIC COB Model Regulation and the terms of the specific decree.)",
    appliesTo: ["coordination-of-benefits-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.cob.order-of-benefits-rule-sourced",
    name: "Every ordering decision must cite a recorded order-of-benefits rule",
    description:
      "Every order-of-benefits decision the Coordination of Benefits Agent produces must cite a recorded COB rule from the rule catalog — there is no ad-hoc, un-sourced ordering. A determination that orders a coverage with a missing or off-catalog rule id is rejected before it can leave the fabric, so a payer-order determination can never be evidenced by anything other than a defined COB rule. Mirrors the Data Retention Agent's schedule-sourced and the Claims Adjudication Agent's edit-catalog-sourced posture — every decision traces to a defined source. (In the prototype the COB rule catalog is a clearly-labeled illustrative synthetic; in production this is the customer's NAIC-model-conformant, legally-reviewed order-of-benefits rule set.)",
    appliesTo: ["coordination-of-benefits-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.cob.no-autonomous-adjudication",
    name: "A COB determination is never autonomous — it is human-cosign-gated",
    description:
      "The Coordination of Benefits Agent may NEVER autonomously adjudicate, pay, or adjust a claim — an order-of-benefits determination sets payer ORDER only, and it is a RECOMMENDATION requiring human cosign (requiresHumanCosign:true) before it drives a claim's payment. A determination that asserts an autonomous adjudication is rejected before it can leave the fabric, so a COB recommendation can never become an unattended payment decision. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the Utilization Review Agent's no-autonomous-denial, and the Data Retention Agent's no-autonomous-purge posture — the safe answer is enforced. (In the prototype the COB rule catalog + payers are clearly-labeled illustrative synthetics; in production this is the customer's governed COB workflow with a human-in-the-loop cosign + a signed audit trail.)",
    appliesTo: ["coordination-of-benefits-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.recovery.within-lookback-window",
    name: "A recovery must be within the statutory lookback window",
    description:
      "The Claims Overpayment & Recovery Agent may NEVER mark a claim recoverable once it is past its statutory lookback window (the paid date + the cited reason's lookback days) — an overpayment past its window is NEVER recoverable, no matter how large. A determination that asserts a clawback beyond the lookback is rejected before it can leave the fabric, so the fabric can never authorize an unlawful recoupment. Mirrors the Data Retention Agent's legal-hold-overrides-purge and the Utilization Review Agent's SLA-integrity — a window bounds the action. (In the prototype the recovery reasons + lookback windows are clearly-labeled illustrative synthetics; real recovery windows are governed by the ACA §6402, CMS recovery rules, ERISA, and state insurance code.)",
    appliesTo: ["overpayment-recovery-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.recovery.reason-catalog-sourced",
    name: "Every recovery must cite a recorded recovery reason",
    description:
      "Every recovery decision the Claims Overpayment & Recovery Agent produces must cite a recorded recovery reason from the catalog — there is no ad-hoc, un-sourced clawback. A determination with a missing or off-catalog reason id is rejected before it can leave the fabric, so a recovery can never be evidenced by anything other than a defined reason. Mirrors the Data Retention Agent's schedule-sourced and the Claims Adjudication Agent's edit-catalog-sourced posture — every decision traces to a defined source. (In the prototype the recovery reason catalog is a clearly-labeled illustrative synthetic; in production this is the customer's legally-reviewed recovery reason set.)",
    appliesTo: ["overpayment-recovery-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.recovery.no-autonomous-clawback",
    name: "A clawback is never autonomous — it is human-review-gated",
    description:
      "The Claims Overpayment & Recovery Agent may NEVER execute a clawback / offset autonomously — a recoverable overpayment is a RECOMMENDATION requiring human review with member/provider notice (requiresHumanReview:true), and an offset only happens after a human reviews it. A determination that asserts an autonomous / unreviewed clawback is rejected before it can leave the fabric, so a recovery recommendation can never become an unattended recoupment. Mirrors the Fraud, Waste & Abuse Agent's no-autonomous-denial, the Data Retention Agent's no-autonomous-purge, and the Coordination of Benefits Agent's no-autonomous-adjudication posture — the safe answer is enforced. (In the prototype the reason catalog + windows are clearly-labeled illustrative synthetics; in production this is the customer's governed recovery workflow with a human-in-the-loop review + notice + a signed audit trail.)",
    appliesTo: ["overpayment-recovery-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.finassist.no-eca-before-screening",
    name: "No extraordinary collection action before financial screening",
    description:
      "The Patient Financial Assistance & Charity Care Agent may NEVER let an extraordinary collection action (ECA — sending a bill to collections, credit reporting, a lien) proceed before financial-assistance (FAP / charity-care) screening is complete. Under IRS 501(r)(6) a hospital must make reasonable efforts to determine FAP eligibility BEFORE any ECA. A determination that asserts an ECA while screening is incomplete is rejected before it can leave the fabric, so the fabric can never authorize a collection action that precedes screening. Mirrors the Data Retention Agent's legal-hold-overrides-purge and the Overpayment & Recovery Agent's within-lookback-window — a legal precondition bounds the action. (In the prototype the FAP schedule + FPL table are clearly-labeled illustrative synthetics; real FAP + ECA rules are governed by IRS 501(r) / 26 CFR 1.501(r) and state charity-care law.)",
    appliesTo: ["financial-assistance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.finassist.fap-schedule-sourced",
    name: "Every eligibility decision must cite a recorded FAP tier",
    description:
      "Every charity-care determination the Patient Financial Assistance & Charity Care Agent produces must cite a recorded FAP tier from the schedule (or a recorded presumptive-eligibility reason) — there is no ad-hoc, un-sourced eligibility decision. A determination with a missing or off-catalog tier id is rejected before it can leave the fabric, so assistance can never be granted or denied on anything other than a defined tier. Mirrors the Data Retention Agent's schedule-sourced and the Overpayment & Recovery Agent's reason-catalog-sourced posture — every decision traces to a defined source. (In the prototype the FAP tier schedule is a clearly-labeled illustrative synthetic; in production this is the hospital's Board-approved Financial Assistance Policy.)",
    appliesTo: ["financial-assistance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.finassist.no-autonomous-denial",
    name: "A charity-care denial is never autonomous — it is human-review-gated",
    description:
      "The Patient Financial Assistance & Charity Care Agent may NEVER issue a denial of charity care autonomously — a not-eligible determination is a RECOMMENDATION requiring human review with written notice + appeal rights under IRS 501(r)(4) (requiresHumanReview:true). Granting full or partial charity is a benefit (a safe output), but a DENIAL is legally consequential; a determination that asserts an autonomous / unreviewed denial is rejected before it can leave the fabric, so a not-eligible recommendation can never become an unattended denial. Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback, the Utilization Review Agent's no-autonomous-denial, and the Claims Adjudication Agent's no-autonomous-denial posture — the safe answer is enforced. (In the prototype the FAP schedule + FPL table are clearly-labeled illustrative synthetics; in production this is the hospital's governed FAP workflow with a human-in-the-loop determination + notice + a signed audit trail.)",
    appliesTo: ["financial-assistance-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lab.critical-value-notified",
    name: "A critical (panic) value must be notified — never suppressed",
    description:
      "The Lab Result & Critical-Value Notification Agent may NEVER suppress or auto-close a CRITICAL (panic) value — every critical result must trigger mandatory clinician notification (requiresProviderNotification:true). CLIA §493.1291(g) requires the laboratory to immediately alert the responsible provider of a critical value. A determination that asserts a critical value as not requiring notification is rejected before it can leave the fabric, so the fabric can never let a life-threatening result go unnotified. Mirrors the Care Coordination Handoff Agent's SBAR-completeness — a life-safety obligation that cannot be skipped. (In the prototype the analyte catalog + critical thresholds are clearly-labeled illustrative synthetics; real critical-value policies are CLIA-validated and set by the laboratory's medical director.)",
    appliesTo: ["lab-result-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lab.reference-range-sourced",
    name: "Every classification must cite a recorded reference range",
    description:
      "Every classification the Lab Result & Critical-Value Notification Agent produces must cite a recorded analyte reference range + critical thresholds from the catalog — there is no ad-hoc, un-sourced result interpretation. A determination with a missing or off-catalog analyte id is rejected before it can leave the fabric, so a result can never be interpreted against anything other than a defined reference range. Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Data Retention Agent's schedule-sourced posture — every decision traces to a defined source. (In the prototype the analyte catalog is a clearly-labeled illustrative synthetic; in production this is the laboratory's CLIA-validated reference-range set.)",
    appliesTo: ["lab-result-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.lab.no-autonomous-clinical-action",
    name: "No autonomous clinical action — results are clinician-review-gated",
    description:
      "The Lab Result & Critical-Value Notification Agent may NEVER autonomously act on a result — it does not order a test, prescribe, treat, or change a care plan. Any abnormal / critical result is a flag escalated for clinician review (requiresClinicianReview:true). A determination that asserts an autonomous action on a non-normal result (a non-normal result not gated on clinician review) is rejected before it can leave the fabric, so a result recommendation can never become an unattended clinical action. Mirrors the Utilization Review Agent's no-autonomous-denial, the Risk Adjustment Agent's no-autonomous-submission, and the Prior Authorization Agent's clinician-approval posture — the safe answer is enforced. (In the prototype the analyte catalog is a clearly-labeled illustrative synthetic; in production this is the health system's governed result-management workflow with a clinician-in-the-loop review + a signed audit trail.)",
    appliesTo: ["lab-result-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.gfe.charge-master-sourced",
    name: "Every line item must be priced from the charge master",
    description:
      "Every priced line item the Good Faith Estimate Agent produces must trace to a recorded charge-master entry at the catalog amount — there are no ad-hoc, fabricated, or off-schedule charges. A determination with an off-catalog service id or an amount that doesn't match the charge master is rejected before it can leave the fabric, so a GFE can never quote a charge that isn't in the charge master. Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Lab Result Agent's reference-range-sourced posture — every figure traces to a defined source. (In the prototype the charge master is a clearly-labeled illustrative synthetic; in production this is the provider's actual chargemaster / price-transparency file.)",
    appliesTo: ["good-faith-estimate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.gfe.expected-items-complete",
    name: "The estimate must include all reasonably-expected items",
    description:
      "The Good Faith Estimate Agent's estimate must include the primary service AND every reasonably-expected co-item for it — an incomplete estimate that omits an expected item UNDERSTATES the total and misleads the patient. The No Surprises Act (45 CFR 149.610) requires the convening provider to include items/services reasonably expected to be furnished. A determination missing the primary or an expected co-item is rejected before it can leave the fabric, so the fabric can never issue a materially incomplete estimate. This is the load-bearing gate — it mirrors the Care Coordination Handoff Agent's SBAR-completeness and the Lab Result Agent's critical-value-notified: a completeness obligation that cannot be skipped. (In the prototype the expected-co-item rules are clearly-labeled illustrative synthetics.)",
    appliesTo: ["good-faith-estimate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.gfe.estimate-not-binding",
    name: "A GFE is an estimate — never a binding bill",
    description:
      "A Good Faith Estimate is an ESTIMATE requiring patient confirmation, NEVER a final / binding charge — and if the actual bill exceeds the GFE by $400 or more the patient has No Surprises Act dispute rights. A determination presented as a binding bill (binding:true) is rejected before it can leave the fabric, so a GFE can never become an unattended binding charge. Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Financial Assistance Agent's no-autonomous-denial posture — the agent recommends, a human confirms. (In the prototype the charge master is a clearly-labeled illustrative synthetic; in production this is the provider's governed patient-estimate workflow with a financial-counselor confirmation + a signed audit trail.)",
    appliesTo: ["good-faith-estimate-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.balancebill.protection-basis-sourced",
    name: "Every determination must cite a recorded protection basis",
    description:
      "Every balance-billing determination the Balance Billing Protection Agent produces must cite a recorded No Surprises Act protection basis from the catalog (emergency, out-of-network at an in-network facility, air ambulance, ground ambulance, in-network) — there is no ad-hoc, un-sourced protection call. A determination with a missing or off-catalog basis id is rejected before it can leave the fabric, so protection can never be decided against anything other than a defined basis. Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Good Faith Estimate Agent's charge-master-sourced posture — every decision traces to a defined source. (In the prototype the basis catalog is a clearly-labeled illustrative synthetic; in production this is the payer's NSA-configured protection logic under 45 CFR 149.)",
    appliesTo: ["balance-billing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.balancebill.cost-share-in-network-basis",
    name: "A protected patient's cost-share is on the in-network (QPA) basis",
    description:
      "For a PROTECTED claim, the Balance Billing Protection Agent must compute the patient's cost-sharing on the in-network (Qualifying Payment Amount) basis — NEVER the out-of-network billed charge. The No Surprises Act (45 CFR 149.110–149.130) requires cost-sharing for a protected service to be based on the recognized amount (the QPA); basing it on the billed charge over-charges the patient. A determination that bases a protected patient's cost-share on the billed charge is rejected before it can leave the fabric, so a protected patient can never be over-charged. This is the load-bearing gate — it mirrors the Overpayment & Recovery Agent's within-lookback-window: a legal basis bounds the dollar figure. (In the prototype the QPA amounts are clearly-labeled illustrative synthetics.)",
    appliesTo: ["balance-billing-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.balancebill.no-autonomous-balance-bill",
    name: "A protected claim is never balance-billed",
    description:
      "A PROTECTED claim can NEVER be balance-billed — the difference between the billed charge and the allowed amount may not be billed to the patient, and a balance bill is never issued autonomously against a protected patient. A determination that allows a balance bill on a protected claim is rejected before it can leave the fabric, so an unlawful balance bill can never be issued to a protected patient; a permitted balance bill on a NON-protected claim (a valid notice-and-consent waiver, an out-of-network ground ambulance) is a RECOMMENDATION requiring human review (requiresHumanReview:true). Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off. (In the prototype the protection bases + waiver rules are clearly-labeled illustrative synthetics; in production this is the payer's governed NSA workflow with a human-in-the-loop review + a signed audit trail.)",
    appliesTo: ["balance-billing-agent"],
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
      "Commercial-operations agents (pipeline, account management, provider contracting) run on Sales Cloud commercial data only. They may not read, join, or derive patient PHI — the commercial plane and the clinical/PHI plane are strictly separated, and any cross-plane read is blocked. (This is also why these agents are NOT on the HIPAA audit policy: they never touch PHI.)",
    appliesTo: [
      "pipeline-management-agent",
      "account-management-agent",
      "provider-contracting-agent",
      "deal-desk-agent"
    ],
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
  },
  {
    id: "policy.contracting.contract-type-catalog-sourced",
    name: "Provider contracts must trace to the contract-type catalog",
    description:
      "Every classified provider-network contract the Provider Contracting Agent decides on must trace to the defined CONTRACT_TYPES catalog (fee-for-service, capitation, shared-savings, bundled-payment, MA-value-based, commercial-VBC), the BENCHMARK_METHODOLOGIES catalog for VBC methodologies, and applied rules from CONTRACTING_RULES with reason codes from CONTRACTING_REASON_CODES — an off-catalog / bespoke payment model is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the Formulary Agent's catalog-sourced, the FWA Agent's pattern-catalog-sourced, the Trial Payments Agent's schedule-catalog-sourced, and the UR Agent's criteria-catalog-sourced posture.",
    appliesTo: ["provider-contracting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.contracting.no-autonomous-term-change",
    name: "No autonomous contract-term change — account-owner cosign required",
    description:
      "The Provider Contracting Agent may NEVER autonomously commit a contract-term change (rate, quality-gate threshold, benchmark formula, network status) — every draft-term-change decision requires account-owner cosign. Every draft-term-change decision is requiresAccountOwnerCosign:true / cosigned:false; a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. A contract-term change is legally consequential under state insurance code, provider-contract law, and CMS Medicare Advantage. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, the FWA Agent's no-autonomous-denial, the Trial Payments Agent's no-autonomous-irb-deviation, and the Account Management Agent's human-owner-before-contract-change posture.",
    appliesTo: ["provider-contracting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.contracting.benchmark-methodology-catalog-sourced",
    name: "VBC benchmarks must trace to the methodology catalog",
    description:
      "Every VBC contract's quality-gate threshold and spend-drift tolerance must trace to a defined BENCHMARK_METHODOLOGIES catalog entry (methodology.mssp-shared-savings-my2026, methodology.ma-star-vbc-my2026, methodology.commercial-vbc-my2026, methodology.bundled-episode-flat-benchmark) — a bespoke / opaque / 'we-picked-a-number' benchmark is rejected before it can leave the fabric. An opaque benchmark polluts every downstream shared-savings / bonus / clawback calculation. Mirrors the Quality-Measure Attribution Agent's methodology-catalog-sourced posture.",
    appliesTo: ["provider-contracting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.dealdesk.pricing-catalog-sourced",
    name: "Every quote line prices from the recorded catalog",
    description:
      "The Deal Desk Agent may NEVER price a quote line whose product is off-catalog (a missing or unrecognized product id) — an ad-hoc product cannot be correctly priced or guardrailed against the recorded price book. A decision pricing an off-catalog product is rejected before it can leave the fabric. Mirrors the Provider Contracting Agent's contract-type-catalog-sourced and the Good Faith Estimate Agent's charge-master-sourced posture. (In the prototype the product catalog is a clearly-labeled illustrative synthetic; in production the price book comes from the company's CPQ — e.g. Salesforce Revenue Cloud.)",
    appliesTo: ["deal-desk-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.dealdesk.discount-math-consistent",
    name: "The quote totals equal the computed line sums",
    description:
      "The Deal Desk Agent's list / net / discount totals and effective discount must equal the recomputed sums of the quote's line items — a guessed / hidden total is how an out-of-guardrail quote is dressed up as compliant. A decision whose totals do not add up is rejected before it can leave the fabric. This is the load-bearing correctness gate. Mirrors the Good Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid posture.",
    appliesTo: ["deal-desk-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.dealdesk.no-autonomous-out-of-guardrail-approval",
    name: "An out-of-guardrail discount is never autonomously approved",
    description:
      "The Deal Desk Agent may NEVER auto-approve (autoApproved:true) a quote with any line whose discount exceeds its product's max auto-approve guardrail — an out-of-guardrail discount is a RECOMMENDATION that must escalate to a human deal-desk owner (requiresDealDeskApproval:true). A within-guardrail quote is genuinely auto-approvable (a standard-discount quote does not need a human); only an out-of-guardrail exception is gated. A decision that auto-approves an out-of-guardrail quote is rejected before it can leave the fabric. Mirrors the Account Management Agent's human-owner-before-contract-change and the Provider Contracting Agent's no-autonomous-term-change posture — the harmful action is enforced-off.",
    appliesTo: ["deal-desk-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.handoff.sbar-completeness",
    name: "Handoffs must have a complete SBAR (Joint Commission NPSG-2)",
    description:
      "Every cross-setting handoff the Care Coordination Handoff Agent accepts must have all four SBAR sections (situation, background, assessment, recommendation) populated — the Joint Commission National Patient Safety Goal 2 requires standardized handoff communication. A handoff-accepted decision missing a section is rejected before it can leave the fabric; the safe answer when incomplete is decision:'pend-sbar-incomplete' routed to sending-clinician-completion. (In the prototype the SBAR fields are illustrative structured labels — NOT free-text PHI; in production this is the customer's Joint-Commission-compliant handoff template.)",
    appliesTo: ["care-coordination-handoff-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.handoff.receiving-clinician-credentialed",
    name: "Handoffs must route to a credentialed receiving clinician",
    description:
      "Every cross-setting handoff must route to a receiving clinician whose credentialing status is current and unsanctioned — a handoff to an expired / incomplete / sanctioned clinician is a ghost-network variant and a Section 1557 / due-process failure. A handoff-accepted decision to an uncredentialed clinician is rejected before it can leave the fabric; the safe answer is decision:'blocked-clinician-not-credentialed' routed to credentialing-remediation. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture.",
    appliesTo: ["care-coordination-handoff-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.handoff.consent-on-file",
    name: "Cross-setting handoffs require transfer consent (HIPAA)",
    description:
      "Cross-setting handoffs on transition types that share PHI with a new setting (hospital→SNF, SNF→home, home→hospice, PCP→behavioral-health) require documented patient consent to share clinical information with the receiving setting — a handoff-accepted decision without transfer consent on file is rejected before it can leave the fabric. Sharing clinical information with a new setting without patient consent is a HIPAA disclosure failure. The safe answer is decision:'blocked-no-consent' routed to consent-capture. Mirrors the Consent & Preferences Management Agent's consent-scope posture.",
    appliesTo: ["care-coordination-handoff-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adverse-event.event-catalog-sourced",
    name: "Adverse events must trace to the event-type catalog",
    description:
      "Every adverse-event decision the Adverse Event Reporting Agent produces must trace to the defined ADVERSE_EVENT_TYPES catalog (drug ADR, vaccine reaction, device malfunction, medication error, therapeutic failure) AND to a seriousness tier from SERIOUSNESS_TIERS (aligned with 21 CFR 314.80: non-serious / serious / life-threatening / death) AND to applied rules from ADVERSE_EVENT_RULES with reason codes from ADVERSE_EVENT_REASON_CODES — an off-catalog / bespoke event type or a made-up severity level is rejected before it can leave the fabric. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the Formulary Agent's catalog-sourced, the FWA Agent's pattern-catalog-sourced, the Trial Payments Agent's schedule-catalog-sourced, the UR Agent's criteria-catalog-sourced, and the Handoff Agent's SBAR-completeness posture. (In the prototype the event catalog is a clearly-labeled illustrative synthetic; in production this is the customer's pharmacovigilance codes plus MedDRA / SNOMED CT integration.)",
    appliesTo: ["adverse-event-reporting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adverse-event.no-autonomous-submission",
    name: "No autonomous MedWatch / VAERS submission — regulatory-team cosign required",
    description:
      "The Adverse Event Reporting Agent may NEVER autonomously submit a MedWatch (3500 / 3500A) or VAERS report to the FDA — every draft decision requires regulatory-team cosign. Every draft-medwatch or draft-vaers decision is requiresRegulatoryTeamCosign:true / cosigned:false; a caller-asserted plan that claims cosigned:true or bypasses the cosign gate is rejected before it can leave the fabric. FDA submissions are legally consequential under 21 CFR 314.80 (mandatory reporting) with sponsor / manufacturer / clinician liability. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, the FWA Agent's no-autonomous-denial, the Trial Payments Agent's no-autonomous-irb-deviation, and the HEDIS Agent's no-autonomous-submission posture.",
    appliesTo: ["adverse-event-reporting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.adverse-event.reporter-verified",
    name: "Adverse-event reports require a verified reporter identity",
    description:
      "The Adverse Event Reporting Agent may NEVER draft a MedWatch or VAERS submission without an attested, identifiable reporter (name / credentials / contact). An anonymous or unverified reporter is not admissible under FDA reporting requirements and poisons the pharmacovigilance surveillance signal. A draft decision with reporterIdentityVerified:false is rejected before it can leave the fabric; the safe answer is decision:'blocked-reporter-unverified' routed to blocked-hold.",
    appliesTo: ["adverse-event-reporting-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data-sharing.purpose-catalog-sourced",
    name: "Data-sharing exchanges must trace to the exchange-purpose catalog",
    description:
      "Every data-sharing decision the Data-Sharing / TEFCA Interoperability Agent produces must trace to the defined EXCHANGE_PURPOSES catalog (treatment / payment / operations / patient-request / public-health / research), EXCHANGE_NETWORKS catalog (TEFCA QHIN / Carequality / CommonWell / Direct Secure Messaging), DATA_SHARING_RULES, and DATA_SHARING_REASON_CODES — an off-catalog / bespoke exchange purpose is rejected before it can leave the fabric. A bespoke purpose doesn't map to a HIPAA disclosure permission and would open the network to unauthorized aggregation. Mirrors the Claims Adjudication Agent's edit-catalog-sourced, the FWA Agent's pattern-catalog-sourced, the Trial Payments Agent's schedule-catalog-sourced, the UR Agent's criteria-catalog-sourced, the Handoff Agent's SBAR-completeness, and the Adverse Event Reporting Agent's event-catalog-sourced posture.",
    appliesTo: ["data-sharing-tefca-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data-sharing.no-autonomous-non-tpo-release",
    name: "No autonomous PHI release for non-TPO purposes without consent",
    description:
      "The Data-Sharing / TEFCA Interoperability Agent may NEVER autonomously release PHI for a non-TPO purpose (research, public-health, patient-request, or any off-catalog use) without an active patient consent scope on file for that exact purpose. Every non-TPO release without consent is rejected before it can leave the fabric; the safe answer is decision:'blocked-consent-required-non-tpo' routed to consent-capture. This is the load-bearing HIPAA §164.506 boundary — TPO (treatment / payment / operations) doesn't need consent, but every other purpose does. Unauthorized non-TPO disclosures are the documented breach pattern behind the majority of OCR enforcement actions. Mirrors the Consent & Preferences Management Agent's no-scope-override, the Grievance & Appeals Agent's no-phi-in-routing-summary, and the Handoff Agent's transfer-consent posture.",
    appliesTo: ["data-sharing-tefca-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data-sharing.participant-verified",
    name: "Data-sharing exchanges require a verified participant identity",
    description:
      "The Data-Sharing / TEFCA Interoperability Agent may NEVER release PHI to a counterparty whose identity is not attested against the TEFCA / Carequality / CommonWell participant registry — under 45 CFR 171 + the TEFCA Common Agreement a QHIN / participant / sub-participant must be identity-attested before a cross-org exchange is authorized. A release-authorized decision with requesterIdentityVerified:false is rejected before it can leave the fabric; the safe answer is decision:'blocked-participant-unverified' routed to participant-registry-verification. Releasing to an unverified counterparty is a federated-identity trust failure that opens the network to spoofing and unauthorized aggregation. Mirrors the Provider Credentialing Agent's source-integrity, the Adverse Event Reporting Agent's reporter-verified, and the Handoff Agent's receiving-clinician-credentialed posture.",
    appliesTo: ["data-sharing-tefca-agent"],
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
// FWA Detection seed — an impossible-day billing flag routed to SIU
// priority queue. Illustrative; not certified FWA. Seed data; production
// populates the ring buffer from the persistent log store.
// Trial Payments seed — a schedule-approved standard treatment visit
// stipend + travel. Illustrative; not certified trial payments. Seed data;
// production populates the ring buffer from the persistent log store.
(function seedTrialPaymentsTrace() {
  const s = store();
  const tp0 = Date.now() - 1000 * 60 * 1;
  const tpTaskId = "task-seed-trial-payments-001";
  const tpName = "Clinical Trial Payments & Stipends Agent";
  s.traces.push(
    {
      id: "span-trial-payments-001",
      taskId: tpTaskId,
      agentId: "trial-payments-agent",
      agentName: tpName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(tp0).toISOString(),
      finishedAt: new Date(tp0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-trial-payments-002",
      taskId: tpTaskId,
      parentSpanId: "span-trial-payments-001",
      agentId: "trial-payments-agent",
      agentName: tpName,
      operation: "trial-payments.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(tp0 + 40).toISOString(),
      finishedAt: new Date(tp0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "tp-req-2026-07-001",
        participantRef: "participant-001",
        trialId: "trial.mn-vasomotor-fezolinetant-p3",
        appliedRuleCount: 1,
        // The honesty invariants: every rule is catalog-sourced; participant
        // consent is on file.
        paymentsTraceToCatalog: true,
        paymentHasParticipantConsent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-trial-payments-003",
      taskId: tpTaskId,
      parentSpanId: "span-trial-payments-002",
      agentId: "trial-payments-agent",
      agentName: tpName,
      operation: "trial-payments.decide",
      protocol: "a2a",
      startedAt: new Date(tp0 + 90).toISOString(),
      finishedAt: new Date(tp0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "schedule-approved",
        stipendAmountCents: 15000,
        travelReimbursementCents: 840,
        primaryReasonCode: "reason.TP-100",
        routedTo: "schedule-auto-pay",
        requiresCoordinatorCosign: false,
        // The load-bearing invariant: schedule-approved decisions don't
        // need cosign; non-schedule decisions ALWAYS do.
        deviationRequiresCoordinatorCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Utilization Review seed — a hysterectomy request with a missing first-line
// criterion, pend-for-clinical-review with UR-200 and a 72h standard SLA.
// Illustrative; not certified UR. Seed data; production populates the ring
// buffer from the persistent log store.
(function seedUtilizationReviewTrace() {
  const s = store();
  const ur0 = Date.now() - 1000 * 60 * 1;
  const urTaskId = "task-seed-utilization-review-001";
  const urName = "Utilization Review Agent";
  s.traces.push(
    {
      id: "span-utilization-review-001",
      taskId: urTaskId,
      agentId: "utilization-review-agent",
      agentName: urName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ur0).toISOString(),
      finishedAt: new Date(ur0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-utilization-review-002",
      taskId: urTaskId,
      parentSpanId: "span-utilization-review-001",
      agentId: "utilization-review-agent",
      agentName: urName,
      operation: "utilization-review.evaluate-criteria",
      protocol: "a2a",
      startedAt: new Date(ur0 + 40).toISOString(),
      finishedAt: new Date(ur0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "ur-req-2026-07-002",
        memberRef: "member-002",
        serviceTypeId: "service.hysterectomy-abnormal-bleeding",
        appliedRuleCount: 2,
        criteriaMissingCount: 1,
        // The honesty invariants: every criterion + rule is catalog-sourced;
        // the SLA deadline traces to the catalog urgency window.
        criteriaTraceToCatalog: true,
        slaTracesToCatalog: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-utilization-review-003",
      taskId: urTaskId,
      parentSpanId: "span-utilization-review-002",
      agentId: "utilization-review-agent",
      agentName: urName,
      operation: "utilization-review.decide",
      protocol: "a2a",
      startedAt: new Date(ur0 + 90).toISOString(),
      finishedAt: new Date(ur0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "pend-for-clinical-review",
        primaryReasonCode: "reason.UR-200",
        routedTo: "clinical-reviewer-queue",
        slaWindowHours: 72,
        requiresClinicianCosign: true,
        // The load-bearing invariant: non-approved decisions ALWAYS require
        // clinician cosign — the agent never autonomously denies.
        denialRequiresClinicianCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Provider Contracting seed — a shared-savings contract with quality-gate
// missed, routed to account-manager drift review. Illustrative; not
// certified contracting. Seed data; production populates the ring buffer
// from the persistent log store. On the commercial plane — no PHI.
(function seedProviderContractingTrace() {
  const s = store();
  const pc0 = Date.now() - 1000 * 60 * 1;
  const pcTaskId = "task-seed-provider-contracting-001";
  const pcName = "Provider Contracting & VBC Terms Agent";
  s.traces.push(
    {
      id: "span-provider-contracting-001",
      taskId: pcTaskId,
      agentId: "provider-contracting-agent",
      agentName: pcName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(pc0).toISOString(),
      finishedAt: new Date(pc0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        // Commercial plane — no PHI accessed.
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-provider-contracting-002",
      taskId: pcTaskId,
      parentSpanId: "span-provider-contracting-001",
      agentId: "provider-contracting-agent",
      agentName: pcName,
      operation: "provider-contracting.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(pc0 + 40).toISOString(),
      finishedAt: new Date(pc0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "pc-req-2026-07-002",
        providerRef: "provider-002",
        contractRef: "contract-002",
        contractTypeId: "contract-type.shared-savings",
        methodologyId: "methodology.mssp-shared-savings-my2026",
        appliedRuleCount: 1,
        // The honesty invariants: every rule is catalog-sourced; benchmark
        // traces to the methodology catalog.
        contractsTraceToCatalog: true,
        benchmarksTraceToMethodology: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-provider-contracting-003",
      taskId: pcTaskId,
      parentSpanId: "span-provider-contracting-002",
      agentId: "provider-contracting-agent",
      agentName: pcName,
      operation: "provider-contracting.decide",
      protocol: "a2a",
      startedAt: new Date(pc0 + 90).toISOString(),
      finishedAt: new Date(pc0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "benchmark-drift-review",
        primaryReasonCode: "reason.PC-200",
        routedTo: "account-manager-drift-review",
        qualityGateMet: false,
        requiresAccountOwnerCosign: false,
        // The load-bearing invariant: draft-term-change decisions ALWAYS
        // require account-owner cosign — the agent never autonomously
        // commits a contract-term change.
        contractChangeRequiresOwnerCosign: true,
        phiAccessed: false,
        synthetic: true
      }
    }
  );
})();

// Care Coordination Handoff seed — a hospital→SNF transition with a
// complete SBAR, credentialed receiving clinician, and transfer consent
// on file, accepted and routed to the receiving-clinician-inbox for cosign.
// Illustrative; not certified handoff. Seed data; production populates
// the ring buffer from the persistent log store.
(function seedCareCoordinationHandoffTrace() {
  const s = store();
  const ho0 = Date.now() - 1000 * 60 * 1;
  const hoTaskId = "task-seed-care-coordination-handoff-001";
  const hoName = "Care Coordination Handoff Agent";
  s.traces.push(
    {
      id: "span-care-coordination-handoff-001",
      taskId: hoTaskId,
      agentId: "care-coordination-handoff-agent",
      agentName: hoName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ho0).toISOString(),
      finishedAt: new Date(ho0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-care-coordination-handoff-002",
      taskId: hoTaskId,
      parentSpanId: "span-care-coordination-handoff-001",
      agentId: "care-coordination-handoff-agent",
      agentName: hoName,
      operation: "care-coordination-handoff.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(ho0 + 40).toISOString(),
      finishedAt: new Date(ho0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "ho-req-2026-07-001",
        patientRef: "patient-001",
        transitionTypeId: "transition.hospital-to-snf",
        appliedRuleCount: 1,
        missingSbarCount: 0,
        // The honesty invariants: SBAR is complete; receiving clinician is
        // credentialed; transfer consent is on file for this transition.
        sbarIsComplete: true,
        receivingClinicianIsCredentialed: true,
        handoffHasConsent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-care-coordination-handoff-003",
      taskId: hoTaskId,
      parentSpanId: "span-care-coordination-handoff-002",
      agentId: "care-coordination-handoff-agent",
      agentName: hoName,
      operation: "care-coordination-handoff.decide",
      protocol: "a2a",
      startedAt: new Date(ho0 + 90).toISOString(),
      finishedAt: new Date(ho0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "handoff-accepted",
        primaryReasonCode: "reason.HO-100",
        routedTo: "receiving-clinician-inbox",
        // Every accepted handoff still needs receiving-clinician cosign —
        // the agent never autonomously accepts on behalf of the clinician.
        requiresReceivingClinicianCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Adverse Event Reporting seed — a serious drug ADR (hospitalization)
// classified into the MedWatch channel and routed to the regulatory-team
// queue for cosign. Illustrative; not certified pharmacovigilance. Seed
// data; production populates the ring buffer from the persistent log store.
(function seedAdverseEventReportingTrace() {
  const s = store();
  const ae0 = Date.now() - 1000 * 60 * 1;
  const aeTaskId = "task-seed-adverse-event-reporting-001";
  const aeName = "Adverse Event Reporting Agent";
  s.traces.push(
    {
      id: "span-adverse-event-reporting-001",
      taskId: aeTaskId,
      agentId: "adverse-event-reporting-agent",
      agentName: aeName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ae0).toISOString(),
      finishedAt: new Date(ae0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-adverse-event-reporting-002",
      taskId: aeTaskId,
      parentSpanId: "span-adverse-event-reporting-001",
      agentId: "adverse-event-reporting-agent",
      agentName: aeName,
      operation: "adverse-event-reporting.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(ae0 + 40).toISOString(),
      finishedAt: new Date(ae0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "ae-req-2026-07-001",
        patientRef: "patient-001",
        eventTypeId: "event.drug-adr",
        seriousnessTierId: "seriousness.serious",
        appliedRuleCount: 1,
        // The honesty invariants: event + seriousness are catalog-sourced;
        // reporter identity is attested.
        eventsTraceToCatalog: true,
        reporterIdentityVerified: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-adverse-event-reporting-003",
      taskId: aeTaskId,
      parentSpanId: "span-adverse-event-reporting-002",
      agentId: "adverse-event-reporting-agent",
      agentName: aeName,
      operation: "adverse-event-reporting.decide",
      protocol: "a2a",
      startedAt: new Date(ae0 + 90).toISOString(),
      finishedAt: new Date(ae0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "draft-medwatch",
        primaryReasonCode: "reason.AE-100",
        routedTo: "regulatory-team-medwatch-queue",
        requiresRegulatoryTeamCosign: true,
        // The load-bearing invariant: draft decisions ALWAYS require
        // regulatory-team cosign — the agent never autonomously files to
        // the FDA.
        submissionRequiresRegulatoryTeamCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Data-Sharing / TEFCA seed — a TPO treatment exchange over the TEFCA
// QHIN, authorized without consent (HIPAA §164.506) after participant
// verification. Illustrative; not certified TEFCA. Seed data; production
// populates the ring buffer from the persistent log store.
(function seedDataSharingTefcaTrace() {
  const s = store();
  const ds0 = Date.now() - 1000 * 60 * 1;
  const dsTaskId = "task-seed-data-sharing-tefca-001";
  const dsName = "Data-Sharing / TEFCA Interoperability Agent";
  s.traces.push(
    {
      id: "span-data-sharing-tefca-001",
      taskId: dsTaskId,
      agentId: "data-sharing-tefca-agent",
      agentName: dsName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ds0).toISOString(),
      finishedAt: new Date(ds0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-data-sharing-tefca-002",
      taskId: dsTaskId,
      parentSpanId: "span-data-sharing-tefca-001",
      agentId: "data-sharing-tefca-agent",
      agentName: dsName,
      operation: "data-sharing-tefca.evaluate-rules",
      protocol: "a2a",
      startedAt: new Date(ds0 + 40).toISOString(),
      finishedAt: new Date(ds0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "ds-req-2026-07-001",
        patientRef: "patient-001",
        networkId: "network.tefca-qhin",
        purposeId: "purpose.treatment",
        appliedRuleCount: 1,
        // The honesty invariants: purpose + network + rule are catalog-
        // sourced; requester identity is attested against the participant
        // registry.
        purposesTraceToCatalog: true,
        participantIdentityVerified: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-data-sharing-tefca-003",
      taskId: dsTaskId,
      parentSpanId: "span-data-sharing-tefca-002",
      agentId: "data-sharing-tefca-agent",
      agentName: dsName,
      operation: "data-sharing-tefca.decide",
      protocol: "a2a",
      startedAt: new Date(ds0 + 90).toISOString(),
      finishedAt: new Date(ds0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "release-authorized",
        primaryReasonCode: "reason.DS-100",
        routedTo: "auto-release",
        isTpo: true,
        requiresPrivacyOfficerCosign: false,
        // The load-bearing invariant: non-TPO releases without consent
        // are ALWAYS blocked — HIPAA §164.506 boundary.
        releaseHonorsNonTpoConsent: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedFwaDetectionTrace() {
  const s = store();
  const fw0 = Date.now() - 1000 * 60 * 1;
  const fwTaskId = "task-seed-fwa-001";
  const fwName = "Fraud, Waste & Abuse Detection Agent";
  s.traces.push(
    {
      id: "span-fwa-001",
      taskId: fwTaskId,
      agentId: "fwa-detection-agent",
      agentName: fwName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(fw0).toISOString(),
      finishedAt: new Date(fw0 + 40).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-fwa-002",
      taskId: fwTaskId,
      parentSpanId: "span-fwa-001",
      agentId: "fwa-detection-agent",
      agentName: fwName,
      operation: "fwa.evaluate-patterns",
      protocol: "a2a",
      startedAt: new Date(fw0 + 40).toISOString(),
      finishedAt: new Date(fw0 + 90).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        requestRef: "fwa-req-2026-07-003",
        providerRef: "provider-004",
        claimRef: "claim-2026-07-102",
        flagCount: 1,
        // The honesty invariants: every flag is catalog-sourced; the factor
        // list uses no protected-class attributes.
        patternsTraceToCatalog: true,
        noProtectedClassFactors: true,
        factorsInUseCount: 12,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-fwa-003",
      taskId: fwTaskId,
      parentSpanId: "span-fwa-002",
      agentId: "fwa-detection-agent",
      agentName: fwName,
      operation: "fwa.decide",
      protocol: "a2a",
      startedAt: new Date(fw0 + 90).toISOString(),
      finishedAt: new Date(fw0 + 140).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        decision: "flag-for-siu-review",
        primaryPatternId: "pattern.impossible-day-billing",
        primarySeverity: "high",
        routedTo: "siu-priority-queue",
        requiresSiuReview: true,
        // The load-bearing invariant: never opens an investigation, never
        // freezes payment. Only flags for SIU review.
        reportRequiresSiuReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

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

// Risk Adjustment & HCC Coding seed — a value-based-care documentation-integrity
// run: review the patient's clinical context, suspect the HCCs, compute the
// RAF-style score, and flag the coding gaps for clinician validation. This seed
// shows the HAPPY PATH (the demo patient): two confirmed HCCs (diabetes-with-
// complication + osteoporosis-with-fracture) driving a RAF of 0.739, plus one
// suspected coding gap (major depression — evidence documented but uncoded) that
// is flagged for a clinician to validate. Every suspected code is a
// recommendation (requiresClinicianValidation:true) and the agent never submits
// autonomously (submitted:false). It reads patient context, so every span sets
// phiAccessed:true. The HCC catalog, RAF weights, and evidence are ILLUSTRATIVE
// synthetics, not a certified risk-adjustment / coding engine. Seed data;
// production populates the ring buffer from the persistent log store.
(function seedRiskAdjustmentTrace() {
  const s = store();
  const ra0 = Date.now() - 1000 * 60 * 1;
  const raTaskId = "task-seed-risk-adjustment-001";
  const raName = "Risk Adjustment & HCC Coding Agent";
  s.traces.push(
    {
      id: "span-riskadj-001",
      taskId: raTaskId,
      agentId: "risk-adjustment-agent",
      agentName: raName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ra0).toISOString(),
      finishedAt: new Date(ra0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-riskadj-002",
      taskId: raTaskId,
      parentSpanId: "span-riskadj-001",
      agentId: "risk-adjustment-agent",
      agentName: raName,
      operation: "riskadj.review-documentation",
      protocol: "a2a",
      startedAt: new Date(ra0 + 35).toISOString(),
      finishedAt: new Date(ra0 + 70).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        patientRef: "riskadj-patient-001",
        documentedEvidenceCount: 6,
        codedConditionCount: 2,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-riskadj-003",
      taskId: raTaskId,
      parentSpanId: "span-riskadj-002",
      agentId: "risk-adjustment-agent",
      agentName: raName,
      operation: "riskadj.suspect-hccs",
      protocol: "a2a",
      startedAt: new Date(ra0 + 70).toISOString(),
      finishedAt: new Date(ra0 + 120).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        hccCount: 3,
        confirmedCount: 2,
        suspectedCount: 1,
        unsupportedCount: 0,
        // The load-bearing invariant: every confirmed / suspected HCC traces to
        // documented clinical evidence (no upcoding).
        codesTraceToClinicalEvidence: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-riskadj-004",
      taskId: raTaskId,
      parentSpanId: "span-riskadj-003",
      agentId: "risk-adjustment-agent",
      agentName: raName,
      operation: "riskadj.score",
      protocol: "a2a",
      startedAt: new Date(ra0 + 120).toISOString(),
      finishedAt: new Date(ra0 + 150).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // The sum of the two confirmed HCCs' illustrative RAF weights.
        rafScore: 0.739,
        confirmedCount: 2,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-riskadj-005",
      taskId: raTaskId,
      parentSpanId: "span-riskadj-004",
      agentId: "risk-adjustment-agent",
      agentName: raName,
      operation: "riskadj.flag-for-validation",
      protocol: "a2a",
      startedAt: new Date(ra0 + 150).toISOString(),
      finishedAt: new Date(ra0 + 195).toISOString(),
      durationMs: 45,
      status: "ok",
      attributes: {
        codingGapCount: 1,
        unsupportedFlagCount: 0,
        // Every suspected code is a recommendation requiring clinician validation;
        // the agent never autonomously submits codes or adjusts a claim / RAF.
        requiresClinicianValidation: true,
        codingRequiresClinicianValidation: true,
        noAutonomousCodeSubmission: true,
        submitted: false,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Master Patient Index / Identity Resolution seed — an identity-resolution run:
// load the candidate records, deterministically score each against the incoming
// record with the transparent feature set, resolve the best match, and flag the
// ambiguous candidates for a human steward. This seed shows the HAPPY PATH (the
// demo candidate set): a clear match at MAX_SCORE (100/100 — every feature, a
// shared identifier) driving a merge recommendation, PLUS a possible-match
// candidate (name + DOB + administrative sex only, score 60) flagged for
// manual-review, and a no-match candidate. A merge below the auto threshold is
// never performed autonomously (mergeRequiresHumanReview:true), every match
// traces to the feature spec (matchTracesToFeatures:true), and no protected-class
// attribute is used (excludesProtectedAttributesInMatching:true). It resolves
// patient identifiers, so every span sets phiAccessed:true. The match features,
// weights, thresholds, and records are ILLUSTRATIVE synthetics, not a certified
// EMPI algorithm. Seed data; production populates the ring buffer from the
// persistent log store.
(function seedMasterPatientIndexTrace() {
  const s = store();
  const mpi0 = Date.now() - 1000 * 60 * 1;
  const mpiTaskId = "task-seed-master-patient-index-001";
  const mpiName = "Master Patient Index / Identity Resolution Agent";
  s.traces.push(
    {
      id: "span-mpi-001",
      taskId: mpiTaskId,
      agentId: "master-patient-index-agent",
      agentName: mpiName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(mpi0).toISOString(),
      finishedAt: new Date(mpi0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mpi-002",
      taskId: mpiTaskId,
      parentSpanId: "span-mpi-001",
      agentId: "master-patient-index-agent",
      agentName: mpiName,
      operation: "mpi.load-candidates",
      protocol: "a2a",
      startedAt: new Date(mpi0 + 35).toISOString(),
      finishedAt: new Date(mpi0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        incomingRef: "mpi-incoming-001",
        candidateCount: 3,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mpi-003",
      taskId: mpiTaskId,
      parentSpanId: "span-mpi-002",
      agentId: "master-patient-index-agent",
      agentName: mpiName,
      operation: "mpi.score",
      protocol: "a2a",
      startedAt: new Date(mpi0 + 65).toISOString(),
      finishedAt: new Date(mpi0 + 115).toISOString(),
      durationMs: 50,
      status: "ok",
      attributes: {
        candidateCount: 3,
        bestScore: 100,
        // The load-bearing invariant: every match traces to the feature spec
        // (transparent, not a black box) and no protected-class attribute is used.
        matchTracesToFeatures: true,
        excludesProtectedAttributesInMatching: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mpi-004",
      taskId: mpiTaskId,
      parentSpanId: "span-mpi-003",
      agentId: "master-patient-index-agent",
      agentName: mpiName,
      operation: "mpi.resolve",
      protocol: "a2a",
      startedAt: new Date(mpi0 + 115).toISOString(),
      finishedAt: new Date(mpi0 + 150).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        bestMatchId: "mpi-candidate-clear-001",
        bestScore: 100,
        classification: "match",
        recommendation: "merge",
        // The load-bearing invariant: a merge below the auto threshold is never
        // performed autonomously.
        mergeRequiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mpi-005",
      taskId: mpiTaskId,
      parentSpanId: "span-mpi-004",
      agentId: "master-patient-index-agent",
      agentName: mpiName,
      operation: "mpi.flag-for-review",
      protocol: "a2a",
      startedAt: new Date(mpi0 + 150).toISOString(),
      finishedAt: new Date(mpi0 + 190).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        matchCount: 1,
        // One ambiguous possible-match is flagged for a human steward — the
        // manual-review example (a safe answer, not a block).
        possibleMatchCount: 1,
        noMatchCount: 1,
        // The best match is a clean at-threshold merge, so it does not itself
        // require human review; a below-threshold merge always would.
        requiresHumanReview: false,
        mergeRequiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Break-the-Glass / Emergency Access Governance seed — an emergency-access run:
// receive the break-the-glass request, deterministically evaluate it, grant a
// TIME-BOXED, MINIMUM-NECESSARY scoped access, and log the mandatory audit event
// flagged for post-access review. This seed shows the HAPPY PATH (the demo
// request): an emergency physician breaking the glass for an unstable ED patient
// with a recorded justification → a minimum-necessary grant scoped to allergies /
// medications / problems / vitals (4 fields, NOT the full chart), time-boxed to 60
// minutes, logged, and flagged for post-access review. No standing access is ever
// granted (accessIsMinimumNecessaryTimeBoxed:true), every access carries a
// recorded justification (accessHasJustification:true), and every access is logged
// for review (accessLoggedForReview:true). It touches patient PHI, so every span
// sets phiAccessed:true. The purpose catalog, scopes, durations, and audit ids are
// ILLUSTRATIVE synthetics, not a certified break-the-glass system. Seed data;
// production populates the ring buffer from the persistent log store.
(function seedBreakTheGlassTrace() {
  const s = store();
  const btg0 = Date.now() - 1000 * 60 * 1;
  const btgTaskId = "task-seed-break-the-glass-001";
  const btgName = "Break-the-Glass / Emergency Access Governance Agent";
  s.traces.push(
    {
      id: "span-btg-001",
      taskId: btgTaskId,
      agentId: "break-the-glass-agent",
      agentName: btgName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(btg0).toISOString(),
      finishedAt: new Date(btg0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-btg-002",
      taskId: btgTaskId,
      parentSpanId: "span-btg-001",
      agentId: "break-the-glass-agent",
      agentName: btgName,
      operation: "btg.receive-request",
      protocol: "a2a",
      startedAt: new Date(btg0 + 35).toISOString(),
      finishedAt: new Date(btg0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "btg-patient-001",
        requesterRole: "emergency-physician",
        purpose: "emergency-treatment",
        emergency: true,
        // The honesty invariant: a grant requires a recorded justification.
        accessHasJustification: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-btg-003",
      taskId: btgTaskId,
      parentSpanId: "span-btg-002",
      agentId: "break-the-glass-agent",
      agentName: btgName,
      operation: "btg.evaluate",
      protocol: "a2a",
      startedAt: new Date(btg0 + 65).toISOString(),
      finishedAt: new Date(btg0 + 105).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        granted: true,
        // The honesty invariant: the grant is minimum-necessary and time-boxed.
        accessIsMinimumNecessaryTimeBoxed: true,
        accessHasJustification: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-btg-004",
      taskId: btgTaskId,
      parentSpanId: "span-btg-003",
      agentId: "break-the-glass-agent",
      agentName: btgName,
      operation: "btg.grant-scoped",
      protocol: "a2a",
      startedAt: new Date(btg0 + 105).toISOString(),
      finishedAt: new Date(btg0 + 140).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        granted: true,
        // Minimum-necessary: 4 fields, NOT the full chart; time-boxed to 60 min.
        grantedFieldCount: 4,
        durationMinutes: 60,
        expiresAt: "2026-03-01T03:30:00.000Z",
        accessIsMinimumNecessaryTimeBoxed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-btg-005",
      taskId: btgTaskId,
      parentSpanId: "span-btg-004",
      agentId: "break-the-glass-agent",
      agentName: btgName,
      operation: "btg.log-audit",
      protocol: "a2a",
      startedAt: new Date(btg0 + 140).toISOString(),
      finishedAt: new Date(btg0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        auditEventId: "btg-audit-btg-patient-001-emergency-treatment-20260301023000",
        // The honesty invariant: every access is logged AND post-access reviewed.
        requiresPostAccessReview: true,
        accessLoggedForReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Data Retention & Records Lifecycle Management seed — a records-disposition run:
// receive the record, deterministically evaluate it against the retention schedule
// + legal hold, recommend a disposition, and log the decision to the audit trail.
// This seed shows the ELIGIBLE-FOR-PURGE case (the demo purge-eligible request): an
// old billing / claim record last touched in 2016, well past its 7-year retention
// expiry (2023-03-01), with NO active legal hold → eligible-for-purge. It is a
// RECOMMENDATION requiring human approval (requiresHumanApproval:true) — NOT a
// deletion and NOT a block — which is how a legitimate recommendation is
// distinguished from a governance block. Every disposition cites a recorded
// retention rule (retentionRuleCited:true), a legal hold would always override a
// purge (retentionRespectsLegalHold:true here — there is no hold), and a purge is
// never autonomous (purgeHumanApproved:true). It touches patient records, so every
// span sets phiAccessed:true. The retention schedules, periods, and rule ids are
// ILLUSTRATIVE synthetics, NOT a certified records-management system — real
// retention is jurisdiction-specific and legally reviewed. Seed data; production
// populates the ring buffer from the persistent log store.
(function seedRecordsRetentionTrace() {
  const s = store();
  const ret0 = Date.now() - 1000 * 60 * 1;
  const retTaskId = "task-seed-records-retention-001";
  const retName = "Data Retention & Records Lifecycle Management Agent";
  s.traces.push(
    {
      id: "span-retention-001",
      taskId: retTaskId,
      agentId: "records-retention-agent",
      agentName: retName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ret0).toISOString(),
      finishedAt: new Date(ret0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-retention-002",
      taskId: retTaskId,
      parentSpanId: "span-retention-001",
      agentId: "records-retention-agent",
      agentName: retName,
      operation: "retention.receive-record",
      protocol: "a2a",
      startedAt: new Date(ret0 + 35).toISOString(),
      finishedAt: new Date(ret0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        recordId: "retention-record-002",
        patientRef: "retention-patient-002",
        recordType: "billing-claim",
        underLegalHold: false,
        // The honesty invariant: every disposition cites a recorded schedule.
        retentionRuleCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-retention-003",
      taskId: retTaskId,
      parentSpanId: "span-retention-002",
      agentId: "records-retention-agent",
      agentName: retName,
      operation: "retention.evaluate",
      protocol: "a2a",
      startedAt: new Date(ret0 + 65).toISOString(),
      finishedAt: new Date(ret0 + 105).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        recommendation: "eligible-for-purge",
        retentionRuleId: "rule.retention.billing-claim-7y",
        retentionExpiresAt: "2023-03-01T00:00:00.000Z",
        // The honesty invariant: a legal hold always overrides a purge (none here).
        retentionRespectsLegalHold: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-retention-004",
      taskId: retTaskId,
      parentSpanId: "span-retention-003",
      agentId: "records-retention-agent",
      agentName: retName,
      operation: "retention.recommend",
      protocol: "a2a",
      startedAt: new Date(ret0 + 105).toISOString(),
      finishedAt: new Date(ret0 + 140).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        recommendation: "eligible-for-purge",
        // The honesty invariant: a purge is a recommendation requiring human approval.
        requiresHumanApproval: true,
        purgeHumanApproved: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-retention-005",
      taskId: retTaskId,
      parentSpanId: "span-retention-004",
      agentId: "records-retention-agent",
      agentName: retName,
      operation: "retention.log-audit",
      protocol: "a2a",
      startedAt: new Date(ret0 + 140).toISOString(),
      finishedAt: new Date(ret0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        recordId: "retention-record-002",
        recommendation: "eligible-for-purge",
        retentionRuleId: "rule.retention.billing-claim-7y",
        underLegalHold: false,
        requiresHumanApproval: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

// Coordination of Benefits seed — an order-of-benefits determination run: receive
// the coverages, deterministically order them against the COB rule catalog,
// recommend the payer order, and log the decision to the audit trail. This seed
// shows the CUSTODY-DECREE case (the demo decree request): a dependent child covered
// under both parents where the mother's earlier birthday (03-14 vs 06-20) would win
// the birthday rule — but an active court decree names the FATHER's plan primary, so
// the decree OVERRIDES the birthday rule (custodyDecreeApplied:true,
// cobDecreeHonored:true). Every ordering decision cites a recorded COB rule
// (cobRuleCited:true), and the determination is a payer-order RECOMMENDATION
// requiring human cosign — the agent never autonomously adjudicates
// (cobHumanCosigned:true). It touches coverage/PHI, so every span sets
// phiAccessed:true. The COB rule catalog, plan types, and payers are ILLUSTRATIVE
// synthetics, NOT a certified coordination-of-benefits engine — real COB is governed
// by the NAIC COB Model Regulation, Medicare Secondary Payer, and Medicaid TPL. Seed
// data; production populates the ring buffer from the persistent log store.
(function seedCoordinationOfBenefitsTrace() {
  const s = store();
  const cob0 = Date.now() - 1000 * 60 * 1;
  const cobTaskId = "task-seed-coordination-of-benefits-001";
  const cobName = "Coordination of Benefits Agent";
  s.traces.push(
    {
      id: "span-cob-001",
      taskId: cobTaskId,
      agentId: "coordination-of-benefits-agent",
      agentName: cobName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cob0).toISOString(),
      finishedAt: new Date(cob0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cob-002",
      taskId: cobTaskId,
      parentSpanId: "span-cob-001",
      agentId: "coordination-of-benefits-agent",
      agentName: cobName,
      operation: "cob.receive-coverages",
      protocol: "a2a",
      startedAt: new Date(cob0 + 35).toISOString(),
      finishedAt: new Date(cob0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "cob-patient-003",
        isDependentChild: true,
        coverageCount: 2,
        // The honesty invariant: an active custody decree is honored.
        cobDecreeHonored: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cob-003",
      taskId: cobTaskId,
      parentSpanId: "span-cob-002",
      agentId: "coordination-of-benefits-agent",
      agentName: cobName,
      operation: "cob.order-benefits",
      protocol: "a2a",
      startedAt: new Date(cob0 + 65).toISOString(),
      finishedAt: new Date(cob0 + 105).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        primaryCoverageId: "coverage-dad-hmo",
        primaryRuleId: "rule.cob.custody-decree-overrides-birthday",
        custodyDecreeApplied: true,
        // The honesty invariant: every ordering decision cites a recorded rule.
        cobRuleCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cob-004",
      taskId: cobTaskId,
      parentSpanId: "span-cob-003",
      agentId: "coordination-of-benefits-agent",
      agentName: cobName,
      operation: "cob.recommend",
      protocol: "a2a",
      startedAt: new Date(cob0 + 105).toISOString(),
      finishedAt: new Date(cob0 + 140).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        primaryCoverageId: "coverage-dad-hmo",
        // The honesty invariant: a determination is a recommendation requiring human cosign.
        requiresHumanCosign: true,
        cobHumanCosigned: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cob-005",
      taskId: cobTaskId,
      parentSpanId: "span-cob-004",
      agentId: "coordination-of-benefits-agent",
      agentName: cobName,
      operation: "cob.log-audit",
      protocol: "a2a",
      startedAt: new Date(cob0 + 140).toISOString(),
      finishedAt: new Date(cob0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "cob-patient-003",
        primaryCoverageId: "coverage-dad-hmo",
        custodyDecreeApplied: true,
        requiresHumanCosign: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedOverpaymentRecoveryTrace() {
  const s = store();
  const rec0 = Date.now() - 1000 * 60 * 1;
  const recTaskId = "task-seed-overpayment-recovery-001";
  const recName = "Claims Overpayment & Recovery Agent";
  s.traces.push(
    {
      id: "span-recovery-001",
      taskId: recTaskId,
      agentId: "overpayment-recovery-agent",
      agentName: recName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(rec0).toISOString(),
      finishedAt: new Date(rec0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recovery-002",
      taskId: recTaskId,
      parentSpanId: "span-recovery-001",
      agentId: "overpayment-recovery-agent",
      agentName: recName,
      operation: "recovery.receive-claim",
      protocol: "a2a",
      startedAt: new Date(rec0 + 35).toISOString(),
      finishedAt: new Date(rec0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        claimId: "recovery-claim-001",
        recoveryReasonId: "reason.recovery.duplicate-payment",
        // The honesty invariant: every recovery cites a recorded reason.
        recoveryReasonCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recovery-003",
      taskId: recTaskId,
      parentSpanId: "span-recovery-002",
      agentId: "overpayment-recovery-agent",
      agentName: recName,
      operation: "recovery.evaluate",
      protocol: "a2a",
      startedAt: new Date(rec0 + 65).toISOString(),
      finishedAt: new Date(rec0 + 105).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimId: "recovery-claim-001",
        overpaymentAmount: 600,
        recoverable: "recoverable",
        recoveryDeadline: "2026-10-01T00:00:00.000Z",
        // The honesty invariant: a recovery stays within its statutory lookback window.
        recoveryWithinLookback: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recovery-004",
      taskId: recTaskId,
      parentSpanId: "span-recovery-003",
      agentId: "overpayment-recovery-agent",
      agentName: recName,
      operation: "recovery.recommend",
      protocol: "a2a",
      startedAt: new Date(rec0 + 105).toISOString(),
      finishedAt: new Date(rec0 + 140).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        claimId: "recovery-claim-001",
        overpaymentAmount: 600,
        // The honesty invariant: a recoverable overpayment is a recommendation requiring human review.
        requiresHumanReview: true,
        recoveryClawbackHumanReviewed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recovery-005",
      taskId: recTaskId,
      parentSpanId: "span-recovery-004",
      agentId: "overpayment-recovery-agent",
      agentName: recName,
      operation: "recovery.log-audit",
      protocol: "a2a",
      startedAt: new Date(rec0 + 140).toISOString(),
      finishedAt: new Date(rec0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes:       {
        claimId: "recovery-claim-001",
        recoveryReasonId: "reason.recovery.duplicate-payment",
        overpaymentAmount: 600,
        requiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedFinancialAssistanceTrace() {
  const s = store();
  const fin0 = Date.now() - 1000 * 60 * 1;
  const finTaskId = "task-seed-financial-assistance-001";
  const finName = "Patient Financial Assistance & Charity Care Agent";
  s.traces.push(
    {
      id: "span-finassist-001",
      taskId: finTaskId,
      agentId: "financial-assistance-agent",
      agentName: finName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(fin0).toISOString(),
      finishedAt: new Date(fin0 + 35).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-finassist-002",
      taskId: finTaskId,
      parentSpanId: "span-finassist-001",
      agentId: "financial-assistance-agent",
      agentName: finName,
      operation: "finassist.receive-application",
      protocol: "a2a",
      startedAt: new Date(fin0 + 35).toISOString(),
      finishedAt: new Date(fin0 + 65).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "finassist-patient-001",
        householdSize: 3,
        // The honesty invariant: a collection action never precedes screening.
        ecaGatedOnScreening: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-finassist-003",
      taskId: finTaskId,
      parentSpanId: "span-finassist-002",
      agentId: "financial-assistance-agent",
      agentName: finName,
      operation: "finassist.evaluate",
      protocol: "a2a",
      startedAt: new Date(fin0 + 65).toISOString(),
      finishedAt: new Date(fin0 + 105).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "finassist-patient-001",
        fplPercent: 116,
        assistanceTier: "full-charity",
        tierId: "fap.tier.full-charity",
        // The honesty invariant: every determination cites a recorded FAP tier.
        finAssistScheduleCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-finassist-004",
      taskId: finTaskId,
      parentSpanId: "span-finassist-003",
      agentId: "financial-assistance-agent",
      agentName: finName,
      operation: "finassist.recommend",
      protocol: "a2a",
      startedAt: new Date(fin0 + 105).toISOString(),
      finishedAt: new Date(fin0 + 140).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        patientRef: "finassist-patient-001",
        assistanceTier: "full-charity",
        discountPct: 100,
        // The honesty invariant: a denial is never autonomous (this grant needs no denial).
        finAssistHumanReviewed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-finassist-005",
      taskId: finTaskId,
      parentSpanId: "span-finassist-004",
      agentId: "financial-assistance-agent",
      agentName: finName,
      operation: "finassist.log-audit",
      protocol: "a2a",
      startedAt: new Date(fin0 + 140).toISOString(),
      finishedAt: new Date(fin0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "finassist-patient-001",
        assistanceTier: "full-charity",
        tierId: "fap.tier.full-charity",
        discountPct: 100,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedLabResultTrace() {
  const s = store();
  const lab0 = Date.now() - 1000 * 60 * 1;
  const labTaskId = "task-seed-lab-result-001";
  const labName = "Lab Result & Critical-Value Notification Agent";
  s.traces.push(
    {
      id: "span-lab-001",
      taskId: labTaskId,
      agentId: "lab-result-agent",
      agentName: labName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(lab0).toISOString(),
      finishedAt: new Date(lab0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-lab-002",
      taskId: labTaskId,
      parentSpanId: "span-lab-001",
      agentId: "lab-result-agent",
      agentName: labName,
      operation: "lab.receive-result",
      protocol: "a2a",
      startedAt: new Date(lab0 + 30).toISOString(),
      finishedAt: new Date(lab0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "lab-patient-002",
        analyteId: "analyte.potassium",
        value: 6.8,
        // The honesty invariant: every classification cites a recorded reference range.
        labRangeCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-lab-003",
      taskId: labTaskId,
      parentSpanId: "span-lab-002",
      agentId: "lab-result-agent",
      agentName: labName,
      operation: "lab.classify",
      protocol: "a2a",
      startedAt: new Date(lab0 + 60).toISOString(),
      finishedAt: new Date(lab0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "lab-patient-002",
        analyteId: "analyte.potassium",
        classification: "critical-high",
        isCritical: true,
        // The honesty invariant: a critical value must be notified — never suppressed.
        labCriticalValueNotified: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-lab-004",
      taskId: labTaskId,
      parentSpanId: "span-lab-003",
      agentId: "lab-result-agent",
      agentName: labName,
      operation: "lab.recommend",
      protocol: "a2a",
      startedAt: new Date(lab0 + 100).toISOString(),
      finishedAt: new Date(lab0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        patientRef: "lab-patient-002",
        classification: "critical-high",
        requiresProviderNotification: true,
        // The honesty invariant: the agent never autonomously acts — a clinician reviews.
        labClinicianReviewed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-lab-005",
      taskId: labTaskId,
      parentSpanId: "span-lab-004",
      agentId: "lab-result-agent",
      agentName: labName,
      operation: "lab.log-audit",
      protocol: "a2a",
      startedAt: new Date(lab0 + 135).toISOString(),
      finishedAt: new Date(lab0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "lab-patient-002",
        analyteId: "analyte.potassium",
        classification: "critical-high",
        requiresProviderNotification: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedGoodFaithEstimateTrace() {
  const s = store();
  const gfe0 = Date.now() - 1000 * 60 * 1;
  const gfeTaskId = "task-seed-good-faith-estimate-001";
  const gfeName = "Good Faith Estimate (No Surprises Act) Agent";
  s.traces.push(
    {
      id: "span-gfe-001",
      taskId: gfeTaskId,
      agentId: "good-faith-estimate-agent",
      agentName: gfeName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(gfe0).toISOString(),
      finishedAt: new Date(gfe0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-gfe-002",
      taskId: gfeTaskId,
      parentSpanId: "span-gfe-001",
      agentId: "good-faith-estimate-agent",
      agentName: gfeName,
      operation: "gfe.receive-request",
      protocol: "a2a",
      startedAt: new Date(gfe0 + 30).toISOString(),
      finishedAt: new Date(gfe0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "gfe-patient-001",
        primaryServiceId: "svc.menopause-consult-comprehensive",
        lineItemCount: 2,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-gfe-003",
      taskId: gfeTaskId,
      parentSpanId: "span-gfe-002",
      agentId: "good-faith-estimate-agent",
      agentName: gfeName,
      operation: "gfe.price",
      protocol: "a2a",
      startedAt: new Date(gfe0 + 60).toISOString(),
      finishedAt: new Date(gfe0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "gfe-patient-001",
        totalEstimate: 580,
        // The honesty invariant: every line item is charge-master-sourced.
        gfeChargeMasterSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-gfe-004",
      taskId: gfeTaskId,
      parentSpanId: "span-gfe-003",
      agentId: "good-faith-estimate-agent",
      agentName: gfeName,
      operation: "gfe.assemble",
      protocol: "a2a",
      startedAt: new Date(gfe0 + 100).toISOString(),
      finishedAt: new Date(gfe0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        patientRef: "gfe-patient-001",
        totalEstimate: 580,
        // The honesty invariant: the estimate is complete + is not a binding bill.
        gfeExpectedItemsComplete: true,
        gfeEstimateNotBinding: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-gfe-005",
      taskId: gfeTaskId,
      parentSpanId: "span-gfe-004",
      agentId: "good-faith-estimate-agent",
      agentName: gfeName,
      operation: "gfe.log-audit",
      protocol: "a2a",
      startedAt: new Date(gfe0 + 135).toISOString(),
      finishedAt: new Date(gfe0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "gfe-patient-001",
        primaryServiceId: "svc.menopause-consult-comprehensive",
        totalEstimate: 580,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedBalanceBillingTrace() {
  const s = store();
  const bb0 = Date.now() - 1000 * 60 * 1;
  const bbTaskId = "task-seed-balance-billing-001";
  const bbName = "Balance Billing Protection (No Surprises Act) Agent";
  s.traces.push(
    {
      id: "span-bb-001",
      taskId: bbTaskId,
      agentId: "balance-billing-agent",
      agentName: bbName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(bb0).toISOString(),
      finishedAt: new Date(bb0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-bb-002",
      taskId: bbTaskId,
      parentSpanId: "span-bb-001",
      agentId: "balance-billing-agent",
      agentName: bbName,
      operation: "balancebill.receive-claim",
      protocol: "a2a",
      startedAt: new Date(bb0 + 30).toISOString(),
      finishedAt: new Date(bb0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        claimRef: "bb-claim-001",
        patientRef: "bb-patient-001",
        basisId: "basis.emergency",
        // The honesty invariant: every determination cites a recorded protection basis.
        balanceBillBasisCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-bb-003",
      taskId: bbTaskId,
      parentSpanId: "span-bb-002",
      agentId: "balance-billing-agent",
      agentName: bbName,
      operation: "balancebill.evaluate",
      protocol: "a2a",
      startedAt: new Date(bb0 + 60).toISOString(),
      finishedAt: new Date(bb0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "bb-claim-001",
        protected: true,
        costShareBasis: "in-network-qpa",
        // The honesty invariant: a protected patient's cost-share is on the in-network basis.
        balanceBillCostShareInNetwork: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-bb-004",
      taskId: bbTaskId,
      parentSpanId: "span-bb-003",
      agentId: "balance-billing-agent",
      agentName: bbName,
      operation: "balancebill.recommend",
      protocol: "a2a",
      startedAt: new Date(bb0 + 100).toISOString(),
      finishedAt: new Date(bb0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        claimRef: "bb-claim-001",
        balanceBillProhibited: true,
        balanceBillAmount: 0,
        // The honesty invariant: a protected claim is never balance-billed.
        balanceBillProhibitionHonored: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-bb-005",
      taskId: bbTaskId,
      parentSpanId: "span-bb-004",
      agentId: "balance-billing-agent",
      agentName: bbName,
      operation: "balancebill.log-audit",
      protocol: "a2a",
      startedAt: new Date(bb0 + 135).toISOString(),
      finishedAt: new Date(bb0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "bb-claim-001",
        basisId: "basis.emergency",
        balanceBillProhibited: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedDeidentificationTrace() {
  const s = store();
  const dd0 = Date.now() - 1000 * 60 * 1;
  const ddTaskId = "task-seed-deidentification-001";
  const ddName = "De-Identification & Safe Harbor Agent";
  s.traces.push(
    {
      id: "span-deid-001",
      taskId: ddTaskId,
      agentId: "deidentification-agent",
      agentName: ddName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(dd0).toISOString(),
      finishedAt: new Date(dd0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-deid-002",
      taskId: ddTaskId,
      parentSpanId: "span-deid-001",
      agentId: "deidentification-agent",
      agentName: ddName,
      operation: "deid.receive-dataset",
      protocol: "a2a",
      startedAt: new Date(dd0 + 30).toISOString(),
      finishedAt: new Date(dd0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        datasetRef: "deid-dataset-001",
        method: "safe-harbor",
        fieldCount: 6,
        // The honesty invariant: a recognized method is cited.
        deidMethodCited: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-deid-003",
      taskId: ddTaskId,
      parentSpanId: "span-deid-002",
      agentId: "deidentification-agent",
      agentName: ddName,
      operation: "deid.screen",
      protocol: "a2a",
      startedAt: new Date(dd0 + 60).toISOString(),
      finishedAt: new Date(dd0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        datasetRef: "deid-dataset-001",
        categoriesScreened: 18,
        // The honesty invariant: all eighteen Safe Harbor categories are screened.
        deidAllCategoriesScreened: true,
        remainingIdentifierCategories: 0,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-deid-004",
      taskId: ddTaskId,
      parentSpanId: "span-deid-003",
      agentId: "deidentification-agent",
      agentName: ddName,
      operation: "deid.determine",
      protocol: "a2a",
      startedAt: new Date(dd0 + 100).toISOString(),
      finishedAt: new Date(dd0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        datasetRef: "deid-dataset-001",
        deidentified: true,
        releaseApproved: true,
        // The honesty invariant: a re-identifiable dataset is never released.
        deidNoReleaseOfReidentifiable: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-deid-005",
      taskId: ddTaskId,
      parentSpanId: "span-deid-004",
      agentId: "deidentification-agent",
      agentName: ddName,
      operation: "deid.log-audit",
      protocol: "a2a",
      startedAt: new Date(dd0 + 135).toISOString(),
      finishedAt: new Date(dd0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        datasetRef: "deid-dataset-001",
        method: "safe-harbor",
        deidentified: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedImmunizationTrace() {
  const s = store();
  const im0 = Date.now() - 1000 * 60 * 1;
  const imTaskId = "task-seed-immunization-001";
  const imName = "Immunization Forecasting (ACIP) Agent";
  s.traces.push(
    {
      id: "span-imm-001",
      taskId: imTaskId,
      agentId: "immunization-agent",
      agentName: imName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(im0).toISOString(),
      finishedAt: new Date(im0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-imm-002",
      taskId: imTaskId,
      parentSpanId: "span-imm-001",
      agentId: "immunization-agent",
      agentName: imName,
      operation: "immunization.receive-patient",
      protocol: "a2a",
      startedAt: new Date(im0 + 30).toISOString(),
      finishedAt: new Date(im0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        patientRef: "imm-patient-001",
        ageYears: 52,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-imm-003",
      taskId: imTaskId,
      parentSpanId: "span-imm-002",
      agentId: "immunization-agent",
      agentName: imName,
      operation: "immunization.forecast",
      protocol: "a2a",
      startedAt: new Date(im0 + 60).toISOString(),
      finishedAt: new Date(im0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "imm-patient-001",
        dueCount: 1,
        overdueCount: 2,
        contraindicatedCount: 0,
        // The honesty invariants: every recommendation is schedule-sourced and no
        // contraindicated vaccine is recommended.
        immunizationScheduleCited: true,
        immunizationContraindicationHonored: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-imm-004",
      taskId: imTaskId,
      parentSpanId: "span-imm-003",
      agentId: "immunization-agent",
      agentName: imName,
      operation: "immunization.recommend",
      protocol: "a2a",
      startedAt: new Date(im0 + 100).toISOString(),
      finishedAt: new Date(im0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        patientRef: "imm-patient-001",
        requiresClinicianOrder: true,
        // The honesty invariant: a due / overdue vaccine is never autonomously administered.
        immunizationNoAutonomousAdministration: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-imm-005",
      taskId: imTaskId,
      parentSpanId: "span-imm-004",
      agentId: "immunization-agent",
      agentName: imName,
      operation: "immunization.log-audit",
      protocol: "a2a",
      startedAt: new Date(im0 + 135).toISOString(),
      finishedAt: new Date(im0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        patientRef: "imm-patient-001",
        requiresClinicianOrder: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedMinimumNecessaryTrace() {
  const s = store();
  const mn0 = Date.now() - 1000 * 60 * 1;
  const mnTaskId = "task-seed-minimum-necessary-001";
  const mnName = "Minimum Necessary (HIPAA) Agent";
  s.traces.push(
    {
      id: "span-mn-001",
      taskId: mnTaskId,
      agentId: "minimum-necessary-agent",
      agentName: mnName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(mn0).toISOString(),
      finishedAt: new Date(mn0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mn-002",
      taskId: mnTaskId,
      parentSpanId: "span-mn-001",
      agentId: "minimum-necessary-agent",
      agentName: mnName,
      operation: "minnec.receive-request",
      protocol: "a2a",
      startedAt: new Date(mn0 + 30).toISOString(),
      finishedAt: new Date(mn0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "mn-request-001",
        purposeId: "purpose.payment",
        requestorRole: "billing-specialist",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mn-003",
      taskId: mnTaskId,
      parentSpanId: "span-mn-002",
      agentId: "minimum-necessary-agent",
      agentName: mnName,
      operation: "minnec.scope",
      protocol: "a2a",
      startedAt: new Date(mn0 + 60).toISOString(),
      finishedAt: new Date(mn0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mn-request-001",
        releasedCount: 4,
        withheldCount: 1,
        minimumNecessary: false,
        // The honesty invariants: the purpose is sourced and every released field is in scope.
        minNecPurposeSourced: true,
        minNecScoped: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mn-004",
      taskId: mnTaskId,
      parentSpanId: "span-mn-003",
      agentId: "minimum-necessary-agent",
      agentName: mnName,
      operation: "minnec.decide",
      protocol: "a2a",
      startedAt: new Date(mn0 + 100).toISOString(),
      finishedAt: new Date(mn0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        requestRef: "mn-request-001",
        requiresHumanReview: true,
        // The honesty invariant: a narrowed / bulk disclosure is never autonomously released.
        minNecNoAutonomousOverDisclosure: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mn-005",
      taskId: mnTaskId,
      parentSpanId: "span-mn-004",
      agentId: "minimum-necessary-agent",
      agentName: mnName,
      operation: "minnec.log-audit",
      protocol: "a2a",
      startedAt: new Date(mn0 + 135).toISOString(),
      finishedAt: new Date(mn0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mn-request-001",
        requiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedAuditLogIntegrityTrace() {
  const s = store();
  const al0 = Date.now() - 1000 * 60 * 1;
  const alTaskId = "task-seed-audit-log-integrity-001";
  const alName = "Audit Log Integrity (Tamper-Evidence) Agent";
  s.traces.push(
    {
      id: "span-al-001",
      taskId: alTaskId,
      agentId: "audit-log-integrity-agent",
      agentName: alName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(al0).toISOString(),
      finishedAt: new Date(al0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-al-002",
      taskId: alTaskId,
      parentSpanId: "span-al-001",
      agentId: "audit-log-integrity-agent",
      agentName: alName,
      operation: "auditlog.receive-log",
      protocol: "a2a",
      startedAt: new Date(al0 + 30).toISOString(),
      finishedAt: new Date(al0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        logRef: "audit-log-001",
        entryCount: 5,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-al-003",
      taskId: alTaskId,
      parentSpanId: "span-al-002",
      agentId: "audit-log-integrity-agent",
      agentName: alName,
      operation: "auditlog.verify",
      protocol: "a2a",
      startedAt: new Date(al0 + 60).toISOString(),
      finishedAt: new Date(al0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        logRef: "audit-log-001",
        verified: true,
        brokenLinks: 0,
        sequenceGaps: 0,
        // The honesty invariants: verified only over an intact chain + complete sequence.
        auditLogHashChainVerified: true,
        auditLogSequenceComplete: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-al-004",
      taskId: alTaskId,
      parentSpanId: "span-al-003",
      agentId: "audit-log-integrity-agent",
      agentName: alName,
      operation: "auditlog.attest",
      protocol: "a2a",
      startedAt: new Date(al0 + 100).toISOString(),
      finishedAt: new Date(al0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        logRef: "audit-log-001",
        requiresForensicReview: false,
        // The honesty invariant: the log is never autonomously redacted / repaired.
        auditLogNoAutonomousRedaction: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-al-005",
      taskId: alTaskId,
      parentSpanId: "span-al-004",
      agentId: "audit-log-integrity-agent",
      agentName: alName,
      operation: "auditlog.log-audit",
      protocol: "a2a",
      startedAt: new Date(al0 + 135).toISOString(),
      finishedAt: new Date(al0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        logRef: "audit-log-001",
        verified: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedTimelyFilingTrace() {
  const s = store();
  const tf0 = Date.now() - 1000 * 60 * 1;
  const tfTaskId = "task-seed-timely-filing-001";
  const tfName = "Timely Filing Compliance Agent";
  s.traces.push(
    {
      id: "span-tf-001",
      taskId: tfTaskId,
      agentId: "timely-filing-agent",
      agentName: tfName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(tf0).toISOString(),
      finishedAt: new Date(tf0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-tf-002",
      taskId: tfTaskId,
      parentSpanId: "span-tf-001",
      agentId: "timely-filing-agent",
      agentName: tfName,
      operation: "timelyfiling.receive-claim",
      protocol: "a2a",
      startedAt: new Date(tf0 + 30).toISOString(),
      finishedAt: new Date(tf0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        claimRef: "claim-tf-002",
        filingRuleId: "rule.filing.commercial-90day",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-tf-003",
      taskId: tfTaskId,
      parentSpanId: "span-tf-002",
      agentId: "timely-filing-agent",
      agentName: tfName,
      operation: "timelyfiling.compute-deadline",
      protocol: "a2a",
      startedAt: new Date(tf0 + 60).toISOString(),
      finishedAt: new Date(tf0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "claim-tf-002",
        deadline: "2026-04-10",
        daysLate: 52,
        timely: false,
        // The honesty invariants: sourced rule + a computed (not guessed) deadline.
        timelyFilingRuleSourced: true,
        timelyFilingDeadlineComputed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-tf-004",
      taskId: tfTaskId,
      parentSpanId: "span-tf-003",
      agentId: "timely-filing-agent",
      agentName: tfName,
      operation: "timelyfiling.decide",
      protocol: "a2a",
      startedAt: new Date(tf0 + 100).toISOString(),
      finishedAt: new Date(tf0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        claimRef: "claim-tf-002",
        disposition: "appeal-with-exception",
        requiresHumanReview: true,
        // The honesty invariant: never an autonomous write-off.
        timelyFilingNoAutonomousWriteOff: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-tf-005",
      taskId: tfTaskId,
      parentSpanId: "span-tf-004",
      agentId: "timely-filing-agent",
      agentName: tfName,
      operation: "timelyfiling.log-audit",
      protocol: "a2a",
      startedAt: new Date(tf0 + 135).toISOString(),
      finishedAt: new Date(tf0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "claim-tf-002",
        disposition: "appeal-with-exception",
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedControlledSubstanceTrace() {
  const s = store();
  const cs0 = Date.now() - 1000 * 60 * 1;
  const csTaskId = "task-seed-controlled-substance-001";
  const csName = "Controlled Substance / PDMP Safety Check Agent";
  s.traces.push(
    {
      id: "span-cs-001",
      taskId: csTaskId,
      agentId: "controlled-substance-agent",
      agentName: csName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cs0).toISOString(),
      finishedAt: new Date(cs0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cs-002",
      taskId: csTaskId,
      parentSpanId: "span-cs-001",
      agentId: "controlled-substance-agent",
      agentName: csName,
      operation: "controlledsubstance.receive-request",
      protocol: "a2a",
      startedAt: new Date(cs0 + 30).toISOString(),
      finishedAt: new Date(cs0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "cs-request-002",
        guidelineId: "guideline.cdc-2022-mme",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cs-003",
      taskId: csTaskId,
      parentSpanId: "span-cs-002",
      agentId: "controlled-substance-agent",
      agentName: csName,
      operation: "controlledsubstance.compute-mme",
      protocol: "a2a",
      startedAt: new Date(cs0 + 60).toISOString(),
      finishedAt: new Date(cs0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cs-request-002",
        totalMmePerDay: 100,
        riskLevel: "high",
        // The honesty invariants: sourced guideline + a computed (not guessed) MME total.
        controlledSubstanceGuidelineSourced: true,
        controlledSubstanceMmeComputed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cs-004",
      taskId: csTaskId,
      parentSpanId: "span-cs-003",
      agentId: "controlled-substance-agent",
      agentName: csName,
      operation: "controlledsubstance.classify",
      protocol: "a2a",
      startedAt: new Date(cs0 + 100).toISOString(),
      finishedAt: new Date(cs0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        requestRef: "cs-request-002",
        disposition: "prescriber-review",
        requiresPrescriberReview: true,
        // The honesty invariant: never an autonomous prescribing decision.
        controlledSubstanceNoAutonomousDecision: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-cs-005",
      taskId: csTaskId,
      parentSpanId: "span-cs-004",
      agentId: "controlled-substance-agent",
      agentName: csName,
      operation: "controlledsubstance.log-audit",
      protocol: "a2a",
      startedAt: new Date(cs0 + 135).toISOString(),
      finishedAt: new Date(cs0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cs-request-002",
        riskLevel: "high",
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedAbnTrace() {
  const s = store();
  const abn0 = Date.now() - 1000 * 60 * 1;
  const abnTaskId = "task-seed-advance-beneficiary-notice-001";
  const abnName = "Advance Beneficiary Notice (Medicare ABN) Agent";
  s.traces.push(
    {
      id: "span-abn-001",
      taskId: abnTaskId,
      agentId: "advance-beneficiary-notice-agent",
      agentName: abnName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(abn0).toISOString(),
      finishedAt: new Date(abn0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-abn-002",
      taskId: abnTaskId,
      parentSpanId: "span-abn-001",
      agentId: "advance-beneficiary-notice-agent",
      agentName: abnName,
      operation: "abn.receive-request",
      protocol: "a2a",
      startedAt: new Date(abn0 + 30).toISOString(),
      finishedAt: new Date(abn0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "abn-req-002",
        coverageRuleId: "rule.abn.vitamin-d-testing",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-abn-003",
      taskId: abnTaskId,
      parentSpanId: "span-abn-002",
      agentId: "advance-beneficiary-notice-agent",
      agentName: abnName,
      operation: "abn.assess-coverage",
      protocol: "a2a",
      startedAt: new Date(abn0 + 60).toISOString(),
      finishedAt: new Date(abn0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "abn-req-002",
        coverageAssessment: "likely-non-covered",
        abnRequired: true,
        // The honesty invariants: sourced coverage rule + ABN required when non-covered.
        abnCoverageRuleSourced: true,
        abnRequiredWhenNoncovered: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-abn-004",
      taskId: abnTaskId,
      parentSpanId: "span-abn-003",
      agentId: "advance-beneficiary-notice-agent",
      agentName: abnName,
      operation: "abn.decide-liability",
      protocol: "a2a",
      startedAt: new Date(abn0 + 100).toISOString(),
      finishedAt: new Date(abn0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        requestRef: "abn-req-002",
        modifier: "GZ",
        disposition: "issue-abn-before-service",
        requiresHumanReview: true,
        // The honesty invariant: never an autonomous beneficiary-liability assignment.
        abnNoAutonomousBeneficiaryLiability: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-abn-005",
      taskId: abnTaskId,
      parentSpanId: "span-abn-004",
      agentId: "advance-beneficiary-notice-agent",
      agentName: abnName,
      operation: "abn.log-audit",
      protocol: "a2a",
      startedAt: new Date(abn0 + 135).toISOString(),
      finishedAt: new Date(abn0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "abn-req-002",
        disposition: "issue-abn-before-service",
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedAccountingTrace() {
  const s = store();
  const ac0 = Date.now() - 1000 * 60 * 1;
  const acTaskId = "task-seed-accounting-of-disclosures-001";
  const acName = "Accounting of Disclosures (HIPAA §164.528) Agent";
  s.traces.push(
    {
      id: "span-ac-001",
      taskId: acTaskId,
      agentId: "accounting-of-disclosures-agent",
      agentName: acName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ac0).toISOString(),
      finishedAt: new Date(ac0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ac-002",
      taskId: acTaskId,
      parentSpanId: "span-ac-001",
      agentId: "accounting-of-disclosures-agent",
      agentName: acName,
      operation: "accounting.receive-log",
      protocol: "a2a",
      startedAt: new Date(ac0 + 30).toISOString(),
      finishedAt: new Date(ac0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "acct-req-001",
        patientRef: "patient-acct-001",
        totalDisclosures: 5,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ac-003",
      taskId: acTaskId,
      parentSpanId: "span-ac-002",
      agentId: "accounting-of-disclosures-agent",
      agentName: acName,
      operation: "accounting.classify",
      protocol: "a2a",
      startedAt: new Date(ac0 + 60).toISOString(),
      finishedAt: new Date(ac0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "acct-req-001",
        accountableCount: 2,
        excludedCount: 2,
        outOfWindowCount: 1,
        // The honesty invariants: sourced purposes + a complete accounting.
        accountingPurposeSourced: true,
        accountingDisclosuresComplete: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ac-004",
      taskId: acTaskId,
      parentSpanId: "span-ac-003",
      agentId: "accounting-of-disclosures-agent",
      agentName: acName,
      operation: "accounting.assemble",
      protocol: "a2a",
      startedAt: new Date(ac0 + 100).toISOString(),
      finishedAt: new Date(ac0 + 135).toISOString(),
      durationMs: 35,
      status: "ok",
      attributes: {
        requestRef: "acct-req-001",
        accountableCount: 2,
        requiresPrivacyOfficerReview: true,
        // The honesty invariant: never an autonomous suppression.
        accountingNoAutonomousSuppression: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ac-005",
      taskId: acTaskId,
      parentSpanId: "span-ac-004",
      agentId: "accounting-of-disclosures-agent",
      agentName: acName,
      operation: "accounting.log-audit",
      protocol: "a2a",
      startedAt: new Date(ac0 + 135).toISOString(),
      finishedAt: new Date(ac0 + 175).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "acct-req-001",
        accountableCount: 2,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedSubrogationTrace() {
  const s = store();
  const su0 = Date.now() - 1000 * 60 * 1;
  const suTaskId = "task-seed-subrogation-001";
  const suName = "Subrogation / Third-Party Liability Agent";
  s.traces.push(
    {
      id: "span-su-001",
      taskId: suTaskId,
      agentId: "subrogation-agent",
      agentName: suName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(su0).toISOString(),
      finishedAt: new Date(su0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-su-002",
      taskId: suTaskId,
      parentSpanId: "span-su-001",
      agentId: "subrogation-agent",
      agentName: suName,
      operation: "subrogation.receive-case",
      protocol: "a2a",
      startedAt: new Date(su0 + 30).toISOString(),
      finishedAt: new Date(su0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        caseRef: "subro-case-002",
        patientRef: "patient-subro-002",
        accidentType: "premises-liability",
        planPaidAmount: 30000,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-su-003",
      taskId: suTaskId,
      parentSpanId: "span-su-002",
      agentId: "subrogation-agent",
      agentName: suName,
      operation: "subrogation.assess-eligibility",
      protocol: "a2a",
      startedAt: new Date(su0 + 60).toISOString(),
      finishedAt: new Date(su0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "subro-case-002",
        eligible: true,
        basisId: "basis.state-subrogation-statute",
        // The honesty invariant: the recovery basis is sourced.
        subrogationBasisSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-su-004",
      taskId: suTaskId,
      parentSpanId: "span-su-003",
      agentId: "subrogation-agent",
      agentName: suName,
      operation: "subrogation.compute-recoverable",
      protocol: "a2a",
      startedAt: new Date(su0 + 100).toISOString(),
      finishedAt: new Date(su0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "subro-case-002",
        planPaidAmount: 30000,
        // 30000 − 33% common-fund attorney-fee reduction = 20100.
        recoverableAmount: 20100,
        disposition: "assert-lien-with-review",
        requiresHumanReview: true,
        // The honesty invariants: bounded recoverable + never an autonomous lien.
        subrogationRecoverableWithinPaid: true,
        subrogationNoAutonomousLien: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-su-005",
      taskId: suTaskId,
      parentSpanId: "span-su-004",
      agentId: "subrogation-agent",
      agentName: suName,
      operation: "subrogation.log-audit",
      protocol: "a2a",
      startedAt: new Date(su0 + 140).toISOString(),
      finishedAt: new Date(su0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "subro-case-002",
        recoverableAmount: 20100,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedDealDeskTrace() {
  const s = store();
  const dd0 = Date.now() - 1000 * 60 * 1;
  const ddTaskId = "task-seed-deal-desk-001";
  const ddName = "Deal Desk / Quote Approval Agent";
  s.traces.push(
    {
      id: "span-dd-001",
      taskId: ddTaskId,
      agentId: "deal-desk-agent",
      agentName: ddName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(dd0).toISOString(),
      finishedAt: new Date(dd0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // Commercial plane — no PHI accessed.
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-dd-002",
      taskId: ddTaskId,
      parentSpanId: "span-dd-001",
      agentId: "deal-desk-agent",
      agentName: ddName,
      operation: "dealdesk.receive-quote",
      protocol: "a2a",
      startedAt: new Date(dd0 + 30).toISOString(),
      finishedAt: new Date(dd0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        quoteRef: "quote-002",
        accountRef: "account-cascade-systems",
        lineCount: 2,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-dd-003",
      taskId: ddTaskId,
      parentSpanId: "span-dd-002",
      agentId: "deal-desk-agent",
      agentName: ddName,
      operation: "dealdesk.validate-pricing",
      protocol: "a2a",
      startedAt: new Date(dd0 + 60).toISOString(),
      finishedAt: new Date(dd0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        quoteRef: "quote-002",
        listTotal: 285000,
        netTotal: 216000,
        effectiveDiscountPct: 24.21,
        // The honesty invariants: catalog-sourced pricing + consistent math.
        dealDeskCatalogSourced: true,
        dealDeskMathConsistent: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-dd-004",
      taskId: ddTaskId,
      parentSpanId: "span-dd-003",
      agentId: "deal-desk-agent",
      agentName: ddName,
      operation: "dealdesk.decide-approval",
      protocol: "a2a",
      startedAt: new Date(dd0 + 100).toISOString(),
      finishedAt: new Date(dd0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        quoteRef: "quote-002",
        withinGuardrail: false,
        disposition: "escalate-to-deal-desk",
        requiresDealDeskApproval: true,
        // The honesty invariant: an out-of-guardrail quote is never auto-approved.
        dealDeskNoAutonomousApproval: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-dd-005",
      taskId: ddTaskId,
      parentSpanId: "span-dd-004",
      agentId: "deal-desk-agent",
      agentName: ddName,
      operation: "dealdesk.record-audit",
      protocol: "a2a",
      startedAt: new Date(dd0 + 140).toISOString(),
      finishedAt: new Date(dd0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        quoteRef: "quote-002",
        disposition: "escalate-to-deal-desk",
        phiAccessed: false,
        synthetic: true
      }
    }
  );
})();

(function seedRightOfAccessTrace() {
  const s = store();
  const roa0 = Date.now() - 1000 * 60 * 1;
  const roaTaskId = "task-seed-right-of-access-001";
  const roaName = "Right of Access (HIPAA §164.524) Agent";
  s.traces.push(
    {
      id: "span-roa-001",
      taskId: roaTaskId,
      agentId: "right-of-access-agent",
      agentName: roaName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(roa0).toISOString(),
      finishedAt: new Date(roa0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-roa-002",
      taskId: roaTaskId,
      parentSpanId: "span-roa-001",
      agentId: "right-of-access-agent",
      agentName: roaName,
      operation: "access.receive-request",
      protocol: "a2a",
      startedAt: new Date(roa0 + 30).toISOString(),
      finishedAt: new Date(roa0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "access-002",
        patientRef: "patient-7310",
        requestType: "copy",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-roa-003",
      taskId: roaTaskId,
      parentSpanId: "span-roa-002",
      agentId: "right-of-access-agent",
      agentName: roaName,
      operation: "access.assess-grounds",
      protocol: "a2a",
      startedAt: new Date(roa0 + 60).toISOString(),
      finishedAt: new Date(roa0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "access-002",
        exceptionId: "exception.psychotherapy-notes",
        exceptionType: "unreviewable",
        // The honesty invariant: a denial cites a recorded §164.524 ground.
        accessGroundSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-roa-004",
      taskId: roaTaskId,
      parentSpanId: "span-roa-003",
      agentId: "right-of-access-agent",
      agentName: roaName,
      operation: "access.compute-deadline",
      protocol: "a2a",
      startedAt: new Date(roa0 + 100).toISOString(),
      finishedAt: new Date(roa0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "access-002",
        responseDeadline: "2026-09-24",
        daysUntilDeadline: 17,
        disposition: "deny-unreviewable",
        // The honesty invariants: the deadline is computed, and never an autonomous release.
        accessDeadlineComputed: true,
        accessNoAutonomousDenialOrRelease: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-roa-005",
      taskId: roaTaskId,
      parentSpanId: "span-roa-004",
      agentId: "right-of-access-agent",
      agentName: roaName,
      operation: "access.log-audit",
      protocol: "a2a",
      startedAt: new Date(roa0 + 140).toISOString(),
      finishedAt: new Date(roa0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "access-002",
        disposition: "deny-unreviewable",
        requiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedMemberCostShareTrace() {
  const s = store();
  const mcs0 = Date.now() - 1000 * 60 * 1;
  const mcsTaskId = "task-seed-member-cost-share-001";
  const mcsName = "Member Cost-Share / EOB Calculation Agent";
  s.traces.push(
    {
      id: "span-mcs-001",
      taskId: mcsTaskId,
      agentId: "member-cost-share-agent",
      agentName: mcsName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(mcs0).toISOString(),
      finishedAt: new Date(mcs0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mcs-002",
      taskId: mcsTaskId,
      parentSpanId: "span-mcs-001",
      agentId: "member-cost-share-agent",
      agentName: mcsName,
      operation: "costshare.receive-claim",
      protocol: "a2a",
      startedAt: new Date(mcs0 + 30).toISOString(),
      finishedAt: new Date(mcs0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        claimRef: "claim-4471",
        memberRef: "member-8842",
        allowedAmount: 4000,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mcs-003",
      taskId: mcsTaskId,
      parentSpanId: "span-mcs-002",
      agentId: "member-cost-share-agent",
      agentName: mcsName,
      operation: "costshare.load-benefits",
      protocol: "a2a",
      startedAt: new Date(mcs0 + 60).toISOString(),
      finishedAt: new Date(mcs0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "claim-4471",
        planId: "plan.silver-ppo",
        // The honesty invariant: the benefit design traces to the recorded catalog.
        costShareBenefitSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mcs-004",
      taskId: mcsTaskId,
      parentSpanId: "span-mcs-003",
      agentId: "member-cost-share-agent",
      agentName: mcsName,
      operation: "costshare.compute-cost-share",
      protocol: "a2a",
      startedAt: new Date(mcs0 + 100).toISOString(),
      finishedAt: new Date(mcs0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "claim-4471",
        memberResponsibility: 1200,
        planPaid: 2800,
        // The honesty invariants: the split adds up, and no autonomous member charge.
        costShareMathConsistent: true,
        costShareNoAutonomousCharge: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-mcs-005",
      taskId: mcsTaskId,
      parentSpanId: "span-mcs-004",
      agentId: "member-cost-share-agent",
      agentName: mcsName,
      operation: "costshare.log-audit",
      protocol: "a2a",
      startedAt: new Date(mcs0 + 140).toISOString(),
      finishedAt: new Date(mcs0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "claim-4471",
        memberResponsibility: 1200,
        requiresAdjudicationReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedExclusionScreeningTrace() {
  const s = store();
  const exc0 = Date.now() - 1000 * 60 * 1;
  const excTaskId = "task-seed-exclusion-screening-001";
  const excName = "OIG Exclusion / Sanctions Screening Agent";
  s.traces.push(
    {
      id: "span-exc-001",
      taskId: excTaskId,
      agentId: "exclusion-screening-agent",
      agentName: excName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(exc0).toISOString(),
      finishedAt: new Date(exc0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // NOT PHI-bearing — screens a provider's identity against a public list.
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-exc-002",
      taskId: excTaskId,
      parentSpanId: "span-exc-001",
      agentId: "exclusion-screening-agent",
      agentName: excName,
      operation: "exclusion.receive-party",
      protocol: "a2a",
      startedAt: new Date(exc0 + 30).toISOString(),
      finishedAt: new Date(exc0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        partyRef: "provider-3391",
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-exc-003",
      taskId: excTaskId,
      parentSpanId: "span-exc-002",
      agentId: "exclusion-screening-agent",
      agentName: excName,
      operation: "exclusion.match-leie",
      protocol: "a2a",
      startedAt: new Date(exc0 + 60).toISOString(),
      finishedAt: new Date(exc0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        partyRef: "provider-3391",
        matchStrength: "confirmed",
        matchedExclusionId: "leie-1001",
        // The honesty invariants: the match is sourced and not overstated.
        exclusionMatchSourced: true,
        exclusionMatchNotOverstated: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-exc-004",
      taskId: excTaskId,
      parentSpanId: "span-exc-003",
      agentId: "exclusion-screening-agent",
      agentName: excName,
      operation: "exclusion.recommend-disposition",
      protocol: "a2a",
      startedAt: new Date(exc0 + 100).toISOString(),
      finishedAt: new Date(exc0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        partyRef: "provider-3391",
        disposition: "recommend-block-pending-review",
        // The honesty invariant: no autonomous payment block or clear.
        exclusionNoAutonomousBlockOrClear: true,
        requiresComplianceReview: true,
        phiAccessed: false,
        synthetic: true
      }
    }
  );
})();

(function seedAmendmentRequestTrace() {
  const s = store();
  const amd0 = Date.now() - 1000 * 60 * 1;
  const amdTaskId = "task-seed-amendment-request-001";
  const amdName = "Amendment / Correction (HIPAA §164.526) Agent";
  s.traces.push(
    {
      id: "span-amd-001",
      taskId: amdTaskId,
      agentId: "amendment-request-agent",
      agentName: amdName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(amd0).toISOString(),
      finishedAt: new Date(amd0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-amd-002",
      taskId: amdTaskId,
      parentSpanId: "span-amd-001",
      agentId: "amendment-request-agent",
      agentName: amdName,
      operation: "amendment.receive-request",
      protocol: "a2a",
      startedAt: new Date(amd0 + 30).toISOString(),
      finishedAt: new Date(amd0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "amend-001",
        patientRef: "patient-8842",
        recordRef: "note-55210",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-amd-003",
      taskId: amdTaskId,
      parentSpanId: "span-amd-002",
      agentId: "amendment-request-agent",
      agentName: amdName,
      operation: "amendment.assess-grounds",
      protocol: "a2a",
      startedAt: new Date(amd0 + 60).toISOString(),
      finishedAt: new Date(amd0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "amend-001",
        disposition: "recommend-accept",
        deniedOnGround: null,
        // The honesty invariant: no denial ground asserted for an accept.
        amendmentGroundSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-amd-004",
      taskId: amdTaskId,
      parentSpanId: "span-amd-003",
      agentId: "amendment-request-agent",
      agentName: amdName,
      operation: "amendment.compute-deadline",
      protocol: "a2a",
      startedAt: new Date(amd0 + 100).toISOString(),
      finishedAt: new Date(amd0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "amend-001",
        responseDeadline: "2026-10-14",
        daysUntilDeadline: 37,
        // The honesty invariant: the deadline is request-date + 60 days.
        amendmentDeadlineComputed: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-amd-005",
      taskId: amdTaskId,
      parentSpanId: "span-amd-004",
      agentId: "amendment-request-agent",
      agentName: amdName,
      operation: "amendment.log-audit",
      protocol: "a2a",
      startedAt: new Date(amd0 + 140).toISOString(),
      finishedAt: new Date(amd0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "amend-001",
        disposition: "recommend-accept",
        // The honesty invariant: never an autonomous amendment / denial.
        amendmentNoAutonomousWrite: true,
        requiresHumanReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedInformationBlockingTrace() {
  const s = store();
  const ib0 = Date.now() - 1000 * 60 * 1;
  const ibTaskId = "task-seed-information-blocking-001";
  const ibName = "Information Blocking (Cures Act / 45 CFR Part 171) Agent";
  s.traces.push(
    {
      id: "span-ib-001",
      taskId: ibTaskId,
      agentId: "information-blocking-agent",
      agentName: ibName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ib0).toISOString(),
      finishedAt: new Date(ib0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ib-002",
      taskId: ibTaskId,
      parentSpanId: "span-ib-001",
      agentId: "information-blocking-agent",
      agentName: ibName,
      operation: "blocking.receive-practice",
      protocol: "a2a",
      startedAt: new Date(ib0 + 30).toISOString(),
      finishedAt: new Date(ib0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "ib-001",
        actorRef: "provider-2201",
        ehiRequestType: "access",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ib-003",
      taskId: ibTaskId,
      parentSpanId: "span-ib-002",
      agentId: "information-blocking-agent",
      agentName: ibName,
      operation: "blocking.assess-exception",
      protocol: "a2a",
      startedAt: new Date(ib0 + 60).toISOString(),
      finishedAt: new Date(ib0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ib-001",
        claimedExceptionId: "exception.privacy",
        // The honesty invariant: the claimed exception traces to the catalog.
        blockingExceptionSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ib-004",
      taskId: ibTaskId,
      parentSpanId: "span-ib-003",
      agentId: "information-blocking-agent",
      agentName: ibName,
      operation: "blocking.check-conditions",
      protocol: "a2a",
      startedAt: new Date(ib0 + 100).toISOString(),
      finishedAt: new Date(ib0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ib-001",
        disposition: "not-information-blocking-exception-met",
        exceptionSatisfied: true,
        // The honesty invariant: exception met only when every condition is.
        blockingDeterminationNotOverstated: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ib-005",
      taskId: ibTaskId,
      parentSpanId: "span-ib-004",
      agentId: "information-blocking-agent",
      agentName: ibName,
      operation: "blocking.log-audit",
      protocol: "a2a",
      startedAt: new Date(ib0 + 140).toISOString(),
      finishedAt: new Date(ib0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ib-001",
        disposition: "not-information-blocking-exception-met",
        // The honesty invariant: never an autonomous block / release.
        blockingNoAutonomousBlockOrRelease: true,
        requiresComplianceReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedDrugInteractionTrace() {
  const s = store();
  const ddi0 = Date.now() - 1000 * 60 * 1;
  const ddiTaskId = "task-seed-drug-interaction-001";
  const ddiName = "Drug–Drug Interaction (DDI) Safety Check Agent";
  s.traces.push(
    {
      id: "span-ddi-001",
      taskId: ddiTaskId,
      agentId: "drug-interaction-agent",
      agentName: ddiName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(ddi0).toISOString(),
      finishedAt: new Date(ddi0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ddi-002",
      taskId: ddiTaskId,
      parentSpanId: "span-ddi-001",
      agentId: "drug-interaction-agent",
      agentName: ddiName,
      operation: "ddi.receive-order",
      protocol: "a2a",
      startedAt: new Date(ddi0 + 30).toISOString(),
      finishedAt: new Date(ddi0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "ddi-001",
        patientRef: "patient-8842",
        proposedDrug: "paroxetine",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ddi-003",
      taskId: ddiTaskId,
      parentSpanId: "span-ddi-002",
      agentId: "drug-interaction-agent",
      agentName: ddiName,
      operation: "ddi.match-interactions",
      protocol: "a2a",
      startedAt: new Date(ddi0 + 60).toISOString(),
      finishedAt: new Date(ddi0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ddi-001",
        interactionCount: 1,
        // The honesty invariant: every interaction traces to the knowledge base.
        ddiInteractionSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ddi-004",
      taskId: ddiTaskId,
      parentSpanId: "span-ddi-003",
      agentId: "drug-interaction-agent",
      agentName: ddiName,
      operation: "ddi.rank-severity",
      protocol: "a2a",
      startedAt: new Date(ddi0 + 100).toISOString(),
      finishedAt: new Date(ddi0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ddi-001",
        overallSeverity: "major",
        disposition: "review-required",
        // The honesty invariant: overall severity matches the detected interactions.
        ddiSeverityConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-ddi-005",
      taskId: ddiTaskId,
      parentSpanId: "span-ddi-004",
      agentId: "drug-interaction-agent",
      agentName: ddiName,
      operation: "ddi.log-audit",
      protocol: "a2a",
      startedAt: new Date(ddi0 + 140).toISOString(),
      finishedAt: new Date(ddi0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "ddi-001",
        disposition: "review-required",
        // The honesty invariant: never an autonomous hold / override.
        ddiNoAutonomousHoldOrOverride: true,
        requiresClinicianReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedMlrRebateTrace() {
  const s = store();
  const mlr0 = Date.now() - 1000 * 60 * 1;
  const mlrTaskId = "task-seed-mlr-rebate-001";
  const mlrName = "Medical Loss Ratio (MLR) Rebate Calculation Agent";
  s.traces.push(
    {
      id: "span-mlr-001",
      taskId: mlrTaskId,
      agentId: "mlr-rebate-agent",
      agentName: mlrName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(mlr0).toISOString(),
      finishedAt: new Date(mlr0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // NON-PHI: aggregate plan-year financials, no patient health information.
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-mlr-002",
      taskId: mlrTaskId,
      parentSpanId: "span-mlr-001",
      agentId: "mlr-rebate-agent",
      agentName: mlrName,
      operation: "mlr.receive-financials",
      protocol: "a2a",
      startedAt: new Date(mlr0 + 30).toISOString(),
      finishedAt: new Date(mlr0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "mlr-001",
        planRef: "plan-ind-2025",
        market: "individual",
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-mlr-003",
      taskId: mlrTaskId,
      parentSpanId: "span-mlr-002",
      agentId: "mlr-rebate-agent",
      agentName: mlrName,
      operation: "mlr.compute-ratio",
      protocol: "a2a",
      startedAt: new Date(mlr0 + 60).toISOString(),
      finishedAt: new Date(mlr0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mlr-001",
        mlr: 0.7789,
        meetsStandard: false,
        // The honesty invariant: the standard traces to the market catalog.
        mlrInputsSourced: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-mlr-004",
      taskId: mlrTaskId,
      parentSpanId: "span-mlr-003",
      agentId: "mlr-rebate-agent",
      agentName: mlrName,
      operation: "mlr.apportion-rebate",
      protocol: "a2a",
      startedAt: new Date(mlr0 + 100).toISOString(),
      finishedAt: new Date(mlr0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mlr-001",
        totalRebate: 21100,
        subscriberCount: 3,
        // The honesty invariant: MLR + rebate + apportionment are exact.
        mlrAllocationConsistent: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-mlr-005",
      taskId: mlrTaskId,
      parentSpanId: "span-mlr-004",
      agentId: "mlr-rebate-agent",
      agentName: mlrName,
      operation: "mlr.log-audit",
      protocol: "a2a",
      startedAt: new Date(mlr0 + 140).toISOString(),
      finishedAt: new Date(mlr0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mlr-001",
        totalRebate: 21100,
        // The honesty invariant: never an autonomous disbursement.
        mlrNoAutonomousDisbursement: true,
        requiresTreasuryReview: true,
        phiAccessed: false,
        synthetic: true
      }
    }
  );
})();

(function seedEnrollmentReconciliationTrace() {
  const s = store();
  const recon0 = Date.now() - 1000 * 60 * 1;
  const reconTaskId = "task-seed-enrollment-reconciliation-001";
  const reconName = "Eligibility & Enrollment (834) Reconciliation Agent";
  s.traces.push(
    {
      id: "span-recon-001",
      taskId: reconTaskId,
      agentId: "enrollment-reconciliation-agent",
      agentName: reconName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(recon0).toISOString(),
      finishedAt: new Date(recon0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recon-002",
      taskId: reconTaskId,
      parentSpanId: "span-recon-001",
      agentId: "enrollment-reconciliation-agent",
      agentName: reconName,
      operation: "enrollment.receive-rosters",
      protocol: "a2a",
      startedAt: new Date(recon0 + 30).toISOString(),
      finishedAt: new Date(recon0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "recon-001",
        groupRef: "group-4821",
        totalMembers: 4,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recon-003",
      taskId: reconTaskId,
      parentSpanId: "span-recon-002",
      agentId: "enrollment-reconciliation-agent",
      agentName: reconName,
      operation: "enrollment.diff-rosters",
      protocol: "a2a",
      startedAt: new Date(recon0 + 60).toISOString(),
      finishedAt: new Date(recon0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "recon-001",
        enroll: 1,
        terminate: 1,
        update: 1,
        noChange: 1,
        // The honesty invariant: every member accounted for exactly once.
        reconciliationComplete: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recon-004",
      taskId: reconTaskId,
      parentSpanId: "span-recon-003",
      agentId: "enrollment-reconciliation-agent",
      agentName: reconName,
      operation: "enrollment.classify-actions",
      protocol: "a2a",
      startedAt: new Date(recon0 + 100).toISOString(),
      finishedAt: new Date(recon0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "recon-001",
        // The honesty invariant: every action sourced (no fabricated discrepancy).
        reconciliationActionsSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-recon-005",
      taskId: reconTaskId,
      parentSpanId: "span-recon-004",
      agentId: "enrollment-reconciliation-agent",
      agentName: reconName,
      operation: "enrollment.log-audit",
      protocol: "a2a",
      startedAt: new Date(recon0 + 140).toISOString(),
      finishedAt: new Date(recon0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "recon-001",
        totalMembers: 4,
        // The honesty invariant: never an autonomous enrollment change.
        reconciliationNoAutonomousChange: true,
        requiresBenefitsAdminReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedCarePathwayTrace() {
  const s = store();
  const path0 = Date.now() - 1000 * 60 * 1;
  const pathTaskId = "task-seed-care-pathway-001";
  const pathName = "Care Pathway Sequencing Agent";
  s.traces.push(
    {
      id: "span-pathway-001",
      taskId: pathTaskId,
      agentId: "care-pathway-agent",
      agentName: pathName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(path0).toISOString(),
      finishedAt: new Date(path0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pathway-002",
      taskId: pathTaskId,
      parentSpanId: "span-pathway-001",
      agentId: "care-pathway-agent",
      agentName: pathName,
      operation: "pathway.receive-steps",
      protocol: "a2a",
      startedAt: new Date(path0 + 30).toISOString(),
      finishedAt: new Date(path0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "pathway-001",
        pathwayRef: "menopause-workup-v1",
        stepCount: 6,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pathway-003",
      taskId: pathTaskId,
      parentSpanId: "span-pathway-002",
      agentId: "care-pathway-agent",
      agentName: pathName,
      operation: "pathway.check-prerequisites",
      protocol: "a2a",
      startedAt: new Date(path0 + 60).toISOString(),
      finishedAt: new Date(path0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "pathway-001",
        // The honesty invariant: every step sourced (no fabricated / dangling step).
        pathwayStepsSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pathway-004",
      taskId: pathTaskId,
      parentSpanId: "span-pathway-003",
      agentId: "care-pathway-agent",
      agentName: pathName,
      operation: "pathway.topological-sort",
      protocol: "a2a",
      startedAt: new Date(path0 + 100).toISOString(),
      finishedAt: new Date(path0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "pathway-001",
        disposition: "sequenced",
        stageCount: 5,
        // The honesty invariant: the sequence respects every prerequisite.
        pathwaySequenceValid: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pathway-005",
      taskId: pathTaskId,
      parentSpanId: "span-pathway-004",
      agentId: "care-pathway-agent",
      agentName: pathName,
      operation: "pathway.log-audit",
      protocol: "a2a",
      startedAt: new Date(path0 + 140).toISOString(),
      finishedAt: new Date(path0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "pathway-001",
        // The honesty invariant: never an autonomous step execution.
        pathwayNoAutonomousExecution: true,
        requiresClinicianReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedCoverageContinuityTrace() {
  const s = store();
  const cov0 = Date.now() - 1000 * 60 * 1;
  const covTaskId = "task-seed-coverage-continuity-001";
  const covName = "Creditable Coverage Continuity Agent";
  s.traces.push(
    {
      id: "span-coverage-001",
      taskId: covTaskId,
      agentId: "coverage-continuity-agent",
      agentName: covName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cov0).toISOString(),
      finishedAt: new Date(cov0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-coverage-002",
      taskId: covTaskId,
      parentSpanId: "span-coverage-001",
      agentId: "coverage-continuity-agent",
      agentName: covName,
      operation: "coverage.receive-segments",
      protocol: "a2a",
      startedAt: new Date(cov0 + 30).toISOString(),
      finishedAt: new Date(cov0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "cov-001",
        memberRef: "member-4821",
        segmentCount: 2,
        // The honesty invariant: every span sourced (no fabricated coverage).
        coverageSegmentsSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-coverage-003",
      taskId: covTaskId,
      parentSpanId: "span-coverage-002",
      agentId: "coverage-continuity-agent",
      agentName: covName,
      operation: "coverage.merge-intervals",
      protocol: "a2a",
      startedAt: new Date(cov0 + 60).toISOString(),
      finishedAt: new Date(cov0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cov-001",
        spanCount: 2,
        totalCoveredDays: 352,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-coverage-004",
      taskId: covTaskId,
      parentSpanId: "span-coverage-003",
      agentId: "coverage-continuity-agent",
      agentName: covName,
      operation: "coverage.detect-gaps",
      protocol: "a2a",
      startedAt: new Date(cov0 + 100).toISOString(),
      finishedAt: new Date(cov0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cov-001",
        disposition: "continuous",
        gapCount: 1,
        hasSignificantBreak: false,
        // The honesty invariant: the coverage math is exact.
        coverageMathConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-coverage-005",
      taskId: covTaskId,
      parentSpanId: "span-coverage-004",
      agentId: "coverage-continuity-agent",
      agentName: covName,
      operation: "coverage.log-audit",
      protocol: "a2a",
      startedAt: new Date(cov0 + 140).toISOString(),
      finishedAt: new Date(cov0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cov-001",
        // The honesty invariant: never an autonomous coverage determination.
        coverageNoAutonomousDetermination: true,
        requiresEligibilityReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedAccessAnomalyTrace() {
  const s = store();
  const aad0 = Date.now() - 1000 * 60 * 1;
  const aadTaskId = "task-seed-access-anomaly-001";
  const aadName = "Access Anomaly Detection Agent";
  s.traces.push(
    {
      id: "span-access-anomaly-001",
      taskId: aadTaskId,
      agentId: "access-anomaly-agent",
      agentName: aadName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(aad0).toISOString(),
      finishedAt: new Date(aad0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-access-anomaly-002",
      taskId: aadTaskId,
      parentSpanId: "span-access-anomaly-001",
      agentId: "access-anomaly-agent",
      agentName: aadName,
      operation: "access.receive-events",
      protocol: "a2a",
      startedAt: new Date(aad0 + 30).toISOString(),
      finishedAt: new Date(aad0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "aad-001",
        actorRef: "actor-3391",
        eventCount: 24,
        // The honesty invariant: every counted access sourced (no fabricated access).
        accessEventsSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-access-anomaly-003",
      taskId: aadTaskId,
      parentSpanId: "span-access-anomaly-002",
      agentId: "access-anomaly-agent",
      agentName: aadName,
      operation: "access.scan-window",
      protocol: "a2a",
      startedAt: new Date(aad0 + 60).toISOString(),
      finishedAt: new Date(aad0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "aad-001",
        peakCount: 24,
        windowMinutes: 60,
        // The honesty invariant: the window count is exact.
        accessWindowCountConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-access-anomaly-004",
      taskId: aadTaskId,
      parentSpanId: "span-access-anomaly-003",
      agentId: "access-anomaly-agent",
      agentName: aadName,
      operation: "access.flag-anomaly",
      protocol: "a2a",
      startedAt: new Date(aad0 + 100).toISOString(),
      finishedAt: new Date(aad0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "aad-001",
        disposition: "anomalous-access-volume",
        hasAnomaly: true,
        distinctPatients: 24,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-access-anomaly-005",
      taskId: aadTaskId,
      parentSpanId: "span-access-anomaly-004",
      agentId: "access-anomaly-agent",
      agentName: aadName,
      operation: "access.log-audit",
      protocol: "a2a",
      startedAt: new Date(aad0 + 140).toISOString(),
      finishedAt: new Date(aad0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "aad-001",
        // The honesty invariant: never an autonomous access action.
        accessNoAutonomousAction: true,
        requiresPrivacyReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedCaseloadBalancingTrace() {
  const s = store();
  const cbl0 = Date.now() - 1000 * 60 * 1;
  const cblTaskId = "task-seed-caseload-balancing-001";
  const cblName = "Caseload Balancing (Care-Manager Panel Assignment) Agent";
  s.traces.push(
    {
      id: "span-caseload-001",
      taskId: cblTaskId,
      agentId: "caseload-balancing-agent",
      agentName: cblName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(cbl0).toISOString(),
      finishedAt: new Date(cbl0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-caseload-002",
      taskId: cblTaskId,
      parentSpanId: "span-caseload-001",
      agentId: "caseload-balancing-agent",
      agentName: cblName,
      operation: "caseload.receive-panel",
      protocol: "a2a",
      startedAt: new Date(cbl0 + 30).toISOString(),
      finishedAt: new Date(cbl0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "cbl-001",
        panelRef: "panel-4821",
        memberCount: 6,
        managerCount: 3,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-caseload-003",
      taskId: cblTaskId,
      parentSpanId: "span-caseload-002",
      agentId: "caseload-balancing-agent",
      agentName: cblName,
      operation: "caseload.allocate",
      protocol: "a2a",
      startedAt: new Date(cbl0 + 60).toISOString(),
      finishedAt: new Date(cbl0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cbl-001",
        assignedCount: 6,
        waitlistedCount: 0,
        // The honesty invariants: every member accounted for once, capacity respected.
        caseloadAssignmentComplete: true,
        caseloadCapacityRespected: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-caseload-004",
      taskId: cblTaskId,
      parentSpanId: "span-caseload-003",
      agentId: "caseload-balancing-agent",
      agentName: cblName,
      operation: "caseload.check-capacity",
      protocol: "a2a",
      startedAt: new Date(cbl0 + 100).toISOString(),
      finishedAt: new Date(cbl0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cbl-001",
        disposition: "fully-assigned",
        totalAssignedAcuity: 21,
        totalCapacity: 24,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-caseload-005",
      taskId: cblTaskId,
      parentSpanId: "span-caseload-004",
      agentId: "caseload-balancing-agent",
      agentName: cblName,
      operation: "caseload.log-audit",
      protocol: "a2a",
      startedAt: new Date(cbl0 + 140).toISOString(),
      finishedAt: new Date(cbl0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "cbl-001",
        // The honesty invariant: never an autonomous assignment.
        caseloadNoAutonomousAssignment: true,
        requiresCareLeadReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedScheduleConflictTrace() {
  const s = store();
  const scr0 = Date.now() - 1000 * 60 * 1;
  const scrTaskId = "task-seed-schedule-conflict-001";
  const scrName = "Scheduling Conflict / Double-Booking Guard Agent";
  s.traces.push(
    {
      id: "span-schedule-conflict-001",
      taskId: scrTaskId,
      agentId: "schedule-conflict-agent",
      agentName: scrName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(scr0).toISOString(),
      finishedAt: new Date(scr0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-schedule-conflict-002",
      taskId: scrTaskId,
      parentSpanId: "span-schedule-conflict-001",
      agentId: "schedule-conflict-agent",
      agentName: scrName,
      operation: "schedule.receive-requests",
      protocol: "a2a",
      startedAt: new Date(scr0 + 30).toISOString(),
      finishedAt: new Date(scr0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "scr-002",
        resourceRef: "provider-mscp-day-2026-03-03",
        requestCount: 4,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-schedule-conflict-003",
      taskId: scrTaskId,
      parentSpanId: "span-schedule-conflict-002",
      agentId: "schedule-conflict-agent",
      agentName: scrName,
      operation: "schedule.select-intervals",
      protocol: "a2a",
      startedAt: new Date(scr0 + 60).toISOString(),
      finishedAt: new Date(scr0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "scr-002",
        scheduledCount: 2,
        conflictCount: 2,
        // The honesty invariants: every appointment sourced, schedule conflict-free.
        scheduleIntervalsSourced: true,
        scheduleConflictFree: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-schedule-conflict-004",
      taskId: scrTaskId,
      parentSpanId: "span-schedule-conflict-003",
      agentId: "schedule-conflict-agent",
      agentName: scrName,
      operation: "schedule.check-conflicts",
      protocol: "a2a",
      startedAt: new Date(scr0 + 100).toISOString(),
      finishedAt: new Date(scr0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "scr-002",
        disposition: "conflicts-waitlisted",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-schedule-conflict-005",
      taskId: scrTaskId,
      parentSpanId: "span-schedule-conflict-004",
      agentId: "schedule-conflict-agent",
      agentName: scrName,
      operation: "schedule.log-audit",
      protocol: "a2a",
      startedAt: new Date(scr0 + 140).toISOString(),
      finishedAt: new Date(scr0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "scr-002",
        // The honesty invariant: never an autonomous booking.
        scheduleNoAutonomousBooking: true,
        requiresSchedulerReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedMedicationNameSafetyTrace() {
  const s = store();
  const mns0 = Date.now() - 1000 * 60 * 1;
  const mnsTaskId = "task-seed-medication-name-safety-001";
  const mnsName = "Medication Name Safety (LASA) Agent";
  s.traces.push(
    {
      id: "span-med-name-safety-001",
      taskId: mnsTaskId,
      agentId: "medication-name-safety-agent",
      agentName: mnsName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(mns0).toISOString(),
      finishedAt: new Date(mns0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-med-name-safety-002",
      taskId: mnsTaskId,
      parentSpanId: "span-med-name-safety-001",
      agentId: "medication-name-safety-agent",
      agentName: mnsName,
      operation: "lasa.receive-name",
      protocol: "a2a",
      startedAt: new Date(mns0 + 30).toISOString(),
      finishedAt: new Date(mns0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        requestRef: "mns-002",
        prescribedName: "premarin",
        catalogSize: 10,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-med-name-safety-003",
      taskId: mnsTaskId,
      parentSpanId: "span-med-name-safety-002",
      agentId: "medication-name-safety-agent",
      agentName: mnsName,
      operation: "lasa.compute-distances",
      protocol: "a2a",
      startedAt: new Date(mns0 + 60).toISOString(),
      finishedAt: new Date(mns0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mns-002",
        nearestName: "premarin",
        nearestDistance: 0,
        confusableCount: 1,
        // The honesty invariants: candidates sourced, distances exact.
        lasaCandidatesSourced: true,
        lasaDistancesConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-med-name-safety-004",
      taskId: mnsTaskId,
      parentSpanId: "span-med-name-safety-003",
      agentId: "medication-name-safety-agent",
      agentName: mnsName,
      operation: "lasa.flag-lookalike",
      protocol: "a2a",
      startedAt: new Date(mns0 + 100).toISOString(),
      finishedAt: new Date(mns0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mns-002",
        disposition: "lasa-warning",
        lookAlike: "primaxin",
        lookAlikeDistance: 2,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-med-name-safety-005",
      taskId: mnsTaskId,
      parentSpanId: "span-med-name-safety-004",
      agentId: "medication-name-safety-agent",
      agentName: mnsName,
      operation: "lasa.log-audit",
      protocol: "a2a",
      startedAt: new Date(mns0 + 140).toISOString(),
      finishedAt: new Date(mns0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        requestRef: "mns-002",
        // The honesty invariant: never an autonomous substitution.
        lasaNoAutonomousSubstitution: true,
        requiresPharmacistReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedClaimLifecycleTrace() {
  const s = store();
  const clm0 = Date.now() - 1000 * 60 * 1;
  const clmTaskId = "task-seed-claim-lifecycle-001";
  const clmName = "Claim Lifecycle / Status-Transition Guard Agent";
  s.traces.push(
    {
      id: "span-claim-lifecycle-001",
      taskId: clmTaskId,
      agentId: "claim-lifecycle-agent",
      agentName: clmName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(clm0).toISOString(),
      finishedAt: new Date(clm0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claim-lifecycle-002",
      taskId: clmTaskId,
      parentSpanId: "span-claim-lifecycle-001",
      agentId: "claim-lifecycle-agent",
      agentName: clmName,
      operation: "claim.receive-transition",
      protocol: "a2a",
      startedAt: new Date(clm0 + 30).toISOString(),
      finishedAt: new Date(clm0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        claimRef: "clm-002",
        currentStatus: "draft",
        requestedStatus: "paid",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claim-lifecycle-003",
      taskId: clmTaskId,
      parentSpanId: "span-claim-lifecycle-002",
      agentId: "claim-lifecycle-agent",
      agentName: clmName,
      operation: "claim.check-transition",
      protocol: "a2a",
      startedAt: new Date(clm0 + 60).toISOString(),
      finishedAt: new Date(clm0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "clm-002",
        directEdge: false,
        // The honesty invariant: states sourced from the machine.
        claimStatesSourced: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claim-lifecycle-004",
      taskId: clmTaskId,
      parentSpanId: "span-claim-lifecycle-003",
      agentId: "claim-lifecycle-agent",
      agentName: clmName,
      operation: "claim.compute-reachability",
      protocol: "a2a",
      startedAt: new Date(clm0 + 100).toISOString(),
      finishedAt: new Date(clm0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "clm-002",
        disposition: "transition-illegal-but-reachable",
        pathLength: 4,
        // The honesty invariant: transition logic exact.
        claimTransitionConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-claim-lifecycle-005",
      taskId: clmTaskId,
      parentSpanId: "span-claim-lifecycle-004",
      agentId: "claim-lifecycle-agent",
      agentName: clmName,
      operation: "claim.log-audit",
      protocol: "a2a",
      startedAt: new Date(clm0 + 140).toISOString(),
      finishedAt: new Date(clm0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        claimRef: "clm-002",
        // The honesty invariant: never an autonomous advance.
        claimNoAutonomousAdvance: true,
        requiresAdjusterReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedProviderBenchmarkingTrace() {
  const s = store();
  const bmk0 = Date.now() - 1000 * 60 * 1;
  const bmkTaskId = "task-seed-provider-benchmarking-001";
  const bmkName = "Provider Cost & Quality Percentile Benchmarking Agent";
  s.traces.push(
    {
      id: "span-provider-benchmarking-001",
      taskId: bmkTaskId,
      agentId: "provider-benchmarking-agent",
      agentName: bmkName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(bmk0).toISOString(),
      finishedAt: new Date(bmk0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // NOT PHI-bearing — provider-level aggregate metrics.
        synthetic: true
      }
    },
    {
      id: "span-provider-benchmarking-002",
      taskId: bmkTaskId,
      parentSpanId: "span-provider-benchmarking-001",
      agentId: "provider-benchmarking-agent",
      agentName: bmkName,
      operation: "benchmark.receive-metric",
      protocol: "a2a",
      startedAt: new Date(bmk0 + 30).toISOString(),
      finishedAt: new Date(bmk0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        benchmarkRef: "bmk-002",
        metricName: "risk-adjusted-cost-per-episode",
        cohortSize: 9,
        synthetic: true
      }
    },
    {
      id: "span-provider-benchmarking-003",
      taskId: bmkTaskId,
      parentSpanId: "span-provider-benchmarking-002",
      agentId: "provider-benchmarking-agent",
      agentName: bmkName,
      operation: "benchmark.compute-percentile",
      protocol: "a2a",
      startedAt: new Date(bmk0 + 60).toISOString(),
      finishedAt: new Date(bmk0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        benchmarkRef: "bmk-002",
        percentileRank: 88.89,
        effectivePercentile: 11.11,
        // The honesty invariants: cohort sourced, stats exact.
        benchmarkCohortSourced: true,
        benchmarkStatsConsistent: true,
        synthetic: true
      }
    },
    {
      id: "span-provider-benchmarking-004",
      taskId: bmkTaskId,
      parentSpanId: "span-provider-benchmarking-003",
      agentId: "provider-benchmarking-agent",
      agentName: bmkName,
      operation: "benchmark.classify-band",
      protocol: "a2a",
      startedAt: new Date(bmk0 + 100).toISOString(),
      finishedAt: new Date(bmk0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        benchmarkRef: "bmk-002",
        performanceBand: "bottom-quartile",
        disposition: "benchmark-review",
        synthetic: true
      }
    },
    {
      id: "span-provider-benchmarking-005",
      taskId: bmkTaskId,
      parentSpanId: "span-provider-benchmarking-004",
      agentId: "provider-benchmarking-agent",
      agentName: bmkName,
      operation: "benchmark.log-audit",
      protocol: "a2a",
      startedAt: new Date(bmk0 + 140).toISOString(),
      finishedAt: new Date(bmk0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        benchmarkRef: "bmk-002",
        // The honesty invariant: never an autonomous tiering.
        benchmarkNoAutonomousTiering: true,
        requiresNetworkReview: true,
        synthetic: true
      }
    }
  );
})();

(function seedHouseholdCompositionTrace() {
  const s = store();
  const hh0 = Date.now() - 1000 * 60 * 1;
  const hhTaskId = "task-seed-household-composition-001";
  const hhName = "Household / Family-Unit Composition Agent";
  s.traces.push(
    {
      id: "span-household-composition-001",
      taskId: hhTaskId,
      agentId: "household-composition-agent",
      agentName: hhName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(hh0).toISOString(),
      finishedAt: new Date(hh0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-household-composition-002",
      taskId: hhTaskId,
      parentSpanId: "span-household-composition-001",
      agentId: "household-composition-agent",
      agentName: hhName,
      operation: "household.receive-batch",
      protocol: "a2a",
      startedAt: new Date(hh0 + 30).toISOString(),
      finishedAt: new Date(hh0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        batchRef: "hh-batch-001",
        memberCount: 6,
        linkCount: 3,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-household-composition-003",
      taskId: hhTaskId,
      parentSpanId: "span-household-composition-002",
      agentId: "household-composition-agent",
      agentName: hhName,
      operation: "household.compute-components",
      protocol: "a2a",
      startedAt: new Date(hh0 + 60).toISOString(),
      finishedAt: new Date(hh0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "hh-batch-001",
        householdCount: 3,
        largestHouseholdSize: 3,
        // The honesty invariants: links sourced, partition exact.
        householdLinksSourced: true,
        householdPartitionConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-household-composition-004",
      taskId: hhTaskId,
      parentSpanId: "span-household-composition-003",
      agentId: "household-composition-agent",
      agentName: hhName,
      operation: "household.classify-disposition",
      protocol: "a2a",
      startedAt: new Date(hh0 + 100).toISOString(),
      finishedAt: new Date(hh0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "hh-batch-001",
        disposition: "households-formed",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-household-composition-005",
      taskId: hhTaskId,
      parentSpanId: "span-household-composition-004",
      agentId: "household-composition-agent",
      agentName: hhName,
      operation: "household.log-audit",
      protocol: "a2a",
      startedAt: new Date(hh0 + 140).toISOString(),
      finishedAt: new Date(hh0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "hh-batch-001",
        // The honesty invariant: never an autonomous merge.
        householdNoAutonomousMerge: true,
        requiresStewardReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedIdentifierValidationTrace() {
  const s = store();
  const iv0 = Date.now() - 1000 * 60 * 1;
  const ivTaskId = "task-seed-identifier-validation-001";
  const ivName = "Provider Identifier (NPI) Validation & Integrity Agent";
  s.traces.push(
    {
      id: "span-identifier-validation-001",
      taskId: ivTaskId,
      agentId: "identifier-validation-agent",
      agentName: ivName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(iv0).toISOString(),
      finishedAt: new Date(iv0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        // NOT PHI-bearing — an NPI is a provider identifier, not patient health information.
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-identifier-validation-002",
      taskId: ivTaskId,
      parentSpanId: "span-identifier-validation-001",
      agentId: "identifier-validation-agent",
      agentName: ivName,
      operation: "identifier.receive-batch",
      protocol: "a2a",
      startedAt: new Date(iv0 + 30).toISOString(),
      finishedAt: new Date(iv0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        batchRef: "npi-batch-001",
        total: 3,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-identifier-validation-003",
      taskId: ivTaskId,
      parentSpanId: "span-identifier-validation-002",
      agentId: "identifier-validation-agent",
      agentName: ivName,
      operation: "identifier.validate-checksums",
      protocol: "a2a",
      startedAt: new Date(iv0 + 60).toISOString(),
      finishedAt: new Date(iv0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "npi-batch-001",
        validCount: 1,
        invalidFormatCount: 1,
        invalidChecksumCount: 1,
        // The honesty invariants: identifiers sourced, checksums recompute.
        identifiersSourced: true,
        checksumConsistent: true,
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-identifier-validation-004",
      taskId: ivTaskId,
      parentSpanId: "span-identifier-validation-003",
      agentId: "identifier-validation-agent",
      agentName: ivName,
      operation: "identifier.classify-disposition",
      protocol: "a2a",
      startedAt: new Date(iv0 + 100).toISOString(),
      finishedAt: new Date(iv0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "npi-batch-001",
        disposition: "invalids-flagged",
        phiAccessed: false,
        synthetic: true
      }
    },
    {
      id: "span-identifier-validation-005",
      taskId: ivTaskId,
      parentSpanId: "span-identifier-validation-004",
      agentId: "identifier-validation-agent",
      agentName: ivName,
      operation: "identifier.log-audit",
      protocol: "a2a",
      startedAt: new Date(iv0 + 140).toISOString(),
      finishedAt: new Date(iv0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        batchRef: "npi-batch-001",
        // The honesty invariant: never an autonomous reject.
        identifierNoAutonomousReject: true,
        requiresStewardReview: true,
        phiAccessed: false,
        synthetic: true
      }
    }
  );
})();

(function seedNetworkAdequacyTrace() {
  const s = store();
  const na0 = Date.now() - 1000 * 60 * 1;
  const naTaskId = "task-seed-network-adequacy-001";
  const naName = "Network Adequacy / Time-and-Distance Agent";
  s.traces.push(
    {
      id: "span-network-adequacy-001",
      taskId: naTaskId,
      agentId: "network-adequacy-agent",
      agentName: naName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(na0).toISOString(),
      finishedAt: new Date(na0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-network-adequacy-002",
      taskId: naTaskId,
      parentSpanId: "span-network-adequacy-001",
      agentId: "network-adequacy-agent",
      agentName: naName,
      operation: "adequacy.receive-request",
      protocol: "a2a",
      startedAt: new Date(na0 + 30).toISOString(),
      finishedAt: new Date(na0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        caseRef: "adequacy-case-002",
        requiredSpecialty: "endocrinology",
        maxDistanceMiles: 10,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-network-adequacy-003",
      taskId: naTaskId,
      parentSpanId: "span-network-adequacy-002",
      agentId: "network-adequacy-agent",
      agentName: naName,
      operation: "adequacy.compute-distances",
      protocol: "a2a",
      startedAt: new Date(na0 + 60).toISOString(),
      finishedAt: new Date(na0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "adequacy-case-002",
        matchingProviderCount: 2,
        nearestDistanceMiles: 16.44,
        // The honesty invariants: providers sourced, distances exact.
        providersSourced: true,
        distancesConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-network-adequacy-004",
      taskId: naTaskId,
      parentSpanId: "span-network-adequacy-003",
      agentId: "network-adequacy-agent",
      agentName: naName,
      operation: "adequacy.classify-disposition",
      protocol: "a2a",
      startedAt: new Date(na0 + 100).toISOString(),
      finishedAt: new Date(na0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "adequacy-case-002",
        disposition: "adequacy-gap",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-network-adequacy-005",
      taskId: naTaskId,
      parentSpanId: "span-network-adequacy-004",
      agentId: "network-adequacy-agent",
      agentName: naName,
      operation: "adequacy.log-audit",
      protocol: "a2a",
      startedAt: new Date(na0 + 140).toISOString(),
      finishedAt: new Date(na0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "adequacy-case-002",
        // The honesty invariant: never an autonomous network change.
        noAutonomousNetworkChange: true,
        requiresNetworkReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedPcpMatchingTrace() {
  const s = store();
  const pm0 = Date.now() - 1000 * 60 * 1;
  const pmTaskId = "task-seed-pcp-matching-001";
  const pmName = "Primary Care Provider (PCP) Assignment / Member–Provider Matching Agent";
  s.traces.push(
    {
      id: "span-pcp-matching-001",
      taskId: pmTaskId,
      agentId: "pcp-matching-agent",
      agentName: pmName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(pm0).toISOString(),
      finishedAt: new Date(pm0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pcp-matching-002",
      taskId: pmTaskId,
      parentSpanId: "span-pcp-matching-001",
      agentId: "pcp-matching-agent",
      agentName: pmName,
      operation: "pcp.receive-panel",
      protocol: "a2a",
      startedAt: new Date(pm0 + 30).toISOString(),
      finishedAt: new Date(pm0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        panelRef: "pcp-panel-001",
        memberCount: 3,
        providerCount: 3,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pcp-matching-003",
      taskId: pmTaskId,
      parentSpanId: "span-pcp-matching-002",
      agentId: "pcp-matching-agent",
      agentName: pmName,
      operation: "pcp.run-deferred-acceptance",
      protocol: "a2a",
      startedAt: new Date(pm0 + 60).toISOString(),
      finishedAt: new Date(pm0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        panelRef: "pcp-panel-001",
        matchedCount: 3,
        unmatchedCount: 0,
        // The honesty invariants: assignments sourced, matching stable.
        matchingSourced: true,
        matchingStable: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pcp-matching-004",
      taskId: pmTaskId,
      parentSpanId: "span-pcp-matching-003",
      agentId: "pcp-matching-agent",
      agentName: pmName,
      operation: "pcp.classify-disposition",
      protocol: "a2a",
      startedAt: new Date(pm0 + 100).toISOString(),
      finishedAt: new Date(pm0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        panelRef: "pcp-panel-001",
        disposition: "all-matched",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-pcp-matching-005",
      taskId: pmTaskId,
      parentSpanId: "span-pcp-matching-004",
      agentId: "pcp-matching-agent",
      agentName: pmName,
      operation: "pcp.log-audit",
      protocol: "a2a",
      startedAt: new Date(pm0 + 140).toISOString(),
      finishedAt: new Date(pm0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        panelRef: "pcp-panel-001",
        // The honesty invariant: never an autonomous assignment.
        pcpNoAutonomousAssignment: true,
        requiresCoordinatorReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedReportableConditionTrace() {
  const s = store();
  const rc0 = Date.now() - 1000 * 60 * 1;
  const rcTaskId = "task-seed-reportable-condition-001";
  const rcName = "Reportable / Notifiable Condition Case Classification Agent";
  s.traces.push(
    {
      id: "span-reportable-condition-001",
      taskId: rcTaskId,
      agentId: "reportable-condition-agent",
      agentName: rcName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(rc0).toISOString(),
      finishedAt: new Date(rc0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-reportable-condition-002",
      taskId: rcTaskId,
      parentSpanId: "span-reportable-condition-001",
      agentId: "reportable-condition-agent",
      agentName: rcName,
      operation: "rc.receive-case",
      protocol: "a2a",
      startedAt: new Date(rc0 + 30).toISOString(),
      finishedAt: new Date(rc0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        caseRef: "rc-case-001",
        condition: "acute-viral-hepatitis (illustrative)",
        factCount: 7,
        classificationCount: 3,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-reportable-condition-003",
      taskId: rcTaskId,
      parentSpanId: "span-reportable-condition-002",
      agentId: "reportable-condition-agent",
      agentName: rcName,
      operation: "rc.evaluate-criteria",
      protocol: "a2a",
      startedAt: new Date(rc0 + 60).toISOString(),
      finishedAt: new Date(rc0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "rc-case-001",
        // The honesty invariants: facts sourced, classification recomputes.
        caseFactsSourced: true,
        classificationConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-reportable-condition-004",
      taskId: rcTaskId,
      parentSpanId: "span-reportable-condition-003",
      agentId: "reportable-condition-agent",
      agentName: rcName,
      operation: "rc.classify",
      protocol: "a2a",
      startedAt: new Date(rc0 + 100).toISOString(),
      finishedAt: new Date(rc0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "rc-case-001",
        classification: "confirmed",
        reportable: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-reportable-condition-005",
      taskId: rcTaskId,
      parentSpanId: "span-reportable-condition-004",
      agentId: "reportable-condition-agent",
      agentName: rcName,
      operation: "rc.log-audit",
      protocol: "a2a",
      startedAt: new Date(rc0 + 140).toISOString(),
      finishedAt: new Date(rc0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        caseRef: "rc-case-001",
        // The honesty invariant: never an autonomous report.
        noAutonomousReport: true,
        requiresEpiReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedTimelineMergeTrace() {
  const s = store();
  const tm0 = Date.now() - 1000 * 60 * 1;
  const tmTaskId = "task-seed-timeline-merge-001";
  const tmName = "Clinical Event Timeline Merge / Multi-Source Record Reconciliation Agent";
  s.traces.push(
    {
      id: "span-timeline-merge-001",
      taskId: tmTaskId,
      agentId: "timeline-merge-agent",
      agentName: tmName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(tm0).toISOString(),
      finishedAt: new Date(tm0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-timeline-merge-002",
      taskId: tmTaskId,
      parentSpanId: "span-timeline-merge-001",
      agentId: "timeline-merge-agent",
      agentName: tmName,
      operation: "timeline.receive-streams",
      protocol: "a2a",
      startedAt: new Date(tm0 + 30).toISOString(),
      finishedAt: new Date(tm0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        recordRef: "record-merge-001",
        streamCount: 3,
        totalSubmitted: 6,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-timeline-merge-003",
      taskId: tmTaskId,
      parentSpanId: "span-timeline-merge-002",
      agentId: "timeline-merge-agent",
      agentName: tmName,
      operation: "timeline.merge-streams",
      protocol: "a2a",
      startedAt: new Date(tm0 + 60).toISOString(),
      finishedAt: new Date(tm0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        recordRef: "record-merge-001",
        keptCount: 4,
        duplicateCount: 2,
        // The honesty invariants: events sourced, merge recomputes.
        timelineEventsSourced: true,
        timelineMergeConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-timeline-merge-004",
      taskId: tmTaskId,
      parentSpanId: "span-timeline-merge-003",
      agentId: "timeline-merge-agent",
      agentName: tmName,
      operation: "timeline.classify-disposition",
      protocol: "a2a",
      startedAt: new Date(tm0 + 100).toISOString(),
      finishedAt: new Date(tm0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        recordRef: "record-merge-001",
        disposition: "duplicates-found",
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-timeline-merge-005",
      taskId: tmTaskId,
      parentSpanId: "span-timeline-merge-004",
      agentId: "timeline-merge-agent",
      agentName: tmName,
      operation: "timeline.log-audit",
      protocol: "a2a",
      startedAt: new Date(tm0 + 140).toISOString(),
      finishedAt: new Date(tm0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        recordRef: "record-merge-001",
        // The honesty invariant: never an autonomous write-back.
        timelineNoAutonomousMerge: true,
        requiresStewardReview: true,
        phiAccessed: true,
        synthetic: true
      }
    }
  );
})();

(function seedQualityShiftTrace() {
  const s = store();
  const qs0 = Date.now() - 1000 * 60 * 1;
  const qsTaskId = "task-seed-quality-shift-001";
  const qsName = "Clinical Quality-Measure Shift Detection (Statistical Process Control) Agent";
  s.traces.push(
    {
      id: "span-quality-shift-001",
      taskId: qsTaskId,
      agentId: "quality-shift-agent",
      agentName: qsName,
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(qs0).toISOString(),
      finishedAt: new Date(qs0 + 30).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-quality-shift-002",
      taskId: qsTaskId,
      parentSpanId: "span-quality-shift-001",
      agentId: "quality-shift-agent",
      agentName: qsName,
      operation: "quality.receive-series",
      protocol: "a2a",
      startedAt: new Date(qs0 + 30).toISOString(),
      finishedAt: new Date(qs0 + 60).toISOString(),
      durationMs: 30,
      status: "ok",
      attributes: {
        measureRef: "measure-mammography-screening-rate",
        observationCount: 7,
        target: 50,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-quality-shift-003",
      taskId: qsTaskId,
      parentSpanId: "span-quality-shift-002",
      agentId: "quality-shift-agent",
      agentName: qsName,
      operation: "quality.run-cusum",
      protocol: "a2a",
      startedAt: new Date(qs0 + 60).toISOString(),
      finishedAt: new Date(qs0 + 100).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        measureRef: "measure-mammography-screening-rate",
        peakHigh: 15,
        peakLow: 0,
        // The honesty invariants: observations sourced, CUSUM recomputes.
        qualityObservationsSourced: true,
        qualityCusumConsistent: true,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-quality-shift-004",
      taskId: qsTaskId,
      parentSpanId: "span-quality-shift-003",
      agentId: "quality-shift-agent",
      agentName: qsName,
      operation: "quality.classify-signal",
      protocol: "a2a",
      startedAt: new Date(qs0 + 100).toISOString(),
      finishedAt: new Date(qs0 + 140).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        measureRef: "measure-mammography-screening-rate",
        signal: "shift-up-detected",
        alarmIndex: 5,
        phiAccessed: true,
        synthetic: true
      }
    },
    {
      id: "span-quality-shift-005",
      taskId: qsTaskId,
      parentSpanId: "span-quality-shift-004",
      agentId: "quality-shift-agent",
      agentName: qsName,
      operation: "quality.log-audit",
      protocol: "a2a",
      startedAt: new Date(qs0 + 140).toISOString(),
      finishedAt: new Date(qs0 + 180).toISOString(),
      durationMs: 40,
      status: "ok",
      attributes: {
        measureRef: "measure-mammography-screening-rate",
        // The honesty invariant: never an autonomous intervention.
        qualityNoAutonomousIntervention: true,
        requiresQualityReview: true,
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
