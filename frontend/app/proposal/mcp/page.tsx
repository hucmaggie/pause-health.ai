import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · MCP Server",
  description:
    "Pause-Health.ai exposes its MuleSoft Experience APIs as Model Context Protocol (MCP) tools. Claude Desktop, Cursor, and the Agentforce Service Agent can call Pause's clinical APIs as native tools.",
  path: "/proposal/mcp",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause MCP server — investor brief."
});

const tools = [
  {
    name: "get_patient_timeline",
    detail:
      "Returns a FHIR R5 Bundle (Patient + raw wearable Observations + DBDP-computed feature Observation with derivedFrom provenance).",
    mule: "pause-patient-bundle-process-api"
  },
  {
    name: "get_patient_intake",
    detail:
      "Returns the structured intake record produced by the Salesforce Agentforce Service Agent — chief complaint, symptom cluster, red-flag screen, triage recommendation.",
    mule: "pause-intake-process-api"
  },
  {
    name: "find_menopause_providers",
    detail:
      "Searches Pause's provider directory by ZIP and menopause-certified flag. Returns providers ranked by Pause's internal graph score.",
    mule: "pause-provider-directory-experience-api"
  },
  {
    name: "experience_api_health",
    detail:
      "Liveness check for the Experience API plane. Use before larger tool calls.",
    mule: "pause-patient-bundle-process-api (root)"
  }
];

const whyMcp = [
  {
    name: "One server, every modern agent",
    detail:
      "Claude Desktop, Cursor, OpenAI Responses API, and the Salesforce Agentforce Service Agent all speak MCP. Exposing Pause's MuleSoft Experience APIs as MCP tools makes them callable from every relevant AI runtime — no per-client adapter, no custom plugin format."
  },
  {
    name: "Production-grade contract today",
    detail:
      "The tool surface is identical between the mocked Experience APIs (today) and a customer's MuleSoft Anypoint deployment (tomorrow). Switching is a single environment variable: PAUSE_MCP_BASE_URL. Every agent integration built against the mock works against production with no client changes."
  },
  {
    name: "Layers cleanly on top of MuleSoft",
    detail:
      "MCP is the agent-side contract. MuleSoft is the integration-side contract. They compose: Mule Experience APIs become MCP tools 1:1, and Mule's API policies (rate limit, OAuth, observability) apply transparently to every MCP call."
  },
  {
    name: "Auditable provenance",
    detail:
      "Each tool call returns a meta block including which Process / Experience API would serve it in production, plus FHIR derivedFrom references for computed features. The same audit trail that satisfies HIPAA-compliant logging is visible to the agent at call time."
  }
];

const protoVsProd = [
  {
    aspect: "MCP server transport",
    proto: "stdio. Launched by the MCP client as a child process via npx.",
    prod:
      "stdio for developer tooling (Cursor, Claude Desktop) and Streamable HTTP behind the customer's identity provider for Agentforce / server-to-server."
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
    proto: "Mocked meta blocks reference the production Mule API names.",
    prod:
      "Real Mule correlation IDs, HIPAA audit IDs, and API instance identifiers returned in the meta block."
  }
];

