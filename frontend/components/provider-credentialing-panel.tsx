"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_EXPIRED_PROVIDER,
  DEMO_SANCTIONED_PROVIDER,
  DEMO_STALE_DIRECTORY_PROVIDER,
  DEMO_VERIFIED_PROVIDER,
  type ProviderCredentialingRecord,
  type ProviderVerificationRequest
} from "../lib/provider-credentialing";

/**
 * Provider Credentialing & Directory runner for the intake demo.
 *
 * Fires the real, server-side A2A credentialing agent at
 * /api/agents/provider-credentialing/tasks — a network-integrity agent
 * that verifies a provider's credentials + directory record and gates every
 * referral / scheduling attempt at the network boundary. The panel surfaces
 * the per-credential state, the directory-freshness flag, the overall
 * status, the gate flags, the honesty signals, and a deep link into the
 * parented Agent Fabric trace.
 */

const CRED_ROUTE = "/api/agents/provider-credentialing/tasks";

/** A one-click demo scenario. */
export type ProviderCredentialingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: ProviderVerificationRequest;
};

export const PROVIDER_CREDENTIALING_PRESETS: ProviderCredentialingPreset[] = [
  {
    id: "verified-referral",
    label: "Verified MSCP → all gates open (referral)",
    hint: "Every credential complete + verified + fresh directory.",
    request: DEMO_VERIFIED_PROVIDER,
    demonstrates:
      "The agent verifying a fully-credentialed MSCP against approved sources, computing the No-Surprises-Act directory-freshness flag, and opening all three gates (canReferPatient / canBookAppointment / canReturnInDirectoryResponse) so downstream agents can safely hand off."
  },
  {
    id: "expired-license-block",
    label: "Expired state license → governance block",
    hint: "Same provider, state license 6 months past expiry.",
    request: { ...DEMO_EXPIRED_PROVIDER, intent: "referral" },
    demonstrates:
      "The Agent Fabric blocking a referral to a provider whose state license has expired — the ghost-network guard at the network boundary (policy.credentialing.no-referral-to-expired-or-sanctioned)."
  },
  {
    id: "sanctioned-block",
    label: "Sanctioned provider → governance block",
    hint: "Active OIG-LEIE sanction, all other credentials look complete.",
    request: { ...DEMO_SANCTIONED_PROVIDER, intent: "scheduling" },
    demonstrates:
      "The Agent Fabric blocking a booking to a sanctioned provider — sanctioned status has highest precedence, even over 'verified' claims on the other credentials (policy.credentialing.no-referral-to-expired-or-sanctioned)."
  },
  {
    id: "stale-directory-block",
    label: "Stale directory (past NSA window) → governance block",
    hint: "Directory record last verified 200 days ago, past the 90-day NSA window.",
    request: { ...DEMO_STALE_DIRECTORY_PROVIDER, intent: "directory-lookup" },
    demonstrates:
      "The Agent Fabric blocking a directory-lookup response returned as authoritative when the record is past the No-Surprises-Act 90-day accuracy window — the load-bearing patient-protection guard (policy.credentialing.no-surprises-act-directory-accuracy)."
  }
];

