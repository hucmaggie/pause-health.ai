import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Provider Graph",
  description:
    "How Pause-Health.ai plans to build a defensible menopause provider graph from CMS NPPES, state board data, and clinic-site signal. Today the directory is a hand-curated synthetic slice served behind the Experience API contract; the ingestion pipeline is designed, not built.",
  path: "/proposal/provider-graph",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Provider graph strategy — Pause-Health.ai investor brief."
});

/**
 * Provider graph brief — Arc B polish pass.
 *
 * The previous version reads end-to-end in present tense -- "Pause
 * constructs its own menopause provider graph from CMS NPPES, state
 * board data, and clinic-site service detection" -- as if the
 * ingestion + scoring pipeline were running. In reality, the
 * provider directory today is a hand-curated synthetic slice of ~4
 * providers in frontend/lib/mulesoft-mocks.ts, exposed through:
 *
 *   - GET /api/mulesoft/providers (mocked Experience API)
 *   - MCP tool: find_menopause_providers
 *
 * The Experience API contract (zip filter, menopauseOnly filter,
 * provenance block) is stable. The data behind it is not real.
 *
 * Four moves:
 *
 *   1. Subtitle rewritten to lead with the prototype reality
 *      (Experience API contract live with synthetic data) and the
 *      planned ingestion pipeline (NPPES / state boards / clinic-
 *      site detection).
 *
 *   2. NEW "Today's reality" card at the top of the page so the
 *      reader anchors on the prototype state before the rest of the
 *      page reads as a plan.
 *
 *   3. Per-card StatusPill on sources (6 cards) and considerations
 *      (4 cards). Every source is `designed` today (NPPES not
 *      ingested, state boards not wired, clinic-site detector not
 *      built). Outcomes signal stays `future`.
 *
 *   4. Per-row StatusPill on scoring table and per-card pills on
 *      phases. Scoring is entirely designed (today's mock only has
 *      a boolean menopauseCertified flag). Phase 0 is `prototype`
 *      because the Experience API contract + MCP integration are
 *      shipped.
 *
 * Plus: "Touch the architecture" CTA panel with the live mocked
 * endpoint + MCP tool name. Normalized Read-deeper footer with
 * pills.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const sources: Array<{
  name: string;
  status: StatusPillStatus;
  type: string;
  detail: string;
  purpose: string;
}> = [
  {
    name: "CMS NPPES (NPI Registry)",
    status: "designed",
    type: "Public domain · bulk download + REST API",
    detail:
      "All US healthcare providers with an NPI. Includes taxonomy codes, primary practice address, license state, and authoritative provider identity. ~6M records, refreshed weekly. NPI numbers are the join key in the synthetic mock today; live ingestion is Phase 1.",
    purpose:
      "Authoritative provider identity. The NPI is the join key that everything else hangs off."
  },
  {
    name: "State medical board licensure",
    status: "designed",
    type: "Public records · API where available (CA, TX, NY, FL), bulk for the rest",
    detail:
      "Active license status, license history, disciplinary actions. Variable schema per state; we plan to normalize into a single internal model. No state board source is wired today.",
    purpose:
      "Filter to currently-licensed providers. Surface disciplinary actions as a downweight in our trust score."
  },
  {
    name: "NPPES taxonomy filter",
    status: "designed",
    type: "Derived",
    detail:
      "Plan: narrow ~6M providers to ~80K candidates by filtering for taxonomies relevant to menopause care — OB/GYN, Family Medicine, Internal Medicine, Endocrinology, Nurse Practitioner (women's health), Certified Nurse Midwife, Physician Assistant (women's health).",
    purpose:
      "Cuts the candidate set by ~75× before we spend any compute on clinic-site analysis."
  },
  {
    name: "Clinic-site service detection",
    status: "designed",
    type: "Derived · Pause-built",
    detail:
      "Plan: for each candidate clinic, fetch the public clinic website and run structured-data extraction for explicit mentions of menopause, HRT, perimenopause, hormone replacement, vasomotor, and related services. Caching, rate-limiting, robots.txt-respecting. No fetcher is running today.",
    purpose:
      "Distinguishes general OB/GYNs from clinicians actually marketing menopause services."
  },
  {
    name: "Trusted third-party verification",
    status: "designed",
    type: "Public-facing third-party directories",
    detail:
      "Plan: cross-check against certifiedmenopause.com and similar verified-provider sites for additional credibility signal. We never republish; we only use as a sanity check against our own scoring.",
    purpose:
      "Reduce false positives in our scoring. Catch credential-holders we might have missed."
  },
  {
    name: "Outcomes signal (closed loop)",
    status: "future",
    type: "Pause-internal · Phase 3",
    detail:
      "Once we have referrals flowing through Pause at scale, the patient and provider outcomes from those referrals become the strongest possible scoring signal — and one no one else has. Activates after the first ~1,000 referrals.",
    purpose:
      "The actual moat. Every successful referral makes the graph better; every poor one downweights the destination."
  }
];

const scoring: Array<{
  factor: string;
  status: StatusPillStatus;
  weight: string;
  detail: string;
}> = [
  {
    factor: "Credential signal",
    status: "designed",
    weight: "Highest",
    detail:
      "MSCP / NCMP / ABMS board certification in OB/GYN, IM, Endo, or FM. Self-attested in pilot; verified against primary sources before any pilot signs. Today's mock surfaces an MSCP credential string but no scoring logic is computed."
  },
  {
    factor: "Service-mention signal",
    status: "designed",
    weight: "High",
    detail:
      "Clinic-site explicitly lists menopause / HRT / perimenopause services. Catches the clinicians who self-identify as menopause-serious."
  },
  {
    factor: "License standing",
    status: "designed",
    weight: "Gating",
    detail:
      "Active license, no current disciplinary action. Anything below this is a hard exclude, not a downweight."
  },
  {
    factor: "Geographic coverage",
    status: "partial",
    weight: "Medium",
    detail:
      "Distance to patient, accepting-new-patients flag (where available), insurance match. ZIP-prefix filter is wired today against the synthetic slice; distance ranking + insurance match are Phase 2."
  },
  {
    factor: "Outcomes feedback",
    status: "future",
    weight: "Compounding",
    detail:
      "Pause's own referral outcomes data. Starts at zero, grows monotonically with usage. This is what eventually outranks every other signal."
  }
];

const considerations: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    name: "Why NPPES is the right substrate",
    status: "designed",
    detail:
      "It is public domain, refreshed weekly, and used by every other healthcare data product. There is no licensing complication and no terms-of-use trap. The NPI is the join key in our synthetic mock today, anticipating live ingestion."
  },
  {
    name: "Why we don't just buy a vendor graph",
    status: "designed",
    detail:
      "The commercial provider graphs (Definitive Healthcare, IQVIA OneKey, etc.) are excellent for general healthcare. None of them score for menopause specifically. We would still need to build the menopause overlay — so we just build the whole thing."
  },
  {
    name: "Why this will be a moat",
    status: "future",
    detail:
      "Once Pause is producing referrals at scale, the outcome data we capture from each referral is uncopyable. The graph improves with every patient we serve. New entrants have to start at zero. Compounding starts at Phase 3."
  },
  {
    name: "Compliance posture",
    status: "designed",
    detail:
      "Everything we plan to ingest is public information. We will respect robots.txt and rate limits. We will carry provenance for every field we surface (the mock already returns a provenance block listing source-of-truth attributions). We will expose a provider opt-out mechanism."
  }
];

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 0 — Contract + mock",
    status: "prototype",
    duration: "Today",
    detail:
      "Experience API contract live at /api/mulesoft/providers with zip + menopauseOnly + limit filters and a provenance block. MCP `find_menopause_providers` tool exposes the same contract to LLM clients. ~4 hand-curated synthetic providers behind the contract so the shape + filtering UX are real."
  },
  {
    name: "Phase 1 — NPPES + taxonomy filter",
    status: "designed",
    duration: "2 weeks",
    detail:
      "Ingest the NPPES bulk dump, normalize, filter to menopause-relevant taxonomies. Output: ~80K candidate provider rows in our internal store. Swaps in behind the existing Experience API contract — MCP clients keep working."
  },
  {
    name: "Phase 2 — State license + service detection",
    status: "designed",
    duration: "4–6 weeks",
    detail:
      "Wire the top-volume state board sources. Run the clinic-site service detector against the candidate set. Score and rank. Output: a ranked menopause provider list with provenance."
  },
  {
    name: "Phase 3 — Closed-loop scoring",
    status: "future",
    duration: "After first 1,000 referrals",
    detail:
      "Pull patient and provider outcomes from Pause's own data. Re-weight the scoring model. From here, the graph self-improves."
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
    href: "/proposal/menopause-society",
    label: "The Menopause Society strategy",
    detail:
      "Where this graph sits relative to MSCP referral and the eventual partnership. The two are complementary, not redundant.",
    status: "designed"
  },
  {
    href: "/proposal/data",
    label: "Data inventory + strategy",
    detail:
      "How the provider graph composes with our clinical data and the planned outcomes registry.",
    status: "partial"
  },
  {
    href: "/proposal/mcp",
    label: "Model Context Protocol server",
    detail:
      "The MCP tool find_menopause_providers wraps this exact Experience API contract today.",
    status: "prototype"
  },
  {
    href: "/proposal/competition",
    label: "Competition",
    detail:
      "How the closed-loop scoring layer will differentiate Pause from generalist EHR AI and DTC menopause brands once Phase 3 activates."
  }
];

export default function ProviderGraphPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Provider graph"
      title="Building a defensible menopause provider graph"
      subtitle="The Experience API contract for a menopause-aware provider directory is live behind /api/mulesoft/providers and the MCP find_menopause_providers tool today, with ~4 hand-curated synthetic providers behind it so the shape and filtering UX are real. The full ingestion pipeline (CMS NPPES + state boards + clinic-site service detection) is designed for Phases 1–2; the closed-loop outcomes layer is the long-term moat."
    >
      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Today's reality</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Contract first, data later — by design
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The provider directory is a hand-curated synthetic slice of
          menopause-credentialed clinicians (~4 rows in{" "}
          <code>frontend/lib/mulesoft-mocks.ts</code>) served through a
          production-shaped Experience API contract at{" "}
          <code>/api/mulesoft/providers</code> and exposed to LLM clients
          via the MCP <code>find_menopause_providers</code> tool. The
          contract — zip-prefix filter, <code>menopauseOnly</code> filter,
          <code>limit</code>, a provenance block listing
          source-of-truth attributions — is the part that survives. Phase 1
          swaps real NPPES-derived data in behind the same contract;
          MCP and frontend clients keep working unchanged.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.6rem" }}>
          <li>
            <span>What's wired today</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="prototype" style={inlinePillStyle} />
              Experience API contract + MCP tool + ZIP-prefix filtering
              against the synthetic slice.
            </strong>
          </li>
          <li>
            <span>What's still mocked</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="designed" style={inlinePillStyle} />
              Every data source listed below. NPPES is not ingested,
              state boards are not wired, the clinic-site detector
              is not built. The 4 synthetic rows carry MSCP credential
              strings but no scoring logic is computed.
            </strong>
          </li>
          <li>
            <span>What activates the moat</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="future" style={inlinePillStyle} />
              Closed-loop outcomes scoring kicks in after the first
              ~1,000 referrals flow through Pause.
            </strong>
          </li>
        </ul>
      </section>

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
            Pause needs a complete, defensible provider graph anyway. We plan to build it
            from public-domain primary sources, score it with our own model, and let it
            compound through closed-loop outcomes data. This is a long-term moat.
          </p>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data sources</p>
        <h2 className="proposal-section-title">All public-domain primary sources, end-to-end designed</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="designed" style={inlinePillStyle} />{" "}
          committed choice, activates with Phase 1 or 2 ingestion ·{" "}
          <StatusPill status="future" style={inlinePillStyle} />{" "}
          activates with Phase 3 once Pause referrals are flowing.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {sources.map((source) => (
            <article key={source.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={source.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{source.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {source.type}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{source.detail}</p>
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
        <p className="eyebrow">Scoring model · per-row status</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Five factors, all designed today
        </h2>
        <p style={{ marginTop: "0.4rem", color: "var(--muted)", fontSize: "0.92rem" }}>
          The synthetic slice today carries an MSCP credential string and
          a <code>menopauseCertified</code> boolean. Weighted scoring,
          gating, and distance ranking are not yet computed — they
          activate alongside Phase 1 ingestion and Phase 3 outcomes data.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Factor</th>
                <th>Weight</th>
                <th>What it captures</th>
              </tr>
            </thead>
            <tbody>
              {scoring.map((row) => (
                <tr key={row.factor}>
                  <td>
                    <StatusPill status={row.status} style={inlinePillStyle} />
                  </td>
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

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Hit the contract that survives Phase 1
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The provider Experience API is live with synthetic data. The
          contract — filters, provenance block, MCP tool wrapping — is
          stable. Phase 1 will swap real NPPES-derived data in behind it.
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
            href="/api/mulesoft/providers?zip=92614&menopause=true"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Experience API: provider directory →
          </a>
          <a
            href="/proposal/mcp"
            className="btn btn-secondary"
          >
            MCP tool: find_menopause_providers →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/frontend/lib/mulesoft-mocks.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Synthetic slice on GitHub →
          </a>
          <a
            href="https://npiregistry.cms.hhs.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            CMS NPPES (the Phase 1 source) →
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Strategic considerations</p>
        <h2 className="proposal-section-title">Why we're building it vs. buying it</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {considerations.map((c) => (
            <article key={c.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={c.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{c.name}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{c.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased plan</p>
        <h2 className="proposal-section-title">From the live contract to the closed-loop moat</h2>
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

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where the provider graph sits in the bigger picture</h2>
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
