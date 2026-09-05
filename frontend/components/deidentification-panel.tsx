"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_DEIDENTIFICATION_EXPERT_REQUEST,
  DEMO_DEIDENTIFICATION_INCOMPLETE_REQUEST,
  DEMO_DEIDENTIFICATION_REQUEST,
  DEMO_DEIDENTIFICATION_RETAINED_REQUEST,
  type DeidentificationDetermination,
  type DeidentificationRequest
} from "../lib/deidentification";

/**
 * De-Identification & Safe Harbor runner for the intake demo.
 *
 * Fires the real, server-side A2A De-Identification agent at
 * /api/agents/deidentification/tasks — the data-substrate service that screens a dataset's
 * fields against the eighteen HIPAA Safe Harbor identifier categories and decides whether
 * the dataset qualifies as de-identified. It deterministically screens every field,
 * computes which categories remain identifiable, computes whether all eighteen categories
 * were screened, validates the method citation, and decides de-identification. The panel
 * surfaces the de-identification decision, the remaining identifier categories, the release
 * flag, the honesty signals, the synthetic labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A determination — de-identified or not — is a SAFE, honest OUTPUT (it completes; a
 * not-de-identified dataset carries requiresHumanReview:true, releaseApproved:false). The
 * incomplete-screen, no-method, and release-reidentifiable presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * The Safe Harbor category catalog + generalization rules are ILLUSTRATIVE synthetics, NOT
 * a certified de-identification engine (a real determination applies the full Safe Harbor
 * method or a qualified Expert Determination under 45 CFR 164.514(b)). Structure, styling
 * tokens, and tone mirror <BalanceBillingPanel> and <GoodFaithEstimatePanel> so this reads
 * as a native sibling on /demo/intake.
 */

const DEIDENTIFICATION_ROUTE = "/api/agents/deidentification/tasks";

