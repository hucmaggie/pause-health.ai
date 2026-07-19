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
import {
  BOOLEAN_BLOCK_SIGNALS,
  MODEL_ALLOWLIST_POLICY_ID,
  type GovernanceTask
} from "../../../lib/governance-signals";
import {
  GOVERNANCE_PLANES,
  PLANES_IN_ORDER,
  planeForTier,
  tierLabel,
  type GovernancePlane
} from "../../../lib/governance-tiers";

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

  // --- Governance pre-flight panel state ---
  const [govAgentId, setGovAgentId] = useState<string>("");
  // policyId -> whether to simulate a violation of that policy.
  const [govViolations, setGovViolations] = useState<Record<string, boolean>>(
    {}
  );
  const [govResult, setGovResult] = useState<{
    decision: "allow" | "block";
    blockingViolations: { policyId: string; reason: string }[];
    appliesPolicies: { id: string }[];
  } | null>(null);
  const [govBusy, setGovBusy] = useState(false);
  const [govError, setGovError] = useState<string | null>(null);

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

  // Group the registry by plane (patient/clinical, platform, commercial) so
  // the PHI boundary is visible instead of a flat list of raw tier slugs.
  const agentsByPlane = useMemo(() => {
    const map = new Map<GovernancePlane | "other", AgentRecord[]>();
    for (const a of agents) {
      const plane = planeForTier(a.governanceTier) ?? "other";
      if (!map.has(plane)) map.set(plane, []);
      map.get(plane)!.push(a);
    }
    return map;
  }, [agents]);

  // Signal metadata keyed by policy id, from the shared source of truth the
  // evaluator itself uses -- so this form can't advertise a signal the gate
  // doesn't check.
  const signalByPolicyId = useMemo(() => {
    const map = new Map<string, (typeof BOOLEAN_BLOCK_SIGNALS)[number]>();
    for (const s of BOOLEAN_BLOCK_SIGNALS) map.set(s.policyId, s);
    return map;
  }, []);

  // Enforced-block policies applicable to the selected agent -- these are the
  // only ones the pre-flight gate can actually block on.
  const govBlockPolicies = useMemo(() => {
    if (!govAgentId) return [] as PolicyRecord[];
    return (policiesByAgent.get(govAgentId) ?? []).filter(
      (p) => p.enforcement === "block" && p.status === "enforced"
    );
  }, [govAgentId, policiesByAgent]);

  // Default the picker to the Care Router (the canonical example) once agents
  // load, without clobbering a user's choice.
  useEffect(() => {
    if (govAgentId || agents.length === 0) return;
    const hasRouter = agents.some((a) => a.id === "care-router-claude");
    setGovAgentId(hasRouter ? "care-router-claude" : agents[0].id);
  }, [agents, govAgentId]);

  const runGovEvaluate = useCallback(async () => {
    if (!govAgentId) return;
    setGovBusy(true);
    setGovError(null);
    try {
      const task: GovernanceTask = {};
      for (const p of govBlockPolicies) {
        const violate = govViolations[p.id] === true;
        if (p.id === MODEL_ALLOWLIST_POLICY_ID) {
          // String+regex signal: an off-allowlist model when "violating",
          // an approved Claude model otherwise.
          task.requestedModel = violate
            ? "gpt-4o"
            : "claude-sonnet-4-5-20250929";
          continue;
        }
        const spec = signalByPolicyId.get(p.id);
        if (!spec) continue;
        // Set the signal explicitly to the violating value or its opposite,
        // so the request states intent rather than relying on omission.
        task[spec.signal] = violate ? spec.violatingValue : !spec.violatingValue;
      }
      const r = await fetch("/api/agent-fabric/governance/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: govAgentId, task })
      });
      if (!r.ok) throw new Error(`evaluate failed: ${r.status}`);
      const d = await r.json();
      setGovResult(d.result ?? null);
    } catch (err) {
      setGovError((err as Error).message);
      setGovResult(null);
    } finally {
      setGovBusy(false);
    }
  }, [govAgentId, govBlockPolicies, govViolations, signalByPolicyId]);

  const renderAgentCard = (a: AgentRecord) => (
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
        <strong>Tier:</strong> {tierLabel(a.governanceTier)}
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
  );

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
        <p style={{ marginTop: "0.4rem", color: "var(--muted)", fontSize: "0.88rem" }}>
          Grouped by plane. The patient/clinical plane and the commercial plane
          are the PHI boundary — the platform plane is the shared data +
          integration substrate that serves the patient plane.
        </p>
        {PLANES_IN_ORDER.filter(
          (plane) => (agentsByPlane.get(plane) ?? []).length > 0
        ).map((plane) => {
          const planeAgents = agentsByPlane.get(plane) ?? [];
          const meta = GOVERNANCE_PLANES[plane];
          return (
            <div key={plane} style={{ marginTop: "1.1rem" }}>
              <h3 style={{ margin: "0 0 0.1rem" }}>
                {meta.label}{" "}
                <span
                  style={{
                    color: "var(--muted)",
                    fontWeight: 500,
                    fontSize: "0.82rem"
                  }}
                >
                  · {planeAgents.length} agent{planeAgents.length === 1 ? "" : "s"}
                </span>
              </h3>
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "0.84rem",
                  margin: "0 0 0.6rem",
                  maxWidth: "72ch"
                }}
              >
                {meta.description}
              </p>
              <div className="card-grid">{planeAgents.map(renderAgentCard)}</div>
            </div>
          );
        })}
        {(agentsByPlane.get("other") ?? []).length > 0 && (
          <div style={{ marginTop: "1.1rem" }}>
            <h3 style={{ margin: "0 0 0.6rem" }}>Other</h3>
            <div className="card-grid">
              {(agentsByPlane.get("other") ?? []).map(renderAgentCard)}
            </div>
          </div>
        )}
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

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Governance pre-flight</p>
        <p style={{ marginTop: "0.4rem" }}>
          Exercise the same pre-flight gate the Care Router runs before it
          accepts a task — for <em>any</em> agent on the fabric. Pick an agent,
          toggle whether the inbound task would violate each of its
          enforced-block policies, and evaluate. The gate blocks only on an
          explicitly-violating signal, so an all-compliant task is allowed.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.6rem",
            marginTop: "0.8rem"
          }}
        >
          <label htmlFor="gov-agent" style={{ fontWeight: 600 }}>
            Agent
          </label>
          <select
            id="gov-agent"
            value={govAgentId}
            onChange={(e) => {
              setGovAgentId(e.target.value);
              setGovViolations({});
              setGovResult(null);
              setGovError(null);
            }}
            style={{
              padding: "0.4rem 0.6rem",
              borderRadius: "0.4rem",
              border: "1px solid var(--border, #ccc)",
              fontSize: "0.9rem",
              minWidth: "22rem",
              maxWidth: "100%"
            }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: "0.9rem" }}>
          {govBlockPolicies.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
              This agent carries no enforced-block policies — the gate has
              nothing to block on, so any task is allowed. (It may still be on
              audit / rate-limit / redact policies; those don&apos;t block.)
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {govBlockPolicies.map((p) => {
                const isModel = p.id === MODEL_ALLOWLIST_POLICY_ID;
                const spec = signalByPolicyId.get(p.id);
                const hint = isModel
                  ? "Requests an off-allow-list model (gpt-4o)"
                  : spec?.violationHint ?? "Violates this policy";
                const checked = govViolations[p.id] === true;
                return (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.55rem",
                      padding: "0.4rem 0",
                      borderBottom: "1px solid var(--border, #eee)"
                    }}
                  >
                    <input
                      type="checkbox"
                      id={`gov-${p.id}`}
                      checked={checked}
                      onChange={(e) =>
                        setGovViolations((prev) => ({
                          ...prev,
                          [p.id]: e.target.checked
                        }))
                      }
                      style={{ marginTop: "0.2rem" }}
                    />
                    <label
                      htmlFor={`gov-${p.id}`}
                      style={{ fontSize: "0.86rem", cursor: "pointer" }}
                    >
                      <strong>{p.name}</strong>{" "}
                      <code style={{ fontSize: "0.76rem" }}>{p.id}</code>
                      <br />
                      <span style={{ color: "var(--muted)" }}>
                        Simulate violation: {hint}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginTop: "0.9rem",
            flexWrap: "wrap"
          }}
        >
          <button
            type="button"
            className="btn btn-primary"
            disabled={govBusy || !govAgentId}
            onClick={runGovEvaluate}
            style={{ fontSize: "0.85rem" }}
          >
            {govBusy ? "Evaluating…" : "Evaluate pre-flight"}
          </button>
          {Object.values(govViolations).some(Boolean) && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={govBusy}
              onClick={() => setGovViolations({})}
              style={{ fontSize: "0.82rem" }}
            >
              Reset to all-compliant
            </button>
          )}
        </div>

        {govError && (
          <p style={{ marginTop: "0.6rem", color: "var(--alert, #b00020)" }}>
            {govError}
          </p>
        )}

        {govResult && (
          <div style={{ marginTop: "0.9rem" }}>
            <span
              style={{
                display: "inline-block",
                padding: "0.2rem 0.6rem",
                borderRadius: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 700,
                textTransform: "uppercase",
                background:
                  govResult.decision === "allow"
                    ? "rgba(34,139,34,0.14)"
                    : "rgba(176,0,32,0.12)",
                color: govResult.decision === "allow" ? "#1b6b1b" : "#b00020",
                border:
                  govResult.decision === "allow"
                    ? "1px solid rgba(34,139,34,0.45)"
                    : "1px solid rgba(176,0,32,0.4)"
              }}
            >
              {govResult.decision === "allow" ? "✓ Allowed" : "✕ Blocked"}
            </span>
            <span
              style={{
                marginLeft: "0.6rem",
                color: "var(--muted)",
                fontSize: "0.82rem"
              }}
            >
              {govResult.appliesPolicies.length} policies apply ·{" "}
              {govResult.blockingViolations.length} blocking violation
              {govResult.blockingViolations.length === 1 ? "" : "s"}
            </span>
            {govResult.blockingViolations.length > 0 && (
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.2rem" }}>
                {govResult.blockingViolations.map((v) => (
                  <li key={v.policyId} style={{ fontSize: "0.84rem" }}>
                    <code>{v.policyId}</code> — {v.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
      subtitle="Live view of every Pause-Health.ai agent currently registered on a (mocked) MuleSoft Agent Fabric: the Agentforce Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement agents that bracket the patient lifecycle, Agentforce intake, the Assessment Agent that deterministically scores validated instruments (MRS, Greene, PHQ-9, ISI) into an intake severity, the Benefits & Coverage Verification (EBV) Agent that runs a synthetic eligibility check before routing, the Anthropic Claude-backed Care Router, the Care Plan Agent that instantiates a template-sourced menopause care plan and summarizes progress with live Claude (the second live-Claude agent, with a graceful scripted fallback like the Care Router), the Appointment Scheduling Agent that books the recommended MSCP visit against a synthetic provider calendar and hands it to engagement for reminders, the Referral Management Agent that triages intake + routing signals into cosign-gated outbound specialist referrals (generalizing the Care Router's behavioral-health handoff), the Member Service / Billing Agent that answers claim-sourced billing & coverage self-service questions and routes out-of-scope requests to a human, the Prior Authorization Agent (the heaviest, deliberately-last workflow) that assembles a clinician-gated, documentation-complete PA and never autonomously submits it, the Care Gap Closure Agent that proactively detects Data-360-grounded, clinical-measure-sourced preventive-care gaps and drafts consent-aware outreach for engagement, the Medication Adherence Agent that proactively tracks HRT/SSRI adherence + refill timing and drafts nudge-only refill reminders (never an autonomous refill) for engagement, the Clinical Summary Agent that composes the other agents' outputs into a patient-friendly after-visit summary and a clinician handoff with live Claude (the third live-Claude agent, with the same scripted fallback), grounding every summary in the source records the context was assembled from, the SDOH Screening Agent (whole-person care) that screens a patient for health-related social needs with the validated CMS AHC-HRSN core-domain tool, escalates the interpersonal-safety red flag to a human social worker, and drafts consent-gated community-resource referrals that are never an autonomous enrollment, the Patient Education & Health Coaching Agent that turns the intake, care-plan, and care-gap signals into a deterministically-selected, evidence-sourced menopause/midlife education curriculum and coaches the patient with live Claude (the fourth live-Claude agent, with the same scripted fallback), staying strictly within general education (no diagnosis, dosing, or individualized medical advice) with consent-gated outreach, the Remote Patient Monitoring & Symptom-Trend Tracking Agent that ingests longitudinal symptom/vital readings, deterministically detects per-metric trends against a synthetic monitored-metrics catalog, and routes worsening or red-flag trends to a clinician for review without ever taking an autonomous clinical action, the Population Health & Risk Stratification Agent that reasons over a whole patient panel at once, deterministically scores each patient with a transparent, additive risk model (no protected-class attributes) into a low/rising/high tier, and builds a prioritized outreach worklist for a human care manager — never an autonomous care decision, the Clinical Trials & Research Matching Agent that deterministically matches a single patient against a synthetic study catalog using structured eligibility criteria, ranks the matching studies with per-criterion explanations, and drafts a research-consent-gated outreach that never auto-enrolls (informed consent + a human required), the Language Access & Health Equity Agent that determines a limited-English-proficiency patient's preferred language, deterministically decides whether a qualified medical interpreter is needed and of which modality, checks approved in-language materials, and flags equity gaps — using a qualified medical interpreter only (never a family / ad-hoc / machine interpreter), never machine-translating clinical consent, and escalating to a human coordinator when no qualified interpreter is available, the HEDIS & Quality Reporting Agent that deterministically rolls up a whole panel against a defined HEDIS measure catalog into per-measure numerator / denominator / catalog-sourced exclusions / compliance rate for value-based-care contracts, and assembles a submission package that ALWAYS requires human quality-team approval (never autonomously filed, and never inflated by an ad-hoc / unlisted denominator exclusion), the Advance Care Planning Agent that uses perimenopause / menopause as a midlife touchpoint to surface which advance directives are on file (living will, DPOA-HC; POLST only for serious-illness patients), flags missing / stale / language-access gaps, and drafts a consent-gated conversation prompt for the care team — every directive on file traces to the catalog + an approved source, every directive change is clinician + patient sign-off gated (never autonomously applied), and for an LEP patient with no interpreter plan the active prompt is withheld until the Language Access agent has arranged a qualified interpreter (a safe answer, not a block), the Consent & Preferences Management Agent — the authoritative, cross-cutting consent ledger + communication-preference store the other agents' consent-before-outreach / consent-before-referral / consent-to-monitor gates defer to, deterministically deciding whether a patient may be contacted for a scope over a channel at a time while honoring revocations/expiries immediately and never overriding a scope, the Pause MCP server, the MCP Bridge that lets fabric agents call external MCP servers, the MuleSoft Process API, and — on a strictly PHI-separated commercial plane — the Pipeline Management and Account Management agents. Every A2A handoff and tool call lands here as a trace span so you can govern, monitor, and audit the multi-agent system in one place."
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
