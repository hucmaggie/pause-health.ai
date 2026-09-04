"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_PARTIAL_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_PRESUMPTIVE_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_REQUEST,
  type AssistanceTier,
  type FinancialAssistanceDetermination,
  type FinancialAssistanceRequest
} from "../lib/financial-assistance";

/**
 * Patient Financial Assistance & Charity Care runner for the intake demo.
 *
 * Fires the real, server-side A2A Patient Financial Assistance & Charity Care agent at
 * /api/agents/financial-assistance/tasks — the patient-access service that screens a
 * self-pay / underinsured patient for hospital financial assistance (charity care) under
 * an IRS 501(r) FAP. It deterministically computes the household's income as a percentage
 * of the Federal Poverty Level, cites the governing FAP tier, and classifies the patient
 * as full-charity / partial-charity / not-eligible. The panel surfaces the FPL
 * percentage, the assistance tier + discount, the presumptive-eligibility + screening +
 * ECA flags, the human-review flag, the honesty signals, the synthetic labels, and a
 * deep link into the parented Agent Fabric trace.
 *
 * Granting full/partial charity — and even a not-eligible determination — are SAFE,
 * honest RECOMMENDATIONS (a denial requires human review). The eca-before-screening,
 * no-tier, and autonomous-denial presets assert offending DETERMINATIONS — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * The FAP tier schedule + FPL table are ILLUSTRATIVE synthetics, NOT a certified
 * financial-assistance system (real charity care is governed by IRS 501(r) / 26 CFR
 * 1.501(r), the HHS Federal Poverty Guidelines, and each hospital's Board-approved FAP).
 * Structure, styling tokens, and tone mirror <OverpaymentRecoveryPanel> and
 * <CoordinationOfBenefitsPanel> so this reads as a native sibling on /demo/intake.
 */

const FIN_ASSIST_ROUTE = "/api/agents/financial-assistance/tasks";

