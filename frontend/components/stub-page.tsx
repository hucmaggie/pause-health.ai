import type { ReactNode } from "react";

type StubPageProps = {
  eyebrow?: string;
  title: string;
  intro: string;
  children?: ReactNode;
};

export function StubPage({ eyebrow = "Pause-Health.ai", title, intro, children }: StubPageProps) {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
        {children ? <div style={{ marginTop: "1.25rem" }}>{children}</div> : null}
        <div style={{ marginTop: "1.5rem" }}>
          <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
            Back to Home
          </a>
          <a href="/contact" className="btn btn-primary">
            Contact Us
          </a>
        </div>
      </section>
    </main>
  );
}
