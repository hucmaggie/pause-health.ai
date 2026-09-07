"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type InformationBlockingDetermination,
  type InformationBlockingRequest,
  DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
  DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST,
  DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST,
  DEMO_INFORMATION_BLOCKING_REQUEST
} from "../lib/information-blocking";

/**
 * Information Blocking (21st Century Cures Act / 45 CFR Part 171) runner for the intake demo.
 *
 * Fires the real, server-side A2A Information Blocking agent at /api/agents/information-blocking/tasks
 * — a control-plane / data-substrate compliance service that adjudicates whether an actor's practice
 * that interfered with EHI access is information blocking, or fits a recorded exception. The panel
 * surfaces the disposition, the claimed exception, any missing conditions, the honesty signals, the
 * synthetic labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — exception-met, no-interference, OR potential-blocking-needs-review — is a SAFE,
 * honest OUTPUT (it completes; it carries requiresComplianceReview:true, autoBlockedEhi:false,
 * autoReleasedEhi:false). The off-catalog-exception, overstated-exception, and auto-blocked presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * EHI-bearing — the review references a request for the patient's electronic health information. The
 * catalog + condition sets are ILLUSTRATIVE, NOT certified compliance counsel. Structure, styling
 * tokens, and tone mirror <AmendmentRequestPanel> so this reads as a native sibling on /demo/intake.
 */

const INFORMATION_BLOCKING_ROUTE = "/api/agents/information-blocking/tasks";

/** A one-click demo scenario. */
export type InformationBlockingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: InformationBlockingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const INFORMATION_BLOCKING_PRESETS: InformationBlockingPreset[] = [
  {
    id: "exception-met",
    label: "Privacy exception fully met → not blocking",
    hint: "Interference covered by a fully-satisfied exception.",
    request: DEMO_INFORMATION_BLOCKING_REQUEST,
    demonstrates:
      "A privacy-precondition hold with every required condition satisfied → NOT information blocking (exception met)."
  },
  {
    id: "no-interference",
    label: "Request fulfilled normally → not blocking",
    hint: "No interference — the rule is not implicated.",
    request: DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST,
    demonstrates:
      "The actor fulfilled the request in the standard manner → NOT information blocking (no interference)."
  },
  {
    id: "missing-condition",
    label: "Infeasibility missing a condition → needs review",
    hint: "A required condition was not satisfied.",
    request: DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
    demonstrates:
      "An infeasibility claim with no timely written response → potential information blocking (missing condition), needs review."
  },
  {
    id: "no-exception",
    label: "Interference, no exception → needs review",
    hint: "Interfered with EHI and claimed no exception.",
    request: DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST,
    demonstrates:
      "A delayed inter-network exchange with no claimed exception → potential information blocking, needs review."
  },
  {
    id: "off-catalog-exception-block",
    label: "Off-catalog exception → governance block",
    hint: "A made-up exception.",
    request: DEMO_INFORMATION_BLOCKING_REQUEST,
    determination: {
      requestRef: "ib-001",
      actorRef: "provider-2201",
      actorType: "provider",
      ehiRequestType: "access",
      interferedWithAccess: true,
      claimedExceptionId: "exception.we-made-up",
      claimedExceptionName: "made up",
      exceptionCategory: "unknown",
      requiredConditions: [],
      missingConditions: [],
      exceptionSatisfied: false,
      disposition: "potential-information-blocking-needs-review",
      requiresComplianceReview: true,
      autoBlockedEhi: false,
      autoReleasedEhi: false
    },
    demonstrates:
      "The Agent Fabric blocking an off-catalog exception (policy.information-blocking.exception-sourced)."
  },
  {
    id: "overstated-exception-block",
    label: "Exception overstated → governance block",
    hint: "'Met' while a required condition is missing.",
    request: DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
    determination: {
      requestRef: "ib-003",
      actorRef: "vendor-7788",
      actorType: "health-it-developer",
      ehiRequestType: "use",
      interferedWithAccess: true,
      claimedExceptionId: "exception.infeasibility",
      claimedExceptionName: "Infeasibility",
      exceptionCategory: "not-fulfilling",
      requiredConditions: ["infeasible-under-circumstances", "responded-within-10-business-days"],
      // Overstated: reports met + no missing conditions, but the timely-response condition is absent.
      missingConditions: [],
      exceptionSatisfied: true,
      disposition: "not-information-blocking-exception-met",
      requiresComplianceReview: true,
      autoBlockedEhi: false,
      autoReleasedEhi: false
    },
    demonstrates:
      "The Agent Fabric blocking an overstated 'exception met' (policy.information-blocking.determination-not-overstated)."
  },
  {
    id: "auto-blocked-ehi-block",
    label: "EHI withheld autonomously → governance block",
    hint: "A determination that withheld EHI itself.",
    request: DEMO_INFORMATION_BLOCKING_REQUEST,
    determination: {
      requestRef: "ib-001",
      actorRef: "provider-2201",
      actorType: "provider",
      ehiRequestType: "access",
      interferedWithAccess: true,
      claimedExceptionId: "exception.privacy",
      claimedExceptionName: "Privacy",
      exceptionCategory: "not-fulfilling",
      requiredConditions: ["privacy-precondition-unmet", "no-improper-intent"],
      missingConditions: [],
      exceptionSatisfied: true,
      disposition: "not-information-blocking-exception-met",
      // Wrong: the agent withheld EHI and skipped compliance review.
      requiresComplianceReview: false,
      autoBlockedEhi: true,
      autoReleasedEhi: false
    },
    demonstrates:
      "The Agent Fabric blocking autonomously-withheld EHI (policy.information-blocking.no-autonomous-block-or-release)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type InformationBlockingResolvedView = {
  kind: "resolved";
  requestRef: string;
  actorRef: string;
  actorType: string;
  ehiRequestType: string;
  interferedWithAccess: boolean;
  claimedExceptionId: string;
  claimedExceptionName: string | null;
  requiredConditions: string[];
  missingConditions: string[];
  exceptionSatisfied: boolean;
  disposition: string;
  reason: string;
  note: string;
  blockingExceptionSourced: boolean;
  blockingDeterminationNotOverstated: boolean;
  blockingNoAutonomousBlockOrRelease: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type InformationBlockingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type InformationBlockingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type InformationBlockingView =
  | InformationBlockingResolvedView
  | InformationBlockingBlockedView
  | InformationBlockingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  blockingExceptionSourced?: unknown;
  blockingDeterminationNotOverstated?: unknown;
  blockingNoAutonomousBlockOrRelease?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildInformationBlockingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: InformationBlockingRequest;
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
 * POST a practice review (or an asserted determination) to the Information Blocking agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runInformationBlockingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: InformationBlockingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(INFORMATION_BLOCKING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInformationBlockingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced determination
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function informationBlockingViewFromTask(task: A2ATask): InformationBlockingView {
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
        "The Agent Fabric blocked this information-blocking run.";
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
        : "The information-blocking determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: InformationBlockingDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    actorRef: det?.actorRef ?? "",
    actorType: det?.actorType ?? "",
    ehiRequestType: det?.ehiRequestType ?? "",
    interferedWithAccess: det?.interferedWithAccess ?? false,
    claimedExceptionId: det?.claimedExceptionId ?? "",
    claimedExceptionName: det?.claimedExceptionName ?? null,
    requiredConditions: det?.requiredConditions ?? [],
    missingConditions: det?.missingConditions ?? [],
    exceptionSatisfied: det?.exceptionSatisfied ?? false,
    disposition: det?.disposition ?? "",
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    blockingExceptionSourced: fabric.blockingExceptionSourced === true,
    blockingDeterminationNotOverstated: fabric.blockingDeterminationNotOverstated === true,
    blockingNoAutonomousBlockOrRelease: fabric.blockingNoAutonomousBlockOrRelease === true,
    traceTaskId
  };
}

function Pill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: `1px solid ${tone}`,
        color: tone,
        fontSize: "0.74rem",
        fontWeight: 600
      }}
    >
      {label}: {value}
    </span>
  );
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: InformationBlockingView }
  | { status: "error"; message: string };

