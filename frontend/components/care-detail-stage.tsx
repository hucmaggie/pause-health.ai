"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PreBriefPanel } from "./pre-brief-panel";
import {
  DEMO_COHORT,
  type DemoPersona,
  findDemoPersona
} from "../lib/demo-cohort";
import {
  computeRisk,
  hrtSuitability,
  suggestedPathway
} from "../lib/risk-band";

/**
 * Care Detail stage — the persona-aware /demo/patient page.
 *
 * Replaces the earlier static "T. Ramirez" placeholder (a patient who
 * doesn't exist anywhere else in the prototype) with a live,
 * cohort-aware Care Detail view. The page reads `?personaId=<id>` from
 * the URL, falls back to the first persona, and renders:
 *
 *   1. Persona picker (same six buttons as /demo/intake), URL-sync'd
 *   2. <PreBriefPanel> with the live Data 360 dossier
 *   3. Grounding Detail card — calculated insights + longitudinal
 *      observations + federation provenance (federatedFrom chips,
 *      sourcesQueried, durationMs)
 *   4. Risk + Pathway card — deterministic risk band from
 *      vasomotor/sleep/mood, suggested Care Router pathway, HRT
 *      suitability heuristic. All three are computed by pure
 *      functions in lib/risk-band.ts so the logic is inspectable.
 *
 * The "Continue to Routing" CTA carries the personaId forward so the
 * routing page (when it gets its own rebuild) can mirror the same
 * patient context.
 */

type PrechatFields = Record<string, string>;

type PrechatState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      fields: PrechatFields;
      identitySource: "real" | "mock";
      groundingSource: "real" | "mock";
    }
  | { status: "error"; message: string };

type GroundingMeta = {
  _source: "real" | "mock";
  _salesforceConfigured: boolean;
  _note: string;
};

type Insight = {
  id: string;
  name: string;
  description: string;
  value: number | string;
  unit?: string;
  computedAt: string;
  sourceWindow: string;
  federatedFrom: string[];
};

type Longitudinal = {
  id: string;
  loinc: string;
  display: string;
  effectiveDate: string;
  value: number;
  unit: string;
  trend?: "improving" | "stable" | "worsening";
  source: string;
};

type Grounding = {
  unifiedPatientId: string;
  identityResolution: {
    confidence: number;
    matchedSources: string[];
    resolutionRuleset: string;
  };
  calculatedInsights: Insight[];
  longitudinalObservations: Longitudinal[];
  recentIntakeCount: number;
  lastClinicianContact: { daysAgo: number; clinicianType: string };
  cohortComparison: {
    cohortName: string;
    cohortSize: number;
    patientPercentile: number;
    metric: string;
  };
  groundingProvenance: {
    federatedQuery: string;
    durationMs: number;
    sourcesQueried: string[];
    computedInsightsCount: number;
  };
};

type GroundingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; meta: GroundingMeta; grounding: Grounding }
  | { status: "error"; message: string };

const DEFAULT_PERSONA_ID = DEMO_COHORT[0]?.id ?? "anika-patel";

function CareDetailStageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPersonaId = searchParams.get("personaId");

  const [selectedId, setSelectedId] = useState<string>(
    findDemoPersona(urlPersonaId ?? "")?.id ?? DEFAULT_PERSONA_ID
  );
  const [prechat, setPrechat] = useState<PrechatState>({ status: "idle" });
  const [grounding, setGrounding] = useState<GroundingState>({ status: "idle" });

  // Sync selectedId -> URL (replace, not push, so back-button isn't
  // polluted with every persona click).
  useEffect(() => {
    const current = searchParams.get("personaId");
    if (current === selectedId) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("personaId", selectedId);
    router.replace(`/demo/patient?${params.toString()}`, { scroll: false });
  }, [selectedId, searchParams, router]);

  // Fetch prechat-context (drives the PreBriefPanel)
  useEffect(() => {
    let cancelled = false;
    setPrechat({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/intake/prechat-context?personaId=${encodeURIComponent(selectedId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(`prechat-context HTTP ${res.status}`);
        }
        const payload = (await res.json()) as {
          prechatFields: PrechatFields;
          meta: {
            _identitySource: "real" | "mock";
            _groundingSource: "real" | "mock";
          };
        };
        if (cancelled) return;
        setPrechat({
          status: "ready",
          fields: payload.prechatFields,
          identitySource: payload.meta._identitySource,
          groundingSource: payload.meta._groundingSource
        });
      } catch (err) {
        if (cancelled) return;
        setPrechat({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Fetch grounding (drives the GroundingDetailCard)
  useEffect(() => {
    let cancelled = false;
    setGrounding({ status: "loading" });
    const persona = findDemoPersona(selectedId);
    if (!persona) {
      setGrounding({ status: "error", message: "Persona not found" });
      return;
    }
    // The grounding API takes the data-360 patient id; for now we use
    // the demo patient id which the api falls back to for non-real
    // lookups. Hints come from the persona so the mock path can
    // produce shape-equivalent content.
    const qs = new URLSearchParams({
      ageBand: persona.ageBand,
      primarySymptom: persona.primarySymptom,
      cycleStatus: persona.cycleStatus
    });
    // We need to use the unifiedPatientId resolved upstream — fetch
    // prechat-context first then use its Patient_Id, OR call the
    // /api/data-360 endpoint directly with the demo patient id and
    // rely on the API's preferReal logic. Simplest: call with the
    // resolved Patient_Id once prechat has it. To keep the UI snappy,
    // we kick off this fetch in parallel using the demo id and let
    // the API resolve via persona hints (which is how the mock path
    // works anyway).
    (async () => {
      try {
        // If prechat returned a real Patient_Id, prefer it; otherwise
        // use the demo patient id. We use a lazy reference into the
        // most-recent prechat state. (Reading state captured at this
        // effect run is fine; if prechat changes we'll re-run.)
        const patientIdForGrounding = "pause-demo-patient-001";
        const res = await fetch(
          `/api/data-360/patient/${encodeURIComponent(patientIdForGrounding)}/grounding?${qs.toString()}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(`grounding HTTP ${res.status}`);
        }
        const payload = (await res.json()) as {
          meta: GroundingMeta;
          grounding: Grounding;
        };
        if (cancelled) return;
        setGrounding({
          status: "ready",
          meta: payload.meta,
          grounding: payload.grounding
        });
      } catch (err) {
        if (cancelled) return;
        setGrounding({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedPersona: DemoPersona | undefined = useMemo(
    () => findDemoPersona(selectedId) ?? undefined,
    [selectedId]
  );

  const risk = useMemo(
    () => (selectedPersona ? computeRisk(selectedPersona) : null),
    [selectedPersona]
  );
  const pathway = useMemo(
    () => (selectedPersona && risk ? suggestedPathway(selectedPersona, risk) : null),
    [selectedPersona, risk]
  );
  const hrt = useMemo(
    () => (selectedPersona ? hrtSuitability(selectedPersona) : null),
    [selectedPersona]
  );

  return (
    <>
      <article
        className="card"
        aria-label="View care detail for patient"
        style={{ marginBottom: "1rem" }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p className="eyebrow">Care detail · view as</p>
          <h3 style={{ margin: 0 }}>
            {selectedPersona
              ? `${selectedPersona.firstName} ${selectedPersona.lastName}`
              : "Select a demo patient"}
          </h3>
          {selectedPersona && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.92rem" }}>
              {selectedPersona.ageBand} · {selectedPersona.cycleStatus} ·{" "}
              primary symptom <strong>{selectedPersona.primarySymptom}</strong>
              {" · "}intake scores V{selectedPersona.vasomotorScore}/S
              {selectedPersona.sleepScore}/M{selectedPersona.moodScore}
            </p>
          )}
        </header>

        <div
          role="radiogroup"
          aria-label="Demo patient picker"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginTop: "0.8rem"
          }}
        >
          {DEMO_COHORT.map((persona) => {
            const isSelected = persona.id === selectedId;
            return (
              <button
                key={persona.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedId(persona.id)}
                className={isSelected ? "btn btn-primary" : "btn btn-secondary"}
                style={{
                  fontSize: "0.92rem",
                  padding: "0.45rem 0.8rem"
                }}
              >
                {persona.firstName} {persona.lastName}
              </button>
            );
          })}
        </div>
      </article>

      <PreBriefPanel
        persona={selectedPersona}
        status={prechat.status}
        fields={prechat.status === "ready" ? prechat.fields : undefined}
        identitySource={
          prechat.status === "ready" ? prechat.identitySource : undefined
        }
        groundingSource={
          prechat.status === "ready" ? prechat.groundingSource : undefined
        }
        errorMessage={
          prechat.status === "error" ? prechat.message : undefined
        }
        // Care Detail has its own dedicated risk-band card (gauge,
        // axis flags, HRT suitability) immediately below this panel,
        // so suppress the panel's compact verdict callout to avoid
        // showing the same band twice.
        showVerdict={false}
        // Drive Care Detail's selectedId from the compact picker
        // so the picker, dossier, risk card, and pathway card all
        // re-key in sync. URL personaId stays accurate (see the
        // selectedId -> URL sync useEffect above).
        onSwitchPersona={setSelectedId}
        currentStage="patient"
      />

      {selectedPersona && risk && pathway && hrt && (
        <article
          className="card risk-pathway-card"
          aria-label="Clinical risk assessment and pathway"
          style={{ marginBottom: "1.25rem" }}
        >
          <header style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <p className="eyebrow">Clinical risk + pathway</p>
            <h3 style={{ margin: 0 }}>Risk assessment</h3>
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontSize: "0.88rem"
              }}
            >
              Deterministic from intake scores (lib/risk-band.ts). In
              production this is replaced by the Data 360 Calculated
              Insight <code>menopause_burden_index_30d</code> and the
              Care Router&apos;s acuity policy.
            </p>
          </header>

          <div className="risk-band-row">
            <div
              className={`risk-band-badge risk-band-badge--${risk.band.toLowerCase()}`}
            >
              <span className="risk-band-label">Band</span>
              <strong className="risk-band-value">{risk.band}</strong>
            </div>
            <div className="risk-band-gauge-wrap" aria-hidden="true">
              <div className="risk-band-gauge-track">
                <div
                  className={`risk-band-gauge-fill risk-band-gauge-fill--${risk.band.toLowerCase()}`}
                  style={{
                    width: `${Math.round(risk.indexNormalized * 100)}%`
                  }}
                />
              </div>
              <div className="risk-band-gauge-scale">
                <span>Low</span>
                <span>Moderate</span>
                <span>High</span>
                <span>Critical</span>
              </div>
            </div>
            <div className="risk-band-index">
              <span className="risk-band-label">Burden index</span>
              <strong className="risk-band-value">{risk.index} / 30</strong>
            </div>
          </div>

          <p className="risk-band-rationale">{risk.rationale}</p>

          {risk.axisFlags.length > 0 && (
            <ul className="risk-axis-flags">
              {risk.axisFlags.map((flag) => (
                <li
                  key={flag.axis}
                  className={`risk-axis-flag risk-axis-flag--${flag.level}`}
                >
                  <strong>{flag.axis}</strong>
                  <span>
                    {flag.score}/10 · {flag.level}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="risk-pathway-grid">
            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">Suggested pathway</h4>
              <p className="risk-pathway-label">{pathway.pathwayLabel}</p>
              <p className="risk-pathway-rationale">{pathway.rationale}</p>
              <p
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.78rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                pathway = {pathway.pathway}
              </p>
            </section>
            <section className="pre-brief-section">
              <h4 className="pre-brief-section-title">HRT suitability</h4>
              <p className="risk-pathway-label">{hrt.label}</p>
              <p className="risk-pathway-rationale">{hrt.detail}</p>
            </section>
          </div>

          {/*
           * "Continue to Routing" / "Back to Intake" CTAs moved to
           * the shared <PersonaJourneyFooter stage="patient" />
           * mounted at the bottom of /demo/patient so the
           * next-stage affordance is consistent across pages.
           */}
        </article>
      )}

      <GroundingDetailCard state={grounding} />
    </>
  );
}

function GroundingDetailCard({ state }: { state: GroundingState }) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <article className="card" style={{ marginBottom: "1.25rem" }}>
        <p className="eyebrow">Data 360 federated grounding</p>
        <p style={{ color: "var(--muted)", margin: "0.4rem 0 0" }}>
          Querying federated sources…
        </p>
      </article>
    );
  }

  if (state.status === "error") {
    return (
      <article className="card" style={{ marginBottom: "1.25rem" }}>
        <p className="eyebrow">Data 360 federated grounding</p>
        <p
          role="alert"
          style={{ color: "#ffb6c8", margin: "0.4rem 0 0", fontSize: "0.9rem" }}
        >
          Failed to load grounding: {state.message}
        </p>
      </article>
    );
  }

  const { grounding, meta } = state;
  const isReal = meta._source === "real";

  return (
    <article
      className="card grounding-card"
      aria-label="Data 360 federated grounding"
      style={{ marginBottom: "1.25rem" }}
    >
      <header className="pre-brief-header">
        <div>
          <p className="eyebrow">Data 360 federated grounding</p>
          <h3 style={{ margin: "0.1rem 0 0" }}>Calculated insights & longitudinal signals</h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.88rem"
            }}
          >
            {meta._note}
          </p>
        </div>
        <div className="pre-brief-source-badges">
          <span
            className={`pre-brief-source-badge ${
              isReal
                ? "pre-brief-source-badge--real"
                : "pre-brief-source-badge--mock"
            }`}
          >
            Federation: {meta._source}
          </span>
        </div>
      </header>

      <div className="grounding-detail-grid">
        <section className="pre-brief-section">
          <h4 className="pre-brief-section-title">
            Calculated insights ({grounding.calculatedInsights.length})
          </h4>
          {grounding.calculatedInsights.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>
              No calculated insights available for this patient yet.
            </p>
          ) : (
            <ul className="grounding-insight-list">
              {grounding.calculatedInsights.map((insight) => (
                <li key={insight.id} className="grounding-insight-row">
                  <div className="grounding-insight-headline">
                    <span className="grounding-insight-name">{insight.name}</span>
                    <strong className="grounding-insight-value">
                      {String(insight.value)}
                      {insight.unit ? ` ${insight.unit}` : ""}
                    </strong>
                  </div>
                  <p className="grounding-insight-desc">{insight.description}</p>
                  <div className="grounding-insight-sources">
                    {insight.federatedFrom.map((src) => (
                      <span key={src} className="grounding-source-chip">
                        {src}
                      </span>
                    ))}
                    <span className="grounding-source-window">
                      window: {insight.sourceWindow}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pre-brief-section">
          <h4 className="pre-brief-section-title">
            Longitudinal observations ({grounding.longitudinalObservations.length})
          </h4>
          {grounding.longitudinalObservations.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>
              No longitudinal observations available.
            </p>
          ) : (
            <ul className="grounding-obs-list">
              {grounding.longitudinalObservations.map((obs) => (
                <li key={obs.id} className="grounding-obs-row">
                  <div className="grounding-obs-headline">
                    <span className="grounding-obs-name">{obs.display}</span>
                    <strong className="grounding-obs-value">
                      {obs.value}
                      {obs.unit ? ` ${obs.unit}` : ""}
                      {obs.trend && (
                        <span
                          className={`grounding-obs-trend grounding-obs-trend--${obs.trend}`}
                        >
                          {obs.trend === "improving"
                            ? "↘"
                            : obs.trend === "worsening"
                            ? "↗"
                            : "→"}{" "}
                          {obs.trend}
                        </span>
                      )}
                    </strong>
                  </div>
                  <div className="grounding-obs-meta">
                    <span className="grounding-source-chip">{obs.source}</span>
                    <span>LOINC {obs.loinc}</span>
                    <span>{new Date(obs.effectiveDate).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grounding-provenance">
        <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
          Provenance
        </p>
        <ul>
          <li>
            <span>Sources queried</span>
            <strong>
              {grounding.groundingProvenance.sourcesQueried.join(", ")}
            </strong>
          </li>
          <li>
            <span>Federated query duration</span>
            <strong>{grounding.groundingProvenance.durationMs} ms</strong>
          </li>
          <li>
            <span>Insights computed</span>
            <strong>
              {grounding.groundingProvenance.computedInsightsCount}
            </strong>
          </li>
          <li>
            <span>Recent intakes (30d)</span>
            <strong>{grounding.recentIntakeCount}</strong>
          </li>
          <li>
            <span>Last clinician contact</span>
            <strong>
              {grounding.lastClinicianContact.daysAgo} days ago ·{" "}
              {grounding.lastClinicianContact.clinicianType}
            </strong>
          </li>
        </ul>
      </div>
    </article>
  );
}

export function CareDetailStage() {
  return (
    <Suspense
      fallback={
        <p style={{ color: "var(--muted)" }}>Loading care detail…</p>
      }
    >
      <CareDetailStageInner />
    </Suspense>
  );
}
