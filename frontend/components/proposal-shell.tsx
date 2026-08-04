import type { ReactNode } from "react";
import { ProposalShellNav } from "./proposal-shell-nav";
import { ProposalJourneyFooter } from "./proposal-journey-footer";

type ProposalShellProps = {
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  /**
   * Optional URL for the "Back to ..." button. Defaults to
   * "/proposal" so the great majority of briefs get a link back to
   * the hub for free. Kept configurable to match the DemoShell
   * prop surface — deep-linked landing pages (e.g. an emailed
   * link that lands on /proposal/agent-fabric from an investor
   * inbox) can override this to point at wherever the reader came
   * from.
   */
  backHref?: string;
  /** Optional label for the "Back to ..." button. */
  backLabel?: string;
  /**
   * Optional content rendered inside the <section className="hero">
   * block, AFTER the subtitle and BEFORE the section nav. This is
   * how a page can extend the hero with page-specific affordances
   * (metric-list of hero points, an inline CTA row, etc.) while
   * still keeping the hero visually coherent with the rest of the
   * proposal shell. The hub (/proposal) uses this to mount its
   * heroPoints list and the three top-level Open/Prototype/Landing
   * CTA row without hand-rolling the shell.
   */
  heroExtra?: ReactNode;
  /**
   * Whether to render the multi-brief section nav in the hero.
   * Defaults to true. Set false on pages where the section list
   * is either the primary content (the hub, which shows both
   * strategy and architecture card grids that already link to
   * every brief) or would look out of place (a landing / rollup
   * page with its own top-level TOC).
   */
  showSectionNav?: boolean;
  /**
   * Whether to render the linear prev/next journey footer at the
   * bottom of the shell. Defaults to true so all 15 numbered
   * briefs get consistent forward navigation without touching
   * each page. Pages that don't map onto the linear section walk
   * (the /proposal hub, /proposal/full rollup, or one-off deep
   * dives that live outside the section list) pass
   * `showJourneyFooter={false}` to opt out cleanly.
   */
  showJourneyFooter?: boolean;
};

export const proposalSections = [
  { href: "/proposal/customers", label: "Customer Selection" },
  { href: "/proposal/insights", label: "Customer Insights" },
  { href: "/proposal/data", label: "Data Inventory" },
  { href: "/proposal/competition", label: "Competition" },
  { href: "/proposal/strategy", label: "Digital Strategy" },
  { href: "/proposal/technology", label: "Technology Choices" },
  { href: "/proposal/integration", label: "JupyterHealth Integration" },
  { href: "/proposal/dbdp", label: "DBDP Feature Engineering" },
  { href: "/proposal/menopause-society", label: "Menopause Society" },
  { href: "/proposal/provider-graph", label: "Provider Graph" },
  { href: "/proposal/agentforce", label: "Agentforce Intake" },
  { href: "/proposal/mulesoft", label: "MuleSoft Integration" },
  { href: "/proposal/mcp", label: "MCP Server" },
  { href: "/proposal/agent-fabric", label: "Agent Fabric" },
  { href: "/proposal/data-360", label: "Data 360" }
];

export function ProposalShell({
  eyebrow,
  title,
  subtitle,
  children,
  backHref = "/proposal",
  backLabel = "Back to Investor Brief",
  heroExtra,
  showSectionNav = true,
  showJourneyFooter = true
}: ProposalShellProps) {
  return (
    <main className="container">
      <section className="hero">
        <a href={backHref} className="btn btn-secondary">
          {backLabel}
        </a>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-copy">{subtitle}</p>
        {heroExtra}
        {/*
         * In-page nav is split into its own client subcomponent so
         * it can read a small set of URL params via useSearchParams
         * and append them to each link, and so it can pick up the
         * active section via usePathname and mark it aria-current.
         * The shell itself stays server-rendered. This mirrors the
         * demo-shell / demo-shell-nav split exactly.
         */}
        {showSectionNav && <ProposalShellNav />}
      </section>
      {children}
      {showJourneyFooter && <ProposalJourneyFooter />}
    </main>
  );
}
