import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Technology Choices",
  description:
    "Technical architecture, AI approach, evaluation framework, and safety stance powering Pause-Health.ai. Each stack layer is tagged with current status so plan-vs-reality is legible at a glance, and each cross-links to the architecture brief that owns it.",
  path: "/proposal/technology",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Technology choices — Pause-Health.ai investor brief."
});

/**
 * Stack reconciliation note (June 2026):
 *
 * The earlier version of this page predated the architecture briefs
 * (/proposal/agent-fabric, /proposal/data-360, /proposal/mulesoft,
 * /proposal/mcp) and made stack claims that contradict what those
 * briefs (and the live prototype) actually show:
 *
 *   - "OMOP CDM alignment" — the substrate is FHIR R5 via
 *     JupyterHealth + Salesforce Health Cloud; OMOP is not used.
 *   - "LangGraph-style stateful agents" — the live Care Router is
 *     Anthropic Claude Sonnet 4.5 via @anthropic-ai/sdk with a
 *     deterministic policy fallback. LangGraph is not in the stack.
 *   - "Snowflake / Databricks (per-customer choice), dbt for
 *     transforms" — the read plane is Salesforce Data 360 with
 *     zero-copy federation to JupyterHealth FHIR + DBDP. Snowflake
 *     and Databricks are upstream warehouse targets Data 360 can
 *     federate against, not Pause's own platform.
 *   - "Fine-tuned classifiers for symptom-cluster scoring" — none
 *     exist; the current scoring is the policy engine.
 *
 * The rebuild below reconciles each layer with the architecture
 * briefs and tags status so an investor can see what's shipped vs
 * what's still ahead.
 */

/**
 * Tech-page status keys are a strict subset of the canonical
 * StatusPill vocabulary in components/status-pill.tsx. Kept as a
 * type alias so the table data refuses unsupported statuses at
 * compile time.
 */
type Status = "shipped" | "prototype" | "designed" | "future";

// statusLabels removed; the canonical labels live inside
// components/status-pill.tsx (STATUS_PILL_LABEL).

const stack: Array<{
  layer: string;
  choices: string;
  rationale: string;
  status: Status;
  link?: { href: string; label: string };
}> = [
  {
    layer: "Integration / ingestion",
    choices:
      "FHIR R5 via JupyterHealth Exchange (primary), HL7v2 fallback, MuleSoft API-Led Connectivity for system integrations.",
    rationale:
      "Standards-based. JupyterHealth is the consented FHIR substrate; MuleSoft handles system-to-system writes and transforms. Avoids per-EHR custom work.",
    status: "prototype",
    link: { href: "/proposal/integration", label: "JupyterHealth integration brief →" }
  },
  {
    layer: "Read plane / unified patient memory",
    choices:
      "Salesforce Data 360 — Identity Resolution + Calculated Insights + Segments, zero-copy federated over JupyterHealth FHIR, DBDP features, and the customer's EHR-of-record.",
    rationale:
      "Solves identity + grounding in one substrate without bulk PHI ingestion. Snowflake / Databricks / Epic Health Cloud are federation targets, not separate Pause platforms.",
    status: "prototype",
    link: { href: "/proposal/data-360", label: "Data 360 brief →" }
  },
  {
    layer: "Inference + orchestration",
    choices:
      "Anthropic Claude Sonnet 4.5 via @anthropic-ai/sdk for the Care Router; deterministic Pause policy engine as fallback. Multi-agent control plane via the (mocked) MuleSoft Agent Fabric.",
    rationale:
      "Frontier-quality reasoning where it counts; deterministic safety floor where it doesn't. The Agent Fabric provides registry + policy catalog + trace plane.",
    status: "shipped",
    link: { href: "/proposal/agent-fabric", label: "Agent Fabric brief →" }
  },
  {
    layer: "Tool surface for agents + customer LLMs",
    choices:
      "MCP server exposing four Pause tools (get_patient_timeline, get_data360_grounding, evaluate_routing_policy, list_segments). Compatible with Claude Desktop, Cursor, Agentforce, and any MCP client.",
    rationale:
      "Lets the customer's own LLMs read Pause's data + policies the same way our agents do. Standard protocol, no per-vendor adapters.",
    status: "shipped",
    link: { href: "/proposal/mcp", label: "MCP server brief →" }
  },
  {
    layer: "Foundation model strategy",
    choices:
      "Frontier providers (Anthropic primary, OpenAI / Google as alternates). Open-weight options (Llama, Mistral) earmarked for security-sensitive on-prem deployments.",
    rationale:
      "Best-in-class quality where allowed; on-prem swap available for customers that need it, without rebuilding the agent layer.",
    status: "designed"
  },
  {
    layer: "Specialty models",
    choices:
      "Phase 2: domain-specific classifiers and embeddings for symptom-cluster scoring + risk stratification. Phase 1 uses the deterministic policy engine + LLM reasoning.",
    rationale:
      "Small models for the repetitive structured work; LLMs only where reasoning is required. Specialty models are a Phase 2 step gated on having labeled real-deployment data.",
    status: "future"
  },
  {
    layer: "Wearable + biomarker features",
    choices:
      "Digital Biomarker Discovery Pipeline (DBDP). Phase 1 shipped: FLIRT-backed RMSSD with closed-form correctness tests. Phase 2: EDA, sleep, vasomotor burden composite via Devicely + DHDR.",
    rationale:
      "Reuses peer-reviewed wearable feature pipelines instead of reinventing them. Honest about what's shipped (RMSSD) vs what awaits library upgrades (numpy < 2.0 in Devicely's current release).",
    status: "prototype",
    link: { href: "/proposal/dbdp", label: "DBDP feature engineering brief →" }
  },
  {
    layer: "Application + intake",
    choices:
      "Next.js (this site, the SMART-on-FHIR launch surface ahead). Salesforce Agentforce Service Agent for live intake (running on a real Service Cloud org today).",
    rationale:
      "Same engineers can move between web, EHR-embedded, and intake surfaces. React Native patient-mobile app is Phase 2.",
    status: "prototype",
    link: { href: "/proposal/agentforce", label: "Agentforce intake brief →" }
  },
  {
    layer: "Infrastructure",
    choices:
      "Vercel for the demo + investor brief; AWS (HIPAA-eligible) + customer-controlled VPC for production deployments. GitHub Actions CI.",
    rationale:
      "Vercel today because the brief is a public artifact; AWS + per-customer VPC at customer-deployment time so PHI never leaves customer-controlled blast radius.",
    status: "designed"
  },
  {
    layer: "Observability + trace plane",
    choices:
      "Agent Fabric trace ring buffer: per-call spans with model, inputs, outputs, sources queried, durations, agent + protocol. Customer-deployment OpenTelemetry export via the MuleSoft tap.",
    rationale:
      "Audit-grade trail. Inputs/outputs/model/duration are live today in the demo trace plane; clinician-action capture lands when the SMART-on-FHIR install ships.",
    status: "prototype",
    link: { href: "/demo/agent-fabric", label: "See the live trace plane →" }
  }
];