export function InformationBlockingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: InformationBlockingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runInformationBlockingTask({
          taskId: newTaskId("information-blocking"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: informationBlockingViewFromTask(task) });
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
        Information blocking · 21st Century Cures Act · 45 CFR Part 171 · platform & data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Information Blocking — a conditions test, never an autonomous EHI hold or release
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The <strong>enforcement flip-side</strong> of the HIPAA patient-rights trilogy: where a patient
        has the RIGHT to get, fix, and audit their record, the Cures Act prohibits an actor from{" "}
        <strong>interfering</strong> with EHI access. This agent{" "}
        <strong>deterministically</strong> checks a claimed 45 CFR Part 171 exception against the
        recorded catalog and verifies <strong>every required condition is met</strong> — no date math,
        no dollar waterfall, just a conditions test. Every determination is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> withholds EHI (which could
        itself be blocking) or force-releases it (which could breach privacy).{" "}
        <strong>The catalog and conditions are illustrative, not certified compliance counsel.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {INFORMATION_BLOCKING_PRESETS.map((preset) => (
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
              ? "Adjudicating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Information-blocking run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <InformationBlockingResult view={runState.view} />}
    </section>
  );
}

function InformationBlockingResult({ view }: { view: InformationBlockingView }) {
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

  const notBlocking = view.disposition.startsWith("not-information-blocking");
  const dispoTone = notBlocking ? "#8fd6b0" : "#ffd28a";
  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Information-blocking determination (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.actorRef ? ` · ${view.actorRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Disposition" value={view.disposition} tone={dispoTone} />{" "}
        {view.claimedExceptionName && (
          <>
            <Pill
              label="Exception"
              value={`${view.claimedExceptionName}${view.exceptionSatisfied ? " ✓" : ""}`}
              tone={view.exceptionSatisfied ? "#8fd6b0" : "#9db8ff"}
            />{" "}
          </>
        )}
        {view.missingConditions.length > 0 && (
          <Pill
            label="Missing"
            value={`${view.missingConditions.length} condition(s)`}
            tone="#ffb6c8"
          />
        )}
      </p>
      {view.missingConditions.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          Unsatisfied conditions: <code>{view.missingConditions.join(", ")}</code>
        </p>
      )}

      <div
        role="note"
        aria-label="Information-blocking compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Exception sourced · never overstated · never an autonomous EHI block / release{" "}
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
            synthetic · EHI-bearing
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
          blockingExceptionSourced = {String(view.blockingExceptionSourced)} ·
          blockingDeterminationNotOverstated = {String(view.blockingDeterminationNotOverstated)} ·
          blockingNoAutonomousBlockOrRelease = {String(view.blockingNoAutonomousBlockOrRelease)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
