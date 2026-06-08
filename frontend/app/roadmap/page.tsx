import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Roadmap",
  description:
    "What's next for Pause-Health.ai. Now / Next / Later horizons drawn from the 30+ designed / planned / future items already pilled across the site. Each item links back to the page that describes it in detail.",
  path: "/roadmap",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Pause-Health.ai roadmap — Now, Next, Later."
});

type RoadmapItem = {
  title: string;
  detail: string;
  status: StatusPillStatus;
  source: { href: string; label: string };
};

type RoadmapHorizon = {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  items: RoadmapItem[];
};

const horizons: RoadmapHorizon[] = [
  {
    id: "now",
    eyebrow: "Now · 0–30 days",
    title: "In flight today",
    intro:
      "Active work on the prototype and the public surface. These items don't require a design partner or external dependency — they're polish and rigor we can ship under our own steam.",
    items: [
      {
        title: "End-to-end smoke test of the polished surface",
        detail:
          "Reproducible smoke-test script at frontend/scripts/smoke-test.mjs. Hits 35 routes, follows 77 unique internal links, POSTs realistic fixtures to 16 API endpoints. Current run: 132 / 132 pass. Run via `npm run smoke` against a local dev server; results land in SMOKE_TEST_RESULTS.md. Re-runnable after every polish pass.",
        status: "prototype",
        source: { href: "/changelog", label: "See SMOKE_TEST_RESULTS.md" }
      },
      {
        title: "GitHub Private Vulnerability Reporting enabled",
        detail:
          "One-click toggle in repo Settings → Security. Required for the 'Report a vulnerability' button referenced in SECURITY.md to appear on the Security tab. Closes the open todo from the OSS-hygiene trio commit.",
        status: "planned",
        source: { href: "https://github.com/hucmaggie/pause-health.ai/security", label: "SECURITY policy" }
      },
      {
        title: "Roadmap + changelog pages",
        detail:
          "This page (/roadmap) and its sibling (/changelog) — making 'what's shipped' and 'what's coming' first-class surfaces rather than buried in commit messages.",
        status: "prototype",
        source: { href: "/changelog", label: "Changelog" }
      }
    ]
  },
  {
    id: "next",
    eyebrow: "Next · 30–90 days",
    title: "After the next decision point",
    intro:
      "Items gated on the next external event — usually 'first design partner conversation' or 'first credentialed customer org'. The code paths are designed or partially wired; the activation step is a customer-or-cohort gate, not an engineering gate.",
    items: [
      {
        title: "First design-partner provider organization onboarded",
        detail:
          "A provider system that signs a design-partner LOI to co-develop the Care Router on a real cohort. Sized at one to three orgs across OB/GYN, primary care, and integrated health systems. This is the single highest-leverage unlock for the rest of the roadmap — every 'planned' BAA / IRB / SOC 2 item below is paced by when this lands.",
        status: "planned",
        source: { href: "/about", label: "About / Milestones" }
      },
      {
        title: "Clinical advisory board formed",
        detail:
          "Clinicians across OB/GYN, endocrinology, primary care, and behavioral health to validate the Care Router policy, risk-band thresholds, and pathway routing. Pace: 4–6 advisors before the first design-partner pilot launches.",
        status: "planned",
        source: { href: "/about", label: "About / Team" }
      },
      {
        title: "pause_ingest → real JupyterHealth Exchange round-trip",
        detail:
          "Wire-level contract test against an in-process JHE mock now exercises the full pipeline end-to-end: raw Oura sample → omh-shim → FHIR R5 Observation upload → DBDP HRV feature computation → derived Observation upload (with derivedFrom provenance) → readback via jupyterhealth-client. 27 / 27 tests pass. Surfaced and fixed a real bug in read_recent_observations along the way. Next: swap the mock for a real JHE Docker instance per docs/JHE_SETUP_RUNBOOK.md (~1 afternoon, gated only on Docker availability).",
        status: "prototype",
        source: { href: "/proposal/integration", label: "/proposal/integration" }
      },
      {
        title: "MuleSoft Anypoint CloudHub 2.0 deploy",
        detail:
          "Today: the Next.js proxy at /api/mulesoft/health is live/mock-branched on MULESOFT_HEALTH_BASE_URL with graceful degradation. The deployable Mule artifact lives in mulesoft/pause-mulesoft-health-v1/ (pom + mule-artifact + one-flow XML), 31 unit tests pin the proxy matrix, and /proposal/mulesoft renders a live-vs-mock badge that flips on the env var. Next: import the Mule project into Anypoint Code Builder, deploy to CloudHub 2.0 Sandbox, set MULESOFT_HEALTH_BASE_URL in Vercel — walkthrough in docs/MULESOFT_PHASE_1_HANDOFF.md.",
        status: "partial",
        source: { href: "/proposal/mulesoft", label: "/proposal/mulesoft" }
      },
      {
        title: "Data 360 Phase 2 — Data Cloud unified profile",
        detail:
          "Code ready: lib/salesforce/data-cloud.ts calls the Data Cloud Calculated Insights API and layers HRV z-score, vasomotor burden, and sleep disruption on top of the Phase 1 SOQL grounding. Activated by SF_DC_TENANT_URL env var. Next: provision the DC tenant on the trailsignup org (Setup → Data Cloud → Get Started), author the three CIs, set the env var — walkthrough in docs/MULESOFT_PHASE_2_DATA_CLOUD.md.",
        status: "partial",
        source: { href: "/proposal/data-360", label: "/proposal/data-360" }
      },
      {
        title: "Provider graph Phase 1 — NPPES + taxonomy filter",
        detail:
          "Ingest the CMS NPPES bulk file, filter by OB/GYN + endocrinology taxonomies, and surface MSCP-credentialed contacts as a first-class search dimension. Sized at 2 weeks. Phase 2 (state license + service detection) follows in 4–6 weeks.",
        status: "designed",
        source: { href: "/proposal/provider-graph", label: "/proposal/provider-graph" }
      }
    ]
  },
  {
    id: "later",
    eyebrow: "Later · 90+ days",
    title: "Pre-revenue, pre-PHI compliance milestones",
    intro:
      "Items that depend on a paying customer relationship, PHI under BAA, or an external audit. The frameworks are designed (see /security and /hipaa for the Today vs. Designed tables); the work itself is paced by the customer's contractual timeline, not ours.",
    items: [
      {
        title: "HIPAA Security Rule controls — full implementation",
        detail:
          "Administrative, physical, and technical safeguards aligned with 45 CFR Part 164 Subpart C. Today: pre-PHI prototype with no Business Associate obligation. Designed: full Security Rule program activated before the first customer's BAA goes into force.",
        status: "planned",
        source: { href: "/security", label: "/security" }
      },
      {
        title: "Business Associate posture + BAA execution",
        detail:
          "Pause-Health.ai is NOT a Business Associate today (we handle no PHI). The full BAA template, permitted-use scope, and breach-notification protocol are designed and ready for execution before any Covered Entity grants PHI access.",
        status: "planned",
        source: { href: "/hipaa", label: "/hipaa" }
      },
      {
        title: "SOC 2 Type II attestation",
        detail:
          "Type I (point-in-time) targeted ~6 months after the first customer signs; Type II (operating-effectiveness, 6+ month observation window) targeted ~12 months later. Independent auditor TBD. Both reports made available under NDA to prospective customers.",
        status: "planned",
        source: { href: "/security", label: "/security" }
      },
      {
        title: "HITRUST CSF r2 certification",
        detail:
          "Targeted ~18 months after first customer signs — most health systems require HITRUST as a procurement gate. Scope: the production Care Router API surface + all PHI-touching services. Independent assessor TBD.",
        status: "planned",
        source: { href: "/security", label: "/security" }
      },
      {
        title: "IRB-blessed validation cohort",
        detail:
          "~10k women across 3–5 design-partner provider organizations, stratified by menopause stage / symptom severity / care-access setting. Endpoints: pathway concordance vs. blinded clinician adjudication, symptom-burden trajectory at 30/90 days, time-to-MSCP-visit. Pre-registered with primary analysis specified.",
        status: "planned",
        source: { href: "/research", label: "/research" }
      },
      {
        title: "Provider graph Phase 3 — closed-loop scoring",
        detail:
          "After the first 1,000 referrals, the provider graph's ranking signal gets a closed-loop input: clinician acceptance, patient appointment-kept rate, and clinician feedback on Pause's routing decisions. Compounds with credential + service-mention signals already in Phase 1 / 2.",
        status: "future",
        source: { href: "/proposal/provider-graph", label: "/proposal/provider-graph" }
      },
      {
        title: "First pilot deployment",
        detail:
          "Move from design-partner LOI to a paid pilot in production at one provider organization. Care Router running against real PHI (under BAA), with measurable outcomes flowing back to the validation cohort. Targeted 2027.",
        status: "future",
        source: { href: "/about", label: "About / Milestones" }
      },
      {
        title: "Open the validation methodology + code",
        detail:
          "Subgroup pathway-distribution + concordance report, refreshed at the cadence the validation cohort supports. Methodology and analysis code published alongside the peer-reviewed publication. Bias-monitoring as a public artifact, not an internal dashboard.",
        status: "future",
        source: { href: "/research", label: "/research" }
      }
    ]
  }
];

