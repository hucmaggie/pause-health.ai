import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Data Inventory & Strategy",
  description:
    "Available menopause datasets, our data strategy, and the proprietary data moats Pause-Health.ai is accruing. Each row labels whether the data is wired in prototype, partially live (shape live, values still synthetic / partner-feed-shape), or planned for design-partner-stage integration. Includes the 2,015-row NPPES-derived provider directory with three-state license-sanction filtering live today.",
  path: "/proposal/data",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Data inventory and strategy — Pause-Health.ai investor brief."
});

/**
 * Data inventory + strategy — Arc A polish pass.
 *
 * Refactored onto the shared <StatusPill> component
 * (components/status-pill.tsx). The previous inline pill component
 * used a local "today" / "planned" vocabulary; we now use the
 * canonical "prototype" (label: Wired in prototype) and "planned"
 * keys so the reader meets the same vocabulary on every page of
 * the deck.
 *
 * Two rows are `prototype` (research corpora + guideline corpus —
 * both wired into the prototype grounding store today). The rest are
 * `planned` because they live downstream of design-partner contracts.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const inventory: Array<{
  status: StatusPillStatus;
  source: string;
  type: string;
  volume: string;
  examples: string;
  why_it_matters: string;
}> = [
  {
    status: "planned",
    source: "EHR clinical data",
    type: "FHIR R5 via JupyterHealth Exchange + SMART-on-FHIR",
    volume:
      "Structured + unstructured visit notes for ~250M US patients across Epic, Cerner — accessed through design-partner connections, not held by Pause.",
    examples: "Vitals, problem list, medications, lab panels (FSH, estradiol, TSH), encounter notes",
    why_it_matters:
      "The longitudinal clinical truth set. Where we measure outcomes and where guidelines are applied. Federated access first; Pause does not centralize PHI by default (see /proposal/integration)."
  },
  {
    status: "planned",
    source: "Claims data",
    type: "X12 837/835, plus partner data lakes",
    volume:
      "Visit, procedure, prescription, and ER utilization across commercial + MA plans — accessed via payer design-partner contracts.",
    examples: "ICD-10 N95.x, CPT for endometrial biopsy / DEXA, RX fills for HT/SSRIs/SNRIs",
    why_it_matters:
      "Quantifies avoidable utilization and the economic case for the payer-side product. Required for the PMPM contracting motion on /proposal/customers."
  },
  {
    status: "partial",
    source: "Patient-generated wearables",
    type: "HealthKit / Health Connect, Oura, Whoop, Garmin",
    volume:
      "Continuous HRV, sleep, heart rate, skin temperature, cycle data — exposed today through Salesforce Data Cloud Calculated Insights (HRV z-score, vasomotor burden, sleep disruption) on the trailsignup tenant; demo-cohort values are seeded CIs until first-party ingestion lands.",
    examples: "Sleep fragmentation, resting HR drift, nocturnal heat events, HRV decline patterns",
    why_it_matters:
      "Earliest and most sensitive signal for perimenopause onset — usually invisible to clinicians. Phase 2 grounding is LIVE: the endpoint reports 'Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights' on every call, and each insight falls back to its intake baseline independently if a DC call fails. Phase 2-bis swaps the demo-cohort seeded CIs for real JHE/DBDP wearable math via the same client + token flow (see PHASE_2_ACTIVATION_CHECKLIST.md)."
  },
  {
    status: "prototype",
    source: "Provider directory (NPPES-derived)",
    type: "Public-domain · NPPES + Census + state sanction overlays",
    volume:
      "2,015 menopause-relevant providers across 55 states and 532 ZIP-3 prefixes (15 MSCP-certified, 2,000 menopause-relevant non-certified). Refreshed by the provider_ingest pipeline against the monthly CMS NPPES bulk file (~9.6M rows) in ~1m50s.",
    examples: "Distance from patient ZIP, MSCP/NCMP credential, six NPPES board-cert / multi-specialty signals, telehealth + accepting-new-patients flags, license disposition (CA Medi-Cal + NY OPMC + TX TMB checked at build), insurance acceptance",
    why_it_matters:
      "Sanctioned providers (1,720 dropped in the June 2026 build) cannot surface in any agent recommendation, /api/mulesoft/providers response, or the /provider UI — the patient-safety filter is verifiable per response under provenance.dataset.sanctionedFilteredBySource. The Care Router consumes the same query function the agent and /provider use, so triage and the directory stay in lockstep."
  },
  {
    status: "planned",
    source: "Patient-reported outcomes (PROs)",
    type: "Validated instruments + adaptive intake",
    volume:
      "MRS (Menopause Rating Scale), GCS, PHQ-9, GAD-7, plus structured symptom diaries — collected via the intake experience in production deployments.",
    examples: "Vasomotor severity, sleep quality, mood, cognition, sexual function, urogenital",
    why_it_matters:
      "Captures the symptoms that drive lived experience but rarely make it into the EHR. The intake page (/demo/intake) is the surface this lands on."
  },
  {
    status: "prototype",
    source: "Public research corpora",
    type: "Open / licensed",
    volume: "SWAN, UK Biobank menopause cohort, NHS, PubMed, ClinicalTrials.gov",
    examples: "Trajectory data, hormone-therapy outcomes, cardiovascular risk modeling",
    why_it_matters:
      "Pretraining and clinical evaluation; provides population-level priors. Surfaced today as grounding sources in the federated retrieval layer."
  },
  {
    status: "prototype",
    source: "Specialty guideline corpus",
    type: "Structured + retrievable",
    volume:
      "NAMS / Menopause Society, ACOG, IMS, AACE position statements; menopause hormone-therapy guidance — curated in the prototype grounding store.",
    examples: "Evidence levels, contraindications, dosing, monitoring intervals",
    why_it_matters:
      "Grounding source for every recommendation — explainability requires it. Live in the prototype: each Care Router decision cites it (see /demo/agent-fabric)."
  }
];

const dataStrategy = [
  {
    pillar: "FHIR-native by default",
    description:
      "All ingestion conforms to FHIR R5 resources via JupyterHealth Exchange. No bespoke data formats. SMART-on-FHIR auth means we plug into Epic and Cerner without bespoke integration projects (see /proposal/integration)."
  },
  {
    pillar: "Patient-side first, EHR-side second",
    description:
      "We begin collection on the patient side (wearables + PROs) before the visit, then merge in EHR context. This produces a fuller picture than starting from the EHR alone."
  },
  {
    pillar: "De-identified product telemetry",
    description:
      "Every AI recommendation is logged in the Agent Fabric trace plane with inputs, outputs, clinician acceptance, and downstream outcome. This dataset compounds in value monthly (live today at /demo/agent-fabric)."
  },
  {
    pillar: "Outcomes registry",
    description:
      "With each design-partner contract, we co-build a clinical outcomes registry — diagnostic time, symptom resolution, utilization deltas, HT adoption and adherence. Operationalized via the Agent Fabric trace plane (/proposal/agent-fabric)."
  },
  {
    pillar: "Federated where required",
    description:
      "For health systems unwilling to move data, our inference layer runs federated against an in-VPC deployment. Model weights leave; PHI does not. This is the default posture, not the exception."
  }
];

const moats = [
  {
    moat: "Acceptance + outcomes telemetry",
    detail:
      "Every recommendation accepted, edited, or rejected by a clinician — paired with the eventual outcome — becomes training signal. Competitors without deployments can't replicate this."
  },
  {
    moat: "Multi-modal patient timeline",
    detail:
      "Wearable + PRO + EHR merged on a per-patient timeline is rare and expensive to assemble. The longer a patient is on Pause, the more valuable this representation becomes."
  },
  {
    moat: "Specialty guideline grounding library",
    detail:
      "A curated, regularly updated, retrievable corpus of menopause clinical guidelines mapped to structured concepts. Hard to build, harder to keep current. Live today; see /demo/intake for citations in action."
  },
  {
    moat: "Provider relationships and EHR install base",
    detail:
      "Each Epic / Cerner deployment takes time and trust. The N-th install is dramatically faster than the first, while remaining a meaningful barrier for newcomers."
  },
  {
    moat: "Sanction-filtered, menopause-scored provider graph",
    detail:
      "Vendor provider graphs (Definitive Healthcare, IQVIA OneKey, etc.) are excellent for general healthcare but don't score for menopause and don't run a build-time sanction filter against state license registries. Pause's directory unions CMS NPPES + The Menopause Society MSCP overlay (synthetic + self-reported NPPES today; licensed feed once partnership lands) + three state license-sanction overlays (CA Medi-Cal, NY OPMC, TX TMB — 1,720 sanctioned candidates dropped in the June 2026 build) + Census ZCTA centroids for distance ranking + six NPPES service-line signals. Live today (see /provider). Each refresh recompounds the moat without requiring a paid feed."
  }
];

export default function DataPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Data Inventory & Insights: building the menopause data substrate"
      subtitle="Menopause care has rich, fragmented data. The opportunity isn't to collect more — it's to assemble what already exists into a clinically usable, longitudinal patient picture, and compound a proprietary outcomes layer on top. Each inventory row is tagged Today (in-hand or surfaced in prototype) or Planned (design-partner-stage integration)."
    >
      <section>
        <p className="eyebrow">Data inventory · with status pills</p>
        <h2 className="proposal-section-title">What we work with today vs what we&apos;ll integrate</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> in-hand or
          wired in the prototype today ·{" "}
          <StatusPill status="partial" style={inlinePillStyle} /> shape live,
          values still synthetic / partner-feed-shape ·{" "}
          <StatusPill status="planned" style={inlinePillStyle} /> integration
          unlocks at design-partner stage.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {inventory.map((d) => (
            <article key={d.source} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={d.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{d.source}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {d.type}
              </p>
              <ul className="metric-list">
                <li>
                  <span>Volume / coverage</span>
                  <strong style={{ fontWeight: 500 }}>{d.volume}</strong>
                </li>
                <li>
                  <span>Representative signals</span>
                  <strong style={{ fontWeight: 500 }}>{d.examples}</strong>
                </li>
                <li>
                  <span>Why it matters</span>
                  <strong style={{ fontWeight: 500 }}>{d.why_it_matters}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data strategy</p>
        <h2 className="proposal-section-title">Five pillars — how the substrate is assembled</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {dataStrategy.map((s) => (
            <article key={s.pillar} className="card">
              <h3>{s.pillar}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{s.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data moats</p>
        <h2 className="proposal-section-title">What compounds as we ship</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {moats.map((m) => (
            <article key={m.moat} className="card">
              <h3>{m.moat}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{m.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Governance and trust</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The compliance posture, phased
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Compliance posture</span>
            <strong style={{ fontWeight: 500 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <StatusPill status="planned" style={inlinePillStyle} />
                <span>HIPAA controls + HITRUST CSF on the implementation roadmap; SOC 2 Type II in Year 2.</span>
              </span>
            </strong>
          </li>
          <li>
            <span>Data residency</span>
            <strong style={{ fontWeight: 500 }}>
              US-only by default; per-customer VPC available for federated deployments. Federated-first matches /proposal/dbdp.
            </strong>
          </li>
          <li>
            <span>Patient consent</span>
            <strong style={{ fontWeight: 500 }}>
              Granular, withdrawable, separated per data domain (clinical, wearable, PRO).
            </strong>
          </li>
          <li>
            <span>AI auditability</span>
            <strong style={{ fontWeight: 500 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <StatusPill status="prototype" style={inlinePillStyle} />
                <span>
                  Every recommendation reproducible: inputs, model version, retrieval set, output. Trace plane live at{" "}
                  <a href="/demo/agent-fabric">/demo/agent-fabric</a>.
                </span>
              </span>
            </strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where the data substrate is operationalized</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/integration">Integration architecture</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              FHIR R5 via JupyterHealth Exchange, SMART-on-FHIR auth, federated-first posture.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP / federated data plane</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the in-VPC federated execution model works in detail.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/provider-graph">Provider graph</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How clinician + facility data layers on top of FHIR.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The trace plane backing the AI-auditability commitment. <a href="/demo/agent-fabric">See it live</a>.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/strategy">Strategy · the five moats</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the outcomes registry compounds the data-moat claim above —
              status-pilled per stage.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/technology">Technology stack</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The full stack-layer view, each with its own status pill.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
