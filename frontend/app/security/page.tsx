import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Security & Compliance",
  description:
    "Pause-Health.ai's security and compliance posture today (prototype-in-the-open, no PHI handled) vs. what the production stack is engineered toward (HIPAA + HITRUST + SOC 2 Type II, BAA-backed provider partnerships).",
  path: "/security",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Security & Compliance posture — Pause-Health.ai."
});

/**
 * Security & Compliance page.
 *
 * Polished in the journey-fabric pass to remove three false
 * present-tense claims from the previous StubPage:
 *
 *   - "BAAs executed with all health system partners" -- we have
 *     zero health system partners; no BAAs have been executed.
 *   - "SOC 2 Type II in progress" -- the audit has not been
 *     started; SOC 2 is a planned Year-2 milestone (matches
 *     /proposal/data).
 *   - "AES-256 at rest, TLS 1.3 in transit" -- the prototype
 *     currently runs on Vercel + Salesforce sandboxes which DO
 *     use these defaults, but the page implied a custom
 *     production stack with formal verification. Reframed as
 *     "today via Vercel + Salesforce platform defaults" vs.
 *     "designed for production with formal control verification."
 *
 * The page now reads as two clearly-pilled columns: Today
 * (prototype-in-the-open posture) vs. Designed (production
 * posture pre-GA). Same vocabulary the rest of the site uses on
 * /proposal/data and /proposal/integration.
 */

type ControlRow = {
  control: string;
  today: { detail: string; status: StatusPillStatus };
  designed: { detail: string; status: StatusPillStatus };
};

const controls: ControlRow[] = [
  {
    control: "PHI handling",
    today: {
      status: "prototype",
      detail:
        "No real PHI is processed by the prototype. Demo personas are synthetic, identity resolution runs against a seeded Salesforce sandbox, and grounding falls back to a deterministic mock when Salesforce isn't configured."
    },
    designed: {
      status: "designed",
      detail:
        "Production deployments handle PHI under BAA only; data minimization is the default and every grounding call is logged with patient + purpose attribution to the trace span."
    }
  },
  {
    control: "Business Associate Agreement (BAA)",
    today: {
      status: "future",
      detail:
        "No BAA in force. The company has zero health-system partners today; this is the pre-design-partner stage."
    },
    designed: {
      status: "planned",
      detail:
        "BAA executed with every provider organization before any access to PHI. Standard HHS-aligned terms, breach-notification SLA, sub-processor disclosure."
    }
  },
  {
    control: "HIPAA Security Rule controls",
    today: {
      status: "designed",
      detail:
        "Administrative, physical, and technical safeguards designed against the Security Rule; not formally verified."
    },
    designed: {
      status: "planned",
      detail:
        "Full Security Rule control implementation with documented evidence, mapped against HITRUST CSF. Implementation roadmap on /proposal/data."
    }
  },
  {
    control: "SOC 2 Type II",
    today: {
      status: "future",
      detail:
        "Audit not yet started. Type II requires 6-12 months of operating evidence which the company doesn't have yet."
    },
    designed: {
      status: "planned",
      detail:
        "Year-2 milestone alongside first production pilots. Type I as an interim milestone after design-partner kickoff."
    }
  },
  {
    control: "HITRUST CSF certification",
    today: {
      status: "future",
      detail:
        "Not yet pursued."
    },
    designed: {
      status: "planned",
      detail:
        "Health-system-aligned framework, planned after SOC 2 Type II to compress procurement reviews with IDN customers."
    }
  },
  {
    control: "Encryption at rest / in transit",
    today: {
      status: "prototype",
      detail:
        "Inherits Vercel (TLS 1.3 in transit, AES-256 at rest on Vercel Edge / Postgres) and Salesforce platform defaults (TLS 1.2+, AES-256 KMS-managed). No custom crypto."
    },
    designed: {
      status: "designed",
      detail:
        "Same defaults at the platform layer plus per-tenant KMS keys for any first-party PHI store, with documented key rotation and break-glass procedures."
    }
  },
  {
    control: "Identity & access",
    today: {
      status: "prototype",
      detail:
        "Salesforce OAuth Client Credentials for the live grounding path; no end-user identity surface in the prototype itself (the embedded chat uses Salesforce-hosted auth)."
    },
    designed: {
      status: "designed",
      detail:
        "SAML / OIDC SSO with the customer's IdP, MFA enforced, RBAC mapped to clinical roles (clinician, MA, admin), full audit log to the trace store."
    }
  },
  {
    control: "Logging, monitoring, & traceability",
    today: {
      status: "prototype",
      detail:
        "Every Care Router decision emits OpenTelemetry-style spans (intake -> identity -> grounding -> routing). Inspectable on /demo/agent-fabric."
    },
    designed: {
      status: "designed",
      detail:
        "Same span model, exported to the customer's SIEM (Splunk / Datadog / etc.) with PHI redaction and 6-year retention to align with HIPAA records requirements."
    }
  },
  {
    control: "Vulnerability disclosure",
    today: {
      status: "prototype",
      detail: (
        "Reports accepted at security@pause-health.ai. The /.well-known/security.txt advertises the inbox per RFC 9116. The codebase is open at github.com/hucmaggie/pause-health.ai."
      )
    },
    designed: {
      status: "planned",
      detail:
        "Public bug-bounty program post-GA, including a safe-harbor clause for good-faith research."
    }
  }
];

