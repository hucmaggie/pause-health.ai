import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · JupyterHealth Integration",
  description:
    "How Pause-Health.ai composes with JupyterHealth — open FHIR substrate, wearable normalization, and a customer-controlled deployment posture. Today: two JupyterHealth packages (omh-shim + jupyterhealth-client) integrated and tested in pause_ingest; full deployment is design-stage.",
  path: "/proposal/integration",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "JupyterHealth integration — Pause-Health.ai investor brief."
});

/**
 * JupyterHealth integration brief — Arc B polish pass.
 *
 * The scout flagged the previous version's tone as the most
 * aspirational of any Arc B page: the subtitle declared
 * "JHE stores the data and runs consent; Pause does the reasoning"
 * for a state where zero JHE instance is standing up anywhere. The
 * "What we adopt" cards described each piece in present tense as if
 * it were already part of the operating stack. And there was no
 * Phase 0 "Today" card -- so a reader had no easy way to anchor the
 * five-phase plan against the current baseline.
 *
 * Five moves:
 *
 *   1. Per-card StatusPill on every `pieces` card. Two are
 *      `prototype` because they are actually integrated in the
 *      Python ingest worker today (omh-shim, jupyterhealth-client --
 *      both imported in pause_ingest, with unit tests). The other
 *      three (JHE server, jupyter-smart-on-fhir, helm-charts) are
 *      `designed`.
 *
 *   2. NEW Phase 0 card at the start of the phased plan that
 *      anchors what is in-hand right now (omh-shim integration,
 *      jupyterhealth-client read path, 20 passing unit tests across
 *      convert + features). Pilled `prototype`.
 *
 *   3. Subtitle softened from "JHE stores the data and runs consent;
 *      Pause does the reasoning" (present tense for a non-running
 *      stack) to a designed-vs-prototype split that matches the
 *      pieces cards.
 *
 *   4. NEW "Touch the architecture" CTA panel, replacing the
 *      previous "Read the full design doc" prose card. Points at
 *      /api/mulesoft/patient/anika-patel/timeline (the FHIR R5
 *      Bundle shape JHE will produce in production), the pause_ingest
 *      tests directory, and the design doc.
 *
 *   5. Normalized "Read deeper" footer in the standard pattern with
 *      pills, plus new /demo/intake and /demo/patient cross-links so
 *      the integration brief connects to the live grounding card and
 *      the federated patient record viewer.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const pieces: Array<{
  name: string;
  status: StatusPillStatus;
  repo: string;
  role: string;
  why: string;
}> = [
  {
    name: "JupyterHealth Exchange (JHE)",
    status: "prototype",
    repo: "https://github.com/jupyterhealth/jupyterhealth-exchange",
    role:
      "FHIR R5 + Open mHealth data plane. OAuth2/OIDC, scope-based consent, multi-tenant orgs and studies. Django app deployable into a customer VPC.",
    why:
      "We adopt this instead of building it. Customers see open standards, not a black box. Stood up locally on 2026-06-16 (Docker postgres + JHE Django container, OIDC RS256 key, seeded study + Patient + Oura Data Source + client_credentials OAuth app) and pause_ingest's examples/oura_sample_upload.py round-trips a real Oura sample through omh-shim → FHIR R5 Observation → POST → readback against it. Transcript at docs/JHE_REAL_RUN_2026-06-16.md."
  },
  {
    name: "jupyterhealth-client",
    status: "prototype",
    repo: "https://github.com/jupyterhealth/jupyterhealth-client",
    role:
      "Python client (pip install jupyterhealth-client). Used by the Pause backend to read patient observations from the Exchange.",
    why:
      "Library, not service. Adds zero ops surface. Integrated today in pause_ingest.exchange (read + upload paths); a passing test asserts the read shape against a fixture."
  },
  {
    name: "omh-shim",
    status: "prototype",
    repo: "https://github.com/jupyterhealth/omh-shim",
    role:
      "Converters from vendor wearable JSON (Oura, Open Wearables) to Open mHealth / IEEE 1752.1.",
    why:
      "Lets us normalize wearable data before ingest. Integrated today in pause_ingest.convert against omh-shim v1.0.1, with an explicit allow-list and 20 passing unit tests. Apple HealthKit + skin_temperature converters are planned contributions back."
  },
  {
    name: "jupyter-smart-on-fhir",
    status: "designed",
    repo: "https://github.com/jupyterhealth/jupyter-smart-on-fhir",
    role:
      "Reference SMART-on-FHIR launch flow from an EHR into a Jupyter / web environment.",
    why:
      "Pattern for our Epic / Cerner-embedded launch. Same auth model as the rest of the platform. Today: studied, not yet wired in the prototype."
  },
  {
    name: "helm-charts",
    status: "designed",
    repo: "https://github.com/jupyterhealth/helm-charts",
    role:
      "Kubernetes deployment for JHE — public cloud, private cloud, or on-prem behind a firewall.",
    why:
      "How customer health systems run the substrate inside their own VPC. Pause's inference layer runs alongside. Phase 5 work; no Pause-tuned values.yaml committed yet."
  }
];

const dataTypes = [
  { type: "Heart rate", value: "Vasomotor signal; sympathetic drive" },
  { type: "Heart rate variability", value: "Autonomic dysregulation, sleep quality" },
  { type: "Sleep duration / sleep episode", value: "Night sweats, sleep fragmentation" },
  {
    type: "Oxygen saturation",
    value:
      "Sleep-disordered breathing. Supported by omh-shim today for Open Wearables; Oura converter is a near-term upstream PR."
  },
  { type: "Step count / physical activity", value: "Fatigue, activity drop" },
  {
    type: "Skin temperature (gap)",
    value:
      "Hot-flash signal not yet in omh-shim v1.0.1. Natural Pause contribution back upstream — converter plus Open mHealth schema proposal."
  }
];

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 0 · Today",
    status: "prototype",
    duration: "Shipped",
    detail:
      "omh-shim and jupyterhealth-client integrated in pause_ingest. Vendor JSON → Open mHealth (IEEE 1752.1) → FHIR R5 Observation path is end-to-end runnable in the Python worker, including DBDP HRV feature computation → derived Observation upload with derivedFrom provenance. Wire-level contract test (tests/jhe_mock_server.py + test_exchange_integration.py) exercises the full pipeline against an in-process JHE mock — the production exchange.upload_observation, hrv_features_to_fhir_observation, and read_recent_observations code paths run unmodified. 27 / 27 tests pass. Surfaced a real bug in the jupyterhealth-client integration that lenient unit-test doubles missed. Reference FHIR R5 Bundle shape also served live at /api/mulesoft/patient/anika-patel/timeline."
  },
  {
    name: "Phase 1 · Local dev loop against real JHE",
    status: "prototype",
    duration: "Shipped 2026-06-16",
    detail:
      "Real JupyterHealth Exchange Django container brought up against a Docker postgres on the maintainer's box, OIDC RS256 key generated, seeded with the canonical RBAC fixtures, an OAuth client_credentials app named pause-ingest bound to a real Patient + Oura DataSource through a Study with explicit per-scope consent rows, and pause_ingest's full pipeline (convert → omh_to_fhir_observation → upload_observation → JupyterHealthClient readback) ran end-to-end with a server-issued Observation id. Three real-JHE-only gotchas the wire-level mock had not pinned were surfaced and fixed in the same session: pause_ingest was requesting OAuth scope strings (observation.read / observation.write) JHE's vocabulary rejects with invalid_scope; pause_ingest used Content-Type: application/fhir+json which JHE's parser rejects (must be application/json); and pause_ingest's OMH coding system / code shape did not match JHE's mapped-Observation routing criteria (system https://w3id.org/openmhealth, code omh:<schema>:<version>), so writes silently fell through to the auxiliary FhirAuxResource handler which then 400s on the missing X-JHE-FHIR-Source-ID header. Full transcript including each error → fix at docs/JHE_REAL_RUN_2026-06-16.md."
  },
  {
    name: "Phase 2 · Real wearable ingest",
    status: "designed",
    duration: "2–3 weeks",
    detail:
      "Vendor OAuth for Oura, then HealthKit bridge for Apple Health. Background worker polls samples and runs the convert → upload pipeline at scale."
  },
  {
    name: "Phase 3 · Provider read path",
    status: "designed",
    duration: "2–3 weeks",
    detail:
      "FastAPI assembles a patient timeline via jupyterhealth-client. Wire the menopause classifier and RAG over the guideline corpus. Clinician view in the Pause web app."
  },
  {
    name: "Phase 4 · Provider write path",
    status: "designed",
    duration: "3–4 weeks",
    detail:
      "Write Observation, CarePlan, and DocumentReference back to JHE. Capture clinician accept / edit / reject as outcomes-registry events."
  },
  {
    name: "Phase 5 · Customer-VPC deployment",
    status: "future",
    duration: "4+ weeks per design partner",
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

type ReadDeeperRow = {
  href: string;
  label: string;
  detail: string;
  external?: boolean;
  status?: StatusPillStatus;
};

const readDeeper: ReadDeeperRow[] = [
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    detail:
      "The connectivity plane that fronts JupyterHealth in customer deployments. The Pause backend never talks to JHE directly in a customer environment; it goes through the MuleSoft Experience APIs. Today: mocked Experience APIs at /api/mulesoft/*.",
    status: "partial"
  },
  {
    href: "/proposal/dbdp",
    label: "DBDP feature engineering",
    detail:
      "Wearable feature pipeline that runs against the same OMH-normalized payloads. Today: FLIRT integrated in pause_ingest.features with HRV unit tests; real Empatica E4 archive ingest is Phase 2.",
    status: "partial"
  },
  {
    href: "/proposal/provider-graph",
    label: "Provider graph",
    detail:
      "Clinician + facility layer on top of the FHIR substrate. Today: design only (Phase 0 = data model + decision).",
    status: "designed"
  },
  {
    href: "/proposal/data-360",
    label: "Data 360 grounding",
    detail:
      "Salesforce Data 360 federates over the same FHIR substrate JHE will hold — unified patient memory without moving PHI. Today: Phase 1 LIVE grounding against a real Health Cloud dev org.",
    status: "prototype"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce intake",
    detail:
      "The patient-facing intake whose structured record gets written back to JHE as FHIR Observations. Today: env-var-gated; defaults to scripted fallback (see the Agentforce env-table brief).",
    status: "partial"
  },
  {
    href: "/demo/intake",
    label: "Try the prototype",
    detail:
      "The grounding card on /demo/intake cites the federated mocked Experience API today — the same federated path JHE will sit behind in production."
  },
  {
    href: "/demo/patient",
    label: "Federated patient record viewer",
    detail:
      "The dossier that JHE + DBDP + provider-graph will assemble in production. Today: rendered from the mocked Experience APIs and lib/data-360.",
    status: "prototype"
  },
  {
    href: "https://github.com/hucmaggie/pause-health.ai/blob/main/docs/jupyterhealth-integration.md",
    label: "Full design doc",
    detail:
      "docs/jupyterhealth-integration.md — data-flow detail, risks, and references behind every claim on this page.",
    external: true
  }
];

export default function IntegrationPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="JupyterHealth Integration: open substrate, menopause-specific layer"
      subtitle="Pause-Health.ai is designed as the menopause intelligence layer on top of JupyterHealth's open FHIR R5 substrate. Today two of the five JupyterHealth packages (omh-shim + jupyterhealth-client) are integrated and unit-tested in the Python ingest worker; the JHE server itself, the SMART-on-FHIR Epic launch, and the Helm-chart deployment are design-stage. The architectural punchline — JHE stores the data and runs consent, Pause does the reasoning — is the target end state, anchored against the Phase 0 baseline below."
    >
      <section>
        <p className="eyebrow">What we adopt · status-pilled</p>
        <h2 className="proposal-section-title">Five JupyterHealth packages, two wired today</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> integrated
          in the Python ingest worker today ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> committed
          choice, activates in Phase 1 or later.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {pieces.map((p) => (
            <article key={p.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={p.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{p.name}</h3>
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
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Six menopause-relevant data types
        </h2>
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

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Three live surfaces you can hit right now
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The FHIR R5 Bundle shape JupyterHealth Exchange will produce in a
          customer deployment is already served as a deterministic mock at
          {" "}<code>/api/mulesoft/patient/[id]/timeline</code>. It returns a
          Patient + raw wearable Observations + DBDP-computed feature
          Observation with a <code>derivedFrom</code> reference back to the
          raw window — the same lineage every Pause recommendation will be
          auditable against.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginTop: "1rem"
          }}
        >
          <a
            href="/api/mulesoft/patient/anika-patel/timeline"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Patient timeline (FHIR R5 Bundle) →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/pause_ingest"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            pause_ingest source + tests →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/docs/jupyterhealth-integration.md"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Full design doc →
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased integration plan</p>
        <h2 className="proposal-section-title">From the Phase 0 baseline to a customer-VPC deployment</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {phases.map((phase) => (
            <article key={phase.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={phase.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{phase.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {phase.duration}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Strategic value</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four reasons the substrate is JupyterHealth
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Sales acceleration</span>
            <strong style={{ fontWeight: 500 }}>
              Open standards reduce procurement and security review. CIO-friendly
              story. The first paid pilot will validate this empirically — today
              it&apos;s a design hypothesis grounded in JupyterHealth&apos;s
              existing footprint.
            </strong>
          </li>
          <li>
            <span>Customer-controlled data</span>
            <strong style={{ fontWeight: 500 }}>
              JHE will run in customer VPC. PHI never leaves their boundary;
              Pause inference runs federated alongside. Federated-by-default
              posture matches /proposal/dbdp + /proposal/data-360.
            </strong>
          </li>
          <li>
            <span>Compounding ecosystem</span>
            <strong style={{ fontWeight: 500 }}>
              Every device converter added to omh-shim — by us or the
              community — becomes a new Pause data source. omh-shim is wired
              today; Apple HealthKit + skin_temperature converters are planned
              Pause contributions back.
            </strong>
          </li>
          <li>
            <span>Audit and explainability</span>
            <strong style={{ fontWeight: 500 }}>
              Every recommendation is a FHIR resource with a reproducible input
              set. Compliance teams can read it. The Agent Fabric trace plane
              (today: in-memory) preserves this lineage end-to-end.
            </strong>
          </li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Open contributions back</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four upstream contributions Pause plans to ship
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          Part of the strategy, not an afterthought. Earning standing in the
          JupyterHealth and Open mHealth communities lowers procurement
          friction for every subsequent customer.
        </p>
        <p
          style={{
            color: "var(--muted)",
            margin: "0.4rem 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          <StatusPill status="plan" style={inlinePillStyle} /> Plan items —
          none of these contributions are merged upstream yet.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {contributions.map((c) => (
            <li key={c}>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where the JupyterHealth substrate sits in the bigger picture</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {readDeeper.map((row) => (
            <li key={row.href}>
              <span>
                <a
                  href={row.href}
                  {...(row.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {row.label}
                </a>
              </span>
              <strong style={{ fontWeight: 500 }}>
                {row.status ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      flexWrap: "wrap"
                    }}
                  >
                    <StatusPill status={row.status} style={inlinePillStyle} />
                    <span>{row.detail}</span>
                  </span>
                ) : (
                  row.detail
                )}
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </ProposalShell>
  );
}
