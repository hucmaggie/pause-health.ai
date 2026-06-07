"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  CARE_ROUTER_PATHWAYS,
  type CareRouterPathway
} from "../lib/care-router-pathways";
import {
  DEMO_COHORT,
  findDemoPersona,
  personaToCareRouterIntake,
  type DemoPersona
} from "../lib/demo-cohort";
import {
  computeRisk,
  suggestedPathway
} from "../lib/risk-band";

/**
 * Care Routing stage — the persona-aware /demo/routing page body.
 *
 * Replaces the static "Applied decision profile" card (which used to
 * contradict the live LatestCareRouterDecision card directly above
 * it) with a flow that's fully consistent with what the Care Router
 * actually does:
 *
 *   1. Persona picker (URL-sync'd via ?personaId=...)
 *   2. Suggested pathway preview — heuristic from lib/risk-band.ts
 *      that maps the persona's intake scores to one of the six real
 *      Care Router pathways. Honest about being a heuristic.
 *   3. Run Care Router button — POSTs the persona's intake to
 *      /api/intake/route-to-care-router and surfaces the live
 *      Anthropic-backed decision, including the agent-fabric trace
 *      link.
 *   4. Routing matrix from the single source of truth in
 *      lib/care-router-pathways.ts (six rows = real router enum).
 *      Highlights the row that matches the most recent live decision
 *      OR the suggested heuristic.
 */

type CareRouterRunState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      taskId: string;
      pathway: CareRouterPathway | string;
      acuity: string;
      _identitySource: "real" | "mock";
      _groundingSource: "real" | "mock";
    }
  | { status: "error"; message: string };

type CareRouterDecisionResponse = {
  meta: {
    _taskId: string;
    _data360IdentitySource: "real" | "mock";
    _data360GroundingSource: "real" | "mock";
  };
  taskId: string;
  decision: {
    pathway?: CareRouterPathway;
    acuity?: string;
  } | null;
};

const DEFAULT_PERSONA_ID = DEMO_COHORT[0]?.id ?? "anika-patel";

function CareRoutingStageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPersonaId = searchParams.get("personaId");

  const [selectedId, setSelectedId] = useState<string>(
    findDemoPersona(urlPersonaId ?? "")?.id ?? DEFAULT_PERSONA_ID
  );
  const [runState, setRunState] = useState<CareRouterRunState>({ status: "idle" });

  // Sync selectedId -> URL
  useEffect(() => {
    const current = searchParams.get("personaId");
    if (current === selectedId) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("personaId", selectedId);
    router.replace(`/demo/routing?${params.toString()}`, { scroll: false });
  }, [selectedId, searchParams, router]);

  // Reset run state on persona change so the surfaced decision always
  // matches the picker.
  useEffect(() => {
    setRunState({ status: "idle" });
  }, [selectedId]);

  const selectedPersona: DemoPersona | undefined = useMemo(
    () => findDemoPersona(selectedId) ?? undefined,
    [selectedId]
  );

  const risk = useMemo(
    () => (selectedPersona ? computeRisk(selectedPersona) : null),
    [selectedPersona]
  );
  const heuristicPathway = useMemo(
    () => (selectedPersona && risk ? suggestedPathway(selectedPersona, risk) : null),
    [selectedPersona, risk]
  );

  // Highlighted row in the matrix: prefer the live decision when we
  // have one for the currently-selected persona; otherwise the
  // heuristic suggestion.
  const highlightedPathway: CareRouterPathway | string | null = (() => {
    if (runState.status === "done") return runState.pathway;
    if (heuristicPathway) return heuristicPathway.pathway;
    return null;
  })();

  const runCareRouter = useCallback(async () => {
    if (!selectedPersona) return;
    setRunState({ status: "running" });
    try {
      const intake = personaToCareRouterIntake(selectedPersona);
      const res = await fetch("/api/intake/route-to-care-router", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // personaId rides along so the intake span (and downstream
        // identity / grounding / a2a.tasks/send spans correlated to
        // the same taskId) can be filtered by persona on
        // /demo/analytics. The server route ignores the field if
        // unset, so non-demo callers keep working unchanged.
        body: JSON.stringify({ intake, personaId: selectedPersona.id })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as CareRouterDecisionResponse;
      const pathway =
        payload.decision?.pathway ??
        (heuristicPathway ? heuristicPathway.pathway : "self-care-tracking");
      const acuity = payload.decision?.acuity ?? "routine";
      setRunState({
        status: "done",
        taskId: payload.taskId,
        pathway,
        acuity,
        _identitySource: payload.meta._data360IdentitySource,
        _groundingSource: payload.meta._data360GroundingSource
      });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, [selectedPersona, heuristicPathway]);

  return (
    <>
      <article
        className="card"
        aria-label="View routing as patient"
        style={{ marginBottom: "1rem" }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p className="eyebrow">Care routing · view as</p>
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

      {selectedPersona && heuristicPathway && (
        <article
          className="card routing-decision-card"
          aria-label="Suggested pathway and Care Router invocation"
          style={{ marginBottom: "1.25rem" }}
        >
          <header className="pre-brief-header">
            <div>
              <p className="eyebrow">Suggested pathway · pre-router heuristic</p>
              <h3 style={{ margin: "0.1rem 0 0" }}>{heuristicPathway.pathwayLabel}</h3>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  color: "var(--muted)",
                  fontSize: "0.88rem"
                }}
              >
                {heuristicPathway.rationale}
              </p>
              <p
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.78rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                heuristic.pathway = {heuristicPathway.pathway}
                {risk ? ` · burden = ${risk.index}/30 · band = ${risk.band}` : ""}
              </p>
            </div>
          </header>

          <div
            style={{
              marginTop: "1rem",
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={runCareRouter}
              disabled={runState.status === "running"}
            >
              {runState.status === "running"
                ? "Running Care Router…"
                : "Run Anthropic-backed Care Router"}
            </button>
            {runState.status === "done" && (
              <a
                href={`/demo/agent-fabric?taskId=${encodeURIComponent(runState.taskId)}`}
                className="btn btn-secondary"
              >
                View multi-agent trace →
              </a>
            )}
            <a
              href={`/demo/patient?personaId=${encodeURIComponent(selectedId)}`}
              className="btn btn-secondary"
            >
              Back to Care Detail
            </a>
          </div>

          {runState.status === "running" && (
            <p
              style={{
                marginTop: "0.8rem",
                color: "var(--muted)",
                fontSize: "0.88rem"
              }}
            >
              Submitting the intake to the Care Router via A2A. Threading
              spans into the Pause Agent Fabric…
            </p>
          )}

          {runState.status === "error" && (
            <p
              role="alert"
              style={{
                marginTop: "0.8rem",
                color: "#ffb6c8",
                fontSize: "0.88rem"
              }}
            >
              Care Router run failed: {runState.message}.
            </p>
          )}

          {runState.status === "done" && (
            <div className="routing-live-result">
              <div className="pre-brief-source-badges" style={{ marginBottom: "0.5rem" }}>
                <span
                  className={`pre-brief-source-badge ${
                    runState._identitySource === "real"
                      ? "pre-brief-source-badge--real"
                      : "pre-brief-source-badge--mock"
                  }`}
                >
                  Identity: {runState._identitySource}
                </span>
                <span
                  className={`pre-brief-source-badge ${
                    runState._groundingSource === "real"
                      ? "pre-brief-source-badge--real"
                      : "pre-brief-source-badge--mock"
                  }`}
                >
                  Grounding: {runState._groundingSource}
                </span>
              </div>
              <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
                Live Care Router decision
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "var(--text)"
                }}
              >
                {labelFor(runState.pathway)}
              </p>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  color: "var(--muted)",
                  fontSize: "0.85rem"
                }}
              >
                Acuity: {runState.acuity} · Target response:{" "}
                {targetFor(runState.pathway)}
              </p>
              <p
                style={{
                  margin: "0.4rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                router.pathway = {runState.pathway} · task = {runState.taskId}
              </p>
              {heuristicPathway && runState.pathway !== heuristicPathway.pathway && (
                <p
                  style={{
                    margin: "0.6rem 0 0",
                    padding: "0.5rem 0.7rem",
                    border: "1px solid rgba(255, 200, 110, 0.45)",
                    background: "rgba(255, 200, 110, 0.08)",
                    color: "#ffd28a",
                    fontSize: "0.85rem",
                    borderRadius: "0.5rem"
                  }}
                >
                  Heuristic differed: the pre-router heuristic suggested{" "}
                  <strong>{heuristicPathway.pathwayLabel}</strong>; the live
                  router chose <strong>{labelFor(runState.pathway)}</strong>.
                  This is expected — the live router has the full Data 360
                  grounding the heuristic doesn&apos;t see.
                </p>
              )}
            </div>
          )}
        </article>
      )}

      <RoutingMatrixCard highlightedPathway={highlightedPathway} />
    </>
  );
}

function labelFor(p: string): string {
  return (
    CARE_ROUTER_PATHWAYS.find((d) => d.pathway === p)?.label ?? p
  );
}
function targetFor(p: string): string {
  return (
    CARE_ROUTER_PATHWAYS.find((d) => d.pathway === p)?.target ?? ""
  );
}

function RoutingMatrixCard({
  highlightedPathway
}: {
  highlightedPathway: CareRouterPathway | string | null;
}) {
  return (
    <article
      className="card"
      aria-label="Care routing pathway matrix"
      style={{ marginBottom: "1.25rem" }}
    >
      <header>
        <p className="eyebrow">Care routing matrix</p>
        <h3 style={{ margin: "0.1rem 0 0" }}>The six pathways the Care Router emits</h3>
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "var(--muted)",
            fontSize: "0.88rem"
          }}
        >
          Single source of truth lives in{" "}
          <code>lib/care-router-pathways.ts</code>. The live decision
          card above, the suggested-pathway heuristic, and this matrix
          all read from it so they can&apos;t drift.
        </p>
      </header>
      <div className="table-wrap" style={{ marginTop: "0.9rem" }}>
        <table className="routing-table">
          <thead>
            <tr>
              <th>Care pathway</th>
              <th>Triage trigger</th>
              <th>Target response</th>
              <th>Acuity</th>
            </tr>
          </thead>
          <tbody>
            {CARE_ROUTER_PATHWAYS.map((p) => {
              const isHighlighted = p.pathway === highlightedPathway;
              return (
                <tr
                  key={p.pathway}
                  className={`routing-matrix-row routing-matrix-row--${p.tone} ${
                    isHighlighted ? "routing-matrix-row--highlighted" : ""
                  }`}
                >
                  <td>
                    <strong>{p.label}</strong>
                    {isHighlighted && (
                      <span className="routing-matrix-highlight-pill">
                        suggested
                      </span>
                    )}
                    <p
                      style={{
                        margin: "0.15rem 0 0",
                        fontSize: "0.72rem",
                        color: "var(--muted)",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace"
                      }}
                    >
                      {p.pathway}
                    </p>
                  </td>
                  <td>{p.trigger}</td>
                  <td>{p.target}</td>
                  <td>
                    <span className={`routing-acuity-chip routing-acuity-chip--${p.acuity}`}>
                      {p.acuity}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function CareRoutingStage() {
  return (
    <Suspense
      fallback={
        <p style={{ color: "var(--muted)" }}>Loading care routing stage…</p>
      }
    >
      <CareRoutingStageInner />
    </Suspense>
  );
}
