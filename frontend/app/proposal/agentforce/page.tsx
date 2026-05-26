import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Agentforce Intake",
  description:
    "Why Pause-Health.ai runs patient intake on Salesforce Agentforce + Service Cloud, and how the prototype upgrades to a live deployment.",
  path: "/proposal/agentforce",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Agentforce intake strategy — Pause-Health.ai investor brief."
});

const whyAgentforce = [
  {
    name: "Where our customers already live",
    detail:
      "Salesforce Health Cloud is deployed across the majority of US health systems and large payers. Building Pause intake on Agentforce means our intake artifacts land where the rest of the patient record already lives — no new console, no new identity, no new audit trail to defend."
  },
  {
    name: "GA today, on Enhanced Chat v2",
    detail:
      "Salesforce Embedded Messaging for Web (inline mode) is general-availability and is the surface most of our pilot customers already license. We use the documented Embedded Service Deployment snippet — same pattern Salesforce ships in their public dev guide."
  },
  {
    name: "Topics + Actions instead of prompt soup",
    detail:
      "Agentforce Service Agent organizes intake as topics (e.g. Symptom Capture, Red-Flag Screening, Consent) with structured actions. Each action writes typed fields to the FHIR record. This is what makes our intake auditable in a way a raw LLM chat is not."
  },
  {
    name: "Compliance posture inherited",
    detail:
      "HIPAA-eligible Salesforce orgs come with audit logging, field-level encryption, region-pinned data residency, and SAML SSO. We inherit those controls instead of re-implementing them."
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

export default function AgentforcePage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Agentforce intake"
      title="Patient intake on Salesforce Agentforce + Service Cloud"
      subtitle="Pause-Health.ai's patient intake runs on Agentforce Service Agent inside Salesforce — the substrate that most US health systems and payers already operate. The public prototype shows the experience; provider deployments are the real thing."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why Agentforce</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyAgentforce.map((item) => (
            <article key={item.name} className="card">
              <h3>{item.name}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <p style={{ marginTop: "0.4rem" }}>
          The public prototype at <a href="/demo/intake">/demo/intake</a> renders a
          Pause-branded scripted intake by default. The same page automatically upgrades
          to a live Agentforce Service Agent once the four deployment env vars are set.
          The surrounding layout, the structured-record handoff, and the clinical triage
          rules are identical across both modes.
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
        <p className="eyebrow">Setup checklist (provider deployment)</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {setupSteps.map((step) => (
            <article key={step.step} className="card">
              <h3>{step.step}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Guardrails</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
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
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Procurement velocity</span>
            <strong style={{ fontWeight: 500 }}>
              &quot;Runs on your existing Salesforce&quot; is the fastest possible answer
              to a security review. We are adding capability to a substrate the customer
              already trusts, not introducing a new vendor for the data plane.
            </strong>
          </li>
          <li>
            <span>Operational alignment</span>
            <strong style={{ fontWeight: 500 }}>
              Salesforce is where the customer&apos;s care coordinators already work.
              Routing exceptions and follow-up tasks flow through queues those teams
              already manage.
            </strong>
          </li>
          <li>
            <span>Compounds with our other choices</span>
            <strong style={{ fontWeight: 500 }}>
              Salesforce on the front, FHIR + JupyterHealth on the back, DBDP for
              wearables, our menopause model in the middle. Every piece is the
              best-in-class open substrate for its role.
            </strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Where the Agentforce intake hands its structured record back to the FHIR
              substrate.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the intake&apos;s consent decisions and structured record propagate
              into JupyterHealth, the DBDP feature pipeline, and any downstream systems
              via the customer&apos;s Anypoint platform.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mcp">MCP server</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              In production, the Agentforce Service Agent consumes the Pause MCP server
              to call <code>get_patient_timeline</code>, <code>get_patient_intake</code>,
              and <code>find_menopause_providers</code> as native tools.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Multi-agent control plane</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Agentforce intake hands off over Google A2A to the Anthropic
              Care Router; the whole multi-agent flow is governed and traced by
              the MuleSoft Agent Fabric.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/technology">Technology choices</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Full stack rationale, including why Salesforce is the right front door.
            </strong>
          </li>
          <li>
            <span>
              <a href="/demo/intake">Try the prototype</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              See the scripted intake (and, where configured, the live agent) end-to-end.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://developer.salesforce.com/docs/ai/agentforce/guide/enhanced-chat-inline-mode.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                Salesforce: Inline Mode in Enhanced Chat v2
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Salesforce dev guide we follow for the embedded mount.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
