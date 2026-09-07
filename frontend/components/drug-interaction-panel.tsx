"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type DetectedInteraction,
  type DrugInteractionDetermination,
  type DrugInteractionRequest,
  DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
  DEMO_DRUG_INTERACTION_MODERATE_REQUEST,
  DEMO_DRUG_INTERACTION_NONE_REQUEST,
  DEMO_DRUG_INTERACTION_REQUEST
} from "../lib/drug-interaction";

/**
 * Drug–Drug Interaction (DDI) Safety Check runner for the intake demo.
 *
 * Fires the real, server-side A2A Drug Interaction agent at /api/agents/drug-interaction/tasks — a
 * clinical-decision service that screens a proposed medication against the patient's active list. The
 * panel surfaces the disposition, the overall severity, the detected interactions (pair + mechanism +
 * management), the honesty signals, the synthetic labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A finding — an interaction of any severity OR no interaction — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresClinicianReview:true, autoHeldOrder:false, autoOverrodeAlert:false).
 * The off-catalog-interaction, inflated-severity, and auto-held presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the screen references the patient's active medication list. The knowledge base +
 * severity assignments are ILLUSTRATIVE, NOT certified clinical decision support. Structure, styling
 * tokens, and tone mirror <ControlledSubstancePanel> so this reads as a native sibling on
 * /demo/intake.
 */

const DRUG_INTERACTION_ROUTE = "/api/agents/drug-interaction/tasks";