const aiApproach: Array<{
  aspect: string;
  approach: string;
  status: Status;
}> = [
  {
    aspect: "Recommendation generation",
    approach:
      "Anthropic Claude (Sonnet 4.5) prompted with the patient's Data 360 grounding payload + a guideline-aware system prompt. Outputs the canonical pathway enum (six values) + acuity + rationale, with the deterministic policy engine as fallback when the LLM is unavailable.",
    status: "shipped"
  },
  {
    aspect: "RAG over a curated guideline corpus",
    approach:
      "Phase 2 work. Today's prompts are guideline-aware but not retrieval-grounded against a corpus. Phase 2 builds the curated menopause guideline corpus + retrieval pipeline + citation surfacing.",
    status: "future"
  },
  {
    aspect: "Symptom clustering",
    approach:
      "Phase 1 today: deterministic symptom-cluster scoring via the policy engine + LLM-assisted free-text interpretation. Phase 2: domain-specific embedding model trained on PRO + EHR free text once we have labeled deployment data.",
    status: "designed"
  },
  {
    aspect: "Risk stratification",
    approach:
      "Phase 1 today: deterministic risk band from intake scores (V+S+M aggregate + per-axis flags). Phase 2: gradient-boosted classifier on structured features once labeled deployment data exists.",
    status: "prototype"
  },
  {
    aspect: "Conversational interface",
    approach:
      "Provider mode: clinical pre-read + decision support inside the Care Detail view (already live). Patient mode: live Agentforce-driven intake (already live). Roles enforced by the Agent Fabric policy catalog.",
    status: "shipped"
  },
  {
    aspect: "Continuous improvement loop",
    approach:
      "Today: every Care Router decision lands in the trace plane with inputs, outputs, model version, and duration. Tomorrow: clinician edits/rejections feed preference-tuning datasets + the outcomes registry validates long-term accuracy.",
    status: "prototype"
  }
];

const evals = [
  {
    name: "Clinician acceptance rate",
    target: ">= 70% accept-or-edit; < 10% reject outright",
    why: "Operationally meaningful adoption signal; precedes outcomes data."
  },
  {
    name: "Recommendation accuracy vs. specialist panel",
    target: ">= 85% concordance on top-1; >= 95% on top-3",
    why: "Validates that the system suggests what an MSCP-credentialed clinician would."
  },
  {
    name: "Diagnostic time reduction",
    target: "From 2.5 years (industry average) to < 90 days for newly-onset cases",
    why: "Direct patient outcome and a compelling marketing claim — only credible if measured."
  },
  {
    name: "Avoidable utilization reduction",
    target: "10–20% reduction in ER + specialist visits for the cohort over 12 months",
    why: "Anchors the payer ROI conversation."
  },
  {
    name: "Hallucination rate on guideline questions",
    target: "< 1% on a held-out evaluation set; 0% on contraindication questions",
    why: "Safety floor. Contraindications + dosing must be deterministic, enforced by the Agent Fabric policy catalog."
  }
];

