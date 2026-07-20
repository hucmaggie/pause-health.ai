"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_UR_APPROVE,
  DEMO_UR_NON_COVERED,
  DEMO_UR_P2P,
  DEMO_UR_PEND,
  DEMO_UR_URGENT_PEND,
  type UtilizationReviewDecision,
  type UtilizationReviewRequest
} from "../lib/utilization-review";

/**
 * Utilization Review runner for the intake demo.
 *
 * Fires the real, server-side A2A UR agent at
 * /api/agents/utilization-review/tasks — deterministic pre-service
 * medical-necessity screen (MCG-analog / InterQual-analog) with
 * clinician cosign for every non-approved decision and catalog-sourced
 * SLA deadlines.
 */

const UR_ROUTE = "/api/agents/utilization-review/tasks";

export type UtilizationReviewPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: UtilizationReviewRequest;
  decisionOverride?: UtilizationReviewDecision;
};

export const UTILIZATION_REVIEW_PRESETS: UtilizationReviewPreset[] = [
  {
    id: "approves-meets-criteria",
    label: "Approves-meets-criteria · DEXA all-required-met",
    hint: "DEXA request with age gate + interval + symptom documentation.",
    request: DEMO_UR_APPROVE,
    demonstrates:
      "The agent clean-approving at first pass — all required medical-necessity criteria met per the catalog. All three honesty signals green."
  },
  {
    id: "pend-clinical-review",
    label: "Pend for clinical review · hysterectomy missing first-line",
    hint: "Bleeding + biopsy documented; first-line failure not documented.",
    request: DEMO_UR_PEND,
    demonstrates:
      "Missing required criterion routes to clinical-reviewer queue (UR-200) — the agent never autonomously denies; a clinician evaluates additional evidence."
  },
  {
    id: "require-peer-to-peer",
    label: "Peer-to-peer · inpatient partial-met, provider requested",
    hint: "Severity met, intensity not met; provider requested P2P.",
    request: DEMO_UR_P2P,
    demonstrates:
      "Partial criteria + provider requests peer-to-peer → escalate to a payer/provider P2P (UR-201) with an urgent 24h SLA."
  },
  {
    id: "urgent-pend-sla",
    label: "Urgent pend · sleep study 24h SLA",
    hint: "Urgent OSA workup — one required criterion missing.",
    request: DEMO_UR_URGENT_PEND,
    demonstrates:
      "Urgent case gets the 24h SLA window — deadline traces to catalog urgency + received date; silently extending it would be blocked."
  },
  {
    id: "blocked-non-covered",
    label: "Blocked · non-covered service",
    hint: "Illustrative cosmetic procedure — not on covered-benefits catalog.",
    request: DEMO_UR_NON_COVERED,
    demonstrates:
      "Non-covered service blocked at first pass (UR-300) — member may appeal via Grievance & Appeals; the agent doesn't invent coverage."
  },
  {
    id: "offcat-service-block",
    label: "Off-catalog service → governance block",
    hint: "Caller-asserted decision cites a made-up service id.",
    request: DEMO_UR_APPROVE,
    decisionOverride: {
      requestRef: DEMO_UR_APPROVE.requestRef,
      memberRef: DEMO_UR_APPROVE.memberRef,
      serviceTypeId: "service.made-up",
      serviceTypeLabel: "Fake",
      urgency: "standard",
      asOfDate: DEMO_UR_APPROVE.asOfDate,
      decision: "approves-meets-criteria",
      appliedRules: [
        {
          ruleId: "rule.all-required-met",
          ruleLabel: "Standard",
          reasonCode: "reason.UR-100",
          reasonLabel: "Standard",
          detail: "override"
        }
      ],
      criteriaMet: [],
      criteriaMissing: [],
      primaryReasonCode: "reason.UR-100",
      primaryReasonLabel: "Standard",
      routedTo: "auto-approve",
      slaDeadline: "2026-07-08T14:00:00.000Z",
      slaWindowHours: 72,
      requiresClinicianCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a decision that cites an off-catalog service id (policy.ur.criteria-catalog-sourced) — no invented medical-necessity criteria."
  },
  {
    id: "autonomous-cosign-block",
    label: "Autonomous cosign → governance block",
    hint: "Caller-asserted pend decision claims cosigned:true.",
    request: DEMO_UR_PEND,
    decisionOverride: {
      requestRef: DEMO_UR_PEND.requestRef,
      memberRef: DEMO_UR_PEND.memberRef,
      serviceTypeId: DEMO_UR_PEND.serviceTypeId,
      serviceTypeLabel: "Hysterectomy",
      urgency: "standard",
      asOfDate: DEMO_UR_PEND.asOfDate,
      decision: "pend-for-clinical-review",
      appliedRules: [
        {
          ruleId: "rule.missing-required-criterion",
          ruleLabel: "Missing",
          reasonCode: "reason.UR-200",
          reasonLabel: "Missing",
          detail: "override"
        }
      ],
      criteriaMet: ["criterion.hyst.bleed-pattern-documented"],
      criteriaMissing: ["criterion.hyst.first-line-failed"],
      primaryReasonCode: "reason.UR-200",
      primaryReasonLabel: "Missing",
      routedTo: "clinical-reviewer-queue",
      slaDeadline: "2026-07-08T14:00:00.000Z",
      slaWindowHours: 72,
      requiresClinicianCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned UR pend (policy.ur.no-autonomous-denial) — UR denials require clinician sign-off."
  },
  {
    id: "sla-extended-block",
    label: "Silently-extended SLA → governance block",
    hint: "Caller claims a 168h SLA deadline for a standard case.",
    request: DEMO_UR_PEND,
    decisionOverride: {
      requestRef: DEMO_UR_PEND.requestRef,
      memberRef: DEMO_UR_PEND.memberRef,
      serviceTypeId: DEMO_UR_PEND.serviceTypeId,
      serviceTypeLabel: "Hysterectomy",
      urgency: "standard",
      asOfDate: DEMO_UR_PEND.asOfDate,
      decision: "pend-for-clinical-review",
      appliedRules: [
        {
          ruleId: "rule.missing-required-criterion",
          ruleLabel: "Missing",
          reasonCode: "reason.UR-200",
          reasonLabel: "Missing",
          detail: "override"
        }
      ],
      criteriaMet: ["criterion.hyst.bleed-pattern-documented"],
      criteriaMissing: ["criterion.hyst.first-line-failed"],
      primaryReasonCode: "reason.UR-200",
      primaryReasonLabel: "Missing",
      routedTo: "clinical-reviewer-queue",
      slaDeadline: "2027-01-01T00:00:00.000Z",
      slaWindowHours: 168 as unknown as number,
      requiresClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a silently-extended UR deadline (policy.ur.sla-integrity) — every case deadline traces to catalog urgency + received date."
  }
];

export type UtilizationReviewReportedView = {
  kind: "reported";
  decision: UtilizationReviewDecision;
  criteriaTraceToCatalog: boolean;
  denialRequiresClinicianCosign: boolean;
  slaTracesToCatalog: boolean;
  traceTaskId: string;
};

export type UtilizationReviewBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type UtilizationReviewInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type UtilizationReviewView =
  | UtilizationReviewReportedView
  | UtilizationReviewBlockedView
  | UtilizationReviewInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  criteriaTraceToCatalog?: unknown;
  denialRequiresClinicianCosign?: unknown;
  slaTracesToCatalog?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildUtilizationReviewRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: UtilizationReviewRequest;
  decisionOverride?: UtilizationReviewDecision;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.decisionOverride !== undefined) data.decisionOverride = input.decisionOverride;
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

export async function runUtilizationReviewTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: UtilizationReviewRequest;
    decisionOverride?: UtilizationReviewDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(UR_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildUtilizationReviewRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function utilizationReviewViewFromTask(task: A2ATask): UtilizationReviewView {
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
        "The Agent Fabric blocked this UR case.";
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
        : "The UR case could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: UtilizationReviewDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The UR decision could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    criteriaTraceToCatalog: fabric.criteriaTraceToCatalog === true,
    denialRequiresClinicianCosign: fabric.denialRequiresClinicianCosign === true,
    slaTracesToCatalog: fabric.slaTracesToCatalog === true,
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
  "approves-meets-criteria": "#8fd6b0",
  "pend-for-clinical-review": "#ffd28a",
  "require-peer-to-peer": "#ffd28a",
  "blocked-non-covered": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: UtilizationReviewView }
  | { status: "error"; message: string };

export function UtilizationReviewPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: UtilizationReviewPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runUtilizationReviewTask({
          taskId: newTaskId("ur"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: utilizationReviewViewFromTask(task)
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
        Utilization Review · MCG/InterQual analog · pre-service medical necessity
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that screens a proposed procedure or admission against catalog
        criteria — never autonomously denies, every SLA traces to catalog
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The utilization-review agent runs the{" "}
        <strong>pre-service medical-necessity screen</strong> for a proposed
        procedure or inpatient admission against the catalog criteria set for
        that service type, classifies as{" "}
        <strong>approves-meets-criteria / pend-for-clinical-review /
        require-peer-to-peer / blocked-non-covered</strong>, and routes
        non-approved cases to a clinical reviewer or peer-to-peer with a
        catalog-sourced SLA deadline (standard 72h, urgent 24h,
        concurrent-review 24h). Distinct from Prior Authorization (assembly)
        and Claims Adjudication (post-service edits). The agent NEVER
        autonomously denies — every non-approved decision is{" "}
        <strong>DRAFTED for clinician cosign</strong> (Medicare Advantage /
        state UR-agent codes require notice + due-process rights).{" "}
        <strong>
          The service-type catalog, criteria sets, rules, reason codes, and SLA
          windows are illustrative synthetics, not MCG (Milliman Care
          Guidelines / Indicia), InterQual, or a real payer's UR rule set.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {UTILIZATION_REVIEW_PRESETS.map((preset) => (
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
              ? "Reviewing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          UR case failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <UtilizationReviewResult view={runState.view} />}
    </section>
  );
}

function UtilizationReviewResult({ view }: { view: UtilizationReviewView }) {
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
        UR decision (deterministic, catalog criteria)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Service" value={d.serviceTypeLabel} tone="#9fb3c8" />{" "}
        <Pill label="Urgency" value={d.urgency} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />{" "}
        <Pill label="SLA" value={`${d.slaWindowHours}h`} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Deadline: {d.slaDeadline} · Requires cosign:{" "}
        {String(d.requiresClinicianCosign)} · Cosigned: {String(d.cosigned)}
      </p>

      {(d.criteriaMet.length > 0 || d.criteriaMissing.length > 0) && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Criteria evaluation
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {d.criteriaMet.map((id) => (
              <li
                key={`met-${id}`}
                style={{
                  padding: "0.35rem 0.55rem",
                  fontSize: "0.82rem",
                  color: "#8fd6b0",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                ✓ {id}
              </li>
            ))}
            {d.criteriaMissing.map((id) => (
              <li
                key={`miss-${id}`}
                style={{
                  padding: "0.35rem 0.55rem",
                  fontSize: "0.82rem",
                  color: "#ffb6c8",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                ✗ {id}
              </li>
            ))}
          </ul>
        </>
      )}

      {d.appliedRules.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Applied rules
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {d.appliedRules.map((r) => (
              <li
                key={r.ruleId}
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
                  <strong style={{ fontSize: "0.9rem" }}>{r.ruleLabel}</strong>
                  <Pill label="Reason" value={r.reasonCode} tone="#9fb3c8" />
                </div>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                  {r.detail}
                </p>
                <p
                  style={{
                    margin: "0.15rem 0 0",
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                  }}
                >
                  ruleId = {r.ruleId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Utilization-review note"
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
          criteriaTraceToCatalog = {String(view.criteriaTraceToCatalog)} ·
          denialRequiresClinicianCosign ={" "}
          {String(view.denialRequiresClinicianCosign)} · slaTracesToCatalog ={" "}
          {String(view.slaTracesToCatalog)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
