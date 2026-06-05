import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Research-Design Plan",
  description:
    "Pause-Health.ai's research-design plan and hypotheses for provider + patient discovery during the design-partner stage. Themes are literature-derived; formal interview research is the immediate next milestone.",
  path: "/proposal/insights",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Research design plan — Pause-Health.ai investor brief."
});

/**
 * This page was previously framed as "What we heard from 79 in-depth
 * interviews + 6 clinic shadows." That framing put non-existent
 * research counts (32 provider interviews, 47 patient interviews,
 * 6 clinic shadows, 9 health systems, 11 states) into the deck as
 * factual claims when no formal interview research has been
 * conducted yet.
 *
 * This rebuild reframes the whole page as "Research-design plan":
 *
 *   - The themes themselves are kept (they are literature-derived
 *     hypotheses that match published menopause-care research),
 *     but explicitly tagged as "hypothesis -- to validate" rather
 *     than "what providers told us".
 *   - Frequency claims (94%, 78%, 71% etc.) are removed -- those
 *     were false-precision numbers attached to non-existent research.
 *   - Quotes are kept as ILLUSTRATIVE COMPOSITES, tagged as such,
 *     and labeled as placeholders that will be replaced with
 *     attributed verbatims after research.
 *   - A new "Research scope (plan)" block replaces the old "Research
 *     scope" metric-list. It states the planned interview counts,
 *     methodology, IRB posture, and which interviews land first.
 *   - Source disclosure section added at the bottom: where the
 *     literature-derived hypotheses come from (peer-reviewed menopause
 *     research, MSCP guidelines, published patient-experience studies,
 *     clinician practice surveys).
 *
 * The page now reads as a credible research-design document instead
 * of a fabricated research-results document.
 */

const planSummary = [
  {
    label: "Provider interviews (planned)",
    value: "~30",
    detail:
      "Mix of MSCP-credentialed clinicians, primary-care, and general OB/GYN across IDN + AMC settings. Conducted during design-partner stage."
  },
  {
    label: "Patient interviews (planned)",
    value: "~45",
    detail:
      "Stratified by menopause stage (peri / post), symptom cluster, and care-access setting. Recruited through design-partner clinician networks."
  },
  {
    label: "Clinic shadows (planned)",
    value: "4-6",
    detail:
      "Half-day clinic observations focused on the constrained menopause visit. Conducted under each design-partner's research approvals."
  },
  {
    label: "Methodology",
    value: "Semi-structured",
    detail:
      "Topic guide + open follow-ups. Recordings transcribed; coding via inductive thematic analysis. Topic guide co-designed with the clinical advisory board."
  },
  {
    label: "IRB posture",
    value: "Per design partner",
    detail:
      "Each design partner's IRB process honored. Patient interviews require explicit consent for recording + transcript use; verbatim attribution opt-in."
  }
];

