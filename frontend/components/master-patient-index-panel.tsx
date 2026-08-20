"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_CLEAR_MATCH_CANDIDATE,
  DEMO_INCOMING_RECORD,
  DEMO_NO_MATCH_CANDIDATE,
  DEMO_POSSIBLE_MATCH_CANDIDATE,
  type IdentityResolution,
  type PatientRecord,
  type ResolutionRecommendation,
  type ScoredCandidate
} from "../lib/master-patient-index";

/**
 * Master Patient Index / Identity Resolution runner for the intake demo.
 *
 * Fires the real, server-side A2A Master Patient Index agent at
 * /api/agents/master-patient-index/tasks — the MuleSoft control-plane /
 * data-substrate identity service, the identity/dedup layer of the data
 * substrate. It scores an INCOMING patient record against a set of CANDIDATE
 * records with a TRANSPARENT weighted demographic feature set, classifies each
 * as match / possible-match / no-match by fixed thresholds, and recommends a
 * resolution action (link / merge / manual-review / no-action). The panel
 * surfaces the scored candidates with their matched features, the classification
 * + recommendation, the requiresHumanReview flag, the honesty signals, and a
 * deep link into the parented Agent Fabric trace.
 *
 * A POSSIBLE-MATCH (manual-review, requiresHumanReview) is a SAFE, honest OUTPUT
 * surfaced for a human steward — NOT a block. The opaque-match, autonomous-merge,
 * and protected-class presets assert offending inputs — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * The match features, weights, thresholds, and records are ILLUSTRATIVE
 * synthetics, NOT a certified EMPI algorithm. Structure, styling tokens, and tone
 * mirror <RiskAdjustmentPanel> and <ConsentManagementPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const MPI_ROUTE = "/api/agents/master-patient-index/tasks";

/** A one-click demo scenario. */
export type MasterPatientIndexPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The incoming record the agent resolves (the common case). */
  incoming?: PatientRecord;
  /** The candidate records to resolve against (the common case). */
  candidates?: PatientRecord[];
  /** Caller-asserted scored candidates (used only for the transparent-matching block). */
  scoredCandidates?: Array<Record<string, unknown>>;
  /** Caller-asserted resolution (used only for the no-autonomous-merge block). */
  resolution?: Record<string, unknown>;
  /** Caller-asserted matching feature ids (used only for the protected-class block). */
  matchingFeatureIds?: string[];
};

