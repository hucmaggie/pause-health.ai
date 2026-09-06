"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type PricedLine,
  type QuoteDecision,
  type QuoteRequest,
  DEMO_QUOTE_BOUNDARY_REQUEST,
  DEMO_QUOTE_ESCALATE_REQUEST,
  DEMO_QUOTE_REQUEST
} from "../lib/deal-desk";

/**
 * Deal Desk / Quote Approval (CPQ) runner for the intake demo.
 *
 * Fires the real, server-side A2A Deal Desk agent at /api/agents/deal-desk/tasks — Pause's OWN
 * go-to-market deal-desk service on the strictly PHI-separated commercial-operations plane. It
 * validates a proposed enterprise quote's pricing + discounting against the guardrail catalog and
 * decides auto-approve vs. escalate to a human deal-desk owner. The panel surfaces the totals, the
 * effective blended discount, the per-line guardrail check, the disposition, the honesty signals, the
 * synthetic labels, and a deep link into the parented Agent Fabric trace.
 *
 * A decision — auto-approve OR escalate — is a SAFE, honest OUTPUT (it completes; an out-of-guardrail
 * quote carries requiresDealDeskApproval:true). The off-catalog-product, bad-math, and
 * out-of-guardrail-auto-approved presets assert offending DECISIONS — so all three governance blocks
 * are demonstrable in the UI rather than hidden.
 *
 * This is a COMMERCIAL agent — no patient PHI. The product catalog + guardrails are ILLUSTRATIVE, NOT
 * a certified CPQ / pricing system. Structure, styling tokens, and tone mirror
 * <ProviderContractingPanel> and <SubrogationPanel> so this reads as a native sibling on /demo/intake.
 */

const DEAL_DESK_ROUTE = "/api/agents/deal-desk/tasks";

/** A one-click demo scenario. */
export type DealDeskPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The quote the agent evaluates (the common case). */
  request?: QuoteRequest;
  /** Caller-asserted decision (used only for the three governance blocks). */
  decision?: Record<string, unknown>;
};

