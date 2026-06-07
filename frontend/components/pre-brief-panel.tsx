"use client";

import { DEMO_COHORT, type DemoPersona } from "../lib/demo-cohort";
import { computeRisk, suggestedPathway } from "../lib/risk-band";
import { describePathway } from "../lib/care-router-pathways";

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
 *
 * Persona-aware polish (added in the journey-fabric pass):
 *
 *   1. Header journey shortcuts. Three small CTAs at the top-right
 *      that link forward to /demo/patient (open Care Detail),
 *      /demo/routing (run the Care Router), and /demo/agent-fabric
 *      (inspect spans), each preserving ?personaId=. Saves the
 *      clinician a trip to the shell nav when the next action is
 *      contextual to this patient.
 *
 *   2. Switch-persona chip row. A compact row of the other 5 cohort
 *      personas just under the header so the clinician can flip
 *      patients without scrolling back up to the picker. Clicking a
 *      chip drives the parent intake-patient-stage's selectedId
 *      state via the onSwitchPersona callback prop -- so the panel,
 *      the picker, the prechat fetch, and the embedded chat all
 *      re-key in sync. Falls back to a no-op when the callback is
 *      not supplied (preserves prior contract).
 *
 *   3. Pre-brief verdict callout. Uses lib/risk-band.ts to compute
 *      a deterministic risk band + suggested Care Router pathway
 *      from the same intake scores already in the dossier. Shows
 *      both as a callout between the dossier grid and the profile
 *      note. This is the clinically-actionable summary the
 *      clinician was previously only seeing one stage later on
 *      /demo/patient. Clicking the suggested-pathway label takes
 *      them straight to /demo/routing?personaId=... where they
 *      can run the live Anthropic-backed router for confirmation.
 */

export type PreBriefFields = Record<string, string>;

type Props = {
  persona: DemoPersona | undefined;
  status: "idle" | "loading" | "ready" | "error";
  fields?: PreBriefFields;
  identitySource?: "real" | "mock";
  groundingSource?: "real" | "mock";
  errorMessage?: string;
  /**
   * Optional callback invoked when the user clicks a switch-persona
   * chip in the compact picker row at the top of the panel. The
   * parent (intake-patient-stage) drives selectedId state so the
   * picker, the prechat fetch, and the embedded chat all re-key in
   * sync. When the callback is not supplied, the chip row is hidden
   * and the panel reverts to its prior single-persona contract.
   */
  onSwitchPersona?: (personaId: string) => void;
  /**
   * Whether to render the pre-brief verdict callout (risk band +
   * suggested Care Router pathway) at the bottom of the dossier
   * grid. Defaults to true. /demo/patient (Care Detail) passes
   * `showVerdict={false}` because it renders a dedicated, more
   * thorough risk-band card with gauge + axis flags + HRT
   * suitability immediately below the panel, and the duplicate
   * one-line verdict would be redundant.
   */
  showVerdict?: boolean;
  /**
   * The /demo/* page this panel is rendered on. Used by the
   * journey-shortcuts row to suppress the self-referential link
   * (you don't want an "Open Care Detail →" button on the Care
   * Detail page that just reloads the page). Optional -- when
   * omitted the panel shows all three shortcuts.
   */
  currentStage?: "intake" | "patient" | "routing" | "agent-fabric";
};

/**
 * Map a RiskBand to the matching CSS modifier class for the
 * existing .risk-band-badge--* style. Keeping this here (vs.
 * inlining the conditional in JSX) keeps the JSX legible.
 */
const RISK_BAND_CSS_MODIFIER: Record<
  "Low" | "Moderate" | "High" | "Critical",
  string
