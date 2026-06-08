import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Salesforce Data 360",
  description:
    "How Pause-Health.ai grounds its Care Router agent in a Salesforce Data 360 federated patient view. Today: real Salesforce Health Cloud objects via OAuth Client Credentials, with identity resolution against real seeded Contacts. Phase 2: federate JupyterHealth, DBDP, and the customer's EHR-of-record.",
  path: "/proposal/data-360",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause × Salesforce Data 360 — investor brief."
});


const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const whyData360: Array<{
  title: string;
  status: StatusPillStatus;
  detail: React.ReactNode;
}> = [
  {
    title: "Zero-copy federation",
    status: "designed",
    detail: (
      <>
        The pattern Data 360 enables is to query the customer&apos;s
        existing data plane in place — JupyterHealth FHIR, Snowflake /
        Databricks warehouses, DBDP feature stores, and the Epic Health
        Cloud — via the Federation + Iceberg connectors. No PHI
        bulk-ingestion into Salesforce; nothing for the customer&apos;s
        data team to migrate. Today, the live grounding path federates
        against the customer surface we control (Salesforce Health
        Cloud); the broader sources federate in Phases 2–3.
      </>
    )
  },
  {
    title: "Unified patient memory",
    status: "partial",
    detail: (
      <>
        Identity Resolution reconciles the same patient across wearable
        signups, EHR records, prior intake sessions, and claims. The Care
        Router decides over a single unified patient, not whichever
        fragment happened to be in the current API response. Today:
        deterministic match against real seeded Health Cloud Contacts is
        LIVE behind <code>/api/data-360/identity/resolve</code> when
        Salesforce env vars are set; the configurable cross-source IR
        ruleset is Phase 2.
      </>
    )
  },
  {
    title: "Calculated insights as triage features",
    status: "partial",
    detail: (
      <>
        Materialized features computed continuously across the federated
        sources. Today: 3 Salesforce-native insights (active care program,
        days since last clinical contact, active care plan status) are
        computed LIVE on every Care Router call from real Health Cloud
        objects. The wearable / EHR insights (HRV z-score, vasomotor
        burden, sleep disruption) are mocked intake-baselines awaiting
        Phase 2 Data Cloud federation. These become routing inputs without
        us writing a feature pipeline.
      </>
    )
  },
  {
    title: "Segments power proactive care",
    status: "designed",
    detail: (
      <>
        Population segments (e.g. &quot;late perimenopause with rising HRV
        variability&quot;, &quot;postmenopausal bleeding cohort&quot;)
        activate to Agentforce, the Agent Fabric, and Health Cloud. Pause
        will reach the right patients before they ever open an intake
        session. Today: four hand-curated segments are returned by{" "}
        <code>/api/data-360/segments</code>; segment authoring + activation
        plumbing are Phase 4 work.
      </>
    )
  }
];

const fabricFit: Array<{
  title: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    title: "Sits between MuleSoft and the agents",
    status: "designed",
    detail:
      "MuleSoft remains the integration plane (system-to-system, writes, transforms). Data 360 is the unified read plane on top: 'what do we know about this patient, right now, across every source we federate into?' The two compose cleanly. MuleSoft itself is currently mocked at /api/mulesoft/* (see /proposal/mulesoft); the Data 360 read plane is live against Health Cloud today."
  },
  {
    title: "Registered as a first-class agent on the fabric",
    status: "prototype",
    detail:
      "Data 360 appears in the Agent Fabric registry alongside Agentforce, the Care Router, the Pause MCP server, and MuleSoft. Its grounding queries emit trace spans. Its identity resolution emits trace spans. Every call is auditable in the same pane — verifiable today at /demo/agent-fabric."
  },
  {
    title: "Policy-governed grounding",
    status: "partial",
    detail:
      "Three Data 360-specific policies advertised today: zero-copy-federation-only (no PHI bulk-ingest), consent-required-before-grounding (the Care Router cannot read without an active 'ai-decision-support' consent), segment-activation-allowlist (downstream channels must be approved). The consent ledger is included on the federated record; hard-blocking enforcement is Phase 3 work alongside the customer's consent service. Standard HIPAA audit policy applies to every grounding call."
  },
  {
    title: "Identity resolution at the front door",
    status: "prototype",
    detail:
      "When Agentforce captures the intake, the handoff endpoint asks Data 360 to resolve the partial identity to a unified patient id. That unified id flows through the rest of the trace — the Care Router, the MCP server, every downstream span carries it. Wired today at /api/data-360/identity/resolve against real seeded Health Cloud Contacts."
  }
];

