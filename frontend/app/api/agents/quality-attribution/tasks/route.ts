import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  type PatientAttribution,
  type PatientAttributionContext,
  DEMO_ATTRIBUTION_PANEL,
  attributePanel,
  attributePatient,
  attributionTieBreaksAreDocumented,
  attributionsHonorContractTerms,
  attributionsTraceToCatalog
} from "../../../../../lib/quality-attribution";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "quality-attribution-agent";

/**
 * Google A2A `tasks/send` endpoint for the Quality-Measure Attribution
 * Agent — pairs with the HEDIS & Quality Reporting Agent to decide WHOSE
 * PANEL each patient counts on.
 *
 *   POST /api/agents/quality-attribution/tasks
 *
 * DETERMINISTICALLY attributes each patient in the panel using the
 * methodology catalog, honors the VBC contract's exclusion terms, and
 * applies the documented tie-break chain. Rolls up per-provider counts.
 * A pure function of the panel + asOfDate (no randomness, no clock).
 *
 * Enforced-block policies checked before the report is returned:
 *   - policy.attribution.methodology-catalog-sourced (signal
 *     attributionsTraceToCatalog) — every methodology + contract must be
 *     catalog-sourced.
 *   - policy.attribution.no-conflicting-contract-terms (signal
 *     attributionsHonorContractTerms) — caller may not assert
 *     excludedByContract:false on a patient the contract terms actually
 *     exclude.
 *   - policy.attribution.tie-break-documented (signal
 *     attributionTieBreaksAreDocumented) — every tie-break must be on
 *     the documented list.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { panel?: PatientAttributionContext[],
 *     attributionOverrides?: PatientAttribution[] } — the panel is attributed
 *   deterministically by default; a caller-asserted `attributionOverrides`
 *   set (used to demonstrate the three governance blocks by providing an
 *   off-catalog / dishonest / undocumented attribution).
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("attribution");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const panel = Array.isArray(data.panel)
    ? (data.panel as PatientAttributionContext[])
    : DEMO_ATTRIBUTION_PANEL;

  // Compute the ground-truth attribution deterministically. The caller may
  // provide `attributionOverrides` to demonstrate the three governance blocks
  // (off-catalog / dishonest-exclusion / opaque tie-break). If overrides are
  // provided, they are what the governance gate checks against — the report's
  // actual patients still come from the honest computation.
  const report = attributePanel(panel);

  const overrides = Array.isArray(data.attributionOverrides)
    ? (data.attributionOverrides as PatientAttribution[])
    : undefined;

  const attributionsForCheck = overrides ?? report.patients;

  // For contract-terms honesty, re-check each attribution against the
  // patient's ACTUAL contract terms and compare with the asserted flag.
  const patientByRef = new Map(panel.map((p) => [p.patientRef, p]));
  const contractRows = attributionsForCheck.map((a) => {
    const patient = patientByRef.get(a.patientRef);
    const truth = patient ? attributePatient(patient) : null;
    return {
      assertedExcludedByContract: a.excludedByContract,
      actualExcludedByContract: truth?.excludedByContract ?? a.excludedByContract
    };
  });

  const catalogOk = attributionsTraceToCatalog(attributionsForCheck);
  const contractOk = attributionsHonorContractTerms(contractRows);
  const tieBreakOk = attributionTieBreaksAreDocumented(attributionsForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      attributionsTraceToCatalog: catalogOk,
      attributionsHonorContractTerms: contractOk,
      attributionTieBreaksAreDocumented: tieBreakOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "attribution.attribute.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        panelSize: panel.length,
        attributionsTraceToCatalog: catalogOk,
        attributionsHonorContractTerms: contractOk,
        attributionTieBreaksAreDocumented: tieBreakOk,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this attribution run: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  // Attribute span — records the per-patient attribution.
  const attributeSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "attribution.attribute",
    protocol: "a2a",
    attributes: {
      panelSize: panel.length,
      attributedCount: report.patients.filter((p) => !p.excludedByContract && p.providerRef).length,
      excludedByContractCount: report.patients.filter((p) => p.excludedByContract).length,
      tieBrokenCount: report.patients.filter((p) => p.tieBreakApplied).length,
      unattributableCount: report.unattributableCount,
      attributionsTraceToCatalog: catalogOk,
      attributionsHonorContractTerms: contractOk,
      attributionTieBreaksAreDocumented: tieBreakOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Rollup span — records the per-provider counts.
  const rollupSpan = recordInstantSpan({
    taskId,
    parentSpanId: attributeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "attribution.rollup",
    protocol: "a2a",
    attributes: {
      providerCount: report.perProvider.length,
      contractRef: report.contractRef,
      methodologyId: report.methodologyId,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { report };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Attributed ${panel.length} patient${panel.length === 1 ? "" : "s"} as of ${
          report.asOfDate
        } across ${report.perProvider.length} provider${
          report.perProvider.length === 1 ? "" : "s"
        }: ${report.perProvider.reduce((s, p) => s + p.attributedCount, 0)} in-network attributed, ${report.perProvider.reduce((s, p) => s + p.excludedByContractCount, 0)} excluded by contract terms (dropped from downstream HEDIS denominators), ${report.perProvider.reduce((s, p) => s + p.tieBrokenCount, 0)} tie-broken by documented rules, ${report.unattributableCount} unattributable. Every methodology + contract traces to the catalog; every attribution honors the contract's exclusion terms; every tie-break is documented and deterministic. Synthetic — illustrative catalogs and refs, not a certified CMS Shared Savings / ACO REACH / commercial-VBC attribution engine.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "QualityAttributionReport",
        description:
          "Deterministically-produced quality-measure attribution report — per-patient attribution to a provider / clinic / VBC contract under a defined methodology (plurality-of-visits, PCP-of-record, prospective Medicare Advantage, or contract-defined window), with an excludedByContract flag when the contract terms EXCLUDE the patient (so downstream HEDIS scoring drops it from the denominator), and a documented tie-break trail (most-recent-visit-wins then provider-ref-lexical-ascending) when the primary metric ties; plus a per-provider rollup of attributed / excluded / tie-broken counts, sorted by provider ref ascending for a stable display. The methodology catalog, contract catalog, tie-break rules, and refs are illustrative/synthetic, NOT CMS Shared Savings Program attribution, an ACO REACH prospective assignment, an NCQA HEDIS attribution appendix, or a real payer's VBC contract terms.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: rollupSpan.id,
        traceTaskId: taskId,
        panelSize: panel.length,
        providerCount: report.perProvider.length,
        contractRef: report.contractRef,
        methodologyId: report.methodologyId,
        attributionsTraceToCatalog: catalogOk,
        attributionsHonorContractTerms: contractOk,
        attributionTieBreaksAreDocumented: tieBreakOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