export const DEAL_DESK_PRESETS: DealDeskPreset[] = [
  {
    id: "within-guardrail",
    label: "Standard discounts → auto-approve",
    hint: "Every line's discount is within its product guardrail.",
    request: DEMO_QUOTE_REQUEST,
    demonstrates:
      "A standard quote where every line is within guardrail; auto-approved with no human needed."
  },
  {
    id: "escalate",
    label: "25% on Platform Core → escalate",
    hint: "A discount above the 15% platform-core guardrail.",
    request: DEMO_QUOTE_ESCALATE_REQUEST,
    demonstrates:
      "An out-of-guardrail discount escalated to a human deal-desk owner, never auto-approved."
  },
  {
    id: "boundary",
    label: "Services at the 25% cap → auto-approve",
    hint: "A discount exactly at the implementation-services guardrail.",
    request: DEMO_QUOTE_BOUNDARY_REQUEST,
    demonstrates:
      "A boundary case — a discount right at the guardrail is still auto-approvable."
  },
  {
    id: "off-catalog-product-block",
    label: "Off-catalog product → governance block",
    hint: "A decision pricing a made-up product id.",
    request: DEMO_QUOTE_REQUEST,
    decision: {
      quoteRef: "quote-001",
      accountRef: "account-northstar-health",
      lines: [
        {
          productId: "product.we-made-up",
          productName: "unknown product",
          listPrice: 100000,
          quantity: 1,
          proposedDiscountPct: 10,
          maxAutoApproveDiscountPct: 0,
          lineListTotal: 100000,
          lineNetTotal: 90000,
          withinGuardrail: false
        }
      ],
      listTotal: 100000,
      netTotal: 90000,
      discountTotal: 10000,
      effectiveDiscountPct: 10,
      withinGuardrail: false,
      breachingLines: ["product.we-made-up"],
      disposition: "escalate-to-deal-desk",
      autoApproved: false,
      requiresDealDeskApproval: true
    },
    demonstrates:
      "The Agent Fabric blocking a quote line priced under an off-catalog product (policy.dealdesk.pricing-catalog-sourced)."
  },
  {
    id: "bad-math-block",
    label: "Totals don't add up → governance block",
    hint: "A decision whose net total doesn't match the lines.",
    request: DEMO_QUOTE_REQUEST,
    decision: {
      quoteRef: "quote-001",
      accountRef: "account-northstar-health",
      lines: [
        {
          productId: "product.platform-core",
          productName: "Pause Platform — Core",
          listPrice: 120000,
          quantity: 1,
          proposedDiscountPct: 12,
          maxAutoApproveDiscountPct: 15,
          lineListTotal: 120000,
          lineNetTotal: 105600,
          withinGuardrail: true
        }
      ],
      listTotal: 120000,
      // Wrong: net should be 105,600 — this understates the discount.
      netTotal: 118000,
      discountTotal: 2000,
      effectiveDiscountPct: 1.7,
      withinGuardrail: true,
      breachingLines: [],
      disposition: "auto-approve",
      autoApproved: true,
      requiresDealDeskApproval: false
    },
    demonstrates:
      "The Agent Fabric blocking a quote whose totals don't equal the computed line sums (policy.dealdesk.discount-math-consistent)."
  },
  {
    id: "out-of-guardrail-approved-block",
    label: "Out-of-guardrail auto-approved → governance block",
    hint: "A decision that auto-approves a discount exception.",
    request: DEMO_QUOTE_ESCALATE_REQUEST,
    decision: {
      quoteRef: "quote-002",
      accountRef: "account-cascade-systems",
      lines: [
        {
          productId: "product.platform-core",
          productName: "Pause Platform — Core",
          listPrice: 120000,
          quantity: 2,
          proposedDiscountPct: 25,
          maxAutoApproveDiscountPct: 15,
          lineListTotal: 240000,
          lineNetTotal: 180000,
          withinGuardrail: false
        }
      ],
      listTotal: 240000,
      netTotal: 180000,
      discountTotal: 60000,
      effectiveDiscountPct: 25,
      withinGuardrail: false,
      breachingLines: ["product.platform-core"],
      disposition: "auto-approve",
      // Wrong: auto-approving an out-of-guardrail discount.
      autoApproved: true,
      requiresDealDeskApproval: false
    },
    demonstrates:
      "The Agent Fabric blocking an out-of-guardrail discount marked auto-approved (policy.dealdesk.no-autonomous-out-of-guardrail-approval)."
  }
];

