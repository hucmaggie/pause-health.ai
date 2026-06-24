import Image from "next/image";
import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

/**
 * Founder Person JSON-LD. Mirrors the root Organization.founder block
 * but is emitted on /about so search engines + LinkedIn previewers can
 * resolve the founder card to a Person identity directly from this
 * page (without traversing the org graph at /). The `sameAs` array is
 * the verifiable bridge: LinkedIn + the GitHub org. Keep this in sync
 * with the founder block in app/layout.tsx — there's no shared module
 * because the static-literal form is what Next can ship into the
 * application/ld+json script tag.
 */
const FOUNDER_PERSON_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://www.linkedin.com/in/hucmaggie/",
  name: "Maggie C. Hu",
  jobTitle: "Founder | CEO | CTO",
  image: "https://pause-health.ai/team/maggie-c-hu.jpg",
  url: "https://pause-health.ai/about",
  worksFor: {
    "@type": "Organization",
    "@id": "https://pause-health.ai/#organization",
    name: "Pause-Health.ai"
  },
  sameAs: [
    "https://www.linkedin.com/in/hucmaggie/",
    "https://github.com/hucmaggie"
  ]
} as const;

const LINKEDIN_HANDLE = "hucmaggie";
const LINKEDIN_URL = `https://www.linkedin.com/in/${LINKEDIN_HANDLE}/`;

export const metadata = pageMetadata({
  title: "About",
  description:
    "A team building the menopause intelligence layer healthcare deserves — mission, values, and how we work.",
  path: "/about",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "About Pause-Health.ai — building the menopause intelligence layer healthcare deserves."
});

/**
 * About page.
 *
 * Polished in the journey-fabric pass to remove a credibility risk:
 * the previous version listed three roles (CMO, Head of AI, Head
 * of Clinical Design) under a section titled "Team we're building"
 * with full role descriptions and bios. A fast reader could miss
 * the eyebrow and assume those were filled positions. Same issue
 * with the milestones list -- "Clinical advisory board formed"
 * was listed as a 2026 fact when it's a planned milestone.
 *
 * Honest framing this rebuild applies:
 *
 *   - "Open roles we're hiring for" replaces "Team we're building",
 *     each role pilled `future` to be unmissable about what's
 *     filled and what isn't.
 *   - Founder card unchanged -- Maggie is the only real team
 *     member today, so she keeps the dedicated card and is
 *     visually distinct from the hiring slots.
 *   - Milestones split into "Done" and "Planned" with status
 *     pills, so a 2026 reader can immediately tell which year-
 *     2026 items shipped and which are still on the roadmap.
 *   - Hero metric "Stage" updated to match how /proposal/insights
 *     describes it: pre-design-partner, prototype in the open.
 */

const values = [
  {
    title: "Clinically grounded",
    description:
      "Every recommendation must be defensible, explainable, and traceable to established menopause clinical evidence."
  },
  {
    title: "Designed with empathy",
    description:
      "Women in midlife deserve care that listens. Our product is shaped with patients, nurses, and physicians in the room."
  },
  {
    title: "Provider-first",
    description:
      "We build for the care teams who do the hardest work — fitting into existing workflows, not adding to their load."
  },
  {
    title: "Privacy as a default",
    description:
      "Patient trust is non-negotiable. Data minimization, encryption, and audit logging are foundational, not optional."
  }
];

// Roles Pause is hiring for. Each is pilled `future` so a reader
// can't mistake them for filled positions -- this section is a
// careers preview, not a team roster. The actual team-of-one
// (Maggie) is in the founder card above.
type OpenRole = {
  title: string;
  focus: string;
  description: string;
};

const openRoles: OpenRole[] = [
  {
    title: "Chief Medical Officer",
    focus: "Clinical strategy and evidence",
    description:
      "Board-certified OB/GYN with deep experience in midlife women's health, menopause hormone therapy, and clinical guidelines. Owns clinical safety + advisory-board curation."
  },
  {
    title: "Head of AI",
    focus: "Models, evaluation, and safety",
    description:
      "Applied ML leader with a track record of shipping production AI in regulated healthcare environments. Owns Care Router policy + evaluation harness."
  },
  {
    title: "Head of Clinical Design",
    focus: "Workflow and patient experience",
    description:
      "Nurse-informaticist designing intake, triage, and care navigation flows that feel humane and clear. Owns clinician + patient research and the design partner program."
  }
];

type Milestone = {
  year: string;
  label: string;
  status: StatusPillStatus;
};

// Milestones split between Done (status `shipped`/`prototype`) and
// Planned (status `planned`/`future`). The previous version listed
// "Clinical advisory board formed" and "First prototype released
// to design partners" as 2026 facts; the prototype IS released
// publicly but the advisory board and design partners are still
// planned. Honest framing makes that explicit.
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

type HeroMetric = {
  label: string;
  value: string;
  status?: StatusPillStatus;
};

