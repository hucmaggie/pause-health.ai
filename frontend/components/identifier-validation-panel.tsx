"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type IdentifierResult,
  type IdentifierValidationDetermination,
  type IdentifierValidationDisposition,
  type IdentifierValidationRequest,
  DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_REQUEST
} from "../lib/identifier-validation";

/**
 * Provider Identifier (NPI) Validation runner for the intake demo.
 *
 * Fires the real, server-side A2A Identifier Validation agent at /api/agents/identifier-validation/tasks —
 * a data-substrate integrity service that validates a batch of NPIs with the CMS check-digit algorithm
 * (the Luhn / mod-10 checksum over the "80840" prefix + the 9-digit base). The panel surfaces the
 * disposition, the per-identifier results, the per-kind counts, the honesty signals, the synthetic / NOT-PHI
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A finding — all-valid or invalids-flagged — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresStewardReview:true, autoRejected:false). The fabricated-identifier, miscomputed-checksum, and
 * auto-rejected presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable
 * in the UI rather than hidden.
 *
 * DELIBERATELY NOT PHI-bearing — an NPI is a provider identifier, not patient health information. The panel
 * is ILLUSTRATIVE, validating STRUCTURE + check digit only, NOT a certified NPPES / registry lookup.
 * Structure, styling tokens, and tone mirror <HouseholdCompositionPanel> so this reads as a native sibling
 * on /demo/intake.
 */

const IDENTIFIER_VALIDATION_ROUTE = "/api/agents/identifier-validation/tasks";

/** A one-click demo scenario. */
export type IdentifierValidationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: IdentifierValidationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the 3-identifier demo — the block base. */
const VALID_DETERMINATION = {
  batchRef: "npi-batch-001",
  identifiers: [
    { npi: "1234567893", providerLabel: "Dr. Alice Valid" },
    { npi: "1234567890", providerLabel: "Dr. Bob Transposed" },
    { npi: "99999", providerLabel: "Dr. Carol Malformed" }
  ],
  results: [
    {
      npi: "1234567893",
      providerLabel: "Dr. Alice Valid",
      disposition: "valid",
      expectedCheckDigit: 3,
      actualCheckDigit: 3,
      reason: ""
    },
    {
      npi: "1234567890",
      providerLabel: "Dr. Bob Transposed",
      disposition: "invalid-checksum",
      expectedCheckDigit: 3,
      actualCheckDigit: 0,
      reason: ""
    },
    {
      npi: "99999",
      providerLabel: "Dr. Carol Malformed",
      disposition: "invalid-format",
      expectedCheckDigit: null,
      actualCheckDigit: null,
      reason: ""
    }
  ],
  total: 3,
  validCount: 1,
  invalidFormatCount: 1,
  invalidChecksumCount: 1,
  disposition: "invalids-flagged",
  requiresStewardReview: true,
  autoRejected: false
};

