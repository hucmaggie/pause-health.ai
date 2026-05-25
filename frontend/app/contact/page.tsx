import { ContactForm } from "../../components/contact-form";

export const metadata = { title: "Contact | Pause-Health.ai" };

export default function ContactPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Contact</p>
        <h1>Let's talk about menopause care.</h1>
        <p>
          Whether you're a provider organization, an investor, a clinician, or a patient advocate
          — we'd love to hear from you. Send us a message below or use the inbox that fits best.
        </p>
      </section>

      <section className="contact-grid">
        <div className="card">
          <h3>Send us a message</h3>
          <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
            Tell us a little about your role and what you'd like to discuss.
          </p>
          <ContactForm />
        </div>

        <aside className="card">
          <h3>Or email us directly</h3>
          <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
            <li>
              <span>Provider partnerships</span>
              <strong>partners@pause-health.ai</strong>
            </li>
            <li>
              <span>Investors</span>
              <strong>invest@pause-health.ai</strong>
            </li>
            <li>
              <span>General inquiries</span>
              <strong>hello@pause-health.ai</strong>
            </li>
            <li>
              <span>Media</span>
              <strong>press@pause-health.ai</strong>
            </li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
