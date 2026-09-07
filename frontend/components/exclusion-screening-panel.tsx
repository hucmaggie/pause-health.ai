"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ScreeningDetermination,
  type ScreeningRequest,
  DEMO_SCREENING_CLEAR_REQUEST,
  DEMO_SCREENING_COINCIDENCE_REQUEST,
  DEMO_SCREENING_REQUEST
} from "../lib/exclusion-screening";

/**
 * OIG Exclusion / Sanctions Screening runner for the intake demo.
 *
 * Fires the real, server-side A2A Exclusion Screening agent at /api/agents/exclusion-screening/tasks —
 * a claims / payer-operations service that screens a party against the OIG LEIE and reports an honest
 * match strength. The panel surfaces the match strength, the identifier signals (NPI / name / DOB),
 * the recommended disposition, the honesty signals, the synthetic labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A determination — match or no-match — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresComplianceReview:true, autoBlockedPayment:false, autoCleared:false). The unsourced-match,
 * overstated-match, and auto-block presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * Deliberately NOT PHI-bearing — it screens a provider / vendor's identity against a public exclusion
 * list, not a patient's health information. The catalog + match rules are ILLUSTRATIVE, NOT a certified
 * screening system. Structure, styling tokens, and tone mirror <MemberCostSharePanel> and
 * <SubrogationPanel> so this reads as a native sibling on /demo/intake.
 */

const EXCLUSION_SCREENING_ROUTE = "/api/agents/exclusion-screening/tasks";

