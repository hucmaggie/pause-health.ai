import { ContactForm } from "../../components/contact-form";
import { pageMetadata } from "../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Contact",
  description:
    "Get in touch with Pause-Health.ai. Provider partnerships, investors, technical, media, or general inquiries — each persona has a dedicated inbox and a clear response-time expectation.",
  path: "/contact",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Contact Pause-Health.ai."
});

/**
 * Contact page.
 *
 * Polished in the journey-fabric pass. The previous version was a
 * working contact form plus four email aliases with no guidance on
 * which to use, what to include, or how fast we'd respond. This
 * version keeps the form intact (it's wired and working) but
 * upgrades the surrounding context:
 *
 *   - Each email alias now describes WHO it's for, WHAT to include
 *     in the first message, and the response-time SLA. A provider
 *     pilot inquiry looks very different from a technical bug
 *     report; the page now reflects that.
 *   - Sub-persona quick links to /careers, /press, /security, and
 *     the GitHub issue tracker so a reader can self-route to the
 *     right surface when their inquiry is better handled by a
 *     dedicated page.
 *   - Response-time expectation set explicitly (2 business days)
 *     so a reader who emails knows the bound.
 */

type Inbox = {
  audience: string;
  email: string;
  whatToInclude: string;
  responseTime: string;
};

const inboxes: Inbox[] = [
  {
    audience: "Provider partnerships",
    email: "partners@pause-health.ai",
    whatToInclude:
      "Your organization, the clinical setting (IDN, AMC, FQHC, payer-provider), approximate menopause-care volume, and what you'd like to learn or pilot. We can usually be in a Zoom within a week.",
    responseTime: "1 business day"
  },
  {
    audience: "Investors",
    email: "invest@pause-health.ai",
    whatToInclude:
      "Fund name, stage focus, check size range, and any thesis areas (women's health, vertical AI agents, healthcare data infrastructure) where Pause-Health.ai fits. The investor brief at /proposal is the right read-deeper.",
    responseTime: "1 business day"
  },
  {
    audience: "Media",
    email: "press@pause-health.ai",
    whatToInclude:
      "Outlet, story angle, target publish date, and any specific quotes / data points you need. The press kit at /press has pre-approved boilerplate, brand assets, and founder bio you can use right now.",
    responseTime: "2 business days"
  },
  {
    audience: "General inquiries",
    email: "hello@pause-health.ai",
    whatToInclude:
      "Anything that doesn't fit the inboxes above — clinicians wanting to advise, women asking about care access, students wanting to learn. We read every one.",
    responseTime: "Within 3 business days"
  }
];

type SelfRoute = {
  label: string;
  href: string;
  detail: string;
  external?: boolean;
};

const selfRoutes: SelfRoute[] = [
  {
    label: "Careers · /careers",
    href: "/careers",
    detail:
      "Open roles (CMO, Head of AI, Head of Clinical Design). Apply directly rather than emailing a generic inbox."
  },
  {
    label: "Press kit · /press",
    href: "/press",
    detail:
      "Approved boilerplate, downloadable logos, founder bio + headshot. Most media questions are answered here without an email."
  },
  {
    label: "Security & compliance · /security",
    href: "/security",
    detail:
      "Compliance posture (HIPAA today, HITRUST + SOC 2 Type II planned), data handling, vulnerability reports."
  },
  {
    label: "Source code & issues",
    href: "https://github.com/hucmaggie/pause-health.ai",
    detail:
      "Technical bug reports, integration questions, and pull requests are easier to handle as GitHub issues than email.",
    external: true
  }
];

export default function ContactPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Contact</p>
        <h1>Let&apos;s talk about menopause care.</h1>
        <p>
          Whether you&apos;re a provider organization, an investor, a
          clinician, or a patient advocate — we&apos;d love to hear from
          you. Send a message below, or use the inbox that best fits
          your role. We aim to respond within{" "}
          <strong>two business days</strong>; provider and investor
          inquiries usually move faster.
        </p>
      </section>

      <section className="contact-grid" style={{ marginTop: "1.25rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Send us a message</h3>
          <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
            Tell us a little about your role and what you&apos;d like to
            discuss. We&apos;ll route your message to the right inbox on
            our end.
          </p>
          <ContactForm />
        </div>

        <aside className="card">
          <h3 style={{ marginTop: 0 }}>Or email the right inbox directly</h3>
          <p
            style={{
              color: "var(--muted)",
              fontSize: "0.88rem",
              marginBottom: "0.75rem"
            }}
          >
            Each inbox routes to a different drafter, so picking the right
            one gets you a faster, better-informed reply.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem"
            }}
          >
            {inboxes.map((inbox) => (
              <div
                key={inbox.email}
                style={{
                  borderTop: "1px solid var(--line)",
                  paddingTop: "0.7rem"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "0.5rem",
                    flexWrap: "wrap"
                  }}
                >
                  <strong style={{ fontSize: "0.95rem" }}>
                    {inbox.audience}
                  </strong>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                      letterSpacing: "0.03em"
                    }}
                  >
                    Response: {inbox.responseTime}
                  </span>
                </div>
                <p
                  style={{
                    margin: "0.2rem 0 0.3rem",
                    fontSize: "0.92rem"
                  }}
                >
                  <a
                    href={`mailto:${inbox.email}`}
                    style={{ color: "var(--brand)", fontWeight: 600 }}
                  >
                    {inbox.email}
                  </a>
                </p>
                <p
                  style={{
                    margin: 0,
                    color: "var(--muted)",
                    fontSize: "0.85rem"
                  }}
                >
                  {inbox.whatToInclude}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Self-route — these pages may answer your question faster than an email</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {selfRoutes.map((r) => (
            <a
              key={r.href}
              href={r.href}
              {...(r.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="card"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: "0.45rem"
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>{r.label}</h3>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.88rem"
                }}
              >
                {r.detail}
              </p>
              <span
                style={{
                  marginTop: "auto",
                  color: "var(--brand)",
                  fontSize: "0.85rem",
                  fontWeight: 600
                }}
              >
                Open →
              </span>
            </a>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/about" className="btn btn-secondary">
          About Pause-Health.ai
        </a>
      </section>
    </main>
  );
}
