"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CodeClassification,
  type CodeTaxonomyDetermination,
  type CodeTaxonomyDisposition,
  type CodeTaxonomyRequest,
  DEMO_CODE_TAXONOMY_ALL_REQUEST,
  DEMO_CODE_TAXONOMY_REQUEST,
  DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST,
  evaluateCodeTaxonomy
} from "../lib/code-taxonomy";

/**
 * Clinical Code Taxonomy / Longest-Prefix Classification runner for the intake demo.
 *
 * Fires the real, server-side A2A Code Taxonomy agent at /api/agents/code-taxonomy/tasks — a terminology /
 * value-set service that classifies a batch of clinical codes to their most-specific matching category via a
 * trie longest-prefix match. The panel surfaces the disposition, the per-code classifications, the honesty
 * signals, the synthetic / non-PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A batch — all-classified or unclassified-present — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCoderReview:true, autoApplied:false). The fabricated-code, wrong-bucket, and auto-applied presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * DELIBERATELY NOT PHI-bearing — a code is a terminology token, classified against a value-set taxonomy, not
 * patient health information. The taxonomy + codes are ILLUSTRATIVE synthetics, NOT a certified terminology /
 * code-set engine. Structure, styling tokens, and tone mirror <SourceConsensusPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const CODE_TAXONOMY_ROUTE = "/api/agents/code-taxonomy/tasks";

/** A one-click demo scenario. */
export type CodeTaxonomyPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CodeTaxonomyRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the mixed demo — the block base. */
const VALID_DETERMINATION = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);

export const CODE_TAXONOMY_PRESETS: CodeTaxonomyPreset[] = [
  {
    id: "mixed",
    label: "Mixed batch \u2192 unclassified-present",
    hint: "Menopause / endocrine ICD-10 codes + one out-of-taxonomy code.",
    request: DEMO_CODE_TAXONOMY_REQUEST,
    demonstrates:
      "Trie longest-prefix match \u2014 E28.310 buckets to E28.3, not the shallower E28."
  },
  {
    id: "all-classified",
    label: "All codes classify \u2192 all-classified",
    hint: "Every code matches a taxonomy prefix.",
    request: DEMO_CODE_TAXONOMY_ALL_REQUEST,
    demonstrates: "A clean batch \u2014 every code maps to its most-specific category."
  },
  {
    id: "specificity",
    label: "Longest-prefix specificity",
    hint: "E28.319 \u2192 E28.3, E28.1 \u2192 E28.",
    request: DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST,
    demonstrates: "The most specific matching prefix always wins."
  },
  {
    id: "phantom-code-block",
    label: "Fabricated code \u2192 governance block",
    hint: "A classification for a code that wasn't submitted.",
    request: DEMO_CODE_TAXONOMY_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      classifications: VALID_DETERMINATION.classifications.map((c, i) =>
        i === 0 ? { ...c, code: "PHANTOM.CODE" } : c
      )
    },
    demonstrates:
      "The Agent Fabric blocking a classification whose code was never in the batch (policy.code.classifications-sourced)."
  },
  {
    id: "wrong-bucket-block",
    label: "Wrong bucket \u2192 governance block",
    hint: "A real code mapped to the wrong category.",
    request: DEMO_CODE_TAXONOMY_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      classifications: VALID_DETERMINATION.classifications.map((c, i) =>
        i === 0
          ? { ...c, category: "Type 2 diabetes mellitus", matchedPrefix: "E11" }
          : c
      )
    },
    demonstrates:
      "The Agent Fabric blocking a classification that doesn't match the trie recompute (policy.code.classification-consistent)."
  },
  {
    id: "auto-applied-block",
    label: "Codes applied autonomously \u2192 governance block",
    hint: "A batch that re-coded the claim itself.",
    request: DEMO_CODE_TAXONOMY_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCoderReview: false,
      autoApplied: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous re-code (policy.code.no-autonomous-recode)."
  }
];