const providerHypotheses = [
  {
    theme: "Time pressure dominates everything",
    sourceHint: "Literature: average OB/GYN visit duration in U.S. midlife cohorts",
    detail:
      "We expect to hear that the constrained 12-15 minute visit is the binding constraint on menopause care quality — that clinicians describe the conversation as &quot;a 45-minute discussion we don't have time for.&quot;",
    quote:
      "I know what to do for these patients. I just don't have a workflow that lets me do it in the time the schedule gives me."
  },
  {
    theme: "Guideline uncertainty is widespread",
    sourceHint: "Literature: post-WHI prescribing patterns + provider HRT-confidence surveys",
    detail:
      "We expect non-specialist providers to report low confidence prescribing hormone therapy despite updated evidence — with the legacy of the WHI study era cited as a lasting deterrent.",
    quote:
      "Half my partners still won't prescribe HT. The guidelines say one thing, our risk-management training says another."
  },
  {
    theme: "Referrals are a black box",
    sourceHint: "Literature: referral leakage + network adequacy studies",
    detail:
      "We expect providers to describe referrals to behavioral health, urology, cardiology, and OB/GYN as opaque — they often don't know who the right specialist is or whether the patient ever got in.",
    quote:
      "I sent her to behavioral health, urology, and cardiology for what was almost certainly menopause. Eight months later, she came back worse."
  },
  {
    theme: "Documentation is the bottleneck",
    sourceHint: "Literature: EHR documentation burden + clinician-burnout studies",
    detail:
      "We expect to hear that free-text fields, inconsistent templates, and no structured menopause assessment in the EHR mean the same patient gets re-assessed each visit.",
    quote:
      "Every visit starts from scratch. I wish there was a longitudinal menopause summary I could pull up in one click."
  },
  {
    theme: "Patient trust is fragile and earned slowly",
    sourceHint: "Literature: patient-reported menopause-care experience studies",
    detail:
      "We expect providers to describe a long history of patient dismissal in this cohort — and to note that restoring trust requires that the clinical conversation feel personalized, listened-to, and evidence-aware.",
    quote:
      "These women have been told it's anxiety, stress, perimenopause-go-home for years. The first five minutes of the visit matter enormously."
  }
];

const patientHypotheses = [
  {
    theme: "Years of misdiagnosis before getting answers",
    sourceHint:
      "Literature: time-to-diagnosis studies in midlife cohorts (~2.5y average to correct dx)",
    detail:
      "We expect most patients to describe 2-5 years of bouncing between specialties before a clinician explicitly named menopause as the unifying diagnosis.",
    quote:
      "I saw a cardiologist, a psychiatrist, two OB/GYNs, and an endocrinologist before someone said the word menopause out loud."
  },
  {
    theme: "Symptom complexity is invisible to clinicians",
    sourceHint: "Literature: PRO instrument coverage vs. captured-in-visit gaps",
    detail:
      "We expect patients to track 8-15 symptoms across sleep, mood, cognition, vasomotor, and pelvic domains — and to report that visits rarely capture more than 2-3 of them.",
    quote:
      "I have a 6-page list in my Notes app. I never get to share more than two items in a visit."
  },
  {
    theme: "Information sourcing happens outside the clinic",
    sourceHint:
      "Public-research: menopause information-seeking patterns + DTC menopause-startup engagement metrics",
    detail:
      "We expect patients to lean on social media, Reddit, podcasts, and DTC startups for menopause information — and to perceive clinical visits as too brief to add value.",
    quote:
      "By the time I see my doctor, I've already done six hours of TikTok research. I just want her to validate what I already learned."
  },
  {
    theme: "Wearable data is a wasted asset",
    sourceHint:
      "Literature: wearable-data clinical-integration studies + EHR-PRO ingestion gap",
    detail:
      "We expect patients with wearables to report that years of sleep, heart rate, and cycle data on their phones never makes it into the clinical record.",
    quote:
      "My Apple Watch knew I was perimenopausal before my doctor did. Why can't she just see what I see?"
  },
  {
    theme: "Mental-health symptoms are deeply under-discussed",
    sourceHint: "Literature: menopause + depression / anxiety co-prevalence + visit-content studies",
    detail:
      "We expect anxiety, rage, depressive episodes, and brain fog to rank among the top three burdens — but to be the symptoms least likely to be raised in visit.",
    quote:
      "I cried in the car after every appointment because I never said the thing I came to say."
  }
];

const implications = [
  "Build for the constrained visit. A useful tool surfaces a complete, structured menopause picture in < 30 seconds of clinician attention.",
  "Lead with explainability. Both clinician trust and patient trust collapse if the AI feels like a black box.",
  "Integrate, don't replace. Sitting inside the EHR (FHIR + SMART) is non-negotiable — sidecar apps will be abandoned.",
  "Capture wearable + patient-reported data on the patient side. The clinical workflow then consumes it as a structured summary.",
  "Treat mental health as a first-class care pathway, not a referral-out problem.",
  "Quality measures and referral leakage are the strongest economic levers for the buyer."
];

