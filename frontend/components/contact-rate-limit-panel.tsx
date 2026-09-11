"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ContactDecision,
  type ContactRateLimitDetermination,
  type ContactRateLimitDisposition,
  type ContactRateLimitRequest,
  DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST,
  evaluateContactRateLimit
} from "../lib/contact-rate-limit";

/**
 * Member Contact Rate Limiting / Token-Bucket Throttle runner for the intake demo.
 *
 * Fires the real, server-side A2A Contact Rate Limit agent at /api/agents/contact-rate-limit/tasks — a
 * care-coordination contact-governance service that replays outbound contact attempts through a token bucket to
 * permit or throttle each. The panel surfaces the disposition, the per-attempt decisions, the permitted/throttled
 * tallies, the honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A throttle plan — within-limits or throttled — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCoordinatorReview:true, autoSent:false). A throttled disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The reordered, under-throttled, and auto-sent presets assert offending DETERMINATIONS — so
 * all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — the attempts reference member contacts. The attempts are an ILLUSTRATIVE synthetic, NOT a
 * certified communications-compliance system. Structure, styling tokens, and tone mirror
 * <ReferralThroughputPanel> so this reads as a native sibling on /demo/intake.
 */

const CONTACT_RATE_LIMIT_ROUTE = "/api/agents/contact-rate-limit/tasks";

/** A one-click demo scenario. */
export type ContactRateLimitPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ContactRateLimitRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);

export const CONTACT_RATE_LIMIT_PRESETS: ContactRateLimitPreset[] = [
  {
    id: "throttled",
    label: "Outreach burst — throttled",
    hint: "Five attempts in 90 min against a capacity-3 bucket.",
    request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
    demonstrates: "Token-bucket — 4 permitted, 1 throttled (the 4th, before enough refill)."
  },
  {
    id: "within",
    label: "Hourly check-ins — within limits",
    hint: "Attempts spaced to match the refill rate.",
    request: DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST,
    demonstrates: "A cadence within the cap — every attempt permitted."
  },
  {
    id: "burst",
    label: "Dense burst — capacity 1",
    hint: "Three back-to-back attempts, one token.",
    request: DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST,
    demonstrates: "Only the first permitted; the rest throttled until refill."
  },
  {
    id: "reordered-block",
    label: "Reordered replay → governance block",
    hint: "Decisions that don't match the attempt order.",
    request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      decisions: [
        VALID_DETERMINATION.decisions[1],
        VALID_DETERMINATION.decisions[0],
        ...VALID_DETERMINATION.decisions.slice(2)
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a replay whose order doesn't match the attempts (policy.contactrate.replay-sourced)."
  },
  {
    id: "under-throttled-block",
    label: "Under-throttled → governance block",
    hint: "A permit the bucket would have throttled.",
    request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      decisions: VALID_DETERMINATION.decisions.map((x, i) =>
        i === 3 ? { ...x, decision: "permitted" as const } : x
      ),
      permittedCount: 5,
      throttledCount: 0,
      disposition: "within-limits"
    },
    demonstrates:
      "The Agent Fabric blocking a decision the token bucket disagrees with (policy.contactrate.throttle-exact)."
  },
  {
    id: "auto-sent-block",
    label: "Sent autonomously → governance block",
    hint: "A plan that dispatched the contacts itself.",
    request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCoordinatorReview: false,
      autoSent: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous send (policy.contactrate.no-autonomous-send)."
  }
];

