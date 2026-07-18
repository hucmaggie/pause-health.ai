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
    "Pause-Health.ai's multi-agent architecture — Agentforce inbound lead generation, prospecting & nurture, qualification, intake, and engagement, the Anthropic Claude Care Router, the Pause MCP server, the MuleSoft integration plane, and a PHI-separated commercial plane (pipeline + account management) — orchestrated, monitored, and governed by a MuleSoft Agent Fabric control plane.",
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
    name: "Agentforce Engagement Agent",
    role: "Care continuity (post-routing)",
    tier: "patient-engagement",
    detail:
      "Picks up the Care Router's pathway output and schedules the follow-up cadence — symptom check-ins and adherence nudges — honoring quiet-hours, channel preference, and frequency caps sourced from Data 360, and escalating disengagement or emerging-risk signals back to the router."
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
      "The policy catalog spans: model allow-list (Claude Sonnet / Opus only), no autonomous prescribing, mandatory red-flag screen, mandatory rationale, deterministic fallback on API failure, a validated-instrument allow-list on the Assessment Agent (only MRS / Greene / PHQ-9 / ISI may be administered and scored into an intake severity), an eligibility-source-integrity block on the Benefits & Coverage Verification agent (every returned coverage result must trace to a payer/clearinghouse EBV response — the agent may not fabricate coverage without a source), MCP tool allow-list (plus the MCP Bridge's egress guards — a remote allow-list, an egress-side tool allow-list, and a no-cross-origin-bearer rule so an inbound token never leaks to an external MCP server), FHIR-R5-only substrate, mTLS for system-to-system, HIPAA audit log on every turn, plus the patient-lifecycle guards on the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement agents (inbound opt-in + source required and identity-resolution-before-create, contact-consent required, human approval before any message is sent, a lead-nurture cadence cap that suppresses on conversion/opt-out, a qualification rubric that requires rationale on every decision and forbids protected-class criteria with reviewable disqualifications, quiet-hours + channel preference, and an engagement frequency cap) — plus the commercial-plane guards on Pipeline Management and Account Management (a hard PHI-separation block so commercial agents never read patient data, forecast-figures-must-trace-to-CRM, and human-owner-before-any-contract-change). Block / audit / rate-limit / redact enforcement modes."
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
      "Fourteen agents registered on the mocked Agent Fabric across three planes — the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement lifecycle agents bracketing Agentforce intake, the Assessment Agent that scores validated instruments into an intake severity, the Benefits & Coverage Verification (EBV) agent that runs a synthetic eligibility check before routing, and the Care Router on the patient/clinical plane; the Pause MCP server, the MCP Bridge (A2A ↔ MCP egress), the MuleSoft integration plane, and Data 360 grounding on the platform substrate; and the PHI-separated commercial-plane Pipeline Management and Account Management agents. End-to-end A2A handoff Agentforce → Care Router. MCP tool surface. /demo/agent-fabric console for monitoring. Live in this repo."
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
      title="Fourteen agents across three planes, two open protocols, one governed control plane"
      subtitle="Pause-Health.ai composes Agentforce (inbound lead generation, prospecting & nurture, qualification, intake, validated-instrument assessment, benefits & coverage verification, and engagement, plus a PHI-separated commercial plane for pipeline & account management), Anthropic Claude (clinical routing), the Pause MCP server (data-plane tools), MuleSoft (integration plane), and Data 360 (grounding) into a single multi-agent system — orchestrated, monitored, secured, and governed by a MuleSoft Agent Fabric control plane."
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
