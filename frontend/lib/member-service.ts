/**
 * Member Service / Billing — synthetic claim/EOB self-service.
 *
 * Deterministic, dependency-free domain core the Member Service / Billing Agent
 * (app/api/agents/member-service) wraps — the Salesforce "Agentforce for Health"
 * Claims & Coverage / patient-service analog on Pause's Agent Fabric. It answers
 * a member's BILLING & COVERAGE self-service questions — claim status, copay /
 * patient responsibility, outstanding balance, and EOB explanation — grounded on
 * a set of synthetic claim/EOB records, and routes to a human member-services
 * specialist (with full billing context) when the request is out of scope.
 *
 *   Inbound:  a free-text billing question (+ a synthetic member id)
 *   Outbound: a BillingAnswer — a structured answer that ALWAYS cites the
 *             specific ClaimRecord(s) it derived from (a `source` + `citedClaims`
 *             block, synthetic:true) plus a `routeToHuman` escalation path with a
 *             PII-safe context bundle when the intent is out of scope
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY: a billing answer must trace to a claim record.
 * ─────────────────────────────────────────────────────────────────────
 *  A billing / claim answer must trace to a synthetic claim/EOB record — the
 *  agent may NOT fabricate claim data. This module encodes that: every in-scope
 *  answerBillingQuestion() answer carries the ClaimRecord(s) it derived from in
 *  `citedClaims`, and answerTracesToClaim() reports the honest signal the Agent
 *  Fabric enforces via policy.billing.claim-data-sourced (a caller-asserted
 *  billing answer with no cited claim → false → blocked). A route-to-human
 *  handoff asserts no billing figure, so it is honestly source-clean.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a real claims / 835-ERA / payer system.
 * ─────────────────────────────────────────────────────────────────────
 *  The claim/EOB records are DETERMINISTIC synthetic values derived by hashing
 *  the member/claim key (FNV-1a) into realistic figures — no randomness, no
 *  clock, no network call, no real 835-ERA remittance or FHIR ExplanationOf
 *  Benefit. Because generation is deterministic on its inputs, a given member
 *  always produces the same claims and a given question always answers
 *  identically — which is what lets the demo, the seeded trace, and the tests
 *  agree. It is intentionally scoped to BILLING / COVERAGE self-service so it
 *  stays distinct from the patient-engagement agents.
 */

/** The lifecycle a synthetic claim can be in. */
export type ClaimStatus = "submitted" | "adjudicated" | "paid" | "denied";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "submitted",
  "adjudicated",
  "paid",
  "denied"
] as const;

/**
 * A synthetic claim/EOB record. Every figure is deterministic-but-fake; the
 * `synthetic` marker keeps the mock nature auditable downstream.
 */
export type ClaimRecord = {
  /** Stable, deterministic synthetic claim id (hashed, not a real claim no.). */
  claimId: string;
  /** ISO date (YYYY-MM-DD) of service — deterministic, no clock. */
  dateOfService: string;
  /** The (mock) rendering provider. */
  provider: string;
  /** Provider-billed charge (USD). */
  billedAmount: number;
  /** Plan-allowed / negotiated amount (USD); 0 until adjudicated. */
  allowedAmount: number;
  /** Amount the plan paid (USD); 0 until adjudicated / on denial. */
  planPaid: number;
  /** Amount the member is responsible for (USD); 0 until adjudicated. */
  patientResponsibility: number;
  /** Where this claim is in its lifecycle. */
  status: ClaimStatus;
  /** Always true — this is a synthetic claim record, not a real one. */
  synthetic: true;
};

/** The billing/coverage self-service intents this agent handles + out-of-scope. */
export type MemberBillingIntent =
  | "claim-status"
  | "patient-responsibility"
  | "balance"
  | "eob-explanation"
  | "out-of-scope";

/** Provenance every returned answer carries. `synthetic` is always true. */
export type BillingSource = {
  synthetic: true;
  /** The (mock) claims/EOB system the answer is attributed to. */
  system: string;
  /** Honesty note kept on the wire so the mock is auditable downstream. */
  note: string;
};

/**
 * A compact, PII-safe context bundle handed to a human on escalation (or
 * attached to an in-scope answer for the trace). Structured signals only — no
 * free-text PII, so it satisfies the reused no-free-text-pii policy.
 */
export type BillingContextBundle = {
  intent: MemberBillingIntent;
  /** The claim ids the human should have in front of them. */
  citedClaimIds: string[];
  /** How many claim records were on file for the member. */
  claimCount: number;
  synthetic: true;
};

/**
 * The escalation path. `required` is true only when the answer routes to a
 * human (an out-of-scope request, or a billing intent with no claim on file).
 */