const traceFlow = [
  {
    step: 1,
    span: "Agentforce intake.complete",
    detail:
      "Patient finishes the intake. Captured fields, red-flag screen, and severity are recorded as the parent span."
  },
  {
    step: 2,
    span: "Data 360 identity.resolve",
    detail:
      "The handoff endpoint asks Data 360 to resolve the partial identity. Returns the unified patient id and the IR confidence score. LIVE against real seeded Salesforce Health Cloud Contacts when env vars are set."
  },
  {
    step: 3,
    span: "Data 360 grounding.federated-query",
    detail:
      "Federated read against the Data 360 unified patient view: calculated insights (active care program, days since last clinical contact, active care plan status — all LIVE Salesforce-native), longitudinal observations, cohort comparison. Wearable / EHR insights (HRV, vasomotor, sleep) are mocked baselines pending Phase 2."
  },
  {
    step: 4,
    span: "Care Router a2a.tasks/send",
    detail:
      "The Care Router receives BOTH the intake AND the Data 360 grounding as data parts of one A2A message. Decision rationale cites which insights it used; span attributes record cohort name and insights cited."
  }
];

const protoVsProd: Array<{
  aspect: string;
  status: StatusPillStatus;
  proto: string;
  prod: string;
}> = [
  {
    aspect: "Identity Resolution",
    status: "prototype",
    proto:
      "LIVE today: deterministic match against real seeded Health Cloud Contacts in our Salesforce dev org. Returns the real Salesforce Contact.Id as the unified patient id. Mock falls back automatically if the org is unreachable.",
    prod:
      "Configurable Data 360 IR ruleset across federated sources, returning ranked match candidates with confidence scores."
  },
  {
    aspect: "Grounding query target",
    status: "prototype",
    proto:
      "LIVE today: real SOQL against Salesforce Health Cloud (Contact + CareProgramEnrollee + CarePlan + Case). Returns real enrollment status, real care-plan status, real days-since-last-clinical-contact, real cohort size.",
    prod:
      "Real Salesforce Data 360 Federated Query API against the customer's JupyterHealth FHIR store, DBDP feature warehouse, and EHR-of-record. Phase 1 SOQL pattern stays — the federation target swaps."
  },
  {
    aspect: "Calculated insights — Salesforce-native",
    status: "prototype",
    proto:
      "LIVE today: \"Active care program enrollment\", \"Days since last clinical contact\", \"Active care plan status\" — built from real Health Cloud objects on every Care Router call. Insight names match what lib/salesforce/grounding.ts emits.",
    prod:
      "Same insights plus Data 360 Calculated Insights jobs recomputed nightly/streaming over the federated sources."
  },
  {
    aspect: "Calculated insights — wearable / EHR",
    status: "designed",
    proto:
      "MOCKED (Phase 2 work): HRV variability z-score, vasomotor burden composite, sleep disruption index. Marked as 'intake-only baseline' in the API so it's clear which insights are real vs which await Data Cloud federation.",
    prod:
      "Real Data 360 Calculated Insights jobs against the customer's JupyterHealth FHIR observations and DBDP feature warehouse."
  },
  {
    aspect: "MSCP-credentialed contact recency",
    status: "designed",
    proto:
      "Surfaced in the mocked /api/data-360/* path as \"days since last MSCP-credentialed clinician contact\" so the trace + UI can model the eventual signal. The LIVE Health Cloud path returns only generic \"days since last clinical contact\" because the credential overlay isn't wired into the seeded Contacts yet.",
    prod:
      "Joins the LIVE clinical-contact recency against the customer's MSCP roster (from /proposal/provider-graph + /proposal/menopause-society partnership) to produce the credential-aware signal."
  },
  {
    aspect: "Segments",
    status: "designed",
    proto:
      "Four hand-curated segments returned by /api/data-360/segments (mocked).",
    prod:
      "Population segments authored in the Data 360 console by the customer's clinical-data team, with activation routes configured per segment."
  },
  {
    aspect: "Consent enforcement",
    status: "designed",
    proto:
      "Consent ledger included on the federated record; policy advertised but not blocking the prototype.",
    prod:
      "Hard-enforced by the Data 360 consent service. Care Router grounding calls without an active 'ai-decision-support' consent are rejected with a redaction notice."
  }
];

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 1 — Real Health Cloud grounding",
    status: "prototype",
    duration: "Shipped",
    detail:
      "Pause's Care Router is now grounded on real Salesforce Health Cloud objects from a connected dev org: real Contact, real CareProgramEnrollee, real CarePlan, real Case. OAuth 2.0 Client Credentials Flow via an External Client App. The Agent Fabric console shows a LIVE badge on every span served by the real org. Zero-credential mock path remains the default for previews and CI."
  },
  {
    name: "Phase 2 — Data Cloud unified profile",
    status: "partial",
    duration: "Code ready · org provisioning outstanding",
    detail:
      "The Data Cloud Calculated Insights client is live in lib/salesforce/data-cloud.ts. Three CIs (HRV RMSSD z-score, vasomotor burden, sleep disruption) are called in parallel with the Phase 1 SOQL grounding and layer on top when SF_DC_TENANT_URL is set. Remaining: provision the DC tenant on the connected org, author the three CI definitions, set the env var. Full walkthrough in docs/MULESOFT_PHASE_2_DATA_CLOUD.md."
  },
  {
    name: "Phase 3 — First customer deployment",
    status: "designed",
    duration: "4–6 weeks with customer",
    detail:
      "Federate the customer's EHR-of-record (Epic / Cerner / Athena) and their DBDP feature warehouse. Author the customer's IR ruleset. Wire consent enforcement to the customer's existing consent ledger. Roll the Care Router onto real-customer grounding."
  },
  {
    name: "Phase 4 — Cohort analytics & activation",
    status: "future",
    duration: "Ongoing",
    detail:
      "Population segments activate to Agentforce for proactive outreach (\"women in your cohort who saw an MSCP within 14 days had 71% symptom resolution\"). Health Cloud cards on the patient timeline. Marketing Cloud for educational journeys."
  }
];

