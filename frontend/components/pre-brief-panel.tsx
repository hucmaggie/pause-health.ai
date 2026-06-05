"use client";

import type { DemoPersona } from "../lib/demo-cohort";

/**
 * Pre-Brief Panel — the patient dossier the clinician sees BEFORE
 * opening the Agentforce chat.
 *
 * Why a visible panel instead of hidden prechat fields:
 *
 *   The Salesforce Embedded Messaging V2 SDK exposes
 *   `embeddedservice_bootstrap.prechatAPI` as a no-op Proxy when the
 *   deployment hasn't fully wired the prechat-field surface on the
 *   server side. Calls to `setHiddenPrechatFields(...)` return `true`
 *   but no values actually travel to SCRT2; the routing Flow fires
 *   with all input variables null and `MessagingSession.Pause_*__c`
 *   stays empty. We verified this end-to-end on 2026-06-04 (see
 *   docs/PHASE_3_RUNBOOK.md, "empty-Proxy prechatAPI" finding).
 *
 *   Rather than ship a feature that quietly does nothing, we surface
 *   the same Data 360 dossier visibly above the chat. The clinician
 *   sees identity confidence, cohort percentile, care-program /
 *   care-plan state, vasomotor/sleep/mood scores, and the narrative
 *   profile note before they say a single word. The agent itself
 *   stays generic (it'll happily walk through a menopause intake);
 *   the personalization sits in the surrounding UI where it's
 *   honest and inspectable.
 *
 * Data source: the same `/api/intake/prechat-context?personaId=...`
 * endpoint that was previously the prechat-field source. Already
 * computes identity-resolved Data 360 grounding (real Salesforce
 * Health Cloud when configured, deterministic mock otherwise).
 */

export type PreBriefFields = Record<string, string>;

type Props = {
  persona: DemoPersona | undefined;
  status: "idle" | "loading" | "ready" | "error";
  fields?: PreBriefFields;
  identitySource?: "real" | "mock";
  groundingSource?: "real" | "mock";
  errorMessage?: string;
};

const PRIMARY_PILL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "Patient_Id", label: "Patient ID" },
  { key: "Age_Band", label: "Age" },
  { key: "Cycle_Status", label: "Cycle" },
  { key: "Primary_Symptom", label: "Primary symptom" }
];

const SCORE_FIELDS: Array<{ key: string; label: string; suffix?: string }> = [
  { key: "Vasomotor_Score", label: "Vasomotor", suffix: "/10" },
  { key: "Sleep_Score", label: "Sleep", suffix: "/10" },
  { key: "Mood_Score", label: "Mood", suffix: "/10" }
];

const CARE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "Care_Program_Status", label: "Care program" },
  { key: "Care_Plan_Status", label: "Care plan" },
  { key: "Days_Since_Last_Contact", label: "Days since last contact" }
];

const COHORT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "Cohort_Name", label: "Cohort" },
  { key: "Cohort_Size", label: "Cohort size" },
  { key: "Patient_Percentile", label: "Percentile in cohort" },
  { key: "Grounding_Insights_Count", label: "Calculated insights" }
];

const IDENTITY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "Identity_Confidence", label: "Confidence" },
  { key: "Identity_Ruleset", label: "Ruleset" },
  { key: "Identity_Sources", label: "Matched sources" }
];

function safeText(v: string | undefined): string {
  if (v === undefined || v === null) return "—";
  const trimmed = v.trim();
  return trimmed === "" ? "—" : trimmed;
}

function formatPercentile(v: string | undefined): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return safeText(v);
  if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
  if (n >= 0 && n <= 100) return `${Math.round(n)}%`;
  return safeText(v);
}

function formatConfidence(v: string | undefined): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return safeText(v);
  if (n >= 0 && n <= 1) return `${(n * 100).toFixed(0)}%`;
  return safeText(v);
}

