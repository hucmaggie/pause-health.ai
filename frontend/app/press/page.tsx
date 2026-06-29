import Image from "next/image";
import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Press",
  description:
    "Press kit for Pause-Health.ai — pre-approved boilerplate, founder bio + headshot, brand assets, recent milestones, and the press contact. For journalists, analysts, and partnership announcements.",
  path: "/press",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Press kit — Pause-Health.ai."
});

/**
 * Press kit page.
 *
 * Replaces the previous one-line stub. A journalist or analyst
 * landing here can now copy approved boilerplate, download
 * brand assets directly, see recent milestones (pilled so they
 * can tell shipped from planned), grab the founder bio +
 * headshot, and reach press@pause-health.ai with a clear
 * response-time expectation.
 *
 * Honesty principles mirrored from /about: milestones are split
 * into Done vs. Planned with status pills, the team-of-one
 * (founder only) is stated clearly, and the "stage" line names
 * the prototype-in-the-open posture rather than implying scale.
 */

type Milestone = {
  year: string;
  label: string;
  status: StatusPillStatus;
};

type MediaMention = {
  /** Display name of the publisher / poster (e.g. "The Menopause Society"). */
  source: string;
  /** Handle if applicable (e.g. "@menopausesociety"). Omitted for non-social mentions. */
  handle?: string;
  /** Short quote or paraphrase of what the post says about Pause / menopause care. */
  quote: string;
  /** Absolute date when published (YYYY-MM-DD). */
  date: string;
  /** Outbound link to the source post. */
  href: string;
  /** Platform label rendered as a tag (Instagram, LinkedIn, etc.). */
  platform: string;
};

const mediaMentions: MediaMention[] = [
  // TODO: replace this placeholder with the real Instagram reel content.
  // The reel URL is https://www.instagram.com/reels/DZXz49gk70D/ — fill
  // in source/handle/quote/date once captured. Until then this entry
  // displays a clearly-flagged placeholder so the section structure
  // ships and the real content is a one-edit follow-up.
  {
    source: "TODO: account display name",
    handle: "@TODO_handle",
    quote:
      "TODO: paste the caption or key quote from the Instagram reel. Keep it short — one or two sentences is enough; the link sends readers to the full post.",
    date: "2026-06-28",
    href: "https://www.instagram.com/reels/DZXz49gk70D/",
    platform: "Instagram"
  }
];

const milestonesDone: Milestone[] = [
  {
    year: "2026",
    label: "Pause-Health.ai founded with provider-first AI thesis",
    status: "shipped"
  },
  {
    year: "2026",
    label: "Prototype open-sourced (github.com/hucmaggie/pause-health.ai)",
    status: "prototype"
  },
  {
    year: "2026",
    label: "Care Router agent + Data 360 grounding wired against Salesforce Health Cloud",
    status: "prototype"
  }
];

const milestonesPlanned: Milestone[] = [
  {
    year: "2026 H2",
    label: "Clinical advisory board formed across OB/GYN, endocrinology, primary care",
    status: "planned"
  },
  {
    year: "2026 H2",
    label: "First design-partner provider organizations onboarded",
    status: "planned"
  },
  {
    year: "2027",
    label: "Pilot deployments with provider organizations",
    status: "future"
  }
];

type BrandAsset = {
  href: string;
  label: string;
  detail: string;
};

const brandAssets: BrandAsset[] = [
  {
    href: "/brand/pause-health-logo.png",
    label: "Primary logo (color)",
    detail: "Full wordmark on transparent background. PNG, high-res."
  },
  {
    href: "/brand/pause-health-logo-monochrome.png",
    label: "Logo (monochrome)",
    detail: "Wordmark, monochrome. Use against branded color blocks."
  },
  {
    href: "/brand/pause-health-logo-mono-transparent.png",
    label: "Logo (mono on transparent)",
    detail: "Wordmark, monochrome, transparent background. Header use."
  },
  {
    href: "/brand/pause-health-logo-black-bg.png",
    label: "Logo (for dark backgrounds)",
    detail: "Wordmark optimized for dark / black backgrounds."
  },
  {
    href: "/brand/pause-health-icon.png",
    label: "Icon mark",
    detail: "Standalone icon, square aspect. Favicons, social avatars."
  },
  {
    href: "/team/maggie-c-hu.jpg",
    label: "Founder headshot — Maggie C. Hu",
    detail: "High-resolution portrait for bylines and interview features."
  }
];

const keyFacts: Array<{ label: string; value: string; status?: StatusPillStatus }> = [
  { label: "Company", value: "Pause-Health.ai" },
  { label: "Founded", value: "2026" },
  { label: "Headquarters", value: "Irvine, CA" },
  { label: "Founder | CEO | CTO", value: "Maggie C. Hu" },
  {
    label: "Focus",
    value: "Provider-first AI triage for menopause and perimenopause"
  },
  {
    label: "Stage",
    value: "Pre-design-partner; prototype open-sourced",
    status: "prototype"
  },
  {
    label: "Code",
    value: "github.com/hucmaggie/pause-health.ai"
  }
];

