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
  type ProviderVerificationRequest,
  DEMO_VERIFIED_PROVIDER,
  credentialsTraceToVerifiedSource,
  directoryIsFresh,
  noReferralToExpiredOrSanctioned,
  verifyProvider
} from "../../../../../lib/provider-credentialing";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "provider-credentialing-agent";

/**
 * Google A2A `tasks/send` endpoint for the Provider Credentialing &
 * Directory agent — a network-integrity agent that verifies a provider's
 * credentialing status against approved sources, maintains the directory
 * profile, and gates every referral / scheduling attempt at the network
 * boundary.
 *
 *   POST /api/agents/provider-credentialing/tasks
 *
 * DETERMINISTICALLY verifies the provider (verified / incomplete / expired
 * / sanctioned), computes the No-Surprises-Act directory-freshness flag,
 * and emits gate flags (canReferPatient / canBookAppointment /
 * canReturnInDirectoryResponse) other agents can consult. A pure function
 * of the credentials + directory profile + asOfDate (no clock).
 *
 * The governance gate ALWAYS enforces source-integrity; it enforces
 * no-referral-to-expired-or-sanctioned when the caller's intent is
 * `referral` or `scheduling`; and it enforces NSA freshness when the
 * intent is `directory-lookup`. A block returns HTTP 200 with a `failed`
 * task.
 *
 * Input (data part):
 *   { request?: ProviderVerificationRequest } — the caller passes the
 *   provider's credential records + directory profile + asOfDate + intent;
 *   the agent verifies deterministically and returns the record + gates.
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
  const taskId = params.id || newTaskId("credentialing");
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
  const request =
    data.request && typeof data.request === "object"
      ? (data.request as ProviderVerificationRequest)
      : DEMO_VERIFIED_PROVIDER;

  // Deterministic verification.
  const record = verifyProvider(request);

  // Honest governance signals.
  const sourceIntegrity = credentialsTraceToVerifiedSource(record.credentials);
  const referralOk = noReferralToExpiredOrSanctioned({
    status: record.status,
    sanctioned: record.sanctioned
  });
  const dirFresh = directoryIsFresh({
    verifiedAsOf: record.directoryProfile.verifiedAsOf,
    asOfDate: record.asOfDate
  });

  // Intent-aware enforcement: only report the referral / scheduling gate to
  // the fabric when the caller's intent is `referral` or `scheduling`, and
  // only the NSA gate for `directory-lookup`. Source-integrity always applies.
  const intent = request.intent ?? "directory-lookup";
  const gateReferral = intent === "referral" || intent === "scheduling";
  const gateDirectory = intent === "directory-lookup";

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      credentialsTraceToVerifiedSource: sourceIntegrity,
      // A "true" here means the check is trivially satisfied (nothing to enforce
      // for this intent), so the boolean-block signal does NOT fire.
      noReferralToExpiredOrSanctioned: gateReferral ? referralOk : true,
      directoryIsFresh: gateDirectory ? dirFresh : true
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "credentialing.verify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        providerRef: request.providerRef,
        intent,
        credentialsTraceToVerifiedSource: sourceIntegrity,
        noReferralToExpiredOrSanctioned: referralOk,
        directoryIsFresh: dirFresh,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        // This agent DOES touch patient-adjacent context (a provider's status
        // is required to safely refer a patient), so we log audit-safe.
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
          `Pause Agent Fabric blocked this credentialing check: ${governance.blockingViolations
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

  // Verify span — records the classification + gate flags.
  const verifySpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "credentialing.verify",
    protocol: "a2a",
    attributes: {
      providerRef: request.providerRef,
      asOfDate: request.asOfDate,
      intent,
      status: record.status,
      sanctioned: record.sanctioned,
      canReferPatient: record.gates.canReferPatient,
      canBookAppointment: record.gates.canBookAppointment,
      canReturnInDirectoryResponse: record.gates.canReturnInDirectoryResponse,
      credentialsTraceToVerifiedSource: sourceIntegrity,
      noReferralToExpiredOrSanctioned: referralOk,
      directoryIsFresh: dirFresh,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { record };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Verified provider ${record.providerRef} as of ${record.asOfDate}: status ${record.status}${
          record.sanctioned ? " (SANCTIONED)" : ""
        }; directory record ${record.directoryProfile.isFresh ? "fresh" : "stale"} (${record.directoryProfile.daysSinceVerified}d since verifiedAsOf); gates canReferPatient=${record.gates.canReferPatient}, canBookAppointment=${record.gates.canBookAppointment}, canReturnInDirectoryResponse=${record.gates.canReturnInDirectoryResponse}. Every credential traces to an approved source; the fabric never hands a referral or booking to an expired / incomplete / sanctioned provider; a directory response outside the NSA freshness window is not returned as authoritative. Synthetic — illustrative catalog, sources, and NSA window, not a certified credentialing or directory system.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "ProviderCredentialingRecord",
        description:
          "Deterministically-verified provider credentialing record — the credential-by-credential state (state license, DEA, board cert, sanctions clearance, NPI, each with an approved verification source, verifiedOn, expiresOn, isExpired, daysUntilExpiry), the directory-side profile with a No-Surprises-Act freshness flag, an overall status (verified / incomplete / expired / sanctioned) with sanctioned taking highest precedence, and referral / scheduling / directory-response gate flags the Referral Management, Appointment Scheduling, and Transitions of Care agents can consult before handing off. The catalog, verification sources, NSA window, and directory schema are illustrative/synthetic, NOT NCQA / CAQH credentialing or a real state-medical-board / OIG-LEIE feed.",
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
        traceSpanId: verifySpan.id,
        traceTaskId: taskId,
        providerRef: request.providerRef,
        asOfDate: request.asOfDate,
        intent,
        status: record.status,
        sanctioned: record.sanctioned,
        canReferPatient: record.gates.canReferPatient,
        canBookAppointment: record.gates.canBookAppointment,
        canReturnInDirectoryResponse: record.gates.canReturnInDirectoryResponse,
        credentialsTraceToVerifiedSource: sourceIntegrity,
        noReferralToExpiredOrSanctioned: referralOk,
        directoryIsFresh: dirFresh
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