/** Render-ready view of a produced record lifted from the task. */
export type CredentialingReportedView = {
  kind: "reported";
  record: ProviderCredentialingRecord;
  credentialsTraceToVerifiedSource: boolean;
  noReferralToExpiredOrSanctioned: boolean;
  directoryIsFresh: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CredentialingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CredentialingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ProviderCredentialingView =
  | CredentialingReportedView
  | CredentialingBlockedView
  | CredentialingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  credentialsTraceToVerifiedSource?: unknown;
  noReferralToExpiredOrSanctioned?: unknown;
  directoryIsFresh?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildProviderCredentialingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ProviderVerificationRequest;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
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
 * POST a verification request to the credentialing agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary.
 */
export async function runProviderCredentialingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ProviderVerificationRequest;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CRED_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProviderCredentialingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * record (completed) from a governance block vs. an invalid request.
 */
export function providerCredentialingViewFromTask(
  task: A2ATask
): ProviderCredentialingView {
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
        "The Agent Fabric blocked this credentialing check.";
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
        : "The credentialing record could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { record?: ProviderCredentialingRecord } | undefined) ?? undefined;
  const record = result?.record;

  if (!record) {
    return {
      kind: "invalid",
      message: "The credentialing record could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    record,
    credentialsTraceToVerifiedSource:
      fabric.credentialsTraceToVerifiedSource === true,
    noReferralToExpiredOrSanctioned:
      fabric.noReferralToExpiredOrSanctioned === true,
    directoryIsFresh: fabric.directoryIsFresh === true,
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

const STATUS_TONE: Record<string, string> = {
  verified: "#8fd6b0",
  incomplete: "#ffd28a",
  expired: "#ffb6c8",
  sanctioned: "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ProviderCredentialingView }
  | { status: "error"; message: string };

export function ProviderCredentialingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: ProviderCredentialingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runProviderCredentialingTask({
          taskId: newTaskId("credentialing"),
          personaId: "demo",
          request: preset.request
        });
        setRunState({
          status: "done",
          view: providerCredentialingViewFromTask(task)
        });
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
        Provider credentialing &amp; directory
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that fixes the ghost network — no referral to an expired /
        sanctioned provider, no stale directory response returned as authoritative
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The credentialing agent sits alongside the data substrate and gates
        every referral / scheduling attempt at the network boundary. It{" "}
        <strong>verifies each credential</strong> (state license, DEA, board
        cert, sanctions clearance, NPI) against{" "}
        <strong>approved sources</strong> (state-medical-board, DEA-registry,
        ABMS-board, OIG-LEIE-sanctions, NPI-registry), computes the{" "}
        <strong>No-Surprises-Act freshness flag</strong> (90-day accuracy
        window), and emits <strong>gate flags</strong>{" "}
        (canReferPatient / canBookAppointment / canReturnInDirectoryResponse)
        the Referral Management, Appointment Scheduling, and Transitions of
        Care agents can consult before handing off. Sanctioned status has{" "}
        <strong>highest precedence</strong> — a sanctioned provider never
        slips through, even when other credentials look complete.{" "}
        <strong>
          The catalog, verification sources, NSA window, and directory schema
          are illustrative synthetics, not NCQA / CAQH credentialing or a live
          state-medical-board / OIG-LEIE feed.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PROVIDER_CREDENTIALING_PRESETS.map((preset) => (
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
              ? "Verifying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Credentialing check failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <ProviderCredentialingResult view={runState.view} />
      )}
    </section>
  );
}

function ProviderCredentialingResult({
  view
}: {
  view: ProviderCredentialingView;
}) {
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

  const r = view.record;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Credentialing verification (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Provider" value={r.providerRef} tone="#9fb3c8" />{" "}
        <Pill label="As of" value={r.asOfDate} tone="#9fb3c8" />{" "}
        <Pill
          label="Status"
          value={r.status}
          tone={STATUS_TONE[r.status] ?? "#9fb3c8"}
        />{" "}
        <Pill
          label="Directory"
          value={r.directoryProfile.isFresh ? "fresh" : "stale"}
          tone={r.directoryProfile.isFresh ? "#8fd6b0" : "#ffd28a"}
        />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Referral / scheduling / directory gates
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="canReferPatient"
          value={String(r.gates.canReferPatient)}
          tone={r.gates.canReferPatient ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="canBookAppointment"
          value={String(r.gates.canBookAppointment)}
          tone={r.gates.canBookAppointment ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="canReturnInDirectoryResponse"
          value={String(r.gates.canReturnInDirectoryResponse)}
          tone={r.gates.canReturnInDirectoryResponse ? "#8fd6b0" : "#ffb6c8"}
        />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Credentials on file
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {r.credentials.map((c) => (
          <li
            key={`${c.kind}-${c.credentialId}`}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.03)",
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
              <strong style={{ fontSize: "0.9rem" }}>
                {c.kind} · {c.credentialId}
                {c.sanctioned ? " · SANCTIONED" : ""}
              </strong>
              <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <Pill
                  label="Source"
                  value={c.sourceIsApproved ? "approved" : "off-catalog"}
                  tone={c.sourceIsApproved ? "#8fd6b0" : "#ffb6c8"}
                />
                <Pill
                  label="Expiry"
                  value={c.isExpired ? "expired" : "current"}
                  tone={c.isExpired ? "#ffb6c8" : "#8fd6b0"}
                />
              </span>
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              source = {c.source} · verifiedOn = {c.verifiedOn} · expiresOn ={" "}
              {c.expiresOn} · daysUntilExpiry = {c.daysUntilExpiry}
            </p>
          </li>
        ))}
      </ul>

      <div
        role="note"
        aria-label="Directory profile"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Directory · {r.directoryProfile.displayName}{" "}
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
        <p
          style={{
            margin: "0.3rem 0 0",
            fontSize: "0.82rem",
            color: "var(--muted)"
          }}
        >
          {r.directoryProfile.specialty} · {r.directoryProfile.city},{" "}
          {r.directoryProfile.state} · taking new patients:{" "}
          {String(r.directoryProfile.takingNewPatients)}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          verifiedAsOf = {r.directoryProfile.verifiedAsOf} · daysSinceVerified ={" "}
          {r.directoryProfile.daysSinceVerified} · isFresh ={" "}
          {String(r.directoryProfile.isFresh)}
        </p>
      </div>

      <div
        role="note"
        aria-label="Credentialing note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          {r.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          credentialsTraceToVerifiedSource ={" "}
          {String(view.credentialsTraceToVerifiedSource)} ·
          noReferralToExpiredOrSanctioned ={" "}
          {String(view.noReferralToExpiredOrSanctioned)} · directoryIsFresh ={" "}
          {String(view.directoryIsFresh)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