export function PreBriefPanel({
  persona,
  status,
  fields,
  identitySource,
  groundingSource,
  errorMessage
}: Props) {
  if (!persona) return null;

  const isReady = status === "ready" && fields !== undefined;
  const get = (key: string): string =>
    isReady ? safeText(fields![key]) : "—";

  return (
    <article
      className="card pre-brief-panel"
      aria-label="Patient pre-brief dossier"
      style={{ marginBottom: "1.25rem" }}
    >
      <header className="pre-brief-header">
        <div>
          <p className="eyebrow">Pre-brief · Data 360 dossier</p>
          <h3 style={{ margin: "0.1rem 0 0" }}>
            {persona.firstName} {persona.lastName}
          </h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.88rem"
            }}
          >
            What the clinician (and the live Agentforce agent, by
            extension) sees before the conversation starts. Resolved
            from Salesforce Health Cloud identity + federated Data 360
            grounding.
          </p>
        </div>
        <div className="pre-brief-source-badges" aria-live="polite">
          <span
            className={`pre-brief-source-badge ${
              identitySource === "real"
                ? "pre-brief-source-badge--real"
                : "pre-brief-source-badge--mock"
            }`}
          >
            Identity: {identitySource ?? "—"}
          </span>
          <span
            className={`pre-brief-source-badge ${
              groundingSource === "real"
                ? "pre-brief-source-badge--real"
                : "pre-brief-source-badge--mock"
            }`}
          >
            Grounding: {groundingSource ?? "—"}
          </span>
        </div>
      </header>

      {status === "loading" && (
        <p style={{ marginTop: "0.8rem", color: "var(--muted)" }}>
          Resolving {persona.firstName} via Data 360…
        </p>
      )}

      {status === "error" && (
        <p
          role="alert"
          style={{
            marginTop: "0.8rem",
            color: "#ffb6c8",
            fontSize: "0.92rem"
          }}
        >
          Could not resolve pre-brief: {errorMessage ?? "unknown error"}.
        </p>
      )}

      {isReady && (
        <>
          <div className="pre-brief-primary-row">
            {PRIMARY_PILL_FIELDS.map(({ key, label }) => (
              <div key={key} className="pre-brief-pill">
                <span className="pre-brief-pill-label">{label}</span>
                <span className="pre-brief-pill-value">{get(key)}</span>
              </div>
            ))}
          </div>

          <div className="pre-brief-section-grid">
            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">Intake scores</h4>
              <ul className="pre-brief-metric-list">
                {SCORE_FIELDS.map(({ key, label, suffix }) => {
                  const raw = get(key);
                  const score = Number(raw);
                  return (
                    <li key={key}>
                      <span>{label}</span>
                      <strong>
                        {Number.isFinite(score) ? raw : safeText(raw)}
                        {Number.isFinite(score) && suffix ? suffix : ""}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">Care state</h4>
              <ul className="pre-brief-metric-list">
                {CARE_FIELDS.map(({ key, label }) => (
                  <li key={key}>
                    <span>{label}</span>
                    <strong>{get(key)}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">Cohort context</h4>
              <ul className="pre-brief-metric-list">
                {COHORT_FIELDS.map(({ key, label }) => {
                  // Cohort_Name is long-form text; render it stacked so
                  // it gets the full card width instead of squeezing
                  // into the right column.
                  if (key === "Cohort_Name") {
                    return (
                      <li
                        key={key}
                        className="pre-brief-metric-row--stacked"
                      >
                        <span>{label}</span>
                        <strong>{get(key)}</strong>
                      </li>
                    );
                  }
                  return (
                    <li key={key}>
                      <span>{label}</span>
                      <strong>
                        {key === "Patient_Percentile"
                          ? formatPercentile(fields?.[key])
                          : get(key)}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">Identity resolution</h4>
              <ul className="pre-brief-metric-list pre-brief-metric-list--stacked">
                {IDENTITY_FIELDS.map(({ key, label }) => (
                  <li key={key}>
                    <span>{label}</span>
                    <strong>
                      {key === "Identity_Confidence"
                        ? formatConfidence(fields?.[key])
                        : get(key)}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="pre-brief-narrative">
            <span className="eyebrow" style={{ marginBottom: 0 }}>
              Profile note
            </span>
            <span>{get("Demo_Note") !== "—" ? get("Demo_Note") : persona.profileNote}</span>
          </p>
        </>
      )}
    </article>
  );
}
