import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill, type StatusPillStatus } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";
import { isMulesoftHealthLive } from "../../../lib/mulesoft/health";
import { isMulesoftProvidersLive } from "../../../lib/mulesoft/providers";

// Read MULESOFT_HEALTH_BASE_URL at request time, not build time, so
// flipping the env var in Vercel propagates without rebuilding the
// investor page. The page is otherwise statically rendered.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Investor Brief · MuleSoft Integration",
  description:
    "MuleSoft Anypoint integration plane for Pause-Health.ai. Iterations 1–7 shipped (CloudHub 2.0 worker live, Flex Gateway enforcing JWT + rate limiting, OAS 3.0 spec on Exchange). Phase 3 opened 2026-06-26: three shared Exchange assets published (pause-omh-to-fhir-library v1.0.0 + pause-jhe-system-api-spec v1.0.0 + pause-dbdp-system-api-spec v1.0.0). Full three-tier architecture activates with first design partner.",
  path: "/proposal/mulesoft",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "MuleSoft integration strategy — Pause-Health.ai investor brief."
});

/**
 * MuleSoft integration brief — Arc B polish pass.
 *
 * The previous version read in present tense ("our integration runs
 * through MuleSoft Anypoint", "per-vendor adapters that own OAuth")
 * for a state that is currently: reference Mule XML + DataWeave
 * committed under `mulesoft/`, mocked Experience-tier endpoints at
 * `/api/mulesoft/*` served by Next.js, and a design doc. Zero real
 * Mule deployment exists. The page's own protoVsProd table makes
 * this clear -- the narrative voice above it should match.
 *
 * Four moves:
 *
 *   1. Per-card StatusPill on every tiers and whyMulesoft card.
 *      All four `tiers` cards are `designed` (no Mule deployed
 *      anywhere yet). Three of four `whyMulesoft` cards are
 *      `designed` (GTM/operational thesis); one is `prototype`
 *      (composes-with-our-other-choices, because the composition
 *      story is partly wired -- /demo/intake's grounding card
 *      really does cite a mocked Experience API today).
 *
 *   2. Expand the CTA bar from one mocked endpoint to all four
 *      Experience APIs available under /api/mulesoft/*.
 *
 *   3. Soften the subtitle to match the protoVsProd reality
 *      ("designed to run through" / "today: mocked + reference
 *      artifacts").
 *
 *   4. Pill the phases cards. Phase 0 = `prototype`, 1 + 2 =
 *      `designed`, 3 = `future`. Tighten investor-takeaways copy
 *      that implied current customer-ownership and current
 *      closing-velocity.
 */

const inlinePillStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  marginRight: "0.4rem"
};

const tiers: Array<{
  name: string;
  status: StatusPillStatus;
  role: string;
  detail: string;
}> = [
  {
    name: "System APIs",
    status: "designed",
    role: "Wrap each upstream once",
    detail:
      "Per-vendor adapters that will own OAuth, rate limits, retry, and circuit-breaker behavior. One System API per wearable (Oura, Apple Health, Whoop, Empatica) plus one each for JupyterHealth Exchange and the DBDP feature worker. Today the equivalent logic lives in the Python pause_ingest package, not in Mule."
  },
  {
    name: "Process APIs",
    status: "designed",
    role: "Orchestrate cross-system flows",
    detail:
      "Stateless orchestration between System APIs. pause-ingest-process-api will validate an Open mHealth payload, transform to FHIR R5 via DataWeave, post to JHE, and fire a feature compute request to DBDP. Reference XML + DataWeave committed under mulesoft/; not yet deployed to an Anypoint runtime."
  },
  {
    name: "Experience APIs",
    status: "partial",
    role: "Pause-facing read endpoints",
    detail:
      "Read-optimized FHIR Bundles that combine raw Observations with DBDP-computed feature Observations. The Pause clinician web app calls these — never JHE or DBDP directly. Today /health and /providers are live on CloudHub 2.0, protected by Flex Gateway (JWT Validation + Rate Limiting); /timeline and /intake are deterministic mocks at /api/mulesoft/* with the same response shapes. Full three-tier deployment activates with the first design partner."
  }
];