/** Render-ready view of a produced classification lifted from the task. */
export type CodeTaxonomyResolvedView = {
  kind: "resolved";
  catalogRef: string;
  disposition: CodeTaxonomyDisposition;
  classifications: CodeClassification[];
  classifiedCount: number;
  unclassifiedCount: number;
  total: number;
  reason: string;
  note: string;
  codeClassificationsSourced: boolean;
  codeClassificationConsistent: boolean;
  codeNoAutonomousRecode: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CodeTaxonomyBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CodeTaxonomyInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CodeTaxonomyView =
  | CodeTaxonomyResolvedView
  | CodeTaxonomyBlockedView
  | CodeTaxonomyInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  codeClassificationsSourced?: unknown;
  codeClassificationConsistent?: unknown;
  codeNoAutonomousRecode?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCodeTaxonomyRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CodeTaxonomyRequest;
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
 * POST a classification request (or an asserted determination) to the agent and return the resulting A2A
 * task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runCodeTaxonomyTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CodeTaxonomyRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CODE_TAXONOMY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCodeTaxonomyRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * classification (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function codeTaxonomyViewFromTask(task: A2ATask): CodeTaxonomyView {
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
        "The Agent Fabric blocked this classification.";
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
      (typeof fabric.error === "string" ? fabric.error : "The classification could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: CodeTaxonomyDetermination; catalogRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    catalogRef: result?.catalogRef ?? det?.catalogRef ?? "",
    disposition: det?.disposition ?? "all-classified",
    classifications: det?.classifications ?? [],
    classifiedCount: det?.classifiedCount ?? 0,
    unclassifiedCount: det?.unclassifiedCount ?? 0,
    total: det?.total ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    codeClassificationsSourced: fabric.codeClassificationsSourced === true,
    codeClassificationConsistent: fabric.codeClassificationConsistent === true,
    codeNoAutonomousRecode: fabric.codeNoAutonomousRecode === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CodeTaxonomyDisposition, string> = {
  "all-classified": "#8fd6b0",
  "unclassified-present": "#ffd28a"
};

const DISPOSITION_LABEL: Record<CodeTaxonomyDisposition, string> = {
  "all-classified": "All classified \u00b7 every code mapped by longest prefix",
  "unclassified-present": "Unclassified present \u00b7 a code matched no taxonomy prefix"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CodeTaxonomyView }
  | { status: "error"; message: string };

export function CodeTaxonomyPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CodeTaxonomyPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCodeTaxonomyTask({
          taskId: newTaskId("code-taxonomy"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: codeTaxonomyViewFromTask(task) });
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
        Data substrate &middot; terminology / value-set &middot; trie longest-prefix match
      </p>
      <h3 style={{ margin: 0 }}>
        Clinical Code Taxonomy — classifications sourced, match recomputed, never an autonomous re-code
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> classifies a batch of clinical codes to their{" "}
        <strong>most-specific category</strong> in a taxonomy &mdash; not a checksum, not an edit distance
        &mdash; a <strong>trie (prefix tree) longest-prefix match</strong>. The most specific matching prefix
        always wins (E28.310 &rarr; E28.3, not the shallower E28), and un-matched codes are honestly{" "}
        <strong>unclassified</strong>. Every classification is a <strong>real code</strong>, the match{" "}
        <strong>recomputes</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> re-codes a claim or submits the codes &mdash; a coder confirms.{" "}
        <strong>Not PHI-bearing &middot; illustrative, not a certified terminology engine.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CODE_TAXONOMY_PRESETS.map((preset) => (
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
              ? "Classifying\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Classification failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CodeTaxonomyResult view={runState.view} />}
    </section>
  );
}

function CodeTaxonomyResult({ view }: { view: CodeTaxonomyView }) {
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
        Classification (deterministic, synthetic)
        {view.catalogRef ? ` \u00b7 ${view.catalogRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.classifiedCount} of {view.total} code(s) classified
        {view.unclassifiedCount > 0 ? ` \u00b7 ${view.unclassifiedCount} unclassified` : ""}
      </p>

      {view.classifications.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.classifications.map((c) => (
            <li key={c.code}>
              <code>{c.code}</code>{" "}
              {c.category ? (
                <>
                  &rarr; {c.category}{" "}
                  <span style={{ color: "#8fd6b0" }}>
                    ({c.matchedPrefix})
                  </span>
                </>
              ) : (
                <span style={{ color: "#ffd28a" }}>&middot; unclassified</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Classification safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; recomputed &middot; never an autonomous re-code{" "}
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
            synthetic &middot; not PHI
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
          codeClassificationsSourced = {String(view.codeClassificationsSourced)} &middot;
          codeClassificationConsistent = {String(view.codeClassificationConsistent)} &middot;
          codeNoAutonomousRecode = {String(view.codeNoAutonomousRecode)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