export type RouteToHuman = {
  required: boolean;
  reason: string;
  /** The member-services queue the handoff targets. */
  queue: string;
  contextBundle: BillingContextBundle;
};

/** The structured, deterministic output of answering a billing question. */
export type BillingAnswer = {
  intent: MemberBillingIntent;
  /** An in-scope billing answer, or a human handoff. */
  kind: "billing-answer" | "route-to-human";
  /** Human-readable answer text (no free-text PII). */
  answer: string;
  /** The specific claim record(s) the answer derives from (integrity property). */
  citedClaims: ClaimRecord[];
  /** Provenance — required, always present. */
  source: BillingSource;
  /** Escalation path; required:true only when routing to a human. */
  routeToHuman: RouteToHuman;
};

/** A representative synthetic member id used to seed the deterministic claims. */
export const DEFAULT_MEMBER_ID = "member-demo-001";

/** A representative in-scope demo question. */
export const DEMO_BILLING_QUERY = "How much do I owe for my last visit?";

/**
 * The (mock) provider directory a claim can be attributed to. Menopause-relevant
 * and clearly synthetic.
 */
const CLAIM_PROVIDERS: readonly string[] = [
  "Pause MSCP Telehealth (synthetic)",
  "Dr. Elena Vasquez, MD, MSCP (synthetic)",
  "Meno Labs Diagnostics (synthetic)",
  "Pause Behavioral Health (synthetic)",
  "Bone Health Imaging Center (synthetic)"
] as const;

/** Plan-allowed rate applied to the billed charge (deterministic pick). */
const ALLOWED_RATES: readonly number[] = [0.55, 0.6, 0.65, 0.7] as const;

/** Member coinsurance rate applied to the allowed amount (deterministic pick). */
const COINSURANCE_RATES: readonly number[] = [0.1, 0.2, 0.3] as const;

/** The fixed anchor date all claim dates count back from — no clock. */
const CLAIMS_ANCHOR = "2026-02-01";

/**
 * FNV-1a 32-bit string hash. Pure and deterministic — the same key always
 * produces the same synthetic claim, so there is deliberately NO randomness and
 * NO clock anywhere here.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A date `daysAgo` days before the fixed anchor (deterministic, no clock). */
