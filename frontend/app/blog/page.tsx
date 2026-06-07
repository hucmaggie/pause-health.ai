import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Blog",
  description:
    "Stories from the frontier of menopause care. Planned editorial roadmap for Pause-Health.ai — clinical evidence, AI model design, provider workflows, and the lived experience of women in midlife.",
  path: "/blog",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Pause-Health.ai blog — stories from the frontier of menopause care."
});

/**
 * Blog page.
 *
 * Polished in the journey-fabric pass. The previous version was a
 * StubPage saying "The first essays will be published soon."
 * Honest but not useful -- a reader had no idea what we'd write
 * about or whether subscribing to the newsletter was worth their
 * email.
 *
 * The page now publishes the planned editorial roadmap instead:
 * three pillars (clinical evidence, AI architecture, lived
 * experience) with 3-4 planned essay titles under each. Every
 * planned essay is pilled "Planned" so a reader can tell at a
 * glance that this is a roadmap, not a published archive. A
 * newsletter signup nudge sits at the bottom -- now the signup
 * makes sense because the visitor knows what they're signing
 * up to receive.
 *
 * Once the first essays publish, they'll move from this roadmap
 * to the top of the page (or a separate "published" section) and
 * the pilling will flip to "Shipped" with a publication date.
 */

type EssayPillar = {
  pillar: string;
  blurb: string;
  essays: Array<{ title: string; teaser: string }>;
};

const pillars: EssayPillar[] = [
  {
    pillar: "Clinical evidence",
    blurb:
      "How the menopause-care evidence base is shifting underneath us — new MSCP guidance, HRT reframings, what the literature still gets wrong.",
    essays: [
      {
        title: "Why ~67% of menopause cases are initially misdiagnosed (and what a Care Router can do about it)",
        teaser:
          "A walk through the misdiagnosis literature, the symptom-overlap patterns that drive it, and how grounding on referenced guidelines compresses the path to MSCP-credentialed care."
      },
      {
        title: "From NAMS to The Menopause Society — what the 2024 rebrand changed for clinicians",
        teaser:
          "The MSCP credential, the position-statement modernization, and what a referral path that respects the society's own directory looks like."
      },
      {
        title: "HRT decision-making in 2026 — what the evidence supports vs. what the popular discourse claims",
        teaser:
          "Cardiometabolic considerations, postmenopausal bleeding workups, and the difference between local and systemic therapy."
      }
    ]
  },
  {
    pillar: "AI architecture",
    blurb:
      "How Pause-Health.ai is actually built — Care Router policy, multi-agent fabric, Data 360 grounding, MCP tools. Public source code, public design choices.",
    essays: [
      {
        title: "What 'grounding' actually means in a clinical agent",
        teaser:
          "The federation pattern against Salesforce Health Cloud + JupyterHealth FHIR + DBDP biomarkers, why the agent doesn't move PHI, and how the prototype keeps the same shape as the production stack."
      },
      {
        title: "Why our Care Router uses a policy layer instead of a pure LLM",
        teaser:
          "Six canonical pathways, deterministic risk-band heuristics, and the LLM as the recommendation engine on top of (not in place of) the policy."
      },
      {
        title: "Agent Fabric — building a multi-agent trace inspector clinicians can read",
        teaser:
          "OpenTelemetry-style spans for a clinical decision (intake -> identity -> grounding -> routing), and what an A2A protocol looks like at the boundary."
      },
      {
        title: "MCP tools for menopause care — what we exposed and why",
        teaser:
          "The find_menopause_providers and get_provider_details tools, why we expose them via Model Context Protocol, and how a clinical agent should use them safely."
      }
    ]
  },
  {
    pillar: "Lived experience",
    blurb:
      "Stories from the women navigating perimenopause and menopause, the clinicians supporting them, and the system that often makes both harder than it needs to be.",
    essays: [
      {
        title: "What we expect to hear from clinicians (and the research plan to find out)",
        teaser:
          "The hypothesis-led research-design plan from /proposal/insights, translated for a non-investor audience."
      },
      {
        title: "Time-to-MSCP-visit as a quality-of-care metric",
        teaser:
          "Why this is the metric that matters most in the validation cohort, and how a provider organization can measure it today without the Pause platform."
      },
      {
        title: "Designing care navigation that doesn't feel like a triage chatbot",
        teaser:
          "The clinical-design principles behind the Pre-Brief Panel and why the visible dossier is the right answer when the embedded chat's hidden-prechat surface doesn't work."
      }
    ]
  }
];

export default function BlogPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Blog · editorial roadmap</p>
        <h1>Stories from the frontier of menopause care.</h1>
        <p>
          We&apos;ll write about clinical evidence, AI architecture
          choices, and the lived experience of women in midlife — the
          three pillars below. Published essays haven&apos;t shipped
          yet; this page is the planned roadmap so a reader can decide
          whether the newsletter is worth their email. Subscribe via
          the footer to get essays as they land.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              Published essays{" "}
              <StatusPill
                status="future"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>None yet · roadmap below</strong>
          </li>
          <li>
            <span>
              Editorial pillars{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Clinical evidence · AI architecture · Lived experience</strong>
          </li>
          <li>
            <span>Cadence</span>
            <strong>~monthly when essays begin</strong>
          </li>
        </ul>
      </section>

      {pillars.map((p) => (
        <section key={p.pillar} style={{ marginTop: "1.5rem" }}>
          <header
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.6rem",
              flexWrap: "wrap",
              marginBottom: "0.4rem"
            }}
          >
            <p className="eyebrow" style={{ margin: 0 }}>
              {p.pillar}
            </p>
            <StatusPill status="planned" label="Pillar · planned essays" />
          </header>
          <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
            {p.blurb}
          </p>
          <div className="card-grid">
            {p.essays.map((e) => (
              <article key={e.title} className="card">
                <StatusPill
                  status="planned"
                  label="Planned essay"
                  style={{ marginBottom: "0.5rem" }}
                />
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "1.05rem" }}>
                  {e.title}
                </h3>
                <p style={{ margin: 0, fontSize: "0.92rem" }}>{e.teaser}</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="card" style={{ marginTop: "1.75rem" }}>
        <p className="eyebrow">Subscribe</p>
        <h2 style={{ fontSize: "clamp(1.2rem, 2vw, 1.5rem)", marginBottom: "0.5rem" }}>
          Get the essays as they land.
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", margin: 0 }}>
          Use the newsletter signup in the footer (it&apos;s a single
          email field). Cadence will be roughly monthly when the
          first essays publish; we won&apos;t send marketing
          unrelated to the editorial roadmap above. See{" "}
          <a href="/privacy" style={{ color: "var(--brand)" }}>
            /privacy
          </a>{" "}
          for what happens to your email after you submit it.
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/proposal" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Read the investor brief
        </a>
        <a href="/demo/intake" className="btn btn-primary">
          Touch the prototype
        </a>
      </section>
    </main>
  );
}
