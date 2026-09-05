"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AccountingDetermination,
  type AccountingRequest,
  type ClassifiedDisclosure,
  DEMO_ACCOUNTING_MIXED_REQUEST,
  DEMO_ACCOUNTING_REQUEST,
  DEMO_ACCOUNTING_TPO_ONLY_REQUEST
} from "../lib/accounting-of-disclosures";

/**
 * Accounting of Disclosures (HIPAA §164.528) runner for the intake demo.
 *
 * Fires the real, server-side A2A Accounting of Disclosures agent at
 * /api/agents/accounting-of-disclosures/tasks — the data-substrate privacy service that assembles a
 * patient's accounting of who their PHI was disclosed to, and for what non-TPO purpose, over the
 * lookback window. The panel surfaces the window, the accountable / excluded / out-of-window counts,
 * the per-disclosure classification, the honesty signals, the synthetic labels, and a deep link into
 * the parented Agent Fabric trace.
 *
 * A determination — however many accountable disclosures it lists — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresPrivacyOfficerReview:true). The off-catalog-purpose, dropped-
 * accountable, and auto-suppressed presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * The purpose catalog + accountability rules are ILLUSTRATIVE, NOT a certified §164.528 system (a
 * real accounting is governed by HIPAA §164.528 and the covered entity's Notice of Privacy
 * Practices). Structure, styling tokens, and tone mirror <AuditLogIntegrityPanel> and
 * <MinimumNecessaryPanel> so this reads as a native sibling on /demo/intake.
 */

const ACCOUNTING_ROUTE = "/api/agents/accounting-of-disclosures/tasks";

