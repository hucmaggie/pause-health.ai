"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DemoShell } from "../../../components/demo-shell";
import { PersonaJourneyFooter } from "../../../components/persona-journey-footer";
import {
  DEMO_COHORT,
  findDemoPersona,
  type DemoPersona
} from "../../../lib/demo-cohort";

type AgentRecord = {
  id: string;
  name: string;
  kind: string;
  protocol: "a2a" | "mcp" | "rest";
  endpoint: string;
  version: string;
  status: string;
  capabilities: string[];
  policies: string[];
  provider: string;
  governanceTier: string;
};

type PolicyRecord = {
  id: string;
  name: string;
  description: string;
  appliesTo: string[];
  enforcement: "block" | "audit" | "rate-limit" | "redact";
  status: "enforced" | "advisory" | "draft";
};

type TraceSpan = {
  id: string;
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  agentName: string;
  operation: string;
  protocol: "a2a" | "mcp" | "rest" | "internal";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "ok" | "error" | "in-progress";
  attributes?: Record<string, unknown>;
};

const TEST_INTAKES: Record<string, Record<string, string>> = {
  "Moderate vasomotor (typical case)": {
    preferredName: "Test",
    ageBand: "46-50",
    cycleStatus: "irregular",
    primarySymptom: "hot_flashes",
    severity: "moderate",
    redFlagsAcknowledged: "none"
  },
  "Severe mood + safety flag (escalate)": {
    preferredName: "Test",
    ageBand: "51-55",
    cycleStatus: "irregular",
    primarySymptom: "mood",
    severity: "severe",
    redFlagsAcknowledged: "yes"
  },
  "Unexpected bleeding (urgent)": {
    preferredName: "Test",
    ageBand: "56-60",
    cycleStatus: "stopped>=12mo",
    primarySymptom: "bleeding",
    severity: "moderate",
    redFlagsAcknowledged: "none"
  },
  "<40 with menopause symptoms (POI rule)": {
    preferredName: "Test",
    ageBand: "<40",
    cycleStatus: "irregular",
    primarySymptom: "hot_flashes",
    severity: "moderate",
    redFlagsAcknowledged: "none"
  }
};

function AgentFabricConsoleInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get("taskId") ?? "";
  const personaIdParam = searchParams.get("personaId");
  const filterPersona: DemoPersona | null = personaIdParam
    ? findDemoPersona(personaIdParam) ?? null
    : null;
  const filterPersonaId = filterPersona?.id ?? null;

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>(initialTaskId);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);
  // Map of taskId -> personaId, derived from a recent-spans sweep on
  // every poll. Used both to filter the Recent tasks chip row when
  // ?personaId= is set, and to auto-advance the active task to the
  // most recent matching one when the filter changes.
  const [taskIdToPersonaId, setTaskIdToPersonaId] = useState<
    Record<string, string>
  >({});
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const updatePersonaFilter = useCallback(
    (nextPersonaId: string | null) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (nextPersonaId) params.set("personaId", nextPersonaId);
      else params.delete("personaId");
      const next = params.toString();
      router.replace(
        next ? `/demo/agent-fabric?${next}` : "/demo/agent-fabric",
        { scroll: false }
      );
    },
    [router, searchParams]
  );

  const fetchAgents = useCallback(async () => {
    const r = await fetch("/api/agent-fabric/agents", { cache: "no-store" });
    const d = await r.json();
    setAgents(d.agents ?? []);
  }, []);

  const fetchPolicies = useCallback(async () => {
    const r = await fetch("/api/agent-fabric/policies", { cache: "no-store" });
    const d = await r.json();
    setPolicies(d.policies ?? []);
  }, []);

  const fetchRecentTaskIds = useCallback(async () => {
    // Two-pass fetch:
    //   1. /api/agent-fabric/traces -> ordered recentTaskIds
    //   2. /api/agent-fabric/traces?limit=200 -> recent spans, so we
    //      can build the taskId -> personaId map. The handoff route
    //      stamps attributes.personaId on every span when the run
    //      was triggered from /demo/routing (or via the "Run a test
    //      case" buttons below when a persona filter is active).
    //
    // Running these in parallel keeps the poll-tick latency similar
    // to the previous single-fetch version.
    const [idsRes, spansRes] = await Promise.all([
      fetch("/api/agent-fabric/traces", { cache: "no-store" }),
      fetch("/api/agent-fabric/traces?limit=200", { cache: "no-store" })
    ]);
    const idsData = await idsRes.json();
    const spansData = await spansRes.json();
    const ids = (idsData.recentTaskIds ?? []) as string[];
    const recentSpans = (spansData.traces ?? []) as TraceSpan[];

    // Build the map. The first span per task that carries
    // attributes.personaId wins; if no span on a task carries one
    // (e.g. a "Run a test case" run with no filter active), the task
    // simply doesn't appear in the map and is treated as
    // unattributable for filtering purposes.
    const nextMap: Record<string, string> = {};
    for (const span of recentSpans) {
      const pid = span.attributes?.personaId;
      if (typeof pid === "string" && pid.length > 0 && !nextMap[span.taskId]) {
        nextMap[span.taskId] = pid;
      }
    }
    setTaskIdToPersonaId(nextMap);
    setRecentTaskIds(ids);
    if (!activeTaskId && ids.length > 0) setActiveTaskId(ids[0]);
  }, [activeTaskId]);

  const fetchSpansForActive = useCallback(async () => {
    if (!activeTaskId) {
      setSpans([]);
      return;
    }
    const r = await fetch(
      `/api/agent-fabric/traces?taskId=${encodeURIComponent(activeTaskId)}`,
      { cache: "no-store" }
    );
    const d = await r.json();
    setSpans(d.traces ?? []);
  }, [activeTaskId]);

  useEffect(() => {
    fetchAgents();
    fetchPolicies();
    fetchRecentTaskIds();
  }, [fetchAgents, fetchPolicies, fetchRecentTaskIds]);

  useEffect(() => {
    fetchSpansForActive();
  }, [fetchSpansForActive]);

  useEffect(() => {
    const handle = setInterval(() => {
      fetchRecentTaskIds();
      fetchSpansForActive();
    }, 4000);
    return () => clearInterval(handle);
  }, [fetchRecentTaskIds, fetchSpansForActive]);

  const runTestCase = useCallback(
    async (label: string) => {
      setRunning(label);
      setRunError(null);
      try {
        const intake = TEST_INTAKES[label];
        const r = await fetch("/api/intake/route-to-care-router", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // When a persona filter is active, thread its id into the
          // handoff so the test-case run's spans carry the matching
          // attributes.personaId. That means the trace immediately
          // satisfies the filter and shows up in the chip row -- no
          // confusing "I just ran a case but the chip row is still
          // empty" mismatch. With no filter active, the field is
          // omitted and the trace is unattributed (the existing
          // behavior).
          body: JSON.stringify({
            intake,
            ...(filterPersonaId ? { personaId: filterPersonaId } : {})
          })
        });
        if (!r.ok) throw new Error(`handoff failed: ${r.status}`);
        const d = (await r.json()) as { taskId?: string };
        if (d.taskId) setActiveTaskId(d.taskId);
        await Promise.all([fetchRecentTaskIds(), fetchSpansForActive()]);
      } catch (err) {
        setRunError((err as Error).message);
      } finally {
        setRunning(null);
      }
    },
    [fetchRecentTaskIds, fetchSpansForActive, filterPersonaId]
  );

  const policiesByAgent = useMemo(() => {
    const map = new Map<string, PolicyRecord[]>();
    for (const p of policies) {
      for (const a of p.appliesTo) {
        if (!map.has(a)) map.set(a, []);
        map.get(a)!.push(p);
      }
    }
    return map;
  }, [policies]);

  // When ?personaId= is set, scope the recent-tasks chip row to
  // tasks whose spans carry the matching attributes.personaId.
  // When no filter is set, this is just the unfiltered recent list.
  const filteredRecentTaskIds = useMemo(() => {
    if (!filterPersonaId) return recentTaskIds;
    return recentTaskIds.filter(
      (tid) => taskIdToPersonaId[tid] === filterPersonaId
    );
  }, [recentTaskIds, taskIdToPersonaId, filterPersonaId]);

  // When the persona filter changes and the active task no longer
  // matches the filter, auto-advance to the most recent matching
  // task. This keeps the page honest: the Trace panel either shows
  // a trace that belongs to the filter persona, or it shows
  // "(none selected)" with an empty-state message.
  useEffect(() => {
    if (!filterPersonaId) return;
    if (!activeTaskId) {
      if (filteredRecentTaskIds.length > 0) {
        setActiveTaskId(filteredRecentTaskIds[0]);
      }
      return;
    }
    const activeBelongs = taskIdToPersonaId[activeTaskId] === filterPersonaId;
    if (!activeBelongs) {
      setActiveTaskId(filteredRecentTaskIds[0] ?? "");
    }
  }, [
    filterPersonaId,
    activeTaskId,
    taskIdToPersonaId,
    filteredRecentTaskIds
  ]);

  return (
    <>
      {/*
       * Persona-filter banner. Mirrors the analytics banner from
       * the previous demo-polish pass so the two pages feel like
       * sibling views over the same span stream. Wired to the
       * shared updatePersonaFilter() helper.
       */}
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
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.6rem",
              alignItems: "center"
            }}
          >
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
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              · {filteredRecentTaskIds.length} of {recentTaskIds.length}{" "}
              recent traces match
            </span>
          </div>
          <button
            type="button"
            onClick={() => updatePersonaFilter(null)}
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
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.6rem",
              alignItems: "center"
            }}
          >
            <span className="pre-brief-source-badge pre-brief-source-badge--info">
              No persona filter
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              All-tasks view across {recentTaskIds.length} recent traces.
              Filter by a persona to scope the Recent tasks chip row:
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {DEMO_COHORT.slice(0, 4).map((persona) => (
              <button
                key={persona.id}
                type="button"
                onClick={() => updatePersonaFilter(persona.id)}
                className="btn btn-secondary"
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }}
              >
                {persona.firstName}
              </button>
            ))}
          </div>
        </article>
      )}

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Agent Registry</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {agents.map((a) => (
            <article key={a.id} className="card">
              <h3 style={{ marginBottom: "0.2rem" }}>{a.name}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  fontSize: "0.82rem"
                }}
              >
                {a.protocol.toUpperCase()} · {a.kind} · v{a.version}
              </p>
              <p style={{ fontSize: "0.85rem" }}>
                <code>{a.endpoint}</code>
              </p>
              <p style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
                <strong>Tier:</strong> {a.governanceTier}
              </p>
              <p style={{ fontSize: "0.85rem" }}>
                <strong>Provider:</strong> {a.provider}
              </p>
              <details style={{ marginTop: "0.6rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Capabilities
                </summary>
                <ul style={{ marginTop: "0.4rem", paddingLeft: "1.2rem" }}>
                  {a.capabilities.map((c) => (
                    <li key={c} style={{ fontSize: "0.85rem" }}>
                      {c}
                    </li>
                  ))}
                </ul>
              </details>
              <details style={{ marginTop: "0.4rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Policies applied ({(policiesByAgent.get(a.id) ?? []).length})
                </summary>
                <ul style={{ marginTop: "0.4rem", paddingLeft: "1.2rem" }}>
                  {(policiesByAgent.get(a.id) ?? []).map((p) => (
                    <li key={p.id} style={{ fontSize: "0.85rem" }}>
                      <code>{p.id}</code> — {p.enforcement} ({p.status})
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Run a test case</p>
        <p style={{ marginTop: "0.4rem" }}>
          Trigger an end-to-end A2A handoff from the (mocked) Agentforce intake
          agent to the Care Router. The trace below will update with the new
          spans within a few seconds.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginTop: "0.8rem"
          }}
        >
          {Object.keys(TEST_INTAKES).map((label) => (
            <button
              key={label}
              type="button"
              className="btn btn-primary"
              disabled={running !== null}
              onClick={() => runTestCase(label)}
              style={{ fontSize: "0.85rem" }}
            >
              {running === label ? "Running…" : label}
            </button>
          ))}
        </div>
        {runError && (
          <p style={{ marginTop: "0.5rem", color: "var(--alert, #b00020)" }}>
            {runError}
          </p>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">
          Recent tasks
          {filterPersona
            ? ` · scoped to ${filterPersona.firstName} ${filterPersona.lastName}`
            : ""}
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginTop: "0.5rem"
          }}
        >
          {filteredRecentTaskIds.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              {filterPersona ? (
                <>
                  No recent tasks attributed to {filterPersona.firstName}{" "}
                  {filterPersona.lastName} yet. Trigger one from{" "}
                  <a
                    href={`/demo/routing?personaId=${encodeURIComponent(filterPersona.id)}`}
                  >
                    /demo/routing
                  </a>
                  , or click a test case above (it will inherit this
                  persona attribution), or{" "}
                  <button
                    type="button"
                    onClick={() => updatePersonaFilter(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--brand)",
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                      font: "inherit"
                    }}
                  >
                    clear the filter
                  </button>{" "}
                  to see all tasks.
                </>
              ) : (
                <>
                  No recent tasks yet. Run a test case above, or trigger a
                  real Care Router decision from{" "}
                  <a href="/demo/routing">/demo/routing</a>.
                </>
              )}
            </p>
          )}
          {filteredRecentTaskIds.map((tid) => {
            const personaForTask = taskIdToPersonaId[tid];
            const personaLabel = personaForTask
              ? findDemoPersona(personaForTask)?.firstName ?? personaForTask
              : null;
            return (
              <button
                key={tid}
                type="button"
                className={
                  tid === activeTaskId
                    ? "btn btn-primary"
                    : "btn btn-secondary"
                }
                onClick={() => setActiveTaskId(tid)}
                style={{ fontSize: "0.78rem", fontFamily: "monospace" }}
                title={personaLabel ? `Persona: ${personaLabel}` : undefined}
              >
                {tid}
                {!filterPersona && personaLabel && (
                  <span
                    style={{
                      marginLeft: "0.4rem",
                      fontFamily: "inherit",
                      fontSize: "0.7rem",
                      opacity: 0.75
                    }}
                  >
                    · {personaLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Trace</p>
        <p style={{ marginTop: "0.4rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
          taskId = <code>{activeTaskId || "(none selected)"}</code>
        </p>
        {(() => {
          // Surface a single trace-level banner that reports whether this
          // run's Data 360 spans were served by the real Salesforce org or
          // by the deterministic mock. Helpful for investor demos because
          // it makes "this is real, not synthetic" visible at a glance.
          const data360Spans = spans.filter(
            (s) => s.agentId === "salesforce-data-360"
          );
          if (data360Spans.length === 0) return null;
          const sources = data360Spans.map(
            (s) =>
              (s.attributes as Record<string, unknown> | undefined)?._source
          );
          const anyReal = sources.some((s) => s === "real");
          const allReal = sources.length > 0 && sources.every((s) => s === "real");
          const label = allReal
            ? "LIVE · grounded on Salesforce Health Cloud"
            : anyReal
              ? "MIXED · part live, part mocked"
              : "MOCKED · zero-credential demo path";
          const bg = allReal
            ? "rgba(34,139,34,0.12)"
            : anyReal
              ? "rgba(255,165,0,0.12)"
              : "rgba(120,120,120,0.10)";
          const border = allReal
            ? "1px solid rgba(34,139,34,0.45)"
            : anyReal
              ? "1px solid rgba(255,165,0,0.45)"
              : "1px solid rgba(120,120,120,0.30)";
          return (
            <p
              style={{
                marginTop: "0.5rem",
                padding: "0.35rem 0.6rem",
                background: bg,
                border,
                borderRadius: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 600,
                display: "inline-block"
              }}
            >
              {label}
            </p>
          );
        })()}
        {(() => {
          const data360Span = spans.find(
            (s) => s.agentId === "salesforce-data-360"
          );
          const unifiedId =
            data360Span?.attributes &&
            (data360Span.attributes as Record<string, unknown>).unifiedPatientId;
          if (typeof unifiedId === "string" && unifiedId.length > 0) {
            return (
              <p style={{ marginTop: "0.4rem" }}>
                <a
                  href={`/api/data-360/patient/${encodeURIComponent(unifiedId)}/record`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ fontSize: "0.82rem" }}
                >
                  View Data 360 federated record (JSON)
                </a>
              </p>
            );
          }
          return null;
        })()}
        {spans.length === 0 ? (
          <p style={{ color: "var(--muted)", marginTop: "0.6rem" }}>
            No spans for this task yet.
          </p>
        ) : (
          <ol
            style={{
              marginTop: "0.8rem",
              listStyle: "none",
              padding: 0,
              borderLeft: "2px solid var(--brand)"
            }}
          >
            {spans.map((span) => (
              <li
                key={span.id}
                style={{
                  paddingLeft: "1rem",
                  paddingBottom: "1rem",
                  position: "relative"
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: "0.2rem" }}>
                  {span.agentName}{" "}
                  <span
                    style={{
                      color:
                        span.status === "error"
                          ? "var(--alert, #b00020)"
                          : "var(--brand)",
                      fontSize: "0.78rem",
                      marginLeft: "0.4rem"
                    }}
                  >
                    {span.protocol.toUpperCase()} · {span.operation} ·{" "}
                    {span.status}
                  </span>
                  {(() => {
                    const src = (
                      span.attributes as Record<string, unknown> | undefined
                    )?._source;
                    if (src !== "real" && src !== "mock") return null;
                    return (
                      <span
                        title={
                          src === "real"
                            ? "Served by your configured Salesforce org"
                            : "Served by the deterministic mock (no real-org call)"
                        }
                        style={{
                          marginLeft: "0.4rem",
                          padding: "0.05rem 0.4rem",
                          background:
                            src === "real"
                              ? "rgba(34,139,34,0.15)"
                              : "rgba(120,120,120,0.15)",
                          color:
                            src === "real" ? "#1b6b1b" : "var(--muted)",
                          borderRadius: "0.25rem",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          textTransform: "uppercase"
                        }}
                      >
                        {src === "real" ? "live" : "mock"}
                      </span>
                    );
                  })()}
                </p>
                <p
                  style={{
                    fontSize: "0.78rem",
                    fontFamily: "monospace",
                    color: "var(--muted)"
                  }}
                >
                  {span.id}
                  {span.parentSpanId && <> ← {span.parentSpanId}</>}
                  {typeof span.durationMs === "number" && (
                    <> · {span.durationMs}ms</>
                  )}
                </p>
                {span.attributes && Object.keys(span.attributes).length > 0 && (
                  <pre
                    style={{
                      background: "var(--card-bg, #f6f6f8)",
                      padding: "0.6rem",
                      borderRadius: "0.4rem",
                      fontSize: "0.78rem",
                      marginTop: "0.4rem",
                      overflowX: "auto"
                    }}
                  >
                    <code>{JSON.stringify(span.attributes, null, 2)}</code>
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Policy Catalog ({policies.length})</p>
        <p style={{ marginTop: "0.4rem" }}>
          Read-only mock of the policies the MuleSoft Agent Fabric enforces
          across the agent registry. In production these are authored in the
          Agent Fabric console and pushed to runtime enforcement points (the
          Anypoint API gateway, each agent&apos;s inbound middleware, and the
          MCP server boundary).
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Applies to</th>
                <th>Enforcement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <br />
                    <code style={{ fontSize: "0.78rem" }}>{p.id}</code>
                    <br />
                    <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                      {p.description}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>
                    {p.appliesTo.map((a) => (
                      <div key={a}>
                        <code>{a}</code>
                      </div>
                    ))}
                  </td>
                  <td>{p.enforcement}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Where to look next</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/demo/intake">Run a real intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Complete the Agentforce-style intake and watch the A2A handoff
              appear here within seconds.
            </strong>
          </li>
          <li>
            <span>
              <a href="/api/agents/care-router/.well-known/agent.json">
                Care Router Agent Card
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Google A2A discovery document for the Anthropic-backed router.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Investor brief · Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Why this architecture matters, what production looks like, and
              the phased plan.
            </strong>
          </li>
        </ul>
      </section>
    </>
  );
}

export default function AgentFabricConsole() {
  return (
    <DemoShell
      title="Multi-agent control plane"
      subtitle="Live view of every Pause-Health.ai agent currently registered on a (mocked) MuleSoft Agent Fabric: the Agentforce Prospecting and Engagement agents that bracket the patient lifecycle, Agentforce intake, the Anthropic Claude-backed Care Router, the Pause MCP server, and the MuleSoft Process API. Every A2A handoff and tool call lands here as a trace span so you can govern, monitor, and audit the multi-agent system in one place."
      eyebrow="Prototype · Agent Fabric Console"
      backHref="/demo/intake"
      backLabel="← Back to Intake"
    >
      <Suspense
        fallback={
          <p style={{ color: "var(--muted)" }}>
            Loading Agent Fabric console…
          </p>
        }
      >
        <AgentFabricConsoleInner />
      </Suspense>

      <PersonaJourneyFooter stage="agent-fabric" />
    </DemoShell>
  );
}
