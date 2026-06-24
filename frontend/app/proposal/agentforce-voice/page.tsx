import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { AgentforceVoiceButton } from "../../../components/agentforce-voice-button";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Agentforce Voice",
  description:
    "How Pause-Health.ai is wiring voice intake on Salesforce Agentforce Voice (GA Oct 2025) — the prototype-side seam ships today; full activation gates on Agentforce Contact Center licensing + a CCaaS partner.",
  path: "/proposal/agentforce-voice",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Agentforce Voice — Pause-Health.ai activation plan."
});

/**
 * Agentforce Voice brief.
 *
 * The seam is wired (lib/agentforce-voice.ts + the /api/agentforce/voice/
 * config route + AgentforceVoiceButton component). The status pill on
 * this page is driven by the same provisioning probe the button uses,
 * so the page is honest at every render:
 *
 *   - "designed" when AGENTFORCE_VOICE_* env vars are unset
 *   - "prototype" when they're set but AGENTFORCE_VOICE_VERIFIED isn't
 *   - "shipped" only after the operator records a verified round-trip
 *
 * Procurement + activation steps live in docs/AGENTFORCE_VOICE_RUNBOOK.md
 * so the dev team can wire the env vars without re-reading this page.
 *
 * This page deliberately does NOT claim "voice input via Web Speech
 * API" as Agentforce Voice. Agentforce Voice is a specific GA product
 * (the Oct 2025 announcement) that runs a native real-time speech
 * pipeline through Salesforce's own ASR/NLU/TTS stack and a CCaaS
 * partner. A browser-only mic→text wrapper around the existing chat
 * iframe is a different thing; if we ship it later, it'll be labeled
 * as "voice input for chat" on /proposal/agentforce, not here.
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

const whyVoiceFirst: Array<{
  title: string;
  detail: string;
  status: StatusPillStatus;
}> = [
  {
    title: "Menopause patients prefer voice for the hard parts",
    detail:
      "Hot flashes, night sweats, mood changes, and bleeding-pattern shifts are easier to describe out loud than to type. Voice surfaces these symptoms at the rate they actually happen in clinic — a triage advantage that compounds when paired with the structured intake the chat agent already runs.",
    status: "designed"
  },
  {
    title: "The agent's reasoning stays the same",
    detail:
      "Agentforce Voice runs the SAME Agentforce subagents and Actions as the text channel. The Find-a-Provider subagent, the Data 360 grounding query, the Care Router handoff — all of it is shared. The voice surface is the channel, not a different agent.",
    status: "shipped"
  },
  {
    title: "Phone-leg parity is the real unlock",
    detail:
      "The same Agentforce Voice surface can be reached over PSTN via Amazon Connect / Five9 / NiCE / Vonage. That means an after-hours patient can call a number and reach the same intake assistant — a deployment shape that matters more for provider organizations than for the prototype itself.",
    status: "planned"
  }
];

const wiringTable: Array<{
  surface: string;
  state: string;
  pill: StatusPillStatus;
}> = [
  {
    surface: "lib/agentforce-voice.ts (env-driven config)",
    state: "Shipped today. Defines AgentforceVoiceConfig, the four-env-var contract, and the {designed, prototype, shipped} status state machine.",
    pill: "shipped"
  },
  {
    surface: "GET /api/agentforce/voice/config",
    state: "Shipped today. Returns the public-safe config (status + provider + agentDeployment + language). Omits baseUrl and deploymentRef on purpose — those are partner-side opaque identifiers a third party could use to initiate a session against the CCaaS instance.",
    pill: "shipped"
  },
  {
    surface: "<AgentforceVoiceButton/> component",
    state: "Shipped today. Probes the config route, renders one of three affordances. Click handler currently surfaces a 'verification pending' toast — the real CCaaS handshake lands on the activation commit once a live instance exists to verify against.",
    pill: "shipped"
  },
  {
    surface: "Agentforce Contact Center add-on + CCaaS partner contract",
    state: "Procurement step. Salesforce sales-gated. See AGENTFORCE_VOICE_RUNBOOK.md for the checklist.",
    pill: "planned"
  },
  {
    surface: "Real audio round-trip from pause-health.ai → CCaaS → Agentforce → back",
    state: "Reserved for activation day. Triggered when an operator sets AGENTFORCE_VOICE_VERIFIED=true after recording a verified session.",
    pill: "future"
  }
];

const envVars: Array<{ name: string; required: boolean; example: string; purpose: string }> = [
  {
    name: "AGENTFORCE_VOICE_PROVIDER",
    required: true,
    example: "amazon-connect",
    purpose: "CCaaS partner. One of: amazon-connect, five9, nice, vonage. Determines which client SDK the voice button loads."
  },
  {
    name: "AGENTFORCE_VOICE_BASE_URL",
    required: true,
    example: "https://<alias>.my.connect.aws",
    purpose: "Partner base URL. Must start with https://."
  },
  {
    name: "AGENTFORCE_VOICE_DEPLOYMENT_REF",
    required: true,
    example: "12345abc-de67-89fa-bcde-f0123456789a",
    purpose: "CCaaS-side identifier (Amazon Connect Instance ID; Five9 campaign reference) that resolves to the Agentforce-bound contact flow. Opaque to the prototype."
  },
  {
    name: "AGENTFORCE_VOICE_AGENT_DEPLOYMENT",
    required: true,
    example: "Pause_Health_Intake_Agent",
    purpose: "Agentforce Service Agent deployment the contact flow routes voice turns to. Matches NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME when voice and chat target the same agent."
  },
  {
    name: "AGENTFORCE_VOICE_LANGUAGE",
    required: false,
    example: "en-US",
    purpose: "ASR + TTS locale. Defaults to en-US when unset."
  },
  {
    name: "AGENTFORCE_VOICE_VERIFIED",
    required: false,
    example: "true",
    purpose: "Flip to 1/true/on after recording a verified end-to-end round-trip. Promotes the page + button from 'prototype' to 'shipped'."
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
    href: "/proposal/headless-360",
    label: "Headless 360 — where Voice fits",
    detail:
      "Voice is the next channel in the REST leg of Salesforce's Headless 360 architecture (TDX 2026). The conformance audit page maps every Pause surface — including this one — onto the three Headless 360 patterns.",
    status: "partial"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce text-chat intake",
    detail:
      "The text-chat counterpart. Same agent, different surface. Today's prototype runs the embedded chat for intake; voice is the next channel.",
    status: "prototype"
  },
  {
    href: "/proposal/mcp",
    label: "MCP server + host",
    detail:
      "How the same Agentforce surface composes with the MCP tool plane. Voice + chat both go through the same find_menopause_providers tool when the host-mode flip lands.",
    status: "prototype"
  },
  {
    href: "https://www.salesforce.com/agentforce/voice/",
    label: "Salesforce: Agentforce Voice product page",
    detail: "Official product page for the GA Agentforce Voice surface (announced Oct 13, 2025).",
    external: true
  },
  {
    href: "https://www.salesforce.com/news/stories/agentforce-contact-center-announcement/",
    label: "Agentforce Contact Center launch (Mar 10, 2026)",
    detail: "The add-on that bundles native voice + CCaaS partner integrations.",
    external: true
  }
];

export default function AgentforceVoicePage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Agentforce Voice"
      title="Voice for the Pause intake agent — wired, gated on procurement."
      subtitle="Salesforce Agentforce Voice went GA in October 2025 and now ships as part of the Agentforce Contact Center add-on (March 2026). The Pause prototype has the partner-web seam in place today; full activation gates on the licensing + CCaaS instance every customer org already has when they buy Agentforce Voice."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the surface</p>
        <h2 className="proposal-section-title">
          The launch button, live on this page
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "60ch", marginBottom: "1rem" }}>
          This is the same <code>&lt;AgentforceVoiceButton/&gt;</code> the
          intake demo will mount. Its state reflects whatever{" "}
          <code>/api/agentforce/voice/config</code> reports for the current
          deployment — so on the public Pause site the pill says{" "}
          <em>designed</em>, on a deployment with the env vars set it says{" "}
          <em>prototype</em>, and after operator verification it says{" "}
          <em>shipped</em>. The button never claims more than the runtime
          can prove.
        </p>
        <AgentforceVoiceButton />
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why voice, and why now</p>
        <h2 className="proposal-section-title">Three reasons it&apos;s worth the activation cost</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyVoiceFirst.map((item) => (
            <article key={item.title} className="card">
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}
              >
                <h3 style={{ margin: 0 }}>{item.title}</h3>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </header>
              <p style={{ marginTop: "0.4rem" }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Wiring · What ships today vs. on activation</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The seam is in main; the audio round-trip is gated on procurement
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.6rem" }}>
          Salesforce&apos;s public docs on the partner-web Agentforce Voice
          surface are, as of June 2026, sales-gated — no public LWC, no
          published Agent API voice endpoint, no SDK index page that survives
          a curl. The prototype takes the honest path: ship the seam every
          deployment can show, gate the audio round-trip on the licensing the
          customer org already needs.
        </p>
        <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Surface</th>
                <th style={{ textAlign: "left" }}>State</th>
                <th style={{ textAlign: "left" }}>Pill</th>
              </tr>
            </thead>
            <tbody>
              {wiringTable.map((row) => (
                <tr key={row.surface}>
                  <td>
                    <code>{row.surface}</code>
                  </td>
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

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Configuration · The five env vars</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Activation checklist (deploy side)
        </h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.6rem" }}>
          The procurement side (Agentforce Contact Center add-on + CCaaS
          partner contract) is in{" "}
          <code>
            <a
              href="https://github.com/hucmaggie/pause-health.ai/blob/main/docs/AGENTFORCE_VOICE_RUNBOOK.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/AGENTFORCE_VOICE_RUNBOOK.md
            </a>
          </code>
          . Once those are in place, the deploy-side activation is the
          following Vercel env vars.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Env var</th>
                <th style={{ textAlign: "left" }}>Required</th>
                <th style={{ textAlign: "left" }}>Example</th>
                <th style={{ textAlign: "left" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {envVars.map((row) => (
                <tr key={row.name}>
                  <td>
                    <code>{row.name}</code>
                  </td>
                  <td>{row.required ? "yes" : "optional"}</td>
                  <td>
                    <code>{row.example}</code>
                  </td>
                  <td>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre style={codeBlockStyle}>
          <code>{`# After the CCaaS partner instance is live:
vercel env add AGENTFORCE_VOICE_PROVIDER         production  # amazon-connect
vercel env add AGENTFORCE_VOICE_BASE_URL         production  # https://<alias>.my.connect.aws
vercel env add AGENTFORCE_VOICE_DEPLOYMENT_REF   production  # Connect Instance ID
vercel env add AGENTFORCE_VOICE_AGENT_DEPLOYMENT production  # Pause_Health_Intake_Agent
vercel --prod --yes

# Verify (browser): /api/agentforce/voice/config → { status: "prototype", ... }
# Verify (browser): hit /proposal/agentforce-voice → button now enabled.
# After end-to-end audio round-trip:
vercel env add AGENTFORCE_VOICE_VERIFIED         production  # true
vercel --prod --yes`}</code>
        </pre>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Honest framing</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What this page does NOT claim
        </h2>
        <p>
          The button you can click on this page does not currently call
          Salesforce. It loads its state from the same{" "}
          <code>/api/agentforce/voice/config</code> route a Salesforce
          partner integration would consume — so the wiring contract is
          real — but the audio leg lands on the activation commit, not
          today.
        </p>
        <p style={{ color: "var(--muted)" }}>
          The other thing this page does not claim: that a Web Speech API
          wrapper around the existing Agentforce text chat is &ldquo;Agentforce
          Voice.&rdquo; That would be voice <em>input for chat</em> — a
          different product, and one that, if Pause ships it, will be
          documented separately so the distinction stays clear for any
          partner reading the comparison.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">
          Where this fits in the rest of the prototype
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
                <a href={row.href} target={row.external ? "_blank" : undefined} rel={row.external ? "noopener noreferrer" : undefined}>
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
