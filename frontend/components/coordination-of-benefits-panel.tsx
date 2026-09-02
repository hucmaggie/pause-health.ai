"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_COB_BIRTHDAY_REQUEST,
  DEMO_COB_DECREE_REQUEST,
  DEMO_COB_MSP_REQUEST,
  DEMO_COB_REQUEST,
  type CobDetermination,
  type CobRequest,
  type OrderedCoverage
} from "../lib/coordination-of-benefits";

/**
 * Coordination of Benefits runner for the intake demo.
 *
 * Fires the real, server-side A2A Coordination of Benefits agent at
 * /api/agents/coordination-of-benefits/tasks — the plan-side payer & plan
 * operations service that decides the order of benefits when a patient carries more
 * than one coverage. It deterministically orders the coverages (primary → secondary
 * → tertiary), citing the governing COB rule for every ordering decision. The panel
 * surfaces the ranked coverages, the cited rules, the custody-decree + human-cosign
 * flags, the honesty signals, the synthetic labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * An order-of-benefits determination is a SAFE, honest RECOMMENDATION requiring
 * human cosign — never an autonomous adjudication. The decree-ignored,
 * no-cited-rule, and autonomous-adjudication presets assert offending DETERMINATIONS
 * — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * The COB rule catalog, plan types, and payers are ILLUSTRATIVE synthetics, NOT a
 * certified coordination-of-benefits engine (real COB is governed by the NAIC COB
 * Model Regulation, Medicare Secondary Payer, and Medicaid TPL). Structure, styling
 * tokens, and tone mirror <RecordsRetentionPanel> and <ClaimsAdjudicationPanel> so
 * this reads as a native sibling on /demo/intake.
 */

const COB_ROUTE = "/api/agents/coordination-of-benefits/tasks";

