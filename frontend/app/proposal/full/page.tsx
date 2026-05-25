import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Full Proposal",
  description:
    "The complete Menopause Clinical Decision Support Proposal — vision, problem, product, technology, business model, and 24-month objectives for Pause-Health.ai.",
  path: "/proposal/full",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Full investor proposal — Pause-Health.ai."
});

export default function FullProposalPage() {
  return (
    <main className="container">
      <section className="hero">
        <a href="/proposal" className="btn btn-secondary">
          Back to Investor Brief
        </a>
        <p className="eyebrow">Full investor proposal</p>
        <h1>Menopause Clinical Decision Support Proposal</h1>
        <p className="hero-copy">
          Pause-Health.ai helps clinicians diagnose and treat menopause-related symptoms faster and
          more accurately by combining patient history, wearable signals, and AI guidance inside
          normal clinical workflows.
        </p>
      </section>

      <article className="proposal-doc">
        <section>
          <h2>Executive summary</h2>
          <p>
            Many women in perimenopause and menopause wait too long for correct diagnosis and
            treatment. Symptoms are often misattributed, care is inconsistent, and providers do not
            always have enough menopause-specific training or decision support.
          </p>
          <p>
            Pause-Health.ai is designed to close that gap. The product supports providers at the
            point of care with clear risk scoring, treatment suggestions, and workflow-ready
            guidance. The goal is better outcomes for patients and measurable operational value for
            health systems and payers.
          </p>

          <h3>Target outcomes</h3>
          <ul>
            <li>
              Reach approximately <strong>89% diagnostic accuracy</strong> in validation settings.
            </li>
            <li>
              Reduce diagnosis timelines from a <strong>2.5-year baseline</strong> to roughly{" "}
              <strong>6-12 months</strong>.
            </li>
            <li>
              Lower avoidable healthcare spend, currently estimated at about{" "}
              <strong>$1,685 per patient</strong> due to delays and misdiagnosis.
            </li>
            <li>
              Improve symptom-to-treatment matching across common menopause symptom clusters.
            </li>
          </ul>
        </section>

        <section>
          <h2>Why this matters</h2>
          <p>
            Menopause affects a very large population in the U.S., but care quality is still
            uneven:
          </p>
          <ul>
            <li>
              Around <strong>50 million</strong> women are affected.
            </li>
            <li>
              About <strong>67%</strong> of perimenopausal women are initially misdiagnosed.
            </li>
            <li>
              Average time to correct diagnosis is approximately <strong>2.5 years</strong>.
            </li>
            <li>Many PCPs report very limited menopause-specific training.</li>
          </ul>
          <p>
            This creates preventable costs and quality issues for patients, providers, and payers
            alike.
          </p>
        </section>

        <section>
          <h2>What Pause-Health.ai provides</h2>
          <ul>
            <li>AI-assisted diagnostic scoring and risk stratification.</li>
            <li>Personalized treatment pathway recommendations.</li>
            <li>Real-time guidance embedded in EHR workflows.</li>
            <li>Outcomes and ROI tracking for provider and payer stakeholders.</li>
          </ul>
        </section>

        <section>
          <h2>Technology foundation</h2>
          <p>The platform uses open-source healthcare infrastructure:</p>
          <ul>
            <li>
              <strong>JupyterHealth Exchange</strong> for consented FHIR R5 data exchange.
            </li>
            <li>
              <strong>Digital Biomarker Discovery Pipeline (dbdp)</strong> for wearable-derived
              signals — sleep, HRV, activity, and skin temperature.
            </li>
          </ul>
        </section>

        <section>
          <h2>Business model</h2>
          <p>Pause-Health.ai is a B2B healthcare SaaS company with three primary revenue channels:</p>
          <ul>
            <li>
              <strong>Health systems:</strong> $25K-$75K annual contracts.
            </li>
            <li>
              <strong>Payers:</strong> $0.50-$2.00 PMPM for eligible populations.
            </li>
            <li>
              <strong>Medical practices:</strong> $2K-$8K annual subscriptions.
            </li>
          </ul>

          <h3>Revenue targets</h3>
          <ul>
            <li>
              <strong>$8M ARR</strong> within 24 months.
            </li>
            <li>
              <strong>$50M+ ARR</strong> by year 4.
            </li>
          </ul>
        </section>

        <section>
          <h2>Market and strategic timing</h2>
          <ul>
            <li>
              U.S. menopause market estimated at <strong>$15.4B</strong>, growing approximately{" "}
              <strong>5.7% annually</strong>.
            </li>
            <li>
              Health systems and payers are under pressure to improve outcomes and reduce waste.
            </li>
            <li>
              AI capabilities are now practical enough for real-time, point-of-care support.
            </li>
            <li>
              FHIR and biomarker tooling reduce time to implementation and validation.
            </li>
          </ul>
        </section>

        <section>
          <h2>Core problems to solve</h2>

          <h3>1. Misdiagnosis and delays</h3>
          <ul>
            <li>Symptoms are often dismissed or mislabeled.</li>
            <li>Correct diagnosis can take years.</li>
            <li>Delays reduce trust and prolong patient suffering.</li>
          </ul>

          <h3>2. Cost burden</h3>
          <ul>
            <li>Excess referrals and avoidable utilization increase costs.</li>
            <li>Payers and providers both absorb inefficiency.</li>
            <li>Productivity losses impact patients and employers.</li>
          </ul>

          <h3>3. Inconsistent treatment</h3>
          <ul>
            <li>No universal protocol across systems.</li>
            <li>Recommendations vary widely between providers.</li>
            <li>Feedback loops for learning are often missing.</li>
          </ul>

          <h3>4. Provider workflow burden</h3>
          <ul>
            <li>
              Menopause care crosses specialties and is hard to manage in short visits.
            </li>
            <li>Research evolves faster than busy clinicians can track.</li>
            <li>Existing tools are often not integrated into daily workflows.</li>
          </ul>
        </section>

        <section>
          <h2>24-month objectives</h2>

          <h3>Primary objective</h3>
          <p>
            Deploy AI decision support across 25 health systems, improve diagnostic accuracy by
            30%, cut time-to-diagnosis by 50%, and reach $8M ARR.
          </p>

          <h3>Strategic objectives</h3>
          <ol>
            <li>
              <strong>Clinical validation:</strong> Validate performance and publish evidence.
            </li>
            <li>
              <strong>Health system adoption:</strong> Win anchor customers and prove operational
              ROI.
            </li>
            <li>
              <strong>Payer scale:</strong> Sign regional partnerships and demonstrate PMPM savings.
            </li>
            <li>
              <strong>Revenue validation:</strong> Build durable ARR and expansion metrics.
            </li>
            <li>
              <strong>Product excellence:</strong> Deliver robust EHR integration, performance,
              uptime, compliance, and regulatory progress.
            </li>
          </ol>
        </section>

        <section>
          <h2>Success criteria by month 24</h2>
          <ul>
            <li>89%+ diagnostic accuracy in validation programs.</li>
            <li>50%+ reduction in time-to-diagnosis.</li>
            <li>$8M+ ARR with a credible path to $50M ARR.</li>
            <li>20+ health system customers and 2+ payer partnerships.</li>
            <li>Strong provider adoption, NPS, and enterprise trust posture.</li>
          </ul>
        </section>

        <section>
          <h2>Strategic priorities</h2>
          <ul>
            <li>Lead with clinical evidence.</li>
            <li>Build around provider workflow realities.</li>
            <li>Align value metrics with payer economics.</li>
            <li>Continuously improve from real-world outcome data.</li>
            <li>Treat compliance, safety, and trust as long-term differentiation.</li>
          </ul>
        </section>

        <section>
          <h2>Part 2: deeper dives</h2>
          <p>
            The full Part 2 of this brief is published as a set of interlinked sections. Each
            covers one workstream in depth.
          </p>
          <ul>
            <li>
              <a href="/proposal/customers">Customer selection</a> — health system and payer ICPs.
            </li>
            <li>
              <a href="/proposal/insights">Customer insights</a> — provider and patient interview
              synthesis.
            </li>
            <li>
              <a href="/proposal/data">Data inventory and strategy</a> — sources, strategy, and
              moats.
            </li>
            <li>
              <a href="/proposal/competition">Competition</a> — landscape and positioning.
            </li>
            <li>
              <a href="/proposal/strategy">Digital strategy</a> — architecture, motion, and moats.
            </li>
            <li>
              <a href="/proposal/technology">Technology choices</a> — stack, AI approach, and
              safety.
            </li>
          </ul>
        </section>
      </article>

      <section style={{ margin: "2rem 0" }}>
        <a href="/proposal" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Investor Brief
        </a>
        <a href="/demo/intake" className="btn btn-primary">
          Experience Clickable Prototype
        </a>
      </section>
    </main>
  );
}
