import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Privacy",
  description:
    "What Pause-Health.ai collects on this site today (newsletter, contact form, basic analytics — never PHI), and the privacy posture engineered for the production stack pre-GA.",
  path: "/privacy",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Privacy — Pause-Health.ai."
});

/**
 * Privacy summary.
 *
 * Polished in the journey-fabric pass. The previous version was
 * a StubPage with three principle-framed bullets. Honest but
 * thin, and didn't reflect what the site actually collects.
 *
 * The page now distinguishes two scopes:
 *
 *   1. What the prototype-in-the-open collects today, listed by
 *      surface: marketing site (newsletter signups, contact-form
 *      submissions, basic web analytics), embedded chat (via
 *      Salesforce, not Pause-Health.ai's first-party store), demo
 *      personas (synthetic, no real PHI). Each entry maps to the
 *      actual code path that touches the data (e.g. /api/contact,
 *      /api/subscribe) so a privacy reviewer can verify.
 *
 *   2. What the production stack will collect once Covered Entity
 *      relationships are in force, framed against HIPAA + state
 *      privacy laws (CCPA / CPRA). Patient rights of access,
 *      amendment, deletion are mapped here.
 *
 * Full Privacy Policy is pre-GA; this page is a privacy
 * SUMMARY, not the binding legal document. That fact is
 * called out explicitly so a reader knows what they're reading.
 */

type DataCollection = {
  surface: string;
  whatWeCollect: string;
  whereItGoes: string;
  // Optional pill -- rows that describe purely-platform behavior
  // (Vercel analytics, server logs) don't carry a Pause-Health.ai
  // status pill because the posture is whatever the platform
  // provider's defaults are.
  status?: StatusPillStatus;
};

// Each row corresponds to an actual code path on the marketing
// site. Verifiable in github.com/hucmaggie/pause-health.ai.
const todayCollection: DataCollection[] = [
  {
    surface: "Newsletter signups",
    whatWeCollect: "Email address only.",
    whereItGoes:
      "Forwarded to a configured provider (Formspree / Resend / Mailchimp / Buttondown / ConvertKit) via /api/subscribe. If no provider is configured the server logs the email and drops it. Anti-bot check via Cloudflare Turnstile.",
    status: "prototype"
  },
  {
    surface: "Contact form (/contact)",
    whatWeCollect:
      "Name, email, subject, message. Pre-filled subject/message from URL params on inquiry-deep-links.",
    whereItGoes:
      "Forwarded to /api/contact -> configured provider (log / Formspree / Resend) and reaches the human inbox you'd expect (partners@ / invest@ / press@ / hello@). Anti-bot check via Cloudflare Turnstile.",
    status: "prototype"
  },
  {
    surface: "Web analytics",
    whatWeCollect:
      "Basic page-view + referrer telemetry via Vercel Analytics (if enabled in the deployment). No third-party advertising cookies. No cross-site tracking.",
    whereItGoes:
      "Aggregated dashboards in Vercel. Individual visitors are not identified."
  },
  {
    surface: "Embedded Agentforce chat",
    whatWeCollect:
      "Hosted by Salesforce, not by Pause-Health.ai. Messages typed into the chat go to the Salesforce-hosted Messaging Channel, governed by Salesforce's privacy terms.",
    whereItGoes:
      "Salesforce SCRT2 conversation infrastructure. The demo personas above the chat are synthetic; do NOT enter real personal health information into the prototype chat.",
    status: "prototype"
  },
  {
    surface: "Demo personas (Anika, Elena, etc.)",
    whatWeCollect:
      "Nothing about the visitor. The personas are seeded synthetic data baked into the codebase (lib/demo-cohort.ts).",
    whereItGoes:
      "Nowhere — the cohort is in-process state. Identity resolution against the Salesforce sandbox uses synthetic seed data only.",
    status: "prototype"
  },
  {
    surface: "Server logs",
    whatWeCollect:
      "Standard request logs (path, status, timing) on Vercel. Client IP is read for rate-limiting on the form endpoints (lib/anti-bot.ts) but not persisted to a first-party store.",
    whereItGoes: "Vercel platform logs, retained per Vercel defaults."
  }
];