const claudeSnippet = `{
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

const cursorSnippet = `{
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

const agentforceSnippet = `// In Anypoint Platform / Agentforce Studio:
// 1. Publish the Pause MCP server behind an External Services connector
//    OR the Agentforce MCP gateway.
// 2. Point PAUSE_MCP_BASE_URL at the customer's Anypoint Experience-tier
//    base URL (set in the gateway / connector configuration).
// 3. The Agentforce Service Agent now sees four tools:
//    - get_patient_timeline
//    - get_patient_intake
//    - find_menopause_providers
//    - experience_api_health
// 4. Tool calls flow: Agentforce -> MCP gateway -> Pause MCP server
//    -> MuleSoft Experience API -> JupyterHealth / DBDP.
`;

const phases = [
  {
    name: "Phase 0 — Reference implementation",
    duration: "Today",
    detail:
      "Pause MCP server committed under mcp/. Four tools backed by mocked Experience APIs. Descriptor published at /.well-known/mcp.json. Investor page (this one)."
  },
  {
    name: "Phase 1 — Publish to the registry",
    duration: "2 weeks",
    detail:
      "Publish @pause-health/mcp to npm. Submit to the public MCP server registry. Add a Streamable HTTP transport alongside stdio for server-to-server callers."
  },
  {
    name: "Phase 2 — Customer-managed gateway",
    duration: "4–6 weeks with first customer",
    detail:
      "Deploy the MCP server behind the customer's MuleSoft Anypoint API gateway. Wire OAuth via PingFederate / Azure AD. The Agentforce Service Agent registers it as a tool source."
  },
  {
    name: "Phase 3 — Multi-tenant MCP plane",
    duration: "Ongoing",
    detail:
      "One Pause MCP package, N customer deployments. Tools auto-expand as new MuleSoft Experience APIs ship. Telemetry rolled up across deployments for product analytics."
  }
];

const investorTakeaways = [
  {
    label: "Distribution leverage",
    detail:
      "Every new MCP client (Claude, Cursor, Agentforce, GPT, others) becomes a Pause distribution channel without engineering work. The protocol does the marketing."
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
    label: "Demo on day one",
    detail:
      "Investors and partners can install the MCP server in Claude Desktop or Cursor in under two minutes and start calling Pause's clinical APIs from inside their existing AI tools. The mocked Experience APIs make this real today."
  }
];

export default function McpPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · MCP server"
      title="Pause as a tool surface for every AI agent"
      subtitle="Pause-Health.ai exposes its MuleSoft Experience APIs through a Model Context Protocol (MCP) server. Claude Desktop, Cursor, the Salesforce Agentforce Service Agent, and any MCP-compliant client can call Pause's clinical APIs as native tools."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The four tools</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {tools.map((tool) => (
            <article key={tool.name} className="card">
              <h3 style={{ fontFamily: "var(--font-mono, monospace)" }}>{tool.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                Production: {tool.mule}
              </p>
              <p>{tool.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why MCP</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyMcp.map((item) => (
            <article key={item.name} className="card">
              <h3>{item.name}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <p style={{ marginTop: "0.4rem" }}>
          The MCP server lives at <code>mcp/</code> in this repo. It speaks stdio (the
          standard transport for local AI clients) and fronts the mocked Experience APIs
          under <code>/api/mulesoft/*</code>. The descriptor is published at{" "}
          <code>/.well-known/mcp.json</code> so any MCP-aware registry or gateway can
          discover the tool surface.
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

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Register Pause in your MCP client</p>
        <h3 style={{ marginTop: "1rem" }}>Claude Desktop</h3>
        <p>
          Add to{" "}
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:
        </p>
        <pre
          style={{
            background: "var(--card-bg, #f6f6f8)",
            padding: "1rem",
            borderRadius: "0.5rem",
            overflowX: "auto",
            fontSize: "0.85rem"
          }}
        >
          <code>{claudeSnippet}</code>
        </pre>

        <h3 style={{ marginTop: "1.5rem" }}>Cursor</h3>
        <p>
          Add to <code>~/.cursor/mcp.json</code> (or the project-local{" "}
          <code>.cursor/mcp.json</code>):
        </p>
        <pre
          style={{
            background: "var(--card-bg, #f6f6f8)",
            padding: "1rem",
            borderRadius: "0.5rem",
            overflowX: "auto",
            fontSize: "0.85rem"
          }}
        >
          <code>{cursorSnippet}</code>
        </pre>

        <h3 style={{ marginTop: "1.5rem" }}>Salesforce Agentforce Service Agent</h3>
        <p>
          Production deployments register the Pause MCP server behind the customer's
          MuleSoft Anypoint gateway and expose it to Agentforce via the External Services
          connector. The tool surface is identical to local development.
        </p>
        <pre
          style={{
            background: "var(--card-bg, #f6f6f8)",
            padding: "1rem",
            borderRadius: "0.5rem",
            overflowX: "auto",
            fontSize: "0.85rem"
          }}
        >
          <code>{agentforceSnippet}</code>
        </pre>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
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
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {phases.map((phase) => (
            <article key={phase.name} className="card">
              <h3>{phase.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {phase.duration}
              </p>
              <p>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why investors should care</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
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
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The connectivity tier that backs every MCP tool call in production.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agentforce">Agentforce intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Service Agent that consumes the same MCP server in production.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The FHIR substrate the MCP tools read from on the back end.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric control plane</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How MCP tool calls and A2A handoffs are jointly governed, traced,
              and secured across every Pause agent.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://modelcontextprotocol.io/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Model Context Protocol specification
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The open standard this server implements.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
