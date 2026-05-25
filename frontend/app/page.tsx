export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Pause-Health.ai | Premium FemTech Intelligence</p>
        <h1>Elevating menopause care with precision, empathy, and clinical AI</h1>
        <p>
          Pause gives care teams a refined decision layer for perimenopause and menopause:
          multimodal signal intake, clinically explainable triage, and personalized next-step
          pathways designed for women in midlife.
        </p>
        <ul className="metric-list">
          <li>
            <span>Women in perimenopause/menopause (US)</span>
            <strong>50M+</strong>
          </li>
          <li>
            <span>Common initial misdiagnosis rate</span>
            <strong>67%</strong>
          </li>
          <li>
            <span>Pause target triage accuracy</span>
            <strong>89%</strong>
          </li>
          <li>
            <span>Avoidable cost per delayed diagnosis</span>
            <strong>$1,685</strong>
          </li>
        </ul>
        <div style={{ marginTop: "1rem" }}>
          <a href="/proposal" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
            Investor Brief
          </a>
          <a href="/demo/intake" className="btn btn-primary">
            Experience Prototype
          </a>
        </div>
      </section>
    </main>
  );
}