/** A one-click demo scenario. */
export type CobPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The COB request the agent evaluates (the common case). */
  request?: CobRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const COB_PRESETS: CobPreset[] = [
  {
    id: "subscriber-before-dependent",
    label: "Own plan + spouse's plan → subscriber first",
    hint: "The patient is the subscriber on their own PPO and a dependent on their spouse's plan.",
    request: DEMO_COB_REQUEST,
    demonstrates:
      "A plan covering the patient as the subscriber is PRIMARY over one covering them as a dependent (rule.cob.subscriber-before-dependent)."
  },
  {
    id: "birthday-rule",
    label: "Dependent child, both parents → birthday rule",
    hint: "A child covered under both parents; the mother's birthday falls earlier in the year.",
    request: DEMO_COB_BIRTHDAY_REQUEST,
    demonstrates:
      "For a dependent child under both parents, the plan of the parent whose birthday (month/day) is earlier in the year is primary (rule.cob.birthday-rule)."
  },
  {
    id: "custody-decree",
    label: "Custody decree → overrides the birthday rule",
    hint: "The same child, but a court decree names the father's plan primary.",
    request: DEMO_COB_DECREE_REQUEST,
    demonstrates:
      "An active custody / court decree ALWAYS overrides the birthday rule — the decree-named plan is primary (rule.cob.custody-decree-overrides-birthday)."
  },
  {
    id: "medicare-secondary",
    label: "Active employee + Medicare → group first (MSP)",
    hint: "An active employee at a 20+-employee employer who also has Medicare.",
    request: DEMO_COB_MSP_REQUEST,
    demonstrates:
      "Medicare Secondary Payer — the active-employment group plan is primary and Medicare is secondary (rule.cob.medicare-secondary-payer)."
  },
  {
    id: "decree-ignored-block",
    label: "Ignore custody decree → governance block",
    hint: "A determination that orders the child's coverages against an active decree.",
    request: DEMO_COB_DECREE_REQUEST,
    determination: {
      isDependentChild: true,
      custodyDecreePrimaryCoverageId: "coverage-dad-hmo",
      primaryCoverageId: "coverage-mom-ppo",
      requiresHumanCosign: true,
      orderedCoverages: [
        {
          coverageId: "coverage-mom-ppo",
          rank: 1,
          decidingRuleId: "rule.cob.birthday-rule"
        },
        {
          coverageId: "coverage-dad-hmo",
          rank: 2,
          decidingRuleId: "rule.cob.birthday-rule"
        }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking an ordering that ignores an active custody decree — a decree always overrides the birthday rule (policy.cob.custody-decree-overrides-birthday)."
  },
  {
    id: "no-rule-block",
    label: "No cited COB rule → governance block",
    hint: "An ad-hoc ordering with no cited order-of-benefits rule.",
    request: DEMO_COB_REQUEST,
    determination: {
      isDependentChild: false,
      primaryCoverageId: "coverage-own-ppo",
      requiresHumanCosign: true,
      orderedCoverages: [
        {
          coverageId: "coverage-own-ppo",
          rank: 1,
          decidingRuleId: "rule.cob.we-just-picked"
        },
        {
          coverageId: "coverage-spouse-hmo",
          rank: 2,
          decidingRuleId: "rule.cob.we-just-picked"
        }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc ordering that doesn't cite a recorded COB rule (policy.cob.order-of-benefits-rule-sourced)."
  },
  {
    id: "autonomous-adjudication-block",
    label: "Autonomous adjudication → governance block",
    hint: "A determination that would autonomously adjudicate / pay a claim.",
    request: DEMO_COB_REQUEST,
    determination: {
      isDependentChild: false,
      primaryCoverageId: "coverage-own-ppo",
      requiresHumanCosign: false,
      orderedCoverages: [
        {
          coverageId: "coverage-own-ppo",
          rank: 1,
          decidingRuleId: "rule.cob.subscriber-before-dependent"
        },
        {
          coverageId: "coverage-spouse-hmo",
          rank: 2,
          decidingRuleId: "rule.cob.subscriber-before-dependent"
        }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a determination that would autonomously adjudicate — a COB determination is a recommendation requiring human cosign (policy.cob.no-autonomous-adjudication)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type CobResolvedView = {
  kind: "resolved";
  patientRef: string;
  isDependentChild: boolean;
  primaryCoverageId: string;
  orderedCoverages: OrderedCoverage[];
  citedRuleIds: string[];
  custodyDecreeApplied: boolean;
  requiresHumanCosign: boolean;
  reason: string;
  note: string;
  cobDecreeHonored: boolean;
  cobRuleCited: boolean;
  cobHumanCosigned: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CobBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CobInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CobView = CobResolvedView | CobBlockedView | CobInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  cobDecreeHonored?: unknown;
  cobRuleCited?: unknown;
  cobHumanCosigned?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildRecordsRetentionRequestBody.
 */
export function buildCobRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CobRequest;
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
 * POST a COB request (or an asserted determination) to the Coordination of Benefits
 * agent and return the resulting A2A task. `fetchImpl` is injectable so tests can
 * stub the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runCobTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CobRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(COB_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCobRequestBody(input))
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
export function cobViewFromTask(task: A2ATask): CobView {
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
        "The Agent Fabric blocked this coordination-of-benefits run.";
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
        : "The coordination-of-benefits determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: CobDetermination; patientRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? det?.patientRef ?? "",
    isDependentChild: det?.isDependentChild ?? false,
    primaryCoverageId: det?.primaryCoverageId ?? "",
    orderedCoverages: det?.orderedCoverages ?? [],
    citedRuleIds: det?.citedRuleIds ?? [],
    custodyDecreeApplied: det?.custodyDecreeApplied ?? false,
    requiresHumanCosign: det?.requiresHumanCosign ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    cobDecreeHonored: fabric.cobDecreeHonored === true,
    cobRuleCited: fabric.cobRuleCited === true,
    cobHumanCosigned: fabric.cobHumanCosigned === true,
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
  | { status: "done"; view: CobView }
  | { status: "error"; message: string };

export function CoordinationOfBenefitsPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CobPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCobTask({
          taskId: newTaskId("cob"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: cobViewFromTask(task) });
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
        Coordination of benefits · payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Order of benefits — decree-overrides-birthday, rule-sourced, never an
        autonomous adjudication
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        When a patient carries more than one <strong>coverage</strong>, the
        Coordination of Benefits agent{" "}
        <strong>deterministically orders</strong> the plans —{" "}
        <strong>primary → secondary → tertiary</strong> — by applying the NAIC-model
        order-of-benefits rules, <strong>Medicare Secondary Payer</strong>, and the{" "}
        <strong>birthday rule</strong>, citing the governing COB rule for every
        decision. An active <strong>custody / court decree always overrides the
        birthday rule</strong>. It <strong>never autonomously adjudicates</strong>: a
        determination sets payer <strong>order</strong> only and is a{" "}
        <strong>recommendation requiring human cosign</strong>.{" "}
        <strong>
          The COB rule catalog, plan types, and payers are illustrative synthetics,
          not a certified coordination-of-benefits engine — real COB is governed by
          the NAIC COB Model Regulation, Medicare Secondary Payer, and Medicaid
          third-party liability.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {COB_PRESETS.map((preset) => (
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
              ? "Coordinating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Coordination-of-benefits run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CobResult view={runState.view} />}
    </section>
  );
}

function CobResult({ view }: { view: CobView }) {
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
        Order of benefits (deterministic, synthetic coverages)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Primary"
          value={view.primaryCoverageId || "—"}
          tone="#8fd6b0"
        />{" "}
        <Pill
          label="Dependent child"
          value={String(view.isDependentChild)}
          tone="#9fb3c8"
        />{" "}
        <Pill
          label="Custody decree applied"
          value={String(view.custodyDecreeApplied)}
          tone={view.custodyDecreeApplied ? "#ffd28a" : "#9fb3c8"}
        />{" "}
        <Pill
          label="Requires human cosign"
          value={String(view.requiresHumanCosign)}
          tone="#ffd28a"
        />
      </p>

      {view.orderedCoverages.length > 0 && (
        <ol
          style={{
            margin: "0.7rem 0 0",
            paddingLeft: "1.2rem",
            fontSize: "0.86rem",
            color: "var(--muted)"
          }}
        >
          {view.orderedCoverages.map((c) => (
            <li key={c.coverageId} style={{ marginBottom: "0.2rem" }}>
              <strong style={{ color: "var(--fg)" }}>
                {c.payerName || c.coverageId}
              </strong>{" "}
              (<code>{c.coverageId}</code>) — {c.decidingRuleLabel}{" "}
              <code>{c.decidingRuleId}</code>
            </li>
          ))}
        </ol>
      )}

      <div
        role="note"
        aria-label="Coordination-of-benefits integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Decree-overrides-birthday · rule-sourced · no autonomous adjudication{" "}
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
          cobDecreeHonored = {String(view.cobDecreeHonored)} · cobRuleCited ={" "}
          {String(view.cobRuleCited)} · cobHumanCosigned ={" "}
          {String(view.cobHumanCosigned)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
