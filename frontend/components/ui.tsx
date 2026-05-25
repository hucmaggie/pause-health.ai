import type { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  kind?: "primary" | "secondary";
};

export function Button({ children, kind = "primary" }: ButtonProps) {
  return (
    <button className={`btn btn-${kind}`} type="button">
      {children}
    </button>
  );
}

type SectionProps = {
  id?: string;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
};

export function Section({ id, title, eyebrow, subtitle, children }: SectionProps) {
  return (
    <section id={id} className="section">
      <div className="container">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </section>
  );
}

type CardProps = {
  title: string;
  description: string;
};

export function Card({ title, description }: CardProps) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}