/** Render-ready view of a produced throttle plan lifted from the task. */
export type ContactRateLimitResolvedView = {
  kind: "resolved";
  memberRef: string;
  disposition: ContactRateLimitDisposition;
  decisions: ContactDecision[];
  permittedCount: number;
  throttledCount: number;
  finalTokens: number;
  capacity: number;
  refillPerHour: number;
  reason: string;
  note: string;
  contactReplaySourced: boolean;
  contactThrottleExact: boolean;
  contactNoAutonomousSend: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ContactRateLimitBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ContactRateLimitInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ContactRateLimitView =
  | ContactRateLimitResolvedView
  | ContactRateLimitBlockedView
  | ContactRateLimitInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  contactReplaySourced?: unknown;
  contactThrottleExact?: unknown;
  contactNoAutonomousSend?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildContactRateLimitRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ContactRateLimitRequest;
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
export async function runContactRateLimitTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ContactRateLimitRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CONTACT_RATE_LIMIT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildContactRateLimitRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced throttle
 * plan (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function contactRateLimitViewFromTask(task: A2ATask): ContactRateLimitView {
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
        "The Agent Fabric blocked this throttle plan.";
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
      (typeof fabric.error === "string" ? fabric.error : "The throttle plan could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: ContactRateLimitDetermination; memberRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    memberRef: result?.memberRef ?? det?.memberRef ?? "",
    disposition: det?.disposition ?? "within-limits",
    decisions: det?.decisions ?? [],
    permittedCount: det?.permittedCount ?? 0,
    throttledCount: det?.throttledCount ?? 0,
    finalTokens: det?.finalTokens ?? 0,
    capacity: det?.capacity ?? 0,
    refillPerHour: det?.refillPerHour ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    contactReplaySourced: fabric.contactReplaySourced === true,
    contactThrottleExact: fabric.contactThrottleExact === true,
    contactNoAutonomousSend: fabric.contactNoAutonomousSend === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ContactRateLimitDisposition, string> = {
  "within-limits": "#8fd6b0",
  throttled: "#ffd28a"
};

const DISPOSITION_LABEL: Record<ContactRateLimitDisposition, string> = {
  "within-limits": "Within limits · every attempt is under the frequency cap",
  throttled: "Throttled · some attempts exceed the frequency cap"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ContactRateLimitView }
  | { status: "error"; message: string };

export function ContactRateLimitPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ContactRateLimitPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runContactRateLimitTask({
          taskId: newTaskId("contact-rate-limit"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: contactRateLimitViewFromTask(task) });
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
        Care coordination &middot; contact governance &middot; token-bucket throttle
      </p>
      <h3 style={{ margin: 0 }}>
        Member Contact Rate Limiting — replay sourced &amp; self-consistent, throttle re-simulated, never an
        autonomous send
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> replays a member&rsquo;s{" "}
        <strong>outbound contact attempts</strong> through a <strong>token bucket</strong> &mdash; a burst{" "}
        <strong>capacity</strong> plus a continuous <strong>refill rate</strong> &mdash; to decide which contacts
        are <strong>permitted</strong> and which are <strong>throttled</strong>, so a member is never
        over-contacted. The replay is a real <strong>order-preserving</strong> record, the throttle is the{" "}
        <strong>exact token-bucket decision</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> sends or suppresses a contact &mdash; an outreach coordinator confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified compliance system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CONTACT_RATE_LIMIT_PRESETS.map((preset) => (
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
              ? "Throttling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Throttle planning failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ContactRateLimitResult view={runState.view} />}
    </section>
  );
}

function ContactRateLimitResult({ view }: { view: ContactRateLimitView }) {
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
        Contact throttle (deterministic, synthetic)
        {view.memberRef ? ` · ${view.memberRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.permittedCount} permitted &middot; {view.throttledCount} throttled &middot; capacity{" "}
        {view.capacity}, refill {view.refillPerHour}/hr &middot; {view.finalTokens} token
        {view.finalTokens === 1 ? "" : "s"} left
      </p>

      {view.decisions.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.decisions.map((d) => (
            <li key={d.id}>
              <code style={{ color: d.decision === "permitted" ? "#8fd6b0" : "#ffd28a" }}>
                {d.id}
              </code>{" "}
              &rarr; {d.decision} ({d.tokensBefore} token{d.tokensBefore === 1 ? "" : "s"} available)
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Contact rate limit safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; throttle-exact &middot; never an autonomous send{" "}
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
          contactReplaySourced = {String(view.contactReplaySourced)} &middot; contactThrottleExact ={" "}
          {String(view.contactThrottleExact)} &middot; contactNoAutonomousSend ={" "}
          {String(view.contactNoAutonomousSend)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
