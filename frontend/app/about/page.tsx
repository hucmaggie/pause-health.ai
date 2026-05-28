import Image from "next/image";
import { pageMetadata } from "../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "About",
  description:
    "A team building the menopause intelligence layer healthcare deserves — mission, values, and how we work.",
  path: "/about",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "About Pause-Health.ai — building the menopause intelligence layer healthcare deserves."
});

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

const team = [
  {
    name: "Chief Medical Officer",
    role: "Clinical strategy and evidence",
    bio: "Board-certified OB/GYN with deep experience in midlife women's health, menopause hormone therapy, and clinical guidelines."
  },
  {
    name: "Head of AI",
    role: "Models, evaluation, and safety",
    bio: "Applied ML leader with a track record of shipping production AI in regulated healthcare environments."
  },
  {
    name: "Head of Clinical Design",
    role: "Workflow and patient experience",
    bio: "Nurse-informaticist designing intake, triage, and care navigation flows that feel humane and clear."
  }
];

const milestones = [
  { year: "2026", label: "Pause-Health.ai founded with provider-first AI thesis" },
  { year: "2026", label: "Clinical advisory board formed across OB/GYN, endocrinology, and primary care" },
  { year: "2026", label: "First prototype released to design partners" },
  { year: "2027", label: "Pilot deployments with provider organizations" }
];

export default function AboutPage() {
  return (
    <main className="container">
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
          <li>
            <span>Founded</span>
            <strong>2026</strong>
          </li>
          <li>
            <span>Headquarters</span>
            <strong>Irvine, CA</strong>
          </li>
          <li>
            <span>Focus</span>
            <strong>Provider-first AI for menopause care</strong>
          </li>
          <li>
            <span>Stage</span>
            <strong>Early prototype with design partners</strong>
          </li>
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
          believe a thoughtful AI layer — built with clinicians, validated against evidence, and
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
            alt="Portrait of Maggie C. Hu, Founder & CEO of Pause-Health.ai."
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
              Founder &amp; CEO
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
            <p className="founder-links" style={{ marginTop: "0.75rem" }}>
              <a
                href="https://www.linkedin.com/in/hucmaggie/"
                target="_blank"
                rel="noopener noreferrer me"
                aria-label="Maggie C. Hu on LinkedIn (opens in a new tab)"
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
                <span>LinkedIn</span>
              </a>
            </p>
          </div>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Team we&apos;re building</p>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          A small, mission-driven team across product, clinical, AI, and design.
          These are the founding roles we&apos;re actively hiring for; detailed
          bios and headshots will land here as the team grows.
        </p>
        <div className="card-grid">
          {team.map((member) => (
            <article key={member.name} className="card">
              <h3>{member.name}</h3>
              <p style={{ color: "var(--brand)", marginBottom: "0.4rem", fontWeight: 600 }}>
                {member.role}
              </p>
              <p>{member.bio}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Milestones</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {milestones.map((m, i) => (
            <li key={`${m.year}-${i}`}>
              <span>{m.label}</span>
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
