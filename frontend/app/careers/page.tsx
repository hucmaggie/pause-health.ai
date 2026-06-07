import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Careers",
  description:
    "Open founding roles at Pause-Health.ai. Three core seats (CMO, Head of AI, Head of Clinical Design) plus an always-open path for exceptional engineers and clinicians.",
  path: "/careers",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Careers at Pause-Health.ai."
});

/**
 * Careers page.
 *
 * Polished in the journey-fabric pass to reconcile with /about.
 *
 * The previous version listed four roles (Senior Clinical
 * Informaticist, Founding ML Engineer, Full-Stack Engineer,
 * Provider Partnerships Lead) that directly contradicted the
 * three roles on /about (CMO, Head of AI, Head of Clinical
 * Design). A reader visiting both pages would see two different
 * stories about what we're hiring for.
 *
 * This rebuild treats /about as the single source of truth for
 * what the founding team needs: CMO + Head of AI + Head of
 * Clinical Design. Each role carries the same description that
 * appears on /about. An "always open" card at the bottom catches
 * exceptional engineers or clinicians whose shape doesn't fit
 * the three named seats today.
 *
 * Location is normalized to "Remote (US) · Irvine, CA HQ" to
 * match the company's actual headquarters (the previous SF
 * location for the ML role was a leftover from earlier copy).
 *
 * Every open role carries a "Future" StatusPill so a reader can
 * tell at a glance that the seats are open, not filled.
 */

type Role = {
  title: string;
  team: string;
  focus: string;
  description: string;
};

// Mirrors the openRoles list on /about/page.tsx. Keep them in
// sync; the two pages share the same source-of-truth narrative
// about what the founding team needs.
const roles: Role[] = [
  {
    title: "Chief Medical Officer",
    team: "Clinical",
    focus: "Clinical strategy and evidence",
    description:
      "Board-certified OB/GYN with deep experience in midlife women's health, menopause hormone therapy, and clinical guidelines. Owns clinical safety, the menopause-care evidence base, and advisory-board curation. You'll partner with the founder to shape the Care Router's policy rules and the clinical-design partner program."
  },
  {
    title: "Head of AI",
    team: "AI",
    focus: "Models, evaluation, and safety",
    description:
      "Applied ML leader with a track record of shipping production AI in regulated healthcare environments. Owns the Care Router policy + evaluation harness, the grounding pipeline against JupyterHealth FHIR + DBDP features, and the trace + bias-monitoring infrastructure. You'll work in TypeScript + Python alongside Anthropic + MCP integrations."
  },
  {
    title: "Head of Clinical Design",
    team: "Design + Research",
    focus: "Workflow and patient experience",
    description:
      "Nurse-informaticist or clinically-trained designer building intake, triage, and care-navigation flows that feel humane and clear. Owns clinician + patient research, the design-partner program, and the experience layer the prototype demos today. You'll partner with the CMO on clinical safety and the Head of AI on what the LLM is allowed to say."
  }
];

const careersInquiryHref = `/contact?subject=${encodeURIComponent(
  "Careers inquiry"
)}&message=${encodeURIComponent(
  "Hi — I'd love to learn more about working at Pause-Health.ai.\n\nA bit about me:\n- Role I'm interested in:\n- Relevant experience:\n- Links (LinkedIn / portfolio):"
)}`;

export default function CareersPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Careers</p>
        <h1>Help us redefine midlife women&apos;s health.</h1>
        <p>
          Pause-Health.ai is a team of one (the founder) actively
          hiring the three founding seats that round out the core
          team. We&apos;re looking for clinicians, AI builders, and
          designers who want their work to meaningfully change
          menopause care — and who are comfortable starting from a
          prototype-in-the-open and shipping into production
          alongside provider organizations.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              Stage{" "}
              <StatusPill
                status="prototype"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Pre-design-partner; prototype in the open</strong>
          </li>
          <li>
            <span>Location</span>
            <strong>Remote (US) · Irvine, CA HQ</strong>
          </li>
          <li>
            <span>Hiring inbox</span>
            <strong>careers@pause-health.ai</strong>
          </li>
        </ul>
        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          <a href={careersInquiryHref} className="btn btn-primary">
            Start a conversation →
          </a>
          <a href="/about" className="btn btn-secondary">
            Learn about us →
          </a>
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
            Founding roles
          </p>
          <StatusPill status="future" label="All open · not filled" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          The three seats that round out the core team after the
          founder. Detailed job descriptions are being finalized
          alongside our first design-partner conversations; in the
          meantime, start a conversation via the inquiry form and
          tell us where you&apos;d like to contribute. We read
          every message.
        </p>
        <div className="card-grid">
          {roles.map((role) => (
            <article key={role.title} className="card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginBottom: "0.25rem"
                }}
              >
                <StatusPill status="future" label="Open role" />
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--muted)",
                    letterSpacing: "0.02em"
                  }}
                >
                  Remote (US)
                </span>
              </div>
              <h3 style={{ margin: "0.1rem 0 0.25rem" }}>{role.title}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  marginBottom: "0.5rem",
                  fontWeight: 600
                }}
              >
                {role.focus}
              </p>
              <p style={{ marginBottom: "0.85rem" }}>{role.description}</p>
              <a href={careersInquiryHref} className="btn btn-secondary">
                Express interest →
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Don&apos;t see your role?</p>
        <h2 style={{ fontSize: "clamp(1.3rem, 2.4vw, 1.8rem)", marginBottom: "0.5rem" }}>
          We&apos;re always interested in exceptional people.
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "70ch" }}>
          If you bring deep clinical, ML, full-stack, or operational
          experience that maps to what we&apos;re building — and the
          three named seats above aren&apos;t quite the right shape
          — send us a note anyway. The prototype is public at{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          if you want to skim the codebase before reaching out.
        </p>
        <div className="hero-actions" style={{ marginTop: "1rem" }}>
          <a href={careersInquiryHref} className="btn btn-primary">
            Start a conversation →
          </a>
          <a href="mailto:careers@pause-health.ai" className="btn btn-secondary">
            careers@pause-health.ai
          </a>
        </div>
      </section>
    </main>
  );
}
