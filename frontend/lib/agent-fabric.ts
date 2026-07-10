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
    endpoint: "salesforce://agentforce/pause-prospecting@v1",
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
    endpoint: "salesforce://agentforce/pause-inbound-leads@v1",
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
    endpoint: "salesforce://agentforce/pause-qualification@v1",
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
  }
];

const POLICIES: PolicyRecord[] = [
  {
    id: "policy.phi.no-free-text-pii",
    name: "No free-text PII in intake",
    description:
      "Patient-facing intake agents may not capture or persist free-text PII (full names, SSNs, addresses). Structured fields only.",
    appliesTo: ["agentforce-intake"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.intake.red-flag-mandatory",
    name: "Red-flag screen is non-optional",
    description:
      "Every intake task must include the standardized red-flag screening question. Tasks without it are rejected by the Care Router.",
    appliesTo: ["agentforce-intake", "care-router-claude"],
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
      "qualification-agent"
    ],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.model.anthropic-claude-sonnet-allowlisted",
    name: "Model allow-list",
    description:
      "Only models on the customer's approved list may serve clinical-decision agents. Default allow-list: claude-sonnet-4-5, claude-opus-4-7. Other models are blocked at policy evaluation time.",
    appliesTo: ["care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.no-prescribing",
    name: "No autonomous prescribing",
    description:
      "Clinical-decision agents may recommend pathways but may not write prescriptions, order labs, or commit clinical actions without a human-in-the-loop clinician.",
    appliesTo: ["care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.rationale-required",
    name: "Rationale required on every decision",
    description:
      "Every routing decision must include human-readable rationale. Decisions without rationale are rejected and re-issued to the model.",
    appliesTo: ["care-router-claude"],
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
    appliesTo: ["salesforce-data-360", "care-router-claude"],
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
    appliesTo: ["prospecting-agent", "engagement-agent"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.marketing.human-approval-before-send",
    name: "Human approval before any patient message",
    description:
      "Outreach and engagement messages are drafted for human review. No message is delivered to a prospect or patient without a human-in-the-loop approval — the prototype never sends autonomously.",
    appliesTo: ["prospecting-agent", "engagement-agent"],
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
    appliesTo: ["engagement-agent"],
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
