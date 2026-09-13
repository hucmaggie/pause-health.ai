"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type DuplicateScreenDetermination,
  type DuplicateScreenDisposition,
  type DuplicateScreenRequest,
  type ScreenResult,
  DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST,
  DEMO_DUPLICATE_SCREEN_REQUEST,
  DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST,
  evaluateDuplicateScreen
} from "../lib/duplicate-claim-screen";

/**
 * Duplicate-Claim Pre-Screen / Bloom-Filter Membership Test runner for the intake demo.
 *
 * Fires the real, server-side A2A Duplicate-Claim Screen agent at /api/agents/duplicate-claim-screen/tasks — a
 * payer-operations claims pre-screen that builds a Bloom filter over processed claim ids and screens each
 * incoming id as definitely-new or possibly-duplicate. The panel surfaces the disposition, the per-id verdicts,
 * the tallies, the estimated false-positive rate, the honesty signals, the synthetic / PHI-adjacent labels, and a
 * deep link into the parented Agent Fabric trace.
 *
 * A screen — all-clear or possible-duplicates — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresAdjudicatorReview:true, autoRejected:false). A possible-duplicates disposition is a LEGITIMATE FINDING
 * that ALWAYS defers to the authoritative exact check, NOT a governance block. The fabricated-array,
 * false-negative, and auto-rejected presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — claim ids. The ids are an ILLUSTRATIVE synthetic, NOT a certified claims-dedup system.
 * Structure, styling tokens, and tone mirror <ContactRateLimitPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const DUPLICATE_SCREEN_ROUTE = "/api/agents/duplicate-claim-screen/tasks";

/** A one-click demo scenario. */
export type DuplicateScreenPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: DuplicateScreenRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);

export const DUPLICATE_SCREEN_PRESETS: DuplicateScreenPreset[] = [
  {
    id: "possible-duplicates",
    label: "Claims batch — possible duplicates",
    hint: "Five incoming ids; three re-submissions.",
    request: DEMO_DUPLICATE_SCREEN_REQUEST,
    demonstrates: "Bloom filter — 3 possible duplicates (all caught, no false negatives), 2 definitely new."
  },
  {
    id: "all-clear",
    label: "Fresh batch — all clear",
    hint: "Every incoming id is genuinely new.",
    request: DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST,
    demonstrates: "All definitely-new — none match the processed set."
  },
  {
    id: "saturated",
    label: "Undersized filter — high false-positive rate",
    hint: "Too few bits for the inserts.",
    request: DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST,
    demonstrates: "The space/accuracy trade-off — a false positive routed (safely) to the exact check."
  },
  {
    id: "fabricated-array-block",
    label: "Fabricated bit array → governance block",
    hint: "A bit array that isn't the real insert.",
    request: DEMO_DUPLICATE_SCREEN_REQUEST,
    determination: (() => {
      const bits = VALID_DETERMINATION.bits.slice();
      bits[0] = bits[0] === 1 ? 0 : 1;
      return {
        ...VALID_DETERMINATION,
        bits,
        setBitCount: bits.reduce((s, b) => s + b, 0)
      };
    })(),
    demonstrates:
      "The Agent Fabric blocking a bit array that isn't the real insert (policy.dupscreen.filter-sourced)."
  },
  {
    id: "false-negative-block",
    label: "False negative → governance block",
    hint: "A known duplicate reported as definitely-new.",
    request: DEMO_DUPLICATE_SCREEN_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      results: VALID_DETERMINATION.results.map((r) =>
        r.id === "CLM-88002" ? { ...r, verdict: "definitely-new" as const } : r
      ),
      possibleDuplicateCount: 2,
      definitelyNewCount: 3
    },
    demonstrates:
      "The Agent Fabric blocking a false negative — the one failure a Bloom filter must never make (policy.dupscreen.membership-exact)."
  },
  {
    id: "auto-rejected-block",
    label: "Rejected autonomously → governance block",
    hint: "A screen that denied a claim itself.",
    request: DEMO_DUPLICATE_SCREEN_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresAdjudicatorReview: false,
      autoRejected: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous rejection (policy.dupscreen.no-autonomous-reject)."
  }
];

