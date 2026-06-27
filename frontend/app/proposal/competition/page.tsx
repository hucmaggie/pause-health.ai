import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Competition",
  description:
    "Competitive landscape across DTC menopause brands, employer benefits, and clinical AI — and where Pause-Health.ai differentiates. Capability matrix tags every Pause claim with today/planned status.",
  path: "/proposal/competition",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Competition — Pause-Health.ai investor brief."
});

/**
 * Competition brief — Arc A polish pass.
 *
 * The biggest credibility risk on this page was a capability matrix
 * that read "Yes" all the way down the Pause-Health.ai column —
 * which an experienced clinical-AI investor would immediately deflate
 * for a pre-revenue prototype. Three things changed:
 *
 *   1. Every "Pause" capability is now tagged with a small status
 *      pill: shipped today vs partial vs planned. The pill draws
 *      from the same vocabulary used on /proposal/strategy and
 *      /proposal/technology, so plan-vs-reality reads consistently
 *      across the deck.
 *   2. A new "What we don't claim today" card sits underneath the
 *      matrix. It explicitly lists capabilities a sophisticated
 *      reader will look for and pre-empts the assumption.
 *   3. A "Read deeper" cross-link footer connects out to the
 *      architecture briefs that justify each column.
 */

/**
 * The Pause-column status keys are a strict subset of the canonical
 * vocabulary in components/status-pill.tsx. Kept as a type alias so
 * the `positioning` table data refuses bad statuses at compile time.
 */
type PauseStatus = "shipped" | "partial" | "planned";

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const landscape = [
  {
    category: "DTC menopause brands",
    examples: "Midi Health, Evernow, Alloy, Winona, Versalie",
    audience: "Patients directly (subscription telehealth + RX)",
    strength:
      "Brand recognition and patient demand. Beautiful consumer UX. Have de-stigmatized menopause conversations.",
    weakness:
      "Cash-pay or limited insurance; capture only the ~10% of women willing to pay out-of-pocket. No integration with the patient's actual longitudinal record.",
    overlap_with_pause: "Low — different buyer, different funding source"
  },
  {
    category: "Employer-benefits platforms",
    examples: "Maven Clinic, Carrot, Progyny, Kindbody",
    audience: "Self-insured employers, increasingly carrying menopause",
    strength:
      "Strong distribution into Fortune 500. Comprehensive women's health benefits across fertility, maternity, menopause.",
    weakness:
      "Menopause is one of many lines; not the focus. Most rely on a network of contracted clinicians rather than augmenting the patient's existing provider.",
    overlap_with_pause:
      "Medium — we could plug INTO these platforms as the clinical decision layer rather than competing on benefits brand"
  },
  {
    category: "Specialty menopause clinics",
    examples: "Independent NAMS-certified practices, hospital midlife clinics",
    audience: "Patients with means and motivation to seek out a specialist",
    strength:
      "Deep expertise. Trusted relationships. Often early adopters of new tooling.",
    weakness:
      "Capacity-limited; thousands exist, but cannot scale to the ~50M women who need this care.",
    overlap_with_pause:
      "Low — they are buyers, not competitors. Pause amplifies their reach into general OB/GYN and primary care."
  },
  {
    category: "EHR-embedded clinical AI",
    examples: "Abridge, Suki, DeepScribe, Nuance DAX",
    audience: "Health systems, broadly",
    strength:
      "Strong EHR integration story. Documented productivity wins.",
    weakness:
      "Horizontal: scribes and notes, not condition-specific clinical reasoning. Not a menopause product.",
    overlap_with_pause:
      "Adjacent — coexists. We integrate into the same EHRs but solve a different problem (clinical reasoning, not transcription)."
  },
  {
    category: "Disease-specific clinical AI",
    examples: "Cleerly (cardiology), K Health (primary care), Aidoc (radiology)",
    audience: "Health systems and specialty service lines",
    strength:
      "Proves the model: vertical AI products that win because they go deep into one condition.",
    weakness: "None are focused on menopause — the category leader is open.",
    overlap_with_pause:
      "Validating precedent — establishes the buying motion for condition-specific provider AI."
  },
  {
    category: "Generalist LLM offerings",
    examples: "Foundation-model providers selling 'healthcare' SKUs",
    audience: "Health systems experimenting",
    strength: "Powerful base models. Cheap experimentation surface.",
    weakness:
      "No menopause-specific grounding, no clinical workflow, no evidence base, no integration. Pilots stall.",
    overlap_with_pause:
      "Low — they're a substrate, not a competitor. We build on top of best-in-class foundation models."
  }
];