const safety: Array<{
  principle: string;
  detail: string;
  status: Status;
}> = [
  {
    principle: "Bounded scope",
    detail:
      "The system addresses menopause-related decisions only. Out-of-scope questions are deflected with an explicit handoff. Enforced by the agent's system prompt + the Agent Fabric scope policy.",
    status: "shipped"
  },
  {
    principle: "Human-in-the-loop by design",
    detail:
      "No autonomous prescribing. No autonomous patient messaging without clinician review. The 'no-clinical-autonomy' policy in the Agent Fabric policy catalog enforces this on every span.",
    status: "shipped"
  },
  {
    principle: "Explainability is a feature, not a setting",
    detail:
      "Every Care Router decision carries inputs, model, rationale, and sources-queried as span attributes. The trace plane surfaces them; the Care Detail view shows the same to clinicians.",
    status: "shipped"
  },
  {
    principle: "Bias monitoring",
    detail:
      "Sub-group performance tracking by age band, race, ethnicity, geography, and clinical setting — reported quarterly to the clinical advisory board. Pipeline + dashboards are Phase 2 work gated on deployment data.",
    status: "designed"
  },
  {
    principle: "Red-teaming + adversarial evaluation",
    detail:
      "Quarterly red-team exercises by external clinical evaluators. Findings published internally and acted on before each major release. Process is documented; first formal red-team is gated on first design partner.",
    status: "designed"
  },
  {
    principle: "Privacy posture",
    detail:
      "HIPAA-ready architecture today (zero-copy federation, no bulk PHI ingest, customer-controlled blast radius in production). HITRUST CSF + SOC 2 Type II are on the roadmap.",
    status: "prototype"
  }
];

// StatusPill lives in components/status-pill.tsx so the vocabulary
// stays consistent across the deck.
const pillSpacing: React.CSSProperties = { marginBottom: "0.5rem" };

export default function TechnologyPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Technology Choices: stack, AI approach, safety"
      subtitle="A pragmatic stack that's standards-based at the bottom, frontier-LLM at the reasoning layer, and trace-anchored throughout. Each layer below is tagged with current status (Shipped / Wired in prototype / Designed / Future) and cross-links to the architecture brief that owns it."
    >
      <section>
        <p className="eyebrow">Stack overview</p>
        <h2 className="proposal-section-title">
          Ten layers — each one verifiable today, or honestly labeled as ahead
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {stack.map((s) => (
            <article key={s.layer} className="card">
              <StatusPill status={s.status} style={pillSpacing} />
              <h3>{s.layer}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  margin: "0 0 0.5rem",
                  fontSize: "0.92rem"
                }}
              >
                {s.choices}
              </p>
              <p style={{ margin: "0 0 0.6rem", color: "var(--text)" }}>
                {s.rationale}
              </p>
              {s.link && (
                <a
                  href={s.link.href}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
                >
                  {s.link.label}
                </a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">AI approach</p>
        <h2 className="proposal-section-title">Six axes — and what&apos;s live today</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {aiApproach.map((a) => (
            <article key={a.aspect} className="card">
              <StatusPill status={a.status} style={pillSpacing} />
              <h3>{a.aspect}</h3>
              <p style={{ margin: 0, color: "var(--text)" }}>{a.approach}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Evaluation framework</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What we&apos;ll measure
        </h2>
        <p style={{ color: "var(--muted)", margin: "0 0 0.8rem", fontSize: "0.92rem" }}>
          Every target below is a measurement plan, not a current
          observation. Pause is pre-design-partner; the eval framework
          becomes a measurement contract with the first IDN.
        </p>
        <div className="table-wrap">
          <table className="routing-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Target</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((row) => (
                <tr key={row.name}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.target}</td>
                  <td>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Safety and trust</p>
        <h2 className="proposal-section-title">
          Six principles — three shipped today, three on the roadmap
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {safety.map((s) => (
            <article key={s.principle} className="card">
              <StatusPill status={s.status} style={pillSpacing} />
              <h3>{s.principle}</h3>
              <p style={{ margin: 0, color: "var(--text)" }}>{s.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">The architecture briefs in order</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.6rem",
            fontSize: "0.95rem"
          }}
        >
          Each of the stack layers above cross-links to its own brief.
          Following the stack from interop floor to control plane:
        </p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The FHIR R5 substrate. Standards-based interop floor.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP feature engineering</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Wearable + biomarker features. FLIRT-backed RMSSD shipped today.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              System / Process / Experience tiers. The integration plane.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data-360">Salesforce Data 360</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Read plane: Identity Resolution + Calculated Insights + Segments.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agentforce">Agentforce intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Patient intake on real Salesforce Service Cloud today.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mcp">MCP server</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Tool surface for our agents and the customer&apos;s LLMs.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Multi-agent control plane: registry + policy catalog + trace plane.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