/** Render-ready view of a produced screen lifted from the task. */
export type DuplicateScreenResolvedView = {
  kind: "resolved";
  batchRef: string;
  disposition: DuplicateScreenDisposition;
  results: ScreenResult[];
  possibleDuplicateCount: number;
  definitelyNewCount: number;
  setBitCount: number;
  estimatedFalsePositiveRate: number;
  reason: string;
  note: string;
  dupScreenFilterSourced: boolean;
  dupScreenMembershipExact: boolean;
  dupScreenNoAutonomousReject: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type DuplicateScreenBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type DuplicateScreenInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type DuplicateScreenView =
  | DuplicateScreenResolvedView
  | DuplicateScreenBlockedView
  | DuplicateScreenInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  dupScreenFilterSourced?: unknown;
  dupScreenMembershipExact?: unknown;
  dupScreenNoAutonomousReject?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildDuplicateScreenRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: DuplicateScreenRequest;
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
export async function runDuplicateScreenTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: DuplicateScreenRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(DUPLICATE_SCREEN_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDuplicateScreenRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced screen
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function duplicateScreenViewFromTask(task: A2ATask): DuplicateScreenView {
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
        "The Agent Fabric blocked this pre-screen.";
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
      (typeof fabric.error === "string" ? fabric.error : "The pre-screen could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: DuplicateScreenDetermination; batchRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    batchRef: result?.batchRef ?? det?.batchRef ?? "",
    disposition: det?.disposition ?? "all-clear",
    results: det?.results ?? [],
    possibleDuplicateCount: det?.possibleDuplicateCount ?? 0,
    definitelyNewCount: det?.definitelyNewCount ?? 0,
    setBitCount: det?.setBitCount ?? 0,
    estimatedFalsePositiveRate: det?.estimatedFalsePositiveRate ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    dupScreenFilterSourced: fabric.dupScreenFilterSourced === true,
    dupScreenMembershipExact: fabric.dupScreenMembershipExact === true,
    dupScreenNoAutonomousReject: fabric.dupScreenNoAutonomousReject === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<DuplicateScreenDisposition, string> = {
  "all-clear": "#8fd6b0",
  "possible-duplicates": "#ffd28a"
};

const DISPOSITION_LABEL: Record<DuplicateScreenDisposition, string> = {
  "all-clear": "All clear · every incoming id is definitely new",
  "possible-duplicates": "Possible duplicates · some ids route to the authoritative check"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: DuplicateScreenView }
  | { status: "error"; message: string };

export function DuplicateClaimScreenPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: DuplicateScreenPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runDuplicateScreenTask({
          taskId: newTaskId("duplicate-claim-screen"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: duplicateScreenViewFromTask(task) });
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
        Payer operations &middot; claims dedup &middot; Bloom-filter pre-screen
      </p>
      <h3 style={{ margin: 0 }}>
        Duplicate-Claim Pre-Screen — filter sourced &amp; self-consistent, membership re-derived (no false
        negatives), never an autonomous rejection
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> builds a <strong>Bloom filter</strong> over{" "}
        <strong>already-processed claim ids</strong> and screens each incoming id as{" "}
        <strong>definitely-new</strong> (provably never processed &mdash; <strong>no false negatives</strong>) or{" "}
        <strong>possibly-duplicate</strong> (route to the authoritative check). The bit array is a real{" "}
        <strong>exact insert</strong>, the membership is <strong>re-derived independently</strong>, and it is a{" "}
        <strong>recommendation</strong>: a possibly-duplicate <strong>always defers</strong> to the exact check
        &mdash; the agent <strong>never</strong> rejects or denies a claim &mdash; an adjudicator confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified dedup system.</strong> Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {DUPLICATE_SCREEN_PRESETS.map((preset) => (
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
          Pre-screen failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <DuplicateScreenResult view={runState.view} />}
    </section>
  );
}

function DuplicateScreenResult({ view }: { view: DuplicateScreenView }) {
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
        Duplicate pre-screen (deterministic, synthetic)
        {view.batchRef ? ` · ${view.batchRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.possibleDuplicateCount} possible-duplicate &middot; {view.definitelyNewCount} definitely-new
        &middot; {view.setBitCount} bits set &middot; est. false-positive rate{" "}
        {view.estimatedFalsePositiveRate}
      </p>

      {view.results.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.results.map((r) => (
            <li key={r.id}>
              <code style={{ color: r.verdict === "definitely-new" ? "#8fd6b0" : "#ffd28a" }}>
                {r.id}
              </code>{" "}
              &rarr; {r.verdict}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Duplicate-claim pre-screen safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; membership-exact (no false negatives) &middot; never an autonomous rejection{" "}
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
          dupScreenFilterSourced = {String(view.dupScreenFilterSourced)} &middot; dupScreenMembershipExact ={" "}
          {String(view.dupScreenMembershipExact)} &middot; dupScreenNoAutonomousReject ={" "}
          {String(view.dupScreenNoAutonomousReject)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
