"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CoverageContinuityDetermination,
  type CoverageContinuityDisposition,
  type CoverageContinuityRequest,
  type CoverageGap,
  type MergedSpan,
  DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST,
  DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST,
  DEMO_COVERAGE_CONTINUITY_REQUEST
} from "../lib/coverage-continuity";

/**
 * Creditable Coverage Continuity runner for the intake demo.
 *
 * Fires the real, server-side A2A Coverage Continuity agent at /api/agents/coverage-continuity/tasks —
 * a payer-operations service that merges a member's coverage segments and detects a significant break.
 * The panel surfaces the disposition, the merged spans, the gaps (marking a significant break), the
 * honesty signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — continuous coverage OR a significant break — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresEligibilityReview:true, autoDetermined:false). The fabricated-span,
 * bad-math, and auto-determined presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the segments reference the member's coverage history. The segments are ILLUSTRATIVE,
 * NOT a certified creditable-coverage system. Structure, styling tokens, and tone mirror
 * <CarePathwayPanel> so this reads as a native sibling on /demo/intake.
 */

const COVERAGE_CONTINUITY_ROUTE = "/api/agents/coverage-continuity/tasks";

/** A one-click demo scenario. */
export type CoverageContinuityPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CoverageContinuityRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const COVERAGE_CONTINUITY_PRESETS: CoverageContinuityPreset[] = [
  {
    id: "continuous",
    label: "14-day gap → continuous",
    hint: "Under the 63-day threshold.",
    request: DEMO_COVERAGE_CONTINUITY_REQUEST,
    demonstrates:
      "Two employer coverages with a short gap → the interval merge keeps them separate but the 14-day gap is under the threshold, so coverage is continuous."
  },
  {
    id: "break",
    label: "153-day gap → significant break",
    hint: "Over the 63-day threshold.",
    request: DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST,
    demonstrates:
      "A long gap between coverages → over the 63-day threshold, a significant break that resets creditable coverage."
  },
  {
    id: "overlap",
    label: "Overlapping coverage → merges to one span",
    hint: "Employer + COBRA overlap.",
    request: DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST,
    demonstrates:
      "Two overlapping segments → the interval merge collapses them into a single continuous span with no gaps."
  },
  {
    id: "fabricated-span-block",
    label: "Fabricated span → governance block",
    hint: "A span not backed by any segment.",
    request: DEMO_COVERAGE_CONTINUITY_REQUEST,
    determination: {
      requestRef: "cov-001",
      memberRef: "member-4821",
      asOfDate: "2025-01-15",
      disposition: "continuous",
      // Wrong: this span's boundaries are not from any submitted segment.
      mergedSpans: [{ startDay: 19723, endDay: 19800, startDate: "2024-01-01", endDate: "2024-03-19", coveredDays: 78 }],
      gaps: [],
      totalCoveredDays: 78,
      maxGapDays: 63,
      hasSignificantBreak: false,
      segments: [
        { segmentId: "seg-a", source: "employer-a", startDate: "2024-05-01", endDate: "2024-06-30", startDay: 19844, endDay: 19904 }
      ],
      invalidSegments: [],
      requiresEligibilityReview: true,
      autoDetermined: false
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated / dropped coverage span (policy.coverage.segments-sourced)."
  },
  {
    id: "bad-math-block",
    label: "Miscounted covered days → governance block",
    hint: "Total doesn't match the spans.",
    request: DEMO_COVERAGE_CONTINUITY_REQUEST,
    determination: {
      requestRef: "cov-001",
      memberRef: "member-4821",
      asOfDate: "2025-01-15",
      disposition: "continuous",
      mergedSpans: [{ startDay: 19723, endDay: 19904, startDate: "2024-01-01", endDate: "2024-06-30", coveredDays: 182 }],
      gaps: [],
      // Wrong: total says 999 but the one span covers 182 days.
      totalCoveredDays: 999,
      maxGapDays: 63,
      hasSignificantBreak: false,
      segments: [
        { segmentId: "seg-a", source: "employer-a", startDate: "2024-01-01", endDate: "2024-06-30", startDay: 19723, endDay: 19904 }
      ],
      invalidSegments: [],
      requiresEligibilityReview: true,
      autoDetermined: false
    },
    demonstrates:
      "The Agent Fabric blocking inconsistent coverage math (policy.coverage.math-consistent)."
  },
  {
    id: "auto-determined-block",
    label: "Determination issued autonomously → governance block",
    hint: "A determination that issued itself.",
    request: DEMO_COVERAGE_CONTINUITY_REQUEST,
    determination: {
      requestRef: "cov-001",
      memberRef: "member-4821",
      asOfDate: "2025-01-15",
      disposition: "continuous",
      mergedSpans: [{ startDay: 19723, endDay: 19904, startDate: "2024-01-01", endDate: "2024-06-30", coveredDays: 182 }],
      gaps: [],
      totalCoveredDays: 182,
      maxGapDays: 63,
      hasSignificantBreak: false,
      segments: [
        { segmentId: "seg-a", source: "employer-a", startDate: "2024-01-01", endDate: "2024-06-30", startDay: 19723, endDay: 19904 }
      ],
      invalidSegments: [],
      // Wrong: the agent issued the determination and skipped eligibility review.
      requiresEligibilityReview: false,
      autoDetermined: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous coverage determination (policy.coverage.no-autonomous-determination)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type CoverageContinuityResolvedView = {
  kind: "resolved";
  requestRef: string;
  memberRef: string;
  disposition: CoverageContinuityDisposition;
  mergedSpans: MergedSpan[];
  gaps: CoverageGap[];
  totalCoveredDays: number;
  maxGapDays: number;
  hasSignificantBreak: boolean;
  reason: string;
  note: string;
  coverageSegmentsSourced: boolean;
  coverageMathConsistent: boolean;
  coverageNoAutonomousDetermination: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CoverageContinuityBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CoverageContinuityInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CoverageContinuityView =
  | CoverageContinuityResolvedView
  | CoverageContinuityBlockedView
  | CoverageContinuityInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  coverageSegmentsSourced?: unknown;
  coverageMathConsistent?: unknown;
  coverageNoAutonomousDetermination?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCoverageContinuityRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CoverageContinuityRequest;
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
 * POST a continuity request (or an asserted determination) to the Coverage Continuity agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runCoverageContinuityTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CoverageContinuityRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(COVERAGE_CONTINUITY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCoverageContinuityRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * determination (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function coverageContinuityViewFromTask(task: A2ATask): CoverageContinuityView {
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
        "The Agent Fabric blocked this coverage-continuity run.";
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
      (typeof fabric.error === "string"
        ? fabric.error
        : "The coverage continuity could not be analyzed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: CoverageContinuityDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    memberRef: det?.memberRef ?? "",
    disposition: det?.disposition ?? "continuous",
    mergedSpans: det?.mergedSpans ?? [],
    gaps: det?.gaps ?? [],
    totalCoveredDays: det?.totalCoveredDays ?? 0,
    maxGapDays: det?.maxGapDays ?? 63,
    hasSignificantBreak: det?.hasSignificantBreak ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    coverageSegmentsSourced: fabric.coverageSegmentsSourced === true,
    coverageMathConsistent: fabric.coverageMathConsistent === true,
    coverageNoAutonomousDetermination: fabric.coverageNoAutonomousDetermination === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CoverageContinuityDisposition, string> = {
  continuous: "#8fd6b0",
  "significant-break": "#ffb6c8"
};

const DISPOSITION_LABEL: Record<CoverageContinuityDisposition, string> = {
  continuous: "Continuous coverage",
  "significant-break": "Significant break in coverage"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CoverageContinuityView }
  | { status: "error"; message: string };

export function CoverageContinuityPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CoverageContinuityPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCoverageContinuityTask({
          taskId: newTaskId("coverage-continuity"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: coverageContinuityViewFromTask(task) });
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
        Creditable coverage · continuity of coverage · payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Coverage Continuity — every span sourced, the coverage math is exact, never an autonomous
        determination
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> merges a member&rsquo;s{" "}
        <strong>coverage segments</strong> into continuous spans, totals the covered days, and measures
        the <strong>gaps</strong> — flagging a <strong>significant break</strong> when a gap exceeds the{" "}
        <strong>63-day</strong> threshold (HIPAA / ACA). No topological sort, no dollar waterfall — an{" "}
        <strong>interval merge + gap detection</strong>. Every span is <strong>sourced</strong>, the
        math is <strong>exact</strong>, and the result is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> issues a determination — an eligibility reviewer confirms every one.{" "}
        <strong>PHI-bearing · illustrative segments, not a certified system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {COVERAGE_CONTINUITY_PRESETS.map((preset) => (
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
              ? "Analyzing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Continuity run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CoverageContinuityResult view={runState.view} />}
    </section>
  );
}

function CoverageContinuityResult({ view }: { view: CoverageContinuityView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace →
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
                <code>{v.policyId}</code> — {v.reason}
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
        Continuity (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.memberRef ? ` · ${view.memberRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]} · {view.totalCoveredDays} covered day(s) · threshold{" "}
        {view.maxGapDays}d
      </p>

      {view.mergedSpans.length > 0 && (
        <ol
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.mergedSpans.map((s, i) => (
            <li key={`${s.startDate}-${s.endDate}`}>
              <strong>
                {s.startDate} → {s.endDate}
              </strong>{" "}
              ({s.coveredDays} days)
              {view.gaps
                .filter((g) => g.afterSpanIndex === i)
                .map((g) => (
                  <span key={g.fromDate} style={{ color: g.significant ? "#ffb6c8" : "#ffd28a" }}>
                    {"  "}— then a {g.gapDays}-day gap{g.significant ? " (significant break)" : ""} —
                  </span>
                ))}
            </li>
          ))}
        </ol>
      )}

      <div
        role="note"
        aria-label="Continuity safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced · exact math · never an autonomous determination{" "}
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
            synthetic · PHI-bearing
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
          coverageSegmentsSourced = {String(view.coverageSegmentsSourced)} · coverageMathConsistent ={" "}
          {String(view.coverageMathConsistent)} · coverageNoAutonomousDetermination ={" "}
          {String(view.coverageNoAutonomousDetermination)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
