import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Salesforce Data 360",
  description:
    "How Pause-Health.ai grounds its Care Router agent in a Salesforce Data 360 federated patient view — zero-copy federation across JupyterHealth, DBDP, EHR, and intake history.",
  path: "/proposal/data-360",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause × Salesforce Data 360 — investor brief."
});

const whyData360 = [
  {
    title: "Zero-copy federation",
    detail:
      "Data 360 queries the customer's existing data plane in place — JupyterHealth FHIR, Snowflake / Databricks warehouses, DBDP feature stores, and the Epic Health Cloud — via the Federation + Iceberg connectors. No PHI bulk-ingestion into Salesforce; nothing for the customer's data team to migrate."
  },
  {
    title: "Unified patient memory",
    detail:
      "Identity Resolution reconciles the same patient across wearable signups, EHR records, prior intake sessions, and claims. The Care Router decides over a single unified patient, not whichever fragment happened to be in the current API response."
  },
  {
    title: "Calculated insights as triage features",
    detail:
      "Materialized features computed continuously across the federated sources: 30-day HRV z-score, vasomotor burden index, sleep disruption fraction, days since last MSCP-credentialed contact. These become routing inputs without us writing a feature pipeline."
  },
  {
    title: "Segments power proactive care",
    detail:
      "Population segments (e.g. 'late perimenopause with rising HRV variability', 'postmenopausal bleeding cohort') activate to Agentforce, the Agent Fabric, and Health Cloud. Pause can reach the right patients before they ever open an intake session."
  }
];

const fabricFit = [
  {
    title: "Sits between MuleSoft and the agents",
    detail:
      "MuleSoft remains the integration plane (system-to-system, writes, transforms). Data 360 is the unified read plane on top: 'what do we know about this patient, right now, across every source we federate into?' The two compose cleanly."
  },
  {
    title: "Registered as a first-class agent on the fabric",
    detail:
      "Data 360 appears in the Agent Fabric registry alongside Agentforce, the Care Router, the Pause MCP server, and MuleSoft. Its grounding queries emit trace spans. Its identity resolution emits trace spans. Every call is auditable in the same pane."
  },
  {
    title: "Policy-governed grounding",
    detail:
      "Three Data 360-specific policies enforced today: zero-copy-federation-only (no PHI bulk-ingest), consent-required-before-grounding (the Care Router cannot read without an active 'ai-decision-support' consent), segment-activation-allowlist (downstream channels must be approved). Standard HIPAA audit policy applies to every grounding call."
  },
  {
    title: "Identity resolution at the front door",
    detail:
      "When Agentforce captures the intake, the handoff endpoint asks Data 360 to resolve the partial identity to a unified patient id. That unified id flows through the rest of the trace — the Care Router, the MCP server, every downstream span carries it."
  }
];

const traceFlow = [
  {
    step: 1,
    span: "Agentforce intake.complete",
    detail:
      "Patient finishes the intake. Captured fields, red-flag screen, and severity are recorded as the parent span."
  },
  {
    step: 2,
    span: "Data 360 identity.resolve",
    detail:
      "The handoff endpoint asks Data 360 to resolve the partial identity. Returns the unified patient id and the IR confidence score."
  },
  {
    step: 3,
    span: "Data 360 grounding.federated-query",
    detail:
      "Federated read against the Data 360 unified patient view: calculated insights, longitudinal observations, cohort comparison, last MSCP contact. The full grounding payload attaches to the A2A handoff."
  },
  {
    step: 4,
    span: "Care Router a2a.tasks/send",
    detail:
      "The Care Router receives BOTH the intake AND the Data 360 grounding as data parts of one A2A message. Decision rationale cites which insights it used; span attributes record cohort name and insights cited."
  }
];

const protoVsProd = [
  {
    aspect: "Identity Resolution",
    proto:
      "LIVE today: deterministic match against real seeded Health Cloud Contacts in our Salesforce dev org. Returns the real Salesforce Contact.Id as the unified patient id. Mock falls back automatically if the org is unreachable.",
    prod:
      "Configurable Data 360 IR ruleset across federated sources, returning ranked match candidates with confidence scores."
  },
  {
    aspect: "Grounding query target",
    proto:
      "LIVE today: real SOQL against Salesforce Health Cloud (Contact + CareProgramEnrollee + CarePlan + Case). Returns real enrollment status, real care-plan status, real days-since-last-clinical-contact, real cohort size.",
    prod:
      "Real Salesforce Data 360 Federated Query API against the customer's JupyterHealth FHIR store, DBDP feature warehouse, and EHR-of-record. Phase 1 SOQL pattern stays — the federation target swaps."
  },
  {
    aspect: "Calculated insights — Salesforce-native",
    proto:
      "LIVE today: \"Active care program enrollment\", \"Days since last clinical contact\", \"Active care plan status\" — built from real Health Cloud objects on every Care Router call.",
    prod:
      "Same insights plus Data 360 Calculated Insights jobs recomputed nightly/streaming over the federated sources."
  },
  {
    aspect: "Calculated insights — wearable / EHR",
    proto:
      "MOCKED (Phase 2 work): HRV variability z-score, vasomotor burden composite, sleep disruption index. Marked as 'intake-only baseline' in the API so it's clear which insights are real vs which await Data Cloud federation.",
    prod:
      "Real Data 360 Calculated Insights jobs against the customer's JupyterHealth FHIR observations and DBDP feature warehouse."
  },
  {
    aspect: "Segments",
    proto:
      "Four hand-curated segments returned by /api/data-360/segments (mocked).",
    prod:
      "Population segments authored in the Data 360 console by the customer's clinical-data team, with activation routes configured per segment."
  },
  {
    aspect: "Consent enforcement",
    proto:
      "Consent ledger included on the federated record; policy advertised but not blocking the prototype.",
    prod:
      "Hard-enforced by the Data 360 consent service. Care Router grounding calls without an active 'ai-decision-support' consent are rejected with a redaction notice."
  }
];

