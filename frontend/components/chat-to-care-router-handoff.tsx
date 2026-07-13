"use client";

import { useCallback, useEffect, useState } from "react";

import {
  PATHWAY_LABELS,
  PATHWAY_TARGETS,
  type CareRouterPathway
} from "../lib/care-router-pathways";
import {
  personaToCareRouterIntake,
  type DemoPersona
} from "../lib/demo-cohort";

/**
 * "Complete intake → route to Care Router" affordance rendered directly
 * beneath the live Agentforce Embedded Messaging widget on /demo/intake.
 *
 * WHY AN EXPLICIT BUTTON (not an SDK conversation-end hook):
 *   The Salesforce Embedded Messaging V2 SDK the page bootstraps
 *   (agentforce-embed.tsx) only reliably emits `onEmbeddedMessagingReady`
 *   and `onEmbeddedMessagingInitError` — those are the only two lifecycle
 *   events the code and docs/PHASE_3_RUNBOOK.md depend on. The public
 *   probe (public/agentforce-probe.html) also *listens* for
 *   `onEmbeddedMessagingConversationOpened/Closed` + window min/max, but
 *   nothing in the repo or runbooks confirms those fire on this
 *   deployment, and — critically — a "closed"/"minimized" event is not a
 *   "conversation complete" signal (the patient can minimize the widget
 *   mid-intake, and the launcher lives in a cross-origin Salesforce
 *   iframe). The same SDK already burned us once by shipping `prechatAPI`
 *   as a no-op Proxy (see agentforce-embed.tsx history). Rather than
 *   fabricate an end-of-conversation event that isn't dependably emitted,
 *   we expose a clearly-labeled affordance the clinician/patient clicks
 *   when the intake chat is done.
 *
 * WHAT IT DOES:
 *   POSTs the *currently-selected persona's* structured intake — via the
 *   shared `personaToCareRouterIntake` mapper (deterministic, not free
 *   text parsed from the chat) — to `/api/intake/route-to-care-router`,
 *   exactly like the /demo/routing "Run Care Router" button. That route
 *   emits the parented Agentforce-intake → Data 360 → Care Router (→ MCP
 *   bridge) span tree under a single taskId, so the whole handoff shows
 *   up as one continuous multi-agent trace. We tag the intake with
 *   `origin: "agentforce-chat"` so the trace viewer can tell this run
 *   started from the live chat (no PHI in that attribute).
 *
 *   The live decision (pathway, acuity, model provenance, and — on a
 *   scripted fallback — the fallbackReason) is surfaced inline, plus a
 *   deep link to /demo/agent-fabric?taskId=<id> for the trace.
 */

export const CHAT_HANDOFF_ORIGIN = "agentforce-chat";

const HANDOFF_ROUTE = "/api/intake/route-to-care-router";

/** Body POSTed to the server handoff for a chat-completed intake. */
export type ChatHandoffRequestBody = {
  intake: ReturnType<typeof personaToCareRouterIntake>;
  personaId: string;
  origin: string;
};

/** Normalized, render-ready result lifted from the handoff response. */
export type ChatHandoffResult = {
  taskId: string;
  pathway: string;
  pathwayLabel: string;
  acuity: string;
  recommendedTargetResponse: string;
  provider: string;
  model: string;
  via: string;
  fallbackReason?: string;
  identitySource: "real" | "mock";
  groundingSource: "real" | "mock";
};

type HandoffResponse = {
  meta?: {
    _data360IdentitySource?: "real" | "mock";
    _data360GroundingSource?: "real" | "mock";
  };
  taskId?: string;
  decision?: {
    pathway?: string;
    pathwayLabel?: string;
    acuity?: string;
    recommendedTargetResponse?: string;
    modelProvenance?: { provider?: string; model?: string; via?: string };
    fallbackReason?: string;
  } | null;
};

/**
 * Build the exact request body for a chat-completed handoff. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildChatHandoffRequestBody(
  persona: DemoPersona
): ChatHandoffRequestBody {
  return {
    intake: personaToCareRouterIntake(persona),
    personaId: persona.id,
    origin: CHAT_HANDOFF_ORIGIN
  };
}

/** Lift the render-ready decision out of the handoff route's JSON. */
export function chatHandoffResultFromResponse(
  payload: HandoffResponse
): ChatHandoffResult {
  const decision = payload.decision ?? null;
  const pathway = decision?.pathway ?? "self-care-tracking";
  const pw = pathway as CareRouterPathway;
  return {
    taskId: payload.taskId ?? "",
    pathway,
    pathwayLabel: decision?.pathwayLabel ?? PATHWAY_LABELS[pw] ?? pathway,
    acuity: decision?.acuity ?? "routine",
    recommendedTargetResponse:
      decision?.recommendedTargetResponse ?? PATHWAY_TARGETS[pw] ?? "",
    provider: decision?.modelProvenance?.provider ?? "pause-scripted",
    model:
      decision?.modelProvenance?.model ?? "pause-care-router-policy@1.0",
    via: decision?.modelProvenance?.via ?? "scripted-fallback",
    fallbackReason: decision?.fallbackReason,
    identitySource: payload.meta?._data360IdentitySource ?? "mock",
    groundingSource: payload.meta?._data360GroundingSource ?? "mock"
  };
}