/** A one-click demo scenario. */
export type DrugInteractionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: DrugInteractionRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const DRUG_INTERACTION_PRESETS: DrugInteractionPreset[] = [
  {
    id: "major",
    label: "Paroxetine + tamoxifen → major, review required",
    hint: "CYP2D6 inhibition reduces tamoxifen efficacy.",
    request: DEMO_DRUG_INTERACTION_REQUEST,
    demonstrates:
      "A major interaction (paroxetine reduces tamoxifen's active metabolite) → prescriber review required."
  },
  {
    id: "contraindicated",
    label: "Nitroglycerin + sildenafil → contraindicated",
    hint: "Additive vasodilation — severe hypotension.",
    request: DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
    demonstrates:
      "A contraindicated combination → do NOT co-administer; prescriber review required."
  },
  {
    id: "moderate",
    label: "Rifampin + estradiol → moderate",
    hint: "Enzyme induction lowers hormonal efficacy.",
    request: DEMO_DRUG_INTERACTION_MODERATE_REQUEST,
    demonstrates:
      "A moderate interaction (reduced estradiol efficacy) → review recommended before dispensing."
  },
  {
    id: "none",
    label: "Acetaminophen + unrelated meds → no interaction",
    hint: "Nothing cataloged.",
    request: DEMO_DRUG_INTERACTION_NONE_REQUEST,
    demonstrates:
      "No cataloged interaction → clinician to confirm and proceed."
  },
  {
    id: "off-catalog-interaction-block",
    label: "Fabricated interaction → governance block",
    hint: "An interaction not in the knowledge base.",
    request: DEMO_DRUG_INTERACTION_REQUEST,
    determination: {
      requestRef: "ddi-001",
      patientRef: "patient-8842",
      proposedDrug: "paroxetine",
      activeMedicationCount: 3,
      detectedInteractions: [
        {
          interactionId: "ddi.we-made-up",
          withDrug: "calcium",
          pair: ["calcium", "paroxetine"],
          severity: "major",
          mechanism: "made up",
          management: "made up"
        }
      ],
      interactionCount: 1,
      overallSeverity: "major",
      disposition: "review-required",
      requiresClinicianReview: true,
      autoHeldOrder: false,
      autoOverrodeAlert: false
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated interaction (policy.ddi.interaction-sourced)."
  },
  {
    id: "inflated-severity-block",
    label: "Inflated severity → governance block",
    hint: "A moderate interaction reported as contraindicated.",
    request: DEMO_DRUG_INTERACTION_MODERATE_REQUEST,
    determination: {
      requestRef: "ddi-003",
      patientRef: "patient-5521",
      proposedDrug: "rifampin",
      activeMedicationCount: 2,
      detectedInteractions: [
        {
          interactionId: "ddi.estradiol-rifampin",
          withDrug: "estradiol",
          pair: ["estradiol", "rifampin"],
          severity: "moderate",
          mechanism: "Strong enzyme induction lowers estradiol exposure.",
          management: "Anticipate reduced hormonal efficacy."
        }
      ],
      interactionCount: 1,
      // Inflated: the catalog interaction is moderate, not contraindicated.
      overallSeverity: "contraindicated",
      disposition: "do-not-coadminister-needs-review",
      requiresClinicianReview: true,
      autoHeldOrder: false,
      autoOverrodeAlert: false
    },
    demonstrates:
      "The Agent Fabric blocking an inflated overall severity (policy.ddi.severity-consistent)."
  },
  {
    id: "auto-held-block",
    label: "Order held autonomously → governance block",
    hint: "A determination that cancelled the order itself.",
    request: DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
    determination: {
      requestRef: "ddi-002",
      patientRef: "patient-7310",
      proposedDrug: "nitroglycerin",
      activeMedicationCount: 2,
      detectedInteractions: [
        {
          interactionId: "ddi.sildenafil-nitroglycerin",
          withDrug: "sildenafil",
          pair: ["nitroglycerin", "sildenafil"],
          severity: "contraindicated",
          mechanism: "Additive vasodilation.",
          management: "Do not co-administer."
        }
      ],
      interactionCount: 1,
      overallSeverity: "contraindicated",
      disposition: "do-not-coadminister-needs-review",
      // Wrong: the agent held the order and skipped clinician review.
      requiresClinicianReview: false,
      autoHeldOrder: true,
      autoOverrodeAlert: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-held order (policy.ddi.no-autonomous-hold-or-override)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type DrugInteractionResolvedView = {
  kind: "resolved";
  requestRef: string;
  patientRef: string;
  proposedDrug: string;
  activeMedicationCount: number;
  detectedInteractions: DetectedInteraction[];
  interactionCount: number;
  overallSeverity: string;
  disposition: string;
  reason: string;
  note: string;
  ddiInteractionSourced: boolean;
  ddiSeverityConsistent: boolean;
  ddiNoAutonomousHoldOrOverride: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type DrugInteractionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type DrugInteractionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type DrugInteractionView =
  | DrugInteractionResolvedView
  | DrugInteractionBlockedView
  | DrugInteractionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  ddiInteractionSourced?: unknown;
  ddiSeverityConsistent?: unknown;
  ddiNoAutonomousHoldOrOverride?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildDrugInteractionRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: DrugInteractionRequest;
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
 * POST a screen request (or an asserted determination) to the Drug Interaction agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runDrugInteractionTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: DrugInteractionRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(DRUG_INTERACTION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDrugInteractionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced finding
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function drugInteractionViewFromTask(task: A2ATask): DrugInteractionView {
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
        "The Agent Fabric blocked this drug-interaction run.";
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
        : "The drug-interaction finding could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: DrugInteractionDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    patientRef: det?.patientRef ?? "",
    proposedDrug: det?.proposedDrug ?? "",
    activeMedicationCount: det?.activeMedicationCount ?? 0,
    detectedInteractions: det?.detectedInteractions ?? [],
    interactionCount: det?.interactionCount ?? 0,
    overallSeverity: det?.overallSeverity ?? "none",
    disposition: det?.disposition ?? "",
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    ddiInteractionSourced: fabric.ddiInteractionSourced === true,
    ddiSeverityConsistent: fabric.ddiSeverityConsistent === true,
    ddiNoAutonomousHoldOrOverride: fabric.ddiNoAutonomousHoldOrOverride === true,
    traceTaskId
  };
}

const SEVERITY_TONE: Record<string, string> = {
  contraindicated: "#ffb6c8",
  major: "#ffb6c8",
  moderate: "#ffd28a",
  minor: "#9db8ff",
  none: "#8fd6b0"
};

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
  | { status: "done"; view: DrugInteractionView }
  | { status: "error"; message: string };

export function DrugInteractionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: DrugInteractionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runDrugInteractionTask({
          taskId: newTaskId("drug-interaction"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: drugInteractionViewFromTask(task) });
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
        Drug–drug interaction · medication safety · patient & clinical
      </p>
      <h3 style={{ margin: 0 }}>
        Drug Interaction — a sourced severity, never an autonomous hold or override
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> screens a proposed drug against the
        patient&rsquo;s active medication list — pairing it with each active med, looking up every
        recorded interaction, and ranking them by severity{" "}
        <strong>(contraindicated → major → moderate → minor)</strong>. No date math, no dollar
        waterfall — a pairwise knowledge-base lookup. Every finding is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> holds the order (which could
        deny needed therapy) or overrides the alert (which could push through a contraindicated
        combination).{" "}
        <strong>The knowledge base and severities are illustrative, not clinical decision support.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {DRUG_INTERACTION_PRESETS.map((preset) => (
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
          Drug-interaction run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <DrugInteractionResult view={runState.view} />}
    </section>
  );
}

function DrugInteractionResult({ view }: { view: DrugInteractionView }) {
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

  const sevTone = SEVERITY_TONE[view.overallSeverity] ?? "#9db8ff";
  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        DDI finding (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.proposedDrug ? ` · proposed ${view.proposedDrug}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Overall" value={view.overallSeverity} tone={sevTone} />{" "}
        <Pill label="Disposition" value={view.disposition} tone={sevTone} />{" "}
        <Pill
          label="Screened"
          value={`${view.activeMedicationCount} active med(s)`}
          tone="#9db8ff"
        />
      </p>

      {view.detectedInteractions.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.detectedInteractions.map((it) => (
            <li key={it.interactionId}>
              <strong style={{ color: SEVERITY_TONE[it.severity] ?? "#9db8ff" }}>
                {it.severity}
              </strong>{" "}
              — {view.proposedDrug} + {it.withDrug}: {it.mechanism} <em>{it.management}</em>
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="DDI safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Interaction sourced · severity consistent · never an autonomous hold / override{" "}
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
          ddiInteractionSourced = {String(view.ddiInteractionSourced)} · ddiSeverityConsistent ={" "}
          {String(view.ddiSeverityConsistent)} · ddiNoAutonomousHoldOrOverride ={" "}
          {String(view.ddiNoAutonomousHoldOrOverride)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
