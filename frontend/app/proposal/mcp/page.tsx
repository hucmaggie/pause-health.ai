import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · MCP Server",
  description:
    "Pause-Health.ai exposes its MuleSoft Experience APIs as Model Context Protocol (MCP) tools. The server is shipped in-repo today against mocked Experience APIs; npm publish is Phase 1.",
  path: "/proposal/mcp",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause MCP server — investor brief."
});

/**
 * Pause MCP server — Arc B polish pass.
 *
 * The highest-risk surfaces on the previous version were the
 * Claude Desktop and Cursor snippets that ran `npx -y @pause-health/mcp`
 * as if the package were published. It is not — mcp/package.json
 * has `"private": true`, and Phase 1 (2 weeks) is literally
 * "Publish @pause-health/mcp to npm." A reader who copy-pasted the
 * snippet today would hit `npm ERR! 404 Not Found`.
 *
 * Four moves:
 *
 *   1. Split the install instructions into two clearly-labeled
 *      blocks: "Install today (clone the repo)" pilled `prototype`,
 *      and "After Phase 1 ships" pilled `designed`. Both produce
 *      identical MCP behaviour; only the distribution changes.
 *
 *   2. Per-card StatusPill on tools / whyMcp / phases. The four
 *      tools are `prototype` (shape-stable, wired against mocked
 *      Experience APIs); the Mule Process API names they target are
 *      `designed`.
 *
 *   3. Soften "Production-grade contract today" -> the SHAPES are
 *      stable today (`partial`); the DISTRIBUTION is Phase 1.
 *
 *   4. Read-deeper rows that previously asserted in-production
 *      consumption ("the Service Agent that consumes the same MCP
 *      server in production", "MCP tool calls ... governed and
 *      secured by Agent Fabric") get `designed` pills with
 *      "will / in a customer deployment" wording.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const tools: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
  productionTarget: string;
}> = [
  {
    name: "get_patient_timeline",
    status: "prototype",
    detail:
      "Returns a FHIR R5 Bundle (Patient + raw wearable Observations + DBDP-computed feature Observation with derivedFrom provenance). Wired today against the mocked Experience API at /api/mulesoft/patient/[id]/timeline.",
    productionTarget: "pause-patient-bundle-process-api"
  },
  {
    name: "get_patient_intake",
    status: "prototype",
    detail:
      "Returns the structured intake record produced by the Salesforce Agentforce Service Agent — chief complaint, symptom cluster, red-flag screen, triage recommendation. Wired today against /api/mulesoft/patient/[id]/intake.",
    productionTarget: "pause-intake-process-api"
  },
  {
    name: "find_menopause_providers",
    status: "prototype",
    detail:
      "Searches Pause's provider directory by ZIP and menopause-certified flag. Returns providers ranked by Pause's internal graph score. Wired today against /api/mulesoft/providers (deterministic fixture).",
    productionTarget: "pause-provider-directory-experience-api"
  },
  {
    name: "experience_api_health",
    status: "prototype",
    detail:
      "Liveness check for the Experience API plane. Use before larger tool calls. Wired today against /api/mulesoft/health.",
    productionTarget: "pause-patient-bundle-process-api (root)"
  }
];

const whyMcp: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    name: "One server, every modern agent",
    status: "designed",
    detail:
      "Claude Desktop, Cursor, OpenAI Responses API, and the Salesforce Agentforce Service Agent all speak MCP. Exposing Pause's MuleSoft Experience APIs as MCP tools makes them callable from every relevant AI runtime — no per-client adapter, no custom plugin format. Today the Pause MCP server is in-repo; once it's npm-published (Phase 1), the multi-runtime distribution lands."
  },
  {
    name: "Shape-stable contract today, swap the base URL tomorrow",
    status: "partial",
    detail:
      "The tool surface is identical between the mocked Experience APIs (today) and a customer's MuleSoft Anypoint deployment (Phase 2). Switching is a single environment variable: PAUSE_MCP_BASE_URL. Every agent integration built against the mock works against production with no client changes. The shapes are wired today; the distribution (npm + Anypoint gateway) is roadmap."
  },
  {
    name: "Layers cleanly on top of MuleSoft",
    status: "designed",
    detail:
      "MCP is the agent-side contract. MuleSoft is the integration-side contract. They compose: Mule Experience APIs become MCP tools 1:1, and Mule's API policies (rate limit, OAuth, observability) apply transparently to every MCP call. This composition is design-stage — see /proposal/mulesoft for what's currently mocked vs deployed."
  },
  {
    name: "Auditable provenance",
    status: "prototype",
    detail:
      "Each tool call returns a meta block including which Process / Experience API would serve it in production, plus FHIR derivedFrom references for computed features. The same audit trail that will satisfy HIPAA-compliant logging is visible to the agent at call time. Today the meta block references Mule API names symbolically; real correlation IDs land in Phase 2."
  }
];

const protoVsProd = [
  {
    aspect: "MCP server transport",
    proto:
      "Both transports run today off a single tool registration: stdio (npx @pause-health/mcp; private:true today, npm-published in Phase 1) for Claude Desktop / Cursor, AND Streamable HTTP at https://pause-health.ai/api/mcp for Agentforce 3.0 Registry / any HTTP-based MCP client.",
    prod:
      "Same two transports. Streamable HTTP fronted by the customer's Anypoint API gateway and tied to their identity provider; stdio still works locally for developer tooling."
  },
  {
    aspect: "Backing Experience APIs",
    proto:
      "Mocked endpoints under /api/mulesoft/* served by the Next.js frontend (deterministic fixtures).",
    prod:
      "Real MuleSoft Anypoint Experience APIs on the customer's Runtime Fabric or CloudHub 2.0. Same JSON shapes."
  },
  {
    aspect: "Authentication",
    proto: "None. Public read of synthetic demo data.",
    prod:
      "Bearer token via PAUSE_MCP_API_KEY, validated by Mule API policies and tied to the customer's OAuth provider."
  },
  {
    aspect: "Tool surface",
    proto: "Four tools: timeline, intake, providers, health.",
    prod: "Same four tools; additional tools added as new Experience APIs ship (e.g. orders, referrals)."
  },
  {
    aspect: "Provenance",
    proto: "Mocked meta blocks reference the production Mule API names symbolically.",
    prod:
      "Real Mule correlation IDs, HIPAA audit IDs, and API instance identifiers returned in the meta block."
  },
  {
    aspect: "Distribution",
    proto: "git clone + local build (today).",
    prod: "Published npm package + Anypoint Exchange listing (Phase 1)."
  }
];

const todayInstallBash = `# 1. Clone Pause-Health.ai
git clone https://github.com/hucmaggie/pause-health.ai.git
cd pause-health.ai/mcp

# 2. Install + build
npm install
npm run build

# 3. Run a smoke test against the live mocked APIs
PAUSE_MCP_BASE_URL=https://pause-health.ai \\
  node dist/server.js < <(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')`;

const todayClaudeSnippet = `{
  "mcpServers": {
    "pause-health": {
      "command": "node",
      "args": ["/absolute/path/to/pause-health.ai/mcp/dist/server.js"],
      "env": {
        "PAUSE_MCP_BASE_URL": "https://pause-health.ai"
      }
    }
  }
}`;

const phase1ClaudeSnippet = `{
  "mcpServers": {
    "pause-health": {
      "command": "npx",
      "args": ["-y", "@pause-health/mcp"],
      "env": {
        "PAUSE_MCP_BASE_URL": "https://pause-health.ai"
      }
    }
  }
}`;

const agentforceSnippet = `// Salesforce Agentforce 3.0 — register the Pause MCP server with the
// Agentforce Registry (the June 2025 release introduced a native MCP
// client; the legacy "External Services connector" pattern is obsolete
// for MCP intake).
//
// 1. Setup -> Agentforce Registry -> New MCP server.
//    Paste the Streamable HTTP URL:
//      https://pause-health.ai/api/mcp
//    Salesforce calls tools/list against it and auto-populates the
//    four Pause tools.
// 2. Allowlist the tools you want. Each one is persisted to the
//    Agentforce Asset Library as a callable action; the tool's
//    description becomes the agent's reasoning instructions.
// 3. Agentforce Builder -> your agent -> Topic ->
//    This Topic's Actions -> Add from Asset Library. Validate in
//    Plan Canvas.
// 4. Tool calls flow:
//      Agentforce agent -> Agentforce Registry / Gateway ->
//      https://pause-health.ai/api/mcp ->
//      MuleSoft Experience API -> JupyterHealth / DBDP.
//
// For a customer-managed Anypoint deployment, set PAUSE_MCP_BASE_URL
// on the Vercel deployment to the customer's Experience-tier base URL
// and the same four tools transparently call the customer's APIs.
// The registration URL doesn't change.
`;

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 0 — Reference implementation + Streamable HTTP endpoint",
    status: "prototype",
    duration: "Today",
    detail:
      "Pause MCP server committed under mcp/ with two transports running off a single tool registration: stdio (Claude Desktop, Cursor, local clients) via `npx @pause-health/mcp`, and Streamable HTTP at https://pause-health.ai/api/mcp (Agentforce 3.0 Registry, server-to-server) via a Next.js route handler. Four tools backed by mocked Experience APIs. A parity test pins the two transport copies of the tool definitions byte-identical so a description tweak can't ship to one path and not the other."
  },
  {
    name: "Phase 1 — Publish to the registry",
    status: "designed",
    duration: "2 weeks",
    detail:
      "Publish @pause-health/mcp to npm (today: package is `private: true`). Submit to the public MCP server registry alongside the existing https://pause-health.ai/api/mcp HTTP endpoint."
  },
  {
    name: "Phase 2 — Customer-managed gateway",
    status: "designed",
    duration: "4–6 weeks with first design partner",
    detail:
      "Deploy the MCP server behind the customer's MuleSoft Anypoint API gateway. Wire OAuth via PingFederate / Azure AD. The Agentforce Service Agent registers it as a tool source."
  },
  {
    name: "Phase 3 — Multi-tenant MCP plane",
    status: "future",
    duration: "Ongoing",
    detail:
      "One Pause MCP package, N customer deployments. Tools auto-expand as new MuleSoft Experience APIs ship. Telemetry rolled up across deployments for product analytics."
  }
];

const investorTakeaways = [
  {
    label: "Distribution leverage",
    detail:
      "Every new MCP client (Claude, Cursor, Agentforce, GPT, others) becomes a Pause distribution channel without engineering work. The protocol does the marketing — once Phase 1 ships."
  },
  {
    label: "Same APIs, two contracts",
    detail:
      "MuleSoft is the contract enterprise IT signs. MCP is the contract an AI agent signs. Pause owns both ends of the same shape — buyers don't have to choose between 'integratable' and 'agent-native.'"
  },
  {
    label: "Defensible architecture story",
    detail:
      "Open standards everywhere: MCP (Anthropic / Model Context Protocol), MuleSoft (Salesforce), FHIR R5 (HL7), Open mHealth (DHCH), DBDP (Duke). No proprietary lock-in at any tier."
  },
  {
    label: "Demo today, polish in Phase 1",
    detail:
      "Investors and partners can clone the repo and call Pause's clinical APIs from inside Claude Desktop or Cursor in under five minutes. The mocked Experience APIs make this real today; the npm one-liner lands in Phase 1."
  }
];

const codeBlockStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid var(--line)",
  padding: "1rem",
  borderRadius: "0.5rem",
  overflowX: "auto",
  fontSize: "0.85rem",
  marginTop: "0.5rem"
};

type ReadDeeperRow = {
  href: string;
  label: string;
  detail: string;
  external?: boolean;
  status?: StatusPillStatus;
};

const readDeeper: ReadDeeperRow[] = [
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    detail:
      "The connectivity tier that will back every MCP tool call in production. Today: mocked Experience APIs under /api/mulesoft/*.",
    status: "designed"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce intake",
    detail:
      "In a customer deployment, the Salesforce Agentforce Service Agent will consume this MCP server as its tool source. Today the Agentforce path is gated by env vars (see the Agentforce env-table brief).",
    status: "designed"
  },
  {
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    detail:
      "The FHIR R5 substrate the MCP tools will read from on the back end once design-partner deployments wire it through.",
    status: "designed"
  },
  {
    href: "/proposal/agent-fabric",
    label: "Agent Fabric control plane",
    detail:
      "How MCP tool calls and A2A handoffs are jointly governed, traced, and secured across every Pause agent. Trace plane wired in prototype; full multi-agent governance is design-stage.",
    status: "partial"
  },
  {
    href: "https://modelcontextprotocol.io/",
    label: "Model Context Protocol specification",
    detail: "The open standard this server implements.",
    external: true
  }
];

export default function McpPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · MCP server"
      title="Pause as a tool surface for every AI agent"
      subtitle="Pause-Health.ai exposes its MuleSoft Experience APIs through a Model Context Protocol (MCP) server. Claude Desktop and Cursor connect over stdio; Salesforce Agentforce 3.0 Registry and any other HTTP-based MCP client connect over Streamable HTTP at https://pause-health.ai/api/mcp. Both transports run today off a single tool registration. Backing Experience APIs are mocked in the prototype; the npm-published stdio one-liner lands in Phase 1."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The four tools</p>
        <h2 className="proposal-section-title">Shape-stable today, customer-deployed in Phase 2</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> tool wired
          in the prototype today (against the mocked Experience APIs); the
          Mule Process API name shown is the{" "}
          <em>production target</em>, design-stage.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {tools.map((tool) => (
            <article key={tool.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={tool.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ fontFamily: "var(--font-mono, monospace)", marginTop: 0 }}>
                {tool.name}
              </h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                Production target: {tool.productionTarget}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{tool.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why MCP</p>
        <h2 className="proposal-section-title">Four reasons the agent-side contract is MCP</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> wired in
          the prototype today ·{" "}
          <StatusPill status="partial" style={inlinePillStyle} /> partly
          wired, partly roadmap ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> design
          decision, activates with the first design partner.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyMcp.map((item) => (
            <article key={item.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{item.name}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four live surfaces you can hit right now
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The MCP server lives at <code>mcp/</code> in this repo. It speaks
          stdio (the standard transport for local AI clients) and fronts the
          mocked Experience APIs under <code>/api/mulesoft/*</code>. The
          descriptor is published at <code>/.well-known/mcp.json</code> so
          any MCP-aware registry or gateway can discover the tool surface.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a
            href="/.well-known/mcp.json"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            GET /.well-known/mcp.json
          </a>
          <a
            href="/api/mulesoft/health"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Mocked Experience API
          </a>
          <a
            href="/api/mulesoft/providers?zip=92614&menopause=true&limit=5"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Try the provider directory
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            MCP server source on GitHub
          </a>
        </div>
      </section>

      <section
        className="card"
        style={{
          marginTop: "1.5rem",
          borderLeft: "3px solid var(--brand)"
        }}
      >
        <p className="eyebrow">Install today · clone the repo</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The five-minute path that works right now
        </h2>
        <div style={{ marginBottom: "0.5rem" }}>
          <StatusPill status="prototype" style={inlinePillStyle} />
          <span style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Works against the live mocked Experience APIs at{" "}
            <code>https://pause-health.ai/api/mulesoft/*</code>. No credentials needed.
          </span>
        </div>
        <p style={{ marginTop: "0.6rem", marginBottom: "0.4rem" }}>
          <strong>1. Clone, build, smoke-test:</strong>
        </p>
        <pre style={codeBlockStyle}>
          <code>{todayInstallBash}</code>
        </pre>
        <p style={{ marginTop: "1rem", marginBottom: "0.4rem" }}>
          <strong>2. Register with Claude Desktop</strong> — add to{" "}
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:
        </p>
        <pre style={codeBlockStyle}>
          <code>{todayClaudeSnippet}</code>
        </pre>
        <p style={{ marginTop: "0.8rem", color: "var(--muted)", fontSize: "0.9rem" }}>
          Cursor uses the same shape in <code>~/.cursor/mcp.json</code>. Both
          clients spawn <code>node dist/server.js</code> as a child process
          and talk MCP over stdio.
        </p>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">After Phase 1 ships · npm one-liner</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The two-minute path, once <code>@pause-health/mcp</code> is published
        </h2>
        <div style={{ marginBottom: "0.5rem" }}>
          <StatusPill status="designed" style={inlinePillStyle} />
          <span style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Phase 1 (2 weeks): flip <code>private: true</code> off in{" "}
            <code>mcp/package.json</code>, <code>npm publish --access public</code>, submit to
            the MCP registry. Then the snippet below works.
          </span>
        </div>
        <p style={{ marginTop: "0.6rem", marginBottom: "0.4rem" }}>
          <strong>Claude Desktop / Cursor</strong> — once published:
        </p>
        <pre style={codeBlockStyle}>
          <code>{phase1ClaudeSnippet}</code>
        </pre>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Production deployment · Agentforce</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          How a customer Salesforce org will consume Pause as an MCP tool source
        </h2>
        <div style={{ marginBottom: "0.5rem" }}>
          <StatusPill status="designed" style={inlinePillStyle} />
          <span style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Phase 2 (4–6 weeks with first design partner): the gateway,
            connector, and Anypoint policies land together — see /proposal/agentforce.
          </span>
        </div>
        <pre style={codeBlockStyle}>
          <code>{agentforceSnippet}</code>
        </pre>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What changes between the two install paths
        </h2>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Aspect</th>
                <th>Prototype today</th>
                <th>Customer deployment</th>
              </tr>
            </thead>
            <tbody>
              {protoVsProd.map((row) => (
                <tr key={row.aspect}>
                  <td>
                    <strong>{row.aspect}</strong>
                  </td>
                  <td>{row.proto}</td>
                  <td>{row.prod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased plan</p>
        <h2 className="proposal-section-title">From reference implementation to multi-tenant plane</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {phases.map((phase) => (
            <article key={phase.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={phase.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{phase.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {phase.duration}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why investors should care</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The four compounding advantages
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {investorTakeaways.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <strong style={{ fontWeight: 500 }}>{item.detail}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where the MCP server sits in the bigger picture</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {readDeeper.map((row) => (
            <li key={row.href}>
              <span>
                <a
                  href={row.href}
                  {...(row.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {row.label}
                </a>
              </span>
              <strong style={{ fontWeight: 500 }}>
                {row.status ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      flexWrap: "wrap"
                    }}
                  >
                    <StatusPill status={row.status} style={inlinePillStyle} />
                    <span>{row.detail}</span>
                  </span>
                ) : (
                  row.detail
                )}
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </ProposalShell>
  );
}
