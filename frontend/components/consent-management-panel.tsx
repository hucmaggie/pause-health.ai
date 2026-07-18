"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CommsChannel,
  type ConsentDecision,
  type ConsentEvent,
  type ConsentLedger,
  type ConsentScope,
  DEMO_CONSENT_LEDGER
} from "../lib/consent-management";

/**
 * Consent & Preferences Management runner for the intake demo.
 *
 * Fires the real, server-side A2A Consent & Preferences Management agent at
 * /api/agents/consent-management/tasks — the MuleSoft control-plane /
 * data-substrate consent service, the AUTHORITATIVE consent ledger the rest of
 * the fabric's consent-before-outreach / consent-before-referral /
 * consent-to-monitor gates defer to. Unlike every other panel (whose agent
 * CONSUMES consent), this one is the SOURCE OF TRUTH FOR consent: it holds a
 * per-patient consent ledger + communication preferences and answers a
 * DETERMINISTIC consent decision, citing the consent record it relied on.
 *
 * The happy-path presets show a granted scope allowed, a withheld scope denied,
 * and a quiet-hours touch denied; the unrecorded-consent, allow-against-revoked,
 * and scope-override presets assert an off-spec input so all three consent
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * The scopes + recorded sources + preferences + patientRef are ILLUSTRATIVE
 * synthetics, NOT a certified consent-management system. Structure, styling
 * tokens, and tone mirror <PopulationHealthPanel> and <RemoteMonitoringPanel> so
 * this reads as a native sibling on /demo/intake.
 */

const CONSENT_ROUTE = "/api/agents/consent-management/tasks";

/** A one-click demo scenario. */
export type ConsentPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The consent ledger the agent evaluates (the common case). */
  ledger?: ConsentLedger;
  scope?: ConsentScope;
  channel?: CommsChannel;
  atTime?: string;
  priorTouches?: number;
  /** Caller-asserted consent events (used only for the recorded-source block). */
  events?: Array<Record<string, unknown>>;
  /** Caller-asserted decisions (used only for the honor-revocation / scope blocks). */
  decisions?: Array<Record<string, unknown>>;
};

