import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";
import {
  GOVERNANCE_PLANES,
  PLANES_IN_ORDER,
  planeForTier,
  tierLabel
} from "../../../lib/governance-tiers";
import { agentCards, AGENT_CARD_COUNT_WORD } from "./agent-cards";

export const metadata = pageMetadata({
  title: "Investor Brief · Multi-Agent Control Plane",
  description:
    "Pause-Health.ai's multi-agent architecture — Agentforce inbound lead generation, prospecting & nurture, qualification, intake, appointment scheduling, cosign-gated specialist referral management, claim-sourced member service / billing, clinician-gated prior authorization, engagement, proactive care-gap closure, and nudge-only medication adherence, the Anthropic Claude Care Router, the Pause MCP server, the MuleSoft integration plane, and a PHI-separated commercial plane (pipeline + account management) — orchestrated, monitored, and governed by a MuleSoft Agent Fabric control plane.",
  path: "/proposal/agent-fabric",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause multi-agent control plane — investor brief."
});

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
      `${AGENT_CARD_COUNT_WORD} agents registered on the mocked Agent Fabric across three planes — the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement lifecycle agents bracketing Agentforce intake, the Assessment Agent that scores validated instruments into an intake severity, the Benefits & Coverage Verification (EBV) agent that runs a synthetic eligibility check before routing, the Care Router, the Care Plan agent that instantiates a template-sourced menopause care plan and summarizes progress with live Claude (the second live-Claude agent), the Appointment Scheduling agent that books the recommended MSCP visit and hands it to engagement, the Referral Management agent that triages intake + routing signals into cosign-gated outbound specialist referrals (generalizing the Care Router's behavioral-health handoff), the Member Service / Billing agent that answers claim-sourced billing & coverage self-service questions and routes out-of-scope requests to a human, the Prior Authorization agent (the heaviest, deliberately-last workflow) that assembles a clinician-gated, documentation-complete PA and never autonomously submits it, the Care Gap Closure agent that proactively detects Data-360-grounded, clinical-measure-sourced preventive-care gaps and drafts consent-aware outreach for engagement, the Medication Adherence agent that proactively tracks HRT/SSRI adherence + refill timing and drafts nudge-only refill reminders (never an autonomous refill) for engagement, and the Clinical Summary agent that composes the outputs the other agents already produced into a patient-friendly after-visit summary and a clinician handoff with live Claude (the third live-Claude agent), grounding every summary in the source records the context was assembled from so it can never fabricate a clinical fact, the SDOH Screening agent (whole-person care) that screens a patient for health-related social needs with the validated CMS AHC-HRSN core-domain tool, escalates the interpersonal-safety red flag to a human social worker, and drafts consent-gated community-resource referrals that are never an autonomous enrollment, the Patient Education & Health Coaching agent that turns the intake, care-plan, and care-gap signals into a deterministically-selected, evidence-sourced menopause/midlife education curriculum and coaches the patient with live Claude (the fourth live-Claude agent), staying strictly within general education with consent-gated outreach, the Remote Patient Monitoring & Symptom-Trend Tracking agent that ingests longitudinal symptom/vital readings, deterministically detects per-metric trends against a synthetic monitored-metrics catalog, and routes worsening or red-flag trends to a clinician for review without ever taking an autonomous clinical action, and the Population Health & Risk Stratification agent that reasons over a whole patient panel at once, deterministically stratifies each patient into a low/rising/high risk tier with a transparent, additive risk model that scores on no protected-class attribute, and builds a prioritized outreach worklist for a human care manager without ever making an autonomous care decision, the Clinical Trials & Research Matching agent that deterministically matches a single patient against a synthetic study catalog using structured eligibility criteria, ranks the matching studies with per-criterion explanations tracing to defined criteria, and drafts a research-consent-gated outreach that never auto-enrolls (informed consent + a human required), and the Language Access & Health Equity agent that determines a limited-English-proficiency patient's preferred language, deterministically decides whether a qualified medical interpreter is needed and of which modality, checks approved in-language materials, and flags equity gaps — using a qualified medical interpreter only (never a family / ad-hoc / machine interpreter), never machine-translating clinical consent, and escalating to a human coordinator when no qualified interpreter is available, the HEDIS & Quality Reporting agent that deterministically rolls up a whole panel against a defined HEDIS measure catalog into per-measure numerator / denominator / catalog-sourced exclusions / compliance rate for value-based-care contracts, and assembles a submission package that ALWAYS requires human quality-team approval (never autonomously filed to a payer / CMS / quality registry, and never inflated by an ad-hoc / unlisted denominator exclusion), the Advance Care Planning agent that uses perimenopause / menopause as a midlife touchpoint to surface which advance directives are on file (living will, DPOA-HC; POLST only for serious-illness patients), flags missing / stale / language-access gaps, and drafts a consent-gated conversation prompt for the care team — every directive on file traces to the catalog + an approved source, every directive change is clinician + patient sign-off gated (never autonomously applied), and for a limited-English-proficiency patient with no interpreter plan the active prompt is withheld until the Language Access agent has arranged a qualified interpreter (a safe answer, not a block), the Care Team & Case Management agent that assembles the multi-disciplinary team around a single high-need patient (PCP, MSCP, cardiology, endocrinology, bone-health, pelvic-floor PT, behavioral health), assigns a case manager by a stable-hash pick from a synthetic pool, and emits a shared team snapshot — every role traces to the catalog, every roster change requires case-manager sign-off (never autonomously applied), and a legitimate team must include a PCP anchor, the Discharge & Transitions of Care agent that closes the loop back to primary care after a hospitalization / ED visit — deterministically reconciling the discharge medication list (added / removed / dose-changed, each tracing to an approved medication source and every change clinician-signoff gated), booking (or handing off to Scheduling for) the follow-up appointment as a real slot (never a text recommendation — the load-bearing 30-day-readmission guard), pulling encounter-reason red-flag warning signs, emitting the teach-back checklist, and assembling the PCP handoff summary, the Grievance & Appeals agent that runs the intake half of the regulated grievance-and-appeals process — deterministically classifying a member complaint or coverage-denial appeal, routing to the correct human queue (member-services / clinical-review / compliance), stamping a catalog-sourced regulatory deadline (never silently extended past the maximum), and handing the receiving queue a PHI-safe routing summary (structured only, never free-text PHI) — the agent never resolves a case on its own, the Quality-Measure Attribution agent that pairs with the HEDIS agent to decide whose panel each patient counts on — deterministically attributing each patient to a provider / clinic / VBC contract under a catalog-sourced methodology (plurality-of-visits, PCP-of-record, prospective Medicare Advantage, contract-defined window), honoring the contract's exclusion terms so an excluded patient doesn't pollute the scorecard, applying a documented tie-break chain (most-recent-visit-wins → provider-ref-lexical-ascending) instead of a gameable coin-flip, and rolling up per-provider counts so downstream HEDIS scoring lands on the correct denominator, the Complex Care Management agent that runs the reimbursable time-tracking piece of a Medicare CCM program — deterministically confirming eligibility (2+ catalog-sourced chronic conditions, Medicare-eligible age, coverage flag, consent), tracking per-activity minutes against the CCM activity catalog, mapping the total to the CPT ladder (99490 → 99491 → 99487 → 99489), and assembling a billing package for human quality-team review (never autonomously submitted to CMS, never inflated by phantom minutes), the Claims Adjudication Assistant that runs the first-pass payer-side pipeline — deterministically applying catalog edits (NCCI-PTP, LCD/NCD, benefit limits, prior-auth linkage, duplicates, network, timely-filing), classifying each claim as clean-pay / pend / deny-drafted with a specific catalog reason code, and routing non-clean items to a human (never autonomously finalizing a denial — every denial letter needs an adjudicator cosign, a Section 1557 / state code requirement), the Formulary & Drug Utilization Review agent that runs the first-pass DUR pipeline — deterministically checking tier, step-therapy (honored with documented prior-therapy), quantity limits, and drug-drug interactions, classifying as preferred-approved / pend with a catalog reason code, and routing non-preferred decisions to a clinician cosign (never an autonomous formulary exception override, mirroring the same-shape audit surface as claims adjudication), the Fraud, Waste & Abuse Detection agent that screens claims / prior-auths against catalog patterns (unbundling, upcoding, duplicate billing, quantity outliers, impossible-day billing, phantom services), classifies severity, and routes to the SIU for HUMAN review — never autonomously denies a claim, opens an investigation, or freezes payment, and never scores on protected-class attributes (a documented compliance failure in real payer FWA systems), the Clinical Trial Payments & Stipends agent that pairs with Clinical Trials Matching to handle the reimbursable payments side — deterministically computing per-visit stipend + travel reimbursement against IRB-approved schedules, verifying research-payment consent (45 CFR 46), and routing non-standard payments (missed visit, out-of-range travel, extra procedure) to the study coordinator for cosign (never autonomously deviates from an IRB schedule), the Utilization Review agent (MCG/InterQual analog) that runs the pre-service medical-necessity screen against catalog criteria sets for proposed procedures / inpatient admissions, classifies as approves-meets-criteria / pend-for-clinical-review / require-peer-to-peer / blocked-non-covered with a specific reason code, routes non-approved cases to a clinical reviewer or peer-to-peer with a catalog-sourced SLA deadline (standard 72h / urgent 24h / concurrent-review 24h), and never autonomously denies (every non-approved decision requires clinician cosign — a Medicare Advantage / state UR-agent due-process requirement, mirroring the Claims Adjudication Agent's no-autonomous-denial and the Formulary Agent's no-autonomous-override), the Care Coordination Handoff agent (Joint-Commission-NPSG-2 SBAR) that handles any cross-setting patient transition (hospital → SNF, SNF → home, home → hospice, ED → PCP, PCP → specialist, PCP → behavioral health) — deterministically assembling the SBAR (situation, background, assessment, recommendation), verifying the receiving clinician's credentialing status against the Provider Credentialing directory, and confirming transfer consent for transitions that share PHI with a new setting; classifies as handoff-accepted / pend-sbar-incomplete / blocked-clinician-not-credentialed / blocked-no-consent, never routes to an expired / sanctioned clinician (mirroring the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture), and NEVER autonomously accepts on behalf of the receiving clinician (distinct from Transitions of Care, which is post-discharge hospital→home only and owns the medication reconciliation), the Adverse Event Reporting agent (FDA MedWatch / VAERS analog) that runs the pharmacovigilance / device-safety reporting pipeline — deterministically classifying each drug ADR, vaccine reaction, device malfunction, medication error, or therapeutic failure into the MedWatch (3500 / 3500A) or VAERS channel, computing the 21-CFR-314.80 seriousness tier (non-serious / serious / life-threatening / death) from caller-provided outcome flags, verifying reporter identity attestation, and drafting for regulatory-team cosign — NEVER autonomously files to the FDA (21 CFR 314.80 mandatory reporting has sponsor / manufacturer / clinician liability, mirroring the Claims Adjudication Agent's no-autonomous-denial and the HEDIS Agent's no-autonomous-submission posture) and NEVER drafts on an unverified reporter (FDA reporting requires an attested reporter), and the Data-Sharing / TEFCA Interoperability agent that classifies each cross-organization PHI exchange over TEFCA QHIN / Carequality / CommonWell / Direct Secure Messaging by exchange purpose (treatment / payment / operations / patient-request / public-health / research), verifies the counterparty is a Trusted Exchange Framework participant, applies the patient's data-sharing consent scopes from the Consent agent, and classifies as release-authorized / pend-purpose-verification / blocked-non-catalog-purpose / blocked-participant-unverified / blocked-consent-required-non-tpo — NEVER autonomously releases PHI for a non-TPO purpose without consent (HIPAA §164.506 boundary — TPO doesn't need consent, everything else does, mirroring the Consent & Preferences Management Agent's no-scope-override posture) and NEVER releases to an unverified counterparty (45 CFR 171 / TEFCA Common Agreement, mirroring the Provider Credentialing Agent's source-integrity posture), and the Risk Adjustment & HCC Coding agent that reviews a single patient's clinical context and deterministically identifies suspected / confirmed HCCs for value-based-care risk adjustment (each mapped to the documented clinical evidence that supports it), computes a RAF-style risk score from the confirmed set, and flags coding gaps (evidence documented but uncoded) + unsupported / over-coded entries (coded but not documented) — a clinical-documentation-integrity agent that complements, not duplicates, the HEDIS and Quality-Measure Attribution agents (those score quality MEASURES; this is risk-adjustment CONDITION coding) — where every confirmed / suspected HCC must trace to documented clinical evidence (a fabricated / unsupported code presented as supported is blocked as upcoding, policy.riskadj.evidence-supported-coding, while a coding gap / unsupported flag is a SAFE, honest output surfaced for a clinician), every suspected code is a recommendation requiring clinician validation (policy.riskadj.clinician-validation-required), and the agent NEVER autonomously submits codes or adjusts a claim / RAF for reimbursement (policy.riskadj.no-autonomous-submission, mirroring the Prior Authorization Agent's clinician-approval + no-autonomous-submission posture) — on the patient/clinical plane; the Pause MCP server, the MCP Bridge (A2A ↔ MCP egress), the MuleSoft integration plane, Data 360 grounding, the Provider Credentialing & Directory agent that gates every referral / scheduling attempt at the network boundary (verifying credentials against approved sources, blocking referrals to expired / incomplete / sanctioned providers, and refusing to return stale directory records past the No-Surprises-Act 90-day accuracy window as authoritative — the ghost-network fix), and the Consent & Preferences Management agent (the authoritative consent ledger + communication-preference store the other agents' consent-before-outreach / consent-before-referral / consent-to-monitor gates defer to, deterministically deciding whether a patient may be contacted for a scope over a channel at a time while honoring revocations/expiries immediately and never overriding a scope) and the Master Patient Index / Identity Resolution agent (the identity/dedup layer of the data substrate that deterministically scores an incoming patient record against candidate records with a transparent weighted demographic feature set, classifies each as match / possible-match / no-match by fixed thresholds, and recommends link / merge / manual-review / no-action — where every match traces to the defined feature spec, no protected-class attribute is ever used as a matching feature, and a merge below the auto-match threshold is never performed autonomously but requires a human steward) and the Break-the-Glass / Emergency Access Governance agent (the emergency-access governance layer of the data substrate that deterministically decides whether to grant emergency 'break-the-glass' override access to PHI and, if so, returns a time-boxed, minimum-necessary grant — a scoped field set, never the full chart, plus a derived expiry — always emitting a mandatory audit event and flagging the grant for post-access review, where no access is granted without a recorded clinical justification (policy.btg.justification-required), every grant is minimum-necessary + time-boxed and never standing / full-record (policy.btg.minimum-necessary-time-boxed), and every access is logged for mandatory post-access review (policy.btg.mandatory-audit-review) — a deny is a safe answer, not a block) and the Data Retention & Records Lifecycle Management agent (the records-disposition layer of the data substrate that deterministically manages the lifecycle of records against retention schedules and legal holds, producing a disposition recommendation — retain / eligible-for-purge / hold — that cites the governing retention rule and the computed retention expiry, where a legal hold always overrides a purge so a held record is never marked eligible-for-purge (policy.retention.legal-hold-overrides-purge), every disposition cites a recorded retention schedule (policy.retention.schedule-sourced), and a destructive purge is never executed autonomously — an eligible-for-purge is a recommendation requiring human approval, not a deletion and not a block (policy.retention.no-autonomous-purge)) on the platform substrate; and the PHI-separated commercial-plane Pipeline Management, Account Management, and Provider Contracting & VBC Terms agents (the last a DETERMINISTIC provider-contracting engine that classifies provider-network contracts against a catalog of payment models (FFS, capitation, shared-savings, bundled-payment, MA-VBC, commercial-VBC), computes the quality-gate + spend-benchmark drift for a reporting period against a catalog methodology, and drafts term-change proposals that a human account owner must sign off on — never autonomously commits a contract-term change, mirroring the Claims Adjudication Agent's no-autonomous-denial and the UR Agent's no-autonomous-denial posture, and never accesses PHI as it lives on the commercial plane). End-to-end A2A handoff Agentforce → Care Router. MCP tool surface. /demo/agent-fabric console for monitoring. Live in this repo.`
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
      title={`${AGENT_CARD_COUNT_WORD} agents across three planes, two open protocols, one governed control plane`}
      subtitle="Pause-Health.ai composes Agentforce (inbound lead generation, prospecting & nurture, qualification, intake, validated-instrument assessment, benefits & coverage verification, appointment scheduling, cosign-gated specialist referral management, engagement, proactive care-gap closure, nudge-only medication adherence, after-visit clinical summary, consent-gated SDOH / social-needs screening, and evidence-sourced patient education & health coaching, plus a PHI-separated commercial plane for pipeline & account management), Anthropic Claude (clinical routing, template-sourced care planning with a live-Claude progress summary, a live-Claude after-visit summary + clinician handoff, and live-Claude patient education coaching), the Pause MCP server (data-plane tools), MuleSoft (integration plane), and Data 360 (grounding) into a single multi-agent system — orchestrated, monitored, secured, and governed by a MuleSoft Agent Fabric control plane."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The agents on the fabric</p>
        <p style={{ marginTop: "0.4rem", color: "var(--muted)" }}>
          Grouped by plane. The patient/clinical and commercial planes are the
          PHI boundary — the platform plane is the shared data + integration
          substrate that serves the patient plane.
        </p>
        {PLANES_IN_ORDER.filter((plane) =>
          agentCards.some((a) => planeForTier(a.tier) === plane)
        ).map((plane) => {
          const meta = GOVERNANCE_PLANES[plane];
          const planeAgents = agentCards.filter(
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
