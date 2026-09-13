"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AuditSampleDetermination,
  type AuditSampleDisposition,
  type AuditSampleRequest,
  DEMO_AUDIT_SAMPLE_FULL_REQUEST,
  DEMO_AUDIT_SAMPLE_RESEED_REQUEST,
  DEMO_AUDIT_SAMPLE_REQUEST,
  evaluateAuditSample
} from "../lib/audit-sample";

/**
 * Audit Sample Selection / Reservoir Sampling (Algorithm R, Seeded) runner for the intake demo.
 *
 * Fires the real, server-side A2A Audit Sample agent at /api/agents/audit-sample/tasks — a payer-operations
 * compliance-sampling service that draws a reproducible k-record sample from a stream via seeded reservoir
 * sampling. The panel surfaces the disposition, the selected sample, the population / inclusion stats, the seed,
 * the honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented Agent Fabric
 * trace.
 *
 * A sample — sampled or full-population — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresAuditorReview:true, autoAudited:false). A full-population disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The fabricated-id, cherry-picked, and auto-audited presets assert offending DETERMINATIONS —
 * so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — record ids. The ids are an ILLUSTRATIVE synthetic, NOT a certified statistical-sampling system.
 * Structure, styling tokens, and tone mirror <DuplicateClaimScreenPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const AUDIT_SAMPLE_ROUTE = "/api/agents/audit-sample/tasks";

/** A one-click demo scenario. */
export type AuditSamplePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: AuditSampleRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);

export const AUDIT_SAMPLE_PRESETS: AuditSamplePreset[] = [
  {
    id: "sampled",
    label: "SIU audit — reproducible sample",
    hint: "Draw 5 of 20 claim ids with a fixed seed.",
    request: DEMO_AUDIT_SAMPLE_REQUEST,
    demonstrates: "Reservoir sampling — a defensible 5-of-20 sample, each with a 0.25 inclusion probability."
  },
  {
    id: "reseed",
    label: "Same population, different seed",
    hint: "The seed (not chance) determines the draw.",
    request: DEMO_AUDIT_SAMPLE_RESEED_REQUEST,
    demonstrates: "A different reproducible sample — swapping the seed swaps the records."
  },
  {
    id: "full-population",
    label: "Small population — full census",
    hint: "Population smaller than the sample size.",
    request: DEMO_AUDIT_SAMPLE_FULL_REQUEST,
    demonstrates: "Full-population — nothing to sample, so every record is selected."
  },
  {
    id: "fabricated-id-block",
    label: "Fabricated id → governance block",
    hint: "A selected id that isn't in the population.",
    request: DEMO_AUDIT_SAMPLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      sample: [...VALID_DETERMINATION.sample.slice(0, 4), "CLM-FAKE"]
    },
    demonstrates:
      "The Agent Fabric blocking a sample with an id that isn't in the population (policy.auditsample.sample-sourced)."
  },
  {
    id: "cherry-picked-block",
    label: "Cherry-picked → governance block",
    hint: "Real ids, but not the seeded draw.",
    request: DEMO_AUDIT_SAMPLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      sample: ["CLM-44201", "CLM-44202", "CLM-44203", "CLM-44205", "CLM-44206"]
    },
    demonstrates:
      "The Agent Fabric blocking a sample the seed wouldn't produce (policy.auditsample.selection-reproducible)."
  },
  {
    id: "auto-audited-block",
    label: "Audited autonomously → governance block",
    hint: "A sample that opened the records itself.",
    request: DEMO_AUDIT_SAMPLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresAuditorReview: false,
      autoAudited: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous audit action (policy.auditsample.no-autonomous-audit)."
  }
];

