import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Provider Graph",
  description:
    "How Pause-Health.ai builds a defensible menopause provider graph. Phase 2 shipped: 2,015 NPPES-derived providers, distance-aware ranking from Census ZCTA centroids, board-certification signals, three-state license-sanction filters (CA/NY/TX, 1,720 dropped at build), synthetic-but-real-shaped insurance acceptance, and a /provider browseable UI. Closed-loop outcomes scoring (Phase 3) activates with referral volume.",
  path: "/proposal/provider-graph",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Provider graph strategy — Pause-Health.ai investor brief."
});

/**
 * Provider graph brief.
 *
 * Phase 2 is now shipped end-to-end. The provider directory is
 * NPPES-derived at scale (2,015-row national run), distance-aware
 * (Census 2020 ZCTA centroids → Haversine), and gated by three
 * state license-sanction overlays (CA Medi-Cal S&I, NY OPMC, TX TMB)
 * that drop 1,720 candidates at build time before they can ever be
 * recommended. Service-line signals from the public NPPES record
 * (FACOG, FAAFP, WHNP, multi-taxonomy) honestly sub-rank the
 * relevant-local tier when no certified-local provider is in range.
 * Insurance acceptance ships as a real-shaped synthetic overlay so
 * the contract, filter UX, and agent framing are all wired up
 * end-to-end; replacing the synthesis with a partner feed is a
 * one-module swap.
 *
 * Surfaces:
 *
 *   - GET /api/mulesoft/providers (Experience API contract;
 *     queryProviderDirectory backs the mock, the live MuleSoft
 *     CloudHub 2.0 worker serves the same shape from a curated
 *     in-flow slice via DataWeave).
 *   - /provider — browseable UI with filters (zip, plan, MSCP-only,
 *     fallback) wired through the same query function.
 *   - /provider/<npi> — per-provider profile page surfacing the full
 *     Phase-2 surface (chips, signals, plans, license, distance,
 *     provenance).
 *   - MCP tool: find_menopause_providers — wraps the same Experience
 *     API for LLM clients.
 *   - Care Router: when triage routes a patient to an MSCP visit,
 *     the directory feeds a modality-ranked + insurance-narrowed
 *     recommendation list onto the routing decision.
 *
 * What stays designed: a licensed Menopause Society MSCP feed
 * (synthetic overlay today, ~14 self-reported MSCP/NCMP physicians
 * in the public NPPES record act as the floor); a clinic-site
 * service-detection scraper (not built); a paid in-network insurance
 * feed (synthetic per-NPI today); broader sanction coverage beyond
 * CA/NY/TX (FL is auth-gated, NJ is PDF-only — see the runbook for
 * the full landscape survey). Closed-loop outcomes scoring (Phase 3)
 * activates after the first ~1,000 referrals.
 *
 * Page anatomy:
 *
 *   1. Header lead with "Phase 2 shipped" — what's wired vs. still
 *      synthetic vs. future, with concrete counts.
 *   2. Today's Reality card — the contract numbers (2,015 / 1,720
 *      / 96% / 22%) with their per-build provenance.
 *   3. Sources cards — NPPES + Census ZCTA + sanctions overlays
 *      live, MSCP feed + clinic-site detector + commercial insurance
 *      partner designed, outcomes future.
 *   4. Scoring model table — credential / signals / license-standing
 *      / geographic / insurance / outcomes, with status pills.
 *   5. Phased plan — Phase 0 prototype, Phase 1 prototype, Phase 2
 *      prototype (now shipped, with what landed), Phase 3 future.
 *   6. Touch-the-architecture CTA — UI, raw API, MCP, source links.
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
    status: "prototype",
    type: "Public domain · bulk download (~9.6M rows) + REST API",
    detail:
      "All US healthcare providers with an NPI. Includes taxonomy codes, primary practice address, state license number + state code (×15 slots — used for the sanctions cross-walk), and authoritative provider identity. The provider_ingest pipeline streams the bulk schema, filters to the curated menopause NUCC taxonomies, overlays the MSCP credential list (synthetic + self-reported), computes a graphScore, stamps lat/lng from the Census ZCTA gazetteer, and emits the 2,015-row directory the contract serves. Refresh runs in ~1m50s end-to-end via the tracked refresh_national.sh harness.",
    purpose:
      "Authoritative provider identity. The NPI is the join key that everything else hangs off."
  },
  {
    name: "Census 2020 ZCTA Gazetteer",
    status: "prototype",
    type: "Public domain · ~33K ZIP centroids",
    detail:
      "Bundled in both the Python pipeline (provider_ingest/centroids.py) and the Next.js server runtime (lib/zip-centroids.ts) so build-time stamping (every NPPES row → lat/lng) and request-time resolution (patient ZIP → centroid) draw from one source. The directory ranks by Haversine distance whenever the patient ZIP centroid is known and at least one in-tier provider has its own; otherwise it gracefully falls back to graphScore-only ranking and reports sort: \"score\".",
    purpose:
      "Real distance ranking, not a 3-digit-prefix proxy. Powers the \"4.2 mi away\" chip on every recommendation."
  },
  {
    name: "State license-sanction overlays",
    status: "prototype",
    type: "Public domain · CA + NY + TX",
    detail:
      "Three live filters drop sanctioned providers at build time: CA Medi-Cal Suspended & Ineligible List (NPI-keyed CSV from CHHS), NY Professional Medical Conduct Board Actions (license-keyed via the NPPES Provider License Number cross-walk), Texas Medical Board All-Licenses (license-keyed, allowlist of explicit active-sanction dispositions — REVOKED / SUSPENDED BY BOARD / UNDER BOARD ORDER, not the noisy != NONE check). The June 2026 run filters 588 (CA) + 849 (NY) + 283 (TX) = 1,720 candidates total. FL is gated behind Azure AD B2C; NJ is PDF-only; landscape documented in the runbook.",
    purpose:
      "Patient-safety filter that's verifiable from the response (provenance.dataset.sanctionedFilteredBySource) on every API call."
  },
  {
    name: "NPPES service-line signals",
    status: "prototype",
    type: "Derived · provider_ingest/signals.py",
    detail:
      "Six public-registry tokens detected from the NPPES credential text + taxonomy stack: facog (Fellow ACOG = board-certified OB/GYN), faafp (board-certified family medicine), face (board-certified endocrinology), whnp (Women's Health NP), cnm (Certified Nurse-Midwife), multi-taxonomy (≥2 menopause-relevant NUCC codes). Each contributes a +2% graphScore bump capped at +5% — bounded so a non-certified provider with all signals still falls behind a certified one at the same baseline. 22% of the directory carries at least one signal; honestly sub-ranks the relevant-local fallback tier.",
    purpose:
      "Strengthens the case for non-certified providers in metros where MSCP coverage is sparse, without inventing certifications."
  },
  {
    name: "Insurance acceptance overlay",
    status: "partial",
    type: "Synthetic per-NPI today · partner feed-shaped",
    detail:
      "There's no public structured payer/in-network feed; a real implementation needs a paid partnership (Ribbon Health, Turquoise, etc.). Today insuranceAccepted is derived deterministically from a SHA-256 hash of the NPI, calibrated to plausible real-world participation rates (Medicare ~85%, Kaiser ~20%, ~3.8 plans per provider on average). Every Experience API response carries the synthetic caveat in provenance.sources. The shape is real (filter UX, contract, agent framing); replacing the synthesis with a real feed is a one-module swap.",
    purpose:
      "Wire the in-network filter end-to-end so the partner integration is a drop-in, not a rebuild."
  },
  {
    name: "Clinic-site service detection",
    status: "designed",
    type: "Derived · Pause-built",
    detail:
      "Phase-2-bis. NPPES-resident signals already cover board certifications and multi-specialty practice; clinic-site scraping would add explicit mentions of HRT / perimenopause / vasomotor services on the practice's own website. Caching, rate-limiting, robots.txt-respecting. No fetcher today — we don't ship a brittle scraper without an explicit need.",
    purpose:
      "Distinguishes general OB/GYNs who happen to see midlife patients from clinicians actually marketing menopause services."
  },
  {
    name: "Licensed MSCP feed (Menopause Society)",
    status: "designed",
    type: "Partnership · The Menopause Society",
    detail:
      "Authoritative Menopause Society Certified Practitioner roster; gated on a partnership (terms-of-use prohibits scraping/republishing). Self-reported MSCP/NCMP credentials in the public NPPES record act as the floor today (~14 physicians nationally — rare but real). The pipeline is ready to union a licensed feed via the same MscpOverlay class once an agreement lands.",
    purpose:
      "Dense certified coverage outside the demo metros. Today's directory has 15 certified providers; a real feed adds thousands."
  },
  {
    name: "Outcomes signal (closed loop)",
    status: "future",
    type: "Pause-internal · Phase 3",
    detail:
      "Once Pause has referrals flowing at scale, the patient and provider outcomes from each referral become the strongest possible scoring signal. Activates after the first ~1,000 referrals.",
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
    status: "prototype",
    weight: "Highest",
    detail:
      "MSCP / NCMP membership applied as a multiplicative boost to the graphScore (provider_ingest/score.py — capped, so a perfect-score certified provider stays in [0, 1]). Today's overlay unions a synthetic MSCP NPI list with the providers who self-report MSCP/NCMP in the NPPES Provider Credential Text — both honest signals; neither is invented. A licensed Menopause Society feed lands cleanly behind the same MscpOverlay class once a partnership exists."
  },
  {
    factor: "Service-line signals",
    status: "prototype",
    weight: "High",
    detail:
      "FACOG / FAAFP / FACE / WHNP / CNM / multi-taxonomy tokens detected directly from the NPPES credential text + taxonomy stack. Each contributes +2% capped at +5% total — a non-certified provider with all signals still falls behind a certified one. 22% of the directory has at least one signal; the relevant-local fallback tier is now sub-ranked honestly. Clinic-site scraping (Phase-2-bis) would add an additional service-mention layer."
  },
  {
    factor: "License standing",
    status: "prototype",
    weight: "Gating",
    detail:
      "Three state license-sanction filters run at build time: CA Medi-Cal S&I (NPI-keyed), NY OPMC (license-keyed cross-walk via NPPES), TX TMB (license-keyed, active-disposition allowlist). Survivors carry licenseStatus: \"active\" — there is no \"recommend with caveat\" path; sanctioned providers are dropped, not surfaced with a warning. The June 2026 run dropped 1,720 candidates pre-rank. FL/NJ etc. are out of reach today (auth-gated, PDF-only); landscape documented in the runbook."
  },
  {
    factor: "Geographic coverage",
    status: "prototype",
    weight: "Medium",
    detail:
      "Census 2020 ZCTA centroids stamp every directory row with lat/lng; the patient ZIP centroid resolves at request time; Haversine distance ranks within tier when both are present. accepting-new-patients + telehealth feed graphScore (NPPES doesn't publish them so they're derived deterministically per-NPI for the demo — production can swap in real availability data). Distance is rounded to 0.1 mi (false precision past that, since centroids are area middles)."
  },
  {
    factor: "Insurance match",
    status: "partial",
    weight: "Medium",
    detail:
      "insuranceAccepted on every row + ?insurance=<plan> filter on the contract + provisional rendering on the agent + UI chips on the profile page. Today the values are deterministically derived from a SHA-256 hash of the NPI (Medicare ~85%, Kaiser ~20%, ~3.8 plans per provider) — calibrated to plausible real-world rates and labeled synthetic in every API response's provenance. A paid partner feed (Ribbon Health, Turquoise) replaces the synthesis without any downstream change."
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
    status: "partial",
    detail:
      "Everything ingested today is public-domain (NPPES, Census ZCTA, CHHS Medi-Cal S&I, NY OPMC, TX TMB). We carry provenance on every API response — sources list, dataset block with generatedAt + sourceDate + per-source sanction counts, synthetic-data callouts wherever the value is derived. Sanctioned providers are filtered at build time, not surfaced with a warning. Provider opt-out mechanism is designed (when needed); the licensed Menopause Society MSCP feed waits on a partnership rather than a scrape."
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
    duration: "Shipped",
    detail:
      "Experience API contract at /api/mulesoft/providers with the full filter surface (zip, menopauseOnly, limit, fallback, insurance, distance) and a provenance block. MCP find_menopause_providers wraps it for LLM clients. The mock + the live MuleSoft CloudHub 2.0 worker honor the same contract; a vitest pins shape parity so they can't drift."
  },
  {
    name: "Phase 1 — NPPES + taxonomy filter",
    status: "prototype",
    duration: "Shipped",
    detail:
      "provider_ingest streams the 9.6M-row CMS NPPES bulk file in ~1m50s, filters to the curated menopause NUCC taxonomies (OB/GYN, urogynecology, gyn-onc, repro endo, NP — Women's Health / Gerontology / Adult Health, CNM, FM, IM, etc.), unions an MSCP overlay (synthetic + self-reported), computes a graphScore, and emits a 2,015-row generated JSON. The committed national run captures 15 menopause-certified providers + 2,000 menopause-relevant non-certified providers across 55 states / 532 ZIP-3 prefixes."
  },
  {
    name: "Phase 2 — Distance, signals, sanctions, insurance, UI",
    status: "prototype",
    duration: "Shipped",
    detail:
      "Five workstreams landed. Distance ranking (Census 2020 ZCTA centroids, Haversine, ranked within tier). Service-line signals (6 NPPES tokens: FACOG, FAAFP, WHNP, CNM, multi-taxonomy, etc.; 22% coverage). State sanctions (CA + NY + TX, 1,720 candidates dropped at build, license-keyed cross-walk via NPPES). Insurance overlay (synthetic-but-real-shaped, per-NPI, agent surfaces it provisionally). Patient-facing UI (/provider browseable index + /provider/<npi> profile pages with the full surface). The live MuleSoft worker DataWeave was rewritten to match the same Phase-2 contract; deploy is pending. FL / NJ sanction overlays are blocked by data access (auth-gated / PDF-only)."
  },
  {
    name: "Phase 2-bis — Clinic-site detection + commercial insurance feed",
    status: "designed",
    duration: "Gated on need / partnership",
    detail:
      "Two pieces wait for an explicit need or external dependency: a clinic-website scraper for HRT / perimenopause / vasomotor service mentions (NPPES signals already cover the high-confidence cases — the scraper adds the remaining tail), and a paid in-network feed (Ribbon Health, Turquoise) that replaces the synthetic insurance derivation. Both swap in behind the existing contract without consumer changes; we don't ship the scraper today because brittle and we don't ship the partnership today because not yet purchased."
  },
  {
    name: "Phase 3 — Closed-loop scoring",
    status: "future",
    duration: "After first ~1,000 referrals",
    detail:
      "Pull patient and provider outcomes from Pause's own data. Re-weight the scoring model. From here, the graph self-improves and competitors can't catch up by buying any single dataset — the moat is the referral history."
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
      title="A defensible menopause provider graph — Phase 2 shipped"
      subtitle="2,015 providers behind a frozen Experience API contract: NPPES-derived rows, Census-ZCTA distance ranking, six NPPES board-certification + multi-specialty signals, three state license-sanction filters that drop 1,720 sanctioned candidates at build, real-shaped synthetic insurance, and a /provider browseable UI. The agent and Care Router consume the same query function. Closed-loop outcomes scoring (Phase 3) activates with referral volume."
    >
      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Today's reality</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The numbers behind the contract — verifiable from any API call
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The provider directory is served through a production-shaped
          Experience API at <code>/api/mulesoft/providers</code>, a
          browseable UI at <a href="/provider">/provider</a>, and an MCP{" "}
          <code>find_menopause_providers</code> tool. All three read from
          one source — <code>queryProviderDirectory</code> over the
          generated JSON the <code>provider_ingest</code> pipeline emits.
          The June 2026 national run produced the headline numbers below;
          every API response carries the same counts under{" "}
          <code>provenance.dataset</code> so you can verify them by{" "}
          <a href="/api/mulesoft/providers" target="_blank" rel="noopener noreferrer">
            curling the endpoint
          </a>
          . The <a href="/demo/routing">Care Router</a> wires this directly
          into triage: an MSCP-pathway routing decision attaches a
          distance-ranked, plan-narrowed, modality-aware recommended-
          provider list to its output — agent + UI + traces all read the
          same shape.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.6rem" }}>
          <li>
            <span>Directory size</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="prototype" style={inlinePillStyle} />
              <strong>2,015</strong> providers across 55 states / 532
              ZIP-3 prefixes; 15 menopause-certified, 2,000 menopause-
              relevant non-certified.
            </strong>
          </li>
          <li>
            <span>Patient-safety filter</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="prototype" style={inlinePillStyle} />
              <strong>1,720</strong> sanctioned candidates dropped pre-
              rank: 588 CA Medi-Cal + 849 NY OPMC + 283 TX TMB.
              Survivors carry <code>licenseStatus: &quot;active&quot;</code>.
            </strong>
          </li>
          <li>
            <span>Distance + signal coverage</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="prototype" style={inlinePillStyle} />
              <strong>96%</strong> of rows carry a Census ZCTA centroid;{" "}
              <strong>22%</strong> carry at least one service-line signal
              (FACOG, FAAFP, WHNP, multi-taxonomy, etc.).
            </strong>
          </li>
          <li>
            <span>Still synthetic / partnership-gated</span>
            <strong style={{ fontWeight: 500 }}>
              <StatusPill status="partial" style={inlinePillStyle} />
              Insurance acceptance (per-NPI SHA-256 derivation, calibrated
              to plausible rates — labeled in every API response). MSCP
              overlay is synthetic + 14 self-reported NPPES MSCP/NCMP
              physicians until a Menopause Society feed lands.
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
        <h2 className="proposal-section-title">Public-domain substrate — NPPES, Census, and 3 state sanction overlays live</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} />{" "}
          built and serving data today ·{" "}
          <StatusPill status="partial" style={inlinePillStyle} />{" "}
          shape live, value still synthetic / partnership-gated ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} />{" "}
          committed choice, activates when an explicit need or partner
          arrives ·{" "}
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
          Six factors — five live, one waiting for referral volume
        </h2>
        <p style={{ marginTop: "0.4rem", color: "var(--muted)", fontSize: "0.92rem" }}>
          Today's <code>graphScore</code> composes taxonomy relevance,
          MSCP certification boost, accepting-new-patients, telehealth,
          and a capped service-line signal bonus — all in [0, 1].
          License-standing is enforced as a <em>filter</em> at build
          time, not a downweight. Geographic ranking uses real Haversine
          distance from Census ZCTA centroids. Insurance match is
          synthetic-shaped today, partner-feed-ready. Outcomes feedback
          activates with Phase 3 referral data.
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
          Hit the contract — UI, raw API, MCP, source data, sanctions feeds
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          Every fact on this page is verifiable: the UI shows the
          directory, the raw API surfaces the same shape with full
          provenance, the source code is on GitHub, and the upstream
          public datasets are linked below.
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
            href="/provider?zip=92614&menopause=true"
            className="btn btn-primary"
          >
            Browse the directory (UI) →
          </a>
          <a
            href="/api/mulesoft/providers?zip=92614&menopause=true"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Experience API (raw JSON) →
          </a>
          <a
            href="/proposal/mcp"
            className="btn btn-secondary"
          >
            MCP tool: find_menopause_providers →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/provider_ingest"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            provider_ingest pipeline on GitHub →
          </a>
          <a
            href="https://download.cms.gov/nppes/NPI_Files.html"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            CMS NPPES bulk file →
          </a>
          <a
            href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Census 2020 ZCTA Gazetteer →
          </a>
          <a
            href="https://data.chhs.ca.gov/dataset/provider-suspended-and-ineligible-list-s-i-list"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            CA Medi-Cal S&amp;I List →
          </a>
          <a
            href="https://health.data.ny.gov/Health/Professional-Medical-Conduct-Board-Actions-Beginni/ebmi-8ctw"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            NY OPMC Board Actions →
          </a>
          <a
            href="https://data.texas.gov/Government-and-Taxes/DataSet-01-All-Licenses/tm3v-pfq9"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Texas Medical Board All-Licenses →
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