export default function InsightsPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Research-design plan: provider + patient discovery"
      subtitle="Pause-Health.ai is pre-design-partner — formal interview research happens during the design-partner stage. The page below lays out the planned research, the literature-derived hypotheses that will guide it, and how product implications will be re-derived once real interview data lands."
    >
      <section
        className="card"
        style={{
          marginBottom: "1.5rem",
          borderLeft: "3px solid var(--brand)",
          background: "rgba(25, 11, 22, 0.45)"
        }}
      >
        <p className="eyebrow" style={{ marginBottom: "0.4rem" }}>
          Reading note
        </p>
        <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>
          The themes below are <strong>literature-derived hypotheses</strong>,
          not findings from interviews Pause-Health.ai has conducted. They
          match published menopause-care research, MSCP practice surveys,
          and patient-experience studies, but they are presented here as
          questions we will test with real interviews — not as evidence
          we have already gathered. Frequency percentages have been
          removed and quotes are tagged as illustrative composites.
        </p>
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Research scope · planned</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The interview program we will run during design-partner stage
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {planSummary.map((p) => (
            <li key={p.label}>
              <span>{p.label}</span>
              <strong>
                {p.value}
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    marginTop: "0.15rem",
                    lineHeight: 1.5
                  }}
                >
                  {p.detail}
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Provider-side hypotheses</p>
        <h2 className="proposal-section-title">
          What we expect to hear from clinicians
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {providerHypotheses.map((t) => (
            <article key={t.theme} className="card">
              <span
                className="pre-brief-source-badge pre-brief-source-badge--mock"
                style={{ marginBottom: "0.5rem" }}
              >
                Hypothesis · to validate
              </span>
              <h3>{t.theme}</h3>
              <p style={{ margin: "0 0 0.6rem", color: "var(--text)" }}>
                {t.detail}
              </p>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--muted)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Source: </strong>
                {t.sourceHint}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.78rem",
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  fontWeight: 600
                }}
              >
                Illustrative composite · placeholder
              </p>
              <blockquote
                style={{
                  borderLeft: "3px solid var(--brand)",
                  paddingLeft: "0.85rem",
                  margin: "0.3rem 0 0",
                  color: "var(--muted)",
                  fontStyle: "italic"
                }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Patient-side hypotheses</p>
        <h2 className="proposal-section-title">
          What we expect to hear from patients
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {patientHypotheses.map((t) => (
            <article key={t.theme} className="card">
              <span
                className="pre-brief-source-badge pre-brief-source-badge--mock"
                style={{ marginBottom: "0.5rem" }}
              >
                Hypothesis · to validate
              </span>
              <h3>{t.theme}</h3>
              <p style={{ margin: "0 0 0.6rem", color: "var(--text)" }}>
                {t.detail}
              </p>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--muted)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Source: </strong>
                {t.sourceHint}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.78rem",
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  fontWeight: 600
                }}
              >
                Illustrative composite · placeholder
              </p>
              <blockquote
                style={{
                  borderLeft: "3px solid var(--brand)",
                  paddingLeft: "0.85rem",
                  margin: "0.3rem 0 0",
                  color: "var(--muted)",
                  fontStyle: "italic"
                }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">Product implications · derived from the hypotheses</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          What we&apos;ll do if the hypotheses validate
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          The implications below are the product-design consequences if
          the literature-derived hypotheses validate at interview. They
          will be re-derived from the real interview data once it lands.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {implications.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">How this connects to the rest of the deck</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/customers">Customer selection</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The ICP segmentation the interview cohort will be recruited from.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/strategy">Digital strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the implications above translate into the five
              architectural pillars (Pillar 1 = constrained-visit → EHR-native).
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP feature engineering</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How &quot;wearable data is a wasted asset&quot; becomes an actual
              feature pipeline.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How the &quot;documentation is the bottleneck&quot; theme becomes a
              structured trace plane the clinician can read in one place.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