export default function RoadmapPage() {
  return (
    <main className="container" style={{ paddingTop: "2.4rem", paddingBottom: "3rem", maxWidth: "60rem" }}>
      <header style={{ marginBottom: "1.8rem" }}>
        <p className="eyebrow">Roadmap</p>
        <h1 style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", margin: "0.25rem 0 0.6rem" }}>
          What's coming next — designed in the open
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: "44rem", margin: 0, lineHeight: 1.55 }}>
          Every item on this page is pilled with a{" "}
          <a href="/proposal" style={{ color: "var(--brand)" }}>StatusPill</a>{" "}
          drawn from the same vocabulary as the rest of the site. Items
          marked <em>planned</em> have a code path, spec, or schedule that
          will be activated when the gating event lands. Items marked{" "}
          <em>designed</em> have an architecture but no commitment to
          schedule yet. Items marked <em>future</em> are directional intent.
          What's already <em>shipped</em> lives at{" "}
          <a href="/changelog" style={{ color: "var(--brand)" }}>/changelog</a>.
        </p>

        <nav
          aria-label="Roadmap horizons"
          style={{
            marginTop: "1.1rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem"
          }}
        >
          {horizons.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className="btn btn-secondary"
              style={{ fontSize: "0.82rem", padding: "0.4rem 0.75rem" }}
            >
              {h.eyebrow} →
            </a>
          ))}
        </nav>
      </header>

      {horizons.map((horizon) => (
        <section
          key={horizon.id}
          id={horizon.id}
          aria-label={horizon.title}
          style={{
            marginBottom: "2.2rem",
            paddingBottom: "1.6rem",
            borderBottom: "1px solid var(--surface-3)",
            scrollMarginTop: "1rem"
          }}
        >
          <header style={{ marginBottom: "1.1rem" }}>
            <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
              {horizon.eyebrow}
            </p>
            <h2 style={{ fontSize: "1.4rem", margin: "0.05rem 0 0.5rem" }}>
              {horizon.title}
            </h2>
            <p style={{ color: "var(--muted)", margin: 0, lineHeight: 1.55, fontSize: "0.95rem" }}>
              {horizon.intro}
            </p>
          </header>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {horizon.items.map((item) => (
              <article
                key={item.title}
                className="card"
                style={{ padding: "1.1rem 1.2rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.8rem",
                    flexWrap: "wrap",
                    marginBottom: "0.4rem"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.35 }}>
                    {item.title}
                  </h3>
                  <StatusPill status={item.status} />
                </div>
                <p
                  style={{
                    margin: "0.3rem 0 0.7rem",
                    color: "var(--muted)",
                    lineHeight: 1.55,
                    fontSize: "0.92rem"
                  }}
                >
                  {item.detail}
                </p>
                <a
                  href={item.source.href}
                  target={item.source.href.startsWith("http") ? "_blank" : undefined}
                  rel={item.source.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--brand)",
                    fontWeight: 600,
                    textDecoration: "none"
                  }}
                >
                  Source: {item.source.label} →
                </a>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section
        aria-label="Help shape the roadmap"
        style={{ marginTop: "1rem" }}
      >
        <div
          className="card-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}
        >
          <article className="card">
            <p className="eyebrow">For prospective design partners</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              Influence what ships in Next
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The Next horizon is paced by the first design-partner
              conversation. If your provider organization is considering
              menopause-care AI tooling, the items in Next become a
              negotiation surface for your pilot scope. Reach out via{" "}
              <a href="/contact" style={{ color: "var(--brand)" }}>/contact</a>{" "}
              with what your team would prioritize.
            </p>
            <div style={{ marginTop: "0.9rem" }}>
              <a href="/contact" className="btn btn-primary">
                Start a conversation →
              </a>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">For investors + advisors</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              The full thesis behind these horizons
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              /proposal/full is the long-form version of why each horizon
              is ordered the way it is — including the business model,
              ICP, competitive landscape, and 24-month operating plan
              that anchors the Later horizon.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a href="/proposal" className="btn btn-secondary">
                Investor brief →
              </a>
              <a href="/proposal/full" className="btn btn-secondary">
                Full proposal →
              </a>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
