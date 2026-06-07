import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Clinical Research",
  description:
    "How Pause-Health.ai's clinical foundations are grounded today (referenced guidelines, hypothesis-led care policy) and the validation + bias-monitoring program planned alongside design-partner deployments.",
  path: "/research",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Clinical research at Pause-Health.ai — referenced guidelines and validation roadmap."
});

/**
 * Clinical Research page.
 *
 * Polished in the journey-fabric pass to remove a false present-
 * tense claim from the previous StubPage: "Bias monitoring -
 * Quarterly with clinician review." There is no operational bias
 * monitoring today; this was an aspirational metric stated as
 * current state.
 *
 * The page now splits into three clearly-pilled blocks:
 *
 *   1. What's referenced (factual): the actual peer-reviewed
 *      menopause-care guidelines our Care Router policy and
 *      MSCP-pathway heuristics already cite in code. These are
 *      Wired in prototype because the references show up in
 *      lib/care-router.ts, lib/menopause-society.ts, and
 *      lib/risk-band.ts.
 *
 *   2. What's planned (validation): the cohort design, primary
 *      endpoints, statistical plan, and IRB posture the
 *      validation program needs. Mirrors the research-design
 *      plan voice on /proposal/insights -- "hypothesis to
 *      validate" rather than "validated result."
 *
 *   3. What we will publish (transparency commitment): pre-
 *      registration of validation studies, public methodology,
 *      bias-monitoring cadence + report cadence post-GA.
 *
 * The previous "Validation cohort target 10k+ women across 5
 * health systems" metric is kept but re-pilled as a Planned
 * target rather than implying recruitment is underway.
 */

type Guideline = {
  organization: string;
  reference: string;
  whereInCode: string;
};

// Guidelines our policy code actually cites. Verifiable in the
// open-source codebase. Keep this list to ground-truth -- adding
// references that aren't in code is the kind of dishonesty this
// page exists to avoid.
const referencedGuidelines: Guideline[] = [
  {
    organization: "The Menopause Society (formerly NAMS)",
    reference:
      "Position statements on hormone therapy, vasomotor symptoms, and the MSCP (Menopause Society Certified Practitioner) credential.",
    whereInCode:
      "lib/menopause-society.ts (deep-link referral path), lib/risk-band.ts (HRT suitability heuristic), /proposal/menopause-society"
  },
  {
    organization: "ACOG (American College of Obstetricians and Gynecologists)",
    reference:
      "Clinical Practice Guidelines on management of menopausal symptoms; postmenopausal bleeding workup priorities.",
    whereInCode:
      "lib/risk-band.ts (postmenopausal bleeding red-flag check), lib/care-router.ts (urgent-gynecology pathway trigger)"
  },
  {
    organization: "IMS (International Menopause Society)",
    reference:
      "Global consensus statements on menopause hormone therapy, cardiometabolic considerations, and quality of life endpoints.",
    whereInCode:
      "lib/risk-band.ts (CVD / BMI red-flag check for HRT deferral)"
  },
  {
    organization: "Endocrine Society",
    reference:
      "Clinical Practice Guideline on postmenopausal hormone therapy and treatment of menopausal symptoms.",
    whereInCode:
      "lib/care-router.ts (mscp-virtual-visit + mscp-in-person pathway thresholds)"
  }
];

type ValidationItem = {
  area: string;
  detail: string;
  status: StatusPillStatus;
};

const validationProgram: ValidationItem[] = [
  {
    area: "Validation cohort target",
    detail:
      "~10k women across 3-5 design-partner provider organizations, stratified by menopause stage (peri / post), symptom-cluster severity, and care-access setting. Recruitment begins after the first design-partner BAA is in force.",
    status: "planned"
  },
  {
    area: "Primary endpoints",
    detail:
      "Care-Router pathway concordance vs. blinded clinician adjudication; symptom-burden trajectory (vasomotor / sleep / mood) at 30 / 90 days post-intake; time-to-MSCP-visit for high-burden cohorts.",
    status: "designed"
  },
  {
    area: "Reference standard",
    detail:
      "Two-clinician adjudication of pathway routing on a stratified random sample, blinded to model output. Disagreements resolved by a third senior reviewer.",
    status: "designed"
  },
  {
    area: "Statistical plan",
    detail:
      "Pre-registered with the validation protocol; primary analysis is the pathway-concordance Cohen's kappa with 95% confidence intervals. Sensitivity analyses by age, ethnicity, and care-access setting.",
    status: "planned"
  },
  {
    area: "Bias monitoring",
    detail:
      "Subgroup pathway-distribution + concordance reported per cohort dimension (age, race / ethnicity, insurance status, geography) at the same cadence as the validation report. Designed; cadence depends on cohort enrollment rate.",
    status: "designed"
  },
  {
    area: "IRB / ethics",
    detail:
      "Validation studies submitted to the design-partner organization's IRB. The platform's prototype use of synthetic personas is not human-subjects research.",
    status: "planned"
  }
];