const productionAreas: Array<{
  area: string;
  detail: string;
  status: StatusPillStatus;
}> = [
  {
    area: "PHI handling",
    detail:
      "PHI accessed only under BAA, only for the workflows the Covered Entity contracts for, and never used for marketing, sale, or fundraising.",
    status: "designed"
  },
  {
    area: "De-identification",
    detail:
      "Analytics and model evaluation use de-identified data sets following the HIPAA Safe Harbor + Expert Determination methods. Re-identification is contractually prohibited.",
    status: "designed"
  },
  {
    area: "Patient rights (access / amendment / deletion)",
    detail:
      "Pause-Health.ai supports the Covered Entity in fulfilling patient rights requests via documented APIs and runbooks; requests are routed through the patient's own provider organization.",
    status: "designed"
  },
  {
    area: "State privacy laws (CCPA / CPRA)",
    detail:
      "PHI handled under HIPAA is largely outside CCPA / CPRA scope, but the platform's marketing-site data (newsletter, contact) is treated under CCPA / CPRA rules for opt-out, correction, and deletion.",
    status: "designed"
  },
  {
    area: "Cookies & tracking",
    detail:
      "No third-party advertising or cross-site tracking cookies on the marketing site, today or planned. Authentication cookies in the production product are first-party and session-scoped.",
    status: "designed"
  },
  {
    area: "Data retention",
    detail:
      "Aligned with HIPAA Privacy Rule records-retention requirements (6 years) for PHI handled under BAA; marketing-site data retained only as long as the related operational purpose requires.",
    status: "planned"
  }
];

export default function PrivacyPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Privacy</p>
        <h1>Your data, treated with the care it deserves.</h1>
        <p>
          This page is a privacy <em>summary</em>, not the binding
          legal Privacy Policy — the full Policy will be published
          prior to general availability. It distinguishes what the
          public prototype actually collects today (marketing site
          signups, contact form, basic analytics — never PHI) from
          the privacy posture engineered for the production stack
          once design-partner relationships are in force.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              PHI collected by this site{" "}
              <StatusPill
                status="prototype"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>None · prototype-in-the-open</strong>
          </li>
          <li>
            <span>Third-party advertising trackers</span>
            <strong>None</strong>
          </li>
          <li>
            <span>
              Full Privacy Policy{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Pre-GA milestone</strong>
          </li>
          <li>
            <span>Privacy contact</span>
            <strong>privacy@pause-health.ai</strong>
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
            What this site collects today
          </p>
          <StatusPill status="prototype" label="Verifiable in code" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          One row per surface that touches user input. The codebase
          is public at{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          — a privacy reviewer can verify each claim against the
          referenced code path.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.85rem"
          }}
        >
          {todayCollection.map((c) => (
            <article key={c.surface} className="card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginBottom: "0.4rem"
                }}
              >
                <h3 style={{ margin: 0 }}>{c.surface}</h3>
                {c.status ? <StatusPill status={c.status} /> : null}
              </div>
              <p style={{ margin: "0 0 0.45rem", fontSize: "0.92rem" }}>
                <strong>What we collect: </strong>
                {c.whatWeCollect}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.88rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Where it goes: </strong>
                {c.whereItGoes}
              </p>
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
            What the production stack is designed to handle
          </p>
          <StatusPill status="designed" label="Pre-GA posture" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          The privacy framework engineered for the production
          deployment, once design-partner provider organizations are
          onboarded under BAA. Mapped against HIPAA Privacy Rule and
          state privacy laws (CCPA / CPRA). See{" "}
          <a href="/hipaa" style={{ color: "var(--brand)" }}>
            /hipaa
          </a>{" "}
          for the HIPAA-specific view and{" "}
          <a href="/security" style={{ color: "var(--brand)" }}>
            /security
          </a>{" "}
          for the technical controls.
        </p>
        <div className="card-grid">
          {productionAreas.map((a) => (
            <article key={a.area} className="card">
              <StatusPill
                status={a.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ margin: "0 0 0.3rem" }}>{a.area}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{a.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">For privacy questions or requests</p>
        <p style={{ color: "var(--muted)", maxWidth: "72ch", margin: 0 }}>
          Email{" "}
          <a
            href="mailto:privacy@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            privacy@pause-health.ai
          </a>
          . To unsubscribe from the newsletter, use the unsubscribe
          link in the email itself (the configured provider handles
          it) or email the inbox above. To delete a contact-form
          submission, email the same inbox referencing the date /
          subject and we&apos;ll purge it from the configured provider
          on our end.
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/hipaa" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          HIPAA notice
        </a>
        <a href="/security" className="btn btn-primary">
          Security &amp; compliance
        </a>
      </section>
    </main>
  );
}
