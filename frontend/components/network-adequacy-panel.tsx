"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type EvaluatedProvider,
  type NetworkAdequacyDetermination,
  type NetworkAdequacyDisposition,
  type NetworkAdequacyRequest,
  DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
  DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST,
  DEMO_NETWORK_ADEQUACY_REQUEST
} from "../lib/network-adequacy";

/**
 * Network Adequacy / Time-and-Distance runner for the intake demo.
 *
 * Fires the real, server-side A2A Network Adequacy agent at /api/agents/network-adequacy/tasks — a
 * payer-operations service that decides whether the plan's network meets the time-and-distance adequacy
 * standard for a required specialty by computing the great-circle (haversine) distance from the member to
 * each in-network provider. The panel surfaces the disposition, the nearest provider + distance, the
 * evaluated providers, the honesty signals, the synthetic / PHI labels, and a deep link into the parented
 * Agent Fabric trace.
 *
 * A finding — adequacy-met or adequacy-gap — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresNetworkReview:true, autoCertified:false). The phantom-provider, mis-measured-distance, and
 * auto-certified presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable
 * in the UI rather than hidden.
 *
 * PHI-bearing — the member's location + the specialty they need is health information. The panel is
 * ILLUSTRATIVE, computing straight-line great-circle distance only, NOT a certified network-adequacy
 * engine. Structure, styling tokens, and tone mirror <IdentifierValidationPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const NETWORK_ADEQUACY_ROUTE = "/api/agents/network-adequacy/tasks";

/** A one-click demo scenario. */
export type NetworkAdequacyPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: NetworkAdequacyRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the endocrinology GAP demo — the block base. */
const VALID_DETERMINATION = {
  caseRef: "adequacy-case-002",
  member: { memberRef: "mbr-2", latitude: 40.7128, longitude: -74.006 },
  requiredSpecialty: "endocrinology",
  maxDistanceMiles: 10,
  providers: [
    { providerId: "e1", specialty: "endocrinology", latitude: 40.9, longitude: -74.2, label: "Uptown Endocrine" },
    { providerId: "e2", specialty: "endocrinology", latitude: 41.0, longitude: -74.5, label: "Suburban Endocrine" },
    { providerId: "p3", specialty: "dermatology", latitude: 40.713, longitude: -74.007, label: "Village Dermatology" }
  ],
  evaluated: [
    {
      providerId: "e1",
      label: "Uptown Endocrine",
      specialty: "endocrinology",
      latitude: 40.9,
      longitude: -74.2,
      distanceMiles: 16.44
    },
    {
      providerId: "e2",
      label: "Suburban Endocrine",
      specialty: "endocrinology",
      latitude: 41.0,
      longitude: -74.5,
      distanceMiles: 32.56
    }
  ],
  nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 16.44 },
  nearestDistanceMiles: 16.44,
  matchingProviderCount: 2,
  disposition: "adequacy-gap",
  requiresNetworkReview: true,
  autoCertified: false
};

