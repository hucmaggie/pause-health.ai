import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Headless 360",
  description:
    "How Pause-Health.ai already maps onto Salesforce's Headless 360 architecture (TDX 2026): REST + MCP + A2A under one identity. The honest audit of what's wired, what's partial, and what's still missing for full conformance.",
  path: "/proposal/headless-360",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Headless 360 — Pause-Health.ai conformance audit."
});

/**
 * Salesforce Headless 360 — conformance audit for the Pause prototype.
 *
 * "Headless 360" is Salesforce's TDX 2026 umbrella positioning for the
 * idea that "everything on Salesforce is now an API, an MCP tool, or a
 * CLI command, and agents can use all of it." It is not a new SKU; it
 * is the architecture story that ties together Agentforce 360, Agent
 * Fabric (MuleSoft), Data Cloud / Data 360, and the Salesforce-hosted
 * MCP server under three integration patterns:
 *
 *   1. REST / SOAP APIs.
 *   2. Model Context Protocol (MCP).
 *   3. Agent-to-Agent (A2A).
 *
 * The trust model is OAuth 2.0 Authorization Code + PKCE via an
 * External Client App, scopes `mcp_api` + `refresh_token`. Client
 * Credentials / Implicit / Username-Password flows are explicitly
 * out-of-pattern.
 *
 * As of June 2026 the public surface for Headless 360 is the
 * Salesforce Architects blog (not yet a Help / Developer doc family):
 *   - https://www.salesforce.com/blog/headless-360-integration-architecture/
 *   - https://www.salesforce.com/blog/how-to-choose-integration-pattern-for-agentforce/
 *   - https://www.salesforce.com/blog/headless-trust-model-agentic-architecture/
 *   - https://www.salesforce.com/blog/design-headless-ai-experiences/
 *
 * This page is the conformance audit, not the implementation. The
 * implementation is the rest of /proposal/* — what's new here is the
 * single-page mapping that makes it legible to anyone evaluating
 * whether the prototype actually IS a Headless 360 architecture, or
 * just happens to use some of the same words.
 */

const inlinePillStyle: React.CSSProperties = {
  marginLeft: "0.4rem",
  verticalAlign: "middle"
};

const codeBlockStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid var(--line)",
  padding: "1rem",
  borderRadius: "0.5rem",
  overflowX: "auto",
  fontSize: "0.85rem",
  marginTop: "0.5rem"
};

const threePatterns: Array<{
  pattern: string;
  what: string;
  pauseSurfaces: Array<{ name: string; href: string }>;
  pill: StatusPillStatus;
}> = [
  {
    pattern: "REST / SOAP APIs",
    what:
      "The classic Salesforce integration substrate. In Headless 360, REST is still load-bearing: Data 360 grounding queries, Apex callouts, Tooling API, Bulk API, Connect API. Pause's prototype exercises this pattern through the Data Cloud connector and the MuleSoft Experience APIs.",
    pauseSurfaces: [
      { name: "Data Cloud Connect (Data 360 grounding)", href: "/proposal/data-360" },
      { name: "MuleSoft Experience APIs (/api/mulesoft/*)", href: "/proposal/mulesoft" },
      { name: "Agentforce Embedded Messaging (Service Cloud)", href: "/proposal/agentforce" }
    ],
    pill: "prototype"
  },
  {
    pattern: "Model Context Protocol (MCP)",
    what:
      "60+ Salesforce-hosted MCP tools (per the TDX 2026 announcement) plus the MuleSoft MCP Bridge. Headless 360 makes MCP the agent-readable contract for Salesforce capabilities — same idea as the public MCP registry, scoped to Salesforce. Pause is both an MCP server (exposing its four Pause tools) and an MCP host (the Care Router calls find_menopause_providers as a tool, not a direct HTTP).",
    pauseSurfaces: [
      { name: "Pause MCP server (/api/mcp Streamable HTTP)", href: "/proposal/mcp" },
      { name: "Pause MCP server (npx @pause-health/mcp stdio)", href: "/proposal/mcp" },
      { name: "Pause MCP HOST inside Care Router agent", href: "/proposal/mcp" }
    ],
    pill: "shipped"
  },
  {
    pattern: "Agent-to-Agent (A2A)",
    what:
      "Google's A2A spec (JSON-RPC tasks/send with an Agent Card + OAuth handshake) is the cross-agent integration pattern in Headless 360. Pause already publishes an Agent Card and accepts A2A tasks/send for the Care Router; an upstream Agentforce Service Agent can delegate routing to Pause without leaving the A2A contract.",
    pauseSurfaces: [
      {
        name: "Agent Card (/api/agents/care-router/.well-known/agent.json)",
        href: "/api/agents/care-router/.well-known/agent.json"
      },
      { name: "tasks/send (/api/agents/care-router/tasks)", href: "/proposal/agent-fabric" }
    ],
    pill: "prototype"
  }
];

