import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Provider Graph",
  description:
    "How Pause-Health.ai builds a defensible menopause provider graph from CMS NPPES, state board data, and clinic-site signal — without touching restricted directories.",
  path: "/proposal/provider-graph",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Provider graph strategy — Pause-Health.ai investor brief."
});

const sources = [
  {
    name: "CMS NPPES (NPI Registry)",
    type: "Public domain · bulk download + REST API",
    detail:
      "All US healthcare providers with an NPI. Includes taxonomy codes, primary practice address, license state, and authoritative provider identity. ~6M records, refreshed weekly.",
    purpose:
      "Authoritative provider identity. The NPI is the join key that everything else hangs off."
  },
  {
    name: "State medical board licensure",
    type: "Public records · API where available (CA, TX, NY, FL), bulk for the rest",
    detail:
      "Active license status, license history, disciplinary actions. Variable schema per state; we normalize into a single internal model.",
    purpose:
      "Filter to currently-licensed providers. Surface disciplinary actions as a downweight in our trust score."
  },
  {
    name: "NPPES taxonomy filter",
    type: "Derived",
    detail:
      "Narrow ~6M providers to ~80K candidates by filtering for taxonomies relevant to menopause care: OB/GYN, Family Medicine, Internal Medicine, Endocrinology, Nurse Practitioner (women's health), Certified Nurse Midwife, Physician Assistant (women's health).",
    purpose:
      "Cuts the candidate set by ~75× before we spend any compute on clinic-site analysis."
  },
  {
    name: "Clinic-site service detection",
    type: "Derived · Pause-built",
    detail:
      "For each candidate clinic, fetch the public clinic website and run structured-data extraction for explicit mentions of menopause, HRT, perimenopause, hormone replacement, vasomotor, and related services. Caching, rate-limiting, robots.txt-respecting.",
    purpose:
      "Distinguishes general OB/GYNs from clinicians actually marketing menopause services."
  },
  {
    name: "Trusted third-party verification",
    type: "Public-facing third-party directories",
    detail:
      "Cross-check against certifiedmenopause.com and similar verified-provider sites for additional credibility signal. We never republish; we only use as a sanity check against our own scoring.",
    purpose:
      "Reduce false positives in our scoring. Catch credential-holders we might have missed."
  },
  {
    name: "Outcomes signal (closed loop, Phase 2)",
    type: "Pause-internal",
    detail:
      "Once we have referrals flowing through Pause, the patient and provider outcomes from those referrals become the strongest possible scoring signal — and one no one else has.",
    purpose:
      "The actual moat. Every successful referral makes the graph better; every poor one downweights the destination."
  }
];

const scoring = [
  {
    factor: "Credential signal",
    weight: "Highest",
    detail:
      "MSCP / NCMP / ABMS board certification in OB/GYN, IM, Endo, or FM. Self-attested in pilot; verified against primary sources before any pilot signs."
  },
  {
    factor: "Service-mention signal",
    weight: "High",
    detail:
      "Clinic-site explicitly lists menopause / HRT / perimenopause services. Catches the clinicians who self-identify as menopause-serious."
  },
  {
    factor: "License standing",
    weight: "Gating",
    detail:
      "Active license, no current disciplinary action. Anything below this is a hard exclude, not a downweight."
  },
  {
    factor: "Geographic coverage",
    weight: "Medium",
    detail:
      "Distance to patient, accepting-new-patients flag (where available), insurance match. Practical referability."
  },
  {
    factor: "Outcomes feedback",
    weight: "Compounding",
    detail:
      "Pause's own referral outcomes data. Starts at zero, grows monotonically with usage. This is what eventually outranks every other signal."
  }
];

const considerations = [
  {
    name: "Why NPPES is the right substrate",
    detail:
      "It is public domain, refreshed weekly, and used by every other healthcare data product. There is no licensing complication and no terms-of-use trap."
  },
  {
    name: "Why we don't just buy a vendor graph",
    detail:
      "The commercial provider graphs (Definitive Healthcare, IQVIA OneKey, etc.) are excellent for general healthcare. None of them score for menopause specifically. We would still need to build the menopause overlay — so we just build the whole thing."
  },
  {
    name: "Why this is a moat",
    detail:
      "Once Pause is producing referrals at scale, the outcome data we capture from each referral is uncopyable. The graph improves with every patient we serve. New entrants have to start at zero."
  },
  {
    name: "Compliance posture",
    detail:
      "Everything we ingest is public information. We respect robots.txt and rate limits. We carry provenance for every field we surface. We expose a provider opt-out mechanism."
  }
];

const phases = [
  {
    name: "Phase 0 — Decide and design",
    duration: "Now",
    detail:
      "Decision documented (this page). Data model for the provider graph defined. Pause-internal review of compliance posture."
  },
  {
    name: "Phase 1 — NPPES + taxonomy filter",
    duration: "2 weeks",
    detail:
      "Ingest the NPPES bulk dump, normalize, filter to menopause-relevant taxonomies. Output: ~80K candidate provider rows in our internal store."
  },
  {
    name: "Phase 2 — State license + service detection",
    duration: "4–6 weeks",
    detail:
      "Wire the top-volume state board sources. Run the clinic-site service detector against the candidate set. Score and rank. Output: a ranked menopause provider list with provenance."
  },
  {
    name: "Phase 3 — Closed-loop scoring",
    duration: "After first 1,000 referrals",
    detail:
      "Pull patient and provider outcomes from Pause's own data. Re-weight the scoring model. From here, the graph self-improves."
  }
];

export default function ProviderGraphPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Provider graph"
      title="Building a defensible menopause provider graph"
      subtitle="Pause-Health.ai constructs its own menopause provider graph from CMS NPPES, state board data, and clinic-site service detection — fully public-source, ToS-clean, and compounding with every referral we run."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why this exists</p>
        <article className="card">
          <p>
            The Menopause Society&apos;s &quot;Find a Menopause Practitioner&quot; directory
            is the field&apos;s best public quality signal, but it is{" "}
            <strong>not licensable today</strong>: their terms of use explicitly prohibit
            scraping, republishing, and embedding. Even if we eventually negotiate access
            (see <a href="/proposal/menopause-society">the Menopause Society strategy</a>),
            MSCPs are a small subset of the total menopause-relevant provider pool.
          </p>
          <p style={{ marginTop: "0.6rem" }}>
            Pause needs a complete, defensible provider graph anyway. We build it from
            public-domain primary sources, score it with our own model, and let it
            compound through closed-loop outcomes data. This is a long-term moat.
          </p>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data sources</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {sources.map((source) => (
            <article key={source.name} className="card">
              <h3>{source.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {source.type}
              </p>
              <p>{source.detail}</p>
              <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
                <li>
                  <span>Purpose</span>
                  <strong style={{ fontWeight: 500 }}>{source.purpose}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Scoring model</p>
        <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Factor</th>
                <th>Weight</th>
                <th>What it captures</th>
              </tr>
            </thead>
            <tbody>
              {scoring.map((row) => (
                <tr key={row.factor}>
                  <td>
                    <strong>{row.factor}</strong>
                  </td>
                  <td>{row.weight}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Strategic considerations</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {considerations.map((c) => (
            <article key={c.name} className="card">
              <h3>{c.name}</h3>
              <p>{c.detail}</p>
            </article>
          ))}
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
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/menopause-society">The Menopause Society strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Where this graph sits relative to MSCP referral and the eventual partnership.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data">Data inventory and strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the provider graph composes with our clinical data and outcomes registry.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/competition">Competition</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the closed-loop scoring layer differentiates Pause from generalist EHR AI
              and DTC menopause brands.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