const heroMetrics: HeroMetric[] = [
  { label: "Founded", value: "2026" },
  { label: "Headquarters", value: "Irvine, CA" },
  { label: "Focus", value: "Provider-first AI for menopause care" },
  {
    label: "Stage",
    value: "Pre-design-partner; prototype in the open",
    status: "prototype"
  }
];

export default function AboutPage() {
  return (
    <main className="container">
      {/*
        Person JSON-LD for the founder. Lets search engines and any
        social previewer that lands on /about (instead of /) resolve
        the founder card to her LinkedIn identity directly. See the
        FOUNDER_PERSON_JSON_LD declaration for the schema rationale.
      */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(FOUNDER_PERSON_JSON_LD)
        }}
      />
      <section className="hero">
        <p className="eyebrow">About Us</p>
        <h1>Building the menopause intelligence layer healthcare deserves.</h1>
        <p>
          Pause-Health.ai is on a mission to bring precision, empathy, and clinical rigor to the
          50M+ women in the United States navigating perimenopause and menopause. We combine deep
          clinical informatics, modern AI, and human-centered design to support care teams and the
          women they serve.
        </p>
        <ul className="metric-list">
          {heroMetrics.map((m) => (
            <li key={m.label}>
              <span>
                {m.label}
                {m.status ? (
                  <StatusPill
                    status={m.status}
                    style={{
                      marginLeft: "0.4rem",
                      fontSize: "0.7rem",
                      padding: "0.1rem 0.45rem"
                    }}
                  />
                ) : null}
              </span>
              <strong>{m.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Mission</p>
        <h2 style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)", marginBottom: "0.6rem" }}>
          Help every woman in midlife receive the right care, sooner.
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "70ch" }}>
          Menopause is one of the most under-served transitions in modern medicine. Misdiagnosis
          rates remain high, and the average path to accurate care can stretch for years. We
          believe a thoughtful AI layer — built with clinicians, evaluated against evidence, and
          designed for real workflows — can compress that journey from years to weeks.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">What we value</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {values.map((value) => (
            <article key={value.title} className="card">
              <h3>{value.title}</h3>
              <p>{value.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Founder</p>
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
              Founder | CEO | CTO
            </p>
            <p style={{ marginBottom: "0.5rem" }}>
              Maggie leads product, vision, and provider partnerships at
              Pause-Health.ai. Her background spans health-tech product
              leadership and applied AI, with a focus on building clinical
              software that care teams actually want to use.
            </p>
            <p style={{ color: "var(--muted)" }}>
              She founded Pause-Health.ai to bring the same standard of
              precision, rigor, and empathy to menopause care that other
              transitions in modern medicine already enjoy.
            </p>
            <p className="founder-links" style={{ marginTop: "0.85rem" }}>
              <a
                className="founder-cta"
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer me author"
                aria-label={`Connect with Maggie C. Hu on LinkedIn (linkedin.com/in/${LINKEDIN_HANDLE} — opens in a new tab)`}
              >
                <svg
                  className="founder-social-icon"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M20.45 20.45h-3.55v-5.56c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.65H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0z" />
                </svg>
                <span className="founder-cta-label">Connect on LinkedIn</span>
                <span className="founder-cta-handle">
                  linkedin.com/in/{LINKEDIN_HANDLE}
                </span>
              </a>
            </p>
            <p
              className="founder-verify"
              style={{ marginTop: "0.45rem" }}
            >
              Verify it&apos;s the right profile: the LinkedIn page lists
              Pause-Health.ai as the current company, with this site
              (<span style={{ fontWeight: 600 }}>pause-health.ai</span>)
              in the contact info.
            </p>
          </div>
        </article>
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
            Open roles we&apos;re hiring for
          </p>
          <StatusPill status="future" label="Not filled yet" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          The founding roles that round out the team after the founder.
          Each card describes the role we&apos;re hiring for, not a person
          already on staff. If one of these resonates, please reach out
          via{" "}
          <a href="/careers" style={{ color: "var(--brand)" }}>
            /careers
          </a>{" "}
          or{" "}
          <a href="/contact" style={{ color: "var(--brand)" }}>
            /contact
          </a>
          .
        </p>
        <div className="card-grid">
          {openRoles.map((role) => (
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
              </div>
              <h3 style={{ margin: "0.1rem 0 0.25rem" }}>{role.title}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  marginBottom: "0.4rem",
                  fontWeight: 600
                }}
              >
                {role.focus}
              </p>
              <p>{role.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Milestones</p>
        <p style={{ color: "var(--muted)", margin: "0.2rem 0 0.6rem", fontSize: "0.9rem" }}>
          Done so far vs. planned. The 2026 milestones below are pilled so
          a reader at any point in time can tell what shipped from what&apos;s
          still on the roadmap.
        </p>

        <h4 style={{ margin: "0.6rem 0 0.3rem", fontSize: "0.95rem" }}>
          Done
        </h4>
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

        <h4 style={{ margin: "1rem 0 0.3rem", fontSize: "0.95rem" }}>
          Planned
        </h4>
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

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/contact" className="btn btn-primary">
          Get in Touch
        </a>
      </section>
    </main>
  );
}