const surfaceMap: Array<{
  surface: string;
  pattern: "REST" | "MCP" | "A2A" | "REST + MCP";
  identity: string;
  state: string;
  pill: StatusPillStatus;
  href?: string;
}> = [
  {
    surface: "Data 360 (Data Cloud) grounding",
    pattern: "REST",
    identity: "Service-user token (a360 exchange against SF_DC_TENANT_URL)",
    state: "Live in production. Three Calculated Insights (HRV z-score, vasomotor burden, sleep disruption) authored over ssot__Individual__dlm. Returns 'Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights' on /api/data-360/patient/[id]/grounding.",
    pill: "shipped",
    href: "/proposal/data-360"
  },
  {
    surface: "Agentforce embedded chat",
    pattern: "REST",
    identity: "Public deployment metadata (NEXT_PUBLIC_AGENTFORCE_*; no Connected App on the client)",
    state: "Live when the four NEXT_PUBLIC_AGENTFORCE_* env vars are set. Embedded Messaging for Web v2 (Enhanced Chat). Already running the Pause_Health_Intake_Agent in the trailsignup org with the Find-a-Provider subagent.",
    pill: "prototype",
    href: "/proposal/agentforce"
  },
  {
    surface: "Agentforce Voice",
    pattern: "REST",
    identity: "CCaaS partner SDK (Amazon Connect Streams / Five9 / NiCE / Vonage) — Salesforce-side voice routing under existing Agentforce auth",
    state: "Seam wired today; full activation gated on Agentforce Contact Center licensing + a CCaaS partner contract. /api/agentforce/voice/config and <AgentforceVoiceButton/> degrade honestly: designed → prototype → shipped driven by env vars.",
    pill: "designed",
    href: "/proposal/agentforce-voice"
  },
  {
    surface: "MuleSoft Experience APIs",
    pattern: "REST",
    identity: "Auth0 JWT → MuleSoft Flex Gateway → CloudHub 2.0 (production); mock fallback when MULESOFT_*_BASE_URL is unset",
    state: "Live at https://pause-health.ai/api/mulesoft/{health,providers,patient/*}. Iteration 1–8 complete; iteration 9 (persistent VM hosting for the Flex Gateway) is the only remaining piece.",
    pill: "shipped",
    href: "/proposal/mulesoft"
  },
  {
    surface: "MCP server (Streamable HTTP)",
    pattern: "MCP",
    identity: "Unauthenticated against the public mock; bearer token via PAUSE_MCP_API_KEY in customer deployments",
    state: "Live at https://pause-health.ai/api/mcp. Registry-callable by Agentforce 3.0 (Setup → Agentforce Registry → New MCP server). Lists 4 tools (timeline, intake, providers, health).",
    pill: "shipped",
    href: "/proposal/mcp"
  },
  {
    surface: "MCP server (stdio)",
    pattern: "MCP",
    identity: "Inherits parent process credentials (Claude Desktop / Cursor / Agentforce local connector)",
    state: "npx @pause-health/mcp ships the same 4 tools over stdio. Tool definitions single-sourced from frontend/lib/mcp/tools.ts via a parity test.",
    pill: "shipped",
    href: "/proposal/mcp"
  },
  {
    surface: "MCP HOST (Care Router calls external MCP servers)",
    pattern: "MCP",
    identity: "Per-request MCP client; remote auth via PAUSE_MCP_HOST_REMOTES headers",
    state: "Production-on at pause-health.ai (PAUSE_MCP_HOST_ENABLED=on). Care Router resolves provider recommendations by calling find_menopause_providers as an MCP tool against /api/mcp, not by direct HTTP. Loopback live; external slot empty until a partner MCP server is ready.",
    pill: "shipped",
    href: "/proposal/mcp"
  },
  {
    surface: "A2A Care Router endpoint",
    pattern: "A2A",
    identity: "Public unauthenticated demo; designed for OAuth-mediated identity propagation when a customer org binds it.",
    state: "Live at /api/agents/care-router/tasks. JSON-RPC 2.0 tasks/send envelope with full A2A Task return shape (status, artifacts, history, agentFabric metadata). Agent Card at /.well-known/agent.json.",
    pill: "prototype",
    href: "/proposal/agent-fabric"
  }
];

