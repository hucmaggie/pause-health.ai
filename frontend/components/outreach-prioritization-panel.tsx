"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type OutreachCandidate,
  type OutreachDetermination,
  type OutreachDisposition,
  type OutreachRequest,
  DEMO_OUTREACH_ALL_REQUEST,
  DEMO_OUTREACH_REQUEST,
  DEMO_OUTREACH_TIGHT_REQUEST,
  evaluateOutreachPrioritization
} from "../lib/outreach-prioritization";

/**
 * Care-Management Capacity Allocation / Outreach Prioritization runner for the intake demo.
 *
 * Fires the real, server-side A2A Outreach Prioritization agent at /api/agents/outreach-prioritization/tasks
 * — a care-management capacity-planning service that selects the max-benefit subset of proactive
 * interventions that fits a care team's fixed capacity via the 0/1 knapsack dynamic-programming
 * optimization. The panel surfaces the disposition, the selected + deferred interventions, the honesty
 * signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * An allocation — all-scheduled or some-deferred — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCareLeadReview:true, autoScheduled:false). The phantom-intervention, sub-optimal, and
 * auto-scheduled presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable
 * in the UI rather than hidden.
 *
 * PHI-bearing — the interventions reference patients. The interventions are ILLUSTRATIVE synthetics, NOT a
 * certified care-management / capacity-planning system; a deferred intervention is deferred, never denied.
 * Structure, styling tokens, and tone mirror <QualityShiftPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const OUTREACH_ROUTE = "/api/agents/outreach-prioritization/tasks";

/** A one-click demo scenario. */
export type OutreachPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: OutreachRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the some-deferred demo — the block base. */
const VALID_DETERMINATION = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);

/** A real, feasible, but sub-optimal selection for the correctness-block preset. */
const SUBOPTIMAL_SELECTED: OutreachCandidate[] = VALID_DETERMINATION.candidates.filter(
  (c) => c.id === "iv-hrt-titration" || c.id === "iv-sdoh-checkin"
);
const SUBOPTIMAL_DEFERRED: OutreachCandidate[] = VALID_DETERMINATION.candidates.filter(
  (c) => c.id === "iv-dexa-reminder" || c.id === "iv-education"
);

export const OUTREACH_PRESETS: OutreachPreset[] = [
  {
    id: "some-deferred",
    label: "10-hour capacity \u2192 some-deferred",
    hint: "Four interventions, only some fit the week's hours.",
    request: DEMO_OUTREACH_REQUEST,
    demonstrates:
      "0/1 knapsack DP \u2014 the max-benefit subset that fits the capacity; the rest deferred to a later cycle."
  },
  {
    id: "all-scheduled",
    label: "Ample capacity \u2192 all-scheduled",
    hint: "Enough hours for every candidate intervention.",
    request: DEMO_OUTREACH_ALL_REQUEST,
    demonstrates: "Every intervention fits \u2014 nothing deferred."
  },
  {
    id: "tight",
    label: "5-hour capacity \u2192 two deferred",
    hint: "A tight budget forces two interventions to wait.",
    request: DEMO_OUTREACH_TIGHT_REQUEST,
    demonstrates: "The knapsack picks the highest-benefit pair that fits five hours."
  },
  {
    id: "phantom-intervention-block",
    label: "Phantom intervention \u2192 governance block",
    hint: "A selected intervention not among the candidates.",
    request: DEMO_OUTREACH_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      selected: [...VALID_DETERMINATION.selected, { id: "phantom", cost: 0, benefit: 0 }]
    },
    demonstrates:
      "The Agent Fabric blocking an allocation with a fabricated intervention not among the candidates (policy.outreach.selections-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal allocation \u2192 governance block",
    hint: "A feasible plan that leaves benefit on the table.",
    request: DEMO_OUTREACH_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      selected: SUBOPTIMAL_SELECTED,
      deferred: SUBOPTIMAL_DEFERRED,
      totalCost: 9,
      totalBenefit: 100,
      remainingCapacity: 1
    },
    demonstrates:
      "The Agent Fabric blocking a sub-optimal allocation that doesn't match the knapsack optimum (policy.outreach.allocation-optimal)."
  },
  {
    id: "auto-scheduled-block",
    label: "Outreach launched autonomously \u2192 governance block",
    hint: "An allocation that scheduled itself.",
    request: DEMO_OUTREACH_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCareLeadReview: false,
      autoScheduled: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous outreach launch (policy.outreach.no-autonomous-schedule)."
  }
];