export const IDENTIFIER_VALIDATION_PRESETS: IdentifierValidationPreset[] = [
  {
    id: "invalids-flagged",
    label: "3 NPIs \u2192 1 valid, 2 flagged",
    hint: "A valid NPI, a transposed digit, a malformed one.",
    request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
    demonstrates:
      "Luhn check digit \u2014 1234567893 passes, 1234567890 fails the checksum, 99999 fails the format."
  },
  {
    id: "all-valid",
    label: "3 valid NPIs",
    hint: "Three well-formed NPIs with valid check digits.",
    request: DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST,
    demonstrates: "Every NPI passes the format and Luhn check digit \u2014 all-valid."
  },
  {
    id: "invalid-format",
    label: "1 malformed NPI",
    hint: "A 10-digit number starting with 3 (out of the 1\u20132 range).",
    request: DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST,
    demonstrates: "An NPI must be 10 digits beginning with 1 or 2 \u2014 invalid-format."
  },
  {
    id: "fabricated-identifier-block",
    label: "Fabricated result \u2192 governance block",
    hint: "A result for an NPI not in the submitted batch.",
    request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: an extra result for "0000000000", an identifier not in the submitted batch.
      results: [
        ...VALID_DETERMINATION.results,
        {
          npi: "0000000000",
          providerLabel: "Phantom",
          disposition: "invalid-format",
          expectedCheckDigit: null,
          actualCheckDigit: null,
          reason: ""
        }
      ],
      total: 4,
      invalidFormatCount: 2
    },
    demonstrates:
      "The Agent Fabric blocking a finding that reports a result for an identifier not in the batch (policy.identifier.identifiers-sourced)."
  },
  {
    id: "miscomputed-checksum-block",
    label: "Miscomputed check digit \u2192 governance block",
    hint: "A checksum-invalid NPI reported as valid.",
    request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: "1234567890" (expected 3, found 0) is reported as valid.
      results: [
        VALID_DETERMINATION.results[0],
        {
          npi: "1234567890",
          providerLabel: "Dr. Bob Transposed",
          disposition: "valid",
          expectedCheckDigit: 0,
          actualCheckDigit: 0,
          reason: ""
        },
        VALID_DETERMINATION.results[2]
      ],
      validCount: 2,
      invalidChecksumCount: 0
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose Luhn check digit doesn't recompute (policy.identifier.checksum-consistent)."
  },
  {
    id: "auto-rejected-block",
    label: "Claim rejected autonomously \u2192 governance block",
    hint: "A finding that auto-rejected the claim.",
    request: DEMO_IDENTIFIER_VALIDATION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent rejected the claim and skipped steward review.
      requiresStewardReview: false,
      autoRejected: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous reject (policy.identifier.no-autonomous-reject)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type IdentifierValidationResolvedView = {
  kind: "resolved";
  batchRef: string;
  disposition: IdentifierValidationDisposition;
  results: IdentifierResult[];
  total: number;
  validCount: number;
  invalidFormatCount: number;
  invalidChecksumCount: number;
  reason: string;
  note: string;
  identifiersSourced: boolean;
  checksumConsistent: boolean;
  identifierNoAutonomousReject: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type IdentifierValidationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type IdentifierValidationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type IdentifierValidationView =
  | IdentifierValidationResolvedView
  | IdentifierValidationBlockedView
  | IdentifierValidationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  identifiersSourced?: unknown;
  checksumConsistent?: unknown;
  identifierNoAutonomousReject?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildIdentifierValidationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: IdentifierValidationRequest;
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
 * POST an identifier-validation request (or an asserted finding) to the agent and return the resulting A2A
 * task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runIdentifierValidationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: IdentifierValidationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(IDENTIFIER_VALIDATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildIdentifierValidationRequestBody(input))
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
export function identifierValidationViewFromTask(task: A2ATask): IdentifierValidationView {
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
        "The Agent Fabric blocked this identifier-validation run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The identifiers could not be validated.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: IdentifierValidationDetermination; batchRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    batchRef: result?.batchRef ?? det?.batchRef ?? "",
    disposition: det?.disposition ?? "all-valid",
    results: det?.results ?? [],
    total: det?.total ?? 0,
    validCount: det?.validCount ?? 0,
    invalidFormatCount: det?.invalidFormatCount ?? 0,
    invalidChecksumCount: det?.invalidChecksumCount ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    identifiersSourced: fabric.identifiersSourced === true,
    checksumConsistent: fabric.checksumConsistent === true,
    identifierNoAutonomousReject: fabric.identifierNoAutonomousReject === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<IdentifierValidationDisposition, string> = {
  "all-valid": "#8fd6b0",
  "invalids-flagged": "#ffd28a"
};

const DISPOSITION_LABEL: Record<IdentifierValidationDisposition, string> = {
  "all-valid": "All valid \u00b7 well-formed with correct check digits",
  "invalids-flagged": "Invalids flagged \u00b7 for steward review"
};

const RESULT_TONE: Record<IdentifierResult["disposition"], string> = {
  valid: "#8fd6b0",
  "invalid-format": "#ffd28a",
  "invalid-checksum": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: IdentifierValidationView }
  | { status: "error"; message: string };

export function IdentifierValidationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: IdentifierValidationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runIdentifierValidationTask({
          taskId: newTaskId("identifier-validation"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: identifierValidationViewFromTask(task) });
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
        Data substrate &middot; identifier integrity &middot; platform plane
      </p>
      <h3 style={{ margin: 0 }}>
        Provider Identifier (NPI) Validation — sourced, check digit recomputes, never an autonomous reject
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a batch of{" "}
        <strong>National Provider Identifiers</strong> and validates each one with the{" "}
        <strong>CMS check-digit algorithm</strong> &mdash; the <strong>Luhn (mod-10) checksum</strong>{" "}
        computed over the <code>80840</code> prefix + the 9-digit base &mdash; classifying each as{" "}
        <strong>valid</strong>, <strong>invalid-format</strong>, or <strong>invalid-checksum</strong> (a
        likely transposition / typo). Not a percentile, not a union-find, and <strong>not</strong> an
        identity match &mdash; a <strong>modular-arithmetic checksum</strong>. Every result is{" "}
        <strong>sourced</strong>, the check digit <strong>recomputes exactly</strong>, and the result is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> rejects a claim, removes a
        provider, or corrects a number &mdash; a data steward confirms.{" "}
        <strong>NOT PHI-bearing &middot; validates structure + check digit only, not a registry lookup.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {IDENTIFIER_VALIDATION_PRESETS.map((preset) => (
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
              ? "Validating\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Validation failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <IdentifierValidationResult view={runState.view} />}
    </section>
  );
}

function IdentifierValidationResult({ view }: { view: IdentifierValidationView }) {
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
        {view.total} NPI(s) &middot; {view.validCount} valid &middot; {view.invalidFormatCount}{" "}
        invalid-format &middot; {view.invalidChecksumCount} invalid-checksum
      </p>

      {view.results.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.results.map((r, i) => (
            <li key={`${r.npi}-${i}`}>
              <code>{r.npi}</code>{" "}
              <span style={{ color: RESULT_TONE[r.disposition], fontWeight: 600 }}>
                {r.disposition}
              </span>
              {r.disposition === "invalid-checksum"
                ? ` (expected ${r.expectedCheckDigit}, found ${r.actualCheckDigit})`
                : ""}
              {r.providerLabel ? ` \u00b7 ${r.providerLabel}` : ""}
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
          Sourced &middot; check digit recomputes &middot; never an autonomous reject{" "}
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
            synthetic &middot; NOT PHI
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
          identifiersSourced = {String(view.identifiersSourced)} &middot; checksumConsistent ={" "}
          {String(view.checksumConsistent)} &middot; identifierNoAutonomousReject ={" "}
          {String(view.identifierNoAutonomousReject)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
