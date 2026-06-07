import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Terms",
  description:
    "Terms of use for the public Pause-Health.ai prototype and marketing site. Full Terms of Service for the production product will be published prior to general availability.",
  path: "/terms",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Terms of use — Pause-Health.ai."
});

/**
 * Terms page.
 *
 * Polished in the journey-fabric pass. The previous version was a
 * single-line StubPage saying "This page is a placeholder." Honest
 * but not useful: a reader visiting the prototype today has no
 * idea what they can and can't do with it, and a procurement
 * reviewer at a potential design-partner has no idea what the
 * production-product terms will cover.
 *
 * This rebuild publishes two clearly-pilled blocks:
 *
 *   1. "Today" -- prototype usage terms. Reflects what the
 *      prototype actually is: a public-facing demo + open code
 *      repository, no SLA, no warranty, not for clinical use.
 *      The "no clinical reliance" disclaimer is the single most
 *      important sentence on the page and is repeated up top.
 *
 *   2. "Designed" -- what the production Terms of Service will
 *      cover once design-partner deployments are in force. Not
 *      legally binding yet -- just gives a procurement reviewer
 *      a sense of the shape so they can plan their review.
 *
 * The full binding ToS is pre-GA. This page is a *summary* and
 * says so explicitly.
 */

type TermsItem = {
  area: string;
  detail: string;
  status: StatusPillStatus;
};

const todayTerms: TermsItem[] = [
  {
    area: "Not for clinical use",
    detail:
      "The prototype is a demonstration of architecture and workflow only. Nothing you read, submit, or generate here is medical advice, a clinical decision, or a substitute for evaluation by a qualified clinician. If you are experiencing menopause-related symptoms, please consult an MSCP-credentialed practitioner via the directory at the menopause society — directly, not through this prototype.",
    status: "shipped"
  },
  {
    area: "No PHI",
    detail:
      "Do NOT enter real protected health information into any surface on this site, including the embedded Agentforce chat. The demo personas are synthetic; the prototype is not under BAA. See /hipaa and /privacy for the full posture.",
    status: "shipped"
  },
  {
    area: "Acceptable use",
    detail:
      "You may browse, share, and reference the public site, the demo flow, and the open-source code. You may not (a) attempt to extract PHI (there is none to extract; this is a safeguard), (b) attempt to deceive the embedded Agentforce agent into clinical advice that would harm a real person, or (c) impersonate Pause-Health.ai or its founder in materials derived from the brand assets.",
    status: "shipped"
  },
  {
    area: "No SLA, no warranty",
    detail:
      "The prototype is provided as-is, with no uptime SLA and no warranty (express or implied) of fitness, merchantability, or accuracy. Vercel + Salesforce dependency outages may take parts of the demo offline; we'll fix them when we notice.",
    status: "shipped"
  },
  {
    area: "Source code · Apache License 2.0",
    detail:
      "The codebase is published at github.com/hucmaggie/pause-health.ai under the Apache License, Version 2.0. You may use, modify, and redistribute the code for any purpose — including commercial — provided you preserve the copyright notice and the NOTICE file. The Apache 2.0 license also includes an explicit patent grant from contributors, which matters for downstream healthcare-AI use. Third-party software referenced by the project (JupyterHealth, DBDP, FLIRT, Salesforce platform components, Anthropic API) is governed by its own license terms — see the NOTICE file in the repo root for the full attribution list.",
    status: "shipped"
  },
  {
    area: "Trademark + brand",
    detail:
      "The Pause-Health.ai wordmark and icon are trademarks of Pause-Health.ai and are NOT licensed under Apache 2.0 (the source-code license, above). Per Apache 2.0 Section 6, the license grants no permission to use Pause-Health.ai's trade names or marks except as required for describing the origin of the Work. The press kit at /press provides assets for editorial use; please don't recompose the wordmark or imply endorsement / partnership without prior written agreement.",
    status: "shipped"
  },
  {
    area: "Changes to these terms",
    detail:
      "We may update this page as the prototype evolves. Material changes will be called out in commit history (the page source is in github.com/hucmaggie/pause-health.ai under frontend/app/terms/page.tsx) and in the changelog when the full ToS publishes.",
    status: "shipped"
  }
];

