"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ListReconciliationDetermination,
  type ListReconciliationDisposition,
  type ListReconciliationRequest,
  DEMO_LIST_RECONCILIATION_CHANGED_REQUEST,
  DEMO_LIST_RECONCILIATION_MATCH_REQUEST,
  DEMO_LIST_RECONCILIATION_REQUEST,
  evaluateListReconciliation
} from "../lib/list-reconciliation";

/**
 * Clinical List Reconciliation / Longest-Common-Subsequence (LCS) Diff runner for the intake demo.
 *
 * Fires the real, server-side A2A List Reconciliation agent at /api/agents/list-reconciliation/tasks — a
 * care-coordination reconciliation service that diffs two ordered clinical lists via the longest common
 * subsequence and derives what was retained, added, and removed. The panel surfaces the disposition, the
 * retained / added / removed items, the honesty signals, the synthetic / PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A reconciliation — lists-match or changes-present — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresClinicianReview:true, autoApplied:false). The fabricated-retained, sub-optimal, and auto-applied
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * PHI-bearing — the lists are one patient's clinical record. The lists are an ILLUSTRATIVE synthetic, NOT a
 * certified medication-reconciliation system. Structure, styling tokens, and tone mirror <SlaWorklistPanel> so
 * this reads as a native sibling on /demo/intake.
 */

const LIST_RECONCILIATION_ROUTE = "/api/agents/list-reconciliation/tasks";

/** A one-click demo scenario. */
export type ListReconciliationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ListReconciliationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);

export const LIST_RECONCILIATION_PRESETS: ListReconciliationPreset[] = [
  {
    id: "changed",
    label: "Medication list \u2014 changes present",
    hint: "Admission vs discharge meds; one stopped, one started.",
    request: DEMO_LIST_RECONCILIATION_REQUEST,
    demonstrates:
      "LCS diff \u2014 metformin \u2192 atorvastatin \u2192 aspirin retained; lisinopril removed, estradiol added."
  },
  {
    id: "match",
    label: "Lists match",
    hint: "The two lists are identical.",
    request: DEMO_LIST_RECONCILIATION_MATCH_REQUEST,
    demonstrates: "A clean reconciliation \u2014 no changes."
  },
  {
    id: "problem-list",
    label: "Problem list \u2014 several changes",
    hint: "Two problems removed, two added.",
    request: DEMO_LIST_RECONCILIATION_CHANGED_REQUEST,
    demonstrates: "insomnia \u2192 hypertension retained; hot-flashes + osteopenia removed, osteoporosis + anxiety added."
  },
  {
    id: "phantom-retained-block",
    label: "Fabricated retained item \u2192 governance block",
    hint: "A retained order that isn't a real subsequence.",
    request: DEMO_LIST_RECONCILIATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      retained: ["metformin", "aspirin", "atorvastatin"]
    },
    demonstrates:
      "The Agent Fabric blocking a diff whose retained list isn't a real common subsequence (policy.listdiff.diff-sourced)."
  },
  {
    id: "suboptimal-block",
    label: "Sub-optimal subsequence \u2192 governance block",
    hint: "A shorter common subsequence that over-reports change.",
    request: DEMO_LIST_RECONCILIATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      retained: ["metformin", "aspirin"],
      removed: ["lisinopril", "atorvastatin"],
      added: ["atorvastatin", "estradiol"],
      lcsLength: 2
    },
    demonstrates:
      "The Agent Fabric blocking a common subsequence that isn't the longest (policy.listdiff.lcs-optimal)."
  },
  {
    id: "auto-applied-block",
    label: "Applied autonomously \u2192 governance block",
    hint: "A reconciliation that wrote the chart itself.",
    request: DEMO_LIST_RECONCILIATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresClinicianReview: false,
      autoApplied: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous update (policy.listdiff.no-autonomous-update)."
  }
];

