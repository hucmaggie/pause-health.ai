import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "HIPAA Notice",
  description:
    "How Pause-Health.ai will operate as a HIPAA Business Associate once design-partner relationships are in force, and the BAA / Security Rule posture we're engineering toward. The prototype handles no PHI today.",
  path: "/hipaa",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "HIPAA Notice — Pause-Health.ai."
});

/**
 * HIPAA notice.
 *
 * Polished in the journey-fabric pass to remove two false
 * present-tense claims from the previous StubPage:
 *
 *   - "Pause-Health.ai operates as a Business Associate to
 *     provider organizations under HIPAA" -- there are no
 *     provider organizations and no BA relationships today.
 *   - "BAA Executed with each provider partner" -- zero BAAs
 *     have been executed.
 *
 * This rebuild is honest about the prototype-in-the-open
 * posture: no PHI today, no BAA today, no Business Associate
 * status today. It then walks through the HIPAA framework the
 * production stack is designed to operate under, so a
 * compliance reviewer can see the BA posture we're engineering
 * toward without being misled about what's already in force.
 */

type BaItem = {
  area: string;
  today: { detail: string; status: StatusPillStatus };
  designed: { detail: string; status: StatusPillStatus };
};

const baAreas: BaItem[] = [
  {
    area: "Business Associate status",
    today: {
      status: "future",
      detail:
        "Pause-Health.ai is NOT a Business Associate today. No Covered Entity has executed a BAA with us, and we do not access, store, or transmit any patient PHI in the prototype."
    },
    designed: {
      status: "planned",
      detail:
        "Once a provider organization (Covered Entity) executes a BAA, Pause-Health.ai will operate as their Business Associate for the menopause-triage workflows described in /proposal."
    }
  },
  {
    area: "Business Associate Agreement (BAA)",
    today: {
      status: "future",
      detail:
        "No BAA executed. The prototype runs on synthetic demo personas and seeded Salesforce sandbox records; nothing in scope of HIPAA flows through it."
    },
    designed: {
      status: "planned",
      detail:
        "Standard HHS-aligned BAA executed with every Covered Entity before any PHI access. Includes breach-notification SLA (60-day max, 24-hour preliminary), sub-processor disclosure, and post-termination data return / destruction."
    }
  },
  {
    area: "Permitted Uses & Disclosures",
    today: {
      status: "future",
      detail:
        "Not applicable today (no PHI handled)."
    },
    designed: {
      status: "designed",
      detail:
        "PHI will be used only for the Permitted Uses defined in each BAA: typically treatment, payment, and healthcare operations as needed to deliver the menopause-triage service. Marketing / fundraising / sale uses are explicitly excluded."
    }
  },
  {
    area: "Administrative safeguards",
    today: {
      status: "designed",
      detail:
        "Security awareness, role-based access control design, sanction policy, and risk-analysis posture documented for the production stack. The prototype is run by a single founder and is not a multi-user environment yet."
    },
    designed: {
      status: "planned",
      detail:
        "Full HIPAA Security Rule administrative safeguards — workforce training records, designated Security Officer, risk-management plan reviewed annually, sanction policy enforced."
    }
  },
  {
    area: "Physical safeguards",
    today: {
      status: "prototype",
      detail:
        "Prototype runs on Vercel + Salesforce — both SOC 2 / ISO 27001 hosting environments with documented physical-access controls inherited at the platform layer."
    },
    designed: {
      status: "planned",
      detail:
        "Same platform-layer inheritance plus device controls for any first-party endpoint that processes PHI (laptops with full-disk encryption, lost-device wipe, no production access from personal devices)."
    }
  },
  {
    area: "Technical safeguards",
    today: {
      status: "prototype",
      detail:
        "TLS 1.3 in transit (Vercel default), AES-256 at rest (Vercel + Salesforce defaults), OAuth Client Credentials for the live grounding path, OpenTelemetry-style trace spans for every Care Router decision."
    },
    designed: {
      status: "designed",
      detail:
        "Same defaults plus SSO/MFA on every administrative surface, RBAC mapped to clinical roles, audit log retention aligned with HIPAA records requirements (6 years), and PHI redaction at the trace boundary before export to customer SIEM."
    }
  },
  {
    area: "Breach notification",
    today: {
      status: "future",
      detail:
        "No PHI to breach today. If a security incident affecting the prototype occurs we'll publish it transparently."
    },
    designed: {
      status: "planned",
      detail:
        "Per BAA terms, Covered Entity notified within the BAA-specified SLA (24-hour preliminary in our template, full report within 60 days). Sub-processors flow notice upstream."
    }
  },
  {
    area: "Patient rights",
    today: {
      status: "future",
      detail:
        "No patient PHI is held today; rights of access / amendment / accounting of disclosures aren't yet in force because there's no protected record to exercise them against."
    },
    designed: {
      status: "designed",
      detail:
        "Pause-Health.ai will support the Covered Entity in fulfilling patient rights of access, amendment, accounting of disclosures, and restriction requests via documented APIs and runbooks."
    }
  }
];

