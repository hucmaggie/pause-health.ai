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
  type CommsChannel,
  type ConsentDecision,
  type ConsentEvent,
  type ConsentLedger,
  type ConsentScope,
  DEMO_CONSENT_LEDGER,
  consentTracesToRecord,
  evaluateConsent,
  honorsRevocation,
  respectsConsentScope
} from "../../../../../lib/consent-management";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "consent-management-agent";

/**
 * Google A2A `tasks/send` endpoint for the Consent & Preferences Management
 * agent — the MuleSoft control-plane / data-substrate consent service, the
 * authoritative consent ledger the rest of the fabric's consent gates defer to.
 *
 *   POST /api/agents/consent-management/tasks
 *
 * Loads a patient's consent LEDGER (a set of consent scopes, each with a status
 * + recorded basis + optional expiry) plus communication PREFERENCES (allowed
 * channels, quiet hours, preferred language, frequency cap), then answers a
 * DETERMINISTIC consent query — "may this patient be contacted / have data used
 * for this scope over this channel at this time?" — via evaluateConsent, citing
 * the consent record it relied on. The decision is a pure function of the ledger
 * + the query's own atTime + priorTouches (no randomness, no clock). The scopes
 * + sources + preferences are illustrative/synthetic, NOT a certified
 * consent-management system.
 *
 * Enforced-block policies checked before any decision is acted on:
 *   - policy.consent.recorded-source (signal consentTracesToRecord) — every
 *     consent state must trace to a recorded consent event/basis (no
 *     asserted-but-unrecorded consent).
 *   - policy.consent.honor-revocation (signal honorsRevocation) — a decision may
 *     never ALLOW against a revoked / expired scope.
 *   - policy.consent.no-scope-override (signal respectsConsentScope) — a decision
 *     may never override a withheld scope or a scope never granted.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { ledger?: ConsentLedger, scope?: ConsentScope, channel?: CommsChannel,
 *     atTime?: string, priorTouches?: number, events?: ConsentEvent[],
 *     decisions?: ConsentDecision[] } — the ledger is evaluated for the query;
 *   caller-asserted `events` (admissible only if every one traces to a recorded
 *   source) demonstrate the recorded-source block, and caller-asserted
 *   `decisions` (admissible only if none allows against a revoked/expired or
 *   withheld/ungranted scope) demonstrate the honor-revocation and
 *   no-scope-override blocks.
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
  const taskId = params.id || newTaskId("consent");
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
  const ledger =
    data.ledger && typeof data.ledger === "object"
      ? (data.ledger as ConsentLedger)
      : DEMO_CONSENT_LEDGER;
  const scope =
    typeof data.scope === "string" ? (data.scope as ConsentScope) : "contact-outreach";
  const channel =
    typeof data.channel === "string" ? (data.channel as CommsChannel) : undefined;
  const atTime =
    typeof data.atTime === "string" ? data.atTime : "2026-03-01T15:00:00Z";
  const priorTouches =
    typeof data.priorTouches === "number" ? data.priorTouches : undefined;

  // Deterministic consent decision for the query.
  const decision = evaluateConsent(ledger, { scope, channel, atTime, priorTouches });

  // The events the recorded-source gate checks: the caller-asserted set (to
  // demonstrate the recorded-source block) or the ledger's own events.
  const assertedEvents = data.events as ConsentEvent[] | undefined;
  const eventsForCheck = Array.isArray(assertedEvents)
    ? assertedEvents
    : ledger.events ?? [];

  // The decisions the honor-revocation / no-scope-override gates check: the
  // caller-asserted set (to demonstrate those blocks) or the produced decision.
  const assertedDecisions = data.decisions as ConsentDecision[] | undefined;
  const decisionsForCheck = Array.isArray(assertedDecisions)
    ? assertedDecisions
    : [decision];

  // Honest governance signals. Every consent state must trace to a recorded
  // basis; a revocation / expiry must be honored; a decision may not override a
  // withheld / ungranted scope.
  const tracesToRecord = consentTracesToRecord(eventsForCheck);
  const honors = honorsRevocation(decisionsForCheck);
  const respectsScope = respectsConsentScope(decisionsForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      consentTracesToRecord: tracesToRecord,
      honorsRevocation: honors,
      respectsConsentScope: respectsScope
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "consent.decision.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        scope,
        channel,
        consentTracesToRecord: tracesToRecord,
        honorsRevocation: honors,
        respectsConsentScope: respectsScope,
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
          `Pause Agent Fabric blocked this consent-management run: ${governance.blockingViolations
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

  // Load-ledger span — the fabric records the ledger it loaded, parented under
  // the caller's span if any.
  const loadSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "consent.load-ledger",
    protocol: "a2a",
    attributes: {
      patientRef: ledger.patientRef,
      recordedScopes: (ledger.events ?? []).length,
      consentTracesToRecord: tracesToRecord,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the fabric records the query it evaluated, parented to the
  // ledger it read from.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: loadSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "consent.evaluate",
    protocol: "a2a",
    attributes: {
      scope,
      channel,
      atTime,
      honorsRevocation: honors,
      respectsConsentScope: respectsScope,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decision span — the fabric records the decision it returned, parented to the
  // evaluation it followed from. It cites the consent record it relied on.
  const decisionSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "consent.decision",
    protocol: "a2a",
    attributes: {
      scope: decision.scope,
      channel: decision.channel,
      allowed: decision.allowed,
      matchedConsentEventId: decision.matchedConsentEventId,
      effectiveStatus: decision.effectiveStatus,
      honorsRevocation: honors,
      respectsConsentScope: respectsScope,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Consent decision for scope "${decision.scope}"${
          decision.channel ? ` over ${decision.channel}` : ""
        }: ${decision.allowed ? "ALLOWED" : "DENIED"} — ${decision.reason}${
          decision.matchedConsentEventId
            ? ` (citing consent record ${decision.matchedConsentEventId})`
            : ""
        }. The authoritative consent ledger is the source of truth the other agents' consent gates defer to; every consent state traces to a recorded basis, a revocation / expiry is honored immediately, and no scope is overridden (synthetic — illustrative scopes + sources + preferences, not a certified consent-management system).`,
        { decision }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "ConsentDecision",
        description:
          "Deterministically-produced consent decision from the authoritative consent ledger — whether a patient may be contacted / have data used for a given scope over a given channel at a given time, citing the consent record it relied on. Denies a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch, or a frequency-cap breach; otherwise allows. Every consent state traces to a recorded basis, a revocation / expiry is honored immediately, and a decision never overrides a scope. The scopes + recorded sources + preferences + patientRef are illustrative/synthetic, NOT a certified consent-management system.",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              decision,
              ledger: {
                patientRef: ledger.patientRef,
                events: ledger.events,
                preferences: ledger.preferences,
                synthetic: true
              }
            } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: decisionSpan.id,
        traceTaskId: taskId,
        consentAllowed: decision.allowed,
        matchedConsentEventId: decision.matchedConsentEventId,
        consentTracesToRecord: tracesToRecord,
        honorsRevocation: honors,
        respectsConsentScope: respectsScope
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