const missingForFullConformance: Array<{
  gap: string;
  why: string;
  needed: string;
  pill: StatusPillStatus;
}> = [
  {
    gap: "PKCE External Client App OAuth flow",
    why: "Headless 360's trust model is OAuth 2.0 Authorization Code + PKCE via an External Client App, scopes `mcp_api` + `refresh_token`. The Pause prototype today consumes Salesforce surfaces under service-account or public-deployment identities — not under the end user's identity, which is what PKCE enables.",
    needed: "Shipped 2026-06-24 as a dormant seam. lib/salesforce-headless360.ts + the five routes under /api/salesforce/headless-360/* (config, authorize, callback, token/refresh, me, logout) implement the PKCE handshake with HMAC-signed session cookies. 25 unit tests pin the env-var parsing, the PKCE alphabet + S256 derivation, and the signed-cookie tamper-evidence invariants. Activate by setting SF_HEADLESS360_CLIENT_ID + AUTH_BASE_URL + REDIRECT_URI + SESSION_SECRET; see docs/HEADLESS_360_RUNBOOK.md for the External Client App procurement steps.",
    pill: "prototype"
  },
  {
    gap: "`mcp_api` scope on the Pause MCP server",
    why: "Today the MCP server is unauthenticated against the public mock. Headless 360's MCP pattern expects the calling agent to present an OAuth token with `mcp_api` scope so the server can attribute tool calls to a Salesforce user identity for Event Monitoring and Shield audit.",
    needed: "Authorization middleware on /api/mcp that validates `mcp_api` bearer tokens issued by the External Client App. Doesn't block on activation — the existing public deployment stays open until a customer org wires their own External Client App; then the middleware activates conditionally.",
    pill: "designed"
  },
  {
    gap: "Agent Fabric event-monitoring trace export",
    why: "Headless 360 leans on Event Monitoring + Salesforce Shield for governance. The Pause prototype already records spans on its own Agent Fabric trace surface, but doesn't yet ship them into Salesforce's Event Monitoring stream.",
    needed: "An optional sink in lib/agent-fabric.ts that emits Real-Time Event Monitoring events when SF_EVENT_MONITORING_BASE_URL is set. Salesforce Shield-style audit, end-to-end across the prototype's agents.",
    pill: "designed"
  },
  {
    gap: "Salesforce CLI parity for Pause tools",
    why: "Headless 360's tagline includes 'CLI command' alongside 'API and MCP tool.' The Salesforce CLI is the operator-facing surface for everything an agent can do — Pause has the API + MCP sides but no CLI shim.",
    needed: "Optional. A thin `@pause-health/cli` Node package that wraps the existing Pause REST endpoints with sf-style commands. Low priority — investors and design partners interact via the web surfaces, not the CLI.",
    pill: "future"
  }
];

type ReadDeeperRow = {
  href: string;
  label: string;
  detail: string;
  status?: StatusPillStatus;
  external?: boolean;
};

const readDeeper: ReadDeeperRow[] = [
  {
    href: "/proposal/data-360",
    label: "Data 360 — REST pattern in action",
    detail:
      "How the Data Cloud grounding query, the a360 token exchange, and the three Calculated Insights show what Pause already does in the REST pattern of Headless 360.",
    status: "shipped"
  },
  {
    href: "/proposal/mcp",
    label: "MCP server + host — MCP pattern in action",
    detail:
      "Pause's MCP surface (server + host) is the most complete pattern conformance today — Streamable HTTP + stdio + a host-side bridge inside the Care Router.",
    status: "shipped"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce intake — REST pattern via Embedded Messaging",
    detail:
      "The chat embed uses the public deployment metadata pattern, not PKCE. Honest about that here so the Headless 360 mapping below stays accurate.",
    status: "prototype"
  },
  {
    href: "/proposal/agentforce-voice",
    label: "Agentforce Voice — partner-web seam",
    detail:
      "The voice channel for Headless 360. Seam shipped 2026-06-24; audio round-trip gated on Agentforce Contact Center licensing.",
    status: "designed"
  },
  {
    href: "/proposal/agent-fabric",
    label: "Agent Fabric — A2A pattern + governance",
    detail:
      "The A2A endpoint at /api/agents/care-router/tasks plus the per-span Agent Fabric trace surface. Headless 360's A2A leg.",
    status: "prototype"
  },
  {
    href: "https://www.salesforce.com/blog/headless-360-integration-architecture/",
    label: "Salesforce: Headless 360 Integration Architecture",
    detail: "The umbrella positioning post (Salesforce Architects blog, TDX 2026).",
    external: true
  },
  {
    href: "https://www.salesforce.com/blog/headless-trust-model-agentic-architecture/",
    label: "Salesforce: Headless 360 Trust Model",
    detail: "The OAuth + PKCE + External Client App story — the bit Pause's audit calls out as the next gap to close.",
    external: true
  },
  {
    href: "https://www.salesforce.com/blog/how-to-choose-integration-pattern-for-agentforce/",
    label: "Salesforce: REST vs MCP vs A2A — pattern guide",
    detail: "Which Headless 360 pattern to use when. The three-row mapping table on this page is a direct application of that guide to Pause's surfaces.",
    external: true
  }
];

