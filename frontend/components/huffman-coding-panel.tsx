"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type HuffmanDetermination,
  type HuffmanDisposition,
  type HuffmanRequest,
  type SymbolCode,
  DEMO_HUFFMAN_REQUEST,
  DEMO_HUFFMAN_SKEWED_REQUEST,
  DEMO_HUFFMAN_UNIFORM_REQUEST,
  evaluateHuffman
} from "../lib/huffman-coding";

/**
 * Event-Stream Code Assignment / Huffman Optimal Prefix Coding runner for the intake demo.
 *
 * Fires the real, server-side A2A Huffman Coding agent at /api/agents/huffman-coding/tasks — a data-plane
 * code-assignment service that assigns an optimal prefix-free code to an event stream by frequency. The panel
 * surfaces the disposition, the per-symbol codes (with lengths + frequencies), the weighted total vs the
 * fixed-width baseline, the honesty signals, the synthetic / non-PHI labels, and a deep link into the parented
 * Agent Fabric trace.
 *
 * A code assignment — compressible or already-uniform — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresEngineerReview:true, autoDeployed:false). The non-prefix-free, sub-optimal, and auto-deployed presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * NON-PHI — an event-type frequency is aggregate integration telemetry. The frequencies are an ILLUSTRATIVE
 * synthetic, NOT a certified codec / compression system. Structure, styling tokens, and tone mirror
 * <ListReconciliationPanel> so this reads as a native sibling on /demo/intake.
 */

const HUFFMAN_CODING_ROUTE = "/api/agents/huffman-coding/tasks";

/** A one-click demo scenario. */
export type HuffmanCodingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: HuffmanRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
const VALID_SKEWED = evaluateHuffman(DEMO_HUFFMAN_SKEWED_REQUEST);

