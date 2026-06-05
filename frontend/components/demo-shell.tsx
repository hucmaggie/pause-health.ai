import type { ReactNode } from "react";

type DemoShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /**
   * Optional eyebrow override. Defaults to "Premium FemTech Prototype".
   * Useful for deeper-dive tools (e.g. the Agent Fabric console)
   * that should advertise themselves distinctly while still sharing
   * the same shell + cross-page nav.
   */
  eyebrow?: string;
  /** Optional URL for the "Back to ..." button. Defaults to "/". */
  backHref?: string;
  /** Optional label for the "Back to ..." button. Defaults to "Back to Home". */
  backLabel?: string;
};

const links = [
  { href: "/demo/intake", label: "Signal Intake" },
  { href: "/demo/patient", label: "Care Detail" },
  { href: "/demo/routing", label: "Care Routing" },
  { href: "/demo/analytics", label: "Outcome Analytics" },
  { href: "/demo/agent-fabric", label: "Agent Fabric" }
];

export function DemoShell({
  title,
  subtitle,
  children,
  eyebrow = "Premium FemTech Prototype",
  backHref = "/",
  backLabel = "Back to Home"
}: DemoShellProps) {
  return (
    <main className="container">
      <section className="hero">
        <a href={backHref} className="btn btn-secondary">
          {backLabel}
        </a>
        <p className="eyebrow">{eyebrow}</p>
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