/** Render-ready view of a produced allocation lifted from the task. */
export type OutreachResolvedView = {
  kind: "resolved";
  cycleRef: string;
  disposition: OutreachDisposition;
  selected: OutreachCandidate[];
  deferred: OutreachCandidate[];
  capacity: number;
  totalCost: number;
  totalBenefit: number;
  remainingCapacity: number;
  reason: string;
  note: string;
  outreachSelectionsSourced: boolean;
  outreachAllocationOptimal: boolean;
  outreachNoAutonomousSchedule: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type OutreachBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type OutreachInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type OutreachView = OutreachResolvedView | OutreachBlockedView | OutreachInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  outreachSelectionsSourced?: unknown;
  outreachAllocationOptimal?: unknown;
  outreachNoAutonomousSchedule?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildOutreachRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: OutreachRequest;
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
 * POST an outreach request (or an asserted allocation) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runOutreachTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: OutreachRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(OUTREACH_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildOutreachRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced allocation
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function outreachViewFromTask(task: A2ATask): OutreachView {
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
        "The Agent Fabric blocked this outreach allocation.";
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
      (typeof fabric.error === "string" ? fabric.error : "The allocation could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: OutreachDetermination; cycleRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    cycleRef: result?.cycleRef ?? det?.cycleRef ?? "",
    disposition: det?.disposition ?? "all-scheduled",
    selected: det?.selected ?? [],
    deferred: det?.deferred ?? [],
    capacity: det?.capacity ?? 0,
    totalCost: det?.totalCost ?? 0,
    totalBenefit: det?.totalBenefit ?? 0,
    remainingCapacity: det?.remainingCapacity ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    outreachSelectionsSourced: fabric.outreachSelectionsSourced === true,
    outreachAllocationOptimal: fabric.outreachAllocationOptimal === true,
    outreachNoAutonomousSchedule: fabric.outreachNoAutonomousSchedule === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<OutreachDisposition, string> = {
  "all-scheduled": "#8fd6b0",
  "some-deferred": "#ffd28a"
};

const DISPOSITION_LABEL: Record<OutreachDisposition, string> = {
  "all-scheduled": "All scheduled \u00b7 every intervention fits the capacity",
  "some-deferred": "Some deferred \u00b7 max-benefit subset within capacity"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: OutreachView }
  | { status: "error"; message: string };

export function OutreachPrioritizationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: OutreachPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runOutreachTask({
          taskId: newTaskId("outreach-prioritization"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: outreachViewFromTask(task) });
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
        Care coordination &middot; capacity planning &middot; 0/1 knapsack
      </p>
      <h3 style={{ margin: 0 }}>
        Outreach Prioritization — selections sourced, allocation optimal, never an autonomous schedule
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> selects the <strong>max-benefit subset</strong> of
        proactive <strong>interventions</strong> that fits a care team&rsquo;s fixed <strong>capacity</strong>{" "}
        (its outreach hours this cycle) &mdash; not a bin-packing, not a ranking &mdash; the{" "}
        <strong>0/1 knapsack</strong> via dynamic programming. Every selection is <strong>sourced</strong>,
        the allocation is provably <strong>optimal</strong>, and the plan is a <strong>recommendation</strong>:
        the agent <strong>never</strong> launches the outreach &mdash; a care lead confirms, and deferred
        interventions are <strong>deferred, never denied</strong>.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified planning system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {OUTREACH_PRESETS.map((preset) => (
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
              ? "Optimizing\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Allocation failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <OutreachResult view={runState.view} />}
    </section>
  );
}

function OutreachResult({ view }: { view: OutreachView }) {
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
        Allocation (deterministic, synthetic)
        {view.cycleRef ? ` \u00b7 ${view.cycleRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        capacity {view.capacity}h &middot; used {view.totalCost}h &middot; remaining{" "}
        {view.remainingCapacity}h &middot; projected benefit {view.totalBenefit}
      </p>

      {view.selected.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.5rem 0 0.2rem" }}>
            Scheduled this cycle
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              fontSize: "0.84rem",
              color: "var(--muted)"
            }}
          >
            {view.selected.map((c) => (
              <li key={c.id}>
                {c.label ?? c.id} &middot; {c.cost}h &middot; benefit {c.benefit}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.deferred.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.5rem 0 0.2rem", color: "#ffd28a" }}>
            Deferred to a later cycle (not denied)
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              fontSize: "0.84rem",
              color: "var(--muted)"
            }}
          >
            {view.deferred.map((c) => (
              <li key={c.id}>
                {c.label ?? c.id} &middot; {c.cost}h &middot; benefit {c.benefit}
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Allocation safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; optimal &middot; never an autonomous schedule{" "}
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
          outreachSelectionsSourced = {String(view.outreachSelectionsSourced)} &middot;
          outreachAllocationOptimal = {String(view.outreachAllocationOptimal)} &middot;
          outreachNoAutonomousSchedule = {String(view.outreachNoAutonomousSchedule)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
