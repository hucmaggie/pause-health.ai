/**
 * Pause Agent Fabric -- in-memory mock of the MuleSoft Agent Fabric
 * control plane.
 *
 * What MuleSoft Agent Fabric provides in production (announced
 * Dreamforce 2025, GA early 2026):
 *
 *   1. Agent registry -- discoverable catalog of every agent operating
 *      on the customer's Anypoint Platform (Agentforce Service Agents,
 *      partner LLM agents, MCP servers, A2A-speaking agents).
 *   2. Policy enforcement -- per-agent governance (model allow-list,
 *      PHI handling, rate limits, data residency, identity).
 *   3. Observability -- end-to-end trace correlation across agents,
 *      with each tool call and A2A handoff recorded as a span.
 *   4. Security -- identity-based access control between agents,
 *      OAuth / mTLS, secret vault.
 *
 * The prototype mocks (1), (2), and (3) with deterministic in-memory
 * state. (4) is documented in the investor page but not enforced --
 * the prototype is open by default.
 *
 * Persistence model:
 *   The trace ring buffer lives in a module-scoped global so it
 *   survives Next.js dev-mode hot reload AND every API route in the
 *   same Node process sees the same state. In production this becomes
 *   a Redis-backed log shipped to the customer's observability stack.
 */

import { nowIso } from "./a2a";
import { emitSpanEvent } from "./salesforce-platform-event-sink";

export type AgentRecord = {
  id: string;
  name: string;
  kind:
    | "agentforce"
    | "anthropic-claude"
    | "mcp-server"
    | "mulesoft-process"
    | "salesforce-data-360";
  protocol: "a2a" | "mcp" | "rest";
  endpoint: string;
  version: string;
  status: "healthy" | "degraded" | "offline" | "prototype";
  capabilities: string[];
  policies: string[];
  provider: string;
  governanceTier:
    | "patient-facing"
    | "clinical-decision"
    | "data-plane"
    | "integration"
    | "data-grounding";
};

export type PolicyRecord = {
  id: string;
  name: string;
  description: string;
  appliesTo: string[];
  enforcement: "block" | "audit" | "rate-limit" | "redact";
  status: "enforced" | "advisory" | "draft";
};

export type TraceSpan = {
  id: string;
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  agentName: string;
  operation: string;
  protocol: "a2a" | "mcp" | "rest" | "internal";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "ok" | "error" | "in-progress";
  attributes?: Record<string, unknown>;
};

/**
 * Agent seed — everything about an agent EXCEPT its governance policy set.
 *
 * An agent's policies are NOT hand-listed here. They are derived from the
 * single source of truth, `POLICIES[].appliesTo`, via getPoliciesForAgent().
 * Maintaining a second per-agent copy drifted badly: it under-listed several
 * agents (e.g. the Care Router omitted the consent, red-flag, and HIPAA-audit
 * policies it actually enforces) and even referenced a policy id that doesn't
 * exist. listAgents()/getAgent() now attach the derived list so the registry,
 * the Agent Card, and the governance engine can never disagree.
 */
type AgentSeed = Omit<AgentRecord, "policies">;