/** A one-click demo scenario. */
export type DeidentificationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The dataset the agent evaluates (the common case). */
  request?: DeidentificationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const DEIDENTIFICATION_PRESETS: DeidentificationPreset[] = [
  {
    id: "safe-harbor-deidentified",
    label: "Safe Harbor scrub → de-identified",
    hint: "Names + MRN removed, dates + ZIP generalized, rest attested absent.",
    request: DEMO_DEIDENTIFICATION_REQUEST,
    demonstrates:
      "All 18 Safe Harbor categories screened and no identifier remains → de-identified, release approved."
  },
  {
    id: "expert-determination",
    label: "Expert determination (cited ref) → de-identified",
    hint: "The same dataset de-identified under a cited Expert Determination.",
    request: DEMO_DEIDENTIFICATION_EXPERT_REQUEST,
    demonstrates:
      "A recognized method (Expert Determination with a cited reference) + a complete screen → de-identified."
  },
  {
    id: "retained-identifier",
    label: "MRN retained → not de-identified",
    hint: "The MRN is retained, leaving a remaining identifier.",
    request: DEMO_DEIDENTIFICATION_RETAINED_REQUEST,
    demonstrates:
      "A remaining identifier (retained MRN) → NOT de-identified; release withheld, requires human review under a DUA."
  },
  {
    id: "incomplete-screen",
    label: "Incomplete screen → not de-identified",
    hint: "Only a few categories screened; the rest neither present nor attested.",
    request: DEMO_DEIDENTIFICATION_INCOMPLETE_REQUEST,
    demonstrates:
      "An incomplete screen (fewer than 18 categories accounted for) → NOT de-identified; requires human review."
  },
  {
    id: "incomplete-screen-block",
    label: "Incomplete screen marked de-identified → governance block",
    hint: "A determination that skips categories yet claims de-identified.",
    request: DEMO_DEIDENTIFICATION_REQUEST,
    determination: {
      datasetRef: "deid-dataset-001",
      method: "safe-harbor",
      remainingIdentifierCategories: [],
      allCategoriesScreened: false,
      methodCited: true,
      deidentified: true,
      releaseApproved: true
    },
    demonstrates:
      "The Agent Fabric blocking a de-identification claim whose screen skipped a Safe Harbor category (policy.deid.all-categories-screened)."
  },
  {
    id: "no-method-block",
    label: "No cited method → governance block",
    hint: "An ad-hoc de-identification citing no recognized method.",
    request: DEMO_DEIDENTIFICATION_REQUEST,
    determination: {
      datasetRef: "deid-dataset-001",
      method: "ad-hoc",
      remainingIdentifierCategories: [],
      allCategoriesScreened: true,
      methodCited: false,
      deidentified: false,
      releaseApproved: false
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc de-identification that cites no recognized method (policy.deid.method-cited)."
  },
  {
    id: "release-reidentifiable-block",
    label: "Re-identifiable dataset released → governance block",
    hint: "A dataset with a remaining identifier marked de-identified.",
    request: DEMO_DEIDENTIFICATION_REQUEST,
    determination: {
      datasetRef: "deid-dataset-003",
      method: "safe-harbor",
      remainingIdentifierCategories: ["mrn"],
      allCategoriesScreened: true,
      methodCited: true,
      deidentified: true,
      releaseApproved: true
    },
    demonstrates:
      "The Agent Fabric blocking a re-identifiable dataset (remaining MRN) marked de-identified / released (policy.deid.no-release-of-reidentifiable)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type DeidentificationResolvedView = {
  kind: "resolved";
  datasetRef: string;
  method: string;
  fieldCount: number;
  categoriesScreened: number;
  allCategoriesScreened: boolean;
  remainingIdentifierCategoryCount: number;
  methodCited: boolean;
  deidentified: boolean;
  releaseApproved: boolean;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  remainingIdentifierCategories: string[];
  deidAllCategoriesScreened: boolean;
  deidMethodCited: boolean;
  deidNoReleaseOfReidentifiable: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type DeidentificationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type DeidentificationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type DeidentificationView =
  | DeidentificationResolvedView
  | DeidentificationBlockedView
  | DeidentificationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  deidAllCategoriesScreened?: unknown;
  deidMethodCited?: unknown;
  deidNoReleaseOfReidentifiable?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildBalanceBillingRequestBody.
 */
export function buildDeidentificationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: DeidentificationRequest;
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
 * POST a dataset (or an asserted determination) to the De-Identification agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary.
 * A governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope
 * / parse error is a non-OK response.
 */
export async function runDeidentificationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: DeidentificationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(DEIDENTIFICATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDeidentificationRequestBody(input))
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
export function deidentificationViewFromTask(task: A2ATask): DeidentificationView {
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
        "The Agent Fabric blocked this de-identification run.";
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
        : "The de-identification determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: DeidentificationDetermination; datasetRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    datasetRef: result?.datasetRef ?? det?.datasetRef ?? "",
    method: det?.method ?? "",
    fieldCount: det?.fieldCount ?? 0,
    categoriesScreened: det?.categoriesScreened?.length ?? 0,
    allCategoriesScreened: det?.allCategoriesScreened ?? false,
    remainingIdentifierCategoryCount: det?.remainingIdentifierCategories?.length ?? 0,
    methodCited: det?.methodCited ?? false,
    deidentified: det?.deidentified ?? false,
    releaseApproved: det?.releaseApproved ?? false,
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    remainingIdentifierCategories: det?.remainingIdentifierCategories ?? [],
    deidAllCategoriesScreened: fabric.deidAllCategoriesScreened === true,
    deidMethodCited: fabric.deidMethodCited === true,
    deidNoReleaseOfReidentifiable: fabric.deidNoReleaseOfReidentifiable === true,
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
  | { status: "done"; view: DeidentificationView }
  | { status: "error"; message: string };

export function DeidentificationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: DeidentificationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runDeidentificationTask({
          taskId: newTaskId("deid"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: deidentificationViewFromTask(task) });
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
        De-identification · HIPAA Safe Harbor · data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        De-identification — all eighteen categories screened, a recognized method cited,
        never a re-identifiable release
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>dataset</strong>&rsquo;s fields, the De-Identification agent{" "}
        <strong>deterministically</strong> screens them against the{" "}
        <strong>eighteen HIPAA Safe Harbor identifier categories</strong> (45 CFR
        164.514(b)(2)), computes which categories still <strong>remain identifiable</strong>,
        and decides whether the dataset is <strong>de-identified</strong> — only if all
        eighteen categories are screened, a recognized method is cited, and no identifier
        remains. A <strong>re-identifiable dataset is never released</strong> as
        de-identified; it requires human review under a data use agreement.{" "}
        <strong>
          The Safe Harbor category catalog and generalization rules are illustrative
          synthetics, not a certified de-identification engine — a real determination applies
          the full Safe Harbor method or a qualified Expert Determination under 45 CFR
          164.514(b).
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {DEIDENTIFICATION_PRESETS.map((preset) => (
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
              ? "Screening…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          De-identification run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <DeidentificationResult view={runState.view} />}
    </section>
  );
}

function DeidentificationResult({ view }: { view: DeidentificationView }) {
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
        De-identification determination (deterministic, synthetic Safe Harbor)
        {view.datasetRef ? ` · dataset ${view.datasetRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="De-identified"
          value={String(view.deidentified)}
          tone={view.deidentified ? "#8fd6b0" : "#ffd28a"}
        />{" "}
        <Pill
          label="Release"
          value={view.releaseApproved ? "approved" : "withheld"}
          tone={view.releaseApproved ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Categories screened"
          value={`${view.categoriesScreened}/18`}
          tone={view.allCategoriesScreened ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Remaining identifiers"
          value={String(view.remainingIdentifierCategoryCount)}
          tone={view.remainingIdentifierCategoryCount === 0 ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone="#ffd28a"
        />
      </p>

      <p
        style={{
          margin: "0.7rem 0 0",
          fontSize: "0.86rem",
          color: "var(--muted)"
        }}
      >
        Method: <strong style={{ color: "var(--fg)" }}>{view.method}</strong> ·{" "}
        <code>{view.fieldCount}</code> field(s)
        {view.remainingIdentifierCategories.length > 0 ? (
          <>
            {" "}
            · remaining: <code>{view.remainingIdentifierCategories.join(", ")}</code>
          </>
        ) : null}
      </p>

      <div
        role="note"
        aria-label="De-identification integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          All 18 categories screened · method cited · never a re-identifiable release{" "}
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
          deidAllCategoriesScreened = {String(view.deidAllCategoriesScreened)} ·
          deidMethodCited = {String(view.deidMethodCited)} ·
          deidNoReleaseOfReidentifiable = {String(view.deidNoReleaseOfReidentifiable)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