export const MASTER_PATIENT_INDEX_PRESETS: MasterPatientIndexPreset[] = [
  {
    id: "clear-match",
    label: "Clear match → merge",
    hint: "The same patient from another source, with cosmetic formatting differences.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_CLEAR_MATCH_CANDIDATE],
    demonstrates:
      "A clear match scoring 100/100 across every demographic feature (with a shared identifier) → a merge recommendation, each match tracing to the defined feature spec."
  },
  {
    id: "possible-match",
    label: "Ambiguous → manual-review",
    hint: "Same name + DOB but a different address, phone, and identifiers.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_POSSIBLE_MATCH_CANDIDATE],
    demonstrates:
      "A possible-match in the review band → a manual-review recommendation with requiresHumanReview:true — a human steward reviews before any merge; a safe answer, not a block."
  },
  {
    id: "no-match",
    label: "Different person → no-action",
    hint: "A different patient entirely.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_NO_MATCH_CANDIDATE],
    demonstrates:
      "A candidate below the no-match cutoff → a no-action recommendation; the agent never links unrelated records."
  },
  {
    id: "opaque-match-block",
    label: "Opaque / off-spec match → governance block",
    hint: "A match asserted with an off-catalog, black-box feature.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_CLEAR_MATCH_CANDIDATE],
    scoredCandidates: [
      {
        candidateId: "mpi-candidate-clear-001",
        score: 99,
        matchedFeatures: [{ id: "feature.opaque-ml-score", label: "Opaque ML score", weight: 99 }],
        classification: "match"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a match that doesn't trace to the defined match-feature spec — an opaque / black-box score (policy.mpi.transparent-matching)."
  },
  {
    id: "autonomous-merge-block",
    label: "Autonomous merge below threshold → governance block",
    hint: "A merge of a possible-match performed without human review.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_POSSIBLE_MATCH_CANDIDATE],
    resolution: {
      recommendation: "merge",
      requiresHumanReview: false,
      bestMatch: {
        candidateId: "mpi-candidate-possible-001",
        score: 60,
        matchedFeatures: [],
        classification: "possible-match"
      }
    },
    demonstrates:
      "The Agent Fabric blocking a merge below the auto-match threshold performed autonomously — a merge below the threshold requires a human steward (policy.mpi.no-autonomous-merge)."
  },
  {
    id: "protected-class-block",
    label: "Protected-class feature → governance block",
    hint: "A protected-class attribute asserted as a matching feature.",
    incoming: DEMO_INCOMING_RECORD,
    candidates: [DEMO_CLEAR_MATCH_CANDIDATE],
    matchingFeatureIds: ["feature.name", "feature.dob", "attr.race"],
    demonstrates:
      "The Agent Fabric blocking a protected-class attribute (race) used as a matching feature — identity matching may use only permitted demographic identifiers (policy.mpi.no-protected-class-matching)."
  }
];

/** Render-ready view of a produced resolution lifted from the task. */
export type MasterPatientIndexResolvedView = {
  kind: "resolved";
  incomingRef: string;
  candidates: ScoredCandidate[];
  bestMatch?: ScoredCandidate;
  recommendation: ResolutionRecommendation;
  requiresHumanReview: boolean;
  note: string;
  matchTracesToFeatures: boolean;
  mergeRequiresHumanReview: boolean;
  excludesProtectedAttributesInMatching: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type MasterPatientIndexBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type MasterPatientIndexInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type MasterPatientIndexView =
  | MasterPatientIndexResolvedView
  | MasterPatientIndexBlockedView
  | MasterPatientIndexInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  matchTracesToFeatures?: unknown;
  mergeRequiresHumanReview?: unknown;
  excludesProtectedAttributesInMatching?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildRiskAdjustmentRequestBody.
 */
export function buildMasterPatientIndexRequestBody(input: {
  taskId: string;
  personaId?: string;
  incoming?: PatientRecord;
  candidates?: PatientRecord[];
  scoredCandidates?: Array<Record<string, unknown>>;
  resolution?: Record<string, unknown>;
  matchingFeatureIds?: string[];
}) {
  const data: Record<string, unknown> = {};
  if (input.incoming !== undefined) data.incoming = input.incoming;
  if (input.candidates !== undefined) data.candidates = input.candidates;
  if (input.scoredCandidates !== undefined) data.scoredCandidates = input.scoredCandidates;
  if (input.resolution !== undefined) data.resolution = input.resolution;
  if (input.matchingFeatureIds !== undefined) data.matchingFeatureIds = input.matchingFeatureIds;
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
 * POST an incoming record + candidates (or asserted scored candidates /
 * resolution / feature ids) to the Master Patient Index agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only
 * a malformed envelope / parse error is a non-OK response.
 */
export async function runMasterPatientIndexTask(
  input: {
    taskId: string;
    personaId?: string;
    incoming?: PatientRecord;
    candidates?: PatientRecord[];
    scoredCandidates?: Array<Record<string, unknown>>;
    resolution?: Record<string, unknown>;
    matchingFeatureIds?: string[];
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(MPI_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMasterPatientIndexRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * resolution (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function masterPatientIndexViewFromTask(task: A2ATask): MasterPatientIndexView {
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
        "The Agent Fabric blocked this identity-resolution run.";
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
        : "The identity resolution could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { resolution?: IdentityResolution; incomingRef?: string } | undefined) ??
    undefined;
  const resolution = result?.resolution;

  return {
    kind: "resolved",
    incomingRef: result?.incomingRef ?? "",
    candidates: resolution?.candidates ?? [],
    bestMatch: resolution?.bestMatch,
    recommendation: resolution?.recommendation ?? "no-action",
    requiresHumanReview: resolution?.requiresHumanReview ?? false,
    note: resolution?.note ?? "",
    matchTracesToFeatures: fabric.matchTracesToFeatures === true,
    mergeRequiresHumanReview: fabric.mergeRequiresHumanReview === true,
    excludesProtectedAttributesInMatching: fabric.excludesProtectedAttributesInMatching === true,
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

const CLASSIFICATION_TONE: Record<string, string> = {
  match: "#8fd6b0",
  "possible-match": "#ffd28a",
  "no-match": "#9fb3c8"
};

const RECOMMENDATION_TONE: Record<string, string> = {
  merge: "#8fd6b0",
  link: "#8fd6b0",
  "manual-review": "#ffd28a",
  "no-action": "#9fb3c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: MasterPatientIndexView }
  | { status: "error"; message: string };

export function MasterPatientIndexPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: MasterPatientIndexPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runMasterPatientIndexTask({
          taskId: newTaskId("mpi"),
          personaId: "demo",
          incoming: preset.incoming,
          candidates: preset.candidates,
          scoredCandidates: preset.scoredCandidates,
          resolution: preset.resolution,
          matchingFeatureIds: preset.matchingFeatureIds
        });
        setRunState({ status: "done", view: masterPatientIndexViewFromTask(task) });
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
        Master patient index / identity resolution
      </p>
      <h3 style={{ margin: 0 }}>
        The identity/dedup layer — transparent demographic matching, human-review-gated
        merges, never a protected-class feature
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Master Patient Index agent resolves a patient&apos;s identity across
        source systems: given an <strong>incoming record</strong> plus a set of{" "}
        <strong>candidate records</strong>, it{" "}
        <strong>deterministically scores</strong> each candidate against a{" "}
        <strong>transparent weighted feature set</strong> (name, DOB, member/MRN
        identifier, address, phone, administrative sex), classifies each as{" "}
        <strong>match / possible-match / no-match</strong> by fixed thresholds, and
        recommends <strong>link / merge / manual-review / no-action</strong>. It is
        a recommender + integrity gate: a high-confidence match surfaces a
        link/merge, but a <strong>merge below the auto-match threshold requires a
        human steward</strong> (there is never an auto-merged state), it{" "}
        <strong>never autonomously merges a low-confidence pair</strong>, and it{" "}
        <strong>never uses a protected-class attribute</strong> as a matching
        feature.{" "}
        <strong>
          The match features, weights, thresholds, and records are illustrative
          synthetics, not a certified EMPI algorithm.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {MASTER_PATIENT_INDEX_PRESETS.map((preset) => (
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
              ? "Resolving…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Identity-resolution run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <MasterPatientIndexResult view={runState.view} />}
    </section>
  );
}

function CandidateList({ candidates, bestId }: { candidates: ScoredCandidate[]; bestId?: string }) {
  if (candidates.length === 0) return null;
  return (
    <>
      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Scored candidates
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {candidates.map((c) => (
          <li
            key={c.candidateId}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background:
                c.candidateId === bestId ? "rgba(143,214,176,0.08)" : "rgba(255,255,255,0.03)",
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
              <strong style={{ fontSize: "0.9rem" }}>{c.candidateId}</strong>
              <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <Pill label="Score" value={`${c.score}`} tone="#9fb3c8" />
                <Pill
                  label="Class"
                  value={c.classification}
                  tone={CLASSIFICATION_TONE[c.classification] ?? "#9fb3c8"}
                />
              </span>
            </div>
            {c.matchedFeatures.length > 0 ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                matched features:{" "}
                {c.matchedFeatures.map((f) => `${f.label} (+${f.weight})`).join(", ")}
              </p>
            ) : (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                no features matched
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function MasterPatientIndexResult({ view }: { view: MasterPatientIndexView }) {
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

  const best = view.bestMatch;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Identity resolution (deterministic, synthetic records)
        {view.incomingRef ? ` · incoming ${view.incomingRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Recommendation"
          value={view.recommendation}
          tone={RECOMMENDATION_TONE[view.recommendation] ?? "#9fb3c8"}
        />{" "}
        <Pill
          label="Best score"
          value={best ? `${best.score}` : "—"}
          tone={best ? CLASSIFICATION_TONE[best.classification] ?? "#9fb3c8" : "#9fb3c8"}
        />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone={view.requiresHumanReview ? "#ffd28a" : "#9fb3c8"}
        />
      </p>

      <CandidateList candidates={view.candidates} bestId={best?.candidateId} />

      <div
        role="note"
        aria-label="Matching integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Every match traces to the transparent feature spec · a merge below the
          auto threshold requires a human steward · never a protected-class feature{" "}
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
          matchTracesToFeatures = {String(view.matchTracesToFeatures)} ·
          mergeRequiresHumanReview = {String(view.mergeRequiresHumanReview)} ·
          excludesProtectedAttributesInMatching ={" "}
          {String(view.excludesProtectedAttributesInMatching)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
