export const metadata = { title: "Careers | Pause-Health.ai" };

const roles = [
  {
    title: "Senior Clinical Informaticist",
    team: "Clinical",
    location: "Remote (US)"
  },
  {
    title: "Founding ML Engineer",
    team: "AI",
    location: "San Francisco / Remote"
  },
  {
    title: "Full-Stack Engineer",
    team: "Engineering",
    location: "Remote (US)"
  },
  {
    title: "Provider Partnerships Lead",
    team: "Go-to-Market",
    location: "Remote (US)"
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
        <h1>Help us redefine midlife women's health.</h1>
        <p>
          We're a small, mission-driven team hiring across clinical informatics, ML, full-stack
          engineering, design, and provider partnerships. If you want your work to meaningfully
          change menopause care, we'd love to hear from you.
        </p>
        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          <a href={careersInquiryHref} className="btn btn-primary">
            View Open Positions
          </a>
          <a href="/about" className="btn btn-secondary">
            Learn About Us
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Open roles</p>
        <p style={{ color: "var(--muted)", maxWidth: "65ch", marginBottom: "0.75rem" }}>
          Detailed job descriptions are in progress. In the meantime, drop us a note via the
          inquiry form below and tell us where you'd like to contribute.
        </p>
        <div className="card-grid">
          {roles.map((role) => (
            <article key={role.title} className="card">
              <h3>{role.title}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {role.team}
              </p>
              <p style={{ color: "var(--muted)" }}>{role.location}</p>
              <p style={{ marginTop: "0.75rem" }}>
                <a href={careersInquiryHref} className="btn btn-secondary">
                  Express Interest
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Don't see your role?</p>
        <h2 style={{ fontSize: "clamp(1.3rem, 2.4vw, 1.8rem)", marginBottom: "0.5rem" }}>
          We're always interested in exceptional people.
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "70ch" }}>
          If you bring deep clinical, technical, or operational experience that maps to what we're
          building, send us a note. We read every message.
        </p>
        <div className="hero-actions" style={{ marginTop: "1rem" }}>
          <a href={careersInquiryHref} className="btn btn-primary">
            Start a Conversation
          </a>
          <a href="mailto:careers@pause-health.ai" className="btn btn-secondary">
            careers@pause-health.ai
          </a>
        </div>
      </section>
    </main>
  );
}