const investorTakeaways: Array<{
  label: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    label: "Hospitals don't migrate; they federate",
    status: "designed",
    detail:
      "Pause does not ask a customer to move PHI into Salesforce. Data 360's zero-copy federation reads the data where it already lives (JupyterHealth, Snowflake, Epic). This is the posture that closes deals with Chief Data Officers — the prototype federates only against Salesforce Health Cloud today; the broader federation is Phase 2/3 work."
  },
  {
    label: "Longitudinal context makes the agent visibly smarter",
    status: "prototype",
    detail:
      "Without Data 360 grounding, the Care Router sees one intake. With it, the agent sees real Health Cloud enrollment status, real care-plan status, and real days-since-last-clinical-contact today; the 30-day HRV trend / vasomotor trajectory / cohort percentile arrive with Phase 2. The same code path already produces materially better routing decisions — and the rationale shows it."
  },
  {
    label: "Open ecosystem at every tier — including data",
    status: "designed",
    detail:
      "Data 360 is the customer's data control plane. MuleSoft is their integration plane. JupyterHealth + FHIR + DBDP is their clinical substrate. MCP + A2A is the agent contract. Pause composes — it doesn't lock anything in."
  },
  {
    label: "Same data plane, two product motions",
    status: "designed",
    detail:
      "B2C: the Care Router routes patients smarter because Data 360 told it about the cohort. B2B: hospitals install Pause on top of their existing Data 360 (or our managed Data 360) and segment their menopause population for proactive care. One platform, two GTM wedges."
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
    href: "/proposal/agent-fabric",
    label: "Multi-agent control plane",
    detail:
      "The Agent Fabric where Data 360 is registered and its grounding calls are traced.",
    status: "prototype"
  },
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    detail:
      "The integration plane that will write back to JupyterHealth and the EHR-of-record that Data 360 federates over. Today: Experience APIs mocked at /api/mulesoft/*.",
    status: "designed"
  },
  {
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    detail:
      "The FHIR R5 substrate Data 360 will read from as its primary clinical federation target. Today: omh-shim + jupyterhealth-client integrated in pause_ingest; JHE federation is Phase 2.",
    status: "partial"
  },
  {
    href: "/proposal/dbdp",
    label: "DBDP feature engineering",
    detail:
      "The wearable feature pipeline that will supply HRV, sleep, and vasomotor signals to Data 360 calculated insights. Today: FLIRT + DBDP HRV math integrated in pause_ingest.",
    status: "partial"
  },
  {
    href: "/proposal/provider-graph",
    label: "Provider graph",
    detail:
      "Where the MSCP credential overlay comes from — the join target that makes 'days since last clinical contact' into 'days since last MSCP-credentialed contact' in Phase 3.",
    status: "designed"
  },
  {
    href: "https://www.salesforce.com/data/",
    label: "Salesforce Data 360",
    detail: "The Salesforce product Pause grounds its agents on.",
    external: true
  }
];