export default function HeadlessSixtyPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Headless 360"
      title="The Pause prototype already maps onto Salesforce's Headless 360 architecture. Honest audit included."
      subtitle="Salesforce's Headless 360 (TDX 2026) is the umbrella idea that every Salesforce capability is reachable as a REST API, an MCP tool, or an A2A agent — no LWC, no browser, agent-readable end to end. Pause was built into that pattern from the start: Data 360 grounding (REST), the MCP server + host (MCP), and the A2A Care Router (A2A) are all live. This page is the cross-surface audit so a reader can tell at a glance what Pause already does, what's wired-but-gated, and what's still missing for full Headless 360 conformance."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The three Headless 360 patterns</p>
        <h2 className="proposal-section-title">
          REST, MCP, A2A — and what Pause does in each
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.6rem" }}>
          Salesforce&apos;s pattern guide (
          <a
            href="https://www.salesforce.com/blog/how-to-choose-integration-pattern-for-agentforce/"
            target="_blank"
            rel="noopener noreferrer"
          >
            blog post
          </a>
          ) frames Headless 360 around three integration patterns. The
          short version: REST is the classic substrate, MCP is the
          agent-readable contract, A2A is the cross-agent handshake.
          Pause is in all three.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {threePatterns.map((p) => (
            <article key={p.pattern} className="card">
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}
              >
                <h3 style={{ margin: 0 }}>{p.pattern}</h3>
                <StatusPill status={p.pill} style={inlinePillStyle} />
              </header>
              <p style={{ marginTop: "0.4rem" }}>{p.what}</p>
              <ul
                style={{
                  marginTop: "0.4rem",
                  paddingLeft: "1rem",
                  color: "var(--muted)",
                  fontSize: "0.9rem"
                }}
              >
                {p.pauseSurfaces.map((s) => (
                  <li key={s.name}>
                    <a href={s.href}>{s.name}</a>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Surface map · Pause → Headless 360</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Every Pause surface, classified
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.6rem" }}>
          Each row is a real surface in the Pause prototype today,
          mapped onto its Headless 360 pattern, with the actual
          identity model used (not the eventual PKCE flow — see the
          audit below for that gap). Status pills here are the same
          as the corresponding /proposal/* page each surface is
          documented on.
        </p>
        <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Surface</th>
                <th style={{ textAlign: "left" }}>Pattern</th>
                <th style={{ textAlign: "left" }}>Identity / auth today</th>
                <th style={{ textAlign: "left" }}>State</th>
                <th style={{ textAlign: "left" }}>Pill</th>
              </tr>
            </thead>
            <tbody>
              {surfaceMap.map((row) => (
                <tr key={row.surface}>
                  <td>
                    {row.href ? (
                      <a href={row.href}>{row.surface}</a>
                    ) : (
                      row.surface
                    )}
                  </td>
                  <td>
                    <code>{row.pattern}</code>
                  </td>
                  <td>{row.identity}</td>
                  <td>{row.state}</td>
                  <td>
                    <StatusPill status={row.pill} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem", borderLeft: "3px solid var(--brand)" }}>
        <p className="eyebrow">The audit · What&apos;s missing for full Headless 360 conformance</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Four gaps between today and a Salesforce-architect-approved tick mark
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.6rem" }}>
          Pause covers most of Headless 360 incidentally — three out of three patterns
          (REST + MCP + A2A) have at least one live or wired surface. The gaps below
          are the explicit Headless 360 invariants the prototype doesn&apos;t yet
          satisfy. Each is named here so it can be tracked, not hidden.
        </p>
        <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Gap</th>
                <th style={{ textAlign: "left" }}>Why it matters</th>
                <th style={{ textAlign: "left" }}>What lands when activated</th>
                <th style={{ textAlign: "left" }}>Pill</th>
              </tr>
            </thead>
            <tbody>
              {missingForFullConformance.map((row) => (
                <tr key={row.gap}>
                  <td>
                    <strong>{row.gap}</strong>
                  </td>
                  <td>{row.why}</td>
                  <td>{row.needed}</td>
                  <td>
                    <StatusPill status={row.pill} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The OAuth shape Headless 360 expects</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          PKCE + External Client App — shipped 2026-06-24 (dormant until activated)
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.4rem" }}>
          Headless 360&apos;s trust model post (
          <a
            href="https://www.salesforce.com/blog/headless-trust-model-agentic-architecture/"
            target="_blank"
            rel="noopener noreferrer"
          >
            blog
          </a>
          ) is explicit: a non-Salesforce frontend registers as an{" "}
          <strong>External Client App</strong>, the user signs in via{" "}
          <strong>OAuth 2.0 Authorization Code + PKCE</strong>, and the
          client uses scopes <code>mcp_api</code> and{" "}
          <code>refresh_token</code>. Client Credentials / Implicit /
          Username-Password flows are out-of-pattern. The Pause
          conformance gap was that today&apos;s calls go under
          service-user tokens (Data Cloud) or public deployment metadata
          (Agentforce chat), not the user&apos;s identity through PKCE.
          The seam below shipped 2026-06-24 as dormant code — six
          routes, 25 unit tests, and HMAC-signed cookies for tamper-
          evident sessions. Activating it requires the External Client
          App procurement steps in{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/docs/HEADLESS_360_RUNBOOK.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs/HEADLESS_360_RUNBOOK.md
          </a>
          .
        </p>
        <pre style={codeBlockStyle}>
          <code>{`# Activation env vars (set these, then redeploy):
SF_HEADLESS360_CLIENT_ID=<External Client App Consumer Key>
SF_HEADLESS360_AUTH_BASE_URL=https://<my-org>.my.salesforce.com
SF_HEADLESS360_REDIRECT_URI=https://pause-health.ai/api/salesforce/headless-360/callback
SF_HEADLESS360_SESSION_SECRET=<openssl rand -hex 32>
# Optional override; defaults to "mcp_api refresh_token":
SF_HEADLESS360_SCOPES=mcp_api refresh_token api
# After end-to-end verification:
SF_HEADLESS360_VERIFIED=true

# Routes shipped today (all live, all 503 until env vars are set):
GET  /api/salesforce/headless-360/config         # always 200; reports status
GET  /api/salesforce/headless-360/authorize      # 302 → Salesforce w/ PKCE
GET  /api/salesforce/headless-360/callback       # exchanges the code, sets session
POST /api/salesforce/headless-360/token/refresh  # rotates the access token
GET  /api/salesforce/headless-360/me             # signed-in Salesforce userinfo
POST /api/salesforce/headless-360/logout         # clears session cookies

# Status state machine:
#   designed  — env vars unset → /config 200, others 503
#   prototype — env vars set   → all routes live
#   shipped   — VERIFIED=true  → operator confirmed E2E (gap #1 closed)`}</code>
        </pre>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Honest framing</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What this page does NOT claim
        </h2>
        <p>
          Pause is not a <em>Salesforce</em> product. Pause uses
          Salesforce surfaces — Data 360, Agentforce, Service Cloud,
          Anypoint / MuleSoft — under the patterns Salesforce
          recommends for non-Salesforce frontends. The Headless 360
          umbrella is, as of June 2026, a Salesforce Architects blog
          family (TDX 2026 announcement), not yet a help.salesforce.com
          or developer.salesforce.com doc family. This page does not
          claim Pause is &ldquo;Headless 360 certified&rdquo; or
          &ldquo;Salesforce-blessed&rdquo;; it claims that the
          architecture maps cleanly onto the three patterns, with
          honest pills on every row, and the missing pieces named.
        </p>
        <p style={{ color: "var(--muted)" }}>
          When Salesforce publishes a formal Headless 360 conformance
          spec (or a developer.salesforce.com doc family), this audit
          will be the easiest place to verify the prototype against
          that spec — every row is already mapped.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">
          The per-surface briefs + the Salesforce primary sources
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {readDeeper.map((row) => (
            <article key={row.href} className="card">
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}
              >
                <a
                  href={row.href}
                  target={row.external ? "_blank" : undefined}
                  rel={row.external ? "noopener noreferrer" : undefined}
                >
                  <h3 style={{ margin: 0 }}>{row.label}</h3>
                </a>
                {row.status && (
                  <StatusPill status={row.status} style={inlinePillStyle} />
                )}
              </header>
              <p style={{ marginTop: "0.4rem" }}>{row.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </ProposalShell>
  );
}
