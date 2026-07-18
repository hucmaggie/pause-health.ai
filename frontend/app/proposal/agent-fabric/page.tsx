import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";
import {
  GOVERNANCE_PLANES,
  PLANES_IN_ORDER,
  planeForTier,
  tierLabel,
  type GovernanceTier
} from "../../../lib/governance-tiers";

export const metadata = pageMetadata({
  title: "Investor Brief · Multi-Agent Control Plane",
  description:
    "Pause-Health.ai's multi-agent architecture — Agentforce inbound lead generation, prospecting & nurture, qualification, intake, appointment scheduling, cosign-gated specialist referral management, claim-sourced member service / billing, clinician-gated prior authorization, engagement, proactive care-gap closure, and nudge-only medication adherence, the Anthropic Claude Care Router, the Pause MCP server, the MuleSoft integration plane, and a PHI-separated commercial plane (pipeline + account management) — orchestrated, monitored, and governed by a MuleSoft Agent Fabric control plane.",
  path: "/proposal/agent-fabric",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause multi-agent control plane — investor brief."
});

const agents: { name: string; role: string; tier: GovernanceTier; detail: string }[] = [
  {
    name: "Agentforce Inbound Lead Generation",
    role: "Inbound acquisition (site & chat)",
    tier: "patient-acquisition",
    detail:
      "The inbound complement to outbound prospecting. Captures interest from the marketing site, Agentforce web chat, and symptom-check forms; qualifies each visitor against the menopause-care ICP and scores readiness; creates an opt-in-consented lead in Data 360 with source attribution, resolved against existing patients/prospects so nothing duplicates. Routes a ready lead straight to intake and a not-yet-ready lead into the Prospecting & Nurture cadence — both over A2A."
  },
  {
    name: "Agentforce Prospecting & Nurture Agent",
    role: "Outbound acquisition + lead nurture (top of funnel)",
    tier: "patient-acquisition",
    detail:
      "Turns Data 360 population segments (e.g., the 40-60 vasomotor-burden cohort) into consented prospect audiences, then scores and warms leads across a multi-touch nurture cadence — drafting each outreach and nurture touch via Marketing Cloud for human review, never auto-sent. Suppresses anyone lacking contact consent, drops a prospect from every sequence the instant they convert or opt out, and hands a sufficiently-warmed prospect to the intake agent over A2A."
  },
  {
    name: "Agentforce Qualification",
    role: "Lead qualification (the gate before intake)",
    tier: "lead-qualification",
    detail:
      "The authoritative qualifier both acquisition paths hand off to. Applies one consistent rubric (menopause-care fit + eligibility + expressed intent/readiness) to inbound and outbound leads alike, and returns a qualified/disqualified decision with human-readable rationale on every lead. Routes qualified-and-ready leads to intake and qualified-but-warming ones back into nurture. Protected-class attributes are excluded from the criteria, and every disqualification is logged for human review."
  },
  {
    name: "Agentforce Service Agent",
    role: "Patient-facing intake (front door)",
    tier: "patient-facing",
    detail:
      "Captures the structured intake record, performs red-flag screening, and produces an Open-mHealth-shaped artifact. Speaks Google A2A outbound."
  },
  {
    name: "Agentforce Assessment Agent",
    role: "Validated-instrument scoring (patient-facing)",
    tier: "patient-facing",
    detail:
      "The Salesforce 'Agentforce for Health — Assessments' analog. Administers and DETERMINISTICALLY scores an allow-listed set of validated instruments — the Menopause Rating Scale, Greene Climacteric Scale, PHQ-9, and Insomnia Severity Index — with real cutoff-based math, no LLM: per-instrument subscores, a total, and a severity band normalized onto intake's mild/moderate/severe vocabulary. It screens red-flag items (e.g. PHQ-9 item 9 self-harm ideation) and escalates them explicitly, and it refuses any instrument outside the validated allow-list. The scored severity feeds IntakeRecord.severity, so the Care Router's decision is backed by a validated instrument rather than a self-report."
  },
  {
    name: "Agentforce Benefits & Coverage Verification (EBV)",
    role: "Eligibility & benefit verification (patient access)",
    tier: "benefits-verification",
    detail:
      "The Salesforce 'Agentforce for Health — Eligibility & Benefit Verification' analog. Verifies a patient's insurance coverage for a menopause specialist (MSCP) visit and returns a structured eligibility result — plan status (active/inactive), in/out-of-network, deductible + amount met, coinsurance/copay, and an estimated visit cost + patient out-of-pocket — with the (mock) payer/clearinghouse EBV source the result traces to. In the prototype the EBV round-trip is a DETERMINISTIC synthetic (deductible $1,500–$6,000, coinsurance 10–30%, visit $180–$420), clearly labeled synthetic — not a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse. Governance requires every returned result to trace to a payer/clearinghouse response, so the agent can't fabricate coverage without a source; the eligibility summary threads into the intake → Care Router spine so a coverage check can precede routing."
  },
  {
    name: "Pause Care Router (Anthropic Claude Sonnet 4.5)",
    role: "Clinical-decision agent",
    tier: "clinical-decision",
    detail:
      "Takes the structured intake over A2A, reasons over symptoms + cycle + safety screen + age band, and returns one of six care pathways with rationale and red-flag flags. Falls back to a deterministic Pause policy engine when ANTHROPIC_API_KEY is unset or the API call fails."
  },
  {
    name: "Pause Care Plan (Anthropic Claude Sonnet 4.5)",
    role: "Post-visit care plan + progress summary (clinical decision)",
    tier: "clinical-decision",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud CarePlan analog, a clinical-plane sibling of the Care Router and the SECOND live-Claude agent on the fabric. Post-visit, it DETERMINISTICALLY instantiates a menopause care plan (goals, interventions, follow-up cadence) from a defined template — HRT-management, vasomotor/lifestyle, bone-health, or mood/behavioral — selected by the Care Router's pathway/severity + intake, so the same context always yields the same plan and every plan references a defined template id (never fabricated; governance genuinely blocks any off-template plan via policy.careplan.template-sourced). It then generates a patient/clinician progress summary with live Anthropic Claude — the same model + allow-list as the Care Router — falling back to a DETERMINISTIC scripted summary (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails, exactly like the Care Router. Summaries are NON-PRESCRIPTIVE (they never add or change a medication, dose, order, or prescription). The templates are ILLUSTRATIVE synthetics, clearly labeled — not a certified care-plan engine."
  },
  {
    name: "Agentforce Appointment Scheduling",
    role: "Book / reschedule the MSCP visit (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health — Book/Reschedule/Update Appointment' analog, and the step that closes the loop: it books (and can reschedule) the MSCP menopause-specialist visit the Care Router recommends, honoring the requested modality (telehealth / in-person) against a provider availability calendar, and returns a structured booking — a Salesforce ServiceAppointment id, the confirmed slot start/end, modality, provider, and status. In the prototype the calendar is a DETERMINISTIC synthetic (hashed provider + date → stable 30-minute business-hours slots, ~a third pre-booked), clearly labeled synthetic — not a real Salesforce Scheduler / ServiceAppointment write. Governance genuinely enforces the two invariants that matter: it never double-books an already-taken slot and only books within the provider's published availability. It then hands the booked appointment to the Engagement Agent for visit reminders — closing acquisition → intake → routing → booking → engagement."
  },
  {
    name: "Agentforce Referral Management",
    role: "Triage + draft outbound specialist referrals (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' Referrals ('Create Referral') analog, and the full-referral GENERALIZATION of the Care Router's behavioral-health handoff: rather than expressing a single handoff pathway, it triages a patient's intake + Care Router routing signals into referrals across the adjacent specialists menopause commonly touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, and behavioral health — and drafts a referral request per recommendation. Triage is DETERMINISTIC (a pure function of the age/cycle/symptom/severity/red-flag context + risk flags — no randomness, no clock), so the same context always yields the same referral(s), and every recommended referral references a defined specialty-catalog id AND carries a documented reason (never fabricated, never reasonless). The load-bearing honesty property is that it can only DRAFT: an outbound referral requires a clinician's sign-off before it is sent — a referral is a clinical action that needs a human-in-the-loop, and governance genuinely blocks any send-without-cosign (policy.referral.clinician-cosign), alongside the reused rationale-required and HIPAA-audit policies. The specialties + triage rules are ILLUSTRATIVE synthetics, clearly labeled — not a certified clinical referral engine."
  },
  {
    name: "Agentforce Engagement Agent",
    role: "Care continuity (post-routing)",
    tier: "patient-engagement",
    detail:
      "Picks up the Care Router's pathway output and the booked appointment, and schedules the follow-up cadence — visit reminders, symptom check-ins, and adherence nudges — honoring quiet-hours, channel preference, and frequency caps sourced from Data 360, and escalating disengagement or emerging-risk signals back to the router."
  },
  {
    name: "Agentforce Care Gap Closure",
    role: "Proactive preventive care (care gap closure)",
    tier: "care-gap",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud care-gap-closure analog, and the fabric's PROACTIVE agent: rather than reacting to an intake, it grounds on the patient's Data 360 context + age/cycle/symptom signals and DETERMINISTICALLY detects menopause-relevant preventive-care gaps — bone-density/DEXA (osteoporosis risk), lipid panel, screening mammogram, and overdue HRT follow-up — then drafts consent- and quiet-hours-aware outreach for each and hands it to the Engagement Agent for delivery. Detection is a pure function of an explicit as-of date + per-measure history (no randomness, no clock), so the same context always yields the same gaps. The load-bearing property is integrity, not clinical authority: every detected gap references a defined clinical-measure catalog id — never a fabricated one — and governance genuinely blocks any off-catalog gap (policy.caregap.clinical-measure-sourced). The clinical measures + intervals are ILLUSTRATIVE synthetics, clearly labeled — not a certified guideline engine. Outreach reuses the engagement guards: contact consent required, human approval before any send, and quiet-hours + channel preference honored."
  },
  {
    name: "Agentforce Medication Adherence",
    role: "Nudge-only HRT/SSRI refill & adherence (patient engagement)",
    tier: "patient-engagement",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud MedicationRequest + MedicationTherapyReview analog, and a second PROACTIVE patient-care agent alongside Care Gap Closure: it tracks whether a patient is staying on their menopause medications — transdermal/oral HRT (estradiol, oral progesterone) and an SSRI/SNRI for vasomotor symptoms or mood (paroxetine, venlafaxine) — and whether a refill is coming due, then drafts consent- and quiet-hours-aware refill/adherence nudges it hands to the Engagement Agent and flags adherence drop-off to the care team. Detection is DETERMINISTIC (a pure function of an explicit as-of date + each medication's days-supply and last-fill — no randomness, no clock), producing a good / at-risk / lapsed status and a refill-due call. The load-bearing honesty property is that it can only NUDGE: it may draft a refill reminder for human review but must NEVER autonomously submit or order a refill — a refill is a clinical action that requires a human-in-the-loop, and governance genuinely blocks any autonomous refill (policy.medication.no-autonomous-refill), reusing the no-prescribing and engagement outreach guards (contact consent, human approval before send, quiet-hours + channel preference). The medications + refill intervals are ILLUSTRATIVE synthetics, clearly labeled — not a certified pharmacy / e-prescribing system."
  },
  {
    name: "Agentforce Member Service / Billing",
    role: "Billing & coverage self-service (patient service)",
    tier: "patient-facing",
    detail:
      "The Salesforce 'Agentforce for Health' Claims & Coverage / patient-service analog: it answers a member's BILLING & COVERAGE self-service questions — claim status, copay / patient responsibility, outstanding balance, and EOB explanation — grounded on the member's synthetic claim/EOB records, and routes anything out of scope (a clinical, prescription, or scheduling request) to a human member-services specialist with a PII-safe billing context bundle, keeping it scoped to billing/coverage self-service and distinct from the Engagement Agent. Generation is DETERMINISTIC (member/claim keys hashed into realistic billed / allowed / plan-paid / patient-responsibility figures across submitted / adjudicated / paid / denied statuses — no randomness, no clock), so the same member always yields the same claims and the same question always answers identically. The load-bearing honesty property is that every billing/claim answer must trace to a specific claim/EOB record — the agent may not fabricate claim data — and governance genuinely blocks any billing answer that cites no claim (policy.billing.claim-data-sourced), alongside the reused no-free-text-pii and HIPAA-audit policies. The claim/EOB records are ILLUSTRATIVE synthetics, clearly labeled — not a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit."
  },
  {
    name: "Agentforce Prior Authorization",
    role: "Assemble a clinician-gated PA (clinical decision · utilization management)",
    tier: "clinical-decision",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud CareRequest + Utilization Management analog — the HEAVIEST agent on the fabric and, deliberately, the LEAST demo-honest of the set. For a PA-requiring menopause item (systemic HRT / compounded estradiol, a bone-density DEXA scan, or a specialized hormone lab panel) it pulls the (synthetic) clinical context, DETERMINISTICALLY matches the payer's medical-necessity criteria, assembles the required supporting-documentation checklist (present vs missing), and returns a clinician-gated PA package with a synthetic Health Cloud CareRequest / authorization id and a status (draft / ready-for-clinician / submitted). Real prior authorization is a genuinely multi-system workflow — an X12 278 (or FHIR PAS / Da Vinci) EDI exchange against a payer's utilization-management system — so this is a clearly-labeled MOCK, NOT a real 278/EDI or payer PA portal submission, and the payer criteria + document checklists are ILLUSTRATIVE synthetics, not a certified utilization-management engine (Salesforce's own guidance is to do PA last, and we did). TWO load-bearing honesty properties are governance-enforced: it must NOT autonomously submit a PA — a clinician must approve first, so it only ever assembles a clinician-gated draft (requiresClinicianApproval:true, submitted:false) and governance blocks any submit-without-approval (policy.pa.no-autonomous-submission); and a PA submission must include the required supporting documentation — a submission missing a required document is blocked (policy.pa.documentation-integrity). It reuses the no-prescribing, consent-before-grounding, and HIPAA-audit policies."
  },
  {
    name: "Agentforce SDOH Screening",
    role: "Whole-person care · social-needs screening + community referral",
    tier: "whole-person-care",
    detail:
      "The Salesforce 'Agentforce for Health' whole-person-care analog: it screens a patient for health-related social needs / social determinants of health with a validated, public-domain instrument (the CMS Accountable Health Communities HRSN core-domain tool: housing instability, food insecurity, transportation needs, utility needs, interpersonal safety), DETERMINISTICALLY flags the positive social-need domains (real rule-based scoring — the Hunger Vital Sign food screen, the HITS interpersonal-safety cutoff — no LLM), and drafts CONSENT-GATED community-resource referrals (211, food bank, housing/utility assistance, a domestic-violence hotline). Two load-bearing honesty properties are governance-enforced: it may only administer a screener on the validated allow-list (policy.sdoh.validated-screener-only), and it may only draft a community referral with the patient's explicit consent — never an autonomous enrollment (policy.sdoh.consent-before-referral). A positive interpersonal-safety screen is a mandatory escalation to a human social worker (mirroring the Assessment Agent's PHQ-9 item 9 handling). SDOH is SEPARATE from clinical severity — a positive social need raises a care-coordination flag, not an intake severity — so it complements the clinical agents. The community-resource catalog is an ILLUSTRATIVE synthetic, NOT a live directory of real programs."
  },
  {
    name: "Pause MCP Server",
    role: "Data-plane tool surface",
    tier: "data-plane",
    detail:
      "Exposes the MuleSoft Experience APIs as MCP tools so any AI agent (Claude Desktop, Cursor, Agentforce Service Agent) can call get_patient_timeline, get_patient_intake, find_menopause_providers, experience_api_health as native tools."
  },
  {
    name: "MuleSoft Process / Experience APIs",
    role: "Integration plane",
    tier: "integration",
    detail:
      "Three-tier API-Led Connectivity on Anypoint. The single ground-truth substrate every agent reads from and writes to. JupyterHealth + DBDP + wearables stitched into one FHIR R5 plane."
  },
  {
    name: "Pause MCP Bridge",
    role: "A2A ↔ MCP egress (platform)",
    tier: "integration",
    detail:
      "The outbound complement to the Pause MCP Server: a per-request MCP host that lets fabric agents call EXTERNAL MCP tool servers, not just expose Pause's own. The Care Router uses it to resolve providers through find_menopause_providers over an ordered remote list — same-origin loopback first, then allow-listed partners in PAUSE_MCP_HOST_REMOTES — returning the first success and falling back to the direct call if every remote errors, so routing never regresses. An inbound bearer is forwarded only to the same-origin loopback, never cross-origin. Env-gated and off by default."
  },
  {
    name: "Salesforce Data 360 (grounding)",
    role: "Unified patient memory",
    tier: "data-grounding",
    detail:
      "Federates JupyterHealth, the customer's EHR, and the DBDP feature store via a zero-copy Iceberg connector — no bulk PHI is copied into Salesforce. Grounds the Care Router on a consented, unified patient view before every routing decision: grounding calls require an active ai-decision-support consent, and segments activate only to allow-listed downstream channels."
  },
  {
    name: "Agentforce Pipeline Management",
    role: "Commercial plane · B2B pipeline (PHI-separated)",
    tier: "commercial-operations",
    detail:
      "Pause's own go-to-market, not a patient-facing agent. Works the B2B opportunity pipeline for provider-organization, health-system, and employer deals in Sales Cloud — stage progression, deal health, next-best-action — and rolls up committed/best-case/pipeline forecasts where every figure traces back to a CRM record. Runs on the commercial plane only: it cannot read patient PHI, which is also why it's off the HIPAA audit policy."
  },
  {
    name: "Agentforce Account Management",
    role: "Commercial plane · customer success (PHI-separated)",
    tier: "commercial-operations",
    detail:
      "Manages signed provider-org and employer accounts post-close: health scoring, renewal and QBR drafts, churn-risk and expansion signals. Never commits a contract or pricing change without a human account owner. Like pipeline management, it runs strictly on the commercial CRM plane and never touches patient PHI."
  }
];

const protocols = [
  {
    name: "Google Agent-to-Agent Protocol (A2A)",
    role: "Agent ↔ agent handoff",
    detail:
      "Open standard from Google donated to the Linux Foundation, endorsed by Anthropic, Salesforce, MuleSoft, and OpenAI. AgentCard discovery at /.well-known/agent.json, Task lifecycle, JSON-RPC over HTTP, optional SSE streaming. Pause's Agentforce → Care Router handoff is A2A end-to-end."
  },
  {
    name: "Model Context Protocol (MCP)",
    role: "Agent ↔ tool surface",
    detail:
      "Open standard from Anthropic now in cross-vendor adoption. Pause's MCP server (mcp/) exposes the four Experience-tier capabilities as MCP tools. The same surface is registered in Claude Desktop, Cursor, and the production Agentforce gateway."
  },
  {
    name: "FHIR R5 + Open mHealth",
    role: "Data substrate",
    detail:
      "The clinical data crossing every agent boundary. MuleSoft Process APIs transform Open mHealth wearable payloads into FHIR R5 Observations via DataWeave; the MCP tools return FHIR Bundles; the A2A messages carry FHIR-shaped data parts."
  }
];

const fabricCapabilities = [
  {
    title: "Agent registry",
    detail:
      "Every Pause agent self-registers on the fabric with its protocol (A2A / MCP / REST), endpoint, version, capabilities, governance tier, and the policies it operates under. The console at /demo/agent-fabric shows the live registry."
  },
  {
    title: "Policy enforcement",
    detail:
      "The policy catalog spans: model allow-list (Claude Sonnet / Opus only), no autonomous prescribing, mandatory red-flag screen, mandatory rationale, deterministic fallback on API failure, a validated-instrument allow-list on the Assessment Agent (only MRS / Greene / PHQ-9 / ISI may be administered and scored into an intake severity), an eligibility-source-integrity block on the Benefits & Coverage Verification agent (every returned coverage result must trace to a payer/clearinghouse EBV response — the agent may not fabricate coverage without a source), two scheduling blocks on the Appointment Scheduling agent (no double-booking an already-taken slot, and book only within the provider's published availability), a clinical-measure-sourced block on the Care Gap Closure agent (every preventive-care gap acted on must derive from a defined clinical measure — the agent may not act on a fabricated / off-catalog gap), a no-autonomous-refill block on the Medication Adherence agent (it may draft a refill/adherence nudge but may never autonomously submit or order a refill — a refill without human approval is blocked), a clinician-cosign block on the Referral Management agent (it may triage and draft an outbound specialist referral but may never send it without a clinician's sign-off — a send-without-cosign is blocked), a claim-data-sourced block on the Member Service / Billing agent (every billing/claim answer must trace to a synthetic claim/EOB record — the agent may not fabricate claim data), two prior-authorization blocks on the Prior Authorization agent (it may assemble a clinician-gated PA draft but may never autonomously submit a PA — a clinician must approve before submission — and a PA submission must include the required supporting documentation — an incomplete submission is blocked), a template-sourced block on the Care Plan agent (every instantiated care plan must derive from a defined template — the agent may not fabricate a plan) plus the model allow-list on that agent's live-Claude progress summary, MCP tool allow-list (plus the MCP Bridge's egress guards — a remote allow-list, an egress-side tool allow-list, and a no-cross-origin-bearer rule so an inbound token never leaks to an external MCP server), FHIR-R5-only substrate, mTLS for system-to-system, HIPAA audit log on every turn, plus the patient-lifecycle guards on the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement agents (inbound opt-in + source required and identity-resolution-before-create, contact-consent required, human approval before any message is sent, a lead-nurture cadence cap that suppresses on conversion/opt-out, a qualification rubric that requires rationale on every decision and forbids protected-class criteria with reviewable disqualifications, quiet-hours + channel preference, and an engagement frequency cap) — plus the commercial-plane guards on Pipeline Management and Account Management (a hard PHI-separation block so commercial agents never read patient data, forecast-figures-must-trace-to-CRM, and human-owner-before-any-contract-change). Block / audit / rate-limit / redact enforcement modes."
  },
  {
    title: "End-to-end trace observability",
    detail:
      "Every A2A handoff and MCP tool call is recorded as a span with parent/child correlation. A patient intake span becomes the parent of the Care Router span, which becomes the parent of the MCP timeline span. The full multi-agent trace is visible in one place."
  },
  {
    title: "Identity-based security",
    detail:
      "Production deployments wire agent-to-agent calls through the customer's OAuth / mTLS provider via MuleSoft. Bearer tokens are issued per agent identity and validated at the Anypoint gateway before any tool call reaches the MCP server or the Care Router."
  }
];

const protoVsProd = [
  {
    aspect: "Care Router model",
    proto:
      "Anthropic Claude Sonnet 4.5 via @anthropic-ai/sdk when ANTHROPIC_API_KEY is set; deterministic Pause policy engine otherwise.",
    prod:
      "Same SDK path, with the model selected from the customer's approved allow-list. Bring-your-own-cloud Anthropic on Bedrock / Vertex supported via env var."
  },
  {
    aspect: "A2A transport",
    proto:
      "JSON-RPC over HTTP (Next.js API route). No auth between agents; Agent Fabric records the trace.",
    prod:
      "JSON-RPC over HTTPS with mTLS or OAuth, brokered by the Anypoint API gateway. Identity claims propagate into the trace."
  },
  {
    aspect: "Agent Fabric runtime",
    proto:
      "In-memory mock (frontend/lib/agent-fabric.ts) shared across Next.js API routes. Console at /demo/agent-fabric.",
    prod:
      "MuleSoft Agent Fabric on Anypoint. Policies authored in the Agent Fabric console; trace export to Datadog / Splunk / OTel."
  },
  {
    aspect: "Policy authoring",
    proto:
      "Static catalog in frontend/lib/agent-fabric.ts. Read-only in the UI.",
    prod:
      "Authored by the customer's platform team in the Agent Fabric console, version-controlled, promoted across dev / staging / prod."
  },
  {
    aspect: "Trace store",
    proto:
      "200-span ring buffer in-process. Survives dev-mode hot reload.",
    prod:
      "Customer's observability stack (Datadog, Splunk, OpenTelemetry). MuleSoft trace shipper exports spans with HIPAA-compliant correlation IDs."
  }
];

const phases = [
  {
    name: "Phase 0 — Multi-agent prototype",
    duration: "Today",
    detail:
      "Twenty-three agents registered on the mocked Agent Fabric across three planes — the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement lifecycle agents bracketing Agentforce intake, the Assessment Agent that scores validated instruments into an intake severity, the Benefits & Coverage Verification (EBV) agent that runs a synthetic eligibility check before routing, the Care Router, the Care Plan agent that instantiates a template-sourced menopause care plan and summarizes progress with live Claude (the second live-Claude agent), the Appointment Scheduling agent that books the recommended MSCP visit and hands it to engagement, the Referral Management agent that triages intake + routing signals into cosign-gated outbound specialist referrals (generalizing the Care Router's behavioral-health handoff), the Member Service / Billing agent that answers claim-sourced billing & coverage self-service questions and routes out-of-scope requests to a human, the Prior Authorization agent (the heaviest, deliberately-last workflow) that assembles a clinician-gated, documentation-complete PA and never autonomously submits it, the Care Gap Closure agent that proactively detects Data-360-grounded, clinical-measure-sourced preventive-care gaps and drafts consent-aware outreach for engagement, the Medication Adherence agent that proactively tracks HRT/SSRI adherence + refill timing and drafts nudge-only refill reminders (never an autonomous refill) for engagement, and the Clinical Summary agent that composes the outputs the other agents already produced into a patient-friendly after-visit summary and a clinician handoff with live Claude (the third live-Claude agent), grounding every summary in the source records the context was assembled from so it can never fabricate a clinical fact, and the SDOH Screening agent (whole-person care) that screens a patient for health-related social needs with the validated CMS AHC-HRSN core-domain tool, escalates the interpersonal-safety red flag to a human social worker, and drafts consent-gated community-resource referrals that are never an autonomous enrollment — on the patient/clinical plane; the Pause MCP server, the MCP Bridge (A2A ↔ MCP egress), the MuleSoft integration plane, and Data 360 grounding on the platform substrate; and the PHI-separated commercial-plane Pipeline Management and Account Management agents. End-to-end A2A handoff Agentforce → Care Router. MCP tool surface. /demo/agent-fabric console for monitoring. Live in this repo."
  },
  {
    name: "Phase 1 — Real Claude routing",
    duration: "1 week",
    detail:
      "Wire ANTHROPIC_API_KEY in Vercel (or BYO Bedrock / Vertex). Tune the system prompt with menopause clinicians. Hold the deterministic fallback in place as the safety net."
  },
  {
    name: "Phase 2 — First Agent Fabric customer",
    duration: "4–6 weeks with customer",
    detail:
      "Deploy the Care Router and MCP server behind the customer's MuleSoft Anypoint platform. Register the Agentforce Service Agent. Author the customer's policy set in the Agent Fabric console. Wire OAuth / mTLS."
  },
  {
    name: "Phase 3 — Multi-tenant fabric",
    duration: "Ongoing",
    detail:
      "Pause ships one set of agents and policies; each customer's Agent Fabric overrides what they need. Telemetry rolled up cross-customer for product analytics and clinical evaluation."
  }
];

const investorTakeaways = [
  {
    label: "Multi-agent is the right unit of analysis",
    detail:
      "Pause is not 'an AI chatbot.' It is a patient-facing agent, a clinical-decision agent, a data-plane agent, and an integration plane — wired through open protocols and governed by a single control plane. The architecture matches how buyers actually operate AI in healthcare."
  },
  {
    label: "Composable on open standards",
    detail:
      "Google A2A + Anthropic MCP + FHIR R5 + Open mHealth + DBDP + MuleSoft API-Led Connectivity. Every protocol is industry-endorsed, multi-vendor, and independently auditable. There is no Pause-proprietary glue at any tier."
  },
  {
    label: "Governance is built in, not bolted on",
    detail:
      "Every agent declares its policies. Every A2A and MCP call is traced. Every decision carries provenance (which model, which path, what red-flags). This is the posture a hospital compliance officer will sign off on — not a per-agent retrofit."
  },
  {
    label: "Same architecture, two product motions",
    detail:
      "B2C: patients hit Agentforce, get routed by Claude, see the right pathway. B2B: health systems install our agents on their own Anypoint + Agent Fabric and govern them. One stack, two go-to-market wedges."
  }
];

export default function AgentFabricInvestorPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Multi-agent control plane"
      title="Twenty-three agents across three planes, two open protocols, one governed control plane"
      subtitle="Pause-Health.ai composes Agentforce (inbound lead generation, prospecting & nurture, qualification, intake, validated-instrument assessment, benefits & coverage verification, appointment scheduling, cosign-gated specialist referral management, engagement, proactive care-gap closure, nudge-only medication adherence, after-visit clinical summary, and consent-gated SDOH / social-needs screening, plus a PHI-separated commercial plane for pipeline & account management), Anthropic Claude (clinical routing, template-sourced care planning with a live-Claude progress summary, and a live-Claude after-visit summary + clinician handoff), the Pause MCP server (data-plane tools), MuleSoft (integration plane), and Data 360 (grounding) into a single multi-agent system — orchestrated, monitored, secured, and governed by a MuleSoft Agent Fabric control plane."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The agents on the fabric</p>
        <p style={{ marginTop: "0.4rem", color: "var(--muted)" }}>
          Grouped by plane. The patient/clinical and commercial planes are the
          PHI boundary — the platform plane is the shared data + integration
          substrate that serves the patient plane.
        </p>
        {PLANES_IN_ORDER.filter((plane) =>
          agents.some((a) => planeForTier(a.tier) === plane)
        ).map((plane) => {
          const meta = GOVERNANCE_PLANES[plane];
          const planeAgents = agents.filter(
            (a) => planeForTier(a.tier) === plane
          );
          return (
            <div key={plane} style={{ marginTop: "1.25rem" }}>
              <h3 style={{ margin: "0 0 0.15rem" }}>
                {meta.label}{" "}
                <span
                  style={{
                    color: "var(--muted)",
                    fontWeight: 500,
                    fontSize: "0.85rem"
                  }}
                >
                  · {planeAgents.length} agents
                </span>
              </h3>
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "0.9rem",
                  margin: "0 0 0.7rem",
                  maxWidth: "74ch"
                }}
              >
                {meta.description}
              </p>
              <div className="card-grid">
                {planeAgents.map((a) => (
                  <article key={a.name} className="card">
                    <h3>{a.name}</h3>
                    <p
                      style={{
                        color: "var(--brand)",
                        fontWeight: 600,
                        marginBottom: "0.4rem"
                      }}
                    >
                      {a.role} · {tierLabel(a.tier)}
                    </p>
                    <p>{a.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Protocols on the wire</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {protocols.map((p) => (
            <article key={p.name} className="card">
              <h3>{p.name}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  marginBottom: "0.4rem"
                }}
              >
                {p.role}
              </p>
              <p>{p.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">What the Agent Fabric does</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {fabricCapabilities.map((c) => (
            <article key={c.title} className="card">
              <h3>{c.title}</h3>
              <p>{c.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <p style={{ marginTop: "0.4rem" }}>
          The clickable prototype runs the full multi-agent flow end-to-end.
          Complete an intake on <a href="/demo/intake">/demo/intake</a> — the
          Agentforce-style intake hands off to the Anthropic Care Router over
          Google A2A, the Care Router calls the Pause MCP server for patient
          context, and every span is recorded in the Agent Fabric console.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a href="/demo/agent-fabric" className="btn btn-primary">
            Open Agent Fabric console
          </a>
          <a href="/demo/intake" className="btn btn-secondary">
            Run an intake → A2A handoff
          </a>
          <a
            href="/api/agents/care-router/.well-known/agent.json"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Care Router Agent Card
          </a>
          <a
            href="/api/agent-fabric/agents"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Agent registry JSON
          </a>
          <a
            href="/api/agent-fabric/policies"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Policy catalog JSON
          </a>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Aspect</th>
                <th>Prototype today</th>
                <th>Customer deployment</th>
              </tr>
            </thead>
            <tbody>
              {protoVsProd.map((row) => (
                <tr key={row.aspect}>
                  <td>
                    <strong>{row.aspect}</strong>
                  </td>
                  <td>{row.proto}</td>
                  <td>{row.prod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased plan</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {phases.map((phase) => (
            <article key={phase.name} className="card">
              <h3>{phase.name}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  marginBottom: "0.5rem"
                }}
              >
                {phase.duration}
              </p>
              <p>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why investors should care</p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {investorTakeaways.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <strong style={{ fontWeight: 500 }}>{item.detail}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/agentforce">Agentforce intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The front-door agent that captures and hands off the structured
              intake.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The connectivity plane the Agent Fabric sits on top of.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mcp">MCP server</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The data-plane tool surface every agent calls.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data-360">Data 360 grounding</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The unified patient memory layer Pause grounds the Care Router on
              before every routing decision.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://google-a2a.github.io/A2A/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google A2A specification
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The open agent-to-agent protocol Pause speaks.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://www.salesforce.com/products/mulesoft/agent-fabric/"
                target="_blank"
                rel="noopener noreferrer"
              >
                MuleSoft Agent Fabric
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Salesforce control plane Pause's deployment composes with.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
