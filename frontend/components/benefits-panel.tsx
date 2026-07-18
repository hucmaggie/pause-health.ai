"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type {
  CoverageBenefitResult,
  CoverageQuery,
  CoverageSource
} from "../lib/benefits";

/**
 * Benefits & Coverage Verification (EBV) runner for the intake demo.
 *
 * Fires the real, server-side A2A Benefits & Coverage Verification agent
 * at /api/agents/benefits-verification/tasks — a DETERMINISTIC synthetic
 * eligibility & benefit verification (no LLM, no live 270/271 or FHIR
 * call) — and surfaces the structured CoverageBenefitResult (plan +
 * status, in/out-of-network, deductible + amount met, coinsurance/copay,
 * estimated visit cost + patient responsibility) plus the (mock)
 * payer/clearinghouse EBV source provenance it traces to, and a deep link
 * into the parented Agent Fabric trace on /demo/agent-fabric.
 *
 * The caller-asserted preset intentionally sends a "coverage" object with
 * NO source provenance, so the governance block
 * (policy.benefits.eligibility-source-integrity) is demonstrable in the
 * UI rather than hidden — the panel reports the failed state and which
 * policy blocked it honestly rather than fabricating a benefit.
 *
 * Structure, styling tokens (.card, .btn/.btn-primary/.btn-secondary,
 * .eyebrow, .agentforce-voice-help-link, .routing-live-result), and tone
 * mirror <AssessmentPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const BENEFITS_ROUTE = "/api/agents/benefits-verification/tasks";
const CARE_ROUTER_ROUTE = "/api/intake/route-to-care-router";

/**
 * A one-click demo scenario. Most presets send a `coverageQuery` the
 * agent verifies; the governance-block preset sends a caller-asserted
 * `coverage` object with NO source so the source-integrity gate trips.
 */
export type BenefitsPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** A coverage query the agent verifies (the common case). */
  query?: CoverageQuery;
  /**
   * A caller-asserted coverage result posted as-is. Used only for the
   * governance-block preset; omit `source` to trip source-integrity.
   */
  assertedCoverage?: Record<string, unknown>;
};