export const HUFFMAN_CODING_PRESETS: HuffmanCodingPreset[] = [
  {
    id: "compressible",
    label: "RPM device events \u2014 compressible",
    hint: "Five skewed event types; the frequent one gets the shortest code.",
    request: DEMO_HUFFMAN_REQUEST,
    demonstrates: "Huffman coding \u2014 178 bits vs 300 fixed-width (122 saved)."
  },
  {
    id: "uniform",
    label: "Uniform stream \u2014 no gain",
    hint: "Four equally-frequent types match the fixed-width code.",
    request: DEMO_HUFFMAN_UNIFORM_REQUEST,
    demonstrates: "An already-uniform stream \u2014 Huffman equals the 2-bit fixed-width code."
  },
  {
    id: "skewed",
    label: "Ack/nack stream \u2014 large gain",
    hint: "A heavily-skewed stream compresses hard.",
    request: DEMO_HUFFMAN_SKEWED_REQUEST,
    demonstrates: "130 bits vs 200 fixed-width \u2014 the ack gets a one-bit code."
  },
  {
    id: "non-prefix-free-block",
    label: "Non-prefix-free code \u2192 governance block",
    hint: "A code that isn't uniquely decodable.",
    request: DEMO_HUFFMAN_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      codes: [
        { symbol: "heartbeat", code: "0", length: 1, frequency: 50 },
        { symbol: "reading-normal", code: "01", length: 2, frequency: 30 },
        { symbol: "reading-high", code: "110", length: 3, frequency: 12 },
        { symbol: "battery-low", code: "1110", length: 4, frequency: 5 },
        { symbol: "sync-error", code: "1111", length: 4, frequency: 3 }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a code where one code is a prefix of another (policy.huffcode.code-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal code \u2192 governance block",
    hint: "A fixed-width code that wastes bandwidth.",
    request: DEMO_HUFFMAN_SKEWED_REQUEST,
    determination: {
      ...VALID_SKEWED,
      codes: [
        { symbol: "ack", code: "00", length: 2, frequency: 80 },
        { symbol: "nack", code: "01", length: 2, frequency: 10 },
        { symbol: "retry", code: "10", length: 2, frequency: 6 },
        { symbol: "drop", code: "11", length: 2, frequency: 4 }
      ],
      weightedTotal: 200,
      disposition: "already-uniform"
    },
    demonstrates:
      "The Agent Fabric blocking a prefix code that isn't the Huffman optimum (policy.huffcode.code-optimal)."
  },
  {
    id: "auto-deployed-block",
    label: "Deployed autonomously \u2192 governance block",
    hint: "A codec that pushed itself to the live bus.",
    request: DEMO_HUFFMAN_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresEngineerReview: false,
      autoDeployed: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous deploy (policy.huffcode.no-autonomous-deploy)."
  }
];

/** Render-ready view of a produced code assignment lifted from the task. */
export type HuffmanCodingResolvedView = {
  kind: "resolved";
  streamRef: string;
  disposition: HuffmanDisposition;
  codes: SymbolCode[];
  weightedTotal: number;
  fixedTotal: number;
  savedBits: number;
  reason: string;
  note: string;
  huffCodeSourced: boolean;
  huffCodeOptimal: boolean;
  huffCodeNoAutonomousDeploy: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type HuffmanCodingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type HuffmanCodingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type HuffmanCodingView =
  | HuffmanCodingResolvedView
  | HuffmanCodingBlockedView
  | HuffmanCodingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  huffCodeSourced?: unknown;
  huffCodeOptimal?: unknown;
  huffCodeNoAutonomousDeploy?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildHuffmanCodingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: HuffmanRequest;
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
 * POST a coding request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runHuffmanCodingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: HuffmanRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(HUFFMAN_CODING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildHuffmanCodingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced code
 * assignment (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function huffmanCodingViewFromTask(task: A2ATask): HuffmanCodingView {
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
        "The Agent Fabric blocked this code assignment.";
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
      (typeof fabric.error === "string" ? fabric.error : "The code assignment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: HuffmanDetermination; streamRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    streamRef: result?.streamRef ?? det?.streamRef ?? "",
    disposition: det?.disposition ?? "already-uniform",
    codes: det?.codes ?? [],
    weightedTotal: det?.weightedTotal ?? 0,
    fixedTotal: det?.fixedTotal ?? 0,
    savedBits: (det?.fixedTotal ?? 0) - (det?.weightedTotal ?? 0),
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    huffCodeSourced: fabric.huffCodeSourced === true,
    huffCodeOptimal: fabric.huffCodeOptimal === true,
    huffCodeNoAutonomousDeploy: fabric.huffCodeNoAutonomousDeploy === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<HuffmanDisposition, string> = {
  compressible: "#8fd6b0",
  "already-uniform": "#ffd28a"
};

const DISPOSITION_LABEL: Record<HuffmanDisposition, string> = {
  compressible: "Compressible \u00b7 the optimal prefix code beats the fixed-width baseline",
  "already-uniform": "Already uniform \u00b7 Huffman equals the fixed-width code (no gain)"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: HuffmanCodingView }
  | { status: "error"; message: string };

export function HuffmanCodingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: HuffmanCodingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runHuffmanCodingTask({
          taskId: newTaskId("huffman-coding"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: huffmanCodingViewFromTask(task) });
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
        Data plane &middot; stream codec &middot; optimal prefix coding
      </p>
      <h3 style={{ margin: 0 }}>
        Event-Stream Code Assignment — code sourced &amp; self-consistent, Huffman optimum recomputed, never an
        autonomous deploy
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> assigns an{" "}
        <strong>optimal prefix-free code</strong> to a stream of event types by{" "}
        <strong>frequency</strong> &mdash; the frequent type gets the shortest code &mdash; minimizing the{" "}
        <strong>total encoded length</strong>. Every code is a <strong>uniquely-decodable prefix code</strong>,
        the total is the <strong>proven Huffman minimum</strong>, and it is a <strong>recommendation</strong>:
        the agent <strong>never</strong> deploys the codec or re-encodes the live stream &mdash; an engineer
        confirms.{" "}
        <strong>Non-PHI &middot; illustrative, not a certified codec system.</strong> Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {HUFFMAN_CODING_PRESETS.map((preset) => (
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
              ? "Coding\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Coding failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <HuffmanCodingResult view={runState.view} />}
    </section>
  );
}

function HuffmanCodingResult({ view }: { view: HuffmanCodingView }) {
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
        Code assignment (deterministic, synthetic)
        {view.streamRef ? ` \u00b7 ${view.streamRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.weightedTotal} bits vs {view.fixedTotal} fixed-width
        {view.savedBits > 0 ? ` \u00b7 ${view.savedBits} saved` : ""}
      </p>

      {view.codes.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.codes.map((c) => (
            <li key={c.symbol}>
              <code>{c.symbol}</code> &middot; freq {c.frequency} &rarr;{" "}
              <code style={{ color: tone }}>{c.code}</code> ({c.length} bit
              {c.length === 1 ? "" : "s"})
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Code assignment safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; Huffman-optimal &middot; never an autonomous deploy{" "}
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
            synthetic &middot; non-PHI
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
          huffCodeSourced = {String(view.huffCodeSourced)} &middot; huffCodeOptimal ={" "}
          {String(view.huffCodeOptimal)} &middot; huffCodeNoAutonomousDeploy ={" "}
          {String(view.huffCodeNoAutonomousDeploy)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