export const CONSENT_PRESETS: ConsentPreset[] = [
  {
    id: "granted-allowed",
    label: "Granted scope → allowed",
    hint: "contact-outreach over SMS, mid-afternoon.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "contact-outreach",
    channel: "sms",
    atTime: "2026-03-01T15:00:00Z",
    demonstrates:
      "A granted, current consent for contact-outreach over a permitted channel outside quiet hours — the decision ALLOWS and cites the consent record it relied on."
  },
  {
    id: "withheld-denied",
    label: "Withheld scope → denied",
    hint: "research participation the patient withheld.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "research",
    atTime: "2026-03-01T15:00:00Z",
    demonstrates:
      "A scope the patient WITHHELD — the decision DENIES; the service never overrides or borrows consent across scopes."
  },
  {
    id: "quiet-hours-denied",
    label: "Quiet hours → denied",
    hint: "contact-outreach over SMS at 11pm UTC.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "contact-outreach",
    channel: "sms",
    atTime: "2026-03-01T23:00:00Z",
    demonstrates:
      "A granted scope, but the requested time falls within the patient's quiet hours — the decision DENIES on the communication-preference gate."
  },
  {
    id: "unrecorded-consent-block",
    label: "Unrecorded consent → governance block",
    hint: "An asserted consent with no recorded source.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "contact-outreach",
    events: [
      {
        id: "asserted-evt-001",
        scope: "contact-outreach",
        status: "granted",
        at: "2026-01-01T00:00:00Z",
        source: ""
      }
    ],
    demonstrates:
      "The Agent Fabric blocking an asserted-but-unrecorded consent that doesn't trace to a recorded event/basis — no recorded source (policy.consent.recorded-source)."
  },
  {
    id: "allow-against-revoked-block",
    label: "Allow-against-revoked → governance block",
    hint: "A decision that allows against a revoked scope.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "marketing",
    decisions: [
      {
        scope: "marketing",
        channel: "email",
        allowed: true,
        reason: "override",
        matchedConsentEventId: "consent-evt-marketing-001",
        effectiveStatus: "revoked",
        expired: false
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a decision that would ALLOW outreach against a revoked / expired scope — a revocation must be honored immediately (policy.consent.honor-revocation)."
  },
  {
    id: "scope-override-block",
    label: "Scope override → governance block",
    hint: "A decision that overrides a withheld scope.",
    ledger: DEMO_CONSENT_LEDGER,
    scope: "research",
    decisions: [
      {
        scope: "research",
        allowed: true,
        reason: "override",
        matchedConsentEventId: "consent-evt-research-001",
        effectiveStatus: "withheld",
        expired: false
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a decision that overrides a withheld scope (or borrows consent across scopes) — an allow requires a granted, current record for that exact scope (policy.consent.no-scope-override)."
  }
];

/** Render-ready view of a produced consent decision lifted from the task. */
export type ConsentDecidedView = {
  kind: "decided";
  decision: ConsentDecision;
  events: ConsentEvent[];
  preferences: ConsentLedger["preferences"] | null;
  patientRef: string;
  consentTracesToRecord: boolean;
  honorsRevocation: boolean;
  respectsConsentScope: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked consent run. */
export type ConsentBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ConsentInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ConsentView = ConsentDecidedView | ConsentBlockedView | ConsentInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  consentTracesToRecord?: unknown;
  honorsRevocation?: unknown;
  respectsConsentScope?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildPopulationHealthRequestBody.
 */
export function buildConsentRequestBody(input: {
  taskId: string;
  personaId?: string;
  ledger?: ConsentLedger;
  scope?: ConsentScope;
  channel?: CommsChannel;
  atTime?: string;
  priorTouches?: number;
  events?: Array<Record<string, unknown>>;
  decisions?: Array<Record<string, unknown>>;
}) {
  const data: Record<string, unknown> = {};
  if (input.ledger !== undefined) data.ledger = input.ledger;
  if (input.scope !== undefined) data.scope = input.scope;
  if (input.channel !== undefined) data.channel = input.channel;
  if (input.atTime !== undefined) data.atTime = input.atTime;
  if (input.priorTouches !== undefined) data.priorTouches = input.priorTouches;
  if (input.events !== undefined) data.events = input.events;
  if (input.decisions !== undefined) data.decisions = input.decisions;
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
 * POST a consent query (or asserted events / decisions) to the Consent &
 * Preferences Management agent and return the resulting A2A task. `fetchImpl` is
 * injectable so tests can stub the network boundary. A governance block comes
 * back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runConsentTask(
  input: {
    taskId: string;
    personaId?: string;
    ledger?: ConsentLedger;
    scope?: ConsentScope;
    channel?: CommsChannel;
    atTime?: string;
    priorTouches?: number;
    events?: Array<Record<string, unknown>>;
    decisions?: Array<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CONSENT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildConsentRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * consent decision (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function consentViewFromTask(task: A2ATask): ConsentView {
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
        "The Agent Fabric blocked this consent-management run.";
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
        : "The consent decision could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const decision = data.decision as ConsentDecision | undefined;
  const ledger = data.ledger as ConsentLedger | undefined;

  return {
    kind: "decided",
    decision:
      decision ??
      ({
        scope: "contact-outreach",
        allowed: false,
        reason: "",
        effectiveStatus: "none",
        expired: false
      } as ConsentDecision),
    events: ledger?.events ?? [],
    preferences: ledger?.preferences ?? null,
    patientRef: ledger?.patientRef ?? "",
    consentTracesToRecord: fabric.consentTracesToRecord === true,
    honorsRevocation: fabric.honorsRevocation === true,
    respectsConsentScope: fabric.respectsConsentScope === true,
    traceTaskId
  };
}

const STATUS_TONE: Record<string, string> = {
  granted: "#8fd6b0",
  withheld: "#ffd28a",
  revoked: "#ffb6c8",
  none: "#9fb3c8"
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
  | { status: "done"; view: ConsentView }
  | { status: "error"; message: string };

export function ConsentManagementPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ConsentPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runConsentTask({
          taskId: newTaskId("consent"),
          personaId: "demo",
          ledger: preset.ledger,
          scope: preset.scope,
          channel: preset.channel,
          atTime: preset.atTime,
          priorTouches: preset.priorTouches,
          events: preset.events,
          decisions: preset.decisions
        });
        setRunState({ status: "done", view: consentViewFromTask(task) });
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
        Consent &amp; preferences management
      </p>
      <h3 style={{ margin: 0 }}>
        The authoritative consent ledger the other agents&apos; consent gates defer to
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Consent &amp; Preferences Management agent is the{" "}
        <strong>source of truth for consent</strong> — it holds, per patient, a{" "}
        <strong>consent ledger</strong> (scopes, each granted / withheld / revoked
        with a recorded basis and optional expiry) and{" "}
        <strong>communication preferences</strong> (allowed channels, quiet hours,
        preferred language, frequency cap), and answers one{" "}
        <strong>deterministic question</strong>: may this patient be contacted /
        have data used for this scope over this channel at this time? Every consent
        state <strong>traces to a recorded basis</strong>, a{" "}
        <strong>revocation or expiry is honored immediately</strong>, and a
        decision <strong>never overrides a scope</strong>.{" "}
        <strong>
          The scopes, sources, and preferences are illustrative synthetics, not a
          certified consent-management system.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CONSENT_PRESETS.map((preset) => (
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
              ? "Evaluating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Consent run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ConsentResult view={runState.view} />}
    </section>
  );
}

function ConsentResult({ view }: { view: ConsentView }) {
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

  const d = view.decision;
  const decisionTone = d.allowed ? "#8fd6b0" : "#ffb6c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Consent decision (deterministic, synthetic consent ledger)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{d.scope}</strong>
        {d.channel ? ` · ${d.channel}` : ""} ·{" "}
        <Pill label="Decision" value={d.allowed ? "allowed" : "denied"} tone={decisionTone} />{" "}
        <Pill
          label="Consent"
          value={d.effectiveStatus}
          tone={STATUS_TONE[d.effectiveStatus] ?? "#9fb3c8"}
        />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
        {d.reason}
        {d.matchedConsentEventId ? (
          <>
            {" "}
            — citing consent record <code>{d.matchedConsentEventId}</code>
          </>
        ) : null}
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Consent ledger{view.patientRef ? ` · ${view.patientRef}` : ""}
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.events.map((e) => (
          <li
            key={e.id}
            style={{
              padding: "0.5rem 0.7rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background:
                e.id === d.matchedConsentEventId
                  ? "rgba(143,214,176,0.08)"
                  : "rgba(255,255,255,0.03)",
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
              <strong style={{ fontSize: "0.88rem" }}>{e.scope}</strong>
              <Pill label="Status" value={e.status} tone={STATUS_TONE[e.status] ?? "#9fb3c8"} />
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)"
              }}
            >
              source: {e.source} · recorded {e.at}
              {e.expiresAt ? ` · expires ${e.expiresAt}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {view.preferences && (
        <div
          role="note"
          aria-label="Communication preferences"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Communication preferences{" "}
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
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            channels: {view.preferences.allowedChannels.join(", ")} · quiet hours{" "}
            {view.preferences.quietHours.start}:00–{view.preferences.quietHours.end}:00 UTC ·
            language: {view.preferences.preferredLanguage} · cap:{" "}
            {view.preferences.frequencyCap.maxPerWindow} / {view.preferences.frequencyCap.windowDays}d
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            consentTracesToRecord = {String(view.consentTracesToRecord)} · honorsRevocation ={" "}
            {String(view.honorsRevocation)} · respectsConsentScope ={" "}
            {String(view.respectsConsentScope)}
          </p>
        </div>
      )}

      {traceLink}
    </div>
  );
}