type Publication = {
  label: string;
  detail: string;
  status: StatusPillStatus;
};

const publicationPlan: Publication[] = [
  {
    label: "Methodology paper",
    detail:
      "Pause-Health.ai Care Router policy, grounding architecture, and validation protocol — preprint posted at the start of the validation phase so peers can critique the design before results land.",
    status: "planned"
  },
  {
    label: "Validation results",
    detail:
      "Primary and pre-registered secondary endpoints reported regardless of direction. Submission to a peer-reviewed clinical informatics or menopause-focused journal.",
    status: "planned"
  },
  {
    label: "Bias-monitoring report",
    detail:
      "Public report on subgroup pathway distributions + concordance, refreshed at the cadence the validation cohort supports. Methodology and code published alongside.",
    status: "future"
  },
  {
    label: "Open-source code",
    detail:
      "The full Care Router policy, risk-band heuristic, and grounding integration are public at github.com/hucmaggie/pause-health.ai today — no opaque ML black box.",
    status: "prototype"
  }
];

export default function ResearchPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Clinical research</p>
        <h1>Evidence-grounded menopause intelligence — pilled honestly.</h1>
        <p>
          Pause-Health.ai&apos;s clinical foundations sit in three
          layers: peer-reviewed menopause-care guidelines we already
          cite in code (factual), a validation and bias-monitoring
          program designed against those guidelines (planned,
          gated on the first design-partner BAA), and a transparency
          commitment for how we will publish methodology and results
          regardless of direction.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              Guidelines referenced{" "}
              <StatusPill
                status="prototype"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Menopause Society, ACOG, IMS, Endocrine Society</strong>
          </li>
          <li>
            <span>
              Validation cohort target{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>~10k women across 3-5 design partners</strong>
          </li>
          <li>
            <span>
              Bias monitoring{" "}
              <StatusPill
                status="designed"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Subgroup concordance + distribution</strong>
          </li>
          <li>
            <span>Research contact</span>
            <strong>research@pause-health.ai</strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
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
            What&apos;s referenced
          </p>
          <StatusPill status="prototype" label="Wired in code today" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          The peer-reviewed menopause-care guidelines the Care Router
          policy and MSCP-pathway heuristics already cite. Each entry
          notes where in the open-source codebase the reference
          actually shows up, so a clinical reviewer can verify the
          claim without taking our word for it.
        </p>
        <div className="card-grid">
          {referencedGuidelines.map((g) => (
            <article key={g.organization} className="card">
              <h3 style={{ marginTop: 0, marginBottom: "0.4rem" }}>
                {g.organization}
              </h3>
              <p style={{ margin: "0 0 0.6rem", fontSize: "0.92rem" }}>
                {g.reference}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Where in code: </strong>
                {g.whereInCode}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
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
            What&apos;s planned · validation program
          </p>
          <StatusPill status="planned" label="Gated on first design partner" />
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          The validation and bias-monitoring program designed to run
          alongside the first design-partner deployments. Each block
          is pilled to distinguish what&apos;s a finalized study
          design from what&apos;s gated on cohort availability.
        </p>
        <div className="card-grid">
          {validationProgram.map((v) => (
            <article key={v.area} className="card">
              <StatusPill
                status={v.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ margin: "0 0 0.3rem" }}>{v.area}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{v.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
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
            What we will publish · transparency commitment
          </p>
        </header>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", marginBottom: "0.75rem" }}>
          Methodology, results, and bias-monitoring reports —
          published regardless of direction. The codebase is already
          public; the research artifacts will follow as the
          validation program runs.
        </p>
        <div className="card-grid">
          {publicationPlan.map((p) => (
            <article key={p.label} className="card">
              <StatusPill
                status={p.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ margin: "0 0 0.3rem" }}>{p.label}</h3>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{p.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">For clinical reviewers + research partners</p>
        <p style={{ color: "var(--muted)", maxWidth: "72ch", margin: 0 }}>
          The investor-brief deep-dive on hypotheses we&apos;re
          carrying into design-partner research is at{" "}
          <a href="/proposal/insights" style={{ color: "var(--brand)" }}>
            /proposal/insights
          </a>
          . Source code is public at{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            github.com/hucmaggie/pause-health.ai
          </a>
          . For clinical-advisory inquiries, validation collaborations,
          or pre-registration discussions, email{" "}
          <a
            href="mailto:research@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            research@pause-health.ai
          </a>
          .
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/proposal/insights" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Research-design plan
        </a>
        <a href="/contact" className="btn btn-primary">
          Get in touch
        </a>
      </section>
    </main>
  );
}
