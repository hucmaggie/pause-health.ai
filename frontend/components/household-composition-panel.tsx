"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type Household,
  type HouseholdCompositionDetermination,
  type HouseholdCompositionDisposition,
  type HouseholdCompositionRequest,
  DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST
} from "../lib/household-composition";

/**
 * Household / Family-Unit Composition runner for the intake demo.
 *
 * Fires the real, server-side A2A Household Composition agent at /api/agents/household-composition/tasks —
 * a payer-operations service that groups plan members into households by computing the connected components
 * of a relationship graph via union-find. The panel surfaces the disposition, the households + their
 * members, the household count + largest size, the honesty signals, the synthetic / PHI labels, and a deep
 * link into the parented Agent Fabric trace.
 *
 * A finding — all-singletons or households-formed — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresStewardReview:true, autoMerged:false). The phantom-link, mis-grouped-partition, and auto-merged
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI
 * rather than hidden.
 *
 * PHI-bearing — the members are patients. The panel is ILLUSTRATIVE, NOT a certified enrollment / MDM
 * system. Structure, styling tokens, and tone mirror <ProviderBenchmarkingPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const HOUSEHOLD_COMPOSITION_ROUTE = "/api/agents/household-composition/tasks";

/** A one-click demo scenario. */
export type HouseholdCompositionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: HouseholdCompositionRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the 6-member / 3-household demo — the block base. */
const VALID_DETERMINATION = {
  batchRef: "hh-batch-001",
  members: ["m1", "m2", "m3", "m4", "m5", "m6"],
  links: [
    { a: "m1", b: "m2", basis: "shared-subscriber" },
    { a: "m2", b: "m3", basis: "shared-address" },
    { a: "m4", b: "m5", basis: "shared-subscriber" }
  ],
  households: [
    { householdId: "hh-1", members: ["m1", "m2", "m3"], size: 3 },
    { householdId: "hh-2", members: ["m4", "m5"], size: 2 },
    { householdId: "hh-3", members: ["m6"], size: 1 }
  ],
  householdCount: 3,
  largestHouseholdSize: 3,
  memberCount: 6,
  disposition: "households-formed",
  requiresStewardReview: true,
  autoMerged: false
};