type CapabilityRow = {
  capability: string;
  pause: { status: PauseStatus; label: string; detail?: string };
  dtc: string;
  employer: string;
  ehrAi: string;
  generalist: string;
};

const positioning: CapabilityRow[] = [
  {
    capability: "Menopause clinical depth",
    pause: {
      status: "partial",
      label: "Purpose-built",
      detail:
        "Grounding corpus + Care Router are menopause-scoped; clinical depth deepens as guideline corpus expands."
    },
    dtc: "Limited — visit-level",
    employer: "Partial — multi-line",
    ehrAi: "No",
    generalist: "No"
  },
  {
    capability: "EHR-integrated (FHIR / SMART)",
    pause: {
      status: "planned",
      label: "Roadmap",
      detail:
        "Salesforce-side prototype today; SMART-on-FHIR Epic + Cerner apps are roadmap (see /proposal/integration)."
    },
    dtc: "No",
    employer: "No",
    ehrAi: "Yes",
    generalist: "No"
  },
  {
    capability: "Wearable + PRO integration",
    pause: {
      status: "planned",
      label: "Roadmap",
      detail:
        "Dossier surfaces wearable signals via mocked Data 360 today; HealthKit/Health Connect ingestion is roadmap."
    },
    dtc: "Partial",
    employer: "Partial",
    ehrAi: "No",
    generalist: "No"
  },
  {
    capability: "Explainable, evidence-grounded recommendations",
    pause: {
      status: "shipped",
      label: "Guideline retrieval, live",
      detail:
        "Wired in prototype: every dossier + routing decision cites the federated grounding source (Salesforce, Data 360, mocked SWAN/biobank). Try /demo/intake."
    },
    dtc: "No",
    employer: "No",
    ehrAi: "Partial",
    generalist: "No"
  },
  {
    capability: "Sold to providers + payers (not patients)",
    pause: {
      status: "shipped",
      label: "Yes — B2B by design",
      detail:
        "GTM motion targets IDNs, value-based payers, and AMCs (see /proposal/customers). No DTC."
    },
    dtc: "No",
    employer: "Employer-paid",
    ehrAi: "Yes",
    generalist: "Variable"
  },
  {
    capability: "Outcomes telemetry / continuous learning",
    pause: {
      status: "partial",
      label: "Trace plane shipped",
      detail:
        "Agent Fabric trace plane logs every Care Router decision today (/demo/agent-fabric). Outcomes registry is design-partner-stage (see /proposal/agent-fabric and /proposal/strategy)."
    },
    dtc: "Limited",
    employer: "Limited",
    ehrAi: "Limited",
    generalist: "No"
  }
];

const differentiators = [
  "Vertical depth in menopause that horizontal scribes and generalist LLMs cannot reach.",
  "B2B provider + payer go-to-market — durable contracts vs. churn-prone DTC subscriptions.",
  "Patient timeline that merges wearable, PRO, and EHR data into a single clinical picture.",
  "Explainability by construction — every recommendation cites the guideline and the data point.",
  "Outcomes registry built into every deployment — compounding evidence advantage."
];

const honestDisclaimers = [
  {
    label: "We do not have FDA-cleared software",
    detail:
      "Our roadmap targets clinical-decision-support that is intentionally non-diagnostic and stays inside CDS Hooks / FDA Software-Functions guidance. Class II/III claims would be Year 2+."
  },
  {
    label: "We are not a live SMART-on-FHIR Epic app today",
    detail:
      "The integrated-EHR posture is a roadmap commitment. Today the prototype runs against Salesforce + mocked Data 360 (see /proposal/integration)."
  },
  {
    label: "We do not have first-party outcomes data",
    detail:
      "The outcomes registry is a design-partner-stage artifact. Year 1 evidence is co-built with first IDNs/payers; we don't pretend to have it on day one."
  },
  {
    label: "We are not a competitor to scribes — we coexist",
    detail:
      "Abridge / Suki / Nuance solve documentation. We solve menopause-specific clinical reasoning. Both can install in the same system without conflict."
  },
  {
    label: "We are pre-revenue and pre-design-partner",
    detail:
      "Year 0–3 milestones, status-tagged per stage, are detailed at /proposal/strategy. No signed customers yet."
  }
];

