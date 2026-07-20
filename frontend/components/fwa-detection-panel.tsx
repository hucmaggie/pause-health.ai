"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEFAULT_FWA_FACTORS,
  DEMO_CLEAR_REQUEST,
  DEMO_IMPOSSIBLE_DAY_REQUEST,
  DEMO_MULTI_FLAG_REQUEST,
  DEMO_PHANTOM_SERVICE_REQUEST,
  DEMO_UPCODING_REQUEST,
  type FwaScreeningReport,
  type FwaScreeningRequest
} from "../lib/fwa-detection";

/**
 * FWA Detection runner for the intake demo.
 *
 * Fires the real, server-side A2A FWA agent at
 * /api/agents/fwa-detection/tasks — pattern-based screening of claims and
 * prior-auths that routes flagged claims to the SIU for HUMAN review. Never
 * autonomously denies, opens investigations, or freezes payment.
 */

const FWA_ROUTE = "/api/agents/fwa-detection/tasks";

export type FwaDetectionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: FwaScreeningRequest;
  reportOverride?: FwaScreeningReport;
};

export const FWA_DETECTION_PRESETS: FwaDetectionPreset[] = [
  {
    id: "clear",
    label: "Clear · routine claim from a clean provider",
    hint: "Peer-typical E/M, in-quantity, matching EHR encounter.",
    request: DEMO_CLEAR_REQUEST,
    demonstrates:
      "The agent clearing a routine claim — no patterns fire, no SIU review needed. All three honesty signals green (catalog-sourced, SIU-review-invariants hold, no protected-class factors)."
  },
  {
    id: "upcoding-medium",
    label: "Upcoding · E/M 5 vs peer median 3 (SIU standard)",
    hint: "E/M level above peer baseline for the case mix.",
    request: DEMO_UPCODING_REQUEST,
    demonstrates:
      "The agent flagging upcoding (medium severity) — routes to the SIU standard queue for human review. No autonomous denial, no investigation opened."
  },
  {
    id: "impossible-day-high",
    label: "Impossible-day · >24h billed (SIU priority)",
    hint: "Total service minutes across all claims for provider on DOS exceeds 1440.",
    request: DEMO_IMPOSSIBLE_DAY_REQUEST,
    demonstrates:
      "The agent flagging impossible-day billing (high severity) — routes to the SIU priority queue for immediate human review. investigationOpened + paymentFrozen still false — those are human acts."
  },
  {
    id: "phantom-service-high",
    label: "Phantom service · no matching EHR encounter (SIU priority)",
    hint: "Claim references CPTs with no linked EHR encounter.",
    request: DEMO_PHANTOM_SERVICE_REQUEST,
    demonstrates:
      "The agent flagging phantom-service on missing EHR encounter — routes to SIU priority queue. Still human-review-only, still no autonomous action."
  },
  {
    id: "multi-flag",
    label: "Multi-flag · precedence: dup-billing high wins",
    hint: "Repeated unbundling + duplicate + quantity outlier all fire.",
    request: DEMO_MULTI_FLAG_REQUEST,
    demonstrates:
      "Multiple patterns fire in stable pattern-id order. Highest-severity (duplicate-billing high) becomes the primary and routes to SIU priority queue. All flags catalog-sourced."
  },
  {
    id: "offcat-pattern-block",
    label: "Off-catalog pattern → governance block",
    hint: "Caller-asserted report cites a fabricated pattern.",
    request: DEMO_CLEAR_REQUEST,
    reportOverride: {
      requestRef: DEMO_CLEAR_REQUEST.requestRef,
      providerRef: DEMO_CLEAR_REQUEST.providerRef,
      claimRef: DEMO_CLEAR_REQUEST.claimRef,
      memberRef: DEMO_CLEAR_REQUEST.memberRef,
      asOfDate: DEMO_CLEAR_REQUEST.asOfDate,
      decision: "flag-for-siu-review",
      flags: [
        {
          patternId: "pattern.made-up",
          patternLabel: "Fake pattern",
          severity: "high",
          reason: "fabricated"
        }
      ],
      primaryPatternId: "pattern.made-up",
      primarySeverity: "high",
      routedTo: "siu-priority-queue",
      requiresSiuReview: true,
      investigationOpened: false,
      paymentFrozen: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a report that cites an off-catalog pattern (policy.fwa.pattern-catalog-sourced) — the guard against fabricated FWA rules."
  },
  {
    id: "autonomous-investigation-block",
    label: "Autonomous investigation → governance block",
    hint: "Caller-asserted report claims investigationOpened:true.",
    request: DEMO_IMPOSSIBLE_DAY_REQUEST,
    reportOverride: {
      requestRef: DEMO_IMPOSSIBLE_DAY_REQUEST.requestRef,
      providerRef: DEMO_IMPOSSIBLE_DAY_REQUEST.providerRef,
      claimRef: DEMO_IMPOSSIBLE_DAY_REQUEST.claimRef,
      memberRef: DEMO_IMPOSSIBLE_DAY_REQUEST.memberRef,
      asOfDate: DEMO_IMPOSSIBLE_DAY_REQUEST.asOfDate,
      decision: "flag-for-siu-review",
      flags: [
        {
          patternId: "pattern.impossible-day-billing",
          patternLabel: "Impossible day",
          severity: "high",
          reason: "over 24h"
        }
      ],
      primaryPatternId: "pattern.impossible-day-billing",
      primarySeverity: "high",
      routedTo: "siu-priority-queue",
      requiresSiuReview: true,
      investigationOpened: true as unknown as false,
      paymentFrozen: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a report that opens an investigation autonomously (policy.fwa.no-autonomous-denial) — SIU investigations require human authority."
  },
  {
    id: "protected-class-block",
    label: "Protected-class factor → governance block",
    hint: "Factor list includes provider-ethnicity.",
    request: {
      ...DEMO_CLEAR_REQUEST,
      factorsInUse: [...DEFAULT_FWA_FACTORS, "attr.provider-ethnicity"]
    },
    demonstrates:
      "The Agent Fabric blocking an engine that scores on protected-class attributes (policy.fwa.no-protected-class-factors) — bias in FWA is a well-documented compliance failure."
  }
];

export type FwaReportedView = {
  kind: "reported";
  report: FwaScreeningReport;
  patternsTraceToCatalog: boolean;
  reportRequiresSiuReview: boolean;
  noProtectedClassFactors: boolean;
  traceTaskId: string;
};

export type FwaBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type FwaInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type FwaDetectionView = FwaReportedView | FwaBlockedView | FwaInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  patternsTraceToCatalog?: unknown;
  reportRequiresSiuReview?: unknown;
  noProtectedClassFactors?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildFwaDetectionRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: FwaScreeningRequest;
  reportOverride?: FwaScreeningReport;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.reportOverride !== undefined) data.reportOverride = input.reportOverride;
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

export async function runFwaDetectionTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: FwaScreeningRequest;
    reportOverride?: FwaScreeningReport;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(FWA_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFwaDetectionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function fwaDetectionViewFromTask(task: A2ATask): FwaDetectionView {
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
        "The Agent Fabric blocked this FWA screening.";
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
        : "The FWA screening could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { report?: FwaScreeningReport } | undefined) ?? undefined;
  const report = result?.report;
  if (!report) {
    return {
      kind: "invalid",
      message: "The FWA screening could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    report,
    patternsTraceToCatalog: fabric.patternsTraceToCatalog === true,
    reportRequiresSiuReview: fabric.reportRequiresSiuReview === true,
    noProtectedClassFactors: fabric.noProtectedClassFactors === true,
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
  clear: "#8fd6b0",
  "flag-for-siu-review": "#ffb6c8"
};

const SEVERITY_TONE: Record<string, string> = {
  low: "#9fb3c8",
  medium: "#ffd28a",
  high: "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: FwaDetectionView }
  | { status: "error"; message: string };

export function FwaDetectionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: FwaDetectionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runFwaDetectionTask({
          taskId: newTaskId("fwa"),
          personaId: "demo",
          request: preset.request,
          reportOverride: preset.reportOverride
        });
        setRunState({
          status: "done",
          view: fwaDetectionViewFromTask(task)
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
        Fraud, Waste &amp; Abuse Detection · pattern-based SIU screening
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that flags suspicious patterns — never denies a claim, never
        freezes payment, never scores on protected-class factors
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The FWA agent screens claims against catalog-defined{" "}
        <strong>patterns</strong> (unbundling, upcoding, duplicate billing,
        quantity outliers, impossible-day billing, phantom services),
        classifies each hit by severity, and routes to the{" "}
        <strong>SIU</strong> for HUMAN review. It NEVER autonomously denies
        a claim, opens an investigation, or freezes payment — those are
        formal acts under Section 1557 / state insurance code / due process.
        The engine may NOT score on protected-class attributes (a
        well-documented compliance failure in real payer FWA systems).
        Distinct from Claims Adjudication (which AUTO-denies mechanical
        edits with a reason code): FWA is about{" "}
        <strong>suspicious patterns that need investigation</strong>.{" "}
        <strong>
          The pattern catalog, peer baselines, and severity thresholds are
          illustrative synthetics, not SAS / LexisNexis / a real payer SIU
          rule set.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {FWA_DETECTION_PRESETS.map((preset) => (
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
          FWA screening failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <FwaDetectionResult view={runState.view} />}
    </section>
  );
}

function FwaDetectionResult({ view }: { view: FwaDetectionView }) {
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
        FWA screening (deterministic, synthetic patterns)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Provider" value={r.providerRef} tone="#9fb3c8" />{" "}
        <Pill label="Claim" value={r.claimRef} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={r.decision}
          tone={DECISION_TONE[r.decision] ?? "#9fb3c8"}
        />{" "}
        {r.primarySeverity ? (
          <Pill
            label="Severity"
            value={r.primarySeverity}
            tone={SEVERITY_TONE[r.primarySeverity] ?? "#9fb3c8"}
          />
        ) : null}{" "}
        <Pill label="Routed to" value={r.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Flags: {r.flags.length} · requires SIU review:{" "}
        {String(r.requiresSiuReview)} · investigationOpened:{" "}
        {String(r.investigationOpened)} · paymentFrozen:{" "}
        {String(r.paymentFrozen)}
      </p>

      {r.flags.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Flagged patterns
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {r.flags.map((f) => (
              <li
                key={f.patternId}
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
                  <strong style={{ fontSize: "0.9rem" }}>{f.patternLabel}</strong>
                  <Pill
                    label="Severity"
                    value={f.severity}
                    tone={SEVERITY_TONE[f.severity] ?? "#9fb3c8"}
                  />
                </div>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    fontSize: "0.78rem",
                    color: "var(--muted)"
                  }}
                >
                  {f.reason}
                </p>
                <p
                  style={{
                    margin: "0.15rem 0 0",
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                  }}
                >
                  patternId = {f.patternId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="FWA note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{r.note}</p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          patternsTraceToCatalog = {String(view.patternsTraceToCatalog)} ·
          reportRequiresSiuReview = {String(view.reportRequiresSiuReview)} ·
          noProtectedClassFactors = {String(view.noProtectedClassFactors)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