export const NETWORK_ADEQUACY_PRESETS: NetworkAdequacyPreset[] = [
  {
    id: "adequacy-met",
    label: "Cardiology within 10 mi \u2192 met",
    hint: "Nearest in-network cardiologist 0.54 mi away.",
    request: DEMO_NETWORK_ADEQUACY_REQUEST,
    demonstrates:
      "Great-circle distance \u2014 the nearest of two cardiologists is within the 10 mi standard."
  },
  {
    id: "adequacy-gap",
    label: "Endocrinology too far \u2192 gap",
    hint: "Nearest endocrinologist 16.44 mi away, beyond 10 mi.",
    request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
    demonstrates: "Both in-network endocrinologists exceed the 10 mi standard \u2014 an adequacy gap."
  },
  {
    id: "no-provider",
    label: "No in-network specialist \u2192 gap",
    hint: "No rheumatologist in the network at all.",
    request: DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST,
    demonstrates: "No in-network provider of the required specialty \u2014 an adequacy gap with a null nearest."
  },
  {
    id: "phantom-provider-block",
    label: "Phantom provider \u2192 governance block",
    hint: "A nearby provider not in the submitted network.",
    request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a phantom endocrinologist "ex" (not in the submitted providers) fabricates near coverage.
      evaluated: [
        {
          providerId: "ex",
          label: "Phantom Endocrine",
          specialty: "endocrinology",
          latitude: 40.715,
          longitude: -74.008,
          distanceMiles: 0.18
        },
        ...VALID_DETERMINATION.evaluated
      ],
      nearest: { providerId: "ex", label: "Phantom Endocrine", distanceMiles: 0.18 },
      nearestDistanceMiles: 0.18,
      matchingProviderCount: 3,
      disposition: "adequacy-met"
    },
    demonstrates:
      "The Agent Fabric blocking a finding that evaluates a provider not in the submitted network (policy.adequacy.providers-sourced)."
  },
  {
    id: "mis-measured-block",
    label: "Mis-measured distance \u2192 governance block",
    hint: "A real gap understated into false adequacy.",
    request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: e1's real distance is 16.44 mi, reported as 5.0 mi to fake adequacy.
      evaluated: [
        {
          providerId: "e1",
          label: "Uptown Endocrine",
          specialty: "endocrinology",
          latitude: 40.9,
          longitude: -74.2,
          distanceMiles: 5.0
        },
        VALID_DETERMINATION.evaluated[1]
      ],
      nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 5.0 },
      nearestDistanceMiles: 5.0,
      disposition: "adequacy-met"
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose great-circle distance doesn't recompute (policy.adequacy.distances-consistent)."
  },
  {
    id: "auto-certified-block",
    label: "Network certified autonomously \u2192 governance block",
    hint: "A finding that certified the network on its own.",
    request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent certified the network and skipped network review.
      requiresNetworkReview: false,
      autoCertified: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous network certification (policy.adequacy.no-autonomous-network-change)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type NetworkAdequacyResolvedView = {
  kind: "resolved";
  caseRef: string;
  disposition: NetworkAdequacyDisposition;
  requiredSpecialty: string;
  maxDistanceMiles: number;
  evaluated: EvaluatedProvider[];
  nearestDistanceMiles: number | null;
  matchingProviderCount: number;
  reason: string;
  note: string;
  providersSourced: boolean;
  distancesConsistent: boolean;
  noAutonomousNetworkChange: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type NetworkAdequacyBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type NetworkAdequacyInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type NetworkAdequacyView =
  | NetworkAdequacyResolvedView
  | NetworkAdequacyBlockedView
  | NetworkAdequacyInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  providersSourced?: unknown;
  distancesConsistent?: unknown;
  noAutonomousNetworkChange?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildNetworkAdequacyRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: NetworkAdequacyRequest;
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
 * POST a network-adequacy request (or an asserted finding) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runNetworkAdequacyTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: NetworkAdequacyRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(NETWORK_ADEQUACY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildNetworkAdequacyRequestBody(input))
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
export function networkAdequacyViewFromTask(task: A2ATask): NetworkAdequacyView {
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
        "The Agent Fabric blocked this network-adequacy run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The network adequacy could not be assessed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: NetworkAdequacyDetermination; caseRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    caseRef: result?.caseRef ?? det?.caseRef ?? "",
    disposition: det?.disposition ?? "adequacy-gap",
    requiredSpecialty: det?.requiredSpecialty ?? "",
    maxDistanceMiles: det?.maxDistanceMiles ?? 0,
    evaluated: det?.evaluated ?? [],
    nearestDistanceMiles: det?.nearestDistanceMiles ?? null,
    matchingProviderCount: det?.matchingProviderCount ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    providersSourced: fabric.providersSourced === true,
    distancesConsistent: fabric.distancesConsistent === true,
    noAutonomousNetworkChange: fabric.noAutonomousNetworkChange === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<NetworkAdequacyDisposition, string> = {
  "adequacy-met": "#8fd6b0",
  "adequacy-gap": "#ffb6c8"
};

const DISPOSITION_LABEL: Record<NetworkAdequacyDisposition, string> = {
  "adequacy-met": "Adequacy met \u00b7 nearest provider within standard",
  "adequacy-gap": "Adequacy gap \u00b7 nearest provider beyond standard"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: NetworkAdequacyView }
  | { status: "error"; message: string };

export function NetworkAdequacyPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: NetworkAdequacyPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runNetworkAdequacyTask({
          taskId: newTaskId("network-adequacy"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: networkAdequacyViewFromTask(task) });
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
        Network integrity &middot; time-and-distance adequacy &middot; payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Network Adequacy — providers sourced, distances recompute, never an autonomous certification
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a <strong>member&rsquo;s location</strong> plus
        the plan&rsquo;s <strong>in-network providers</strong> and decides whether the network meets the{" "}
        <strong>time-and-distance</strong> standard for a required specialty &mdash; it computes the{" "}
        <strong>great-circle (haversine) distance</strong> from the member to each provider, finds the{" "}
        <strong>nearest</strong>, and flags an <strong>adequacy gap</strong> when the nearest exceeds the
        standard. Not a checksum, not a union-find, and <strong>not</strong> a percentile &mdash;{" "}
        <strong>geospatial great-circle distance</strong>. Every provider is <strong>sourced</strong>, the
        distances <strong>recompute exactly</strong>, and the result is a <strong>recommendation</strong>:
        the agent <strong>never</strong> certifies the network, closes a gap, or adds a provider &mdash; a
        network manager confirms.{" "}
        <strong>PHI-bearing &middot; straight-line distance only, not a certified engine.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {NETWORK_ADEQUACY_PRESETS.map((preset) => (
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
              ? "Measuring\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Assessment failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <NetworkAdequacyResult view={runState.view} />}
    </section>
  );
}

function NetworkAdequacyResult({ view }: { view: NetworkAdequacyView }) {
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
        {view.caseRef ? ` \u00b7 ${view.caseRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.requiredSpecialty} &middot; nearest{" "}
        {view.nearestDistanceMiles === null ? "n/a" : `${view.nearestDistanceMiles} mi`} vs{" "}
        {view.maxDistanceMiles} mi standard &middot; {view.matchingProviderCount} in-network provider(s)
      </p>

      {view.evaluated.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.evaluated.map((p) => (
            <li key={p.providerId}>
              <code>{p.providerId}</code> &middot; {p.distanceMiles} mi
              {p.label ? ` \u00b7 ${p.label}` : ""}
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
          Sourced &middot; distances recompute &middot; never an autonomous certification{" "}
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
          providersSourced = {String(view.providersSourced)} &middot; distancesConsistent ={" "}
          {String(view.distancesConsistent)} &middot; noAutonomousNetworkChange ={" "}
          {String(view.noAutonomousNetworkChange)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
