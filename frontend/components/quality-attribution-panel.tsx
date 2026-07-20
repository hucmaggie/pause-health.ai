"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_ATTRIBUTION_PANEL,
  type PatientAttribution,
  type PatientAttributionContext,
  type QualityAttributionReport,
  attributePatient
} from "../lib/quality-attribution";

/**
 * Quality-Measure Attribution runner for the intake demo.
 *
 * Fires the real, server-side A2A attribution agent at
 * /api/agents/quality-attribution/tasks — pairs with the HEDIS agent to
 * decide whose panel each patient counts on. The panel surfaces the per-
 * patient attributions (with tie-breaks + contract-exclusion flags), the
 * per-provider rollup, the honesty signals, and a deep link into the
 * parented Agent Fabric trace.
 */

const ATTR_ROUTE = "/api/agents/quality-attribution/tasks";

/** A one-click demo scenario. */
export type QualityAttributionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  panel?: readonly PatientAttributionContext[];
  attributionOverrides?: PatientAttribution[];
};

const demoPatientRef = (i: number) => DEMO_ATTRIBUTION_PANEL[i].patientRef;

export const QUALITY_ATTRIBUTION_PRESETS: QualityAttributionPreset[] = [
  {
    id: "demo-panel",
    label: "Attribute the demo panel (methodologies + tie-break + exclusion)",
    hint: "Five patients spanning plurality, PCP-of-record, contract-window; one tie-break; one contract-excluded.",
    panel: DEMO_ATTRIBUTION_PANEL,
    demonstrates:
      "The agent attributing five patients across the four methodologies + contract catalogs, breaking a tie deterministically (most-recent-visit-wins), correctly flagging one patient as contract-excluded (age band mismatch on Medicare Advantage HEDIS), and rolling up per-provider counts so downstream HEDIS scoring lands on the correct denominator."
  },
  {
    id: "offcat-methodology-block",
    label: "Off-catalog methodology → governance block",
    hint: "Caller asserts an attribution with a coin-flip methodology.",
    panel: DEMO_ATTRIBUTION_PANEL,
    attributionOverrides: [
      {
        patientRef: demoPatientRef(0),
        methodologyId: "methodology.coin-flip",
        providerRef: "provider-a",
        clinicRef: "clinic-north",
        contractRef: "contract.commercial-vbc-my2026",
        tieBreakApplied: null,
        excludedByContract: false,
        exclusionReasons: [],
        synthetic: true,
        note: "override"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a bespoke / off-catalog methodology — every attribution must trace to the defined methodology + contract catalogs (policy.attribution.methodology-catalog-sourced)."
  },
  {
    id: "contract-terms-block",
    label: "Contract terms exclude but attribution claims otherwise → block",
    hint: "Patient 5 is age-band-excluded from MA HEDIS; override asserts included anyway.",
    panel: DEMO_ATTRIBUTION_PANEL,
    attributionOverrides: [
      (() => {
        const truth = attributePatient(DEMO_ATTRIBUTION_PANEL[4]);
        return {
          ...truth,
          excludedByContract: false,
          exclusionReasons: []
        };
      })()
    ],
    demonstrates:
      "The Agent Fabric blocking a caller-asserted excludedByContract:false on a patient whose contract terms actually exclude them — the guard against polluting a contract's scorecard with patients the contract never covered (policy.attribution.no-conflicting-contract-terms)."
  },
  {
    id: "opaque-tiebreak-block",
    label: "Undocumented tie-break rule → governance block",
    hint: "Override applies a coin-flip tie-break.",
    panel: DEMO_ATTRIBUTION_PANEL,
    attributionOverrides: [
      {
        patientRef: demoPatientRef(1),
        methodologyId: "methodology.plurality-of-visits",
        providerRef: "provider-a",
        clinicRef: "clinic-north",
        contractRef: "contract.commercial-vbc-my2026",
        tieBreakApplied: "coin-flip",
        excludedByContract: false,
        exclusionReasons: [],
        synthetic: true,
        note: "override"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking an undocumented / opaque tie-break rule — every tie-break must be a defined, deterministic rule (most-recent-visit-wins → provider-ref-lexical-ascending) (policy.attribution.tie-break-documented)."
  }
];

/** Render-ready view of a produced report lifted from the task. */
export type AttributionReportedView = {
  kind: "reported";
  report: QualityAttributionReport;
  attributionsTraceToCatalog: boolean;
  attributionsHonorContractTerms: boolean;
  attributionTieBreaksAreDocumented: boolean;
  traceTaskId: string;
};

export type AttributionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type AttributionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type QualityAttributionView =
  | AttributionReportedView
  | AttributionBlockedView
  | AttributionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  attributionsTraceToCatalog?: unknown;
  attributionsHonorContractTerms?: unknown;
  attributionTieBreaksAreDocumented?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildQualityAttributionRequestBody(input: {
  taskId: string;
  personaId?: string;
  panel?: readonly PatientAttributionContext[];
  attributionOverrides?: PatientAttribution[];
}) {
  const data: Record<string, unknown> = {};
  if (input.panel !== undefined) data.panel = input.panel;
  if (input.attributionOverrides !== undefined) {
    data.attributionOverrides = input.attributionOverrides;
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

export async function runQualityAttributionTask(
  input: {
    taskId: string;
    personaId?: string;
    panel?: readonly PatientAttributionContext[];
    attributionOverrides?: PatientAttribution[];
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ATTR_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildQualityAttributionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function qualityAttributionViewFromTask(task: A2ATask): QualityAttributionView {
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
        "The Agent Fabric blocked this attribution run.";
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
        : "The attribution report could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { report?: QualityAttributionReport } | undefined) ?? undefined;
  const report = result?.report;
  if (!report) {
    return {
      kind: "invalid",
      message: "The attribution report could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    report,
    attributionsTraceToCatalog: fabric.attributionsTraceToCatalog === true,
    attributionsHonorContractTerms: fabric.attributionsHonorContractTerms === true,
    attributionTieBreaksAreDocumented:
      fabric.attributionTieBreaksAreDocumented === true,
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
  | { status: "done"; view: QualityAttributionView }
  | { status: "error"; message: string };

export function QualityAttributionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: QualityAttributionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runQualityAttributionTask({
          taskId: newTaskId("attribution"),
          personaId: "demo",
          panel: preset.panel,
          attributionOverrides: preset.attributionOverrides
        });
        setRunState({
          status: "done",
          view: qualityAttributionViewFromTask(task)
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
        Quality-measure attribution
      </p>
      <h3 style={{ margin: 0 }}>
        The other half of the HEDIS story — who gets the credit / accountability
        for the rate
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The attribution agent pairs with the HEDIS &amp; Quality Reporting
        agent: HEDIS computes the <strong>rates</strong>, this agent decides{" "}
        <strong>whose panel each patient counts on</strong>. It attributes
        every patient to a provider / clinic / VBC contract under a defined
        methodology from the catalog (plurality-of-visits, PCP-of-record,
        prospective Medicare Advantage, contract-defined window), honors the{" "}
        <strong>contract&apos;s exclusion terms</strong> (age band, network
        status, exclusion codes) so the scorecard isn&apos;t polluted with
        excluded patients, and applies a{" "}
        <strong>documented tie-break chain</strong> (most-recent-visit-wins
        then provider-ref-lexical-ascending) when the primary metric ties —
        no coin-flip, no gameable non-determinism. Rolls up per-provider
        counts so downstream HEDIS scoring lands on the right denominator.{" "}
        <strong>
          The methodology catalog, contract catalog, tie-break rules, and refs
          are illustrative synthetics, not CMS Shared Savings / ACO REACH /
          NCQA attribution.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {QUALITY_ATTRIBUTION_PRESETS.map((preset) => (
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
              ? "Attributing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Attribution run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <QualityAttributionResult view={runState.view} />
      )}
    </section>
  );
}

function QualityAttributionResult({ view }: { view: QualityAttributionView }) {
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

  const r = view.report;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Attribution report (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="As of" value={r.asOfDate} tone="#9fb3c8" />{" "}
        <Pill label="Methodology" value={r.methodologyId} tone="#9fb3c8" />{" "}
        <Pill label="Contract" value={r.contractRef} tone="#9fb3c8" />{" "}
        <Pill label="Patients" value={String(r.patients.length)} tone="#9fb3c8" />{" "}
        <Pill
          label="Unattributable"
          value={String(r.unattributableCount)}
          tone={r.unattributableCount === 0 ? "#8fd6b0" : "#ffd28a"}
        />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Per-patient attributions
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {r.patients.map((p) => (
          <li
            key={p.patientRef}
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
              <strong style={{ fontSize: "0.9rem" }}>
                {p.patientRef} → {p.providerRef ?? "(unattributed)"}
              </strong>
              <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                {p.excludedByContract ? (
                  <Pill label="Excluded" value="by contract" tone="#ffd28a" />
                ) : (
                  <Pill label="Included" value="in numerator" tone="#8fd6b0" />
                )}
                {p.tieBreakApplied ? (
                  <Pill label="Tie-break" value={p.tieBreakApplied} tone="#9fb3c8" />
                ) : null}
              </span>
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              methodology = {p.methodologyId} · clinic = {p.clinicRef ?? "—"} ·
              contract = {p.contractRef}
              {p.exclusionReasons.length > 0
                ? ` · reasons = ${p.exclusionReasons.join("; ")}`
                : ""}
            </p>
          </li>
        ))}
      </ul>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Per-provider rollup
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {r.perProvider.map((p) => (
          <li
            key={p.providerRef}
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
              <strong style={{ fontSize: "0.9rem" }}>
                {p.providerRef} · {p.clinicRef}
              </strong>
              <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <Pill
                  label="Attributed"
                  value={String(p.attributedCount)}
                  tone="#8fd6b0"
                />
                {p.excludedByContractCount > 0 && (
                  <Pill
                    label="Excluded"
                    value={String(p.excludedByContractCount)}
                    tone="#ffd28a"
                  />
                )}
                {p.tieBrokenCount > 0 && (
                  <Pill
                    label="Tie-broken"
                    value={String(p.tieBrokenCount)}
                    tone="#9fb3c8"
                  />
                )}
              </span>
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              contract = {p.contractRef}
            </p>
          </li>
        ))}
      </ul>

      <div
        role="note"
        aria-label="Attribution note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          {r.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          attributionsTraceToCatalog = {String(view.attributionsTraceToCatalog)} ·
          attributionsHonorContractTerms ={" "}
          {String(view.attributionsHonorContractTerms)} ·
          attributionTieBreaksAreDocumented ={" "}
          {String(view.attributionTieBreaksAreDocumented)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