function claimDate(daysAgo: number): string {
  const anchor = new Date(`${CLAIMS_ANCHOR}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - daysAgo);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Generate a single synthetic claim deterministically from the member id + a
 * claim index. Amounts are consistent with the claim's lifecycle status: a
 * submitted claim has no finalized amounts yet; a denied claim has no plan
 * payment; an adjudicated/paid claim carries an allowed + plan-paid + patient
 * responsibility split.
 */
function generateClaim(memberId: string, index: number): ClaimRecord {
  const key = `${(memberId ?? "").trim()}|claim|${index}`;
  const hId = hashString("id:" + key);
  const hBill = hashString("bill:" + key);
  const hProv = hashString("prov:" + key);
  const hDate = hashString("date:" + key);
  const hStatus = hashString("status:" + key);
  const hRate = hashString("rate:" + key);
  const hCoins = hashString("coins:" + key);

  const claimId = `clm-${hId.toString(36)}`;
  const provider = CLAIM_PROVIDERS[hProv % CLAIM_PROVIDERS.length];
  // Realistic specialist-visit / lab range: $150–$1,025 in $25 steps.
  const billedAmount = 150 + (hBill % 36) * 25;
  const dateOfService = claimDate(hDate % 180);
  const status = CLAIM_STATUSES[hStatus % CLAIM_STATUSES.length];
  const allowedRate = ALLOWED_RATES[hRate % ALLOWED_RATES.length];
  const coinsuranceRate = COINSURANCE_RATES[hCoins % COINSURANCE_RATES.length];

  let allowedAmount = 0;
  let planPaid = 0;
  let patientResponsibility = 0;

  if (status === "adjudicated" || status === "paid") {
    allowedAmount = Math.round(billedAmount * allowedRate);
    patientResponsibility = Math.round(allowedAmount * coinsuranceRate);
    planPaid = allowedAmount - patientResponsibility;
  }
  // "submitted" (still processing) and "denied" (no plan payment) both leave the
  // finalized amounts at 0 — the agent reports that honestly rather than
  // inventing a figure.

  return {
    claimId,
    dateOfService,
    provider,
    billedAmount,
    allowedAmount,
    planPaid,
    patientResponsibility,
    status,
    synthetic: true
  };
}

/**
 * Generate a member's synthetic claim history. DETERMINISTIC on the member id —
 * the same member always yields the same claims. Sorted most-recent first.
 */
export function generateClaims(memberId: string, count = 5): ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    claims.push(generateClaim(memberId, i));
  }
  return claims.sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));
}

/** Claims that have been finalized (allowed/plan-paid/responsibility set). */
function finalizedClaims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.filter(
    (c) => c.status === "adjudicated" || c.status === "paid"
  );
}

/** Claims where the member still owes a not-yet-paid finalized balance. */
function outstandingClaims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => c.status === "adjudicated");
}

/**
 * Deterministically classify a member's free-text billing question into a
 * billing/coverage self-service intent — or "out-of-scope" for anything that
 * isn't billing/coverage (a clinical, prescription, or scheduling request),
 * which is routed to a human. Pure keyword matching; no randomness, no clock.
 */
export function classifyIntent(query: string): MemberBillingIntent {
  const q = (query ?? "").toLowerCase();
  if (!q.trim()) return "out-of-scope";

  // Out-of-scope (clinical / prescription / scheduling / non-billing) FIRST, so
  // the agent stays scoped to billing/coverage and hands the rest to a human.
  if (
    /\b(appointment|schedule|reschedul|book|prescription|prescribe|refill|dose|dosage|medication|symptom|side ?effect|doctor|clinician|refer|referral|lab result|diagnos)\b/.test(
      q
    )
  ) {
    return "out-of-scope";
  }

  if (
    /\b(eob|explanation of benefits)\b/.test(q) ||
    (/\bexplain\b/.test(q) && /\b(claim|charge|bill|statement)\b/.test(q))
  ) {
    return "eob-explanation";
  }
  if (
    /\b(balance|outstanding|overall)\b/.test(q) ||
    /how much.*\b(total|overall|altogether)\b/.test(q) ||
    /\btotal\b.*\b(owe|due|balance)\b/.test(q)
  ) {
    return "balance";
  }
  if (
    /\b(copay|co-?pay|coinsurance|deductible|owe|responsib|how much|cost|charged?|bill)\b/.test(
      q
    )
  ) {
    return "patient-responsibility";
  }
  if (
    /\b(claim|status|processed|processing|pending|denied|approved|submitted|adjudicat)\b/.test(
      q
    )
  ) {
    return "claim-status";
  }
  return "out-of-scope";
}

/** Build the escalation path for a billing answer. */
function buildRouteToHuman(
  intent: MemberBillingIntent,
  claims: ClaimRecord[],
  opts: { required: boolean; reason: string; citedClaimIds: string[] }
): RouteToHuman {
  return {
    required: opts.required,
    reason: opts.reason,
    queue: "member-services-billing",
    contextBundle: {
      intent,
      citedClaimIds: opts.citedClaimIds,
      claimCount: claims.length,
      synthetic: true
    }
  };
}

const BILLING_SOURCE: BillingSource = {
  synthetic: true,
  system: "Pause Member Services — synthetic claims/EOB store",
  note: "Synthetic claim/EOB records — deterministic mock, not a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit."
};

/**
 * Answer a member's billing/coverage question, grounded on their claim records.
 * DETERMINISTIC on its inputs. An in-scope answer ALWAYS cites the specific
 * ClaimRecord(s) it derived from (the integrity property policy.billing.
 * claim-data-sourced guards); an out-of-scope request — or a billing intent
 * with no claim on file — routes to a human with a PII-safe context bundle.
 */
export function answerBillingQuestion(
  query: string,
  claims: ClaimRecord[]
): BillingAnswer {
  const intent = classifyIntent(query);
  const recent = claims.slice(0, Math.min(3, claims.length));

  if (intent === "out-of-scope") {
    return {
      intent,
      kind: "route-to-human",
      answer:
        "This request is outside billing & coverage self-service. Connecting you to a Pause member-services specialist, with your billing context attached.",
      citedClaims: [],
      source: BILLING_SOURCE,
      routeToHuman: buildRouteToHuman(intent, claims, {
        required: true,
        reason:
          "Out of scope for the billing/coverage self-service agent (a clinical, prescription, or scheduling request) — handed to a human with the member's recent claim context.",
        citedClaimIds: recent.map((c) => c.claimId)
      })
    };
  }

  // An in-scope billing intent with NO claim on file can't be answered from a
  // record, so it honestly routes to a human rather than inventing a figure.
  if (claims.length === 0) {
    return {
      intent,
      kind: "route-to-human",
      answer:
        "I don't see any claim records on file to answer that from, so I'm routing you to a member-services specialist.",
      citedClaims: [],
      source: BILLING_SOURCE,
      routeToHuman: buildRouteToHuman(intent, claims, {
        required: true,
        reason:
          "No claim records on file — a billing answer must trace to a claim record, so this is handed to a human rather than answered without a source.",
        citedClaimIds: []
      })
    };
  }

  let citedClaims: ClaimRecord[];
  let answer: string;

  switch (intent) {
    case "claim-status": {
      citedClaims = recent;
      const lines = recent
        .map(
          (c) =>
            `${c.claimId} (${c.dateOfService}, ${c.provider}): ${c.status}`
        )
        .join("; ");
      answer = `Here is the status of your most recent claim${
        recent.length === 1 ? "" : "s"
      }: ${lines}.`;
      break;
    }
    case "patient-responsibility": {
      const target = finalizedClaims(claims)[0] ?? claims[0];
      citedClaims = [target];
      if (target.status === "submitted") {
        answer = `Claim ${target.claimId} (${target.dateOfService}, ${target.provider}) is still processing, so your patient responsibility isn't finalized yet.`;
      } else if (target.status === "denied") {
        answer = `Claim ${target.claimId} (${target.dateOfService}, ${target.provider}) was denied, so no plan payment applied — reach out if you'd like to review or appeal it.`;
      } else {
        answer = `For claim ${target.claimId} (${target.dateOfService}, ${target.provider}), your patient responsibility is $${target.patientResponsibility} (allowed $${target.allowedAmount}, plan paid $${target.planPaid}).`;
      }
      break;
    }
    case "balance": {
      const outstanding = outstandingClaims(claims);
      if (outstanding.length > 0) {
        citedClaims = outstanding;
        const total = outstanding.reduce(
          (sum, c) => sum + c.patientResponsibility,
          0
        );
        const breakdown = outstanding
          .map((c) => `${c.claimId} $${c.patientResponsibility}`)
          .join(", ");
        answer = `Your outstanding balance across ${outstanding.length} finalized claim${
          outstanding.length === 1 ? "" : "s"
        } is $${total}: ${breakdown}.`;
      } else {
        citedClaims = [claims[0]];
        answer = `You have no outstanding patient balance on your finalized claims (most recent: ${claims[0].claimId}, ${claims[0].dateOfService}, status ${claims[0].status}).`;
      }
      break;
    }
    case "eob-explanation": {
      const target = finalizedClaims(claims)[0] ?? claims[0];
      citedClaims = [target];
      answer = `EOB for claim ${target.claimId} (${target.dateOfService}, ${target.provider}): billed $${target.billedAmount}, allowed $${target.allowedAmount}, plan paid $${target.planPaid}, your responsibility $${target.patientResponsibility} — status ${target.status}.`;
      break;
    }
    default: {
      // Unreachable (out-of-scope handled above); keeps the switch exhaustive.
      citedClaims = [claims[0]];
      answer = `Claim ${claims[0].claimId} is on file.`;
    }
  }

  return {
    intent,
    kind: "billing-answer",
    answer,
    citedClaims,
    source: BILLING_SOURCE,
    routeToHuman: buildRouteToHuman(intent, claims, {
      required: false,
      reason: "Resolved in billing/coverage self-service; no human handoff needed.",
      citedClaimIds: citedClaims.map((c) => c.claimId)
    })
  };
}

