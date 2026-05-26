import type { ReactNode } from "react";

type ProposalShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
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

export function ProposalShell({ eyebrow, title, subtitle, children }: ProposalShellProps) {
  return (
    <main className="container">
      <section className="hero">
        <a href="/proposal" className="btn btn-secondary">
          Back to Investor Brief
        </a>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-copy">{subtitle}</p>
        <nav className="demo-nav" aria-label="Investor proposal sections">
          {proposalSections.map((item) => (
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