const REGISTRY: AgentSeed[] = [
  {
    id: "agentforce-intake",
    name: "Agentforce Service Agent · Patient Intake",
    kind: "agentforce",
    protocol: "a2a",
    endpoint: "salesforce://agentforce/pause-intake@v2",
    version: "2.1.0",
    status: "prototype",
    capabilities: [
      "Symptom capture (vasomotor, sleep, mood, cognition, GSM, bleeding)",
      "Red-flag screening",
      "Structured intake record persistence",
      "Hands captured task off to Care Router via Google A2A"
    ],
    provider: "Salesforce",
    governanceTier: "patient-facing"
  },
  {
    id: "care-router-claude",
    name: "Pause Care Router · Claude Sonnet 4.5",
    kind: "anthropic-claude",
    protocol: "a2a",
    endpoint: "/api/agents/care-router",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "Clinical pathway routing (6 pathways)",
      "Red-flag escalation logic",
      "Premature ovarian insufficiency rule (<40 with menopause symptoms)",
      "Returns rationale + provenance with every decision"
    ],
    provider: "Anthropic + Pause-Health.ai",
    governanceTier: "clinical-decision"
  },
  {
    id: "pause-mcp",
    name: "Pause MCP Server",
    kind: "mcp-server",
    protocol: "mcp",
    endpoint: "@pause-health/mcp via stdio",
    version: "0.1.0",
    status: "prototype",
    capabilities: [
      "get_patient_timeline (FHIR R5 Bundle)",
      "get_patient_intake (structured Agentforce record)",
      "find_menopause_providers (provider graph slice)",
      "experience_api_health (liveness)"
    ],
    provider: "Pause-Health.ai",
    governanceTier: "data-plane"
  },
  {
    id: "mulesoft-ingest",
    name: "MuleSoft Process API · pause-ingest-process-api",
    kind: "mulesoft-process",
    protocol: "rest",
    endpoint: "https://anypoint.example.com/pause-ingest/v1",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Validates Open mHealth payloads",
      "Transforms OMH -> FHIR R5 via DataWeave",
      "POSTs to JupyterHealth Exchange",
      "Triggers DBDP feature compute"
    ],
    provider: "MuleSoft Anypoint",
    governanceTier: "integration"
  },
  {
    id: "salesforce-data-360",
    name: "Salesforce Data 360 · Unified Patient Grounding",
    kind: "salesforce-data-360",
    protocol: "rest",
    endpoint: "/api/data-360",
    version: "1.0.0",
    status: "prototype",
    capabilities: [
      "Zero-copy federated query across JupyterHealth FHIR, DBDP features, Agentforce intake history, and the customer EHR-of-record",
      "Calculated Insights (30-day HRV z-score, vasomotor burden index, sleep disruption, days since MSCP contact)",
      "Identity Resolution with confidence scoring across federated sources",
      "Population Segments activated to Agentforce, the Agent Fabric, and Health Cloud"
    ],
    provider: "Salesforce",
    governanceTier: "data-grounding"
  }
];

