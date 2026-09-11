"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type MemberAssignment,
  type PcpMatchingDetermination,
  type PcpMatchingDisposition,
  type PcpMatchingRequest,
  DEMO_PCP_MATCHING_CAPACITY_REQUEST,
  DEMO_PCP_MATCHING_PARTIAL_REQUEST,
  DEMO_PCP_MATCHING_REQUEST
} from "../lib/pcp-matching";

/**
 * PCP Assignment / Member–Provider Matching runner for the intake demo.
 *
 * Fires the real, server-side A2A PCP Matching agent at /api/agents/pcp-matching/tasks — a care-coordination
 * service that assigns a panel of members to primary care providers using the member-proposing Gale–Shapley
 * deferred-acceptance algorithm, producing the member-optimal STABLE matching (no blocking pair). The panel
 * surfaces the disposition, each member's assigned provider + preference rank, the provider loads, the
 * honesty signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A matching — all-matched or partial-match — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCoordinatorReview:true, autoAssigned:false). The phantom-assignment, unstable-matching, and
 * auto-assigned presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in
 * the UI rather than hidden.
 *
 * PHI-bearing — the members are patients. The panel is ILLUSTRATIVE, NOT a certified panel-management system.
 * Structure, styling tokens, and tone mirror <NetworkAdequacyPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const PCP_MATCHING_ROUTE = "/api/agents/pcp-matching/tasks";

/** A one-click demo scenario. */
export type PcpMatchingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: PcpMatchingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the all-matched demo — the block base. */
const VALID_DETERMINATION = {
  panelRef: "pcp-panel-001",
  members: DEMO_PCP_MATCHING_REQUEST.members,
  providers: DEMO_PCP_MATCHING_REQUEST.providers,
  assignments: [
    { memberId: "m1", label: "Member 1", providerId: "p2", memberRank: 2 },
    { memberId: "m2", label: "Member 2", providerId: "p1", memberRank: 1 },
    { memberId: "m3", label: "Member 3", providerId: "p3", memberRank: 3 }
  ],
  providerLoads: [
    { providerId: "p1", capacity: 1, assignedCount: 1 },
    { providerId: "p2", capacity: 1, assignedCount: 1 },
    { providerId: "p3", capacity: 1, assignedCount: 1 }
  ],
  matchedCount: 3,
  unmatchedCount: 0,
  total: 3,
  disposition: "all-matched",
  requiresCoordinatorReview: true,
  autoAssigned: false
};