/** A one-click demo scenario. */
export type AccountingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The accounting request the agent evaluates (the common case). */
  request?: AccountingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const ACCOUNTING_PRESETS: AccountingPreset[] = [
  {
    id: "mixed",
    label: "Mixed log → 2 accountable, 1 out of window",
    hint: "Treatment + payment (excluded), public-health + law-enforcement (accountable), an old report.",
    request: DEMO_ACCOUNTING_REQUEST,
    demonstrates:
      "TPO disclosures excluded, two non-TPO disclosures accounted, an old disclosure outside the 6-year window; privacy-officer review required."
  },
  {
    id: "judicial-research",
    label: "Judicial + research → both accountable",
    hint: "A subpoena + an unauthorized research disclosure (accountable), an authorized one (excluded).",
    request: DEMO_ACCOUNTING_MIXED_REQUEST,
    demonstrates:
      "A judicial order and an IRB-waiver research disclosure are accountable; a patient-authorized disclosure is excluded."
  },
  {
    id: "tpo-only",
    label: "TPO-only → empty accounting",
    hint: "Only treatment + payment disclosures — nothing accountable.",
    request: DEMO_ACCOUNTING_TPO_ONLY_REQUEST,
    demonstrates:
      "An all-TPO log yields an empty accounting, still requiring privacy-officer review."
  },
  {
    id: "off-catalog-purpose-block",
    label: "Off-catalog purpose → governance block",
    hint: "A determination classifying a made-up purpose id.",
    request: DEMO_ACCOUNTING_REQUEST,
    determination: {
      requestRef: "acct-req-001",
      patientRef: "patient-acct-001",
      asOfDate: "2026-09-01",
      lookbackYears: 6,
      windowStart: "2020-09-01",
      totalDisclosures: 1,
      classified: [
        {
          disclosureId: "disc-x",
          date: "2026-04-20",
          recipient: "State Department of Public Health",
          purposeId: "purpose.we-made-up",
          inWindow: true,
          disposition: "in-accounting"
        }
      ],
      accountableCount: 1,
      excludedCount: 0,
      outOfWindowCount: 0,
      requiresPrivacyOfficerReview: true,
      autonomousSuppression: false
    },
    demonstrates:
      "The Agent Fabric blocking a disclosure classified under an off-catalog purpose (policy.accounting.purpose-category-sourced)."
  },
  {
    id: "dropped-accountable-block",
    label: "Dropped accountable disclosure → governance block",
    hint: "A determination that excludes an accountable, in-window disclosure.",
    request: DEMO_ACCOUNTING_REQUEST,
    determination: {
      requestRef: "acct-req-001",
      patientRef: "patient-acct-001",
      asOfDate: "2026-09-01",
      lookbackYears: 6,
      windowStart: "2020-09-01",
      totalDisclosures: 1,
      classified: [
        {
          disclosureId: "disc-004",
          date: "2026-06-11",
          recipient: "County Sheriff's Office",
          purposeId: "purpose.law-enforcement",
          inWindow: true,
          // Wrong: an accountable law-enforcement disclosure mis-labeled as excluded-TPO.
          disposition: "excluded-tpo"
        }
      ],
      accountableCount: 0,
      excludedCount: 1,
      outOfWindowCount: 0,
      requiresPrivacyOfficerReview: true,
      autonomousSuppression: false
    },
    demonstrates:
      "The Agent Fabric blocking an accountable, in-window disclosure dropped from the accounting (policy.accounting.accountable-disclosures-complete)."
  },
  {
    id: "auto-suppress-block",
    label: "Auto-suppressed disclosure → governance block",
    hint: "A determination that autonomously suppresses a logged disclosure.",
    request: DEMO_ACCOUNTING_REQUEST,
    determination: {
      requestRef: "acct-req-001",
      patientRef: "patient-acct-001",
      asOfDate: "2026-09-01",
      lookbackYears: 6,
      windowStart: "2020-09-01",
      totalDisclosures: 1,
      classified: [
        {
          disclosureId: "disc-004",
          date: "2026-06-11",
          recipient: "County Sheriff's Office",
          purposeId: "purpose.law-enforcement",
          inWindow: true,
          disposition: "in-accounting"
        }
      ],
      accountableCount: 1,
      excludedCount: 0,
      outOfWindowCount: 0,
      requiresPrivacyOfficerReview: false,
      autonomousSuppression: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-suppressed / auto-released accounting (policy.accounting.no-autonomous-suppression)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type AccountingResolvedView = {
  kind: "resolved";
  requestRef: string;
  patientRef: string;
  asOfDate: string;
  lookbackYears: number;
  windowStart: string;
  totalDisclosures: number;
  classified: ClassifiedDisclosure[];
  accountableCount: number;
  excludedCount: number;
  outOfWindowCount: number;
  requiresPrivacyOfficerReview: boolean;
  reason: string;
  note: string;
  accountingPurposeSourced: boolean;
  accountingDisclosuresComplete: boolean;
  accountingNoAutonomousSuppression: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AccountingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AccountingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AccountingView =
  | AccountingResolvedView
  | AccountingBlockedView
  | AccountingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  accountingPurposeSourced?: unknown;
  accountingDisclosuresComplete?: unknown;
  accountingNoAutonomousSuppression?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildAuditLogRequestBody.
 */
export function buildAccountingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AccountingRequest;
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
 * POST an accounting request (or an asserted determination) to the Accounting of Disclosures agent
 * and return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only a malformed
 * envelope / parse error is a non-OK response.
 */
export async function runAccountingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AccountingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ACCOUNTING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAccountingRequestBody(input))
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
export function accountingViewFromTask(task: A2ATask): AccountingView {
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
        "The Agent Fabric blocked this accounting-of-disclosures run.";
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
        : "The accounting of disclosures could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: AccountingDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    patientRef: det?.patientRef ?? "",
    asOfDate: det?.asOfDate ?? "",
    lookbackYears: det?.lookbackYears ?? 0,
    windowStart: det?.windowStart ?? "",
    totalDisclosures: det?.totalDisclosures ?? 0,
    classified: det?.classified ?? [],
    accountableCount: det?.accountableCount ?? 0,
    excludedCount: det?.excludedCount ?? 0,
    outOfWindowCount: det?.outOfWindowCount ?? 0,
    requiresPrivacyOfficerReview: det?.requiresPrivacyOfficerReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    accountingPurposeSourced: fabric.accountingPurposeSourced === true,
    accountingDisclosuresComplete: fabric.accountingDisclosuresComplete === true,
    accountingNoAutonomousSuppression: fabric.accountingNoAutonomousSuppression === true,
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
  | { status: "done"; view: AccountingView }
  | { status: "error"; message: string };

export function AccountingOfDisclosuresPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AccountingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAccountingTask({
          taskId: newTaskId("accounting-of-disclosures"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: accountingViewFromTask(task) });
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
        Accounting of disclosures · HIPAA §164.528 · data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Accounting of Disclosures — every accountable disclosure, never an autonomous suppression
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a patient&rsquo;s <strong>disclosure log</strong> (each disclosure a date, a recipient,
        and the cited <strong>purpose-of-disclosure</strong>), an <strong>as-of date</strong>, and a{" "}
        <strong>lookback window</strong>, this agent <strong>deterministically</strong> classifies
        each disclosure against the §164.528 rules (treatment / payment / operations and
        patient-authorized are <strong>excluded</strong>; non-TPO disclosures are{" "}
        <strong>accountable</strong>), filters to the window, and assembles the accounting. It{" "}
        <strong>classifies and assembles</strong> — it <strong>never</strong> deletes or suppresses a
        logged disclosure, and the accounting is a{" "}
        <strong>recommendation requiring privacy-officer review</strong>.{" "}
        <strong>
          The purpose catalog and accountability rules are illustrative, not a certified §164.528
          system.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ACCOUNTING_PRESETS.map((preset) => (
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
              ? "Assembling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Accounting run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AccountingResult view={runState.view} />}
    </section>
  );
}

function dispositionTone(disposition: ClassifiedDisclosure["disposition"]): string {
  switch (disposition) {
    case "in-accounting":
      return "#8fd6b0";
    case "excluded-tpo":
      return "#9db8ff";
    case "excluded-authorized":
      return "#c9b8ff";
    default:
      return "#ffd28a";
  }
}

function AccountingResult({ view }: { view: AccountingView }) {
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
        §164.528 accounting (deterministic, synthetic)
        {view.patientRef ? ` · ${view.patientRef}` : ""} · {view.lookbackYears}-yr window from{" "}
        {view.windowStart || "—"}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Accountable" value={String(view.accountableCount)} tone="#8fd6b0" />{" "}
        <Pill label="Excluded (TPO/auth)" value={String(view.excludedCount)} tone="#9db8ff" />{" "}
        <Pill label="Out of window" value={String(view.outOfWindowCount)} tone="#ffd28a" />{" "}
        <Pill
          label="Privacy-officer review"
          value={String(view.requiresPrivacyOfficerReview)}
          tone={view.requiresPrivacyOfficerReview ? "#ffd28a" : "#ff9db1"}
        />
      </p>

      {view.classified.length > 0 && (
        <ul
          style={{
            margin: "0.6rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.classified.map((c) => (
            <li key={c.disclosureId} style={{ marginBottom: "0.15rem" }}>
              <span style={{ color: dispositionTone(c.disposition), fontWeight: 600 }}>
                {c.disposition}
              </span>{" "}
              · {c.date} · {c.recipient} · <em>{c.purposeLabel}</em>
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Accounting of disclosures compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Purpose sourced · every accountable disclosure listed · never an autonomous suppression{" "}
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
          accountingPurposeSourced = {String(view.accountingPurposeSourced)} ·
          accountingDisclosuresComplete = {String(view.accountingDisclosuresComplete)} ·
          accountingNoAutonomousSuppression = {String(view.accountingNoAutonomousSuppression)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