export default function SecurityPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Security &amp; Compliance</p>
        <h1>Built for clinical trust — pilled honestly.</h1>
        <p>
          Pause-Health.ai is a prototype-in-the-open today: no PHI is
          processed by the public demo, no BAAs are in force, and the
          formal certifications health systems will eventually require
          (SOC 2 Type II, HITRUST CSF) are planned milestones rather
          than current state. This page distinguishes today from
          designed-for-production at every control so a security
          reviewer can read the posture without translating marketing.
        </p>
        <ul className="metric-list" style={{ marginTop: "1.25rem" }}>
          <li>
            <span>
              PHI handled today{" "}
              <StatusPill
                status="prototype"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>None · synthetic demo personas only</strong>
          </li>
          <li>
            <span>
              BAA status{" "}
              <StatusPill
                status="future"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>No partners yet · pre-design-partner stage</strong>
          </li>
          <li>
            <span>
              SOC 2 Type II{" "}
              <StatusPill
                status="planned"
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.7rem",
                  padding: "0.1rem 0.45rem"
                }}
              />
            </span>
            <strong>Year-2 milestone with first production pilots</strong>
          </li>
          <li>
            <span>Security inbox</span>
            <strong>security@pause-health.ai</strong>
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
          Two columns per control. <strong>Today</strong> is what runs
          in the public prototype right now. <strong>Designed</strong>{" "}
          is the production posture pre-GA, mapped against HIPAA
          Security Rule + HITRUST CSF + SOC 2 Trust Services criteria.
          Same proto-vs-prod framing the rest of the site uses on{" "}
          <a href="/proposal/data" style={{ color: "var(--brand)" }}>
            /proposal/data
          </a>{" "}
          and{" "}
          <a href="/proposal/integration" style={{ color: "var(--brand)" }}>
            /proposal/integration
          </a>
          .
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.85rem"
          }}
        >
          {controls.map((c) => (
            <article key={c.control} className="card">
              <h3 style={{ marginTop: 0, marginBottom: "0.6rem" }}>
                {c.control}
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
                    <StatusPill status={c.today.status} />
                  </div>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    {c.today.detail}
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
                    <StatusPill status={c.designed.status} />
                  </div>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    {c.designed.detail}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Reporting a vulnerability</p>
        <h2 style={{ fontSize: "clamp(1.2rem, 2vw, 1.5rem)", marginBottom: "0.5rem" }}>
          Found something? Email security@pause-health.ai.
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "72ch" }}>
          We accept good-faith vulnerability reports at{" "}
          <a
            href="mailto:security@pause-health.ai"
            style={{ color: "var(--brand)" }}
          >
            security@pause-health.ai
          </a>
          . The{" "}
          <a
            href="/.well-known/security.txt"
            style={{ color: "var(--brand)" }}
          >
            /.well-known/security.txt
          </a>{" "}
          file advertises the inbox per RFC 9116. The codebase is public at{" "}
          <a
            href="https://github.com/hucmaggie/pause-health.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand)" }}
          >
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          if you want to file the issue there instead. We aim to acknowledge
          reports within 2 business days. A formal bug-bounty program with a
          safe-harbor clause is planned for post-GA.
        </p>
      </section>

      <section style={{ marginTop: "2rem", marginBottom: "2rem" }}>
        <a href="/" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          Back to Home
        </a>
        <a href="/hipaa" className="btn btn-secondary" style={{ marginRight: "0.5rem" }}>
          HIPAA notice
        </a>
        <a href="/privacy" className="btn btn-primary">
          Privacy
        </a>
      </section>
    </main>
  );
}