export default function PressPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Press kit</p>
        <h1>Press inquiries and brand assets.</h1>
        <p>
          For interviews, partnership announcements, or media coverage,
          here&apos;s everything you need to write about Pause-Health.ai
          accurately: pre-approved boilerplate, downloadable brand
          assets, the founder bio and headshot, and a fast inbox at{" "}
          <a
            href="mailto:press@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            press@pause-health.ai
          </a>
          .
        </p>
        <ul className="metric-list">
          <li>
            <span>Media contact</span>
            <strong>press@pause-health.ai</strong>
          </li>
          <li>
            <span>Response time</span>
            <strong>Within 2 business days</strong>
          </li>
          <li>
            <span>Brand assets</span>
            <strong>Below · direct download</strong>
          </li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Boilerplate · Approved for citation</p>
        <h2 style={{ fontSize: "clamp(1.3rem, 2.2vw, 1.7rem)", marginBottom: "0.6rem" }}>
          About Pause-Health.ai
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "72ch", marginBottom: "0.85rem" }}>
          Pause-Health.ai is a provider-first menopause intelligence company
          building the AI decision layer that care teams use to triage,
          ground, and route the 50M+ US women navigating perimenopause and
          menopause. The platform composes Salesforce Health Cloud +
          Agentforce, MuleSoft Anypoint, Model Context Protocol (MCP)
          servers, the JupyterHealth FHIR substrate, and Duke&apos;s Digital
          Biomarker Discovery Pipeline (DBDP) into a multi-agent fabric
          that delivers clinically explainable triage with end-to-end
          trace evidence.
        </p>
        <p style={{ color: "var(--muted)", maxWidth: "72ch", marginBottom: 0 }}>
          Founded in 2026 and headquartered in Irvine, California,
          Pause-Health.ai operates as a prototype-in-the-open today:
          the architecture, demo journey, and integration code are
          public at{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            github.com/hucmaggie/pause-health.ai
          </a>
          . The company is actively recruiting design-partner provider
          organizations for 2026 H2 pilots.
        </p>
      </section>

      {/*
        TODO: "Recent mentions" section — uncomment once the IG reel
        content is captured. The reel URL is
        https://www.instagram.com/reels/DZXz49gk70D/. Edit the
        `mediaMentions` array above (source / handle / quote / date)
        before un-commenting. Section structure is ready; only the
        real content is missing.

        <section style={{ marginTop: "1.5rem" }}>
          <p className="eyebrow">Recent mentions</p>
          <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
            External coverage and partner posts about Pause-Health.ai and
            menopause care. Each card links to the original post — the quotes
            here are excerpts, not the full piece.
          </p>
          <div className="card-grid" style={{ marginTop: "0.6rem" }}>
            {mediaMentions.map((m) => (
              <article key={m.href} className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "0.6rem",
                    marginBottom: "0.4rem"
                  }}
                >
                  <strong style={{ fontSize: "0.95rem" }}>{m.source}</strong>
                  <span
                    style={{
                      color: "var(--brand)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em"
                    }}
                  >
                    {m.platform}
                  </span>
                </div>
                {m.handle ? (
                  <p
                    style={{
                      color: "var(--muted)",
                      fontSize: "0.85rem",
                      margin: "0 0 0.6rem"
                    }}
                  >
                    {m.handle}
                  </p>
                ) : null}
                <blockquote
                  style={{
                    margin: "0 0 0.75rem",
                    paddingLeft: "0.8rem",
                    borderLeft: "3px solid var(--brand)",
                    color: "var(--text)",
                    fontStyle: "italic"
                  }}
                >
                  {m.quote}
                </blockquote>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "auto"
                  }}
                >
                  <time
                    dateTime={m.date}
                    style={{ color: "var(--muted)", fontSize: "0.85rem" }}
                  >
                    {m.date}
                  </time>
                  <a
                    href={m.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--brand)", fontWeight: 600, fontSize: "0.9rem" }}
                  >
                    View post →
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      */}

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Key facts</p>
        <article className="card" style={{ marginTop: "0.6rem" }}>
          <ul className="metric-list" style={{ margin: 0 }}>
            {keyFacts.map((f) => (
              <li key={f.label}>
                <span>
                  {f.label}
                  {f.status ? (
                    <StatusPill
                      status={f.status}
                      style={{
                        marginLeft: "0.4rem",
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.45rem"
                      }}
                    />
                  ) : null}
                </span>
                <strong>{f.value}</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Founder bio</p>
        <article className="card founder-card" style={{ marginTop: "0.6rem" }}>
          <Image
            src="/team/maggie-c-hu.jpg"
            alt="Portrait of Maggie C. Hu, Founder | CEO | CTO of Pause-Health.ai."
            width={200}
            height={200}
            sizes="(max-width: 600px) 160px, 200px"
            className="founder-photo"
          />
          <div>
            <h3 style={{ marginBottom: "0.25rem" }}>Maggie C. Hu</h3>
            <p
              style={{
                color: "var(--brand)",
                fontWeight: 600,
                marginBottom: "0.6rem"
              }}
            >
              Founder | CEO | CTO, Pause-Health.ai
            </p>
            <p style={{ marginBottom: "0.5rem" }}>
              Maggie C. Hu is the founder, CEO, and CTO of Pause-Health.ai,
              where she leads product, vision, and provider partnerships.
              Her background spans health-tech product leadership and
              applied AI, with a focus on building clinical software
              that care teams actually want to use.
            </p>
            <p style={{ marginBottom: "0.5rem", color: "var(--muted)" }}>
              She founded Pause-Health.ai to bring the same standard of
              precision, rigor, and empathy to menopause care that
              other transitions in modern medicine already enjoy. The
              company operates as a prototype-in-the-open, with its
              architecture and integration code published on GitHub.
            </p>
            <p
              style={{
                marginTop: "0.65rem",
                fontSize: "0.85rem",
                color: "var(--muted)"
              }}
            >
              For interview requests, please contact{" "}
              <a
                href="mailto:press@pause-health.ai"
                style={{ color: "var(--brand)" }}
              >
                press@pause-health.ai
              </a>
              {" · "}
              <a
                href="https://www.linkedin.com/in/hucmaggie/"
                target="_blank"
                rel="noopener noreferrer me"
                style={{ color: "var(--brand)" }}
              >
                LinkedIn
              </a>
              .
            </p>
          </div>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Brand assets</p>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          High-resolution logo files and the founder headshot for use in
          articles, decks, and announcements. Please don&apos;t alter the
          wordmark or recompose the icon. If you need a different format
          (SVG, EPS), email{" "}
          <a
            href="mailto:press@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            press@pause-health.ai
          </a>{" "}
          and we&apos;ll get it to you within a business day.
        </p>
        <div className="card-grid">
          {brandAssets.map((a) => (
            <a
              key={a.href}
              href={a.href}
              download
              className="card"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem"
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>{a.label}</h3>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.88rem"
                }}
              >
                {a.detail}
              </p>
              <span
                style={{
                  marginTop: "auto",
                  color: "var(--brand)",
                  fontSize: "0.85rem",
                  fontWeight: 600
                }}
              >
                Download →
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Milestones</p>
        <p style={{ color: "var(--muted)", margin: "0.2rem 0 0.6rem", fontSize: "0.9rem" }}>
          Done so far vs. planned. The 2026 milestones below are pilled so
          a journalist can immediately distinguish what shipped from
          what&apos;s on the near-term roadmap.
        </p>

        <h4 style={{ margin: "0.6rem 0 0.3rem", fontSize: "0.95rem" }}>Done</h4>
        <ul className="metric-list" style={{ marginTop: 0 }}>
          {milestonesDone.map((m, i) => (
            <li key={`done-${i}`}>
              <span>
                {m.label}{" "}
                <StatusPill
                  status={m.status}
                  style={{
                    marginLeft: "0.3rem",
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.45rem"
                  }}
                />
              </span>
              <strong>{m.year}</strong>
            </li>
          ))}
        </ul>

        <h4 style={{ margin: "1rem 0 0.3rem", fontSize: "0.95rem" }}>Planned</h4>
        <ul className="metric-list" style={{ marginTop: 0 }}>
          {milestonesPlanned.map((m, i) => (
            <li key={`planned-${i}`}>
              <span>
                {m.label}{" "}
                <StatusPill
                  status={m.status}
                  style={{
                    marginLeft: "0.3rem",
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.45rem"
                  }}
                />
              </span>
              <strong>{m.year}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">For editorial depth</p>
        <div className="card-grid">
          <article className="card">
            <h3 style={{ marginTop: 0 }}>Architecture story</h3>
            <p style={{ color: "var(--muted)" }}>
              Per-substrate deep dives on the investor brief: Agentforce,
              MuleSoft, MCP, Data 360, JupyterHealth, DBDP, the Agent
              Fabric. Each page is proto-vs-prod honest with live API
              CTAs.
            </p>
            <a href="/proposal" className="btn btn-primary">
              Open the investor brief →
            </a>
          </article>
          <article className="card">
            <h3 style={{ marginTop: 0 }}>Working surfaces</h3>
            <p style={{ color: "var(--muted)" }}>
              Five demo pages walk through intake → Care Detail → Care
              Router → Agent Fabric trace inspector → outcome analytics.
              Useful for screenshots and product walkthroughs.
            </p>
            <a href="/demo/intake" className="btn btn-primary">
              Open the prototype →
            </a>
          </article>
          <article className="card">
            <h3 style={{ marginTop: 0 }}>Source code</h3>
            <p style={{ color: "var(--muted)" }}>
              The full integration code, demo personas, and architecture
              docs are public. Useful for technical features and
              architecture profiles.
            </p>
            <a
              href="https://github.com/hucmaggie/pause-health.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              Open the repository →
            </a>
          </article>
        </div>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/contact" className="btn btn-primary">
          Contact Us
        </a>
      </section>
    </main>
  );
}