const whyMulesoft: Array<{
  name: string;
  status: StatusPillStatus;
  detail: string;
}> = [
  {
    name: "The buyer already owns it",
    status: "designed",
    detail:
      "Most US health systems and large payers already license MuleSoft Anypoint Platform. Adding Pause becomes 'another Mule app on the existing fabric' — the lowest-friction posture a procurement team can encounter. This is the GTM thesis; the first Mule-on-customer-Anypoint deployment lands with the first design partner."
  },
  {
    name: "Vendor swap with no Pause code change",
    status: "designed",
    detail:
      "Adding a new wearable (Garmin, Withings, etc.) will be one new System API plus one row in the Process API's routing config. The Pause backend would be untouched. Customers would extend the integration without coordinating with our engineering team. Operationalizes when Mule is deployed in a customer org."
  },
  {
    name: "Operational ownership flows correctly",
    status: "designed",
    detail:
      "The customer's integration team will own the System and Process APIs. Pause will own the Experience APIs and the menopause-specific logic. Each side operates the layer they understand best. Honest framing: this is a design intent until there is a customer to own the customer half."
  },
  {
    name: "Composes with our other choices",
    status: "prototype",
    detail:
      "MuleSoft in the middle, JupyterHealth + FHIR on the back, DBDP for wearable features, Agentforce on the front. Each piece is the best-in-class substrate for its job, and the composition is already visible in the prototype: the Care Router's grounding card cites the mocked Experience API as one of its federated sources (see /demo/intake)."
  }
];

const protoVsProd = [
  {
    aspect: "Where the integration runs",
    proto: "/health and /providers proxied through Flex Gateway → CloudHub 2.0 worker (live, JWT-enforced). /timeline and /intake served as deterministic mocks by Next.js.",
    prod:
      "Three-tier Mule application on the customer's Anypoint Runtime Fabric or CloudHub 2.0."
  },
  {
    aspect: "Reference flow code",
    proto:
      "mulesoft/flows/pause-process-api.example.xml — labeled Mule 4 XML with comments; not deployable.",
    prod:
      "Real Mule project with property files, secret references, API spec in Anypoint Exchange, CI/CD."
  },
  {
    aspect: "OMH → FHIR transform",
    proto:
      "Shipped 2026-06-26 as pause-omh-to-fhir-library v1.0.0 on Anypoint Exchange. CloudHub worker (1.0.5) consumes it as a Maven dependency at dw::pause::health::omh.",
    prod:
      "Same shared Exchange asset, reused unchanged across customer Mule apps and a future pause-ingest-process-api."
  },
  {
    aspect: "Wearable vendor adapters",
    proto: "Direct vendor calls from pause_ingest (Python).",
    prod: "Per-vendor System APIs in Mule with token vaults, rate-limit controls, circuit breakers."
  },
  {
    aspect: "Pause backend integration surface",
    proto: "Direct calls to JupyterHealth Exchange (where wired) or to the mocked Experience APIs.",
    prod:
      "Calls go only to Experience APIs. The customer's IT team owns the policy on those endpoints."
  }
];

const phases: Array<{
  name: string;
  status: StatusPillStatus;
  duration: string;
  detail: string;
}> = [
  {
    name: "Phase 0 — Reference artifacts",
    status: "prototype",
    duration: "Today",
    detail:
      "Reference Mule flow + DataWeave transform committed under mulesoft/. Four mocked Experience APIs at /api/mulesoft/*. Design doc at docs/mulesoft-integration.md. Investor page (this one)."
  },
  {
    name: "Phase 1 — Working sandbox",
    status: "shipped",
    duration: "Complete · 2026-06-09",
    detail:
      "Seven iterations shipped: CloudHub 2.0 worker live with /health + /providers (iterations 1–2); Flex Gateway (Docker + ngrok) with runtime enforcement (iteration 3); Rate Limiting SLA 10 req/min (iteration 4); OAS 3.0 spec published to Anypoint Exchange as pause-provider-experience-api-spec v1.0.2 (iteration 5); static ngrok domain pinned (iteration 6); JWT Validation via Auth0 RS256/JWKS replaces Client ID Enforcement, plain Rate Limiting replaces SLA-based, Next.js proxy fetches Auth0 M2M tokens automatically (iteration 7). Current policy stack: JWT Validation + Rate Limiting (10 req/min global). Next: persistent VM to host the gateway (iteration 8)."
  },
  {
    name: "Phase 2 — First customer deployment",
    status: "designed",
    duration: "4–6 weeks with first design partner",
    detail:
      "Deploy Mule apps into the customer's Runtime Fabric. Wire their identity provider (PingFederate / Azure AD) to the Experience APIs. Cut over the Pause backend's reads."
  },
  {
    name: "Phase 3 — Multi-customer fabric",
    status: "prototype",
    duration: "Started · 2026-06-26",
    detail:
      "Three shared artifacts on Anypoint Exchange under the Pause Health business group: (1) pause-omh-to-fhir-library v1.0.0 — the Open mHealth → FHIR R5 Observation DataWeave transform, consumed by the CloudHub worker 1.0.5 as a Maven dependency. (2) pause-jhe-system-api-spec v1.0.0 — the OAS 3.0 contract for JupyterHealth Exchange's REST surface + Django data plane. (3) pause-dbdp-system-api-spec v1.0.0 — the OAS 3.0 contract for the DBDP/FLIRT feature-engineering System API (mode=sliding-window wraps hrv_features_flirt; mode=time-domain-fallback wraps hrv_time_domain_fallback). The two System-API specs are contract-only — implementations are gated on Phase 1c (real Mule projects wrapping the existing pause_ingest Python layer). Honest framing: the dependency wiring story is end-to-end on the DataWeave library; the spec-tier assets land first so contract review can happen now."
  }
];