> = {
  Low: "low",
  Moderate: "moderate",
  High: "high",
  Critical: "critical"
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
  errorMessage,
  onSwitchPersona,
  showVerdict = true,
  currentStage
}: Props) {
  if (!persona) return null;

  const isReady = status === "ready" && fields !== undefined;
  const get = (key: string): string =>
    isReady ? safeText(fields![key]) : "—";

  // Deterministic pre-brief verdict, computed from the intake
  // scores the panel already displays. computeRisk + suggestedPathway
  // are pure functions that take the persona itself, so they're safe
  // to call unconditionally -- the verdict block just hides if
  // status !== "ready" so it doesn't appear above an unresolved
  // dossier.
  const risk = computeRisk(persona);
  const pathway = suggestedPathway(persona, risk);
  const pathwayDescriptor = describePathway(pathway.pathway);
  const personaQuery = `personaId=${encodeURIComponent(persona.id)}`;

  // Switch-persona chip row data. Hidden entirely when the parent
  // doesn't supply onSwitchPersona (preserves prior single-persona
  // contract for any consumer that just wants the dossier readout).
  const otherPersonas = onSwitchPersona
    ? DEMO_COHORT.filter((p) => p.id !== persona.id)
    : [];

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

      {/*
       * Journey shortcuts -- small CTAs that pivot the clinician
       * forward through the demo journey for THIS patient. Each
       * preserves ?personaId= so the destination page lands scoped
       * correctly. The Agentforce chat stays the main interaction;
       * these are just inline ways out. Self-referential stages
       * (e.g. "Open Care Detail" while already on Care Detail) are
       * suppressed via currentStage.
       */}
      {(() => {
        const shortcuts: Array<{
          stage: NonNullable<Props["currentStage"]>;
          href: string;
          label: string;
        }> = [
          {
            stage: "patient",
            href: `/demo/patient?${personaQuery}`,
            label: `Open Care Detail for ${persona.firstName} →`
          },
          {
            stage: "routing",
            href: `/demo/routing?${personaQuery}`,
            label: "Run Care Router →"
          },
          {
            stage: "agent-fabric",
            href: `/demo/agent-fabric?${personaQuery}`,
            label: `Inspect ${persona.firstName}'s spans →`
          }
        ];
        const visible = shortcuts.filter((s) => s.stage !== currentStage);
        if (visible.length === 0) return null;
        return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.45rem",
              marginTop: "0.7rem"
            }}
          >
            {visible.map((s) => (
              <a
                key={s.stage}
                href={s.href}
                className="btn btn-secondary"
                style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
              >
                {s.label}
              </a>
            ))}
          </div>
        );
      })()}

      {/*
       * Compact switch-persona picker. Lets the clinician flip
       * patients without scrolling back to the main picker card
       * at the top of the page. Hidden when the parent doesn't
       * pass onSwitchPersona.
       */}
      {otherPersonas.length > 0 && (
        <div
          role="group"
          aria-label="Switch demo patient"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            alignItems: "center",
            marginTop: "0.6rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid rgba(255,255,255,0.05)"
          }}
        >
          <span
            style={{
              fontSize: "0.78rem",
              color: "var(--muted)",
              marginRight: "0.2rem"
            }}
          >
            Switch patient:
          </span>
          {otherPersonas.map((other) => (
            <button
              key={other.id}
              type="button"
              onClick={() => onSwitchPersona!(other.id)}
              className="btn btn-secondary"
              style={{
                fontSize: "0.76rem",
                padding: "0.28rem 0.6rem"
              }}
              title={`${other.firstName} ${other.lastName} · ${other.ageBand} · ${other.cycleStatus} · ${other.primarySymptom}`}
            >
              {other.firstName}
            </button>
          ))}
        </div>
      )}

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

          {/*
           * Pre-brief verdict -- deterministic risk band +
           * suggested Care Router pathway, computed from the
           * intake scores already in the dossier above. This is
           * the same heuristic (lib/risk-band.ts) that powers
           * the Care Detail and Routing pages, so the clinician
           * sees a consistent verdict at every stage of the
           * journey. Clicking the suggested-pathway label opens
           * Routing with personaId preserved for confirmation
           * against the live Anthropic-backed router.
           *
           * Suppressed via showVerdict={false} on /demo/patient where
           * a dedicated, more thorough risk-band card sits right
           * below the panel.
           */}
          {showVerdict && (
          <section
            className="pre-brief-verdict"
            aria-label="Pre-brief verdict"
            style={{
              marginTop: "1rem",
              padding: "0.85rem 1rem",
              borderRadius: "0.7rem",
              border: "1px solid var(--line)",
              background: "rgba(25, 11, 22, 0.4)",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.9rem",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "0.7rem",
                alignItems: "center",
                flexWrap: "wrap"
              }}
            >
              <span
                className={`risk-band-badge risk-band-badge--${
                  RISK_BAND_CSS_MODIFIER[risk.band]
                }`}
                style={{ minWidth: "5.5rem", padding: "0.45rem 0.7rem" }}
              >
                <span className="risk-band-label">Risk band</span>
                <span className="risk-band-value">{risk.band}</span>
              </span>
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    fontWeight: 600
                  }}
                >
                  Suggested next
                </p>
                <p
                  style={{
                    margin: "0.15rem 0 0",
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "var(--text)",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}
                >
                  {pathway.pathwayLabel}
                  {pathwayDescriptor && (
                    <span
                      className={`routing-acuity-chip routing-acuity-chip--${pathwayDescriptor.acuity}`}
                    >
                      {pathwayDescriptor.acuity} · {pathwayDescriptor.target}
                    </span>
                  )}
                </p>
                <p
                  style={{
                    margin: "0.3rem 0 0",
                    fontSize: "0.82rem",
                    color: "var(--muted)",
                    maxWidth: "44ch"
                  }}
                >
                  {pathway.rationale} The live Anthropic-backed Care
                  Router may emit a different pathway once it sees the
                  full federated context — run it to confirm.
                </p>
              </div>
            </div>
            <a
              href={`/demo/routing?${personaQuery}`}
              className="btn btn-primary"
              style={{ fontSize: "0.82rem", padding: "0.45rem 0.85rem" }}
            >
              Confirm in Care Routing →
            </a>
          </section>
          )}

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
