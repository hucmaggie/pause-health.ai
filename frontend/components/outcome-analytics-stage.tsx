"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CARE_ROUTER_PATHWAYS } from "../lib/care-router-pathways";
import { DEMO_COHORT, findDemoPersona } from "../lib/demo-cohort";

/**
 * Outcome Analytics stage — the new /demo/analytics page body.
 *
 * Replaces the previous fully-static page (6 hardcoded cards
 * including ARR figures that belonged on /proposal/*) with a hybrid:
 *
 *   1. Live operational metrics (top strip)
 *      - Active Data 360 segments (count + total patients) from
 *        /api/data-360/segments
 *      - Care Router decisions (count + median duration) from
 *        /api/agent-fabric/traces filtered by agent
 *      - Federated grounding queries (count + p50 latency) from
 *        the same traces feed
 *      Every card carries a real/mock source badge.
 *
 *   2. Pathway distribution chart — CSS bar chart of pathway
 *      counts across recent Care Router decisions, shown against
 *      the six canonical pathways from lib/care-router-pathways.ts.
 *      Color-matched to the routing-acuity-chip palette so the
 *      same color = same severity tier across pages.
 *
 *   3. Segment activation table — the full Data 360 segment catalog
 *      from listSegments(), with activation chips per channel.
 *
 *   4. Outcome targets section — the old aspirational numbers
 *      (diagnostic accuracy, time-to-diagnosis, cost avoidance) are
 *      kept but clearly labeled "Aspirational target — not yet
 *      measured" so a reader can never confuse them for live KPIs.
 *      ARR / revenue cards removed entirely; they live on
 *      /proposal/* where they belong.
 *
 * Persona-aware filtering (added in the demo-polish pass):
 *
 * When the URL carries `?personaId=<id>` -- threaded in by the
 * shell nav from any other /demo/* page that's tracking a persona
 * -- the analytics stage filters the three trace-derived surfaces
 * by persona:
 *
 *   - Care Router decisions card  (filtered by span.attributes.personaId)
 *   - Federated grounding queries card  (same filter)
 *   - Pathway distribution chart  (same filter)
 *
 * The Data 360 segment count card, the segment activation table,
 * and the outcome targets section stay cohort-level because they
 * are not span-derived -- they describe population segments and
 * program targets, both inherently many-patient.
 *
 * A "Filtering by ..." banner sits above the cards when a persona
 * is set, with a Clear filter link that strips ?personaId= and
 * shows the cohort-wide view.
 */

type Segment = {
  id: string;
  name: string;
  description: string;
  patientCount: number;
  criteria: string;
  activatedTo: Array<"agentforce" | "agent-fabric" | "health-cloud" | "marketing-cloud">;
};

type SegmentsResponse = {
  meta: { _segmentCount: number; _totalPatients: number };
  segments: Segment[];
};

type TraceSpan = {
  id: string;
  taskId: string;
  agentId: string;
  operation: string;
  startedAt: string;
  durationMs?: number;
  status: "ok" | "error" | "in-progress";
  attributes?: Record<string, unknown>;
};

type TracesResponse = {
  traces: TraceSpan[];
};

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function p50(values: number[]): number | null {
  return median(values);
}

/**
 * Wrapper that satisfies Next.js's requirement to suspend
 * useSearchParams() consumers. The interesting logic lives in
 * OutcomeAnalyticsStageInner.
 */
export function OutcomeAnalyticsStage() {
  return (
    <Suspense fallback={<OutcomeAnalyticsLoadingSkeleton />}>
      <OutcomeAnalyticsStageInner />
    </Suspense>
  );
}

function OutcomeAnalyticsLoadingSkeleton() {
  return (
    <section className="analytics-strip">
      <article className="card analytics-card">
        <p className="analytics-card-value analytics-card-loading">Loading…</p>
      </article>
    </section>
  );
}

function OutcomeAnalyticsStageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const personaIdParam = searchParams.get("personaId");
  const filterPersona = personaIdParam
    ? findDemoPersona(personaIdParam) ?? null
    : null;
  const filterPersonaId = filterPersona?.id ?? null;

  const clearFilter = () => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete("personaId");
    const next = params.toString();
    router.replace(next ? `/demo/analytics?${next}` : "/demo/analytics", {
      scroll: false
    });
  };

  const [segState, setSegState] = useState<LoadState<SegmentsResponse>>({
    status: "loading"
  });
  const [traceState, setTraceState] = useState<LoadState<TracesResponse>>({
    status: "loading"
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data-360/segments", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SegmentsResponse;
        if (cancelled) return;
        setSegState({ status: "ready", data });
      } catch (err) {
        if (cancelled) return;
        setSegState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/agent-fabric/traces?limit=200", {
          cache: "no-store"
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as TracesResponse;
        if (cancelled) return;
        setTraceState({ status: "ready", data });
      } catch (err) {
        if (cancelled) return;
        setTraceState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }
    load();
    // Light polling so a freshly-triggered Care Router run from
    // /demo/routing shows up here within a few seconds.
    const handle = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  const computed = useMemo(() => {
    if (traceState.status !== "ready") {
      return null;
    }
    const traces = traceState.data.traces;

    // When a personaId filter is set, narrow to spans whose
    // attributes carry the matching personaId. The handoff at
    // /api/intake/route-to-care-router stamps personaId on the
    // intake, identity, grounding, and Care Router spans whenever
    // it's invoked from /demo/routing.
    const matchesPersona = (t: TraceSpan) =>
      filterPersonaId == null
        ? true
        : (t.attributes?.personaId as string | undefined) === filterPersonaId;

    const careRouter = traces.filter(
      (t) => t.agentId === "care-router-claude" && t.status === "ok"
    );
    const careRouterScoped = careRouter.filter(matchesPersona);

    const grounding = traces.filter(
      (t) => t.operation === "data360.grounding.federated-query"
    );
    const groundingScoped = grounding.filter(matchesPersona);

    const last24hThreshold = Date.now() - 24 * 60 * 60 * 1000;
    const careRouterLast24h = careRouterScoped.filter(
      (t) => new Date(t.startedAt).getTime() >= last24hThreshold
    );

    const careRouterDurations = careRouterScoped
      .map((t) => t.durationMs)
      .filter((d): d is number => typeof d === "number" && d > 0);
    const groundingDurations = groundingScoped
      .map((t) => {
        if (typeof t.durationMs === "number") return t.durationMs;
        const v = t.attributes?.durationMs;
        return typeof v === "number" ? v : null;
      })
      .filter((d): d is number => typeof d === "number" && d > 0);

    // Pathway distribution -- scoped to the persona filter when set.
    const pathwayCounts: Record<string, number> = {};
    for (const span of careRouterScoped) {
      const pw = span.attributes?.pathway;
      if (typeof pw === "string") {
        pathwayCounts[pw] = (pathwayCounts[pw] ?? 0) + 1;
      }
    }
    const totalCareRouter = careRouterScoped.length;

    // Real vs mock breakdown for grounding queries -- scoped to
    // the persona filter when set.
    const realGroundingCount = groundingScoped.filter(
      (t) => (t.attributes?._source as string | undefined) === "real"
    ).length;
    const mockGroundingCount = groundingScoped.length - realGroundingCount;

    return {
      careRouter: careRouterScoped,
      careRouterLast24h,
      careRouterMedianMs: median(careRouterDurations),
      grounding: groundingScoped,
      groundingP50Ms: p50(groundingDurations),
      pathwayCounts,
      totalCareRouter,
      realGroundingCount,
      mockGroundingCount,
      // Cohort-wide totals, kept around so the filter banner can
      // show "12 of 84 decisions" context when a persona is set.
      cohortTotalCareRouter: careRouter.length,
      cohortTotalGrounding: grounding.length
    };
  }, [traceState, filterPersonaId]);

  const segments = segState.status === "ready" ? segState.data.segments : [];
  const totalPatients =
    segState.status === "ready" ? segState.data.meta._totalPatients : null;

  return (
    <>
      {filterPersona ? (
        <article
          className="card"
          style={{
            marginBottom: "1rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.75rem",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
            <span className="pre-brief-source-badge pre-brief-source-badge--info">
              Persona filter
            </span>
            <strong style={{ fontSize: "1rem" }}>
              Filtering by {filterPersona.firstName} {filterPersona.lastName}
            </strong>
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              · {filterPersona.ageBand} · {filterPersona.cycleStatus} ·{" "}
              {filterPersona.primarySymptom}
            </span>
            {computed && computed.cohortTotalCareRouter > 0 && (
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                · {computed.totalCareRouter} of {computed.cohortTotalCareRouter}{" "}
                Care Router decisions in this session
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={clearFilter}
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
          >
            Clear filter
          </button>
        </article>
      ) : (
        <article
          className="card"
          style={{
            marginBottom: "1rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.75rem",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
            <span className="pre-brief-source-badge pre-brief-source-badge--info">
              No persona filter
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              Cohort-wide view across all{" "}
              {computed?.cohortTotalCareRouter ?? 0} Care Router decisions in
              this session. Filter by a persona to scope the cards + chart:
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {DEMO_COHORT.slice(0, 4).map((persona) => (
              <a
                key={persona.id}
                href={`/demo/analytics?personaId=${encodeURIComponent(persona.id)}`}
                className="btn btn-secondary"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }}
              >
                {persona.firstName}
              </a>
            ))}
          </div>
        </article>
      )}
      <section className="analytics-strip">
        <article className="card analytics-card">
          <div className="analytics-card-head">
            <p className="eyebrow">Live · Data 360</p>
            <span className="pre-brief-source-badge pre-brief-source-badge--mock">
              Source: mock
            </span>
          </div>
          <h3 className="analytics-card-title">Active segments</h3>
          {segState.status === "loading" ? (
            <p className="analytics-card-value analytics-card-loading">Loading…</p>
          ) : segState.status === "error" ? (
            <p className="analytics-card-value analytics-card-error">
              Failed to load
            </p>
          ) : (
            <>
              <p className="analytics-card-value">{segments.length}</p>
              <p className="analytics-card-detail">
                Across {totalPatients?.toLocaleString() ?? "?"} patients · activated
                to Agentforce, Agent Fabric, Health Cloud, Marketing Cloud.
              </p>
            </>
          )}
        </article>

        <article className="card analytics-card">
          <div className="analytics-card-head">
            <p className="eyebrow">Live · Agent Fabric</p>
            <span className="pre-brief-source-badge pre-brief-source-badge--real">
              Source: live spans
            </span>
          </div>
          <h3 className="analytics-card-title">Care Router decisions</h3>
          {traceState.status === "loading" ? (
            <p className="analytics-card-value analytics-card-loading">Loading…</p>
          ) : traceState.status === "error" ? (
            <p className="analytics-card-value analytics-card-error">
              Failed to load
            </p>
          ) : (
            <>
              <p className="analytics-card-value">
                {computed?.totalCareRouter ?? 0}
              </p>
              <p className="analytics-card-detail">
                {filterPersona
                  ? `Scoped to ${filterPersona.firstName} · `
                  : ""}
                {computed?.careRouterLast24h.length ?? 0} in last 24h ·{" "}
                {computed?.careRouterMedianMs != null
                  ? `median ${computed.careRouterMedianMs} ms`
                  : "no completed runs yet"}
                . Drive a new decision from{" "}
                <a
                  href={
                    filterPersona
                      ? `/demo/routing?personaId=${encodeURIComponent(filterPersona.id)}`
                      : "/demo/routing"
                  }
                >
                  /demo/routing
                </a>
                {filterPersona ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={`/demo/agent-fabric?personaId=${encodeURIComponent(filterPersona.id)}`}
                    >
                      view all of {filterPersona.firstName}&apos;s traces
                    </a>
                  </>
                ) : (
                  <>
                    {" "}
                    ·{" "}
                    <a href="/demo/agent-fabric">browse all traces</a>
                  </>
                )}
                .
              </p>
            </>
          )}
        </article>

        <article className="card analytics-card">
          <div className="analytics-card-head">
            <p className="eyebrow">Live · Data 360</p>
            {traceState.status === "ready" &&
            computed &&
            (computed.realGroundingCount > 0 || computed.mockGroundingCount > 0) ? (
              <span
                className={`pre-brief-source-badge ${
                  computed.realGroundingCount > 0
                    ? "pre-brief-source-badge--real"
                    : "pre-brief-source-badge--mock"
                }`}
              >
                {computed.realGroundingCount > 0
                  ? `${computed.realGroundingCount} real · ${computed.mockGroundingCount} mock`
                  : "Source: mock"}
              </span>
            ) : (
              <span className="pre-brief-source-badge pre-brief-source-badge--mock">
                Source: mock
              </span>
            )}
          </div>
          <h3 className="analytics-card-title">Federated grounding queries</h3>
          {traceState.status === "loading" ? (
            <p className="analytics-card-value analytics-card-loading">Loading…</p>
          ) : traceState.status === "error" ? (
            <p className="analytics-card-value analytics-card-error">
              Failed to load
            </p>
          ) : (
            <>
              <p className="analytics-card-value">
                {computed?.grounding.length ?? 0}
              </p>
              <p className="analytics-card-detail">
                {filterPersona
                  ? `Scoped to ${filterPersona.firstName} · `
                  : ""}
                {computed?.groundingP50Ms != null
                  ? `p50 ${computed.groundingP50Ms} ms`
                  : "no completed queries yet"}{" "}
                · sources: Salesforce Health Cloud, JupyterHealth FHIR,
                dbdp wearable, Agentforce intake.
                {filterPersona && (
                  <>
                    {" "}
                    <a
                      href={`/demo/agent-fabric?personaId=${encodeURIComponent(filterPersona.id)}`}
                    >
                      Inspect {filterPersona.firstName}&apos;s grounding
                      spans →
                    </a>
                  </>
                )}
              </p>
            </>
          )}
        </article>
      </section>

      <PathwayDistributionChart
        pathwayCounts={computed?.pathwayCounts ?? {}}
        totalDecisions={computed?.totalCareRouter ?? 0}
        loading={traceState.status === "loading"}
        scopedToPersonaName={
          filterPersona
            ? `${filterPersona.firstName} ${filterPersona.lastName}`
            : null
        }
      />

      <SegmentActivationTable
        segments={segments}
        loading={segState.status === "loading"}
      />

      <OutcomeTargetsSection />
    </>
  );
}

function PathwayDistributionChart({
  pathwayCounts,
  totalDecisions,
  loading,
  scopedToPersonaName
}: {
  pathwayCounts: Record<string, number>;
  totalDecisions: number;
  loading: boolean;
  scopedToPersonaName: string | null;
}) {
  const rows = CARE_ROUTER_PATHWAYS.map((p) => {
    const count = pathwayCounts[p.pathway] ?? 0;
    const pct = totalDecisions > 0 ? count / totalDecisions : 0;
    return { ...p, count, pct };
  });

  return (
    <article className="card analytics-pathway-chart" style={{ marginBottom: "1.25rem" }}>
      <header className="pre-brief-header">
        <div>
          <p className="eyebrow">Live · Care Router</p>
          <h3 style={{ margin: "0.1rem 0 0" }}>
            Pathway distribution
            {scopedToPersonaName ? ` · ${scopedToPersonaName}` : ""}
          </h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.88rem"
            }}
          >
            {scopedToPersonaName
              ? `Care Router decisions for ${scopedToPersonaName}, binned by emitted pathway. `
              : "Recent Care Router decisions binned by emitted pathway. "}
            Counts come from spans recorded by the Agent Fabric in this
            session; reset on server restart.
          </p>
        </div>
        <div className="pre-brief-source-badges">
          <span className="pre-brief-source-badge pre-brief-source-badge--real">
            n = {totalDecisions}
          </span>
        </div>
      </header>

      <div className="analytics-bar-chart" role="list" aria-label="Pathway distribution">
        {rows.map((row) => (
          <div
            key={row.pathway}
            role="listitem"
            className={`analytics-bar-row analytics-bar-row--${row.tone}`}
          >
            <div className="analytics-bar-label">
              <strong>{row.label}</strong>
              <span className={`routing-acuity-chip routing-acuity-chip--${row.acuity}`}>
                {row.acuity}
              </span>
            </div>
            <div className="analytics-bar-track">
              <div
                className={`analytics-bar-fill analytics-bar-fill--${row.tone}`}
                style={{
                  width:
                    totalDecisions === 0
                      ? "0%"
                      : `${Math.max(2, Math.round(row.pct * 100))}%`
                }}
              />
            </div>
            <div className="analytics-bar-count">
              <strong>{row.count}</strong>
              <span>
                {totalDecisions > 0 ? `${Math.round(row.pct * 100)}%` : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <p style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.85rem" }}>
          Loading spans from the Agent Fabric…
        </p>
      )}
      {!loading && totalDecisions === 0 && (
        <p
          style={{
            marginTop: "0.6rem",
            color: "var(--muted)",
            fontSize: "0.85rem"
          }}
        >
          {scopedToPersonaName
            ? `No Care Router decisions for ${scopedToPersonaName} recorded yet in this session. `
            : "No Care Router decisions recorded yet in this session. "}
          <a href="/demo/routing">Trigger one from /demo/routing</a> and watch
          this chart update.
        </p>
      )}
    </article>
  );
}

function SegmentActivationTable({
  segments,
  loading
}: {
  segments: Segment[];
  loading: boolean;
}) {
  const channelLabels: Record<Segment["activatedTo"][number], string> = {
    agentforce: "Agentforce",
    "agent-fabric": "Agent Fabric",
    "health-cloud": "Health Cloud",
    "marketing-cloud": "Marketing Cloud"
  };

  return (
    <article className="card" style={{ marginBottom: "1.25rem" }}>
      <header>
        <p className="eyebrow">Data 360 · Segment activation</p>
        <h3 style={{ margin: "0.1rem 0 0" }}>
          Active population segments ({segments.length})
        </h3>
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "var(--muted)",
            fontSize: "0.88rem"
          }}
        >
          Authored in the Salesforce Data 360 console; activation routes
          configured per segment. The Agent Fabric subscribes to
          membership events so proactive outreach can route without the
          patient ever opening intake.
        </p>
      </header>

      <div className="table-wrap" style={{ marginTop: "0.9rem" }}>
        <table className="routing-table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Criteria</th>
              <th>Patients</th>
              <th>Activated to</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  Loading segments…
                </td>
              </tr>
            )}
            {!loading &&
              segments.map((seg) => (
                <tr key={seg.id}>
                  <td>
                    <strong>{seg.name}</strong>
                    <p
                      style={{
                        margin: "0.2rem 0 0",
                        fontSize: "0.82rem",
                        color: "var(--muted)",
                        lineHeight: 1.45
                      }}
                    >
                      {seg.description}
                    </p>
                  </td>
                  <td>
                    <code
                      style={{
                        fontSize: "0.72rem",
                        color: "#d8a6c4",
                        lineHeight: 1.45
                      }}
                    >
                      {seg.criteria}
                    </code>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <strong>{seg.patientCount.toLocaleString()}</strong>
                  </td>
                  <td>
                    <div className="analytics-activation-chips">
                      {seg.activatedTo.map((channel) => (
                        <span key={channel} className="analytics-activation-chip">
                          {channelLabels[channel]}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function OutcomeTargetsSection() {
  const targets = [
    {
      label: "Diagnostic accuracy",
      value: "89%",
      detail:
        "Target vs. ~67% national misdiagnosis benchmark for menopause-pattern symptoms in primary care."
    },
    {
      label: "Time to first specialist contact",
      value: "2.5 y → < 30 d",
      detail:
        "Reduce time from first menopause-pattern symptom to first MSCP-credentialed clinician contact by >90%."
    },
    {
      label: "Patient satisfaction lift",
      value: "+34%",
      detail:
        "Pilot target across anchor provider systems vs. care-as-usual baseline."
    },
    {
      label: "Avoidable cost reduction per patient",
      value: "USD 1,685",
      detail:
        "Estimated waste avoided per patient from earlier accurate diagnosis (literature-derived)."
    }
  ];

  return (
    <article className="card" style={{ marginBottom: "1.25rem" }}>
      <header className="pre-brief-header">
        <div>
          <p className="eyebrow">Targets · not yet measured</p>
          <h3 style={{ margin: "0.1rem 0 0" }}>Outcome targets</h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.88rem"
            }}
          >
            What we&apos;re building Pause-Health.ai to deliver. These
            are program targets, not live KPIs — they will be measured
            against the deployed cohort during pilot.
          </p>
        </div>
        <div className="pre-brief-source-badges">
          <span className="pre-brief-source-badge pre-brief-source-badge--mock">
            Aspirational
          </span>
        </div>
      </header>

      <div
        className="demo-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", marginTop: "1rem" }}
      >
        {targets.map((t) => (
          <article key={t.label} className="analytics-target-card">
            <p className="analytics-target-label">{t.label}</p>
            <p className="analytics-target-value">{t.value}</p>
            <p className="analytics-target-detail">{t.detail}</p>
          </article>
        ))}
      </div>
    </article>
  );
}