/** Render-ready view of a produced sample lifted from the task. */
export type AuditSampleResolvedView = {
  kind: "resolved";
  auditRef: string;
  disposition: AuditSampleDisposition;
  sample: string[];
  populationSize: number;
  effectiveSampleSize: number;
  inclusionProbability: number;
  seed: number;
  reason: string;
  note: string;
  auditSampleSourced: boolean;
  auditSelectionReproducible: boolean;
  auditNoAutonomousAudit: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AuditSampleBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AuditSampleInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AuditSampleView =
  | AuditSampleResolvedView
  | AuditSampleBlockedView
  | AuditSampleInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  auditSampleSourced?: unknown;
  auditSelectionReproducible?: unknown;
  auditNoAutonomousAudit?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildAuditSampleRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AuditSampleRequest;
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
 * POST a request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runAuditSampleTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AuditSampleRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(AUDIT_SAMPLE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAuditSampleRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced sample
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function auditSampleViewFromTask(task: A2ATask): AuditSampleView {
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
        "The Agent Fabric blocked this sample.";
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
      (typeof fabric.error === "string" ? fabric.error : "The sample could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: AuditSampleDetermination; auditRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    auditRef: result?.auditRef ?? det?.auditRef ?? "",
    disposition: det?.disposition ?? "sampled",
    sample: det?.sample ?? [],
    populationSize: det?.populationSize ?? 0,
    effectiveSampleSize: det?.effectiveSampleSize ?? 0,
    inclusionProbability: det?.inclusionProbability ?? 0,
    seed: det?.seed ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    auditSampleSourced: fabric.auditSampleSourced === true,
    auditSelectionReproducible: fabric.auditSelectionReproducible === true,
    auditNoAutonomousAudit: fabric.auditNoAutonomousAudit === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<AuditSampleDisposition, string> = {
  sampled: "#8fd6b0",
  "full-population": "#ffd28a"
};

const DISPOSITION_LABEL: Record<AuditSampleDisposition, string> = {
  sampled: "Sampled · a reproducible uniform k-record subset",
  "full-population": "Full population · the population is at most k, so all records are selected"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: AuditSampleView }
  | { status: "error"; message: string };

export function AuditSamplePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AuditSamplePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAuditSampleTask({
          taskId: newTaskId("audit-sample"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: auditSampleViewFromTask(task) });
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
        Payer operations &middot; compliance sampling &middot; reservoir sampling
      </p>
      <h3 style={{ margin: 0 }}>
        Audit Sample Selection — sample sourced &amp; self-consistent, selection reproducible from its seed,
        never an autonomous audit
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> draws a{" "}
        <strong>statistically-defensible k-record sample</strong> from a large stream of{" "}
        <strong>record ids</strong> in a <strong>single pass</strong> &mdash; solved by{" "}
        <strong>seeded reservoir sampling (Algorithm R)</strong> &mdash; giving every record an equal{" "}
        <strong>k/n</strong> chance. The sample is a real <strong>subset</strong>, the draw is{" "}
        <strong>reproducible from its seed</strong> (an auditor can re-run it), and it is a{" "}
        <strong>recommendation</strong> of which records to pull: the agent <strong>never</strong> opens or
        audits a record &mdash; a compliance auditor runs the audit.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified sampling system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {AUDIT_SAMPLE_PRESETS.map((preset) => (
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
              ? "Sampling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Sampling failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AuditSampleResult view={runState.view} />}
    </section>
  );
}

function AuditSampleResult({ view }: { view: AuditSampleView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace &rarr;
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
                <code>{v.policyId}</code> &mdash; {v.reason}
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

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Audit sample (deterministic, synthetic)
        {view.auditRef ? ` · ${view.auditRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.effectiveSampleSize} of {view.populationSize} record
        {view.populationSize === 1 ? "" : "s"} &middot; inclusion probability {view.inclusionProbability}{" "}
        &middot; seed {view.seed}
      </p>

      {view.sample.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.sample.map((id) => (
            <li key={id}>
              <code style={{ color: tone }}>{id}</code>
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Audit sample safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; reproducible &middot; never an autonomous audit{" "}
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
            synthetic &middot; PHI-adjacent
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
          auditSampleSourced = {String(view.auditSampleSourced)} &middot; auditSelectionReproducible ={" "}
          {String(view.auditSelectionReproducible)} &middot; auditNoAutonomousAudit ={" "}
          {String(view.auditNoAutonomousAudit)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