export const HOUSEHOLD_COMPOSITION_PRESETS: HouseholdCompositionPreset[] = [
  {
    id: "households-formed",
    label: "6 members \u2192 3 households",
    hint: "A 3-member family (transitive), a pair, a singleton.",
    request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
    demonstrates: "Connected components — m1\u2013m2\u2013m3 group transitively, m4\u2013m5 pair, m6 singleton."
  },
  {
    id: "transitive-chain",
    label: "5-member chain \u2192 1 household",
    hint: "m1\u2192m2\u2192m3\u2192m4\u2192m5, no direct m1\u2013m5 link.",
    request: DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST,
    demonstrates: "Transitivity — m1 and m5 land together though never directly linked."
  },
  {
    id: "all-singletons",
    label: "3 members, no links",
    hint: "No relationship links.",
    request: DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST,
    demonstrates: "No links join any two members — all-singletons."
  },
  {
    id: "phantom-link-block",
    label: "Phantom relationship link \u2192 governance block",
    hint: "A link to a member not in the batch.",
    request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a link references "ghost-x", a member not in the submitted batch.
      links: [...VALID_DETERMINATION.links, { a: "m1", b: "ghost-x", basis: "shared-address" }]
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose link references a member not in the batch (policy.household.links-sourced)."
  },
  {
    id: "mis-grouped-block",
    label: "Mis-grouped partition \u2192 governance block",
    hint: "Merges an unlinked member into a household.",
    request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: m4 (only linked to m5) is merged into m1's household, and m5+m6 grouped.
      households: [
        { householdId: "hh-1", members: ["m1", "m2", "m3", "m4"], size: 4 },
        { householdId: "hh-2", members: ["m5", "m6"], size: 2 }
      ],
      householdCount: 2,
      largestHouseholdSize: 4
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose grouping doesn't match the links (policy.household.partition-consistent)."
  },
  {
    id: "auto-merged-block",
    label: "Records merged autonomously \u2192 governance block",
    hint: "A finding that merged member records.",
    request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent merged the records and skipped steward review.
      requiresStewardReview: false,
      autoMerged: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous merge (policy.household.no-autonomous-merge)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type HouseholdCompositionResolvedView = {
  kind: "resolved";
  batchRef: string;
  disposition: HouseholdCompositionDisposition;
  households: Household[];
  householdCount: number;
  largestHouseholdSize: number;
  memberCount: number;
  linkCount: number;
  reason: string;
  note: string;
  householdLinksSourced: boolean;
  householdPartitionConsistent: boolean;
  householdNoAutonomousMerge: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type HouseholdCompositionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type HouseholdCompositionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type HouseholdCompositionView =
  | HouseholdCompositionResolvedView
  | HouseholdCompositionBlockedView
  | HouseholdCompositionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  householdLinksSourced?: unknown;
  householdPartitionConsistent?: unknown;
  householdNoAutonomousMerge?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildHouseholdCompositionRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: HouseholdCompositionRequest;
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
 * POST a household-composition request (or an asserted finding) to the agent and return the resulting A2A
 * task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runHouseholdCompositionTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: HouseholdCompositionRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(HOUSEHOLD_COMPOSITION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildHouseholdCompositionRequestBody(input))
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
export function householdCompositionViewFromTask(task: A2ATask): HouseholdCompositionView {
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
        "The Agent Fabric blocked this household-composition run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The households could not be composed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: HouseholdCompositionDetermination; batchRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    batchRef: result?.batchRef ?? det?.batchRef ?? "",
    disposition: det?.disposition ?? "all-singletons",
    households: det?.households ?? [],
    householdCount: det?.householdCount ?? 0,
    largestHouseholdSize: det?.largestHouseholdSize ?? 0,
    memberCount: det?.memberCount ?? 0,
    linkCount: det?.links?.length ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    householdLinksSourced: fabric.householdLinksSourced === true,
    householdPartitionConsistent: fabric.householdPartitionConsistent === true,
    householdNoAutonomousMerge: fabric.householdNoAutonomousMerge === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<HouseholdCompositionDisposition, string> = {
  "households-formed": "#8fd6b0",
  "all-singletons": "#ffd28a"
};

const DISPOSITION_LABEL: Record<HouseholdCompositionDisposition, string> = {
  "households-formed": "Households formed \u00b7 connected components",
  "all-singletons": "All singletons \u00b7 no links joined any two"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: HouseholdCompositionView }
  | { status: "error"; message: string };

export function HouseholdCompositionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: HouseholdCompositionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runHouseholdCompositionTask({
          taskId: newTaskId("household-composition"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: householdCompositionViewFromTask(task) });
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
        Member management &middot; household composition &middot; payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Household Composition — links sourced, partition exact, never an autonomous merge
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a batch of <strong>members</strong> plus
        pairwise <strong>relationship links</strong> (shared subscriber, shared address, a tax-dependent
        tie) and groups them into <strong>households</strong> by computing the{" "}
        <strong>connected components</strong> of the relationship graph &mdash; so a member linked to a
        member linked to a third all land in <strong>one household</strong> even when the first and third
        are never directly linked (<strong>transitivity</strong>). Not a percentile, not a set-difference,
        and <strong>not</strong> the master-patient-index&rsquo;s same-person matching &mdash;{" "}
        <strong>union-find connected components</strong>. Every link is <strong>sourced</strong>, the
        partition <strong>recomputes exactly</strong>, and the result is a <strong>recommendation</strong>:
        the agent <strong>never</strong> merges records, changes enrollment, or applies a family accumulator
        &mdash; a data steward confirms.{" "}
        <strong>PHI-bearing &middot; illustrative members, not a certified system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {HOUSEHOLD_COMPOSITION_PRESETS.map((preset) => (
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
              ? "Grouping\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Composition failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <HouseholdCompositionResult view={runState.view} />}
    </section>
  );
}

function HouseholdCompositionResult({ view }: { view: HouseholdCompositionView }) {
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
        Finding (deterministic, synthetic)
        {view.batchRef ? ` \u00b7 ${view.batchRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.householdCount} household(s) &middot; {view.memberCount} member(s) &middot;{" "}
        {view.linkCount} link(s) &middot; largest {view.largestHouseholdSize}
      </p>

      {view.households.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.households.map((h) => (
            <li key={h.householdId}>
              <code>{h.householdId}</code> ({h.size}): {h.members.join(", ")}
            </li>
          ))}
        </ul>
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
          Sourced &middot; exact partition &middot; never an autonomous merge{" "}
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
            synthetic &middot; PHI-bearing
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
          householdLinksSourced = {String(view.householdLinksSourced)} &middot;
          householdPartitionConsistent = {String(view.householdPartitionConsistent)} &middot;
          householdNoAutonomousMerge = {String(view.householdNoAutonomousMerge)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