/** Render-ready view of a produced decision lifted from the task. */
export type DealDeskResolvedView = {
  kind: "resolved";
  quoteRef: string;
  accountRef: string;
  lines: PricedLine[];
  listTotal: number;
  netTotal: number;
  effectiveDiscountPct: number;
  withinGuardrail: boolean;
  breachingLines: string[];
  disposition: string;
  autoApproved: boolean;
  requiresDealDeskApproval: boolean;
  reason: string;
  note: string;
  dealDeskCatalogSourced: boolean;
  dealDeskMathConsistent: boolean;
  dealDeskNoAutonomousApproval: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type DealDeskBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type DealDeskInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type DealDeskView =
  | DealDeskResolvedView
  | DealDeskBlockedView
  | DealDeskInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  dealDeskCatalogSourced?: unknown;
  dealDeskMathConsistent?: unknown;
  dealDeskNoAutonomousApproval?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildDealDeskRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: QuoteRequest;
  decision?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.decision !== undefined) data.decision = input.decision;
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
 * POST a quote (or an asserted decision) to the Deal Desk agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runDealDeskTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: QuoteRequest;
    decision?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(DEAL_DESK_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDealDeskRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced decision
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function dealDeskViewFromTask(task: A2ATask): DealDeskView {
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
        "The Agent Fabric blocked this deal-desk run.";
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
        : "The quote decision could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: QuoteDecision; quoteRef?: string } | undefined) ?? undefined;
  const dec = result?.decision;

  return {
    kind: "resolved",
    quoteRef: result?.quoteRef ?? dec?.quoteRef ?? "",
    accountRef: dec?.accountRef ?? "",
    lines: dec?.lines ?? [],
    listTotal: dec?.listTotal ?? 0,
    netTotal: dec?.netTotal ?? 0,
    effectiveDiscountPct: dec?.effectiveDiscountPct ?? 0,
    withinGuardrail: dec?.withinGuardrail ?? false,
    breachingLines: dec?.breachingLines ?? [],
    disposition: dec?.disposition ?? "",
    autoApproved: dec?.autoApproved ?? false,
    requiresDealDeskApproval: dec?.requiresDealDeskApproval ?? false,
    reason: dec?.reason ?? "",
    note: dec?.note ?? "",
    dealDeskCatalogSourced: fabric.dealDeskCatalogSourced === true,
    dealDeskMathConsistent: fabric.dealDeskMathConsistent === true,
    dealDeskNoAutonomousApproval: fabric.dealDeskNoAutonomousApproval === true,
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

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: DealDeskView }
  | { status: "error"; message: string };

export function DealDeskPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: DealDeskPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runDealDeskTask({
          taskId: newTaskId("deal-desk"),
          personaId: "demo",
          request: preset.request,
          decision: preset.decision
        });
        setRunState({ status: "done", view: dealDeskViewFromTask(task) });
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
        Deal desk · quote approval (CPQ) · commercial operations
      </p>
      <h3 style={{ margin: 0 }}>
        Deal Desk — a bounded discount, never an autonomous out-of-guardrail approval
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Pause&rsquo;s <strong>own</strong> go-to-market tooling (no patient PHI). Given a proposed{" "}
        <strong>quote</strong> (line items each a product, list price, quantity, and proposed
        discount %), this agent <strong>deterministically</strong> prices each line, sums the totals,
        computes the effective blended discount, and checks each line&rsquo;s discount against its
        product&rsquo;s <strong>guardrail</strong>. A standard quote <strong>auto-approves</strong>;
        any line over guardrail <strong>escalates to a human deal-desk owner</strong> — it{" "}
        <strong>never</strong> autonomously approves an out-of-guardrail discount.{" "}
        <strong>The product catalog and guardrails are illustrative, not a certified CPQ system.</strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {DEAL_DESK_PRESETS.map((preset) => (
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
              ? "Pricing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Deal-desk run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <DealDeskResult view={runState.view} />}
    </section>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DealDeskResult({ view }: { view: DealDeskView }) {
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

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Quote decision (deterministic, synthetic)
        {view.quoteRef ? ` · ${view.quoteRef}` : ""} · {view.accountRef}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="List" value={money(view.listTotal)} tone="#9db8ff" />{" "}
        <Pill label="Net" value={money(view.netTotal)} tone="#8fd6b0" />{" "}
        <Pill label="Effective discount" value={`${view.effectiveDiscountPct.toFixed(1)}%`} tone="#c9b8ff" />{" "}
        <Pill
          label="Disposition"
          value={view.disposition}
          tone={view.withinGuardrail ? "#8fd6b0" : "#ffd28a"}
        />
      </p>

      {view.lines.length > 0 && (
        <ul
          style={{
            margin: "0.6rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.lines.map((l) => (
            <li key={l.productId} style={{ marginBottom: "0.15rem" }}>
              <span style={{ color: l.withinGuardrail ? "#8fd6b0" : "#ffd28a", fontWeight: 600 }}>
                {l.withinGuardrail ? "within" : "OVER"} guardrail
              </span>{" "}
              · {l.productName} · {l.quantity} × {money(l.listPrice)} · {l.proposedDiscountPct}%
              (max {l.maxAutoApproveDiscountPct}%) → {money(l.lineNetTotal)}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Deal desk compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Catalog sourced · totals add up · never an out-of-guardrail auto-approval{" "}
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
            synthetic · no PHI
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
          dealDeskCatalogSourced = {String(view.dealDeskCatalogSourced)} · dealDeskMathConsistent ={" "}
          {String(view.dealDeskMathConsistent)} · dealDeskNoAutonomousApproval ={" "}
          {String(view.dealDeskNoAutonomousApproval)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