export default function CompetitionPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Competition: the landscape and where we win"
      subtitle="The menopause space is crowded on the patient side and empty on the provider side. Pause-Health.ai claims the provider/payer category before incumbents can pivot in. Every claim about our own capability carries a today/planned pill so you can read plan-vs-reality at a glance."
    >
      <section>
        <p className="eyebrow">Landscape</p>
        <h2 className="proposal-section-title">Six categories — and where each sits relative to us</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {landscape.map((c) => (
            <article key={c.category} className="card">
              <h3>{c.category}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {c.examples}
              </p>
              <ul className="metric-list metric-list-stacked">
                <li>
                  <span>Primary audience</span>
                  <strong style={{ fontWeight: 500 }}>{c.audience}</strong>
                </li>
                <li>
                  <span>Strength</span>
                  <strong style={{ fontWeight: 500 }}>{c.strength}</strong>
                </li>
                <li>
                  <span>Weakness</span>
                  <strong style={{ fontWeight: 500 }}>{c.weakness}</strong>
                </li>
                <li>
                  <span>Overlap with Pause</span>
                  <strong style={{ fontWeight: 500 }}>{c.overlap_with_pause}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Capability matrix · with status pills on Pause</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What we have today, what is roadmap
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="shipped" style={inlinePillStyle} /> wired in
          prototype today ·{" "}
          <StatusPill status="partial" style={inlinePillStyle} /> partial today ·{" "}
          <StatusPill status="planned" style={inlinePillStyle} /> roadmap /
          design-partner stage.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Pause-Health.ai</th>
                <th>DTC menopause</th>
                <th>Employer benefits</th>
                <th>EHR clinical AI</th>
                <th>Generalist LLM</th>
              </tr>
            </thead>
            <tbody>
              {positioning.map((row) => (
                <tr key={row.capability}>
                  <td>{row.capability}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <span>
                        <StatusPill status={row.pause.status} style={inlinePillStyle} />
                        <strong>{row.pause.label}</strong>
                      </span>
                      {row.pause.detail ? (
                        <span
                          style={{
                            color: "var(--muted)",
                            fontSize: "0.82rem",
                            lineHeight: 1.5
                          }}
                        >
                          {row.pause.detail}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{row.dtc}</td>
                  <td>{row.employer}</td>
                  <td>{row.ehrAi}</td>
                  <td>{row.generalist}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why we win</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The five compounding edges
        </h2>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {differentiators.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="card"
        style={{
          marginTop: "1.5rem",
          borderLeft: "3px solid var(--brand)"
        }}
      >
        <p className="eyebrow">What we don&apos;t claim today</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The boundaries of our story
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          A sophisticated reader will pattern-match a pre-revenue
          clinical-AI deck against three over-claims. We name them
          up front instead of getting asked.
        </p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {honestDisclaimers.map((d) => (
            <li key={d.label}>
              <span>{d.label}</span>
              <strong style={{ fontWeight: 500 }}>{d.detail}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">How the matrix lines up with the architecture</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/technology">Technology stack</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Per-layer status pills on every stack claim — model, data,
              fabric, frontend.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/integration">Integration architecture</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the SMART-on-FHIR commitment is structured, and what is
              live vs roadmap.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The trace-plane that backs the &ldquo;outcomes telemetry&rdquo; row
              of the matrix. <a href="/demo/agent-fabric">See the live trace</a>.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/strategy">Strategy · moats + outcomes registry</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the outcomes registry compounds into the moat we claim,
              with status pills per stage.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/customers">Customer selection</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Who the matrix is written for — IDNs, value-based payers, AMCs.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
