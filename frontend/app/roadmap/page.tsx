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
        status: "shipped",
        source: { href: "/changelog", label: "Changelog" }
      },
      {
        title: "MuleSoft iteration 8 — Phase-2 contract DataWeave (deployed 2026-06-16, live on CloudHub)",
        detail:
          "providers-flow's DataWeave was rewritten to match the Phase-2 contract — a curated 9-row slice with lat/lng + serviceSignals + licenseStatus + insuranceAccepted + matchType tier ladder + ?insurance= filter — and shipped to CloudHub 2.0 as v1.0.4. Direct CloudHub /providers?menopause=true returns the full Phase-2 field set (latitude/longitude/distanceMiles, serviceSignals, licenseStatus, insuranceAccepted with 5 plans, credentialSource:'curated-overlay', top-level sort:'score') and production /api/mulesoft/providers reports meta._source:'live-mulesoft' end-to-end through Auth0-JWT → Flex Gateway → ngrok → the worker. The frontend contract-shape vitest pins live ⇄ mock parity so future drift fails CI. Two non-obvious deploy gotchas captured in MULESOFT_API_MANAGER_RUNBOOK.md: the rotated Connected App needed Runtime Manager + Exchange Contributor/Viewer scopes added per surface, and mule-maven-plugin's -DmuleDeploy doesn't publish to Exchange (two-command deploy: deploy-file to Exchange v2 maven, then -DmuleDeploy for Runtime Manager).",
        status: "shipped",
        source: { href: "/proposal/mulesoft", label: "/proposal/mulesoft" }
      },
      {
        title: "MuleSoft iteration 9 — Flex Gateway persistent hosting",
        detail:
          "The Flex Gateway runs Docker + ngrok on a local machine; when the machine sleeps or restarts the tunnel drops and pause-health.ai silently falls back to mock data (verified today: TLS handshake gets 'Connection reset by peer'). Iteration 9: move the gateway container to a persistent VM (DigitalOcean droplet or EC2 t4g.nano) so the MuleSoft live surface is always on. No Anypoint or Next.js changes needed — just a new host + updated MULESOFT_*_BASE_URL in Vercel. Sequenced after iteration 8 deploy so the new VM serves the Phase-2 contract from day one.",
        status: "planned",
        source: { href: "/proposal/mulesoft", label: "/proposal/mulesoft" }
      }
    ]
  },
  {
    id: "next",
    eyebrow: "Next · 30–90 days",
    title: "After the next decision point",
    intro:
      "Items gated on the next external event — usually 'first design partner conversation' or 'first credentialed customer org'. The code paths are designed or partially wired; the activation step is a customer-or-cohort gate, not an engineering gate. A few entries here are marked shipped — those are recent platform-layer milestones (Data 360 Phase 2, MuleSoft iterations 1–7, provider-graph Phase 1+2) kept in this horizon as context for the partnership-gated next steps that build on them.",
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
          "Now runs against a real JupyterHealth Exchange Django instance (docker postgres + jhe-local container, OIDC RS256 key, seeded RBAC + Patient + Oura DataSource + Study with explicit per-scope consent rows + FhirSource + a client_credentials OAuth app named pause-ingest). examples/oura_sample_upload.py round-trips both a real Oura heart-rate sample (mapped handler, integer pk) AND a derived HRV-time-domain feature observation (auxiliary handler, UUID pk) with derivedFrom pointer to the raw row, prints 'OK — uploaded and round-tripped 2 observation(s)'. Three real-JHE-only gotchas the wire-level mock had not pinned were surfaced and fixed in the same session: pause_ingest was requesting OAuth scope strings JHE rejects, used Content-Type application/fhir+json which JHE's parser rejects, and wrote OMH codings whose system/code shape did not match JHE's mapped-Observation routing criteria so writes silently fell through to the auxiliary handler. The wire-level mock was tightened to enforce the same routing contract — codings outside https://w3id.org/openmhealth now 400 without an X-JHE-FHIR-Source-ID header. Followed up 2026-06-23 by shipping an opt-in PAUSE_USE_REAL_JHE=1 pytest marker (pause_ingest/tests/conftest.py + test_exchange_real_jhe.py) so the same 7 contract assertions run against the live JHE instance, not just the periodic manual smoke script — 7/7 green against jhe-local; surfaced + documented two more mock-vs-real divergences (POST response omits valueAttachment; GET /Observation?patient=<unknown> doesn't filter to empty Bundle). Transcript at docs/JHE_REAL_RUN_2026-06-16.md; runbook Path B in docs/JHE_SETUP_RUNBOOK.md.",
        status: "prototype",
        source: { href: "/proposal/integration", label: "/proposal/integration" }
      },
      {
        title: "MuleSoft Anypoint — iterations 1–8 complete",
        detail:
          "Eight iterations shipped: CloudHub 2.0 worker live (iterations 1–2), Flex Gateway runtime enforcement (iteration 3), Rate Limiting SLA (iteration 4), OAS 3.0 spec published to Exchange (iteration 5), stable ngrok domain pinned (iteration 6), JWT Validation via Auth0 RS256/JWKS replacing Client ID Enforcement + plain Rate Limiting (iteration 7), Phase-2 contract DataWeave deployed to CloudHub 2.0 as v1.0.4 with the full provider field set live behind Auth0-JWT (iteration 8, 2026-06-16). Current policy stack: JWT Validation + Rate Limiting (10 req/min global). Iteration 9 (persistent VM hosting for the Flex Gateway) is the remaining piece, tracked in the Now horizon above.",
        status: "shipped",
        source: { href: "/proposal/mulesoft", label: "/proposal/mulesoft" }
      },
      {
        title: "Data 360 Phase 2 — Data Cloud unified profile",
        detail:
          "LIVE in production: lib/salesforce/data-cloud.ts layers HRV z-score, vasomotor burden, and sleep disruption from three Data Cloud Calculated Insights on top of the Phase 1 SOQL grounding. The trailsignup DC tenant is provisioned, the CIs (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) are authored + activated over ssot__Individual__dlm, and SF_DC_TENANT_URL is set on Vercel; auth goes through the mandatory a360 token exchange. Each insight falls back to its intake baseline independently if a DC call fails. Demo-cohort values are seeded mock CIs — the next iteration swaps them for real JHE/DBDP wearable math (same client, same token flow). Walkthrough + gotchas in docs/PHASE_2_ACTIVATION_CHECKLIST.md.",
        status: "shipped",
        source: { href: "/proposal/data-360", label: "/proposal/data-360" }
      },
      {
        title: "Provider graph Phase 1 + Phase 2 — shipped end-to-end",
        detail:
          "Phase 1 (NPPES bulk schema → menopause NUCC taxonomy filter → MSCP overlay → graphScore) and Phase 2 (Census 2020 ZCTA distance ranking, six NPPES service-line signals, three state license-sanction overlays dropping 1,720 sanctioned candidates at build, real-shaped synthetic insurance, /provider browseable UI + /provider/[npi] profile pages) are both wired and verifiable. The committed national run carries 2,015 providers behind the frozen /api/mulesoft/providers contract. See /changelog for the per-commit history and /proposal/provider-graph for the full architecture.",
        status: "shipped",
        source: { href: "/proposal/provider-graph", label: "/proposal/provider-graph" }
      },
      {
        title: "Provider graph Phase 2-bis — partnership + commercial-feed unlocks",
        detail:
          "Two pieces wait on external dependencies, not engineering effort. (1) Licensed Menopause Society MSCP feed replaces the synthetic + self-reported overlay (the Society's terms-of-use prohibits scraping; gated on a partnership conversation). (2) Paid in-network insurance feed (Ribbon Health, Turquoise) replaces the synthetic SHA-256 derivation behind the same insuranceAccepted field. Both swap in behind the existing contract without consumer changes — the agent + Care Router + UI keep working unchanged. The synthetic shapes are calibrated to plausible real-world rates and clearly labeled in every API response.",
        status: "planned",
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
