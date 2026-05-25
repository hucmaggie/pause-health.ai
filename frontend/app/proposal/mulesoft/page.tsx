import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · MuleSoft Integration",
  description:
    "Why Pause-Health.ai integrates JupyterHealth and the DBDP feature pipeline through MuleSoft Anypoint, and how the prototype upgrades to a customer-managed Mule deployment.",
  path: "/proposal/mulesoft",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "MuleSoft integration strategy — Pause-Health.ai investor brief."
});

const tiers = [
  {
    name: "System APIs",
    role: "Wrap each upstream once",
    detail:
      "Per-vendor adapters that own OAuth, rate limits, retry, and circuit-breaker behavior. One System API per wearable (Oura, Apple Health, Whoop, Empatica) plus one each for JupyterHealth Exchange and the DBDP feature worker."
  },
  {
    name: "Process APIs",
    role: "Orchestrate cross-system flows",
    detail:
      "Stateless orchestration between System APIs. pause-ingest-process-api validates an Open mHealth payload, transforms to FHIR R5 via DataWeave, posts to JHE, and fires a feature compute request to DBDP."
  },
  {
    name: "Experience APIs",
    role: "Pause-facing read endpoints",
    detail:
      "Read-optimized FHIR Bundles that combine raw Observations with DBDP-computed feature Observations. The Pause clinician web app calls these — never JHE or DBDP directly."
  }
];

const whyMulesoft = [
  {
    name: "The buyer already owns it",
    detail:
      "Most US health systems and large payers already license MuleSoft Anypoint Platform. Adding Pause becomes 'another Mule app on the existing fabric' — the lowest-friction posture a procurement team can encounter."
  },
  {
    name: "Vendor swap with no Pause code change",
    detail:
      "Adding a new wearable (Garmin, Withings, etc.) is one new System API plus one row in the Process API's routing config. The Pause backend is untouched. Customers extend the integration without coordinating with our engineering team."
  },
  {
    name: "Operational ownership flows correctly",
    detail:
      "The customer's integration team owns the System and Process APIs. Pause owns the Experience APIs and the menopause-specific logic. Each side operates the layer they understand best."
  },
  {
    name: "Composes with our other choices",
    detail:
      "MuleSoft in the middle, JupyterHealth + FHIR on the back, DBDP for wearable features, Agentforce on the front. Every piece is the best-in-class substrate for its job, and they fit together cleanly."
  }
];

const protoVsProd = [
  {
    aspect: "Where the integration runs",
    proto: "Mocked Experience API served by Next.js at /api/mulesoft/health.",
    prod:
      "Three-tier Mule application on the customer's Anypoint Runtime Fabric or CloudHub 2.0."
  },
  {
    aspect: "Reference flow code",
    proto:
      "mulesoft/flows/pause-process-api.example.xml — labeled Mule 4 XML with comments; not deployable.",
    prod:
      "Real Mule project with property files, secret references, API spec in Anypoint Exchange, CI/CD."
  },
  {
    aspect: "OMH → FHIR transform",
    proto:
      "mulesoft/transforms/omh-to-fhir.example.dwl — DataWeave 2.0 reference; same file ships into the real project.",
    prod:
      "Promoted to a shared Anypoint Exchange asset reused across customers."
  },
  {
    aspect: "Wearable vendor adapters",
    proto: "Direct vendor calls from pause_ingest (Python).",
    prod: "Per-vendor System APIs in Mule with token vaults, rate-limit controls, circuit breakers."
  },
  {
    aspect: "Pause backend integration surface",
    proto: "Direct calls to JupyterHealth Exchange.",
    prod:
      "Calls go only to Experience APIs. The customer's IT team owns the policy on those endpoints."
  }
];

const phases = [
  {
    name: "Phase 0 — Reference artifacts",
    duration: "Today",
    detail:
      "Reference Mule flow + DataWeave transform committed under mulesoft/. Mocked Experience API at /api/mulesoft/health. Design doc at docs/mulesoft-integration.md. Investor page (this one)."
  },
  {
    name: "Phase 1 — Working sandbox",
    duration: "2–3 weeks",
    detail:
      "Pause-managed Anypoint trial org. Six System APIs as real Mule projects. JHE and DBDP System APIs wired to local instances. One Process API end-to-end."
  },
  {
    name: "Phase 2 — First customer deployment",
    duration: "4–6 weeks with customer",
    detail:
      "Deploy Mule apps into the customer's Runtime Fabric. Wire their identity provider (PingFederate / Azure AD) to the Experience APIs. Cut over the Pause backend's reads."
  },
  {
    name: "Phase 3 — Multi-customer fabric",
    duration: "Ongoing",
    detail:
      "Promote shared System APIs (Oura, Apple Health, JHE) to versioned Anypoint Exchange assets. Customer-specific Process and Experience APIs remain in customer orgs."
  }
];

const investorTakeaways = [
  {
    label: "Procurement velocity",
    detail:
      "Reduces a Pause security review from 'evaluate a new vendor's data plane' to 'evaluate another Mule app on our existing platform.' Closing speed compounds against competitors who require a net-new integration framework."
  },
  {
    label: "Operational margin",
    detail:
      "Pause owns the Experience APIs and menopause-specific logic. Customer-side teams own the System and Process APIs. Our engineering doesn't have to scale linearly with customer count."
  },
  {
    label: "Defensible interoperability story",
    detail:
      "Open standards at every tier: Anypoint for connectivity, FHIR R5 for the substrate, Open mHealth for the schema, DBDP for the feature engineering. The full stack is independently auditable."
  },
  {
    label: "Customer-extensible without a fork",
    detail:
      "When a customer wants a new wearable or a new EHR connection, they add a System API in their own org. No Pause fork, no Pause code change, no Pause release schedule."
  }
];

export default function MulesoftPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · MuleSoft integration"
      title="Integration plane on the substrate our buyers already operate"
      subtitle="Pause-Health.ai's integration with JupyterHealth, DBDP wearable features, Agentforce, and consumer wearables runs through MuleSoft Anypoint — the connectivity platform most US health systems and large payers already license."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">API-Led Connectivity, applied to menopause</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {tiers.map((tier) => (
            <article key={tier.name} className="card">
              <h3>{tier.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {tier.role}
              </p>
              <p>{tier.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why MuleSoft</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyMulesoft.map((item) => (
            <article key={item.name} className="card">
              <h3>{item.name}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <p style={{ marginTop: "0.4rem" }}>
          The Next.js frontend exposes a mocked Experience-tier endpoint at{" "}
          <code>/api/mulesoft/health</code>. It returns a realistic FHIR R5 Bundle with a
          Patient, three raw wearable Observations (heart rate, sleep duration, HRV RR
          intervals), and one DBDP-computed feature Observation — the sliding-window
          RMSSD — with a <code>derivedFrom</code> reference back to the raw HRV input.
          That is the production read-path shape. The data lineage is intact: every
          computed feature points to the raw window it was derived from.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a
            href="/api/mulesoft/health"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            GET /api/mulesoft/health
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/mulesoft"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Reference Mule artifacts on GitHub
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/docs/mulesoft-integration.md"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Full design doc
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
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The FHIR substrate the MuleSoft plane connects to on the back end.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP feature engineering</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The feature computation worker each ingest call triggers.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agentforce">Agentforce intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The patient-facing front end whose consent decisions flow through the
              MuleSoft consent process API.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://www.mulesoft.com/api-led-connectivity"
                target="_blank"
                rel="noopener noreferrer"
              >
                MuleSoft: API-Led Connectivity
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The architectural pattern this integration adopts wholesale.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
