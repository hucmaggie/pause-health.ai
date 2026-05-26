"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get("taskId") ?? "";

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>(initialTaskId);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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
    const r = await fetch("/api/agent-fabric/traces", { cache: "no-store" });
    const d = await r.json();
    const ids = (d.recentTaskIds ?? []) as string[];
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
          body: JSON.stringify({ intake })
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
    [fetchRecentTaskIds, fetchSpansForActive]
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

  return (
    <main className="container">
      <section className="hero" style={{ paddingBottom: "1.5rem" }}>
        <a href="/demo/intake" className="btn btn-secondary">
          ← Back to Intake
        </a>
        <p className="eyebrow">Prototype · Agent Fabric Console</p>
        <h1>Multi-agent control plane</h1>
        <p className="hero-copy">
          Live view of every Pause-Health.ai agent currently registered on a
          (mocked) MuleSoft Agent Fabric: Agentforce intake, the Anthropic
          Claude-backed Care Router, the Pause MCP server, and the MuleSoft
          Process API. Every A2A handoff and tool call lands here as a trace
          span so you can govern, monitor, and audit the multi-agent system in
          one place.
        </p>
      </section>

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
        <p className="eyebrow">Recent tasks</p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginTop: "0.5rem"
          }}
        >
          {recentTaskIds.length === 0 && (
            <p style={{ color: "var(--muted)" }}>No recent tasks yet.</p>
          )}
          {recentTaskIds.map((tid) => (
            <button
              key={tid}
              type="button"
              className={
                tid === activeTaskId ? "btn btn-primary" : "btn btn-secondary"
              }
              onClick={() => setActiveTaskId(tid)}
              style={{ fontSize: "0.78rem", fontFamily: "monospace" }}
            >
              {tid}
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Trace</p>
        <p style={{ marginTop: "0.4rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
          taskId = <code>{activeTaskId || "(none selected)"}</code>
        </p>
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
    </main>
  );
}

export default function AgentFabricConsole() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <p>Loading Agent Fabric console…</p>
        </main>
      }
    >
      <AgentFabricConsoleInner />
    </Suspense>
  );
}