const POLICIES: PolicyRecord[] = [
  {
    id: "policy.phi.no-free-text-pii",
    name: "No free-text PII in intake",
    description:
      "Patient-facing intake agents may not capture or persist free-text PII (full names, SSNs, addresses). Structured fields only.",
    appliesTo: ["agentforce-intake"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.intake.red-flag-mandatory",
    name: "Red-flag screen is non-optional",
    description:
      "Every intake task must include the standardized red-flag screening question. Tasks without it are rejected by the Care Router.",
    appliesTo: ["agentforce-intake", "care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.audit.hipaa-log-every-turn",
    name: "HIPAA audit log",
    description:
      "Every agent turn is logged with a tamper-evident correlation id. Logs are exported to the customer's SIEM via MuleSoft.",
    appliesTo: [
      "agentforce-intake",
      "care-router-claude",
      "pause-mcp",
      "mulesoft-ingest",
      "salesforce-data-360"
    ],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.model.anthropic-claude-sonnet-allowlisted",
    name: "Model allow-list",
    description:
      "Only models on the customer's approved list may serve clinical-decision agents. Default allow-list: claude-sonnet-4-5, claude-opus-4-7. Other models are blocked at policy evaluation time.",
    appliesTo: ["care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.no-prescribing",
    name: "No autonomous prescribing",
    description:
      "Clinical-decision agents may recommend pathways but may not write prescriptions, order labs, or commit clinical actions without a human-in-the-loop clinician.",
    appliesTo: ["care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.clinical.rationale-required",
    name: "Rationale required on every decision",
    description:
      "Every routing decision must include human-readable rationale. Decisions without rationale are rejected and re-issued to the model.",
    appliesTo: ["care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.fallback.deterministic-on-api-failure",
    name: "Deterministic fallback on model failure",
    description:
      "If the model API is unreachable or returns malformed output, the Care Router falls back to the deterministic Pause policy engine. Provenance always records which path served the decision.",
    appliesTo: ["care-router-claude"],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.mcp.tools-allowlisted",
    name: "MCP tool allow-list",
    description:
      "Only the four declared Pause MCP tools are callable. Any other tool invocation is rejected at the MCP server boundary.",
    appliesTo: ["pause-mcp"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.phi.bearer-token-required-in-prod",
    name: "Bearer token required in production",
    description:
      "Production MCP calls must carry PAUSE_MCP_API_KEY tied to the customer's OAuth provider. The prototype is open by default; production deployments enforce this at the MuleSoft API gateway.",
    appliesTo: ["pause-mcp", "mulesoft-ingest"],
    enforcement: "block",
    status: "advisory"
  },
  {
    id: "policy.audit.return-mulesoft-correlation-id",
    name: "Correlation id round-trip",
    description:
      "Every MCP and MuleSoft API response carries a correlation id that is propagated into the A2A trace.",
    appliesTo: ["pause-mcp", "mulesoft-ingest"],
    enforcement: "audit",
    status: "enforced"
  },
  {
    id: "policy.network.mtls-required",
    name: "mTLS for system-to-system",
    description:
      "All Process / Experience API calls inside MuleSoft require mTLS. Enforced at the Anypoint API gateway.",
    appliesTo: ["mulesoft-ingest"],
    enforcement: "block",
    status: "advisory"
  },
  {
    id: "policy.data.fhir-r5-only",
    name: "FHIR R5 substrate",
    description:
      "Clinical data crossing MuleSoft Process / Experience tiers must be FHIR R5. Non-conforming payloads are rejected.",
    appliesTo: ["mulesoft-ingest", "pause-mcp"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.zero-copy-federation",
    name: "Zero-copy federation only",
    description:
      "Data 360 must federate into JupyterHealth, the customer's EHR, and the DBDP feature store via the Federation / Iceberg connector. Bulk ingestion of PHI into Salesforce is disallowed.",
    appliesTo: ["salesforce-data-360"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.consent-required-before-grounding",
    name: "Consent required before grounding",
    description:
      "Care Router grounding calls must be accompanied by an active 'ai-decision-support' consent in the patient's Data 360 consent ledger. Calls without consent are rejected with a redaction.",
    appliesTo: ["salesforce-data-360", "care-router-claude"],
    enforcement: "block",
    status: "enforced"
  },
  {
    id: "policy.data360.segment-activation-allowlist",
    name: "Segment activation allow-list",
    description:
      "Data 360 segments may activate only to the customer's approved downstream channels (Agentforce, Agent Fabric, Health Cloud, Marketing Cloud). Activations to unapproved channels are blocked.",
    appliesTo: ["salesforce-data-360"],
    enforcement: "block",
    status: "enforced"
  }
];

const TRACE_RING_CAP = 200;

type FabricStore = {
  traces: TraceSpan[];
};

const globalKey = "__pause_agent_fabric_store__" as const;
type GlobalWithStore = typeof globalThis & {
  [globalKey]?: FabricStore;
};

function store(): FabricStore {
  const g = globalThis as GlobalWithStore;
  if (!g[globalKey]) g[globalKey] = { traces: [] };
  return g[globalKey]!;
}

// Seed the ring buffer with one historical trace so the console isn't
// empty on first load. Real customer deployments would populate this
// from the persistent log store.
(function seedHistoricalTrace() {
  const s = store();
  if (s.traces.length > 0) return;
  const t0 = Date.now() - 1000 * 60 * 4;
  const taskId = "task-seed-historical-001";
  s.traces.push(
    {
      id: "span-seed-001",
      taskId,
      agentId: "agentforce-intake",
      agentName: "Agentforce Service Agent · Patient Intake",
      operation: "intake.complete",
      protocol: "rest",
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date(t0 + 1820).toISOString(),
      durationMs: 1820,
      status: "ok",
      attributes: { capturedFields: 6, redFlag: false }
    },
    {
      id: "span-seed-002",
      taskId,
      parentSpanId: "span-seed-001",
      agentId: "care-router-claude",
      agentName: "Pause Care Router · Claude Sonnet 4.5",
      operation: "a2a.tasks/send",
      protocol: "a2a",
      startedAt: new Date(t0 + 1820).toISOString(),
      finishedAt: new Date(t0 + 4140).toISOString(),
      durationMs: 2320,
      status: "ok",
      attributes: {
        pathway: "mscp-virtual-visit",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        policiesEvaluated: 4
      }
    },
    {
      id: "span-seed-003",
      taskId,
      parentSpanId: "span-seed-002",
      agentId: "pause-mcp",
      agentName: "Pause MCP Server",
      operation: "mcp.get_patient_timeline",
      protocol: "mcp",
      startedAt: new Date(t0 + 4140).toISOString(),
      finishedAt: new Date(t0 + 4490).toISOString(),
      durationMs: 350,
      status: "ok",
      attributes: { entries: 5, mulesoftCorrelationId: "mule-corr-9d3b2a" }
    }
  );
})();

/**
 * Attach an agent's governance policy ids, derived from the policy catalog's
 * appliesTo membership. This is the ONLY place the per-agent policy list is
 * produced, so it always matches what evaluateGovernance() enforces and what
 * the Agent Card advertises.
 */
function withPolicies(seed: AgentSeed): AgentRecord {
  return { ...seed, policies: getPoliciesForAgent(seed.id).map((p) => p.id) };
}

export function listAgents(): AgentRecord[] {
  return REGISTRY.map(withPolicies);
}

export function getAgent(id: string): AgentRecord | undefined {
  const seed = REGISTRY.find((a) => a.id === id);
  return seed ? withPolicies(seed) : undefined;
}

export function listPolicies(): PolicyRecord[] {
  return POLICIES.slice();
}

export function getPoliciesForAgent(agentId: string): PolicyRecord[] {
  return POLICIES.filter((p) => p.appliesTo.includes(agentId));
}

export function recordSpan(span: Omit<TraceSpan, "id">): TraceSpan {
  const id = `span-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const finalSpan: TraceSpan = { ...span, id };
  const s = store();
  s.traces.push(finalSpan);
  if (s.traces.length > TRACE_RING_CAP) {
    s.traces.splice(0, s.traces.length - TRACE_RING_CAP);
  }
  // Best-effort Salesforce Platform Event egress. emitSpanEvent
  // never throws and short-circuits to "skipped" when unconfigured,
  // so the agent fabric is unchanged in the default (designed)
  // posture. We intentionally don't await — telemetry must not
  // delay the routing decision the span describes.
  void emitSpanEvent(finalSpan);
  return finalSpan;
}

export function listTraces(opts: { taskId?: string; limit?: number } = {}): TraceSpan[] {
  const s = store();
  let rows = s.traces.slice();
  if (opts.taskId) rows = rows.filter((t) => t.taskId === opts.taskId);
  rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (opts.limit && opts.limit > 0) rows = rows.slice(-opts.limit);
  return rows;
}

export function listRecentTaskIds(limit = 10): string[] {
  const s = store();
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = s.traces.length - 1; i >= 0 && ids.length < limit; i--) {
    const t = s.traces[i];
    if (!seen.has(t.taskId)) {
      seen.add(t.taskId);
      ids.push(t.taskId);
    }
  }
  return ids;
}

/**
 * Pre-flight governance gate. Called by the Care Router before it
 * accepts an A2A task. Returns the list of policies that apply, and
 * whether any "block" policies are unsatisfied by the incoming task.
 */
export function evaluateGovernance(opts: {
  agentId: string;
  task: {
    hasRedFlagScreen?: boolean;
    requestedModel?: string;
    hasRationaleField?: boolean;
  };
}): {
  appliesPolicies: PolicyRecord[];
  blockingViolations: { policyId: string; reason: string }[];
  decision: "allow" | "block";
} {
  const policies = getPoliciesForAgent(opts.agentId);
  const blockingViolations: { policyId: string; reason: string }[] = [];

  for (const p of policies) {
    if (p.status !== "enforced" || p.enforcement !== "block") continue;
    if (
      p.id === "policy.intake.red-flag-mandatory" &&
      opts.task.hasRedFlagScreen === false
    ) {
      blockingViolations.push({
        policyId: p.id,
        reason: "Task did not include a red-flag screen field"
      });
    }
    if (
      p.id === "policy.model.anthropic-claude-sonnet-allowlisted" &&
      opts.task.requestedModel &&
      !/^claude-(sonnet|opus)-/i.test(opts.task.requestedModel)
    ) {
      blockingViolations.push({
        policyId: p.id,
        reason: `Requested model "${opts.task.requestedModel}" is not on the approved list`
      });
    }
    // Mirrors the red-flag check: block only when the signal is
    // explicitly false, never when it's absent, so partial fixtures
    // (and the /demo "Run test case" form) don't trip the gate just by
    // omitting the field. This makes policy.clinical.rationale-required
    // actually enforceable -- hasRationaleField was previously accepted
    // by the API + type but never evaluated, so an "enforced" block
    // policy could not fire.
    if (
      p.id === "policy.clinical.rationale-required" &&
      opts.task.hasRationaleField === false
    ) {
      blockingViolations.push({
        policyId: p.id,
        reason:
          "Task did not carry a rationale field; every routing decision must include human-readable rationale"
      });
    }
  }

  return {
    appliesPolicies: policies,
    blockingViolations,
    decision: blockingViolations.length > 0 ? "block" : "allow"
  };
}

/**
 * Convenience helper for API routes -- captures a span with the
 * current wall-clock as both start and end. Use the lower-level
 * recordSpan() when measuring real durations.
 */
export function recordInstantSpan(args: {
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  operation: string;
  protocol: TraceSpan["protocol"];
  status?: TraceSpan["status"];
  attributes?: Record<string, unknown>;
}): TraceSpan {
  const agent = getAgent(args.agentId);
  return recordSpan({
    taskId: args.taskId,
    parentSpanId: args.parentSpanId,
    agentId: args.agentId,
    agentName: agent?.name ?? args.agentId,
    operation: args.operation,
    protocol: args.protocol,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    durationMs: 0,
    status: args.status ?? "ok",
    attributes: args.attributes
  });
}
