"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_MINIMUM_NECESSARY_BULK_REQUEST,
  DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST,
  DEMO_MINIMUM_NECESSARY_REQUEST,
  DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST,
  type DisclosureRequest,
  type FieldDecision,
  type MinimumNecessaryDetermination
} from "../lib/minimum-necessary";

/**
 * Minimum Necessary (HIPAA) runner for the intake demo.
 *
 * Fires the real, server-side A2A Minimum Necessary agent at /api/agents/minimum-necessary/tasks
 * — the data-substrate service that decides whether a PHI disclosure is limited to the minimum
 * necessary for its stated purpose-of-use + requestor role. It deterministically resolves the
 * governing purpose-of-use rule and decides per field release vs. withhold. The panel surfaces
 * the per-field decisions, the released / withheld counts, the minimum-necessary + human-review
 * flags, the honesty signals, the synthetic labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A determination — minimum-necessary or narrowed — is a SAFE, honest OUTPUT (it completes; a
 * narrowed / bulk disclosure carries requiresHumanReview:true). The un-sourced, over-scope, and
 * auto-approved presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The purpose-of-use catalog + category mappings are ILLUSTRATIVE synthetics, NOT a certified
 * minimum-necessary engine (a real determination uses the covered entity's role-based access
 * policies under 45 CFR 164.502(b) / 164.514(d)). Structure, styling tokens, and tone mirror
 * <DeidentificationPanel> and <ImmunizationPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const MINIMUM_NECESSARY_ROUTE = "/api/agents/minimum-necessary/tasks";

/** A one-click demo scenario. */
export type MinimumNecessaryPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The disclosure request the agent evaluates (the common case). */
  request?: DisclosureRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const MINIMUM_NECESSARY_PRESETS: MinimumNecessaryPreset[] = [
  {
    id: "payment-narrowed",
    label: "Billing asks for a clinical note → withheld",
    hint: "Payment purpose requesting payment fields plus a clinical note.",
    request: DEMO_MINIMUM_NECESSARY_REQUEST,
    demonstrates:
      "The clinical note is out-of-scope for payment → withheld; the rest released (not minimum-necessary as submitted → human review)."
  },
  {
    id: "payment-inscope",
    label: "Payment, fully in scope → all released",
    hint: "Payment purpose requesting only payment-scoped fields.",
    request: DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST,
    demonstrates:
      "Every requested field is within the minimum-necessary scope for payment → all released, no review required."
  },
  {
    id: "treatment-exempt",
    label: "Treatment → exempt, all released",
    hint: "A treating clinician requesting broad clinical fields.",
    request: DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST,
    demonstrates:
      "Treatment is exempt from the minimum-necessary standard → all fields released, no review required."
  },
  {
    id: "research-bulk",
    label: "Research cohort pull → human review",
    hint: "A researcher pulling a cohort of diagnoses + labs.",
    request: DEMO_MINIMUM_NECESSARY_BULK_REQUEST,
    demonstrates:
      "In-scope but a bulk / cohort disclosure → released fields, human review required (never autonomously released)."
  },
  {
    id: "no-purpose-block",
    label: "Un-sourced purpose → governance block",
    hint: "A determination citing a purpose not in the catalog.",
    request: DEMO_MINIMUM_NECESSARY_REQUEST,
    determination: {
      requestRef: "mn-request-001",
      purposeId: "purpose.we-made-up",
      fieldDecisions: [
        { name: "patient.ssn", category: "ssn", decision: "release" }
      ],
      minimumNecessary: true,
      bulk: false,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking a disclosure that cites no recorded purpose-of-use (policy.minnec.purpose-of-use-sourced)."
  },
  {
    id: "over-scope-block",
    label: "Out-of-scope field released → governance block",
    hint: "A payment determination releasing a psychotherapy note.",
    request: DEMO_MINIMUM_NECESSARY_REQUEST,
    determination: {
      requestRef: "mn-request-001",
      purposeId: "purpose.payment",
      fieldDecisions: [
        { name: "encounter.psychNote", category: "psychotherapy-notes", decision: "release" }
      ],
      minimumNecessary: true,
      bulk: false,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking a released field beyond the minimum-necessary scope (policy.minnec.minimum-necessary-scoped)."
  },
  {
    id: "autonomous-block",
    label: "Over-scope auto-approved → governance block",
    hint: "A not-minimum-necessary determination that skips human review.",
    request: DEMO_MINIMUM_NECESSARY_REQUEST,
    determination: {
      requestRef: "mn-request-001",
      purposeId: "purpose.payment",
      fieldDecisions: [
        { name: "patient.demographics", category: "demographics", decision: "release" }
      ],
      minimumNecessary: false,
      bulk: false,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking an over-scope disclosure that was auto-approved without human review (policy.minnec.no-autonomous-over-disclosure)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type MinimumNecessaryResolvedView = {
  kind: "resolved";
  requestRef: string;
  purposeId: string;
  requestorRole: string;
  recordScope: string;
  exempt: boolean;
  fieldDecisions: FieldDecision[];
  releasedCount: number;
  withheldCount: number;
  minimumNecessary: boolean;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  minNecPurposeSourced: boolean;
  minNecScoped: boolean;
  minNecNoAutonomousOverDisclosure: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type MinimumNecessaryBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type MinimumNecessaryInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type MinimumNecessaryView =
  | MinimumNecessaryResolvedView
  | MinimumNecessaryBlockedView
  | MinimumNecessaryInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  minNecPurposeSourced?: unknown;
  minNecScoped?: unknown;
  minNecNoAutonomousOverDisclosure?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildImmunizationRequestBody.
 */
export function buildMinimumNecessaryRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: DisclosureRequest;
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
 * POST a disclosure request (or an asserted determination) to the Minimum Necessary agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only a malformed
 * envelope / parse error is a non-OK response.
 */
export async function runMinimumNecessaryTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: DisclosureRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(MINIMUM_NECESSARY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMinimumNecessaryRequestBody(input))
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
export function minimumNecessaryViewFromTask(task: A2ATask): MinimumNecessaryView {
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
        "The Agent Fabric blocked this minimum-necessary run.";
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
        : "The minimum-necessary determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: MinimumNecessaryDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    purposeId: det?.purposeId ?? "",
    requestorRole: det?.requestorRole ?? "",
    recordScope: det?.recordScope ?? "",
    exempt: det?.exempt ?? false,
    fieldDecisions: det?.fieldDecisions ?? [],
    releasedCount: det?.releasedCount ?? 0,
    withheldCount: det?.withheldCount ?? 0,
    minimumNecessary: det?.minimumNecessary ?? false,
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    minNecPurposeSourced: fabric.minNecPurposeSourced === true,
    minNecScoped: fabric.minNecScoped === true,
    minNecNoAutonomousOverDisclosure: fabric.minNecNoAutonomousOverDisclosure === true,
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
  | { status: "done"; view: MinimumNecessaryView }
  | { status: "error"; message: string };

export function MinimumNecessaryPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: MinimumNecessaryPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runMinimumNecessaryTask({
          taskId: newTaskId("minimum-necessary"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: minimumNecessaryViewFromTask(task) });
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
        Minimum necessary · purpose-of-use scoping · data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Minimum Necessary — purpose-of-use-sourced, scoped release, never an autonomous
        over-disclosure
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>disclosure request</strong> (requestor role, purpose-of-use, requested
        fields by category, record scope), the Minimum Necessary agent{" "}
        <strong>deterministically</strong> resolves the governing{" "}
        <strong>purpose-of-use rule</strong> and decides per field whether it is within the{" "}
        <strong>minimum-necessary scope</strong> (release) or beyond it (withhold). Treatment is{" "}
        <strong>exempt</strong>; an over-scope or bulk disclosure requires{" "}
        <strong>human review</strong>, never an autonomous release.{" "}
        <strong>
          The purpose catalog and category mappings are illustrative synthetics, not a certified
          minimum-necessary engine — a real determination uses the covered entity&apos;s
          role-based access policies under 45 CFR 164.502(b) / 164.514(d).
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {MINIMUM_NECESSARY_PRESETS.map((preset) => (
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
              ? "Scoping…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Minimum-necessary run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <MinimumNecessaryResult view={runState.view} />}
    </section>
  );
}

function MinimumNecessaryResult({ view }: { view: MinimumNecessaryView }) {
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

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Minimum-necessary determination (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""} · {view.purposeId} · {view.requestorRole}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Released" value={String(view.releasedCount)} tone="#8fd6b0" />{" "}
        <Pill label="Withheld" value={String(view.withheldCount)} tone="#ffb6c8" />{" "}
        <Pill
          label="Minimum necessary"
          value={String(view.minimumNecessary)}
          tone={view.minimumNecessary ? "#8fd6b0" : "#ffd28a"}
        />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone={view.requiresHumanReview ? "#ffd28a" : "#8fd6b0"}
        />
        {view.exempt ? <> <Pill label="Exempt" value="treatment" tone="#8fd6b0" /></> : null}
      </p>

      <ul style={{ margin: "0.7rem 0 0", paddingLeft: "1.1rem", fontSize: "0.86rem" }}>
        {view.fieldDecisions.map((f) => (
          <li key={f.name} style={{ marginBottom: "0.2rem" }}>
            <strong style={{ color: "var(--fg)" }}>{f.name}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>({f.category})</span> —{" "}
            <span
              style={{
                color: f.decision === "release" ? "#8fd6b0" : "#ffb6c8",
                fontWeight: 600
              }}
            >
              {f.decision}
            </span>
          </li>
        ))}
      </ul>

      <div
        role="note"
        aria-label="Minimum-necessary integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Purpose-of-use-sourced · scoped release · never an autonomous over-disclosure{" "}
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
            synthetic
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
          minNecPurposeSourced = {String(view.minNecPurposeSourced)} · minNecScoped ={" "}
          {String(view.minNecScoped)} · minNecNoAutonomousOverDisclosure ={" "}
          {String(view.minNecNoAutonomousOverDisclosure)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
