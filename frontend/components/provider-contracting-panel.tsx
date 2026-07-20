"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_CONTRACT_FFS,
  DEMO_CONTRACT_GOOD_STANDING,
  DEMO_CONTRACT_QUALITY_MISS,
  DEMO_CONTRACT_SPEND_DRIFT,
  DEMO_CONTRACT_TERM_CHANGE,
  type ProviderContractDecision,
  type ProviderContractRequest
} from "../lib/provider-contracting";

/**
 * Provider Contracting runner for the intake demo.
 *
 * Fires the real, server-side A2A contracting agent at
 * /api/agents/provider-contracting/tasks — deterministic classification of
 * provider-network contracts with account-owner cosign for term changes.
 * Runs on the commercial plane — no PHI.
 */

const PC_ROUTE = "/api/agents/provider-contracting/tasks";

export type ProviderContractingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: ProviderContractRequest;
  decisionOverride?: ProviderContractDecision;
};

export const PROVIDER_CONTRACTING_PRESETS: ProviderContractingPreset[] = [
  {
    id: "in-good-standing",
    label: "In good standing · MA VBC quality + spend in band",
    hint: "MA Star VBC contract: 82% quality (gate 75%), spend +0.5% (tolerance 3%).",
    request: DEMO_CONTRACT_GOOD_STANDING,
    demonstrates:
      "The agent auto-continuing a VBC contract in good standing at first pass. All three honesty signals green."
  },
  {
    id: "quality-gate-missed",
    label: "Quality-gate missed → benchmark-drift review",
    hint: "MSSP shared-savings: 55% quality (gate 70%).",
    request: DEMO_CONTRACT_QUALITY_MISS,
    demonstrates:
      "Quality gate missed routes to the account manager for benchmark-drift review (PC-200) — the agent doesn't autonomously trigger a clawback."
  },
  {
    id: "spend-drift-exceeded",
    label: "Spend drift exceeded → benchmark-drift review",
    hint: "Commercial VBC: spend +7% vs 5% tolerance.",
    request: DEMO_CONTRACT_SPEND_DRIFT,
    demonstrates:
      "Spend drift exceeds tolerance (PC-201) — routes to account-manager drift review with the computed drift percentage."
  },
  {
    id: "term-change-drafted",
    label: "Term change → account-owner cosign",
    hint: "MA VBC term change (lower quality gate 0.75→0.70).",
    request: DEMO_CONTRACT_TERM_CHANGE,
    demonstrates:
      "Term-change proposal is DRAFTED for account-owner cosign (PC-300) — the agent NEVER autonomously commits a contract-term change."
  },
  {
    id: "non-vbc-ffs",
    label: "Non-VBC FFS · no quality gate applies",
    hint: "Fee-for-service — non-VBC, no quality gate.",
    request: DEMO_CONTRACT_FFS,
    demonstrates:
      "Non-VBC FFS contracts land in-good-standing with no quality gate — the engine short-circuits VBC computation."
  },
  {
    id: "offcat-contract-block",
    label: "Off-catalog contract → governance block",
    hint: "Caller-asserted decision cites a made-up contract type.",
    request: DEMO_CONTRACT_GOOD_STANDING,
    decisionOverride: {
      requestRef: DEMO_CONTRACT_GOOD_STANDING.requestRef,
      providerRef: DEMO_CONTRACT_GOOD_STANDING.providerRef,
      contractRef: DEMO_CONTRACT_GOOD_STANDING.contractRef,
      contractTypeId: "contract-type.made-up",
      contractTypeLabel: "Fake",
      methodologyId: "methodology.ma-star-vbc-my2026",
      methodologyLabel: "MA Star",
      reportingPeriodStart: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodStart,
      reportingPeriodEnd: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodEnd,
      decision: "in-good-standing",
      appliedRules: [],
      qualityGateMet: true,
      qualityMeasuresMetFraction: 0.9,
      qualityGateThreshold: 0.75,
      spendDriftFraction: 0.01,
      spendDriftTolerance: 0.03,
      benchmarkSpendCents: 100_00,
      actualSpendCents: 100_00,
      primaryReasonCode: "reason.PC-100",
      primaryReasonLabel: "Good standing",
      routedTo: "auto-continue",
      requiresAccountOwnerCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an off-catalog contract type (policy.contracting.contract-type-catalog-sourced) — no bespoke payment models."
  },
  {
    id: "autonomous-cosign-block",
    label: "Autonomous cosign → governance block",
    hint: "Caller-asserted term change claims cosigned:true.",
    request: DEMO_CONTRACT_TERM_CHANGE,
    decisionOverride: {
      requestRef: DEMO_CONTRACT_TERM_CHANGE.requestRef,
      providerRef: DEMO_CONTRACT_TERM_CHANGE.providerRef,
      contractRef: DEMO_CONTRACT_TERM_CHANGE.contractRef,
      contractTypeId: DEMO_CONTRACT_TERM_CHANGE.contractTypeId,
      contractTypeLabel: "MA VBC",
      methodologyId: DEMO_CONTRACT_TERM_CHANGE.methodologyId,
      methodologyLabel: "MA Star",
      reportingPeriodStart: DEMO_CONTRACT_TERM_CHANGE.reportingPeriodStart,
      reportingPeriodEnd: DEMO_CONTRACT_TERM_CHANGE.reportingPeriodEnd,
      decision: "draft-term-change",
      appliedRules: [
        {
          ruleId: "rule.term-change-requested",
          ruleLabel: "Term change",
          reasonCode: "reason.PC-300",
          reasonLabel: "Term change",
          detail: "override"
        }
      ],
      qualityGateMet: true,
      qualityMeasuresMetFraction: 0.8,
      qualityGateThreshold: 0.75,
      spendDriftFraction: -0.01,
      spendDriftTolerance: 0.03,
      benchmarkSpendCents: 100_00,
      actualSpendCents: 99_00,
      primaryReasonCode: "reason.PC-300",
      primaryReasonLabel: "Term change",
      routedTo: "account-owner-cosign",
      requiresAccountOwnerCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned term change (policy.contracting.no-autonomous-term-change) — term changes require a human account owner."
  },
  {
    id: "benchmark-drift-block",
    label: "Opaque benchmark → governance block",
    hint: "Caller uses a quality-gate threshold that doesn't match the methodology catalog.",
    request: DEMO_CONTRACT_GOOD_STANDING,
    decisionOverride: {
      requestRef: DEMO_CONTRACT_GOOD_STANDING.requestRef,
      providerRef: DEMO_CONTRACT_GOOD_STANDING.providerRef,
      contractRef: DEMO_CONTRACT_GOOD_STANDING.contractRef,
      contractTypeId: DEMO_CONTRACT_GOOD_STANDING.contractTypeId,
      contractTypeLabel: "MA VBC",
      methodologyId: DEMO_CONTRACT_GOOD_STANDING.methodologyId,
      methodologyLabel: "MA Star",
      reportingPeriodStart: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodStart,
      reportingPeriodEnd: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodEnd,
      decision: "in-good-standing",
      appliedRules: [
        {
          ruleId: "rule.quality-and-spend-in-band",
          ruleLabel: "Good standing",
          reasonCode: "reason.PC-100",
          reasonLabel: "Good standing",
          detail: "override"
        }
      ],
      qualityGateMet: true,
      qualityMeasuresMetFraction: 0.5,
      qualityGateThreshold: 0.5, // catalog says 0.75
      spendDriftFraction: 0.01,
      spendDriftTolerance: 0.03,
      benchmarkSpendCents: 100_00,
      actualSpendCents: 100_00,
      primaryReasonCode: "reason.PC-100",
      primaryReasonLabel: "Good standing",
      routedTo: "auto-continue",
      requiresAccountOwnerCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an opaque benchmark (policy.contracting.benchmark-methodology-catalog-sourced) — every VBC benchmark traces to the methodology catalog."
  }
];

export type ProviderContractingReportedView = {
  kind: "reported";
  decision: ProviderContractDecision;
  contractsTraceToCatalog: boolean;
  contractChangeRequiresOwnerCosign: boolean;
  benchmarksTraceToMethodology: boolean;
  traceTaskId: string;
};

export type ProviderContractingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type ProviderContractingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ProviderContractingView =
  | ProviderContractingReportedView
  | ProviderContractingBlockedView
  | ProviderContractingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  contractsTraceToCatalog?: unknown;
  contractChangeRequiresOwnerCosign?: unknown;
  benchmarksTraceToMethodology?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildProviderContractingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ProviderContractRequest;
  decisionOverride?: ProviderContractDecision;
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

export async function runProviderContractingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ProviderContractRequest;
    decisionOverride?: ProviderContractDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(PC_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProviderContractingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function providerContractingViewFromTask(task: A2ATask): ProviderContractingView {
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
        "The Agent Fabric blocked this contracting decision.";
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
        : "The contracting decision could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: ProviderContractDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The contracting decision could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    contractsTraceToCatalog: fabric.contractsTraceToCatalog === true,
    contractChangeRequiresOwnerCosign: fabric.contractChangeRequiresOwnerCosign === true,
    benchmarksTraceToMethodology: fabric.benchmarksTraceToMethodology === true,
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
  "in-good-standing": "#8fd6b0",
  "benchmark-drift-review": "#ffd28a",
  "draft-term-change": "#ffd28a",
  "blocked-non-catalog-contract": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ProviderContractingView }
  | { status: "error"; message: string };

export function ProviderContractingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: ProviderContractingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runProviderContractingTask({
          taskId: newTaskId("pc"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: providerContractingViewFromTask(task)
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
        Provider Contracting &amp; VBC Terms · commercial plane · no PHI
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that classifies provider-network contracts and computes VBC
        benchmarks — never autonomously commits a term change
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The provider-contracting agent runs on the{" "}
        <strong>commercial plane</strong> (no PHI) alongside the Pipeline
        Management and Account Management agents. For each provider-network
        contract it classifies the payment model (FFS, capitation,
        shared-savings, bundled-payment, MA-VBC, commercial-VBC), computes the
        <strong> quality-gate + spend-benchmark drift</strong> for a caller-
        provided reporting period against a catalog methodology, and
        classifies as{" "}
        <strong>in-good-standing / benchmark-drift-review /
        draft-term-change / blocked-non-catalog-contract</strong>. The agent
        NEVER autonomously commits a contract-term change — every draft is
        <strong> DRAFTED for account-owner cosign</strong> (state insurance
        code / provider-contract law / CMS Medicare Advantage require a human
        owner sign-off).{" "}
        <strong>
          The contract-type catalog, methodology catalog, rules, and reason
          codes are illustrative synthetics, not Salesforce Health Cloud
          Provider Network Management, Optum Contract Manager, or a real
          payer's contract-lifecycle system.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PROVIDER_CONTRACTING_PRESETS.map((preset) => (
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
              ? "Evaluating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Contracting decision failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ProviderContractingResult view={runState.view} />}
    </section>
  );
}

function ProviderContractingResult({ view }: { view: ProviderContractingView }) {
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
  const driftPct = (d.spendDriftFraction * 100).toFixed(1);
  const qMet = (d.qualityMeasuresMetFraction * 100).toFixed(0);
  const qGate = (d.qualityGateThreshold * 100).toFixed(0);

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Contract decision (deterministic, catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Type" value={d.contractTypeLabel} tone="#9fb3c8" />{" "}
        <Pill label="Methodology" value={d.methodologyLabel} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Quality: {qMet}% (gate {qGate}%) · Spend drift: {driftPct}% (tolerance ±
        {(d.spendDriftTolerance * 100).toFixed(1)}%) · Requires cosign:{" "}
        {String(d.requiresAccountOwnerCosign)} · Cosigned: {String(d.cosigned)}
      </p>

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
        aria-label="Contracting note"
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
          contractsTraceToCatalog = {String(view.contractsTraceToCatalog)} ·
          contractChangeRequiresOwnerCosign ={" "}
          {String(view.contractChangeRequiresOwnerCosign)} ·
          benchmarksTraceToMethodology ={" "}
          {String(view.benchmarksTraceToMethodology)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