const investorTakeaways = [
  {
    label: "Procurement velocity",
    detail:
      "When customer deployments begin, a Pause security review goes from 'evaluate a new vendor's data plane' to 'evaluate another Mule app on our existing platform.' That advantage compounds against competitors who require a net-new integration framework. Today's claim is design-stage — the procurement narrative activates with the first paid pilot."
  },
  {
    label: "Operational margin",
    detail:
      "Pause owns the Experience APIs and menopause-specific logic. Customer-side teams own the System and Process APIs. Our engineering doesn't have to scale linearly with customer count — a design property of API-Led Connectivity, not a measured outcome."
  },
  {
    label: "Defensible interoperability story",
    detail:
      "Open standards at every tier: Anypoint for connectivity, FHIR R5 for the substrate, Open mHealth for the schema, DBDP for the feature engineering. The full stack is independently auditable, today."
  },
  {
    label: "Customer-extensible without a fork",
    detail:
      "When a customer wants a new wearable or a new EHR connection, they will add a System API in their own org. No Pause fork, no Pause code change, no Pause release schedule. Property of the architecture; depends on a customer to materialize."
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
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    detail:
      "The FHIR R5 substrate the MuleSoft plane will connect to on the back end. Today: design doc + reference artifacts under jupyterhealth/.",
    status: "designed"
  },
  {
    href: "/proposal/dbdp",
    label: "DBDP feature engineering",
    detail:
      "The feature computation worker each ingest call will trigger. Today: FLIRT integrated in pause_ingest with unit tests; real Empatica E4 archive ingest is Phase 2.",
    status: "partial"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce intake",
    detail:
      "The patient-facing front end whose consent decisions will flow through the MuleSoft consent process API. Today the Agentforce path is env-var-gated (see the Agentforce env-table brief).",
    status: "designed"
  },
  {
    href: "/proposal/mcp",
    label: "MCP server",
    detail:
      "The agent-side surface that turns these MuleSoft Experience APIs into tools for Claude, Cursor, and Agentforce. Today: MCP server in-repo against mocked Experience APIs; npm publish is Phase 1.",
    status: "partial"
  },
  {
    href: "/proposal/agent-fabric",
    label: "Agent Fabric control plane",
    detail:
      "MuleSoft Agent Fabric layered on top of this integration plane: agent registry, policy enforcement, end-to-end multi-agent traces, identity-based security across A2A and MCP. Today: in-memory trace plane wired in prototype.",
    status: "partial"
  },
  {
    href: "/proposal/data-360",
    label: "Data 360 grounding",
    detail:
      "Salesforce Data 360 federates over the same FHIR substrate MuleSoft will write to — unified patient memory without moving PHI. Today: Phase 1 LIVE grounding against a real Health Cloud dev org.",
    status: "prototype"
  },
  {
    href: "https://www.mulesoft.com/api-led-connectivity",
    label: "MuleSoft: API-Led Connectivity",
    detail: "The architectural pattern this integration adopts wholesale.",
    external: true
  }
];

