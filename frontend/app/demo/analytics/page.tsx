import { DemoShell } from "../../../components/demo-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Outcome Analytics",
  description:
    "Outcome metrics for the Pause-Health.ai prototype — diagnostic accuracy, time-to-diagnosis, and pathway adherence.",
  path: "/demo/analytics",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — outcome analytics."
});

const metrics = [
  {
    label: "Diagnostic accuracy",
    value: "89%",
    detail: "Target performance vs. 67% national misdiagnosis benchmark"
  },
  {
    label: "Time-to-diagnosis",
    value: "2.5y -> 6-12m",
    detail: "Program objective to reduce diagnostic delays by 50%+"
  },
  {
    label: "Patient satisfaction improvement",
    value: "+34%",
    detail: "Pilot target across anchor provider systems"
  },
  {
    label: "Average avoidable cost reduction",
    value: "USD 1,685",
    detail: "Estimated waste avoided per patient from faster diagnosis"
  },
  {
    label: "24-month ARR target",
    value: "USD 8M",
    detail: "Health systems + payer partnership growth model"
  },
  {
    label: "Year-4 ARR trajectory",
    value: "USD 50M+",
    detail: "Expansion through multi-site health system and payer channels"
  }
];

export default function AnalyticsDemoPage() {
  return (
    <DemoShell
      title="Menopause Intelligence Analytics"
      subtitle="Leaders monitor safety, diagnostic velocity, and pathway quality with a premium, outcomes-first view across sites."
    >
      <section className="demo-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {metrics.map((metric) => (
          <article key={metric.label} className="card">
            <h3>{metric.label}</h3>
            <p className="trust-value">{metric.value}</p>
            <p className="section-subtitle">{metric.detail}</p>
          </article>
        ))}
      </section>
    </DemoShell>
  );
}