const designedTerms: TermsItem[] = [
  {
    area: "Production Master Services Agreement",
    detail:
      "Standard SaaS MSA executed with each provider organization, separate from the HIPAA BAA. Covers service description, fees, mutual confidentiality, IP ownership of customer data, and service-credit SLAs.",
    status: "planned"
  },
  {
    area: "BAA (HIPAA Business Associate Agreement)",
    detail:
      "Executed with every Covered Entity before any PHI access. See /hipaa for the BA posture and standard terms.",
    status: "planned"
  },
  {
    area: "SLA + service credits",
    detail:
      "Production uptime SLA scoped to the integration surface (typically 99.9% for the customer-facing Care Router API). Service credits for missed SLA per the MSA schedule.",
    status: "planned"
  },
  {
    area: "Data processing addendum",
    detail:
      "For customers requiring CCPA / CPRA / GDPR-equivalent data-processing terms in addition to the BAA.",
    status: "designed"
  },
  {
    area: "Indemnity + liability",
    detail:
      "Mutual indemnity for IP claims, limited liability per industry norms; carve-outs for confidentiality breach, gross negligence, and HIPAA breach attributable to either party.",
    status: "designed"
  },
  {
    area: "Acceptable-use policy (production)",
    detail:
      "Covers the production product: customer responsibility for clinical decisions made with Pause-Health.ai outputs, prohibitions on using the platform outside the menopause-care scope contracted for, audit-log access for the customer's Compliance team.",
    status: "designed"
  },
  {
    area: "Termination + data return",
    detail:
      "Customer can terminate for material breach or convenience per MSA. Upon termination, customer data is returned (or destroyed at customer's instruction) per the BAA schedule.",
    status: "planned"
  }
];

export default function TermsPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Terms of use · summary</p>
        <h1>Terms of use, pilled honestly.</h1>
        <p>
          This page is a usage <em>summary</em>, not the binding legal
          Terms of Service — the full ToS for the production product
          will be published prior to general availability. Two blocks
          below: <strong>Today</strong> covers what you can and
          can&apos;t do with the public prototype and source code;{" "}
          <strong>Designed</strong> previews the shape of the
          production ToS so a procurement reviewer can plan their
          review.
        </p>

        <div
          className="card"
          style={{
            marginTop: "1.1rem",
            background: "rgba(255,138,169,0.06)",
            borderColor: "rgba(255,138,169,0.45)"
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.95rem",
              fontWeight: 600
            }}
          >
            ⚕️ Not for clinical use. The prototype is a demonstration
            only. Nothing here is medical advice. Do not enter real
            PHI. If you have menopause-related symptoms, please
            consult an MSCP-credentialed practitioner directly.
          </p>
        </div>

        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              Today (prototype){" "}
              <StatusPill
                status="shipped"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>As-is, no SLA, no warranty, not for PHI</strong>
          </li>
          <li>
            <span>
              Production ToS{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>MSA + BAA + DPA, pre-GA milestone</strong>
          </li>
          <li>
            <span>Legal contact</span>
            <strong>legal@pause-health.ai</strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap",
            marginBottom: "0.4rem"
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Today — prototype usage terms
          </p>
          <StatusPill status="shipped" label="In force on this site" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          What you can and can&apos;t do with the public prototype
          and the open-source codebase right now. These apply to
          every visitor of the public site.
        </p>
        <div className="card-grid">
          {todayTerms.map((t) => (
            <article key={t.area} className="card">
              <StatusPill
                status={t.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ margin: "0 0 0.3rem" }}>{t.area}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{t.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap",
            marginBottom: "0.4rem"
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Designed — production Terms of Service
          </p>
          <StatusPill status="planned" label="Pre-GA · not yet binding" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          The shape of the production ToS once Pause-Health.ai is
          generally available to design-partner provider
          organizations. This is a preview, not a legal contract —
          the binding ToS will be published before any production
          deployment goes live. See also{" "}
          <a href="/hipaa" style={{ color: "var(--brand)" }}>
            /hipaa
          </a>
          {" · "}
          <a href="/security" style={{ color: "var(--brand)" }}>
            /security
          </a>
          {" · "}
          <a href="/privacy" style={{ color: "var(--brand)" }}>
            /privacy
          </a>
          .
        </p>
        <div className="card-grid">
          {designedTerms.map((t) => (
            <article key={t.area} className="card">
              <StatusPill
                status={t.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ margin: "0 0 0.3rem" }}>{t.area}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{t.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Legal contact</p>
        <p style={{ color: "var(--muted)", maxWidth: "72ch", margin: 0 }}>
          For early-access program agreements, NDAs, licensing
          inquiries about the source code, or any other legal
          questions, email{" "}
          <a
            href="mailto:legal@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            legal@pause-health.ai
          </a>
          . Procurement reviews from prospective design partners are
          welcome — flag the inquiry as such and we&apos;ll route to
          a faster path.
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/privacy" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Privacy
        </a>
        <a href="/hipaa" className="btn btn-primary">
          HIPAA notice
        </a>
      </section>
    </main>
  );
}
