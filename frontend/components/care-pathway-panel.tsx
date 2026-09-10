"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CarePathwayDetermination,
  type CarePathwayDisposition,
  type PathwayStep,
  type UnmetPrerequisite,
  DEMO_CARE_PATHWAY_CYCLE_REQUEST,
  DEMO_CARE_PATHWAY_MISSING_REQUEST,
  DEMO_CARE_PATHWAY_REQUEST
} from "../lib/care-pathway";

/**
 * Care Pathway Sequencing runner for the intake demo.
 *
 * Fires the real, server-side A2A Care Pathway agent at /api/agents/care-pathway/tasks — a
 * clinical-decision service that topologically orders a pathway's steps to respect their prerequisite
 * dependencies. The panel surfaces the disposition, the ordered stages (or the detected cycle / missing
 * prerequisites), the honesty signals, the synthetic / PHI labels, and a deep link into the parented
 * Agent Fabric trace.
 *
 * A determination — a sequenced pathway, a detected cycle, OR a missing prerequisite — is a SAFE,
 * honest OUTPUT (it completes; it carries requiresClinicianReview:true, autoExecuted:false). The
 * fabricated-step, invalid-order, and auto-executed presets assert offending DETERMINATIONS — so all
 * three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the pathway references the patient. The pathways are ILLUSTRATIVE, NOT a certified
 * clinical pathway engine. Structure, styling tokens, and tone mirror <EnrollmentReconciliationPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const CARE_PATHWAY_ROUTE = "/api/agents/care-pathway/tasks";

/** A one-click demo scenario. */
export type CarePathwayPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: { requestRef: string; pathwayRef: string; patientRef: string; steps: PathwayStep[] };
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const CARE_PATHWAY_PRESETS: CarePathwayPreset[] = [
  {
    id: "sequenced",
    label: "Menopause work-up pathway → sequenced",
    hint: "A clean dependency graph.",
    request: DEMO_CARE_PATHWAY_REQUEST,
    demonstrates:
      "The topological sort at work — labs first, then diagnosis + risk screening in parallel, then shared decision-making, therapy, and follow-up."
  },
  {
    id: "cycle",
    label: "Circular dependency → cannot sequence",
    hint: "A depends on C, B on A, C on B.",
    request: DEMO_CARE_PATHWAY_CYCLE_REQUEST,
    demonstrates:
      "A pathway whose steps form a cycle → no valid order exists; the agent flags the cycle for clinician review."
  },
  {
    id: "missing",
    label: "Missing prerequisite → cannot sequence",
    hint: "A step depends on a step not in the pathway.",
    request: DEMO_CARE_PATHWAY_MISSING_REQUEST,
    demonstrates:
      "A step references a prerequisite that isn't in the pathway → the agent flags the dangling dependency for clinician review."
  },
  {
    id: "fabricated-step-block",
    label: "Fabricated step → governance block",
    hint: "The order lists a step not in the pathway.",
    request: DEMO_CARE_PATHWAY_REQUEST,
    determination: {
      requestRef: "pathway-001",
      pathwayRef: "menopause-workup-v1",
      patientRef: "patient-4821",
      disposition: "sequenced",
      // Wrong: sX is not one of the submitted steps.
      orderedSteps: ["s1", "sX"],
      stageByStep: { s1: 0, sX: 1 },
      cycleMembers: [],
      unmetPrerequisites: [],
      steps: [
        { stepId: "s1", name: "Baseline labs", prerequisites: [] }
      ],
      requiresClinicianReview: true,
      autoExecuted: false
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated / dangling step id (policy.pathway.steps-sourced)."
  },
  {
    id: "invalid-order-block",
    label: "Prerequisite violated → governance block",
    hint: "A step ordered before its prerequisite.",
    request: DEMO_CARE_PATHWAY_REQUEST,
    determination: {
      requestRef: "pathway-001",
      pathwayRef: "menopause-workup-v1",
      patientRef: "patient-4821",
      disposition: "sequenced",
      // Wrong: s2 depends on s1 but is ordered before it.
      orderedSteps: ["s2", "s1"],
      stageByStep: { s2: 0, s1: 1 },
      cycleMembers: [],
      unmetPrerequisites: [],
      steps: [
        { stepId: "s1", name: "Baseline labs", prerequisites: [] },
        { stepId: "s2", name: "Confirm diagnosis", prerequisites: ["s1"] }
      ],
      requiresClinicianReview: true,
      autoExecuted: false
    },
    demonstrates:
      "The Agent Fabric blocking a sequence that violates a prerequisite (policy.pathway.sequence-valid)."
  },
  {
    id: "auto-executed-block",
    label: "Steps executed autonomously → governance block",
    hint: "A determination that ordered the steps itself.",
    request: DEMO_CARE_PATHWAY_REQUEST,
    determination: {
      requestRef: "pathway-001",
      pathwayRef: "menopause-workup-v1",
      patientRef: "patient-4821",
      disposition: "sequenced",
      orderedSteps: ["s1", "s2"],
      stageByStep: { s1: 0, s2: 1 },
      cycleMembers: [],
      unmetPrerequisites: [],
      steps: [
        { stepId: "s1", name: "Baseline labs", prerequisites: [] },
        { stepId: "s2", name: "Confirm diagnosis", prerequisites: ["s1"] }
      ],
      // Wrong: the agent executed the steps and skipped clinician review.
      requiresClinicianReview: false,
      autoExecuted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous step execution (policy.pathway.no-autonomous-execution)."
  }
];

/** Render-ready view of a produced sequencing lifted from the task. */
export type CarePathwayResolvedView = {
  kind: "resolved";
  requestRef: string;
  pathwayRef: string;
  disposition: CarePathwayDisposition;
  orderedSteps: string[];
  stageByStep: Record<string, number>;
  cycleMembers: string[];
  unmetPrerequisites: UnmetPrerequisite[];
  steps: PathwayStep[];
  reason: string;
  note: string;
  pathwayStepsSourced: boolean;
  pathwaySequenceValid: boolean;
  pathwayNoAutonomousExecution: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CarePathwayBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CarePathwayInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CarePathwayView =
  | CarePathwayResolvedView
  | CarePathwayBlockedView
  | CarePathwayInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  pathwayStepsSourced?: unknown;
  pathwaySequenceValid?: unknown;
  pathwayNoAutonomousExecution?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCarePathwayRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: { requestRef: string; pathwayRef: string; patientRef: string; steps: PathwayStep[] };
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
 * POST a pathway request (or an asserted determination) to the Care Pathway agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runCarePathwayTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: { requestRef: string; pathwayRef: string; patientRef: string; steps: PathwayStep[] };
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CARE_PATHWAY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCarePathwayRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * sequencing (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function carePathwayViewFromTask(task: A2ATask): CarePathwayView {
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
        "The Agent Fabric blocked this care-pathway run.";
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
        : "The care pathway could not be sequenced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: CarePathwayDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    pathwayRef: det?.pathwayRef ?? "",
    disposition: det?.disposition ?? "sequenced",
    orderedSteps: det?.orderedSteps ?? [],
    stageByStep: det?.stageByStep ?? {},
    cycleMembers: det?.cycleMembers ?? [],
    unmetPrerequisites: det?.unmetPrerequisites ?? [],
    steps: det?.steps ?? [],
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    pathwayStepsSourced: fabric.pathwayStepsSourced === true,
    pathwaySequenceValid: fabric.pathwaySequenceValid === true,
    pathwayNoAutonomousExecution: fabric.pathwayNoAutonomousExecution === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CarePathwayDisposition, string> = {
  sequenced: "#8fd6b0",
  "cannot-sequence-cycle-detected": "#ffb6c8",
  "cannot-sequence-missing-prerequisite": "#ffd28a"
};

const DISPOSITION_LABEL: Record<CarePathwayDisposition, string> = {
  sequenced: "Sequenced",
  "cannot-sequence-cycle-detected": "Cannot sequence — cycle detected",
  "cannot-sequence-missing-prerequisite": "Cannot sequence — missing prerequisite"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CarePathwayView }
  | { status: "error"; message: string };

export function CarePathwayPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CarePathwayPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCarePathwayTask({
          taskId: newTaskId("care-pathway"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: carePathwayViewFromTask(task) });
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
        Care pathway · step sequencing · patient &amp; clinical
      </p>
      <h3 style={{ margin: 0 }}>
        Care Pathway Sequencing — every step sourced, the order respects every prerequisite, never an
        autonomous execution
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> orders a clinical pathway&rsquo;s steps to respect
        their <strong>prerequisite dependencies</strong> — a{" "}
        <strong>topological sort (Kahn&rsquo;s algorithm)</strong> that detects{" "}
        <strong>dependency cycles</strong> and <strong>missing prerequisites</strong>. No set-difference,
        no dollar waterfall — a graph ordering. Every step is <strong>sourced</strong>, the order places
        every step <strong>after all its prerequisites</strong>, and the result is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> executes a step — a clinician
        orders every one.{" "}
        <strong>PHI-bearing · illustrative pathways, not a certified pathway engine.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_PATHWAY_PRESETS.map((preset) => (
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
              ? "Sequencing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Sequencing run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CarePathwayResult view={runState.view} />}
    </section>
  );
}

function CarePathwayResult({ view }: { view: CarePathwayView }) {
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

  const nameById = new Map(view.steps.map((s) => [s.stepId, s.name]));
  const tone = DISPOSITION_TONE[view.disposition];

  // Group the ordered steps by stage for a staged display.
  const stages: Array<{ stage: number; steps: string[] }> = [];
  if (view.disposition === "sequenced") {
    const byStage = new Map<number, string[]>();
    for (const id of view.orderedSteps) {
      const st = view.stageByStep[id] ?? 0;
      if (!byStage.has(st)) byStage.set(st, []);
      byStage.get(st)!.push(id);
    }
    for (const st of Array.from(byStage.keys()).sort((a, b) => a - b)) {
      stages.push({ stage: st, steps: byStage.get(st)! });
    }
  }

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Sequencing (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.pathwayRef ? ` · ${view.pathwayRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      {view.disposition === "sequenced" && (
        <ol
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {stages.map((s) => (
            <li key={s.stage} style={{ marginBottom: "0.2rem" }}>
              <strong>Stage {s.stage + 1}:</strong>{" "}
              {s.steps.map((id) => `${id} · ${nameById.get(id) ?? id}`).join("  |  ")}
            </li>
          ))}
        </ol>
      )}

      {view.disposition === "cannot-sequence-cycle-detected" && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          Circular dependency involves: {view.cycleMembers.join(", ")}
        </p>
      )}

      {view.disposition === "cannot-sequence-missing-prerequisite" && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.unmetPrerequisites.map((u) => (
            <li key={u.stepId}>
              <strong>{u.stepId}</strong> · {nameById.get(u.stepId) ?? u.stepId} → missing:{" "}
              {u.missing.join(", ")}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Sequencing safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced · valid order · never an autonomous execution{" "}
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
          pathwayStepsSourced = {String(view.pathwayStepsSourced)} · pathwaySequenceValid ={" "}
          {String(view.pathwaySequenceValid)} · pathwayNoAutonomousExecution ={" "}
          {String(view.pathwayNoAutonomousExecution)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
