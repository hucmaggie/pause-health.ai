"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_CLEAN_CLAIM,
  DEMO_DUPLICATE_CLAIM,
  DEMO_LCD_PEND_CLAIM,
  DEMO_MULTI_EDIT_CLAIM,
  type ClaimAdjudicationDecision,
  type ClaimAdjudicationRequest
} from "../lib/claims-adjudication";

/**
 * Claims Adjudication runner for the intake demo.
 *
 * Fires the real, server-side A2A claims-adjudication agent at
 * /api/agents/claims-adjudication/tasks — first-pass payer-side
 * adjudication. Deterministically classifies as clean-pay / pend / deny-
 * drafted with a specific reason code and routes non-clean items to a
 * human. Never autonomously finalizes a denial.
 */

const CLAIMS_ROUTE = "/api/agents/claims-adjudication/tasks";

/** A one-click demo scenario. */
export type ClaimsAdjudicationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: ClaimAdjudicationRequest;
  decisionOverride?: ClaimAdjudicationDecision;
};

export const CLAIMS_ADJUDICATION_PRESETS: ClaimsAdjudicationPreset[] = [
  {
    id: "clean-pay",
    label: "Clean-pay · office visit + DEXA",
    hint: "In-network, prior auth on file, timely-filing, no LCD/NCD flags.",
    request: DEMO_CLEAN_CLAIM,
    demonstrates:
      "The agent clean-paying a clean claim — no edits hit, auto-post — with all three honesty signals green."
  },
  {
    id: "deny-duplicate",
    label: "Deny-drafted · duplicate submission (CO-18)",
    hint: "Same claim fingerprint as a previously-paid claim.",
    request: DEMO_DUPLICATE_CLAIM,
    demonstrates:
      "The agent drafting a duplicate-submission denial (CO-18), routing it to an adjudicator with a cosign requirement — the agent NEVER finalizes a denial on its own."
  },
  {
    id: "pend-lcd",
    label: "Pend-clinical-review · LCD (CO-50)",
    hint: "Menopause DEXA under LCD medical-necessity review.",
    request: DEMO_LCD_PEND_CLAIM,
    demonstrates:
      "The agent pending an LCD-flagged claim for clinical-reviewer sign-off with CO-50 — no autonomous action, no reasonless pend."
  },
  {
    id: "multi-edit",
    label: "Multi-edit · deny wins (CO-29 timely filing)",
    hint: "Out-of-network + no prior auth + past timely-filing window.",
    request: DEMO_MULTI_EDIT_CLAIM,
    demonstrates:
      "The agent applying the decision precedence (deny > pend-clinical > pend-adjudicator) — timely-filing wins over prior-auth and OON pends. All edits catalog-sourced, primary reason code CO-29."
  },
  {
    id: "offcat-edit-block",
    label: "Off-catalog edit → governance block",
    hint: "Caller-asserted decision cites a fabricated edit.",
    request: DEMO_CLEAN_CLAIM,
    decisionOverride: {
      claimRef: DEMO_CLEAN_CLAIM.claimRef,
      memberRef: DEMO_CLEAN_CLAIM.memberRef,
      asOfDate: DEMO_CLEAN_CLAIM.asOfDate,
      decision: "deny-drafted",
      appliedEdits: [
        {
          editId: "edit.made-up",
          editLabel: "Fake edit",
          reasonCode: "reason.CO-18",
          reasonLabel: "duplicate",
          detail: "fabricated"
        }
      ],
      primaryReasonCode: "reason.CO-18",
      routedTo: "adjudicator",
      totalBilledCents: 10000,
      requiresAdjudicatorCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a decision that cites an off-catalog edit (policy.claims.edit-catalog-sourced) — the guard against fabricated 'you owe us more' edits."
  },
  {
    id: "auto-cosign-block",
    label: "Auto-cosigned denial → governance block",
    hint: "Caller-asserted denial claims cosigned:true.",
    request: DEMO_DUPLICATE_CLAIM,
    decisionOverride: {
      claimRef: DEMO_DUPLICATE_CLAIM.claimRef,
      memberRef: DEMO_DUPLICATE_CLAIM.memberRef,
      asOfDate: DEMO_DUPLICATE_CLAIM.asOfDate,
      decision: "deny-drafted",
      appliedEdits: [
        {
          editId: "edit.duplicate-submission",
          editLabel: "duplicate",
          reasonCode: "reason.CO-18",
          reasonLabel: "duplicate",
          detail: "dup"
        }
      ],
      primaryReasonCode: "reason.CO-18",
      routedTo: "adjudicator",
      totalBilledCents: 10000,
      requiresAdjudicatorCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned denial (policy.claims.no-autonomous-denial) — denial letters are legally consequential and require an adjudicator sign-off."
  },
  {
    id: "no-reason-block",
    label: "Reasonless denial → governance block",
    hint: "Caller-asserted denial with primaryReasonCode:null.",
    request: DEMO_DUPLICATE_CLAIM,
    decisionOverride: {
      claimRef: DEMO_DUPLICATE_CLAIM.claimRef,
      memberRef: DEMO_DUPLICATE_CLAIM.memberRef,
      asOfDate: DEMO_DUPLICATE_CLAIM.asOfDate,
      decision: "deny-drafted",
      appliedEdits: [
        {
          editId: "edit.duplicate-submission",
          editLabel: "duplicate",
          reasonCode: "reason.CO-18",
          reasonLabel: "duplicate",
          detail: "dup"
        }
      ],
      primaryReasonCode: null,
      routedTo: "adjudicator",
      totalBilledCents: 10000,
      requiresAdjudicatorCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a non-clean-pay decision that doesn't cite a reason code (policy.claims.reason-code-integrity) — under Section 1557 / state code / CMS a denial notice must state the specific reason."
  }
];

/** Render-ready view of a produced decision. */
export type ClaimsReportedView = {
  kind: "reported";
  decision: ClaimAdjudicationDecision;
  editsTraceToCatalog: boolean;
  denialRequiresAdjudicatorCosign: boolean;
  decisionsCiteReasonCodes: boolean;
  traceTaskId: string;
};

export type ClaimsBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type ClaimsInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ClaimsAdjudicationView =
  | ClaimsReportedView
  | ClaimsBlockedView
  | ClaimsInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  editsTraceToCatalog?: unknown;
  denialRequiresAdjudicatorCosign?: unknown;
  decisionsCiteReasonCodes?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildClaimsAdjudicationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ClaimAdjudicationRequest;
  decisionOverride?: ClaimAdjudicationDecision;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.decisionOverride !== undefined) {
    data.decisionOverride = input.decisionOverride;
  }
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

export async function runClaimsAdjudicationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ClaimAdjudicationRequest;
    decisionOverride?: ClaimAdjudicationDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CLAIMS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildClaimsAdjudicationRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function claimsAdjudicationViewFromTask(task: A2ATask): ClaimsAdjudicationView {
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
        "The Agent Fabric blocked this claim adjudication.";
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
        : "The claim adjudication could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: ClaimAdjudicationDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The claim adjudication could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    editsTraceToCatalog: fabric.editsTraceToCatalog === true,
    denialRequiresAdjudicatorCosign: fabric.denialRequiresAdjudicatorCosign === true,
    decisionsCiteReasonCodes: fabric.decisionsCiteReasonCodes === true,
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

const DECISION_TONE: Record<string, string> = {
  "clean-pay": "#8fd6b0",
  "pend-clinical-review": "#ffd28a",
  "pend-adjudicator-review": "#ffd28a",
  "deny-drafted": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ClaimsAdjudicationView }
  | { status: "error"; message: string };

export function ClaimsAdjudicationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: ClaimsAdjudicationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runClaimsAdjudicationTask({
          taskId: newTaskId("claim"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: claimsAdjudicationViewFromTask(task)
        });
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
        Claims Adjudication Assistant · first-pass payer-side
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that clean-pays, pends, or drafts a denial with a specific reason
        code — never autonomously finalizes a denial
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The claims-adjudication agent applies payer-specific{" "}
        <strong>catalog edits</strong> (NCCI-PTP unbundling, LCD/NCD
        coverage, benefit limits, prior-auth linkage, duplicates, network,
        timely-filing) to each submitted claim, classifies as{" "}
        <strong>clean-pay / pend / deny-drafted</strong> with a{" "}
        <strong>specific catalog reason code</strong>, and routes anything
        non-clean to a human. The agent NEVER autonomously finalizes a
        denial — every denial is DRAFTED for adjudicator cosign, because
        denial letters are legally consequential under CMS / ERISA / state
        insurance code.{" "}
        <strong>
          The edit catalog, reason-code catalog, and benefit rules are
          illustrative synthetics, not CMS X12 837 / NCCI PTP / LCD/NCD or
          real payer benefit configuration.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CLAIMS_ADJUDICATION_PRESETS.map((preset) => (
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
          Claims run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <ClaimsAdjudicationResult view={runState.view} />
      )}
    </section>
  );
}

function ClaimsAdjudicationResult({ view }: { view: ClaimsAdjudicationView }) {
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

  const d = view.decision;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Adjudication decision (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Claim" value={d.claimRef} tone="#9fb3c8" />{" "}
        <Pill label="Member" value={d.memberRef} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill
          label="Reason"
          value={d.primaryReasonCode ?? "n/a"}
          tone="#9fb3c8"
        />{" "}
        <Pill label="Routed to" value={d.routedTo ?? "n/a"} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Billed: ${(d.totalBilledCents / 100).toFixed(2)} · applied edits:{" "}
        {d.appliedEdits.length} · requires adjudicator cosign:{" "}
        {String(d.requiresAdjudicatorCosign)} · cosigned: {String(d.cosigned)}
      </p>

      {d.appliedEdits.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Applied edits
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {d.appliedEdits.map((e) => (
              <li
                key={e.editId}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.55rem",
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,0.03)",
                  marginBottom: "0.4rem"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    alignItems: "baseline"
                  }}
                >
                  <strong style={{ fontSize: "0.9rem" }}>{e.editLabel}</strong>
                  <Pill label="Reason" value={e.reasonCode} tone="#9fb3c8" />
                </div>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    fontSize: "0.78rem",
                    color: "var(--muted)"
                  }}
                >
                  {e.detail}
                </p>
                <p
                  style={{
                    margin: "0.15rem 0 0",
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                  }}
                >
                  editId = {e.editId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Adjudication note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{d.note}</p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          editsTraceToCatalog = {String(view.editsTraceToCatalog)} ·
          denialRequiresAdjudicatorCosign ={" "}
          {String(view.denialRequiresAdjudicatorCosign)} ·
          decisionsCiteReasonCodes = {String(view.decisionsCiteReasonCodes)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