/** A one-click demo scenario. */
export type ExclusionScreeningPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ScreeningRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const EXCLUSION_SCREENING_PRESETS: ExclusionScreeningPreset[] = [
  {
    id: "confirmed-npi",
    label: "Exact NPI hit → confirmed match",
    hint: "An excluded provider matched on NPI.",
    request: DEMO_SCREENING_REQUEST,
    demonstrates:
      "A confirmed exclusion match (NPI + name + DOB) → recommend HOLD payment pending compliance confirmation."
  },
  {
    id: "name-coincidence",
    label: "Shared last name → possible coincidence",
    hint: "A last-name match the first name / DOB refute.",
    request: DEMO_SCREENING_COINCIDENCE_REQUEST,
    demonstrates:
      "A name coincidence honestly reported as POSSIBLE (not confirmed) — likely a different person."
  },
  {
    id: "clear",
    label: "No candidate → no-match / clear",
    hint: "A clean party with no exclusion-list candidate.",
    request: DEMO_SCREENING_CLEAR_REQUEST,
    demonstrates:
      "No LEIE candidate → recommend clear, pending compliance review (never an autonomous clear)."
  },
  {
    id: "unsourced-match-block",
    label: "Match with no LEIE record → governance block",
    hint: "A confirmed match citing no cataloged record.",
    request: DEMO_SCREENING_REQUEST,
    determination: {
      partyRef: "provider-3391",
      matchStrength: "confirmed",
      matchedExclusionId: null,
      exclusionType: null,
      npiMatch: true,
      nameMatch: true,
      dobMatch: true,
      disposition: "recommend-block-pending-review",
      requiresComplianceReview: true,
      autoBlockedPayment: false,
      autoCleared: false
    },
    demonstrates:
      "The Agent Fabric blocking a match with no sourced LEIE record (policy.exclusion.match-record-sourced)."
  },
  {
    id: "overstated-match-block",
    label: "Name-only → confirmed → governance block",
    hint: "A name coincidence overstated as confirmed.",
    request: DEMO_SCREENING_COINCIDENCE_REQUEST,
    determination: {
      partyRef: "provider-7742",
      // Overstated: name doesn't even match and there's no NPI/DOB match, yet claims confirmed.
      matchStrength: "confirmed",
      matchedExclusionId: "leie-1001",
      exclusionType: "1128(a)(1) — conviction of a program-related crime",
      npiMatch: null,
      nameMatch: false,
      dobMatch: false,
      disposition: "recommend-block-pending-review",
      requiresComplianceReview: true,
      autoBlockedPayment: false,
      autoCleared: false
    },
    demonstrates:
      "The Agent Fabric blocking a match strength stronger than the signals support (policy.exclusion.match-not-overstated)."
  },
  {
    id: "auto-block-block",
    label: "Payment blocked autonomously → governance block",
    hint: "A determination that auto-blocked the payment.",
    request: DEMO_SCREENING_REQUEST,
    determination: {
      partyRef: "provider-3391",
      matchStrength: "confirmed",
      matchedExclusionId: "leie-1001",
      exclusionType: "1128(a)(1) — conviction of a program-related crime",
      npiMatch: true,
      nameMatch: true,
      dobMatch: true,
      disposition: "recommend-block-pending-review",
      // Wrong: the agent blocked the payment and skipped compliance review.
      requiresComplianceReview: false,
      autoBlockedPayment: true,
      autoCleared: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-blocked payment (policy.exclusion.no-autonomous-block-or-clear)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type ExclusionScreeningResolvedView = {
  kind: "resolved";
  partyRef: string;
  matchStrength: string;
  matchedExclusionId: string | null;
  exclusionType: string | null;
  npiMatch: boolean | null;
  nameMatch: boolean;
  dobMatch: boolean | null;
  disposition: string;
  reason: string;
  note: string;
  exclusionMatchSourced: boolean;
  exclusionMatchNotOverstated: boolean;
  exclusionNoAutonomousBlockOrClear: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ExclusionScreeningBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ExclusionScreeningInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ExclusionScreeningView =
  | ExclusionScreeningResolvedView
  | ExclusionScreeningBlockedView
  | ExclusionScreeningInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  exclusionMatchSourced?: unknown;
  exclusionMatchNotOverstated?: unknown;
  exclusionNoAutonomousBlockOrClear?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildExclusionScreeningRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ScreeningRequest;
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
 * POST a screening request (or an asserted determination) to the Exclusion Screening agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runExclusionScreeningTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ScreeningRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(EXCLUSION_SCREENING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildExclusionScreeningRequestBody(input))
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
export function exclusionScreeningViewFromTask(task: A2ATask): ExclusionScreeningView {
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
        "The Agent Fabric blocked this exclusion-screening run.";
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
        : "The screening determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: ScreeningDetermination; partyRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    partyRef: result?.partyRef ?? det?.partyRef ?? "",
    matchStrength: det?.matchStrength ?? "",
    matchedExclusionId: det?.matchedExclusionId ?? null,
    exclusionType: det?.exclusionType ?? null,
    npiMatch: det?.npiMatch ?? null,
    nameMatch: det?.nameMatch ?? false,
    dobMatch: det?.dobMatch ?? null,
    disposition: det?.disposition ?? "",
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    exclusionMatchSourced: fabric.exclusionMatchSourced === true,
    exclusionMatchNotOverstated: fabric.exclusionMatchNotOverstated === true,
    exclusionNoAutonomousBlockOrClear: fabric.exclusionNoAutonomousBlockOrClear === true,
    traceTaskId
  };
}

const STRENGTH_TONE: Record<string, string> = {
  confirmed: "#ffb6c8",
  probable: "#ffd28a",
  possible: "#9db8ff",
  "no-match": "#8fd6b0"
};

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

function signal(v: boolean | null): string {
  if (v === null) return "n/a";
  return v ? "yes" : "no";
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ExclusionScreeningView }
  | { status: "error"; message: string };

export function ExclusionScreeningPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ExclusionScreeningPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runExclusionScreeningTask({
          taskId: newTaskId("exclusion-screening"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: exclusionScreeningViewFromTask(task) });
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
        OIG exclusion · sanctions screening · payer & plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Exclusion Screening — an honest match strength, never an autonomous payment block
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Before a plan pays or contracts with a party, this agent <strong>deterministically</strong>{" "}
        screens them against the <strong>OIG LEIE</strong> and reports a match strength grounded in
        which identifiers actually matched — a <strong>confirmed</strong> match needs an NPI hit (or
        name + DOB), so a shared last name is honestly reported as a <strong>possible</strong>{" "}
        coincidence, never a confirmed exclusion. Every result is a <strong>recommendation</strong>:
        the agent <strong>never</strong> blocks a payment or clears a party on its own.{" "}
        <strong>Not PHI-bearing — it screens a provider&rsquo;s identity, and the catalog is illustrative.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {EXCLUSION_SCREENING_PRESETS.map((preset) => (
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
          Exclusion screening run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ExclusionScreeningResult view={runState.view} />}
    </section>
  );
}

function ExclusionScreeningResult({ view }: { view: ExclusionScreeningView }) {
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

  const tone = STRENGTH_TONE[view.matchStrength] ?? "#9db8ff";
  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Screening determination (deterministic, synthetic)
        {view.partyRef ? ` · ${view.partyRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Match" value={view.matchStrength} tone={tone} />{" "}
        <Pill label="Disposition" value={view.disposition} tone="#ffd28a" />
        {view.matchedExclusionId && (
          <>
            {" "}
            <Pill label="LEIE" value={view.matchedExclusionId} tone="#9db8ff" />
          </>
        )}
      </p>
      {view.exclusionType && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
          {view.exclusionType}
        </p>
      )}

      <p
        style={{
          margin: "0.5rem 0 0",
          fontSize: "0.78rem",
          color: "var(--muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
        }}
      >
        signals: NPI={signal(view.npiMatch)} · name={signal(view.nameMatch)} · DOB={signal(view.dobMatch)}
      </p>

      <div
        role="note"
        aria-label="Screening compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Match sourced · never overstated · never an autonomous block / clear{" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#8fd6b0",
              border: "1px solid #8fd6b0",
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            synthetic · not PHI
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
          exclusionMatchSourced = {String(view.exclusionMatchSourced)} · exclusionMatchNotOverstated ={" "}
          {String(view.exclusionMatchNotOverstated)} · exclusionNoAutonomousBlockOrClear ={" "}
          {String(view.exclusionNoAutonomousBlockOrClear)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
