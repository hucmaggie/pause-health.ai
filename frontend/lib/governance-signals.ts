/**
 * Single source of truth for the governance pre-flight's task signals.
 *
 * This module is intentionally dependency-free (no registry, no trace store)
 * so it can be imported by BOTH the server-side evaluator in agent-fabric.ts
 * AND the client-side "Governance pre-flight" panel on /demo/agent-fabric
 * without dragging the whole in-memory fabric into the browser bundle.
 *
 * The evaluator builds its block checks from BOOLEAN_BLOCK_SIGNALS, and the UI
 * builds its toggles from the same list, so the two can never advertise a
 * different set of signals than the gate actually evaluates.
 */

/**
 * The signals a caller can present about an inbound task. Every field is
 * optional and, by convention, a policy fires ONLY when its signal is
 * explicitly present and violating -- never when the signal is absent -- so
 * partial fixtures (and the /demo evaluator form) don't trip a gate merely by
 * omitting a field.
 */
export type GovernanceTask = {
  // Patient-facing intake (data plane)
  containsFreeTextPii?: boolean;
  // Care Router (clinical decision)
  hasRedFlagScreen?: boolean;
  requestedModel?: string;
  hasRationaleField?: boolean;
  commitsClinicalActionWithoutClinician?: boolean;
  // Integration / data substrate (Pause MCP, MuleSoft)
  usesUnlistedMcpTool?: boolean;
  payloadIsFhirR5?: boolean;
  // MCP Bridge (A2A ↔ MCP egress host)
  connectsToAllowlistedRemote?: boolean;
  forwardsBearerCrossOrigin?: boolean;
  // Data 360 grounding & activation
  bulkIngestsPhi?: boolean;
  hasAiDecisionSupportConsent?: boolean;
  segmentActivationChannelAllowlisted?: boolean;
  // Patient-lifecycle acquisition/engagement (prospecting, engagement, inbound)
  hasContactConsent?: boolean;
  autonomousSend?: boolean;
  respectsQuietHoursAndChannel?: boolean;
  hasLeadOptInAndSource?: boolean;
  identityResolved?: boolean;
  // Qualification
  usesProtectedClassCriteria?: boolean;
  // Commercial plane (pipeline, account management)
  accessesPhi?: boolean;
  forecastSourcedFromCrm?: boolean;
  commitsContractChangeWithoutHumanOwner?: boolean;
};

/** The boolean-valued keys of GovernanceTask (everything but requestedModel). */
export type BooleanSignalKey = {
  [K in keyof GovernanceTask]-?: GovernanceTask[K] extends boolean | undefined
    ? K
    : never;
}[keyof GovernanceTask];

export type BooleanBlockSignal = {
  policyId: string;
  signal: BooleanSignalKey;
  /** The boolean value that constitutes a violation of the policy. */
  violatingValue: boolean;
  /** Short, human description of what the violating state looks like. */
  violationHint: string;
  /** Reason surfaced on the blockingViolations list when it fires. */
  reason: string;
};

/**
 * Every enforced-block policy whose check is a simple boolean signal. The one
 * exception -- policy.model.anthropic-claude-sonnet-allowlisted -- is a
 * string+regex check handled specially in the evaluator and UI.
 */
export const MODEL_ALLOWLIST_POLICY_ID =
  "policy.model.anthropic-claude-sonnet-allowlisted";

