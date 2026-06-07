import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { mscpDirectoryUrl } from "../../../lib/menopause-society";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · The Menopause Society",
  description:
    "How Pause-Health.ai composes with The Menopause Society and the MSCP credential — referral, partnership, and a defensible provider graph.",
  path: "/proposal/menopause-society",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "The Menopause Society integration — Pause-Health.ai investor brief."
});

/**
 * Menopause Society brief — Arc B polish pass.
 *
 * Three issues with the previous version:
 *
 *   1. The page cites "~2,500 MSCPs worldwide" as a beachhead
 *      figure. The current count per The Menopause Society's own
 *      figures (via SFChronicle, early 2026) is ~4,100 -- the field
 *      has nearly tripled from 1,350 in 2021. Stale numbers in an
 *      investor brief = credibility risk. We update the figure and
 *      add a Research badge with sourcing.
 *
 *   2. Path C is labeled "Shipped today" -- which IS true (the
 *      deep-link helper at frontend/lib/menopause-society.ts is
 *      wired into /demo/routing and /proposal/customers, generates
 *      valid portal URLs, and never fetches or republishes the
 *      directory). Convert "Shipped today" plain-text to a
 *      `prototype` StatusPill so it reads consistently with the
 *      other paths' status framing.
 *
 *   3. Paths A, B, D read in present-tense timelines without any
 *      explicit pill saying this is a plan. Pill each path
 *      individually: A = `designed`, B = `designed` (separate page
 *      handles its full status), C = `prototype`, D = `designed`.
 *
 * Plus the standard polish: per-card pills on landscape + guardrails,
 * a Touch-the-architecture CTA, normalized Read-deeper footer.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const landscape: Array<{
  title: string;
  status: StatusPillStatus;
  detail: React.ReactNode;
}> = [
  {
    title: "What The Menopause Society owns",
    status: "research",
    detail: (
      <>
        The MSCP credential (formerly NCMP under NAMS) — a competency
        examination that specifically tests menopause knowledge above and
        beyond a clinician&apos;s primary specialty. Their &quot;Find a
        Menopause Practitioner&quot; directory lists members and MSCPs who
        have opted in. As of early 2026, there are <strong>~4,100 MSCPs
        worldwide</strong>, up from ~1,350 in 2021 — the field has nearly
        tripled in five years.
      </>
    )
  },
  {
    title: "What they explicitly prohibit",
    status: "research",
    detail: (
      <>
        The directory&apos;s terms forbid scraping, republishing, embedding
        for promotional purposes, or any unauthorized use. There is no
        public API and there is no public bulk MSCP roster. Several
        third-party &quot;menopause specialist&quot; directories exist; none
        claim Menopause Society affiliation.
      </>
    )
  },
  {
    title: "What it means for Pause",
    status: "designed",
    detail: (
      <>
        We cannot — and will not — treat the directory as a data source. We
        can do three other things that are both legal and strategically
        stronger: refer patients to it (Path C, shipped in prototype today),
        build a complementary provider graph from primary sources (Path B),
        and earn the partnership by serving MSCPs better than anyone else
        (Path A).
      </>
    )
  }
];

const paths: Array<{
  name: string;
  status: StatusPillStatus;
  timeline: string;
  detail: string;
  stance: string;
}> = [
  {
    name: "Path A — Official partnership",
    status: "designed",
    timeline: "6–12 months",
    detail:
      "Negotiate a data-sharing agreement covering the MSCP directory and a co-branded MSCP-Verified badge on the Pause platform. Earned, not asked: opens after we walk in with MSCP users and outcomes data.",
    stance: "Strategic — the long-term win."
  },
  {
    name: "Path B — Build our own provider graph from primary sources",
    status: "designed",
    timeline: "1 quarter (see /proposal/provider-graph)",
    detail:
      "Reconstruct a menopause-likely provider graph from CMS NPPES (NPI Registry), state medical board licensure, and clinic-site service detection. No ToS exposure because we never touch the NAMS directory. The Experience API contract for this graph is live today with a synthetic slice; ingestion is designed.",
    stance: "The actual moat we want to own."
  },
  {
    name: "Path C — Deep-link referral",
    status: "prototype",
    timeline: "Wired in the prototype today",
    detail:
      "When Pause recommends an external specialist consult, deep-link patients to The Menopause Society's own directory with the appropriate search mode selected. Implemented today in frontend/lib/menopause-society.ts (mscpDirectoryUrl) and used by /demo/routing + /proposal/customers. Zero legal risk, immediate patient value.",
    stance: "Right thing for the patient; right thing for The Menopause Society."
  },
  {
    name: "Path D — MSCP-as-user",
    status: "designed",
    timeline: "Next quarter",
    detail:
      "Reserve Pause features for MSCP-credentialed clinicians (self-attested + verified at pilot enrollment). Publish quarterly outcomes by credential type. Makes the MSCP credential commercially more valuable — and accelerates Path A.",
    stance: "The Trojan horse into the partnership."
  }
];

const guardrails: Array<{
  label: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    label: "We never scrape or republish their directory",
    status: "prototype",
    detail:
      "The Menopause Society explicitly prohibits unauthorized use of the Find a Menopause Practitioner directory. Pause-Health.ai links patients to the directory on menopause.org; we do not fetch, parse, cache, or embed it. The mscpDirectoryUrl helper builds deep links only — never makes a server-side request to the portal."
  },
  {
    label: "We never claim affiliation we have not earned",
    status: "designed",
    detail:
      "Until a written partnership is in place, no Pause page, deck, or marketing surface uses the MSCP or Menopause Society marks in ways that imply endorsement. We describe the credential factually. The directory attribution copy is centralized in MSCP_DIRECTORY_LABELS for consistent wording wherever the link is rendered."
  },
  {
    label: "We never auto-submit on a patient's behalf",
    status: "prototype",
    detail:
      "Pause deep-links route patients to the correct search mode (by-ZIP, by-state, by-country) but require the patient to confirm the search themselves on menopause.org. This is intentional and policy-aligned — and the menopause-society helper module explicitly comments on why."
  }
];

const partnershipTouchpoints: Array<{
  moment: string;
  action: string;
}> = [
  {
    moment: "After our first 5 MSCP-credentialed pilot users",
    action:
      "Send a courtesy briefing to The Menopause Society leadership: who's using Pause, what outcomes look like, what we're seeing in MSCP-vs-non-MSCP comparisons."
  },
  {
    moment: "After our first peer-reviewed validation paper",
    action:
      "Offer to co-author or cross-reference. Submit the paper to Menopause (the Society's journal) when relevant."
  },
  {
    moment: "At a NAMS / Menopause Society annual meeting",
    action:
      "Sponsor a poster session on AI-assisted menopause decision support with anonymized MSCP cohort outcomes from Pause."
  },
  {
    moment: "Once we have ARR and customer evidence",
    action:
      "Open the formal partnership conversation: directory data, MSCP-Verified badge, joint clinical evidence program."
  }
];

const strategicRationale: Array<{
  label: string;
  status: StatusPillStatus;
  detail: React.ReactNode;
}> = [
  {
    label: "Why MSCPs are the right beachhead",
    status: "research",
    detail: (
      <>
        They have already self-selected as menopause-serious clinicians,
        they hold tested knowledge, and they are concentrated enough
        (~4,100 worldwide as of early 2026, per The Menopause Society) to
        cover with a focused sales motion. The cohort has nearly tripled
        in five years — the talent pool is growing into the gap.
      </>
    )
  },
  {
    label: "Why not just license the directory",
    status: "designed",
    detail: (
      <>
        We don&apos;t have the leverage yet. Walking into that negotiation
        with MSCP users and outcomes data is dramatically stronger than
        walking in with a pitch deck.
      </>
    )
  },
  {
    label: "Why build our own provider graph anyway",
    status: "designed",
    detail: (
      <>
        Even with a Menopause Society partnership, MSCPs are a small subset
        of menopause-relevant providers. The full graph is a moat we want to
        own regardless of what Path A produces.
      </>
    )
  },
  {
    label: "Why this earns trust",
    status: "prototype",
    detail: (
      <>
        Our public posture toward The Menopause Society — refer, never
        scrape, claim nothing we haven&apos;t earned — is already
        materialized in the prototype: the deep-link helper, the
        guardrail-aware attribution copy, the policy-aligned
        no-auto-submit behavior. CIOs and credentialing bodies pay
        attention to that pattern.
      </>
    )
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
    href: "/proposal/provider-graph",
    label: "Provider graph (Path B)",
    detail:
      "How we will build a defensible menopause provider graph from NPPES + state board data, without touching the NAMS directory. The Experience API contract is live today with a synthetic slice.",
    status: "partial"
  },
  {
    href: "/proposal/customers",
    label: "Customer selection",
    detail: "How MSCP density influences our health-system ICP and territory model.",
    status: "designed"
  },
  {
    href: "/proposal/strategy",
    label: "Digital strategy",
    detail: "Where credential-aware routing fits into the broader competitive moat.",
    status: "designed"
  },
  {
    href: "/demo/routing",
    label: "See the deep-link in the prototype",
    detail:
      "When the Care Router recommends a specialist consult and the patient's network lacks an MSCP, the prototype routes them to the right Menopause Society search mode.",
    status: "prototype"
  },
  {
    href: "https://menopause.org/professional-resources/mscp-certification",
    label: "About MSCP certification (menopause.org)",
    detail: "The Menopause Society's own page about the credential.",
    external: true
  }
];

export default function MenopauseSocietyPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · The Menopause Society"
      title="Composing with The Menopause Society, on their terms"
      subtitle="The MSCP credential is the closest thing the field has to a quality signal for menopause care — ~4,100 practitioners worldwide as of early 2026, nearly tripled from 2021. Pause-Health.ai's strategy: serve MSCPs, route patients to MSCPs (wired in prototype today), and earn the partnership over 6–12 months."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The landscape, as it actually is</p>
        <h2 className="proposal-section-title">Three things to anchor on before the four paths</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="research" style={inlinePillStyle} /> sourced
          claim with public citation ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> our
          strategic posture toward the field.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {landscape.map((item) => (
            <article key={item.title} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{item.title}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{item.detail}</p>
            </article>
          ))}
        </div>
        <p
          style={{
            color: "var(--muted)",
            margin: "0.6rem 0 0",
            fontSize: "0.85rem"
          }}
        >
          Source for the MSCP cohort size: The Menopause Society, as
          reported by the{" "}
          <a
            href="https://www.sfchronicle.com/health/aging-longevity/article/how-to-find-menopause-specialist-20817662.php"
            target="_blank"
            rel="noopener noreferrer"
          >
            San Francisco Chronicle (2026)
          </a>{" "}
          — ~4,100 MSCPs today, up from ~1,350 in 2021.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Four paths, sequenced</p>
        <h2 className="proposal-section-title">Status pill per path</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> wired in
          the prototype today ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> committed
          path, activates with pilot or partnership conversation.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {paths.map((path) => (
            <article key={path.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={path.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{path.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {path.timeline}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{path.detail}</p>
              <p style={{ marginTop: "0.6rem", fontStyle: "italic" }}>{path.stance}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture · Path C</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The deep-link helper, live
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          When Pause routes a patient to a specialist consult and their
          network does not already include an MSCP, the prototype offers a
          deep link to The Menopause Society&apos;s own directory with the
          right search mode selected. Pause never fetches, embeds, or
          republishes the directory — the helper at{" "}
          <code>frontend/lib/menopause-society.ts</code> builds the URL
          client-side and the patient confirms the search on{" "}
          <code>menopause.org</code>.
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
            href={mscpDirectoryUrl({ zip: "92602" })}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Sample ZIP search →
          </a>
          <a
            href={mscpDirectoryUrl({ state: "CA" })}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Sample telehealth search →
          </a>
          <a href="/demo/routing" className="btn btn-secondary">
            See it in the prototype →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/frontend/lib/menopause-society.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Helper source on GitHub →
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Guardrails (non-negotiable)</p>
        <h2 className="proposal-section-title">What we will never do — pilled by what's already enforced</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> the
          guardrail is enforced by today&apos;s code path ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> the
          guardrail is policy; will be enforced by code at the relevant
          surface.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {guardrails.map((g) => (
            <article key={g.label} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={g.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{g.label}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{g.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Partnership runway (Path A)</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four touchpoints to earn the partnership conversation
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {partnershipTouchpoints.map((touchpoint) => (
            <li key={touchpoint.moment}>
              <span>{touchpoint.moment}</span>
              <strong style={{ fontWeight: 500 }}>{touchpoint.action}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Strategic rationale</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four properties of the Menopause Society strategy
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {strategicRationale.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              <strong style={{ fontWeight: 500 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "flex-start",
                    gap: "0.4rem",
                    flexWrap: "wrap"
                  }}
                >
                  <StatusPill status={row.status} style={inlinePillStyle} />
                  <span>{row.detail}</span>
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where Menopause Society strategy meets the rest of the brief</h2>
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