export default function MulesoftPage() {
  const healthIsLive = isMulesoftHealthLive();
  const providersIsLive = isMulesoftProvidersLive();
  const anyLive = healthIsLive || providersIsLive;
  return (
    <ProposalShell
      eyebrow="Investor brief · MuleSoft integration"
      title="Integration plane on the substrate our buyers already operate"
      subtitle="Pause-Health.ai's integration with JupyterHealth, DBDP wearable features, Agentforce, and consumer wearables is designed to run through MuleSoft Anypoint — the connectivity platform most US health systems and large payers already license. Today a Mule app is live on CloudHub 2.0 with Flex Gateway enforcing JWT validation and rate limiting; the full three-tier architecture activates with the first design partner."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">API-Led Connectivity, applied to menopause</p>
        <h2 className="proposal-section-title">Three tiers · status-pilled by what&apos;s actually wired</h2>
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
          <StatusPill status="designed" style={inlinePillStyle} /> design
          decision, activates with the first design partner.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {tiers.map((tier) => (
            <article key={tier.name} className="card">
              <div style={{ marginBottom: "0.35rem" }}>
                <StatusPill status={tier.status} style={inlinePillStyle} />
              </div>
              <h3 style={{ marginTop: 0 }}>{tier.name}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.4rem" }}>
                {tier.role}
              </p>
              <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>{tier.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why MuleSoft</p>
        <h2 className="proposal-section-title">Four reasons the integration plane is Mule</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {whyMulesoft.map((item) => (
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
          Hit the live gateway right now
        </h2>
        <p style={{ marginTop: "0.4rem" }}>
          <code>/health</code> and <code>/providers</code> proxy through Flex
          Gateway to a real Mule app on CloudHub 2.0 — JWT-validated, rate-limited,
          OAS 3.0 spec in Anypoint Exchange. <code>/timeline</code> and{" "}
          <code>/intake</code> are deterministic mocks with the same response shapes.
          The data lineage on the timeline endpoint is intact: every DBDP-computed
          feature Observation carries a <code>derivedFrom</code> reference back to
          the raw window it was derived from.
        </p>
        <div
          style={{
            marginTop: "0.8rem",
            padding: "0.65rem 0.9rem",
            borderRadius: 8,
            background: anyLive
              ? "rgba(46, 160, 67, 0.10)"
              : "rgba(125, 125, 125, 0.08)",
            border: anyLive
              ? "1px solid rgba(46, 160, 67, 0.45)"
              : "1px solid rgba(125, 125, 125, 0.30)",
            fontSize: "0.88rem",
            lineHeight: 1.5
          }}
        >
          <strong style={{ marginRight: "0.45rem" }}>
            {anyLive
              ? `LIVE on Anypoint Platform · ${[healthIsLive && "/health", providersIsLive && "/providers"].filter(Boolean).join(" + ")}`
              : "MOCK · served by Next.js"}
          </strong>
          <StatusPill
            status={anyLive ? "partial" : "prototype"}
            style={inlinePillStyle}
          />
          <span style={{ color: "var(--muted)" }}>
            {anyLive ? (
              <>
                {healthIsLive && (
                  <><code>/api/mulesoft/health</code> and{" "}</>
                )}
                {providersIsLive && (
                  <><code>/api/mulesoft/providers</code>{" "}</>
                )}
                proxy through Flex Gateway (JWT Validation + Rate Limiting, 10 req/min) to a Mule
                app on CloudHub 2.0 (iterations 1–7).{" "}
                Any non-2xx degrades gracefully to the deterministic mock;{" "}
                <code>meta._source</code> flips between{" "}
                <code>&quot;live-mulesoft&quot;</code> and{" "}
                <code>&quot;mock-fallback&quot;</code>. Governance policy stack and
                OAS 3.0 spec live in Anypoint Exchange — see{" "}
                <code>docs/MULESOFT_API_MANAGER_RUNBOOK.md</code>.
              </>
            ) : (
              <>
                Phase 1 deployable Mule app committed under{" "}
                <code>mulesoft/pause-mulesoft-health-v1/</code>. Set{" "}
                <code>MULESOFT_HEALTH_BASE_URL</code> (and optionally{" "}
                <code>MULESOFT_PROVIDERS_BASE_URL</code>) to the CloudHub
                2.0 worker URL to flip the proxies from mock to live.
                Walkthrough:{" "}
                <code>docs/MULESOFT_PHASE_1_HANDOFF.md</code>.
              </>
            )}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a
            href="/api/mulesoft/health"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            GET /api/mulesoft/health
          </a>
          <a
            href="/api/mulesoft/patient/anika-patel/timeline"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Patient timeline (FHIR Bundle)
          </a>
          <a
            href="/api/mulesoft/patient/anika-patel/intake"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Structured intake record
          </a>
          <a
            href="/api/mulesoft/providers?zip=92614&menopause=true&limit=5"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Provider directory
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/tree/main/mulesoft"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Reference Mule artifacts on GitHub
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai/blob/main/docs/mulesoft-integration.md"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Full design doc
          </a>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What changes between the two
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
        <h2 className="proposal-section-title">From reference artifacts to multi-customer fabric</h2>
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
        <h2 className="proposal-section-title">Where the MuleSoft plane sits in the bigger picture</h2>
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