/** Render-ready view of a produced reconciliation lifted from the task. */
export type ListReconciliationResolvedView = {
  kind: "resolved";
  recordRef: string;
  disposition: ListReconciliationDisposition;
  retained: string[];
  added: string[];
  removed: string[];
  lcsLength: number;
  reason: string;
  note: string;
  listDiffSourced: boolean;
  listDiffLcsOptimal: boolean;
  listDiffNoAutonomousUpdate: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ListReconciliationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ListReconciliationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ListReconciliationView =
  | ListReconciliationResolvedView
  | ListReconciliationBlockedView
  | ListReconciliationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  listDiffSourced?: unknown;
  listDiffLcsOptimal?: unknown;
  listDiffNoAutonomousUpdate?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildListReconciliationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ListReconciliationRequest;
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
 * POST a reconciliation request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runListReconciliationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ListReconciliationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(LIST_RECONCILIATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildListReconciliationRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * reconciliation (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function listReconciliationViewFromTask(task: A2ATask): ListReconciliationView {
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
        "The Agent Fabric blocked this reconciliation.";
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
      (typeof fabric.error === "string" ? fabric.error : "The reconciliation could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: ListReconciliationDetermination; recordRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    recordRef: result?.recordRef ?? det?.recordRef ?? "",
    disposition: det?.disposition ?? "lists-match",
    retained: det?.retained ?? [],
    added: det?.added ?? [],
    removed: det?.removed ?? [],
    lcsLength: det?.lcsLength ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    listDiffSourced: fabric.listDiffSourced === true,
    listDiffLcsOptimal: fabric.listDiffLcsOptimal === true,
    listDiffNoAutonomousUpdate: fabric.listDiffNoAutonomousUpdate === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ListReconciliationDisposition, string> = {
  "lists-match": "#8fd6b0",
  "changes-present": "#ffd28a"
};

const DISPOSITION_LABEL: Record<ListReconciliationDisposition, string> = {
  "lists-match": "Lists match \u00b7 no changes between the two lists",
  "changes-present": "Changes present \u00b7 LCS retains the preserved items, flags the adds & removes"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ListReconciliationView }
  | { status: "error"; message: string };

export function ListReconciliationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ListReconciliationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runListReconciliationTask({
          taskId: newTaskId("list-reconciliation"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: listReconciliationViewFromTask(task) });
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
        Care coordination &middot; list reconciliation &middot; longest common subsequence
      </p>
      <h3 style={{ margin: 0 }}>
        Clinical List Reconciliation — diff sourced &amp; self-consistent, LCS recomputed, never an autonomous
        update
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> diffs a <strong>prior</strong> and a{" "}
        <strong>current</strong> ordered clinical list via the{" "}
        <strong>longest common subsequence</strong> &mdash; the items <strong>preserved in both</strong>, in
        order &mdash; then derives what was <strong>added</strong> and <strong>removed</strong>. Every retained
        item is a <strong>real common subsequence</strong>, the common subsequence is the{" "}
        <strong>proven longest</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> writes the reconciled list back or changes a medication &mdash; a clinician
        confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified medication-reconciliation system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {LIST_RECONCILIATION_PRESETS.map((preset) => (
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
              ? "Reconciling\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Reconciliation failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ListReconciliationResult view={runState.view} />}
    </section>
  );
}

function ListReconciliationResult({ view }: { view: ListReconciliationView }) {
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
        Reconciliation (deterministic, synthetic)
        {view.recordRef ? ` \u00b7 ${view.recordRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.retained.length} retained &middot; {view.added.length} added &middot; {view.removed.length}{" "}
        removed
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
        <ReconColumn title="Retained" tone="#8fd6b0" items={view.retained} />
        <ReconColumn title="Added" tone="#8fd6b0" items={view.added} prefix="+" />
        <ReconColumn title="Removed" tone="#ffb6c8" items={view.removed} prefix={"\u2212"} />
      </div>

      <div
        role="note"
        aria-label="Reconciliation safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; LCS-optimal &middot; never an autonomous update{" "}
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
            synthetic &middot; PHI
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
          listDiffSourced = {String(view.listDiffSourced)} &middot; listDiffLcsOptimal ={" "}
          {String(view.listDiffLcsOptimal)} &middot; listDiffNoAutonomousUpdate ={" "}
          {String(view.listDiffNoAutonomousUpdate)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}

function ReconColumn({
  title,
  tone,
  items,
  prefix
}: {
  title: string;
  tone: string;
  items: string[];
  prefix?: string;
}) {
  return (
    <div style={{ minWidth: "8rem" }}>
      <p className="eyebrow" style={{ margin: "0 0 0.2rem", color: tone }}>
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>&mdash;</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)", fontSize: "0.84rem" }}>
          {items.map((item, i) => (
            <li key={`${item}-${i}`}>
              {prefix ? `${prefix} ` : ""}
              <code>{item}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