/**
 * POST the persona's intake to the server handoff and return the
 * normalized decision. `fetchImpl` is injectable so tests can stub the
 * network boundary the same way the route tests stub global fetch.
 */
export async function runChatCareRouterHandoff(
  persona: DemoPersona,
  fetchImpl: typeof fetch = fetch
): Promise<ChatHandoffResult> {
  const res = await fetchImpl(HANDOFF_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildChatHandoffRequestBody(persona))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as HandoffResponse;
  return chatHandoffResultFromResponse(payload);
}

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ChatHandoffResult }
  | { status: "error"; message: string };

type Props = {
  persona: DemoPersona | undefined;
};

export function ChatToCareRouterHandoff({ persona }: Props) {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  // Reset when the picker changes persona so the surfaced decision always
  // matches the currently-selected patient (mirrors care-routing-stage).
  useEffect(() => {
    setRunState({ status: "idle" });
  }, [persona?.id]);

  const runHandoff = useCallback(async () => {
    if (!persona) return;
    setRunState({ status: "running" });
    try {
      const result = await runChatCareRouterHandoff(persona);
      setRunState({ status: "done", result });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, [persona]);

  if (!persona) return null;

  return (
    <article
      className="card routing-decision-card"
      aria-label="Complete intake and route to Care Router"
      style={{ marginTop: "1rem" }}
    >
      <header>
        <p className="eyebrow">Intake complete?</p>
        <h3 style={{ margin: "0.1rem 0 0" }}>
          Route {persona.firstName} to the Pause Care Router
        </h3>
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "var(--muted)",
            fontSize: "0.88rem"
          }}
        >
          When the chat intake above is finished, hand{" "}
          {persona.firstName}&apos;s structured intake to the Claude Sonnet
          4.5 Care Router. This threads one continuous Agentforce-intake →
          Data 360 → Care Router trace in the Agent Fabric.
        </p>
      </header>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={runHandoff}
          disabled={runState.status === "running"}
        >
          {runState.status === "running"
            ? "Routing to Care Router…"
            : "Complete intake → route to Care Router"}
        </button>
        {runState.status === "done" && (
          <a
            href={`/demo/agent-fabric?taskId=${encodeURIComponent(
              runState.result.taskId
            )}&personaId=${encodeURIComponent(persona.id)}`}
            className="btn btn-secondary"
          >
            View multi-agent trace →
          </a>
        )}
      </div>

      {runState.status === "running" && (
        <p
          style={{
            marginTop: "0.8rem",
            color: "var(--muted)",
            fontSize: "0.88rem"
          }}
        >
          Handing off over A2A. Threading spans into the Pause Agent
          Fabric…
        </p>
      )}

      {runState.status === "error" && (
        <p
          role="alert"
          style={{
            marginTop: "0.8rem",
            color: "#ffb6c8",
            fontSize: "0.88rem"
          }}
        >
          Care Router handoff failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <div className="routing-live-result">
          <div
            className="pre-brief-source-badges"
            style={{ marginBottom: "0.5rem" }}
          >
            <span
              className={`pre-brief-source-badge ${
                runState.result.identitySource === "real"
                  ? "pre-brief-source-badge--real"
                  : "pre-brief-source-badge--mock"
              }`}
            >
              Identity: {runState.result.identitySource}
            </span>
            <span
              className={`pre-brief-source-badge ${
                runState.result.groundingSource === "real"
                  ? "pre-brief-source-badge--real"
                  : "pre-brief-source-badge--mock"
              }`}
            >
              Grounding: {runState.result.groundingSource}
            </span>
          </div>
          <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
            Live Care Router decision
          </p>
          <p
            style={{
              margin: 0,
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "var(--text)"
            }}
          >
            {runState.result.pathwayLabel}
          </p>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            Acuity: {runState.result.acuity} · Target response:{" "}
            {runState.result.recommendedTargetResponse}
          </p>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
            Decided by <code>{runState.result.provider}</code> /{" "}
            <code>{runState.result.model}</code> ({runState.result.via}).
          </p>
          {runState.result.fallbackReason && (
            <p
              style={{
                margin: "0.4rem 0 0",
                fontSize: "0.8rem",
                color: "#ffd28a"
              }}
            >
              Scripted fallback: {runState.result.fallbackReason}
            </p>
          )}
          <p
            style={{
              margin: "0.4rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            router.pathway = {runState.result.pathway} · task ={" "}
            {runState.result.taskId}
          </p>
        </div>
      )}
    </article>
  );
}