export const BOOLEAN_BLOCK_SIGNALS: BooleanBlockSignal[] = [
  {
    policyId: "policy.phi.no-free-text-pii",
    signal: "containsFreeTextPii",
    violatingValue: true,
    violationHint: "Intake payload carries free-text PII",
    reason:
      "Intake payload carried free-text PII; only structured fields are permitted"
  },
  {
    policyId: "policy.intake.red-flag-mandatory",
    signal: "hasRedFlagScreen",
    violatingValue: false,
    violationHint: "Task omits the red-flag screen field",
    reason: "Task did not include a red-flag screen field"
  },
  {
    policyId: "policy.clinical.rationale-required",
    signal: "hasRationaleField",
    violatingValue: false,
    violationHint: "Routing decision carries no rationale",
    reason:
      "Task did not carry a rationale field; every routing decision must include human-readable rationale"
  },
  {
    policyId: "policy.clinical.no-prescribing",
    signal: "commitsClinicalActionWithoutClinician",
    violatingValue: true,
    violationHint: "Commits a clinical action without a clinician",
    reason:
      "Attempted to write a prescription/order or commit a clinical action without a human clinician"
  },
  {
    policyId: "policy.mcp.tools-allowlisted",
    signal: "usesUnlistedMcpTool",
    violatingValue: true,
    violationHint: "Invokes an MCP tool outside the allow-list",
    reason: "Invoked an MCP tool outside the declared Pause tool allow-list"
  },
  {
    policyId: "policy.data.fhir-r5-only",
    signal: "payloadIsFhirR5",
    violatingValue: false,
    violationHint: "Clinical payload is not FHIR R5",
    reason: "Clinical payload crossing the MuleSoft tiers was not FHIR R5"
  },
  {
    policyId: "policy.mcp-bridge.remote-allowlist",
    signal: "connectsToAllowlistedRemote",
    violatingValue: false,
    violationHint: "Connects to an unlisted MCP remote",
    reason:
      "MCP Bridge attempted to connect to a remote that is neither the loopback nor in PAUSE_MCP_HOST_REMOTES"
  },
  {
    policyId: "policy.mcp-bridge.tool-allowlist",
    signal: "usesUnlistedMcpTool",
    violatingValue: true,
    violationHint: "Invokes an unlisted tool through the bridge",
    reason: "MCP Bridge invoked a tool outside the declared Pause allow-list"
  },
  {
    policyId: "policy.mcp-bridge.no-cross-origin-bearer",
    signal: "forwardsBearerCrossOrigin",
    violatingValue: true,
    violationHint: "Forwards a bearer to a cross-origin remote",
    reason:
      "MCP Bridge attempted to forward an inbound bearer token to a cross-origin external MCP server"
  },
  {
    policyId: "policy.data360.zero-copy-federation",
    signal: "bulkIngestsPhi",
    violatingValue: true,
    violationHint: "Bulk-ingests PHI into Salesforce",
    reason:
      "Attempted a bulk PHI ingestion into Salesforce instead of zero-copy federation"
  },
  {
    policyId: "policy.data360.consent-required-before-grounding",
    signal: "hasAiDecisionSupportConsent",
    violatingValue: false,
    violationHint: "Grounds without an ai-decision-support consent",
    reason:
      "Grounding call lacked an active 'ai-decision-support' consent in the Data 360 consent ledger"
  },
  {
    policyId: "policy.data360.segment-activation-allowlist",
    signal: "segmentActivationChannelAllowlisted",
    violatingValue: false,
    violationHint: "Activates a segment to an off-allowlist channel",
    reason:
      "Segment activation targeted a channel outside the approved downstream allow-list"
  },
  {
    policyId: "policy.qualification.rationale-required",
    signal: "hasRationaleField",
    violatingValue: false,
    violationHint: "Qualification decision carries no rationale",
    reason: "Qualification decision did not carry a human-readable rationale"
  },
  {
    policyId: "policy.qualification.no-protected-class-criteria",
    signal: "usesProtectedClassCriteria",
    violatingValue: true,
    violationHint: "Uses a protected-class attribute as a criterion",
    reason: "Qualification used a protected-class attribute as a criterion"
  },
  {
    policyId: "policy.marketing.consent-to-contact-required",
    signal: "hasContactConsent",
    violatingValue: false,
    violationHint: "Contacts a target without an active consent",
    reason: "Target lacks an active contact consent in the Data 360 consent ledger"
  },
  {
    policyId: "policy.marketing.human-approval-before-send",
    signal: "autonomousSend",
    violatingValue: true,
    violationHint: "Sends a message without human approval",
    reason: "Attempted to send a prospect/patient message without human approval"
  },
  {
    policyId: "policy.engagement.quiet-hours-and-channel-preference",
    signal: "respectsQuietHoursAndChannel",
    violatingValue: false,
    violationHint: "Touches outside quiet-hours / unpreferred channel",
    reason:
      "Engagement touch fell outside quiet-hours or used a channel the patient didn't opt into"
  },
  {
    policyId: "policy.lead.explicit-optin-and-source-required",
    signal: "hasLeadOptInAndSource",
    violatingValue: false,
    violationHint: "Lead lacks an explicit opt-in and/or source",
    reason:
      "Inbound lead lacked an explicit opt-in and/or a recorded acquisition source"
  },
  {
    policyId: "policy.lead.identity-resolution-before-create",
    signal: "identityResolved",
    violatingValue: false,
    violationHint: "Creates a lead before identity resolution",
    reason:
      "Inbound lead was not resolved against Data 360 Identity Resolution before creation"
  },
  {
    policyId: "policy.commercial.no-phi-in-commercial-plane",
    signal: "accessesPhi",
    violatingValue: true,
    violationHint: "Commercial agent reads patient PHI",
    reason: "Commercial-plane agent attempted to read patient PHI"
  },
  {
    policyId: "policy.commercial.forecast-integrity",
    signal: "forecastSourcedFromCrm",
    violatingValue: false,
    violationHint: "Forecast not sourced from CRM records",
    reason: "Forecast figures were not sourced from CRM opportunity records"
  },
  {
    policyId: "policy.commercial.human-owner-before-contract-change",
    signal: "commitsContractChangeWithoutHumanOwner",
    violatingValue: true,
    violationHint: "Changes a contract without a human owner",
    reason: "Attempted a contract/pricing change without a human account owner"
  }
];