/**
 * The honest governance signal: does this billing answer trace to a claim
 * record? TRUE for a route-to-human handoff (which asserts no billing figure)
 * and for any in-scope billing answer that cites at least one synthetic claim
 * record; FALSE for a caller-asserted billing answer with no cited claim. The
 * route reports this to policy.billing.claim-data-sourced, which blocks when it
 * is false — so the agent can never fabricate claim data.
 */
export function answerTracesToClaim(
  answer: Pick<BillingAnswer, "kind" | "citedClaims"> | null | undefined
): boolean {
  if (!answer) return false;
  // A human handoff makes no billing claim, so it is honestly source-clean.
  if (answer.kind === "route-to-human") return true;
  const claims = answer.citedClaims;
  return (
    Array.isArray(claims) &&
    claims.length > 0 &&
    claims.every(
      (c) =>
        Boolean(c) &&
        typeof c.claimId === "string" &&
        c.claimId.length > 0 &&
        c.synthetic === true
    )
  );
}

/**
 * A compact, trace-safe summary of a billing answer — the shape stamped onto the
 * Agent Fabric trace. Carries no free-text PII (intent + claim ids + numbers).
 */
export function billingAnswerSummary(answer: BillingAnswer): {
  intent: MemberBillingIntent;
  kind: BillingAnswer["kind"];
  citedClaimIds: string[];
  citedClaimCount: number;
  patientResponsibility: number;
  routeToHuman: boolean;
  sourced: boolean;
} {
  return {
    intent: answer.intent,
    kind: answer.kind,
    citedClaimIds: answer.citedClaims.map((c) => c.claimId),
    citedClaimCount: answer.citedClaims.length,
    patientResponsibility: answer.citedClaims.reduce(
      (sum, c) => sum + c.patientResponsibility,
      0
    ),
    routeToHuman: answer.routeToHuman.required,
    sourced: answerTracesToClaim(answer)
  };
}
