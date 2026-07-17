import { StatusPill, type StatusPillStatus } from "../components/status-pill";

/**
 * Home page.
 *
 * Polished in the journey-fabric pass to align the landing surface
 * with how the rest of the site has matured (proposal/demo are
 * heavily pilled, sourced, and persona-aware). The previous version
 * was a sparse hero with four ambiguous stats and two CTAs. This
 * version preserves the hero card but adds:
 *
 *   1. Pilled metrics. Each of the four hero numbers now carries
 *      a StatusPill saying what kind of number it is (Research,
 *      Target, Market estimate). The 89% triage figure is a Target
 *      everywhere else on the site; the home page used to present
 *      it as a measured fact. The Market estimate avoids the
 *      previous unsourced "$1,685 avoidable cost" claim.
 *
 *   2. "What's live today" strip. Four small cards under the hero,
 *      each linking to the matching /demo/* page where the
 *      capability is observable. Pilled "prototype" so a reader
 *      can immediately tell what they can actually click. Mirrors
 *      the Arc-B framing on /proposal.
 *
 *   3. Two-arc CTA section at the bottom: Read the thesis
 *      (/proposal), Touch the prototype (/demo/intake), Read the
 *      code (GitHub). Three distinct paths matched to reader
 *      intent rather than the previous two ambiguous ones.
 *
 *   4. Founder credibility line. Single inline link to /about +
 *      the founder's LinkedIn, no headshot or padding -- enough
 *      to anchor trust without becoming an "about us" detour.
 *
 * Why the metadata for / lives in layout.tsx and not here:
 *   The root layout already declares the site-wide title /
 *   description / OG image with metadataBase rooted at SITE_URL.
 *   /'s metadata IS the site's default metadata; overriding it
 *   here would just duplicate it.
 */

type LiveSurface = {
  href: string;
  label: string;
  blurb: string;
  status: StatusPillStatus;
};

// Each "live today" card points to a working demo page. The pill
// distinguishes "prototype" (visible behavior, real code, single-org
// scope) from "partial" (real Salesforce / Anthropic backed but
// degrades gracefully when env vars are absent) from "live" (a real
// external service that is confirmed working in production today AND
// still degrades gracefully when env vars are absent). Keep the list
// to four so the strip stays scan-able above the fold.
const LIVE_SURFACES: LiveSurface[] = [
  {
    href: "/demo/intake",
    label: "Patient intake + live Agentforce chat",
    blurb:
      "Pick a demo patient and watch the Data 360 dossier resolve before the conversation begins. Visible pre-brief panel + real Salesforce Embedded Messaging V2 widget.",
    status: "prototype"
  },
  {
    href: "/demo/patient",
    label: "Care Detail with risk band + suggested pathway",
    blurb:
      "Deterministic risk-band gauge from intake scores, HRT suitability, and the Care Router pathway the clinician should expect. Same persona threads through the journey.",
    status: "prototype"
  },
  {
    href: "/demo/routing",
    label: "Anthropic-backed Care Router agent",
    blurb:
      "Live policy + Claude Sonnet 4.5 decision (provider: anthropic / via: claude-api, confirmed in production) that emits one of six canonical pathways (self-care, MSCP virtual / in-person, behavioral health, urgent gyn, ED). A2A endpoint, traced end to end, with a graceful scripted fallback. Backed by 100 unit tests pinning the decision tree, the Data 360 grounding promotion rules, and the governance gate.",
    status: "live"
  },
  {
    href: "/demo/agent-fabric",
    label: "Agent Fabric — multi-agent trace inspector",
    blurb:
      "Every Care Router decision emits OpenTelemetry-style spans (intake → identity → grounding → routing). Filter by persona, replay a trace, inspect the federated grounding.",
    status: "prototype"
  }
];

type HeroMetric = {
  label: string;
  value: string;
  pill: StatusPillStatus;
  detail?: string;
};

