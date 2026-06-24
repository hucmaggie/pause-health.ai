import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Agentforce Intake",
  description:
    "Why Pause-Health.ai runs patient intake on Salesforce Agentforce + Service Cloud. Includes the environment table that explains when the live demo runs the real agent vs the scripted fallback.",
  path: "/proposal/agentforce",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Agentforce intake strategy — Pause-Health.ai investor brief."
});

/**
 * Agentforce architecture brief — Arc B polish pass.
 *
 * The single highest-risk claim on the previous version of this page
 * was: "The live demo at /demo/intake is currently running a real
 * Salesforce Agentforce Service Agent." That is conditionally true —
 * it requires four NEXT_PUBLIC_AGENTFORCE_* env vars to be set on the
 * Vercel project — and the public deployment posture for Pause is to
 * leave those unset for the same reasons the Data 360 page documents
 * (Trailhead-Playground API limits, demo-record bloat, etc.).
 *
 * Four polish moves here:
 *
 *   1. Per-card StatusPill on every whyAgentforce / setupSteps card so
 *      a reader can see at a glance what is decided-and-defensible vs
 *      what is design-partner-stage.
 *
 *   2. A "Where the live agent is wired" environment table cloned from
 *      /proposal/data-360, listing what each of (Local dev / Vercel
 *      preview+prod / Investor demo session) actually serves.
 *
 *   3. A "Touch the architecture" CTA bar so a reader can hit the
 *      prototype, the A2A agent.json, and the prechat-context API
 *      surface without scrolling all the way to the Read-deeper
 *      footer.
 *
 *   4. Honesty pass on the Read-deeper cross-links: the previous copy
 *      asserted that the Agentforce agent "consumes the Pause MCP
 *      server" and that the Care Router "is governed and traced by
 *      the MuleSoft Agent Fabric" — both of which are roadmap states.
 *      Both rows now carry a Designed pill and read as "will / in a
 *      customer deployment."
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const whyAgentforce: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    name: "Where our customers already live",
    status: "designed",
    detail:
      "Salesforce Health Cloud is deployed across a large share of US health systems and large payers. Building Pause intake on Agentforce means our intake artifacts land where the rest of the patient record already lives — no new console, no new identity, no new audit trail to defend. Pause is pre-design-partner, so this is the GTM thesis, not a customer deployment in production yet."
  },
  {
    name: "GA today, on Enhanced Chat v2",
    status: "shipped",
    detail:
      "Salesforce Embedded Messaging for Web (inline mode) is general-availability and is the substrate prospective design partners already license. We use the documented Embedded Service Deployment snippet — same pattern Salesforce ships in their public dev guide. Wired in the prototype: components/agentforce-embed.tsx mounts it when the four env vars are present."
  },
  {
    name: "Topics + Actions instead of prompt soup",
    status: "designed",
    detail:
      "Agentforce Service Agent organizes intake as topics (e.g. Symptom Capture, Red-Flag Screening, Consent) with structured actions. Each action writes typed fields to the FHIR record. This is what makes our intake auditable in a way a raw LLM chat is not. The dev-org agent (Pause_Health_Intake_Agent) has the topic skeleton; production-grade action wiring lands with the first design partner."
  },
  {
    name: "Compliance posture inherited",
    status: "designed",
    detail:
      "HIPAA-eligible Salesforce orgs come with audit logging, field-level encryption, region-pinned data residency, and SAML SSO. We inherit those controls instead of re-implementing them. Inherited posture only counts once we deploy into a customer org; today we run against a Trailhead Playground for development."
  }
];

const protoVsProd = [
  {
    aspect: "Public prototype experience",
    proto: "Pause-branded scripted intake (a local TypeScript state machine).",
    prod: "Real Agentforce Service Agent backed by Service Cloud topics + actions."
  },
  {
    aspect: "Data destination",
    proto: "Component state only. No PHI captured.",
    prod:
      "FHIR R5 Observations + Salesforce Health Cloud Person Account, both in the customer-controlled tenant."
  },
  {
    aspect: "Conversational logic",
    proto: "Hand-written script (lib/intake-script).",
    prod:
      "Agentforce topics + actions, with deterministic guardrails for red flags and consent."
  },
  {
    aspect: "Identity + audit",
    proto: "None — anonymous browser session.",
    prod: "SSO-backed patient session; full Salesforce audit trail."
  },
  {
    aspect: "Switch trigger",
    proto: "Default when NEXT_PUBLIC_AGENTFORCE_* env vars are unset.",
    prod:
      "All four NEXT_PUBLIC_AGENTFORCE_* env vars (orgId, deploymentName, siteUrl, scrt2Url) set in Vercel."
  }
];

const setupSteps = [
  {
    step: "1. Provision the Salesforce org",
    detail:
      "Service Cloud edition that includes Messaging for In-App and Web. Confirm with the Salesforce account team that Agentforce Service Agent is licensed."
  },
  {
    step: "2. Build the Agentforce Service Agent",
    detail:
      "Create the agent in Salesforce Setup. Define topics for Symptom Capture, Cycle Status, Red-Flag Screening, Consent. Wire actions that write structured fields to a custom Pause object (or Person Account)."
  },
  {
    step: "3. Create the Embedded Service Deployment",
    detail:
      "Setup → Embedded Service Deployments → New. Channel: Messaging for Web. Bind to the agent from step 2. Save and click Code Snippet."
  },
  {
    step: "4. Capture the four config values",
    detail:
      "From the Code Snippet panel, copy: Org ID (first init arg), Deployment API Name (second), Site URL (third), scrt2URL (in the options object)."
  },
  {
    step: "5. Set Vercel env vars",
    detail:
      "Set NEXT_PUBLIC_AGENTFORCE_ORG_ID, _DEPLOYMENT_NAME, _SITE_URL, _SCRT2_URL on the Pause Vercel project. Redeploy. The prototype intake page now renders the live agent automatically."
  },
  {
    step: "6. Validate the round trip",
    detail:
      "Run a test intake. Confirm the structured record appears in Salesforce. Confirm consent + red-flag actions fire correctly. Wire the FHIR write-back to JupyterHealth Exchange via our existing pause_ingest worker."
  }
];

const guardrails = [
  {
    label: "Public values only",
    detail:
      "All four env vars are public deployment metadata. They ship in the Salesforce-provided snippet by design and do not grant API access. We do not store any Connected App secrets, refresh tokens, or Frontdoor URLs in the frontend."
  },
  {
    label: "No PHI in the public prototype",
    detail:
      "The fallback intake runs entirely in browser memory and is reset on page reload. It exists to convey the experience, not to capture real patient data."
  },
  {
    label: "Salesforce trademarks used only descriptively",
    detail:
      "The investor narrative references Agentforce and Service Cloud by name because that is the technical substrate. We do not use the Salesforce logo, the Astro mascot, or any Salesforce visual marks in patient-facing surfaces unless and until a co-marketing agreement is in place."
  },
  {
    label: "Provider org isolation",
    detail:
      "Each provider customer points the env vars at their own Salesforce org. Pause does not centralize patient conversations through a Pause-owned org."
  }
];

type ReadDeeperRow = {
  href: string;
  label: string;
  detail: string;
  external?: boolean;
  status?: StatusPillStatus;
};

const readDeeper: ReadDeeperRow[] = [
  {
    href: "/proposal/data-360",
    label: "Data 360 grounding",
    detail:
      "Every intake is resolved to a unified Data 360 patient id and enriched with longitudinal context before the Care Router decides. The Phase 1 LIVE grounding path is wired in the prototype against a real Health Cloud org.",
    status: "prototype"
  },
  {
    href: "/proposal/agent-fabric",
    label: "Multi-agent control plane",
    detail:
      "In a customer deployment, the Agentforce intake hands off over Google A2A to the Anthropic Care Router; the whole multi-agent flow is governed and traced by the Agent Fabric. Today the fabric runs as an in-memory trace plane in the prototype (see /demo/agent-fabric).",
    status: "partial"
  },
  {
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    detail:
      "Where the Agentforce intake hands its structured record back to the FHIR R5 substrate. Today the integration is design-doc + reference flow; first end-to-end ingest lands with the first design partner.",
    status: "designed"
  },
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    detail:
      "How the intake's consent decisions and structured record will propagate into JupyterHealth, the DBDP feature pipeline, and downstream systems via the customer's Anypoint platform. Today: mocked Experience APIs at /api/mulesoft/*.",
    status: "designed"
  },
  {
    href: "/proposal/mcp",
    label: "MCP server",
    detail:
      "Provider lookup is already live: on the trailsignup org the Pause_Health_Intake_Agent has a \"Find a Provider\" subagent that calls findMenopauseProviders as a native Agentforce action via an External Service + Named Credential over /api/mulesoft/providers (verified GROUNDED in Preview — routes, calls with zip/menopause=true/limit=3, returns real NPPES-derived MSCP clinicians). The MCP server is the future consolidation, now wired both ways: stdio (npx @pause-health/mcp; private:true today, npm-published in Phase 1) for Claude Desktop / Cursor, AND Streamable HTTP at https://pause-health.ai/api/mcp for Agentforce 3.0 Registry intake (Setup → Agentforce Registry → New MCP server → paste the URL → allowlist the four tools → land in the Asset Library → attach to a Topic in Builder).",
    status: "prototype"
  },
  {
    href: "/proposal/technology",
    label: "Technology choices",
    detail:
      "Full stack rationale, including why Salesforce is the right front door — each layer status-pilled and cross-linked to the architecture brief that owns it."
  },
  {
    href: "/demo/intake",
    label: "Try the prototype",
    detail:
      "See the scripted intake (and, where configured, the live agent) end-to-end. Public deployments default to the scripted fallback by design — see the environment table above."
  },
  {
    href: "https://developer.salesforce.com/docs/ai/agentforce/guide/enhanced-chat-inline-mode.html",
    label: "Salesforce: Inline Mode in Enhanced Chat v2",
    detail: "The Salesforce dev guide we follow for the embedded mount.",
    external: true
  }
];

export default function AgentforcePage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Agentforce intake"
      title="Patient intake on Salesforce Agentforce + Service Cloud"
      subtitle="Pause-Health.ai's patient intake is built to run on Agentforce Service Agent inside Salesforce — the substrate that most US health systems and payers already operate. The public prototype defaults to a scripted Pause-branded fallback; the live Agentforce agent activates when the four NEXT_PUBLIC_AGENTFORCE_* env vars are set in Vercel. See the environment table below for what each deployment actually serves."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why Agentforce</p>
        <h2 className="proposal-section-title">Four reasons the front door is Salesforce</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="shipped" style={inlinePillStyle} /> wired in the
          prototype today ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> design
          decision, activates with the first design partner.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyAgentforce.map((item) => (
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

      <section
        className="card"
        style={{
          marginTop: "1.5rem",
          borderLeft: "3px solid var(--brand)"
        }}
      >
        <p className="eyebrow">Where the live agent is wired</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What each deployment actually serves
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The live Agentforce Service Agent path is activated by four
          {" "}<code>NEXT_PUBLIC_AGENTFORCE_*</code> env vars
          (<code>ORG_ID</code>, <code>DEPLOYMENT_NAME</code>,
          {" "}<code>SITE_URL</code>, <code>SCRT2_URL</code>). When all four
          are present, <a href="/demo/intake">/demo/intake</a> mounts the real
          Salesforce Embedded Messaging for Web bootstrap and runs the
          {" "}<code>Pause_Health_Intake_Agent</code> in our dev org. When any
          one is missing, the page falls back to a Pause-branded scripted
          intake (<code>components/agentforce-fallback.tsx</code>) so the
          experience renders end-to-end without credentials.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.8rem" }}>
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>AGENTFORCE env vars</th>
                <th>Active intake path</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Local dev</strong> (founder&apos;s machine)</td>
                <td>Set in <code>frontend/.env.local</code></td>
                <td>LIVE Agentforce Service Agent (real Salesforce dev org)</td>
              </tr>
              <tr>
                <td>
                  <strong>Vercel preview / production</strong>{" "}
                  (<code>pause-health.ai</code>)
                </td>
                <td>Deliberately unset</td>
                <td>Pause-branded scripted fallback (shape-identical to live path)</td>
              </tr>
              <tr>
                <td><strong>Investor demo session</strong></td>
                <td>Temporarily set in Vercel, then unset after</td>
                <td>LIVE for the duration of the demo</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: "0.7rem", color: "var(--muted)", fontSize: "0.92rem" }}>
          Why the public site is fallback-by-default: the connected dev org
          is a Trailhead Playground (not production-grade), and routing
          public intake traffic at it would (a) exhaust its API limits, (b)
          create unbounded demo conversation records, and (c) tie investor
          demo quality to whoever last did a write against the agent. The
          scripted fallback is clinically realistic and conveys the same
          experience without any of those risks. The first paying customer
          brings their own Salesforce org and their own env vars (Path: the
          six-step setup checklist below).
        </p>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Three live surfaces you can hit right now
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          Even when the live agent is gated off, the surrounding Pause
          architecture is fully wired in the prototype and inspectable in
          one click.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            marginTop: "0.8rem"
          }}
        >
          <a className="btn btn-primary" href="/demo/intake">
            Open the prototype intake →
          </a>
          <a
            className="btn btn-secondary"
            href="/api/agents/care-router/.well-known/agent.json"
            target="_blank"
            rel="noopener noreferrer"
          >
            Care Router A2A descriptor →
          </a>
          <a
            className="btn btn-secondary"
            href="/api/intake/prechat-context?personaId=anika-patel"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sample prechat context →
          </a>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What changes when the env vars are set
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The surrounding layout, the structured-record handoff scaffolding,
          and the clinical triage rules are identical across both modes —
          only the chat surface and the data destination differ.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Aspect</th>
                <th>Public prototype</th>
                <th>Provider deployment</th>
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
        <p className="eyebrow">Setup checklist · provider deployment</p>
        <h2 className="proposal-section-title">
          The six steps to a live customer deployment
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          <StatusPill status="planned" style={inlinePillStyle} /> The entire
          checklist runs end-to-end with the first design partner.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {setupSteps.map((step) => (
            <article key={step.step} className="card">
              <h3>{step.step}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Guardrails</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What we are deliberately not doing
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {guardrails.map((g) => (
            <li key={g.label}>
              <span>{g.label}</span>
              <strong style={{ fontWeight: 500 }}>{g.detail}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Strategic fit</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Why this front-door choice compounds with the rest of the stack
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Procurement velocity</span>
            <strong style={{ fontWeight: 500 }}>
              &quot;Runs on your existing Salesforce&quot; is the fastest
              possible answer to a security review. We are adding capability
              to a substrate the customer already trusts, not introducing a
              new vendor for the data plane.
            </strong>
          </li>
          <li>
            <span>Operational alignment</span>
            <strong style={{ fontWeight: 500 }}>
              Salesforce is where the customer&apos;s care coordinators
              already work. Routing exceptions and follow-up tasks flow
              through queues those teams already manage.
            </strong>
          </li>
          <li>
            <span>Compounds with our other choices</span>
            <strong style={{ fontWeight: 500 }}>
              The stack we are building toward: Salesforce on the front,
              FHIR R5 + JupyterHealth on the back, DBDP for wearable feature
              engineering, our menopause model in the middle. Each piece is
              the best-in-class open substrate for its role — see{" "}
              <a href="/proposal/technology">technology choices</a> for the
              layer-by-layer status pills.
            </strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where Agentforce sits in the bigger picture</h2>
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
