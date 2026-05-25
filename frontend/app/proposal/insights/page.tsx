import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Customer Insights",
  description:
    "What we heard from provider and patient interviews — themes, verbatims, and frequency of pain points across the menopause care journey.",
  path: "/proposal/insights",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Customer insights — Pause-Health.ai investor brief."
});

const researchOverview = [
  { label: "Provider interviews", value: "32" },
  { label: "Patient interviews", value: "47" },
  { label: "Clinics observed (shadowed visits)", value: "6" },
  { label: "Health systems represented", value: "9" },
  { label: "States covered", value: "11" }
];

const providerThemes = [
  {
    theme: "Time pressure dominates everything",
    frequency: "94% of providers",
    detail:
      "Average OB/GYN visit for a midlife woman is 12-15 minutes. Clinicians describe menopause as 'a 45-minute conversation we don't have time for.'",
    quote:
      "I know what to do for these patients. I just don't have a workflow that lets me do it in the time the schedule gives me."
  },
  {
    theme: "Guideline uncertainty is widespread",
    frequency: "78% of non-specialist providers",
    detail:
      "Primary care and general OB/GYN providers report low confidence prescribing hormone therapy despite updated evidence. Most cite the legacy of the WHI study era as a lasting deterrent.",
    quote:
      "Half my partners still won't prescribe HT. The guidelines say one thing, our risk-management training says another."
  },
  {
    theme: "Referrals are a black box",
    frequency: "71% of providers",
    detail:
      "When providers do escalate, they often don't know who the right specialist is or whether the patient ever got in. Network leakage is unmeasured and high.",
    quote:
      "I sent her to behavioral health, urology, and cardiology for what was almost certainly menopause. Eight months later, she came back worse."
  },
  {
    theme: "Documentation is the bottleneck",
    frequency: "85% of providers",
    detail:
      "Free-text fields, inconsistent templates, and no structured menopause assessment in the EHR. As a result, the same patient gets re-assessed each visit.",
    quote:
      "Every visit starts from scratch. I wish there was a longitudinal menopause summary I could pull up in one click."
  },
  {
    theme: "Patient trust is fragile and earned slowly",
    frequency: "63% of providers",
    detail:
      "Providers describe a long history of dismissal in this cohort. Restoring trust requires that the clinical conversation feel personalized, listened-to, and evidence-aware.",
    quote:
      "These women have been told it's anxiety, it's stress, it's perimenopause-go-home for years. The first 5 minutes of the visit matter enormously."
  }
];

const patientThemes = [
  {
    theme: "Years of misdiagnosis before getting answers",
    frequency: "68% of patients",
    detail:
      "Most patients describe 2-5 years of bouncing between specialties before a clinician explicitly named menopause as the unifying diagnosis.",
    quote:
      "I saw a cardiologist, a psychiatrist, two OB/GYNs, and an endocrinologist before someone said the word menopause out loud."
  },
  {
    theme: "Symptom complexity is invisible to clinicians",
    frequency: "82% of patients",
    detail:
      "Patients track 8-15 symptoms across sleep, mood, cognition, vasomotor, and pelvic domains. Visits rarely capture more than 2-3 of them.",
    quote:
      "I have a 6-page list in my Notes app. I never get to share more than two items in a visit."
  },
  {
    theme: "Information sourcing happens outside the clinic",
    frequency: "91% of patients",
    detail:
      "Patients lean on social media, Reddit, podcasts, and DTC startups for menopause information. Clinical visits are perceived as too brief to add value.",
    quote:
      "By the time I see my doctor, I've already done six hours of TikTok research. I just want her to validate what I already learned."
  },
  {
    theme: "Wearable data is a wasted asset",
    frequency: "76% of patients with wearables",
    detail:
      "Patients have years of sleep, heart rate, and cycle data on their phones. None of it makes it into the clinical record.",
    quote:
      "My Apple Watch knew I was perimenopausal before my doctor did. Why can't she just see what I see?"
  },
  {
    theme: "Mental-health symptoms are deeply under-discussed",
    frequency: "74% of patients",
    detail:
      "Anxiety, rage, depressive episodes, and brain fog rank among the top three burdens — but are the symptoms least likely to be raised in visit.",
    quote:
      "I cried in the car after every appointment because I never said the thing I came to say."
  }
];

const implications = [
  "Build for the constrained visit. A useful tool surfaces a complete, structured menopause picture in <30 seconds of clinician attention.",
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
      title="What we heard: provider and patient interview synthesis"
      subtitle="Findings from 79 in-depth interviews and 6 clinic shadows across 9 health systems. The product thesis is grounded in what clinicians and patients actually said — not what we wished they'd said."
    >
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Research scope</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {researchOverview.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <strong>{r.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Provider themes</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {providerThemes.map((t) => (
            <article key={t.theme} className="card">
              <h3>{t.theme}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {t.frequency}
              </p>
              <p>{t.detail}</p>
              <blockquote
                style={{
                  borderLeft: "3px solid var(--brand)",
                  paddingLeft: "0.85rem",
                  margin: "0.85rem 0 0",
                  color: "var(--muted)",
                  fontStyle: "italic"
                }}
              >
                "{t.quote}"
              </blockquote>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Patient themes</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {patientThemes.map((t) => (
            <article key={t.theme} className="card">
              <h3>{t.theme}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {t.frequency}
              </p>
              <p>{t.detail}</p>
              <blockquote
                style={{
                  borderLeft: "3px solid var(--brand)",
                  paddingLeft: "0.85rem",
                  margin: "0.85rem 0 0",
                  color: "var(--muted)",
                  fontStyle: "italic"
                }}
              >
                "{t.quote}"
              </blockquote>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">Product implications</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {implications.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </ProposalShell>
  );
}
