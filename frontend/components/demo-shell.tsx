import type { ReactNode } from "react";
import { DemoShellNav } from "./demo-shell-nav";

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
        {/*
         * `hero-copy` is the shared semantic marker across the demo
         * console and the investor-brief shells. Both surfaces
         * currently inherit their hero-paragraph styling from
         * `.hero p` in globals.css, but the class makes future
         * per-shell overrides trivial without splintering markup.
         */}
        <p className="hero-copy">{subtitle}</p>
        {/*
         * In-page nav is split into its own client subcomponent so
         * it can read `?personaId=` (and a few other small params)
         * from the URL via useSearchParams() and append them to each
         * link, preserving persona context across shell-nav clicks.
         * The shell itself stays server-rendered.
         */}
        <DemoShellNav />
      </section>
      {children}
    </main>
  );
}