export default function HipaaPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">HIPAA Notice</p>
        <h1>HIPAA practices, pilled honestly.</h1>
        <p>
          Pause-Health.ai is a prototype-in-the-open today: we are NOT
          yet a Business Associate to any Covered Entity, no BAA is in
          force, and the prototype handles no PHI. This page lays out
          the HIPAA framework the production stack is designed to
          operate under once design-partner provider organizations are
          onboarded, so a compliance reviewer can read the posture we
          are engineering toward without being misled about what is
          already in force.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              Role under HIPAA today{" "}
              <StatusPill
                status="future"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>None · no Covered Entity relationships yet</strong>
          </li>
          <li>
            <span>
              Role under HIPAA designed{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Business Associate to provider organizations</strong>
          </li>
          <li>
            <span>BAA template</span>
            <strong>Standard HHS-aligned · available on request</strong>
          </li>
          <li>
            <span>Privacy Officer contact</span>
            <strong>privacy@pause-health.ai</strong>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Today vs. Designed</p>
        <p
          style={{
            color: "var(--muted)",
            maxWidth: "70ch",
            marginBottom: "0.85rem"
          }}
        >
          Two columns per HIPAA area. <strong>Today</strong> is the
          posture in the public prototype. <strong>Designed</strong>{" "}
          is the BA posture mapped against the HIPAA Privacy and
          Security Rules for the production stack pre-GA. See also{" "}
          <a href="/security" style={{ color: "var(--brand)" }}>
            /security
          </a>{" "}
          for the broader technical-control view and{" "}
          <a href="/privacy" style={{ color: "var(--brand)" }}>
            /privacy
          </a>{" "}
          for the patient-facing posture.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.85rem"
          }}
        >
          {baAreas.map((b) => (
            <article key={b.area} className="card">
              <h3 style={{ marginTop: 0, marginBottom: "0.6rem" }}>
                {b.area}
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))",
                  gap: "1rem"
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      marginBottom: "0.3rem"
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.75rem",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        fontWeight: 700
                      }}
                    >
                      Today
                    </span>
                    <StatusPill status={b.today.status} />
                  </div>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    {b.today.detail}
                  </p>
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      marginBottom: "0.3rem"
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.75rem",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        fontWeight: 700
                      }}
                    >
                      Designed
                    </span>
                    <StatusPill status={b.designed.status} />
                  </div>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    {b.designed.detail}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">For privacy or compliance questions</p>
        <p style={{ color: "var(--muted)", maxWidth: "70ch", margin: 0 }}>
          Email{" "}
          <a
            href="mailto:privacy@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            privacy@pause-health.ai
          </a>{" "}
          with privacy / HIPAA inquiries. We aim to respond within 2
          business days; compliance reviews from prospective design
          partners get a faster path — flag the inquiry as such and
          we&apos;ll route accordingly. The BAA template is available
          on request.
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/security" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Security &amp; Compliance
        </a>
        <a href="/privacy" className="btn btn-primary">
          Privacy
        </a>
      </section>
    </main>
  );
}