/** A one-click demo scenario. */
export type FinancialAssistancePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The screening request the agent evaluates (the common case). */
  request?: FinancialAssistanceRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const FINANCIAL_ASSISTANCE_PRESETS: FinancialAssistancePreset[] = [
  {
    id: "full-charity",
    label: "Household of 3, ~116% FPL → full charity",
    hint: "A household of 3 with $30k income, application complete.",
    request: DEMO_FINANCIAL_ASSISTANCE_REQUEST,
    demonstrates:
      "Household income at or below 200% of the Federal Poverty Level → full charity, 100% discount (fap.tier.full-charity) — a benefit granted."
  },
  {
    id: "partial-charity",
    label: "Household of 2, ~254% FPL → 75% discount",
    hint: "A household of 2 with $52k income, application complete.",
    request: DEMO_FINANCIAL_ASSISTANCE_PARTIAL_REQUEST,
    demonstrates:
      "Household income in the 201–300% FPL bracket → partial charity, 75% discount (fap.tier.partial-75) — a benefit granted."
  },
  {
    id: "presumptive",
    label: "Medicaid-eligible → presumptive full charity",
    hint: "A Medicaid-eligible patient, regardless of documented income.",
    request: DEMO_FINANCIAL_ASSISTANCE_PRESUMPTIVE_REQUEST,
    demonstrates:
      "A recorded presumptive-eligibility reason (Medicaid) grants full charity regardless of documented income (presumptive.medicaid-eligible)."
  },
  {
    id: "not-eligible",
    label: "Household of 1, ~465% FPL → not eligible",
    hint: "A household of 1 with $70k income, application complete.",
    request: DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
    demonstrates:
      "Household income above 400% FPL → not eligible; a DENIAL requiring human review with written notice + appeal rights (never an autonomous denial)."
  },
  {
    id: "eca-before-screening-block",
    label: "Collections before screening → governance block",
    hint: "A determination that asserts a collection action while screening is incomplete.",
    request: DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
    determination: {
      patientRef: "finassist-patient-004",
      tierId: "fap.tier.not-eligible",
      assistanceTier: "not-eligible",
      screeningComplete: false,
      ecaAllowed: true,
      requiresHumanReview: true
    },
    demonstrates:
      "The Agent Fabric blocking an extraordinary collection action asserted before financial screening is complete (policy.finassist.no-eca-before-screening)."
  },
  {
    id: "no-tier-block",
    label: "No cited FAP tier → governance block",
    hint: "An ad-hoc eligibility decision that doesn't cite a recorded FAP tier.",
    request: DEMO_FINANCIAL_ASSISTANCE_REQUEST,
    determination: {
      patientRef: "finassist-patient-001",
      tierId: "fap.tier.we-just-decided",
      assistanceTier: "full-charity",
      screeningComplete: true,
      ecaAllowed: false,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc eligibility decision that doesn't cite a recorded FAP tier (policy.finassist.fap-schedule-sourced)."
  },
  {
    id: "autonomous-denial-block",
    label: "Autonomous denial → governance block",
    hint: "A not-eligible determination that would deny charity care without human review.",
    request: DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
    determination: {
      patientRef: "finassist-patient-004",
      tierId: "fap.tier.not-eligible",
      assistanceTier: "not-eligible",
      screeningComplete: true,
      ecaAllowed: false,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking a determination that would autonomously deny charity care — a denial requires human review + appeal rights (policy.finassist.no-autonomous-denial)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type FinancialAssistanceResolvedView = {
  kind: "resolved";
  patientRef: string;
  fplPercent: number;
  assistanceTier: AssistanceTier;
  tierId: string;
  tierLabel: string;
  discountPct: number;
  presumptivelyEligible: boolean;
  screeningComplete: boolean;
  ecaAllowed: boolean;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  ecaGatedOnScreening: boolean;
  finAssistScheduleCited: boolean;
  finAssistHumanReviewed: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type FinancialAssistanceBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type FinancialAssistanceInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type FinancialAssistanceView =
  | FinancialAssistanceResolvedView
  | FinancialAssistanceBlockedView
  | FinancialAssistanceInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  ecaGatedOnScreening?: unknown;
  finAssistScheduleCited?: unknown;
  finAssistHumanReviewed?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildRecoveryRequestBody.
 */
export function buildFinancialAssistanceRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: FinancialAssistanceRequest;
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
 * POST a screening request (or an asserted determination) to the Patient Financial
 * Assistance & Charity Care agent and return the resulting A2A task. `fetchImpl` is
 * injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runFinancialAssistanceTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: FinancialAssistanceRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(FIN_ASSIST_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFinancialAssistanceRequestBody(input))
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
export function financialAssistanceViewFromTask(task: A2ATask): FinancialAssistanceView {
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
        "The Agent Fabric blocked this financial-assistance run.";
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
        : "The financial-assistance determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: FinancialAssistanceDetermination; patientRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? det?.patientRef ?? "",
    fplPercent: det?.fplPercent ?? 0,
    assistanceTier: det?.assistanceTier ?? "not-eligible",
    tierId: det?.tierId ?? "",
    tierLabel: det?.tierLabel ?? "",
    discountPct: det?.discountPct ?? 0,
    presumptivelyEligible: det?.presumptivelyEligible ?? false,
    screeningComplete: det?.screeningComplete ?? false,
    ecaAllowed: det?.ecaAllowed ?? false,
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    ecaGatedOnScreening: fabric.ecaGatedOnScreening === true,
    finAssistScheduleCited: fabric.finAssistScheduleCited === true,
    finAssistHumanReviewed: fabric.finAssistHumanReviewed === true,
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

const TIER_LABEL: Record<AssistanceTier, string> = {
  "full-charity": "Full charity",
  "partial-charity": "Partial charity",
  "not-eligible": "Not eligible"
};

const TIER_TONE: Record<AssistanceTier, string> = {
  "full-charity": "#8fd6b0",
  "partial-charity": "#9fd0ff",
  "not-eligible": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: FinancialAssistanceView }
  | { status: "error"; message: string };

export function FinancialAssistancePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: FinancialAssistancePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runFinancialAssistanceTask({
          taskId: newTaskId("finassist"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: financialAssistanceViewFromTask(task) });
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
        Patient financial assistance &amp; charity care · patient access
      </p>
      <h3 style={{ margin: 0 }}>
        Charity care — FPL-tiered, no collections before screening, never an autonomous
        denial
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>household size</strong> and <strong>income</strong>, the Patient
        Financial Assistance agent <strong>deterministically</strong> computes the
        household&rsquo;s income as a percentage of the{" "}
        <strong>Federal Poverty Level</strong>, cites the governing{" "}
        <strong>FAP tier</strong>, and classifies the patient as full-charity /
        partial-charity / not-eligible under an <strong>IRS 501(r)</strong> Financial
        Assistance Policy. A <strong>collection action never precedes screening</strong>{" "}
        (501(r)(6)). It <strong>never autonomously denies</strong>: a not-eligible
        determination is a <strong>recommendation requiring human review</strong> with
        written notice + appeal rights.{" "}
        <strong>
          The FAP schedule and FPL table are illustrative synthetics, not a certified
          financial-assistance system — real charity care is governed by IRS 501(r) /
          26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and each hospital&rsquo;s
          Board-approved FAP.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {FINANCIAL_ASSISTANCE_PRESETS.map((preset) => (
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
          Financial-assistance run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <FinancialAssistanceResult view={runState.view} />}
    </section>
  );
}

function FinancialAssistanceResult({ view }: { view: FinancialAssistanceView }) {
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
        Charity-care determination (deterministic, synthetic FAP)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Tier"
          value={TIER_LABEL[view.assistanceTier]}
          tone={TIER_TONE[view.assistanceTier]}
        />{" "}
        <Pill label="Discount" value={`${view.discountPct}%`} tone="#8fd6b0" />{" "}
        <Pill label="FPL" value={`${view.fplPercent}%`} tone="#9fb3c8" />{" "}
        <Pill
          label="Presumptive"
          value={String(view.presumptivelyEligible)}
          tone={view.presumptivelyEligible ? "#8fd6b0" : "#9fb3c8"}
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
        FAP tier:{" "}
        <strong style={{ color: "var(--fg)" }}>{view.tierLabel || view.tierId}</strong>{" "}
        (<code>{view.tierId}</code>) · screening complete{" "}
        <code>{String(view.screeningComplete)}</code> · ECA allowed{" "}
        <code>{String(view.ecaAllowed)}</code>
      </p>

      <div
        role="note"
        aria-label="Financial-assistance integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          No collections before screening · FAP-tier-sourced · no autonomous denial{" "}
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
          ecaGatedOnScreening = {String(view.ecaGatedOnScreening)} ·
          finAssistScheduleCited = {String(view.finAssistScheduleCited)} ·
          finAssistHumanReviewed = {String(view.finAssistHumanReviewed)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
