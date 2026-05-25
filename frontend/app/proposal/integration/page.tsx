import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · JupyterHealth Integration",
  description:
    "How Pause-Health.ai composes with JupyterHealth — open FHIR substrate, wearable normalization, and a customer-controlled deployment posture.",
  path: "/proposal/integration",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "JupyterHealth integration — Pause-Health.ai investor brief."
});

const pieces = [
  {
    name: "JupyterHealth Exchange",
    repo: "https://github.com/jupyterhealth/jupyterhealth-exchange",
    role:
      "FHIR R5 + Open mHealth data plane. OAuth2/OIDC, scope-based consent, multi-tenant orgs and studies. Django app deployable into a customer VPC.",
    why:
      "We adopt this instead of building it. Customers see open standards, not a black box."
  },
  {
    name: "jupyterhealth-client",
    repo: "https://github.com/jupyterhealth/jupyterhealth-client",
    role:
      "Python client (pip install jupyterhealth-client). Used by the Pause backend to read patient observations from the Exchange.",
    why: "Library, not service. Adds zero ops surface."
  },
  {
    name: "omh-shim",
    repo: "https://github.com/jupyterhealth/omh-shim",
    role:
      "Converters from vendor wearable JSON (Oura, Open Wearables) to Open mHealth / IEEE 1752.1.",
    why:
      "Lets us normalize wearable data before ingest. Pause contributes new converters back (Apple Health, skin temperature)."
  },
  {
    name: "jupyter-smart-on-fhir",
    repo: "https://github.com/jupyterhealth/jupyter-smart-on-fhir",
    role:
      "Reference SMART-on-FHIR launch flow from an EHR into a Jupyter / web environment.",
    why:
      "Pattern for our Epic / Cerner-embedded launch. Same auth model as the rest of the platform."
  },
  {
    name: "helm-charts",
    repo: "https://github.com/jupyterhealth/helm-charts",
    role:
      "Kubernetes deployment for JHE — public cloud, private cloud, or on-prem behind a firewall.",
    why:
      "How customer health systems run the substrate inside their own VPC. Pause's inference layer runs alongside."
  }
];

const dataTypes = [
  { type: "Heart rate", value: "Vasomotor signal; sympathetic drive" },
  { type: "Heart rate variability", value: "Autonomic dysregulation, sleep quality" },
  { type: "Sleep duration / sleep episode", value: "Night sweats, sleep fragmentation" },
  {
    type: "Oxygen saturation",
    value: "Sleep-disordered breathing. Wired for Open Wearables today; Oura converter is a near-term upstream PR."
  },
  { type: "Step count / physical activity", value: "Fatigue, activity drop" },
  {
    type: "Skin temperature (gap)",
    value:
      "Hot-flash signal not yet in omh-shim v1.0.1. Natural Pause contribution back upstream — converter plus Open mHealth schema proposal."
  }
];

const phases = [
  {
    name: "Phase 1 · Local dev loop",
    duration: "1–2 weeks",
    detail:
      "Stand up JHE locally. Add jupyterhealth-client and omh-shim to the backend. Convert a sample wearable JSON to OMH and upload it as a FHIR Observation. Read it back from FastAPI. End-to-end proof."
  },
  {
    name: "Phase 2 · Real wearable ingest",
    duration: "2–3 weeks",
    detail:
      "Vendor OAuth for Oura, then HealthKit bridge for Apple Health. Background worker polls samples and runs the convert → upload pipeline at scale."
  },
  {
    name: "Phase 3 · Provider read path",
    duration: "2–3 weeks",
    detail:
      "FastAPI assembles a patient timeline via jupyterhealth-client. Wire the menopause classifier and RAG over the guideline corpus. Clinician view in the Pause web app."
  },
  {
    name: "Phase 4 · Provider write path",
    duration: "3–4 weeks",
    detail:
      "Write Observation, CarePlan, and DocumentReference back to JHE. Capture clinician accept / edit / reject as outcomes-registry events."
  },
  {
    name: "Phase 5 · Customer-VPC deployment",
    duration: "4+ weeks per customer",
    detail:
      "Deploy JHE into the customer VPC via Helm. Wire SAML SSO. Deploy Pause inference alongside in federated mode — model weights leave the VPC; PHI does not."
  }
];

const contributions = [
  "omh-shim converter for Apple HealthKit (today only Oura and Open Wearables).",
  "omh-shim converter and OMH schema proposal for skin_temperature.",
  "Helm chart values tuned for HIPAA-friendly defaults (TLS everywhere, audit logging, restricted egress).",
  "Open mHealth schema for a structured menopause symptom cluster (Pause-led, community-reviewed)."
];

export default function IntegrationPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="JupyterHealth Integration: open substrate, menopause-specific layer"
      subtitle="Pause-Health.ai is the menopause intelligence layer. JupyterHealth is the open, FHIR-native substrate underneath it. The architectural punchline: JHE stores the data and runs consent; Pause does the reasoning."
    >
      <section>
        <p className="eyebrow">What we adopt</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {pieces.map((p) => (
            <article key={p.name} className="card">
              <h3>{p.name}</h3>
              <p style={{ marginBottom: "0.5rem" }}>
                <a
                  href={p.repo}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ color: "var(--brand)", fontWeight: 600 }}
                >
                  {p.repo.replace("https://github.com/", "")}
                </a>
              </p>
              <ul className="metric-list">
                <li>
                  <span>What it does</span>
                  <strong style={{ fontWeight: 500 }}>{p.role}</strong>
                </li>
                <li>
                  <span>Why it matters</span>
                  <strong style={{ fontWeight: 500 }}>{p.why}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Wearable data types we surface</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data type</th>
                <th>Menopause relevance</th>
              </tr>
            </thead>
            <tbody>
              {dataTypes.map((row) => (
                <tr key={row.type}>
                  <td>{row.type}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased integration plan</p>
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
        <p className="eyebrow">Strategic value</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Sales acceleration</span>
            <strong style={{ fontWeight: 500 }}>
              Open standards reduce procurement and security review. CIO-friendly story.
            </strong>
          </li>
          <li>
            <span>Customer-controlled data</span>
            <strong style={{ fontWeight: 500 }}>
              JHE runs in customer VPC. PHI never leaves their boundary; Pause inference runs
              federated alongside.
            </strong>
          </li>
          <li>
            <span>Compounding ecosystem</span>
            <strong style={{ fontWeight: 500 }}>
              Every device converter added to omh-shim — by us or the community — becomes a new
              Pause data source.
            </strong>
          </li>
          <li>
            <span>Audit and explainability</span>
            <strong style={{ fontWeight: 500 }}>
              Every recommendation is a FHIR resource with a reproducible input set. Compliance
              teams can read it.
            </strong>
          </li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Open contributions back</p>
        <p>
          Part of the strategy, not an afterthought. Earning standing in the JupyterHealth and
          Open mHealth communities lowers procurement friction for every subsequent customer.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {contributions.map((c) => (
            <li key={c}>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read the full design doc</p>
        <p>
          The complete engineering design — data flow detail, risks, and references — lives in the
          repository at{" "}
          <code style={{ background: "rgba(255,93,168,0.12)", padding: "0.1em 0.4em", borderRadius: "0.3em" }}>
            docs/jupyterhealth-integration.md
          </code>
          . The architecture is reviewable, not aspirational.
        </p>
      </section>
    </ProposalShell>
  );
}
