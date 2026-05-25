import { ProposalShell } from "../../../components/proposal-shell";
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

const paths = [
  {
    name: "Path A — Official partnership",
    timeline: "6–12 months",
    detail:
      "Negotiate a data-sharing agreement covering the MSCP directory and a co-branded MSCP-Verified badge on the Pause platform. Earned, not asked: opens after we walk in with MSCP users and outcomes data.",
    stance: "Strategic — the long-term win."
  },
  {
    name: "Path B — Build our own provider graph from primary sources",
    timeline: "1 quarter",
    detail:
      "Reconstruct a menopause-likely provider graph from CMS NPPES (NPI Registry), state medical board licensure, and clinic-site service detection. No ToS exposure because we never touch the NAMS directory.",
    stance: "The actual moat we want to own."
  },
  {
    name: "Path C — Deep-link referral",
    timeline: "Shipped today",
    detail:
      "When Pause recommends an external specialist consult, deep-link patients to The Menopause Society's own directory with the appropriate search mode selected. Zero legal risk, immediate patient value.",
    stance: "Right thing for the patient; right thing for The Menopause Society."
  },
  {
    name: "Path D — MSCP-as-user",
    timeline: "Next quarter",
    detail:
      "Reserve Pause features for MSCP-credentialed clinicians (self-attested + verified at pilot enrollment). Publish quarterly outcomes by credential type. Makes the MSCP credential commercially more valuable — and accelerates Path A.",
    stance: "The Trojan horse into the partnership."
  }
];

const guardrails = [
  {
    label: "We never scrape or republish their directory",
    detail:
      "The Menopause Society explicitly prohibits unauthorized use of the Find a Menopause Practitioner directory. Pause-Health.ai links patients to the directory on menopause.org; we do not fetch, parse, cache, or embed it."
  },
  {
    label: "We never claim affiliation we have not earned",
    detail:
      "Until a written partnership is in place, no Pause page, deck, or marketing surface uses the MSCP or Menopause Society marks in ways that imply endorsement. We describe the credential factually."
  },
  {
    label: "We never auto-submit on a patient's behalf",
    detail:
      "Pause deep-links route patients to the correct search mode (by-ZIP, by-state, by-country) but require the patient to confirm the search themselves on menopause.org. This is intentional and policy-aligned."
  }
];

const partnershipTouchpoints = [
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

export default function MenopauseSocietyPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · The Menopause Society"
      title="Composing with The Menopause Society, on their terms"
      subtitle="The MSCP credential is the closest thing the field has to a quality signal for menopause care. Pause-Health.ai's strategy: serve MSCPs, route patients to MSCPs, and earn the partnership."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The landscape, as it actually is</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          <article className="card">
            <h3>What The Menopause Society owns</h3>
            <p>
              The MSCP credential (formerly NCMP under NAMS) — a competency examination
              that specifically tests menopause knowledge above and beyond a clinician&apos;s
              primary specialty. Their &quot;Find a Menopause Practitioner&quot; directory
              lists members and MSCPs who have opted in.
            </p>
          </article>
          <article className="card">
            <h3>What they explicitly prohibit</h3>
            <p>
              The directory&apos;s terms forbid scraping, republishing, embedding for
              promotional purposes, or any unauthorized use. There is no public API and
              there is no public bulk MSCP roster. Several third-party &quot;menopause
              specialist&quot; directories exist; none claim Menopause Society affiliation.
            </p>
          </article>
          <article className="card">
            <h3>What it means for Pause</h3>
            <p>
              We cannot — and will not — treat the directory as a data source. We can do
              three other things that are both legal and strategically stronger: refer
              patients to it, build a complementary provider graph from primary sources,
              and earn the partnership by serving MSCPs better than anyone else.
            </p>
          </article>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Four paths, sequenced</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {paths.map((path) => (
            <article key={path.name} className="card">
              <h3>{path.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {path.timeline}
              </p>
              <p>{path.detail}</p>
              <p style={{ marginTop: "0.6rem", fontStyle: "italic" }}>{path.stance}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">What Path C looks like in the prototype</p>
        <p style={{ marginTop: "0.4rem" }}>
          When Pause routes a patient to a specialist consult and their network does not
          already include an MSCP, the prototype offers a deep link to The Menopause
          Society&apos;s own directory with the right search mode selected. Pause never
          fetches, embeds, or republishes the directory.
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
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Guardrails (non-negotiable)</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {guardrails.map((g) => (
            <article key={g.label} className="card">
              <h3>{g.label}</h3>
              <p>{g.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Partnership runway (Path A)</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
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
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Why MSCPs are the right beachhead</span>
            <strong style={{ fontWeight: 500 }}>
              They have already self-selected as menopause-serious clinicians, they hold
              tested knowledge, and they are concentrated enough (~2,500 worldwide) to
              cover with a focused sales motion.
            </strong>
          </li>
          <li>
            <span>Why not just license the directory</span>
            <strong style={{ fontWeight: 500 }}>
              We don&apos;t have the leverage yet. Walking into that negotiation with MSCP
              users and outcomes data is dramatically stronger than walking in with a
              pitch deck.
            </strong>
          </li>
          <li>
            <span>Why build our own provider graph anyway</span>
            <strong style={{ fontWeight: 500 }}>
              Even with a Menopause Society partnership, MSCPs are a small subset of
              menopause-relevant providers. The full graph is a moat we want to own
              regardless of what Path A produces.
            </strong>
          </li>
          <li>
            <span>Why this earns trust</span>
            <strong style={{ fontWeight: 500 }}>
              Our public posture toward The Menopause Society is exactly what we&apos;d
              want a partner to take toward us: refer patients to them, never scrape, claim
              nothing we haven&apos;t earned. CIOs and credentialing bodies pay attention to
              that pattern.
            </strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/provider-graph">Provider graph (Path B)</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How we build a defensible menopause provider graph from NPPES + state board
              data, without touching the NAMS directory.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/customers">Customer selection</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How MSCP density influences our health-system ICP and territory model.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/strategy">Digital strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Where credential-aware routing fits into the broader competitive moat.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://menopause.org/for-professionals/mscp-certification"
                target="_blank"
                rel="noopener noreferrer"
              >
                About MSCP certification (menopause.org)
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Menopause Society&apos;s own page about the credential.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
