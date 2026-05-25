import type { ReactNode } from "react";

type DemoShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

const links = [
  { href: "/demo/intake", label: "Signal Intake" },
  { href: "/demo/patient", label: "Care Detail" },
  { href: "/demo/routing", label: "Care Routing" },
  { href: "/demo/analytics", label: "Outcome Analytics" }
];

export function DemoShell({ title, subtitle, children }: DemoShellProps) {
  return (
    <main className="container">
      <section className="hero">
        <a href="/" className="btn btn-secondary">
          Back to Home
        </a>
        <p className="eyebrow">Premium FemTech Prototype</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <nav className="demo-nav" aria-label="Prototype pages">
          {links.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </section>
      {children}
    </main>
  );
}
