"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type MedicationNameSafetyDetermination,
  type MedicationNameSafetyDisposition,
  type MedicationNameSafetyRequest,
  type NameCandidate,
  DEFAULT_FORMULARY_CATALOG,
  DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST
} from "../lib/medication-name-safety";

/**
 * Medication Name Safety (LASA) runner for the intake demo.
 *
 * Fires the real, server-side A2A Medication Name Safety agent at /api/agents/medication-name-safety/tasks
 * — a clinical-decision service that flags look-alike / sound-alike drug-name confusion using edit
 * distance. The panel surfaces the disposition, the nearest match + distance, the confusable look-alikes,
 * the honesty signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A finding — recognized-clear, lasa-warning, or unrecognized — is a SAFE, honest OUTPUT (it completes;
 * it carries requiresPharmacistReview:true, autoSubstituted:false). The fabricated-candidate,
 * miscomputed-distance, and auto-substituted presets assert offending DETERMINATIONS — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the prescribed name is for a patient's medication order. The panel is ILLUSTRATIVE, NOT a
 * certified medication-safety system. Structure, styling tokens, and tone mirror <ScheduleConflictPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const MEDICATION_NAME_SAFETY_ROUTE = "/api/agents/medication-name-safety/tasks";

/** A one-click demo scenario. */
export type MedicationNameSafetyPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: MedicationNameSafetyRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the premarin LASA demo — the base for the block presets. */
const VALID_DETERMINATION = {
  requestRef: "mns-002",
  patientRef: "patient-6640",
  prescribedName: "premarin",
  normalizedName: "premarin",
  editDistanceThreshold: 2,
  catalog: DEFAULT_FORMULARY_CATALOG.map((c) => ({ drugId: c.drugId, name: c.name })),
  catalogSize: DEFAULT_FORMULARY_CATALOG.length,
  exactMatch: true,
  nearestMatch: { drugId: "drug-premarin", name: "premarin", editDistance: 0 },
  confusable: [{ drugId: "drug-primaxin", name: "primaxin", editDistance: 2 }],
  disposition: "lasa-warning",
  requiresPharmacistReview: true,
  autoSubstituted: false
};