export const BENEFITS_PRESETS: BenefitsPreset[] = [
  {
    id: "in-network-deductible-met",
    label: "In-network · deductible met",
    hint: "Aetna Choice PPO, deductible fully met — only coinsurance is left.",
    // Deterministic: Aetna + this member/zip → in-network Choice PPO with
    // the $1,500 deductible fully met, so responsibility is just the 20%
    // coinsurance on the visit (low out-of-pocket).
    query: { payer: "Aetna", memberId: "PH-1", patientZip: "60614" },
    demonstrates:
      "A contracted in-network plan with the deductible already met — low patient responsibility (coinsurance only)."
  },
  {
    id: "hdhp-not-met",
    label: "High-deductible · not met",
    hint: "UnitedHealthcare Saver HDHP, $0 of $6,000 met — visit is all patient-paid.",
    // Deterministic: UHC + this member/zip → in-network Saver HDHP with $0
    // of the $6,000 deductible met, so the full visit cost applies toward
    // the deductible (higher patient responsibility).
    query: { payer: "UnitedHealthcare", memberId: "PH-8", patientZip: "10001" },
    demonstrates:
      "An unmet high-deductible plan — the full visit lands on the patient until the deductible is met."
  },
  {
    id: "self-pay",
    label: "Self-pay · no active coverage",
    hint: "No plan on file — a sourced 'no-active-coverage' EBV response.",
    // Empty/self-pay payer → inactive coverage. Still a SOURCED response
    // ("no-active-coverage"), not a fabricated benefit.
    query: { payer: "self-pay", memberId: "PH-1" },
    demonstrates:
      "A self-pay patient — an honest, still-sourced 'no active coverage' response with the full visit as out-of-pocket."
  },
  {
    id: "asserted-no-source",
    label: "Asserted coverage · governance block",
    hint: "A caller-asserted benefit with NO payer/clearinghouse source — blocked by policy.",
    // A coverage RESULT (not a query) with no `source`. The agent may not
    // fabricate coverage without a payer/clearinghouse EBV source, so
    // policy.benefits.eligibility-source-integrity blocks it before it can
    // drive a benefit estimate.
    assertedCoverage: {
      eligibilityStatus: "active",
      network: "in-network",
      payerName: "Caller-asserted PPO",
      planName: "Asserted Choice PPO",
      productType: "PPO",
      serviceType: "mscp-specialist-visit",
      deductibleTotal: 1500,
      deductibleMet: 1500,
      deductibleRemaining: 0,
      coinsuranceRate: 0.2,
      estimatedVisitCost: 300,
      estimatedPatientResponsibility: 60
      // NB: no `source` → trips policy.benefits.eligibility-source-integrity.
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated coverage result that doesn't trace to a payer/clearinghouse EBV source."
  }
];

/** Render-ready view of a verified coverage result lifted from the task. */
export type CoverageView = {
  kind: "verified";
  eligibilityStatus: string;
  network: string;
  payerName: string;
  planName: string;
  productType: string;
  serviceType: string;
  deductibleTotal: number;
  deductibleMet: number;
  deductibleRemaining: number;
  coinsuranceRate: number;
  copay?: number;
  estimatedVisitCost: number;
  estimatedPatientResponsibility: number;
  source: CoverageSource;
  nextAgent?: string;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked verification. */
export type BenefitsBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be verified. */
export type BenefitsInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type BenefitsView = CoverageView | BenefitsBlockedView | BenefitsInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  nextAgent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept
 * pure (no fetch, no hooks) so it can be unit-tested without a DOM,
 * mirroring buildAssessmentRequestBody. A `coverageQuery` asks the agent
 * to verify; an `assertedCoverage` posts a caller-supplied result as-is
 * (used to demonstrate the source-integrity block).
 */
export function buildBenefitsRequestBody(input: {
  taskId: string;
  personaId?: string;
  query?: CoverageQuery;
  assertedCoverage?: Record<string, unknown>;
}) {
  const data =
    input.assertedCoverage !== undefined
      ? { coverage: input.assertedCoverage }
      : { coverageQuery: input.query ?? {} };
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
 * POST a coverage query (or asserted coverage) to the Benefits agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can
 * stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runBenefitsTask(
  input: {
    taskId: string;
    personaId?: string;
    query?: CoverageQuery;
    assertedCoverage?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(BENEFITS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBenefitsRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a verified
 * coverage result (completed) from a governance block vs. an invalid
 * request (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function benefitsViewFromTask(task: A2ATask): BenefitsView {
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
        "The Agent Fabric blocked this coverage verification.";
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
        : "The coverage could not be verified.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result = (data.result ?? {}) as Partial<CoverageBenefitResult>;

  return {
    kind: "verified",
    eligibilityStatus: result.eligibilityStatus ?? "inactive",
    network: result.network ?? "out-of-network",
    payerName: result.payerName ?? "",
    planName: result.planName ?? "",
    productType: result.productType ?? "",
    serviceType: result.serviceType ?? "",
    deductibleTotal: result.deductibleTotal ?? 0,
    deductibleMet: result.deductibleMet ?? 0,
    deductibleRemaining: result.deductibleRemaining ?? 0,
    coinsuranceRate: result.coinsuranceRate ?? 0,
    ...(result.copay !== undefined ? { copay: result.copay } : {}),
    estimatedVisitCost: result.estimatedVisitCost ?? 0,
    estimatedPatientResponsibility: result.estimatedPatientResponsibility ?? 0,
    source: result.source as CoverageSource,
    nextAgent: typeof fabric.nextAgent === "string" ? fabric.nextAgent : undefined,
    traceTaskId
  };
}

/** Lifted Care Router follow-on decision. */
export type CareRouterFollowOn = {
  taskId: string;
  pathway?: string;
  pathwayLabel?: string;
  acuity?: string;
  coverageVerifiedBeforeRouting: boolean;
};

/**
 * Optional follow-on: carry the just-verified coverage into the full
 * intake → Care Router hop so the routing decision is preceded by a real
 * eligibility check. Additive on the server; the response's `decision` +
 * `taskId` thread one continuous trace.
 */
export async function carryCoverageIntoCareRouter(
  input: { query: CoverageQuery; personaId?: string },
  fetchImpl: typeof fetch = fetch
): Promise<CareRouterFollowOn> {
  const res = await fetchImpl(CARE_ROUTER_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coverage: { query: input.query },
      personaId: input.personaId ?? "demo",
      origin: "benefits-agent"
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as {
    taskId?: string;
    decision?: { pathway?: string; pathwayLabel?: string; acuity?: string } | null;
    coverage?: { coverageVerifiedBeforeRouting?: boolean } | null;
  };
  return {
    taskId: payload.taskId ?? "",
    pathway: payload.decision?.pathway,
    pathwayLabel: payload.decision?.pathwayLabel,
    acuity: payload.decision?.acuity,
    coverageVerifiedBeforeRouting:
      payload.coverage?.coverageVerifiedBeforeRouting ?? false
  };
}

const NETWORK_TONE: Record<string, string> = {
  "in-network": "#8fd6b0",
  "out-of-network": "#ffd28a"
};

function StatusPill({ label, value }: { label: string; value: string }) {
  const tone =
    NETWORK_TONE[value] ??
    (value === "active" ? "#8fd6b0" : value === "inactive" ? "#ffb6c8" : "var(--muted)");
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
        fontSize: "0.78rem",
        fontWeight: 600
      }}
    >
      {label}: {value}
    </span>
  );
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: BenefitsView; lastQuery: CoverageQuery | null }
  | { status: "error"; message: string };

type FollowOnState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: CareRouterFollowOn }
  | { status: "error"; message: string };

const SERVICE_TYPES = [
  { id: "mscp-specialist-visit", label: "MSCP specialist visit" },
  { id: "telehealth-consult", label: "Telehealth consult" },
  { id: "labs-panel", label: "Labs panel" }
];

export function BenefitsPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const [followOn, setFollowOn] = useState<FollowOnState>({ status: "idle" });
  const [showCustom, setShowCustom] = useState(false);
  const [payer, setPayer] = useState("Aetna");
  const [memberId, setMemberId] = useState("PH-1");
  const [zip, setZip] = useState("60614");
  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0].id);

  const busy = runState.status === "running";

  const reset = () => {
    setRunState({ status: "idle" });
    setFollowOn({ status: "idle" });
  };

  const run = async (input: {
    label: string;
    query?: CoverageQuery;
    assertedCoverage?: Record<string, unknown>;
  }) => {
    setRunState({ status: "running", label: input.label });
    setFollowOn({ status: "idle" });
    try {
      const task = await runBenefitsTask({
        taskId: newTaskId("benefits"),
        personaId: "demo",
        query: input.query,
        assertedCoverage: input.assertedCoverage
      });
      setRunState({
        status: "done",
        view: benefitsViewFromTask(task),
        lastQuery: input.query ?? null
      });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: BenefitsPreset) => {
    void run({
      label: preset.label,
      query: preset.query,
      assertedCoverage: preset.assertedCoverage
    });
  };

  const runCustom = () => {
    const query: CoverageQuery = {
      payer: payer.trim(),
      memberId: memberId.trim() || undefined,
      patientZip: zip.trim() || undefined,
      serviceType
    };
    void run({ label: "Custom query", query });
  };

  const runFollowOn = async () => {
    if (runState.status !== "done" || runState.view.kind !== "verified") return;
    if (!runState.lastQuery) return;
    const { lastQuery } = runState;
    setFollowOn({ status: "running" });
    try {
      const result = await carryCoverageIntoCareRouter({
        query: lastQuery,
        personaId: "demo"
      });
      setFollowOn({ status: "done", result });
    } catch (err) {
      setFollowOn({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Eligibility &amp; benefit verification (EBV)
      </p>
      <h3 style={{ margin: 0 }}>
        The Benefits agent that verifies coverage before care
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Benefits &amp; Coverage Verification agent runs a{" "}
        <strong>deterministic synthetic EBV round-trip</strong> over Google A2A
        — plan status, in/out-of-network, deductible + amount met,
        coinsurance/copay, and an estimated visit cost + patient responsibility,
        each tracing to a (mock) payer/clearinghouse source.{" "}
        <strong>
          This is a labeled demo mock — not a live 270/271 or FHIR eligibility
          call.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {BENEFITS_PRESETS.map((preset) => (
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

      <div style={{ marginTop: "0.9rem" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowCustom((v) => !v)}
          aria-expanded={showCustom}
          style={{ fontSize: "0.82rem" }}
        >
          {showCustom ? "Hide custom query" : "Build your own query"}
        </button>
      </div>

      {showCustom && (
        <div
          style={{
            marginTop: "0.8rem",
            padding: "0.85rem 0.95rem",
            border: "1px solid var(--line)",
            borderRadius: "0.7rem",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
              gap: "0.65rem"
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span className="eyebrow">Payer</span>
              <input
                type="text"
                value={payer}
                onChange={(e) => {
                  setPayer(e.target.value);
                  reset();
                }}
                placeholder="Aetna / self-pay"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span className="eyebrow">Member id (synthetic)</span>
              <input
                type="text"
                value={memberId}
                onChange={(e) => {
                  setMemberId(e.target.value);
                  reset();
                }}
                placeholder="PH-1"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span className="eyebrow">ZIP</span>
              <input
                type="text"
                inputMode="numeric"
                value={zip}
                onChange={(e) => {
                  setZip(e.target.value);
                  reset();
                }}
                placeholder="60614"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span className="eyebrow">Service type</span>
              <select
                value={serviceType}
                onChange={(e) => {
                  setServiceType(e.target.value);
                  reset();
                }}
                style={inputStyle}
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runCustom}
            disabled={busy}
            style={{ marginTop: "0.7rem", fontSize: "0.82rem" }}
          >
            {runState.status === "running" && runState.label === "Custom query"
              ? "Verifying…"
              : "Verify this coverage"}
          </button>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.78rem" }}>
            Member ids are synthetic — never a real member number. Results are
            deterministic on the inputs.
          </p>
        </div>
      )}

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Coverage verification failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <BenefitsResult
          view={runState.view}
          canFollowOn={runState.lastQuery !== null}
          followOn={followOn}
          onFollowOn={runFollowOn}
        />
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.55rem",
  borderRadius: "0.45rem",
  border: "1px solid var(--line)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--text)",
  fontSize: "0.85rem"
};

function BenefitsResult({
  view,
  canFollowOn,
  followOn,
  onFollowOn
}: {
  view: BenefitsView;
  canFollowOn: boolean;
  followOn: FollowOnState;
  onFollowOn: () => void;
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
          Not verified
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const costLabel =
    view.copay !== undefined
      ? `${usd(view.copay)} copay`
      : `${Math.round(view.coinsuranceRate * 100)}% coinsurance`;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Synthetic EBV response (deterministic mock)
      </p>
      <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {view.planName || view.payerName}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          margin: "0.5rem 0 0"
        }}
      >
        <StatusPill label="Eligibility" value={view.eligibilityStatus} />
        <StatusPill label="Network" value={view.network} />
      </div>

      <ul
        className="metric-list"
        style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}
      >
        {view.eligibilityStatus === "active" && (
          <li style={metricRow}>
            <span style={{ color: "var(--muted)" }}>Deductible (met / total)</span>
            <strong>
              {usd(view.deductibleMet)} / {usd(view.deductibleTotal)} ·{" "}
              {usd(view.deductibleRemaining)} remaining
            </strong>
          </li>
        )}
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Cost share</span>
          <strong>{costLabel}</strong>
        </li>
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Estimated visit cost</span>
          <strong>{usd(view.estimatedVisitCost)}</strong>
        </li>
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Estimated patient responsibility</span>
          <strong style={{ color: "var(--text)" }}>
            {usd(view.estimatedPatientResponsibility)}
          </strong>
        </li>
      </ul>

      {view.source && (
        <div
          role="note"
          aria-label="Synthetic EBV source provenance"
          style={{
            marginTop: "0.7rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Source provenance{" "}
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
          <ul
            style={{
              margin: "0.4rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.82rem"
            }}
          >
            <li>Payer: {view.source.payer}</li>
            <li>Clearinghouse: {view.source.clearinghouse}</li>
            <li>Transaction: {view.source.transactionType}</li>
            <li>Response code: {view.source.responseCode}</li>
          </ul>
          <p
            style={{
              margin: "0.4rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            {view.source.transactionId}
          </p>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
            {view.source.note}
          </p>
        </div>
      )}

      {view.nextAgent && (
        <p
          style={{
            margin: "0.6rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          nextAgent = {view.nextAgent}
        </p>
      )}

      {canFollowOn && (
        <div
          style={{
            marginTop: "0.7rem",
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onFollowOn}
            disabled={followOn.status === "running"}
            style={{ fontSize: "0.82rem" }}
          >
            {followOn.status === "running"
              ? "Routing to Care Router…"
              : "Carry this coverage into the Care Router →"}
          </button>
        </div>
      )}

      {followOn.status === "error" && (
        <p role="alert" style={{ margin: "0.5rem 0 0", color: "#ffb6c8", fontSize: "0.85rem" }}>
          Care Router handoff failed: {followOn.message}.
        </p>
      )}

      {followOn.status === "done" && (
        <div
          style={{
            marginTop: "0.6rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid var(--line)"
          }}
        >
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            Care Router pathway:{" "}
            <strong>
              {followOn.result.pathwayLabel ?? followOn.result.pathway ?? "—"}
            </strong>
            {followOn.result.acuity ? ` · acuity ${followOn.result.acuity}` : ""}
          </p>
          {followOn.result.coverageVerifiedBeforeRouting && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              This routing decision was preceded by a verified coverage check.
            </p>
          )}
          {followOn.result.taskId && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.86rem" }}>
              <a
                href={`/demo/agent-fabric?taskId=${encodeURIComponent(
                  followOn.result.taskId
                )}`}
                className="agentforce-voice-help-link"
              >
                Open the intake → Care Router trace →
              </a>
            </p>
          )}
        </div>
      )}

      {followOn.status !== "done" && traceLink}
    </div>
  );
}

const metricRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "0.5rem",
  fontSize: "0.86rem",
  padding: "0.15rem 0"
};
