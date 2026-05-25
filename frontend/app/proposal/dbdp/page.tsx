import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · DBDP Feature Engineering",
  description:
    "How Pause-Health.ai uses the Digital Biomarker Discovery Pipeline (DBDP) to turn raw wearable signals into clinical-grade menopause features.",
  path: "/proposal/dbdp",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "DBDP feature engineering — Pause-Health.ai investor brief."
});

const dbdpPieces = [
  {
    name: "FLIRT",
    repo: "https://github.com/im-ethz/flirt",
    license: "MIT · on PyPI",
    role:
      "Feature generation toolkit for wearable data. Sliding-window HRV, EDA, and accelerometer features from Empatica E4, Holter ECG, and other consumer-grade devices.",
    why: "Production-grade and installable. One line of code converts raw wearable archives into clinical features."
  },
  {
    name: "DBDP Heart Rate Variability",
    repo: "https://github.com/DigitalBiomarkerDiscoveryPipeline/Heart-Rate-Variability",
    license: "Apache-2.0",
    role:
      "Time-domain HRV metrics from RR / IBI intervals, validated against Kubios — the clinical HRV reference.",
    why: "Defensible numbers. We use the math as a fallback and as a deterministic reference in tests."
  },
  {
    name: "Digital Health Data Repository",
    repo: "https://github.com/DigitalBiomarkerDiscoveryPipeline/Digital_Health_Data_Repository",
    license: "Apache-2.0",
    role: "Curated sample wearable datasets maintained by the DBDP community.",
    why: "Real-shape fixtures for our automated tests; smoke-test data for new ingest paths."
  },
  {
    name: "devicely",
    repo: "https://github.com/hpi-dhc/devicely",
    license: "MIT",
    role:
      "Reading + de-identifying data from Empatica E4, Bittium Faros, Biovotion Everion, Shimmer, and Muse.",
    why:
      "Empatica E4 is the most common research-grade device in academic menopause studies. Scoped as Phase 2 because the current release pins numpy < 2.0."
  }
];

const features = [
  {
    feature: "RMSSD, SDNN, pNN50",
    domain: "Time-domain HRV",
    source: "FLIRT + DBDP HRV calculator",
    menopause:
      "Autonomic dysregulation tracking. Drops in HRV correlate with vasomotor severity and sleep disruption."
  },
  {
    feature: "HF / LF power, LF:HF ratio",
    domain: "Frequency-domain HRV",
    source: "FLIRT",
    menopause:
      "Sympathetic vs parasympathetic balance. Useful in stratifying patients for HRT vs non-hormonal pathways."
  },
  {
    feature: "Non-linear: SD1, SD2, CSI, CVI",
    domain: "Poincaré + chaotic HRV",
    source: "FLIRT",
    menopause:
      "Sensitive to overall autonomic load. Early indicator for cardiovascular risk shifts post-menopause."
  },
  {
    feature: "Sleep fragmentation, IBI entropy",
    domain: "Statistical HRV",
    source: "FLIRT",
    menopause:
      "Direct proxy for night sweats and disrupted sleep — the #1 patient-reported symptom in our research."
  },
  {
    feature: "EDA tonic / phasic decomposition",
    domain: "Electrodermal activity",
    source: "FLIRT (Empatica E4, Phase 2)",
    menopause: "Hot-flash detection from skin conductance peaks."
  },
  {
    feature: "Activity counts, sedentary bouts",
    domain: "Accelerometer",
    source: "FLIRT",
    menopause: "Fatigue and activity regression — a quality-of-life signal payers care about."
  }
];

const phases = [
  {
    name: "Phase 1 — Shipped",
    duration: "Today",
    detail:
      "FLIRT-backed sliding-window HRV, dependency-light HRV fallback ported from DBDP, DBDP-derived test fixture committed, 20 unit tests passing including a closed-form RMSSD correctness check."
  },
  {
    name: "Phase 2 — Next",
    duration: "2–3 weeks",
    detail:
      "Wire flirt.with_.empatica for Empatica E4 archive ingestion. Re-evaluate devicely once numpy 2.x support lands. Persist computed feature windows back to JupyterHealth Exchange as derivedFrom FHIR Observations."
  },
  {
    name: "Phase 3 — Open contribution",
    duration: "Ongoing",
    detail:
      "Propose an Open mHealth schema for skin temperature (hot-flash signal). Contribute a menopause-specific feature module to DBDP. Publish HRV-and-menopause feature-importance benchmarks against our pilot cohorts."
  }
];