export const MEDICATION_NAME_SAFETY_PRESETS: MedicationNameSafetyPreset[] = [
  {
    id: "recognized-clear",
    label: "\u201Cgabapentin\u201D \u2192 recognized, clear",
    hint: "Exact match, no look-alike.",
    request: DEMO_MEDICATION_NAME_SAFETY_REQUEST,
    demonstrates:
      "An exact catalog match with no other drug within the edit-distance threshold — recognized-clear."
  },
  {
    id: "lasa-warning",
    label: "\u201Cpremarin\u201D \u2192 LASA warning (primaxin)",
    hint: "premarin vs primaxin, distance 2.",
    request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
    demonstrates:
      "An exact match (premarin) that nonetheless has a look-alike (primaxin, distance 2) — flagged for pharmacist review."
  },
  {
    id: "unrecognized",
    label: "\u201Ctrelagliptin\u201D \u2192 unrecognized",
    hint: "Nothing within the threshold.",
    request: DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST,
    demonstrates:
      "No exact match and nothing within the edit-distance threshold — unrecognized, routed to a pharmacist."
  },
  {
    id: "fabricated-candidate-block",
    label: "Fabricated candidate \u2192 governance block",
    hint: "A candidate name that isn't the catalog's.",
    request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the nearest match's echoed name doesn't match its catalog entry (drug-premarin = "premarin").
      nearestMatch: { drugId: "drug-premarin", name: "premaryn", editDistance: 0 }
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose candidate isn't backed by the catalog (policy.lasa.candidates-sourced)."
  },
  {
    id: "miscomputed-distance-block",
    label: "Wrong disposition \u2192 governance block",
    hint: "Claims clear while a look-alike exists.",
    request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a look-alike (primaxin) is within the threshold, so this cannot be recognized-clear.
      disposition: "recognized-clear"
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose disposition doesn't follow the recomputed distances (policy.lasa.distances-consistent)."
  },
  {
    id: "auto-substituted-block",
    label: "Drug substituted autonomously \u2192 governance block",
    hint: "A finding that corrected the order.",
    request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent substituted the drug and skipped pharmacist review.
      requiresPharmacistReview: false,
      autoSubstituted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous substitution (policy.lasa.no-autonomous-substitution)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type MedicationNameSafetyResolvedView = {
  kind: "resolved";
  requestRef: string;
  patientRef: string;
  prescribedName: string;
  disposition: MedicationNameSafetyDisposition;
  exactMatch: boolean;
  nearestMatch: NameCandidate | null;
  confusable: NameCandidate[];
  editDistanceThreshold: number;
  catalogSize: number;
  reason: string;
  note: string;
  lasaCandidatesSourced: boolean;
  lasaDistancesConsistent: boolean;
  lasaNoAutonomousSubstitution: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type MedicationNameSafetyBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type MedicationNameSafetyInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type MedicationNameSafetyView =
  | MedicationNameSafetyResolvedView
  | MedicationNameSafetyBlockedView
  | MedicationNameSafetyInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  lasaCandidatesSourced?: unknown;
  lasaDistancesConsistent?: unknown;
  lasaNoAutonomousSubstitution?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildMedicationNameSafetyRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: MedicationNameSafetyRequest;
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
 * POST a medication-name-safety request (or an asserted finding) to the agent and return the resulting
 * A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes
 * back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runMedicationNameSafetyTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: MedicationNameSafetyRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(MEDICATION_NAME_SAFETY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMedicationNameSafetyRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * finding (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function medicationNameSafetyViewFromTask(task: A2ATask): MedicationNameSafetyView {
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
        "The Agent Fabric blocked this medication-name-safety run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The name could not be checked.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: MedicationNameSafetyDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    patientRef: det?.patientRef ?? "",
    prescribedName: det?.prescribedName ?? "",
    disposition: det?.disposition ?? "unrecognized",
    exactMatch: det?.exactMatch ?? false,
    nearestMatch: det?.nearestMatch ?? null,
    confusable: det?.confusable ?? [],
    editDistanceThreshold: det?.editDistanceThreshold ?? 0,
    catalogSize: det?.catalogSize ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    lasaCandidatesSourced: fabric.lasaCandidatesSourced === true,
    lasaDistancesConsistent: fabric.lasaDistancesConsistent === true,
    lasaNoAutonomousSubstitution: fabric.lasaNoAutonomousSubstitution === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<MedicationNameSafetyDisposition, string> = {
  "recognized-clear": "#8fd6b0",
  "lasa-warning": "#ffb6c8",
  unrecognized: "#ffd28a"
};

const DISPOSITION_LABEL: Record<MedicationNameSafetyDisposition, string> = {
  "recognized-clear": "Recognized · clear",
  "lasa-warning": "LASA warning · look-alike",
  unrecognized: "Unrecognized"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: MedicationNameSafetyView }
  | { status: "error"; message: string };

export function MedicationNameSafetyPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: MedicationNameSafetyPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runMedicationNameSafetyTask({
          taskId: newTaskId("medication-name-safety"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: medicationNameSafetyViewFromTask(task) });
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
        Clinical decision · look-alike / sound-alike (LASA) · patient &amp; clinical
      </p>
      <h3 style={{ margin: 0 }}>
        Medication Name Safety — every candidate sourced, distances exact, never an autonomous
        substitution
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a <strong>prescribed drug name</strong> and,
        using <strong>edit distance</strong> (Levenshtein), finds the nearest formulary name and flags a{" "}
        <strong>look-alike / sound-alike</strong> confusion — a name dangerously close to a{" "}
        <strong>different</strong> drug. Not a knowledge-base lookup, not an exact match — the classic{" "}
        <strong>string edit distance</strong>. Every candidate is <strong>sourced</strong>, the distances{" "}
        <strong>recompute exactly</strong>, and the result is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> substitutes, corrects, or dispenses — a pharmacist confirms.{" "}
        <strong>PHI-bearing · illustrative catalog, not a certified system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {MEDICATION_NAME_SAFETY_PRESETS.map((preset) => (
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
              ? "Checking…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Name check failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <MedicationNameSafetyResult view={runState.view} />}
    </section>
  );
}

function MedicationNameSafetyResult({ view }: { view: MedicationNameSafetyView }) {
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

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Finding (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.prescribedName ? ` · “${view.prescribedName}”` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
        {view.nearestMatch
          ? ` · nearest: ${view.nearestMatch.name} (distance ${view.nearestMatch.editDistance})`
          : ""}
      </p>

      {view.confusable.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Look-alike(s) within edit distance {view.editDistanceThreshold}:{" "}
          {view.confusable.map((c) => `${c.name} (distance ${c.editDistance})`).join(", ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Finding safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced · exact distances · never an autonomous substitution{" "}
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
            synthetic · PHI-bearing
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
          lasaCandidatesSourced = {String(view.lasaCandidatesSourced)} · lasaDistancesConsistent ={" "}
          {String(view.lasaDistancesConsistent)} · lasaNoAutonomousSubstitution ={" "}
          {String(view.lasaNoAutonomousSubstitution)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