const phases = [
  {
    name: "Phase 1 — Real Health Cloud grounding (LIVE)",
    duration: "Shipped",
    detail:
      "Pause's Care Router is now grounded on real Salesforce Health Cloud objects from a connected dev org: real Contact, real CareProgramEnrollee, real CarePlan, real Case. OAuth 2.0 Client Credentials Flow via an External Client App. The Agent Fabric console shows a LIVE badge on every span served by the real org. Zero-credential mock path remains the default for previews and CI."
  },
  {
    name: "Phase 2 — Data Cloud unified profile",
    duration: "2–3 weeks",
    detail:
      "Stand up a Data Cloud Data Stream → Data Model Object → UnifiedIndividual mapping in the same org. Federate one wearable source (JupyterHealth FHIR test instance) via the Iceberg connector. Author the four wearable/EHR Calculated Insights as real Data Cloud jobs. The grounding fetcher swaps its SOQL backend for the Data Cloud Federated Query API; the Care Router interface doesn't change."
  },
  {
    name: "Phase 3 — First customer deployment",
    duration: "4–6 weeks with customer",
    detail:
      "Federate the customer's EHR-of-record (Epic / Cerner / Athena) and their DBDP feature warehouse. Author the customer's IR ruleset. Wire consent enforcement to the customer's existing consent ledger. Roll the Care Router onto real-customer grounding."
  },
  {
    name: "Phase 4 — Cohort analytics & activation",
    duration: "Ongoing",
    detail:
      "Population segments activate to Agentforce for proactive outreach (\"women in your cohort who saw an MSCP within 14 days had 71% symptom resolution\"). Health Cloud cards on the patient timeline. Marketing Cloud for educational journeys."
  }
];

const investorTakeaways = [
  {
    label: "Hospitals don't migrate; they federate",
    detail:
      "Pause does not ask a customer to move PHI into Salesforce. Data 360's zero-copy federation reads the data where it already lives (JupyterHealth, Snowflake, Epic). This is the posture that closes deals with Chief Data Officers."
  },
  {
    label: "Longitudinal context makes the agent visibly smarter",
    detail:
      "Without Data 360 grounding, the Care Router sees one intake. With it, the agent sees a 30-day HRV trend, vasomotor burden trajectory, days since MSCP contact, and cohort percentile. The same code path produces materially better routing decisions — and the rationale shows it."
  },
  {
    label: "Open ecosystem at every tier — including data",
    detail:
      "Data 360 is the customer's data control plane. MuleSoft is their integration plane. JupyterHealth + FHIR + DBDP is their clinical substrate. MCP + A2A is the agent contract. Pause composes — it doesn't lock anything in."
  },
  {
    label: "Same data plane, two product motions",
    detail:
      "B2C: the Care Router routes patients smarter because Data 360 told it about the cohort. B2B: hospitals install Pause on top of their existing Data 360 (or our managed Data 360) and segment their menopause population for proactive care. One platform, two GTM wedges."
  }
];

export default function Data360Page() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Salesforce Data 360"
      title="Unified patient memory, federated in place"
      subtitle="Pause-Health.ai grounds its Care Router agent in a Salesforce Data 360 federated patient view — calculated insights, longitudinal observations, cohort comparisons, and identity resolution computed continuously across JupyterHealth, DBDP, and the customer's EHR-of-record without ever moving PHI."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why Data 360</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyData360.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">How it composes with the rest of the stack</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {fabricFit.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The four-span trace</p>
        <p style={{ marginTop: "0.4rem" }}>
          Every multi-agent task now produces this trace shape. Open{" "}
          <a href="/demo/agent-fabric">/demo/agent-fabric</a>, run a test case,
          and watch the four spans appear with parent/child correlation intact.
        </p>
        <ol style={{ marginTop: "0.8rem", paddingLeft: "1.2rem" }}>
          {traceFlow.map((row) => (
            <li key={row.step} style={{ marginBottom: "0.6rem" }}>
              <strong>Span {row.step}: </strong>
              <code style={{ fontSize: "0.88rem" }}>{row.span}</code>
              <p style={{ marginTop: "0.2rem" }}>{row.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <p style={{ marginTop: "0.4rem" }}>
          Every Data 360 mock is reachable as a real HTTP endpoint right now.
          The Care Router reads grounding from one of them on every intake.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a href="/demo/agent-fabric" className="btn btn-primary">
            Open Agent Fabric console
          </a>
          <a
            href="/api/data-360/patient/pause-demo-patient-001/grounding"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            GET /api/data-360/.../grounding
          </a>
          <a
            href="/api/data-360/patient/pause-demo-patient-001/record"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Federated patient record
          </a>
          <a
            href="/api/data-360/segments"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Population segments
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
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {phase.duration}
              </p>
              <p>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why investors should care</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
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
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Multi-agent control plane</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Agent Fabric where Data 360 is registered and its grounding
              calls are traced.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The integration plane that writes back to JupyterHealth and the
              EHR-of-record that Data 360 federates over.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The FHIR substrate Data 360 reads from as its primary clinical
              federation target.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP feature engineering</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The wearable feature pipeline that supplies HRV, sleep, and
              vasomotor signals to Data 360 calculated insights.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://www.salesforce.com/data/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Salesforce Data 360
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Salesforce product Pause grounds its agents on.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