export default function DbdpIntegrationPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · DBDP feature engineering"
      title="From raw wearables to clinical menopause features"
      subtitle="Pause-Health.ai composes with the Digital Biomarker Discovery Pipeline (Duke University) to compute clinically grounded features from wearable signals at ingest time, then persists them inside the JupyterHealth FHIR substrate."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why DBDP, why now</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          <article className="card">
            <h3>Production-grade, not a research artifact</h3>
            <p>
              FLIRT — the only PyPI-published DBDP-affiliated package — installs cleanly on
              Python 3.13 and computes the features our clinical advisors already trust
              (RMSSD, SDNN, HF/LF power, Poincaré SD1/SD2) in one call.
            </p>
          </article>
          <article className="card">
            <h3>Validated against Kubios</h3>
            <p>
              The DBDP HRV calculator was benchmarked against Kubios, the clinical HRV
              reference tool. We have ported its time-domain math as a deterministic
              reference inside our test suite. Defensible numbers for a clinical review.
            </p>
          </article>
          <article className="card">
            <h3>Lineage out of the box</h3>
            <p>
              Each computed feature lands in JupyterHealth Exchange as a FHIR Observation
              with a derivedFrom link to the raw IBI window it was computed over. Auditors
              and security reviewers see the full chain without us building one.
            </p>
          </article>
          <article className="card">
            <h3>Compounding community</h3>
            <p>
              DBDP is a Duke University–led open ecosystem with active contributors across
              wearables research. Our upstream contributions raise our credibility with
              academic medical center customers — and give us pull requests instead of
              integrations.
            </p>
          </article>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The DBDP pieces we use</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {dbdpPieces.map((piece) => (
            <article key={piece.name} className="card">
              <h3>{piece.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {piece.license}
              </p>
              <p>{piece.role}</p>
              <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
                <li>
                  <span>Why it matters</span>
                  <strong style={{ fontWeight: 500 }}>{piece.why}</strong>
                </li>
              </ul>
              <p style={{ marginTop: "0.6rem" }}>
                <a href={piece.repo} target="_blank" rel="noopener noreferrer">
                  Repository →
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Features we generate today</p>
        <p style={{ marginTop: "0.4rem" }}>
          Computed at ingest time from raw wearable signals and persisted in JupyterHealth
          Exchange. The inference layer reads them as FHIR Observations — no recompute on
          the provider read path.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Domain</th>
                <th>Source</th>
                <th>Why it matters for menopause</th>
              </tr>
            </thead>
            <tbody>
              {features.map((row) => (
                <tr key={row.feature}>
                  <td>
                    <strong>{row.feature}</strong>
                  </td>
                  <td>{row.domain}</td>
                  <td>{row.source}</td>
                  <td>{row.menopause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Status by phase</p>
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
        <p className="eyebrow">Why this earns trust</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Open standards, end to end</span>
            <strong style={{ fontWeight: 500 }}>
              Open mHealth at the schema layer, FHIR R5 at the storage layer, DBDP / FLIRT
              at the feature layer. Nothing proprietary in the data pipeline; only the
              menopause model is ours.
            </strong>
          </li>
          <li>
            <span>Math you can audit</span>
            <strong style={{ fontWeight: 500 }}>
              Each HRV metric has a reference implementation in pause_ingest with explicit
              unit annotations and a closed-form correctness test. Clinical advisors can
              read 50 lines and verify the math.
            </strong>
          </li>
          <li>
            <span>Compounding leverage</span>
            <strong style={{ fontWeight: 500 }}>
              When a new DBDP module ships — sleep staging, glucose variability, signal
              alignment — we adopt it. The platform gets better while our team stays
              small.
            </strong>
          </li>
          <li>
            <span>Honest engineering</span>
            <strong style={{ fontWeight: 500 }}>
              Where a dependency is not ready (devicely on Python 3.13), we say so in the
              doc, scope it to a phase, and raise a loud error at runtime. No silent gaps.
            </strong>
          </li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The FHIR substrate that this feature layer composes with.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The connectivity plane that triggers DBDP feature compute on every
              ingest event and routes the result back to JupyterHealth.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/technology">Technology choices</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Full stack, AI approach, and safety stance.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data">Data inventory and strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>Which datasets feed the moat.</strong>
          </li>
          <li>
            <span>
              <a
                href="https://www.dbdp.org/code-repository"
                target="_blank"
                rel="noopener noreferrer"
              >
                DBDP code repository
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The upstream community we contribute back to.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