// Each hero metric carries its own source/honesty tag so a reader
// can tell research-derived numbers (67% misdiagnosis) apart from
// targets the system is engineered toward (89% triage accuracy)
// apart from market-sizing estimates (50M+ US women).
const HERO_METRICS: HeroMetric[] = [
  {
    label: "Women in perimenopause / menopause (US)",
    value: "50M+",
    pill: "estimate",
    detail: "Census-derived market size, ages 40-60."
  },
  {
    label: "Initially misdiagnosed",
    value: "~67%",
    pill: "research",
    detail: "Literature-derived; avg ~2.5 years to accurate diagnosis."
  },
  {
    label: "AI-assisted triage accuracy",
    value: "89%",
    pill: "target",
    detail: "Engineering target; measurement plan in /proposal/insights."
  },
  {
    label: "Provider-first deployment",
    value: "Phase 1",
    pill: "prototype",
    detail: "Salesforce Health Cloud + Agentforce live in prototype."
  }
];

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Pause-Health.ai · Premium FemTech Intelligence</p>
        <h1>Elevating menopause care with precision, empathy, and clinical AI</h1>
        <p>
          Pause gives care teams a refined decision layer for perimenopause
          and menopause: multimodal signal intake, clinically explainable
          triage, and personalized next-step pathways designed for women in
          midlife. Built provider-first on Salesforce Health Cloud,
          MuleSoft, and the JupyterHealth FHIR substrate.
        </p>

        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          {HERO_METRICS.map((m) => (
            <li key={m.label}>
              <span>
                {m.label}{" "}
                <StatusPill
                  status={m.pill}
                  style={{
                    marginLeft: "0.4rem",
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.45rem"
                  }}
                />
                {m.detail ? (
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.78rem",
                      color: "var(--muted)",
                      marginTop: "0.15rem"
                    }}
                  >
                    {m.detail}
                  </span>
                ) : null}
              </span>
              <strong>{m.value}</strong>
            </li>
          ))}
        </ul>

        <div
          style={{
            marginTop: "1.25rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            alignItems: "center"
          }}
        >
          <a href="/proposal" className="btn btn-secondary">
            Read the investor brief →
          </a>
          <a href="/demo/intake" className="btn btn-primary">
            Touch the prototype →
          </a>
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Read the code →
          </a>
        </div>

        <p
          style={{
            marginTop: "1rem",
            fontSize: "0.85rem",
            color: "var(--muted)"
          }}
        >
          Built by{" "}
          <a href="/about" style={{ color: "var(--brand)" }}>
            Maggie C. Hu
          </a>
          {" · "}
          <a
            href="https://www.linkedin.com/in/hucmaggie/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            LinkedIn
          </a>
          {" · "}
          Founder | CEO | CTO. Reach out at{" "}
          <a href="/contact" style={{ color: "var(--brand)" }}>
            /contact
          </a>
          .
        </p>
      </section>

      <section
        aria-label="Today's reality — verifiable counts"
        className="card"
        style={{
          marginTop: "1.5rem",
          background:
            "linear-gradient(180deg, rgba(255, 93, 168, 0.08) 0%, transparent 100%)",
          borderColor: "rgba(255, 93, 168, 0.32)"
        }}
      >
        <p className="eyebrow">Today's reality</p>
        <h2 style={{ margin: "0.1rem 0 0.5rem", fontSize: "1.4rem" }}>
          Numbers that survive a curl
        </h2>
        <p
          style={{
            margin: "0 0 0.8rem",
            color: "var(--muted)",
            fontSize: "0.92rem",
            maxWidth: "62ch",
            lineHeight: 1.55
          }}
        >
          Provider-graph Phase 2 shipped. Five counts below ride on the
          response of every <code>/api/mulesoft/providers</code> call under{" "}
          <code>provenance.dataset</code> — a reader can verify them in
          one shell command. Insurance acceptance is synthetically
          derived per-NPI today (the chips are a soft filter, not a
          guarantee); MSCP coverage waits on a Menopause Society
          partnership. Closed-loop outcomes scoring activates with
          referral volume.
        </p>
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
            gap: "0.6rem",
            margin: "0 0 0.9rem",
            padding: 0,
            listStyle: "none"
          }}
        >
          <li className="card" style={{ padding: "0.7rem 0.85rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Directory size</span>
            <strong style={{ display: "block", fontSize: "1.5rem", color: "var(--brand)" }}>2,015</strong>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>NPPES-derived; 15 MSCP-certified</span>
          </li>
          <li className="card" style={{ padding: "0.7rem 0.85rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Sanctioned filtered at build</span>
            <strong style={{ display: "block", fontSize: "1.5rem", color: "var(--brand)" }}>1,720</strong>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>588 CA + 849 NY + 283 TX</span>
          </li>
          <li className="card" style={{ padding: "0.7rem 0.85rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Carry a Census ZCTA centroid</span>
            <strong style={{ display: "block", fontSize: "1.5rem", color: "var(--brand)" }}>96%</strong>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Powers the &quot;X mi away&quot; chip</span>
          </li>
          <li className="card" style={{ padding: "0.7rem 0.85rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Carry ≥1 service-line signal</span>
            <strong style={{ display: "block", fontSize: "1.5rem", color: "var(--brand)" }}>22%</strong>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>FACOG / WHNP / multi-taxonomy / etc.</span>
          </li>
          <li className="card" style={{ padding: "0.7rem 0.85rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Closed-loop outcomes</span>
            <strong style={{ display: "block", fontSize: "1.05rem", color: "var(--text)" }}>Phase 3</strong>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Activates after ~1,000 referrals</span>
          </li>
        </ul>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <a
            href="/proposal/provider-graph"
            className="btn btn-primary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Read the provider-graph brief →
          </a>
          <a
            href="/provider?zip=92614&menopause=true"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Browse the directory →
          </a>
          <a
            href="/api/mulesoft/providers?zip=92614&menopause=true"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Curl the contract →
          </a>
        </div>
      </section>

      <section
        aria-label="What's live in the prototype today"
        style={{ marginTop: "1.5rem" }}
      >
        <header style={{ marginBottom: "0.9rem" }}>
          <p className="eyebrow">What's live today</p>
          <h2 style={{ margin: "0.1rem 0 0", fontSize: "1.4rem" }}>
            Touch the working surfaces, not just the deck
          </h2>
          <p
            style={{
              margin: "0.3rem 0 0",
              color: "var(--muted)",
              fontSize: "0.92rem",
              maxWidth: "62ch"
            }}
          >
            Four end-to-end capabilities you can run against the prototype
            right now. Each card opens the matching <code>/demo</code> page
            where the persona, the API surface, and the trace spans are
            inspectable.
          </p>
        </header>

        <div className="card-grid">
          {LIVE_SURFACES.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="card"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: "0.55rem"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}
              >
                <StatusPill status={s.status} />
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--muted)",
                    letterSpacing: "0.02em"
                  }}
                >
                  {s.href}
                </span>
              </div>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{s.label}</h3>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.9rem"
                }}
              >
                {s.blurb}
              </p>
              <span
                style={{
                  marginTop: "auto",
                  color: "var(--brand)",
                  fontSize: "0.85rem",
                  fontWeight: 600
                }}
              >
                Open →
              </span>
            </a>
          ))}
        </div>
      </section>

      <section
        aria-label="Momentum"
        style={{
          marginTop: "1.6rem",
          padding: "0.85rem 1rem",
          background: "var(--surface-2)",
          borderRadius: "10px",
          border: "1px solid var(--surface-3)",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.92rem", color: "var(--muted)" }}>
          Built in the open — 175 commits since May 24, 2026.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <a
            href="/changelog"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.75rem" }}
          >
            See what shipped →
          </a>
          <a
            href="/roadmap"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.75rem" }}
          >
            See what's coming →
          </a>
        </div>
      </section>

      <section
        aria-label="Two ways to go deeper"
        style={{ marginTop: "1.75rem", marginBottom: "2rem" }}
      >
        <div
          className="card-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}
        >
          <article className="card">
            <p className="eyebrow">For investors + partners</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.15rem" }}>
              Read the thesis
            </h3>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Two arcs: the investment thesis (strategy, market, customers,
              competition) and the architecture story (Agentforce, MuleSoft,
              MCP, Data 360, JupyterHealth, DBDP, Agent Fabric). Per-card
              proto-vs-prod tables and verifiable live API CTAs.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a href="/proposal" className="btn btn-primary">
                Open the brief →
              </a>
              <a href="/proposal/full" className="btn btn-secondary">
                Full proposal →
              </a>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">For builders + clinicians</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.15rem" }}>
              Touch the prototype
            </h3>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Six demo personas, one persona-preserving journey: intake →
              Care Detail → Care Router → Agent Fabric trace inspector →
              outcome analytics. Real Salesforce Health Cloud grounding
              when configured; deterministic mock otherwise.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a href="/demo/intake" className="btn btn-primary">
                Start the journey →
              </a>
              <a href="/demo/agent-fabric" className="btn btn-secondary">
                Trace inspector →
              </a>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