export const PCP_MATCHING_PRESETS: PcpMatchingPreset[] = [
  {
    id: "all-matched",
    label: "Interlocking preferences \u2192 all matched",
    hint: "3 members, 3 single-capacity providers.",
    request: DEMO_PCP_MATCHING_REQUEST,
    demonstrates:
      "Gale\u2013Shapley deferred acceptance \u2014 a stable member-optimal matching (m1\u2192p2, m2\u2192p1, m3\u2192p3)."
  },
  {
    id: "partial-match",
    label: "Capacity exhausted \u2192 partial match",
    hint: "3 members chase 2 single-capacity providers.",
    request: DEMO_PCP_MATCHING_PARTIAL_REQUEST,
    demonstrates: "One member is left unmatched when every preferred provider is full \u2014 a stable partial match."
  },
  {
    id: "capacity",
    label: "Capacity-2 provider \u2192 all matched",
    hint: "A provider with a panel of two absorbs two members.",
    request: DEMO_PCP_MATCHING_CAPACITY_REQUEST,
    demonstrates: "A capacity-2 provider holds two members \u2014 a stable all-matched result."
  },
  {
    id: "phantom-assignment-block",
    label: "Phantom member \u2192 governance block",
    hint: "An assignment for a member not in the panel.",
    request: DEMO_PCP_MATCHING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a phantom member "m9" (not in the submitted panel) is assigned.
      assignments: [
        ...VALID_DETERMINATION.assignments,
        { memberId: "m9", label: "Phantom", providerId: "p1", memberRank: 1 }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a matching that assigns a member not in the submitted panel (policy.pcp.matching-sourced)."
  },
  {
    id: "unstable-block",
    label: "Unstable matching \u2192 governance block",
    hint: "A member and provider who both prefer each other.",
    request: DEMO_PCP_MATCHING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: swap m1\u2194m3 \u2014 m1 and p2 both prefer each other (a blocking pair).
      assignments: [
        { memberId: "m1", label: "Member 1", providerId: "p3", memberRank: 3 },
        { memberId: "m2", label: "Member 2", providerId: "p1", memberRank: 1 },
        { memberId: "m3", label: "Member 3", providerId: "p2", memberRank: 1 }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking an unstable matching \u2014 a blocking pair (policy.pcp.matching-stable)."
  },
  {
    id: "auto-assigned-block",
    label: "Assignment committed autonomously \u2192 governance block",
    hint: "A matching that committed on its own.",
    request: DEMO_PCP_MATCHING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent committed the assignment and skipped coordinator review.
      requiresCoordinatorReview: false,
      autoAssigned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous assignment commit (policy.pcp.no-autonomous-assignment)."
  }
];

/** Render-ready view of a produced matching lifted from the task. */
export type PcpMatchingResolvedView = {
  kind: "resolved";
  panelRef: string;
  disposition: PcpMatchingDisposition;
  assignments: MemberAssignment[];
  matchedCount: number;
  unmatchedCount: number;
  total: number;
  reason: string;
  note: string;
  matchingSourced: boolean;
  matchingStable: boolean;
  pcpNoAutonomousAssignment: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type PcpMatchingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type PcpMatchingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type PcpMatchingView =
  | PcpMatchingResolvedView
  | PcpMatchingBlockedView
  | PcpMatchingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  matchingSourced?: unknown;
  matchingStable?: unknown;
  pcpNoAutonomousAssignment?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildPcpMatchingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: PcpMatchingRequest;
  determination?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.determination !== undefined) data.determination = input.determination;
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [{ type: "data" as const, data }]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST a PCP-matching request (or an asserted matching) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runPcpMatchingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: PcpMatchingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(PCP_MATCHING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPcpMatchingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * matching (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function pcpMatchingViewFromTask(task: A2ATask): PcpMatchingView {
  const fabric = ((task.metadata?.agentFabric as FabricMeta) ?? {}) as FabricMeta;
  const traceTaskId =
    (typeof fabric.traceTaskId === "string" && fabric.traceTaskId) || task.id;

  if (task.status.state === "failed") {
    if (fabric.decision === "block") {
      const violations = Array.isArray(fabric.violations)
        ? (fabric.violations as { policyId: string; reason: string }[])
        : [];
      const message =
        task.status.message?.parts.find((p) => p.type === "text")?.text ??
        "The Agent Fabric blocked this PCP-matching run.";
      return {
        kind: "blocked",
        message,
        policiesEvaluated: asStringArray(fabric.policiesEvaluated),
        violations,
        traceTaskId
      };
    }
    const message =
      task.status.message?.parts.find((p) => p.type === "text")?.text ??
      (typeof fabric.error === "string" ? fabric.error : "The matching could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: PcpMatchingDetermination; panelRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    panelRef: result?.panelRef ?? det?.panelRef ?? "",
    disposition: det?.disposition ?? "partial-match",
    assignments: det?.assignments ?? [],
    matchedCount: det?.matchedCount ?? 0,
    unmatchedCount: det?.unmatchedCount ?? 0,
    total: det?.total ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    matchingSourced: fabric.matchingSourced === true,
    matchingStable: fabric.matchingStable === true,
    pcpNoAutonomousAssignment: fabric.pcpNoAutonomousAssignment === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<PcpMatchingDisposition, string> = {
  "all-matched": "#8fd6b0",
  "partial-match": "#ffd28a"
};

const DISPOSITION_LABEL: Record<PcpMatchingDisposition, string> = {
  "all-matched": "All matched \u00b7 stable (no blocking pair)",
  "partial-match": "Partial match \u00b7 stable (no blocking pair)"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: PcpMatchingView }
  | { status: "error"; message: string };

export function PcpMatchingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: PcpMatchingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runPcpMatchingTask({
          taskId: newTaskId("pcp-matching"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: pcpMatchingViewFromTask(task) });
      } catch (err) {
        setRunState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Care coordination &middot; PCP assignment &middot; stable two-sided matching
      </p>
      <h3 style={{ margin: 0 }}>
        PCP Matching — assignments sourced, matching stable, never an autonomous commit
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a panel of <strong>members</strong> (each with a
        ranked list of preferred providers) plus <strong>providers</strong> (each with a panel
        <strong> capacity</strong> and ranked member preferences) and produces a <strong>stable</strong>{" "}
        assignment via the <strong>Gale&ndash;Shapley deferred-acceptance</strong> algorithm &mdash; no member
        and provider who both prefer each other are left apart (no <strong>blocking pair</strong>). Not a
        distance, not a checksum, and <strong>not</strong> the Caseload agent&rsquo;s bin-packing &mdash;{" "}
        <strong>two-sided stable matching</strong>. Every assignment is <strong>sourced</strong>, the matching{" "}
        <strong>recomputes stably</strong>, and the result is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> commits an assignment, reassigns a patient, or overrides a panel &mdash; a
        care-coordination lead confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified panel-management system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PCP_MATCHING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => runPreset(preset)}
            title={`${preset.hint} ${preset.demonstrates}`}
            style={{ fontSize: "0.85rem" }}
          >
            {runState.status === "running" && runState.label === preset.label
              ? "Matching\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Matching failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <PcpMatchingResult view={runState.view} />}
    </section>
  );
}

function PcpMatchingResult({ view }: { view: PcpMatchingView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace &rarr;
      </a>
    </p>
  );

  if (view.kind === "blocked") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffb6c8" }}>
          Blocked by the Agent Fabric
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {view.violations.length > 0 && (
          <ul
            style={{
              margin: "0.5rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            {view.violations.map((v) => (
              <li key={v.policyId}>
                <code>{v.policyId}</code> &mdash; {v.reason}
              </li>
            ))}
          </ul>
        )}
        {view.policiesEvaluated.length > 0 && (
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            policies evaluated: {view.policiesEvaluated.join(", ")}
          </p>
        )}
        {traceLink}
      </div>
    );
  }

  if (view.kind === "invalid") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffd28a" }}>
          Not processed
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Matching (deterministic, synthetic)
        {view.panelRef ? ` \u00b7 ${view.panelRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.matchedCount} of {view.total} matched &middot; {view.unmatchedCount} unmatched
      </p>

      {view.assignments.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.assignments.map((a) => (
            <li key={a.memberId}>
              <code>{a.memberId}</code>
              {a.label ? ` (${a.label})` : ""} &rarr;{" "}
              {a.providerId === null ? (
                <em>unmatched</em>
              ) : (
                <>
                  <code>{a.providerId}</code>
                  {a.memberRank !== null ? ` \u00b7 rank ${a.memberRank}` : ""}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Matching safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; stable (no blocking pair) &middot; never an autonomous commit{" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#ffd28a",
              border: "1px solid #ffd28a",
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            synthetic &middot; PHI-bearing
          </span>
        </p>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          matchingSourced = {String(view.matchingSourced)} &middot; matchingStable ={" "}
          {String(view.matchingStable)} &middot; noAutonomousAssignment ={" "}
          {String(view.pcpNoAutonomousAssignment)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
