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
    name: "Maggie C. Hu",
    role: "Founder & CEO — Product, vision, and provider partnerships",
    bio: "Background in health-tech product leadership, focused on building AI that clinicians actually want to use."
  },
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
        <p className="eyebrow">Team</p>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          A small, mission-driven team across product, clinical, AI, and design. Detailed bios and
          headshots coming soon as the team grows.
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