export default function Data360Page() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Salesforce Data 360"
      title="Unified patient memory, federated in place"
      subtitle="Pause-Health.ai's Care Router is grounded on real Salesforce Health Cloud objects today via OAuth Client Credentials, with identity resolution against real seeded Contacts. Phase 2 swaps the federation target for the Data Cloud Federated Query API against JupyterHealth FHIR + DBDP feature warehouse; Phase 3 onboards the customer's EHR-of-record. The Care Router interface doesn't change across phases."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why Data 360</p>
        <h2 className="proposal-section-title">Four properties — pilled by what's wired today</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="partial" style={inlinePillStyle} /> some
          surface is LIVE in the prototype; the rest is Phase 2/3 ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> committed
          path, activates with Phase 2 or first customer.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyData360.map((item) => (
            <article key={item.title} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{item.title}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">How it composes with the rest of the stack</p>
        <h2 className="proposal-section-title">Where Data 360 sits in the fabric</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {fabricFit.map((item) => (
            <article key={item.title} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={item.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{item.title}</h3>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The four-span trace</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Every multi-agent task produces this shape
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          Open <a href="/demo/agent-fabric">/demo/agent-fabric</a>, run a
          test case, and watch the four spans appear with parent/child
          correlation intact. When Salesforce env vars are set, spans 2
          and 3 carry a LIVE badge.
        </p>
        <ol style={{ marginTop: "0.8rem", paddingLeft: "1.2rem" }}>
          {traceFlow.map((row) => (
            <li key={row.step} style={{ marginBottom: "0.6rem" }}>
              <strong>Span {row.step}: </strong>
              <code style={{ fontSize: "0.88rem" }}>{row.span}</code>
              <p style={{ marginTop: "0.2rem" }}>{row.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Every Data 360 surface is reachable as a real HTTP endpoint
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The Care Router reads grounding from one of these on every
          intake. When Salesforce env vars are set, grounding + identity
          resolve go LIVE against the connected Health Cloud org; when
          unset, they fall back to the deterministic mock.{" "}
          <em>
            Identity resolve is a POST endpoint invoked during the intake
            flow — click through to <code>/demo/intake</code> to exercise
            it end-to-end rather than as a one-shot URL.
          </em>
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a href="/demo/agent-fabric" className="btn btn-primary">
            Open Agent Fabric console →
          </a>
          <a
            href="/api/data-360/patient/pause-demo-patient-001/grounding"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            GET /api/data-360/.../grounding →
          </a>
          <a
            href="/demo/intake?personaId=anika-patel"
            className="btn btn-secondary"
          >
            Identity resolve (POST · run in /demo/intake) →
          </a>
          <a
            href="/api/data-360/patient/pause-demo-patient-001/record"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Federated patient record →
          </a>
          <a
            href="/api/data-360/segments"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Population segments →
          </a>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Where Phase 1 is wired</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Three environments, one decision matrix
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          The real-Salesforce grounding path is activated by three env vars
          (<code>SF_INSTANCE_URL</code>, <code>SF_CLIENT_ID</code>,
          {" "}<code>SF_CLIENT_SECRET</code>). When set, the Care Router
          queries a connected Health Cloud org via OAuth 2.0 Client
          Credentials Flow. When unset, every API route silently falls back
          to the deterministic mock and the prototype runs end-to-end with
          zero credentials.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.8rem" }}>
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>SF env vars</th>
                <th>Active grounding path</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Local dev</strong> (founder&apos;s machine)</td>
                <td>Set in <code>frontend/.env.local</code></td>
                <td>LIVE Salesforce Health Cloud (real Contact / CareProgramEnrollee / CarePlan / Case)</td>
              </tr>
              <tr>
                <td><strong>Vercel preview / production</strong> (<code>pause-health.ai</code>)</td>
                <td>Deliberately unset</td>
                <td>Deterministic mock (shape-identical to live path)</td>
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
          Why the public site is mock-by-default: the connected dev org is
          a Trailhead Playground (not production-grade), and routing public
          intake traffic at it would (a) exhaust its API limits, (b) create
          unbounded demo records, and (c) tie investor demo quality to
          whoever last did a write against the org. The mock is identical
          in shape and clinically realistic, so the public surface stays
          investor-ready without any of those risks. The first paying
          customer brings their own Salesforce org and their own env vars.
        </p>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production · per-row status</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Seven aspects of the federation, labeled honestly
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0.4rem 0 0.6rem",
            fontSize: "0.92rem"
          }}
        >
          Pills:{" "}
          <StatusPill status="prototype" style={inlinePillStyle} /> LIVE
          today against Salesforce Health Cloud when env vars are set ·{" "}
          <StatusPill status="designed" style={inlinePillStyle} /> mocked
          today, activates with Phase 2/3 federation.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Aspect</th>
                <th>Prototype today</th>
                <th>Customer deployment</th>
              </tr>
            </thead>
            <tbody>
              {protoVsProd.map((row) => (
                <tr key={row.aspect}>
                  <td>
                    <StatusPill status={row.status} style={inlinePillStyle} />
                  </td>
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
        <h2 className="proposal-section-title">From real Health Cloud grounding to a federated customer deployment</h2>
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
          Four properties of the Data 360 grounding strategy
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {investorTakeaways.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <strong style={{ fontWeight: 500 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "flex-start",
                    gap: "0.4rem",
                    flexWrap: "wrap"
                  }}
                >
                  <StatusPill status={item.status} style={inlinePillStyle} />
                  <span>{item.detail}</span>
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where Data 360 meets the rest of the brief</h2>
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
