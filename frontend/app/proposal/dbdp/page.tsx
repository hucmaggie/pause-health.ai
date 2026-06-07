import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · DBDP Feature Engineering",
  description:
    "How Pause-Health.ai uses the Digital Biomarker Discovery Pipeline (DBDP) to turn raw wearable signals into clinical-grade menopause features. Today: FLIRT + DBDP HRV math integrated in pause_ingest with closed-form unit tests; persistence into JupyterHealth Exchange is Phase 2.",
  path: "/proposal/dbdp",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "DBDP feature engineering — Pause-Health.ai investor brief."
});

/**
 * DBDP feature engineering brief — Arc B polish pass.
 *
 * The previous version's "Features we generate today" headline
 * over a 6-row table read in present tense, but only 3 of the 6
 * rows (RMSSD, SDNN, pNN50) actually have closed-form unit tests
 * in pause_ingest. The remaining rows -- HF/LF power, Poincare
 * features, sleep fragmentation, EDA, accelerometer -- pass
 * through FLIRT but are not verified by Pause's own test suite.
 * The page also asserts that each computed feature "lands in
 * JupyterHealth Exchange as a FHIR Observation with derivedFrom
 * link" -- that's the Phase 2 design, not Phase 1 today.
 *
 * Five moves:
 *
 *   1. Per-row StatusPill on the features table. `prototype` for
 *      RMSSD / SDNN / pNN50 (closed-form tests) and the FLIRT
 *      RMSSD+SDNN happy-path columns. `designed` for HF/LF,
 *      Poincare, sleep-fragmentation entropy, EDA, accelerometer
 *      (produced by the same FLIRT call but not asserted by Pause
 *      tests).
 *
 *   2. Per-card StatusPill on dbdpPieces (4 cards). FLIRT + DBDP
 *      HRV + Digital Health Data Repository are `prototype`
 *      (integrated, fixture in tests). devicely stays `designed`
 *      (already explicitly labeled Phase 2 because of the numpy
 *      conflict).
 *
 *   3. Per-card StatusPill on whyDbdp (4 cards). "Lineage out of
 *      the box" goes `designed` because the JHE-Observation
 *      persistence isn't running yet. The other three are
 *      `prototype`.
 *
 *   4. Headline rename: "Features we generate today" -> "Feature
 *      catalog (per-row status)" with an explicit "today =
 *      verified in pause_ingest; designed = produced but not yet
 *      asserted" pill key.
 *
 *   5. NEW "Touch the architecture" CTA panel: pause_ingest source
 *      + tests directory + FLIRT upstream repo. Reader verifies
 *      the 20-test claim in two clicks. Normalized Read-deeper
 *      footer with pills + new /demo/patient cross-link.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const whyDbdp: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    name: "Production-grade, not a research artifact",
    status: "prototype",
    detail:
      "FLIRT — the only PyPI-published DBDP-affiliated package — installs cleanly on Python 3.13 and computes the features our clinical advisors already trust (RMSSD, SDNN, HF/LF power, Poincaré SD1/SD2) in one call. Integrated today in pause_ingest.features."
  },
  {
    name: "Validated against Kubios",
    status: "prototype",
    detail:
      "The DBDP HRV calculator was benchmarked against Kubios, the clinical HRV reference tool. We have ported its time-domain math as a deterministic reference inside our test suite — a closed-form RMSSD correctness test asserts the exact expected value against a strict-alternation IBI series."
  },
  {
    name: "Lineage out of the box",
    status: "designed",
    detail:
      "Each computed feature will land in JupyterHealth Exchange as a FHIR Observation with a derivedFrom link to the raw IBI window it was computed over. Auditors and security reviewers see the full chain without us building one. Today the lineage is materialized in the FHIR Bundle served at /api/mulesoft/patient/[id]/timeline; the JHE persistence path is Phase 2."
  },
  {
    name: "Compounding community",
    status: "designed",
    detail:
      "DBDP is a Duke University–led open ecosystem with active contributors across wearables research. Our upstream contributions raise our credibility with academic medical center customers — and give us pull requests instead of integrations. The planned contributions (skin-temperature schema, menopause feature module) are on /proposal/integration."
  }
];

const dbdpPieces: Array<{
  name: string;
  status: StatusPillStatus;
  repo: string;
  license: string;
  role: string;
  why: string;
}> = [
  {
    name: "FLIRT",
    status: "prototype",
    repo: "https://github.com/im-ethz/flirt",
    license: "MIT · on PyPI",
    role:
      "Feature generation toolkit for wearable data. Sliding-window HRV, EDA, and accelerometer features from Empatica E4, Holter ECG, and other consumer-grade devices.",
    why:
      "Production-grade and installable. Integrated today in pause_ingest.features.hrv_features_flirt; happy-path FLIRT call is unit-tested for hrv_rmssd + hrv_sdnn columns."
  },
  {
    name: "DBDP Heart Rate Variability",
    status: "prototype",
    repo: "https://github.com/DigitalBiomarkerDiscoveryPipeline/Heart-Rate-Variability",
    license: "Apache-2.0",
    role:
      "Time-domain HRV metrics from RR / IBI intervals, validated against Kubios — the clinical HRV reference.",
    why:
      "Defensible numbers. Ported into pause_ingest.features.hrv_time_domain_fallback as a dependency-light reference implementation, with a closed-form RMSSD test asserting the exact expected value."
  },
  {
    name: "Digital Health Data Repository",
    status: "prototype",
    repo: "https://github.com/DigitalBiomarkerDiscoveryPipeline/Digital_Health_Data_Repository",
    license: "Apache-2.0",
    role: "Curated sample wearable datasets maintained by the DBDP community.",
    why:
      "Real-shape fixtures used in pause_ingest tests today; smoke-test data for new ingest paths. A DBDP-style fixture is committed at pause_ingest/tests."
  },
  {
    name: "devicely",
    status: "designed",
    repo: "https://github.com/hpi-dhc/devicely",
    license: "MIT",
    role:
      "Reading + de-identifying data from Empatica E4, Bittium Faros, Biovotion Everion, Shimmer, and Muse.",
    why:
      "Empatica E4 is the most common research-grade device in academic menopause studies. Scoped as Phase 2 because the current release pins numpy < 2.0 — pause_ingest currently raises a clear Phase-2 RuntimeError if Empatica ingest is attempted (test_empatica_ingestion_raises_phase2_error)."
  }
];

const features: Array<{
  feature: string;
  status: StatusPillStatus;
  domain: string;
  source: string;
  menopause: string;
}> = [
  {
    feature: "RMSSD, SDNN, pNN50",
    status: "prototype",
    domain: "Time-domain HRV",
    source: "FLIRT + DBDP HRV calculator (Pause fallback)",
    menopause:
      "Autonomic dysregulation tracking. Drops in HRV correlate with vasomotor severity and sleep disruption. Closed-form unit-tested in pause_ingest."
  },
  {
    feature: "HF / LF power, LF:HF ratio",
    status: "designed",
    domain: "Frequency-domain HRV",
    source: "FLIRT",
    menopause:
      "Sympathetic vs parasympathetic balance. Useful in stratifying patients for HRT vs non-hormonal pathways. Produced by the FLIRT call today but not asserted by Pause tests."
  },
  {
    feature: "Non-linear: SD1, SD2, CSI, CVI",
    status: "designed",
    domain: "Poincaré + chaotic HRV",
    source: "FLIRT",
    menopause:
      "Sensitive to overall autonomic load. Early indicator for cardiovascular risk shifts post-menopause. Same FLIRT pathway as above; not yet asserted."
  },
  {
    feature: "Sleep fragmentation, IBI entropy",
    status: "designed",
    domain: "Statistical HRV",
    source: "FLIRT",
    menopause:
      "Direct proxy for night sweats and disrupted sleep — the #1 patient-reported symptom in our research."
  },
  {
    feature: "EDA tonic / phasic decomposition",
    status: "designed",
    domain: "Electrodermal activity",
    source: "FLIRT (Empatica E4 archive, Phase 2)",
    menopause: "Hot-flash detection from skin conductance peaks."
  },
  {
    feature: "Activity counts, sedentary bouts",
    status: "designed",
    domain: "Accelerometer",
    source: "FLIRT",
    menopause: "Fatigue and activity regression — a quality-of-life signal payers care about."
  }
];

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 1 — Shipped",
    status: "prototype",
    duration: "Today",
    detail:
      "FLIRT-backed sliding-window HRV, dependency-light HRV fallback ported from DBDP, DBDP-derived test fixture committed, 20 unit tests passing across pause_ingest.convert + pause_ingest.features (including a closed-form RMSSD correctness check)."
  },
  {
    name: "Phase 2 — Next",
    status: "designed",
    duration: "2–3 weeks",
    detail:
      "Wire flirt.with_.empatica for Empatica E4 archive ingestion. Re-evaluate devicely once numpy 2.x support lands. Persist computed feature windows back to JupyterHealth Exchange as derivedFrom FHIR Observations."
  },
  {
    name: "Phase 3 — Open contribution",
    status: "future",
    duration: "Ongoing",
    detail:
      "Propose an Open mHealth schema for skin temperature (hot-flash signal). Contribute a menopause-specific feature module to DBDP. Publish HRV-and-menopause feature-importance benchmarks against pilot cohorts."
  }
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
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    detail:
      "The FHIR R5 substrate this feature layer composes with. Today: omh-shim + jupyterhealth-client integrated in pause_ingest; JHE persistence path is Phase 2.",
    status: "partial"
  },
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    detail:
      "The connectivity plane that will trigger DBDP feature compute on every ingest event and route the result back to JupyterHealth. Today: mocked Experience APIs at /api/mulesoft/*.",
    status: "designed"
  },
  {
    href: "/proposal/data",
    label: "Data inventory + strategy",
    detail:
      "Which datasets feed the moat. Public research corpora + the guideline corpus are wired today; wearable + EHR + claims are planned.",
    status: "partial"
  },
  {
    href: "/proposal/technology",
    label: "Technology choices",
    detail:
      "Full stack rationale, including why DBDP / FLIRT is the right feature layer — each layer status-pilled."
  },
  {
    href: "/demo/patient",
    label: "Federated patient record viewer",
    detail:
      "The dossier surfaces HRV / sleep / vasomotor composites today via mocked Data 360 calculated insights. In production these will be DBDP-computed feature Observations persisted in JHE.",
    status: "prototype"
  },
  {
    href: "https://www.dbdp.org/code-repository",
    label: "DBDP code repository",
    detail: "The upstream community we contribute back to.",
    external: true
  }
];

export default function DbdpIntegrationPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · DBDP feature engineering"
      title="From raw wearables to clinical menopause features"
      subtitle="Pause-Health.ai composes with the Digital Biomarker Discovery Pipeline (Duke University) for clinically grounded feature engineering from wearable signals. Today the FLIRT and DBDP HRV math is integrated in pause_ingest with 20 passing unit tests including a closed-form RMSSD correctness check; persistence back into JupyterHealth Exchange as derivedFrom FHIR Observations is Phase 2."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why DBDP, why now</p>
        <h2 className="proposal-section-title">Four reasons the feature layer is DBDP</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> wired in
          pause_ingest today (and asserted by tests where applicable) ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> committed
          choice, activates with Phase 2 or first design partner.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyDbdp.map((item) => (
            <article key={item.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{item.name}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The DBDP pieces we use</p>
        <h2 className="proposal-section-title">Three integrated today, one scoped Phase 2</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {dbdpPieces.map((piece) => (
            <article key={piece.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={piece.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{piece.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {piece.license}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{piece.role}</p>
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
        <p className="eyebrow">Feature catalog · per-row status</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What pause_ingest can produce — and what it actually asserts
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          All rows below are produced by the same{" "}
          <code>hrv_features_flirt</code> call in pause_ingest. The
          distinction the pill draws is whether Pause has its own
          assertion on the output — which matters for an investor or a
          clinical advisor reading the math. Persistence into JupyterHealth
          Exchange as <code>derivedFrom</code> FHIR Observations is Phase 2
          for every row.
        </p>
        <p
          style={{
            color: "var(--muted)",
            margin: "0.5rem 0 0.6rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> verified
          in pause_ingest (closed-form or happy-path tests) ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> produced
          by the same call but not yet asserted by Pause tests.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
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
                    <StatusPill status={row.status} style={inlinePillStyle} />
                  </td>
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

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Verify the math claims in two clicks
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          Every claim on this page that says &quot;today&quot; or
          &quot;tested&quot; resolves to code in <code>pause_ingest/</code>.
          The closed-form RMSSD test is at{" "}
          <code>pause_ingest/tests/test_features.py</code> ·{" "}
          <code>test_fallback_alternating_ibi_has_closed_form_rmssd</code>.
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
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/pause_ingest"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            pause_ingest source on GitHub →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/pause_ingest/tests"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Tests directory (20 passing) →
          </a>
          <a
            href="https://github.com/im-ethz/flirt"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            FLIRT upstream repo →
          </a>
          <a
            href="/api/mulesoft/patient/anika-patel/timeline"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            FHIR R5 Bundle with derivedFrom feature →
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Status by phase</p>
        <h2 className="proposal-section-title">From the Phase 1 baseline to upstream contributions</h2>
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
        <p className="eyebrow">Why this earns trust</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four properties of the feature layer
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Open standards, end to end</span>
            <strong style={{ fontWeight: 500 }}>
              Open mHealth at the schema layer, FHIR R5 at the storage layer,
              DBDP / FLIRT at the feature layer. Nothing proprietary in the
              data pipeline; only the menopause model is ours.
            </strong>
          </li>
          <li>
            <span>Math you can audit</span>
            <strong style={{ fontWeight: 500 }}>
              The RMSSD / SDNN / pNN50 reference implementation is{" "}
              <code>hrv_time_domain_fallback</code> in pause_ingest with
              explicit unit annotations and a closed-form correctness test.
              Clinical advisors can read ~50 lines and verify the math.
            </strong>
          </li>
          <li>
            <span>Compounding leverage</span>
            <strong style={{ fontWeight: 500 }}>
              When a new DBDP module ships — sleep staging, glucose
              variability, signal alignment — we adopt it. The platform gets
              better while our team stays small.
            </strong>
          </li>
          <li>
            <span>Honest engineering</span>
            <strong style={{ fontWeight: 500 }}>
              Where a dependency is not ready (devicely on Python 3.13), we
              say so in the doc, scope it to a phase, and raise a loud
              RuntimeError at runtime — asserted by{" "}
              <code>test_empatica_ingestion_raises_phase2_error</code>. No
              silent gaps.
            </strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where DBDP sits in the bigger picture</h2>
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
