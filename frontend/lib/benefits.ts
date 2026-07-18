/**
 * Benefits & Coverage Verification (EBV) — synthetic eligibility.
 *
 * Deterministic, dependency-free synthetic eligibility & benefit
 * verification. This is the domain core the Benefits & Coverage
 * Verification Agent (app/api/agents/benefits-verification) wraps — the
 * Salesforce "Agentforce for Health — Eligibility & Benefit Verification"
 * analog on Pause's Agent Fabric.
 *
 *   Inbound:  a CoverageQuery (payer + member/plan + service context,
 *             drawn from IntakeRecord.patientInsurance / .patientZip)
 *   Outbound: a CoverageBenefitResult (eligibility status, in/out of
 *             network, deductible + amount met, coinsurance/copay, an
 *             estimated visit cost + patient responsibility, plan name,
 *             and a `source` provenance block naming a MOCK payer /
 *             clearinghouse + a synthetic EBV transaction id)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a real payer round-trip.
 * ─────────────────────────────────────────────────────────────────────
 *  There is NO real 270/271 EDI eligibility transaction and NO FHIR
 *  CoverageEligibilityRequest/Response here. Every number is a
 *  DETERMINISTIC synthetic value derived by hashing the member/plan
 *  string — no randomness, no clock, no network call. The clearinghouse
 *  and transaction id in `source` are clearly labeled synthetic. The
 *  point of the module is to model the SHAPE of an EBV round-trip and,
 *  crucially, the governance invariant that a returned coverage result
 *  MUST carry its (mock) payer/clearinghouse source — the agent may not
 *  fabricate coverage without one. That invariant is enforced at the
 *  governance boundary by policy.benefits.eligibility-source-integrity
 *  and defended here by verifyCoverage() always attaching a `source`.
 *
 *  Because it is deterministic on its inputs, a given query always
 *  verifies identically — which is what lets the demo, the seeded trace,
 *  and the tests agree.
 */

import type { IntakeRecord } from "./care-router";

/** The default service context: a menopause specialist (MSCP) visit. */
export const DEFAULT_SERVICE_TYPE = "mscp-specialist-visit" as const;

/**
 * A coverage/eligibility query. The member/plan + service context is
 * drawn from the fields IntakeRecord already carries (patientInsurance,
 * patientZip); memberId is a synthetic subscriber id used only to make
 * the deterministic profile selection stable per member.
 */
export type CoverageQuery = {
  /** The patient's insurance plan string, e.g. "Aetna" / "BCBS" / "United". */
  payer?: string;
  /** Synthetic subscriber/member id. Never a real member number. */
  memberId?: string;
  /** Patient ZIP (IntakeRecord.patientZip); only its region is used. */
  patientZip?: string;
  /** Service being verified; defaults to the MSCP specialist visit. */
  serviceType?: string;
};

/**
 * The (mock) payer/clearinghouse provenance every returned result must
 * carry. `synthetic` is always true — this is not a live EBV response.
 */
export type CoverageSource = {
  /** Always true — this provenance describes a synthetic EBV round-trip. */
  synthetic: true;
  /** The (mock) payer the eligibility response is attributed to. */
  payer: string;
  /** The (mock) clearinghouse the 270/271 would have traversed. */
  clearinghouse: string;
  /** The EBV transaction shape being modeled (labeled synthetic). */
  transactionType: string;
  /** Deterministic synthetic transaction id (hashed, not a real trace). */
  transactionId: string;
  /** The eligibility response code the mock payer returned. */
  responseCode: "active-coverage" | "no-active-coverage";
  /** Honesty note kept on the wire so the mock is auditable downstream. */
  note: string;
};

/** The structured, deterministic output of verifying coverage. */
export type CoverageBenefitResult = {
  eligibilityStatus: "active" | "inactive";
  network: "in-network" | "out-of-network";
  /** Canonical display payer name (normalized from the query string). */
  payerName: string;
  /** Synthetic-but-plausible plan name. */
  planName: string;
  /** Plan product type (PPO / HMO / EPO / HDHP / none). */
  productType: string;
  /** The service the benefit estimate is for. */
  serviceType: string;
  deductibleTotal: number;
  deductibleMet: number;
  deductibleRemaining: number;
  /** Effective coinsurance rate applied (0..1); 0 when a copay applies. */
  coinsuranceRate: number;
  /** Flat office-visit copay when the plan uses one in-network. */
  copay?: number;
  /** Estimated allowed/negotiated cost of the visit (USD). */
  estimatedVisitCost: number;
  /** Estimated patient out-of-pocket for the visit (USD). */
  estimatedPatientResponsibility: number;
  /** Mock payer/clearinghouse provenance — required, always present. */
  source: CoverageSource;
};

/**
 * Known payers Pause's directory recognizes, canonical key → display.
 * A "known" payer is one the EBV agent can name; a subset of them are
 * CONTRACTED (in-network) with Pause's MSCP network below.
 */
export const KNOWN_PAYERS: Record<string, string> = {
  aetna: "Aetna",
  bcbs: "Blue Cross Blue Shield",
  cigna: "Cigna",
  uhc: "UnitedHealthcare",
  kaiser: "Kaiser Permanente",
  humana: "Humana",
  medicare: "Medicare"
};

/**
 * The payers contracted (in-network) with Pause's MSCP network. Known
 * payers NOT in this set (Humana, Medicare) resolve as out-of-network,
 * as do any unrecognized-but-named payers — the honest demo distinction
 * between "we recognize this plan" and "we're contracted with it".
 */
export const CONTRACTED_PAYERS: readonly string[] = [
  "aetna",
  "bcbs",
  "cigna",
  "uhc",
  "kaiser"
] as const;

/** Strings that mean "no active coverage" rather than a payer. */
const SELF_PAY_TOKENS = new Set([
  "",
  "self-pay",
  "selfpay",
  "self pay",
  "none",
  "uninsured",
  "no insurance"
]);

/**
 * Normalize a free-form payer string to a canonical known-payer key,
 * folding common synonyms ("United" → uhc, "Blue Cross" → bcbs). Returns
 * the canonical key when recognized, or the lowercased-trimmed string
 * when it's a named-but-unknown payer, or "" for self-pay/empty.
 */
export function normalizePayer(payer: string | undefined): string {
  const raw = (payer ?? "").trim().toLowerCase();
  if (SELF_PAY_TOKENS.has(raw)) return "";
  const collapsed = raw.replace(/\s+/g, " ");
  const synonyms: Record<string, string> = {
    "united": "uhc",
    "united healthcare": "uhc",
    "unitedhealthcare": "uhc",
    "united health care": "uhc",
    "blue cross": "bcbs",
    "blue cross blue shield": "bcbs",
    "bluecross": "bcbs",
    "blue shield": "bcbs",
    "kaiser permanente": "kaiser",
    "kp": "kaiser"
  };
  if (synonyms[collapsed]) return synonyms[collapsed];
  if (KNOWN_PAYERS[collapsed]) return collapsed;
  // A named-but-unrecognized payer: keep a slug so it stays deterministic.
  return collapsed;
}

/** Is `payer` a payer we recognize by name (after normalization)? */
export function isKnownPayer(payer: string | undefined): boolean {
  const key = normalizePayer(payer);
  return key !== "" && key in KNOWN_PAYERS;
}

/** Human display name for a normalized payer key. */
function payerDisplayName(key: string, original: string | undefined): string {
  if (key === "") return "Self-pay / uninsured";
  if (KNOWN_PAYERS[key]) return KNOWN_PAYERS[key];
  // Title-case the named-but-unknown payer for display.
  const src = (original ?? key).trim();
  return src.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A synthetic-but-plausible plan profile. Selected deterministically by
 * hashing the query; the numbers stay inside realistic ranges
 * (deductible $1,500–$6,000, coinsurance 10–30%, copay $40–$55).
 */
type PlanProfile = {
  key: string;
  productType: string;
  planSuffix: string;
  deductibleTotal: number;
  /** In-network coinsurance rate (0 when the plan uses a copay instead). */
  coinsuranceRate: number;
  /** In-network flat office-visit copay, when the plan uses one. */
  copay?: number;
};

const PLAN_PROFILES: PlanProfile[] = [
  {
    key: "choice-ppo",
    productType: "PPO",
    planSuffix: "Choice PPO",
    deductibleTotal: 1500,
    coinsuranceRate: 0.2
  },
  {
    key: "premier-ppo",
    productType: "PPO",
    planSuffix: "Premier PPO",
    deductibleTotal: 3000,
    coinsuranceRate: 0.1
  },
  {
    key: "select-hmo",
    productType: "HMO",
    planSuffix: "Select HMO",
    deductibleTotal: 2000,
    coinsuranceRate: 0,
    copay: 40
  },
  {
    key: "saver-hdhp",
    productType: "HDHP",
    planSuffix: "Saver HDHP",
    deductibleTotal: 6000,
    coinsuranceRate: 0.3
  },
  {
    key: "navigate-epo",
    productType: "EPO",
    planSuffix: "Navigate EPO",
    deductibleTotal: 2500,
    coinsuranceRate: 0,
    copay: 55
  }
];

/**
 * FNV-1a 32-bit string hash. Pure and deterministic — the whole point is
 * that the same query string always produces the same synthetic profile,
 * so there is deliberately NO randomness and NO clock anywhere here.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Verify a patient's coverage/eligibility for the service. DETERMINISTIC
 * on its inputs — the member/plan string is hashed to pick a
 * plausible-but-fake plan profile, deductible-met amount, and visit cost.
 *
 * Always returns a `source` provenance block (a synthetic EBV response):
 * an active-coverage result traces to it, and even a self-pay / inactive
 * result carries the "no-active-coverage" EBV response — so a returned
 * result is never a fabricated coverage figure without a source. That
 * invariant is what policy.benefits.eligibility-source-integrity guards.
 */
export function verifyCoverage(query: CoverageQuery): CoverageBenefitResult {
  const serviceType = query.serviceType || DEFAULT_SERVICE_TYPE;
  const payerKey = normalizePayer(query.payer);
  const payerName = payerDisplayName(payerKey, query.payer);

  // Deterministic seed. Different salts fan a single seed into stable,
  // independent sub-values — no Math.random(), no Date.now().
  const seed = `${payerKey}|${(query.memberId ?? "").trim()}|${(
    query.patientZip ?? ""
  ).trim()}|${serviceType}`;
  const hVisit = hashString("visit:" + seed);
  const hTxn = hashString("txn:" + seed);
  const transactionId = `ebv-${hTxn.toString(36)}`;

  // Visit cost is a deterministic value in the realistic $180–$420 range
  // ($10 steps). Computed even for self-pay so the OOP estimate is honest.
  const estimatedVisitCost = 180 + (hVisit % 25) * 10;

  // Self-pay / uninsured / empty payer → inactive coverage. This is still
  // a SOURCED response ("no-active-coverage") — the agent isn't fabricating
  // a benefit, it's reporting the payer said there's no active plan.
  if (payerKey === "") {
    return {
      eligibilityStatus: "inactive",
      network: "out-of-network",
      payerName,
      planName: "No active coverage (self-pay)",
      productType: "none",
      serviceType,
      deductibleTotal: 0,
      deductibleMet: 0,
      deductibleRemaining: 0,
      coinsuranceRate: 0,
      estimatedVisitCost,
      estimatedPatientResponsibility: estimatedVisitCost,
      source: {
        synthetic: true,
        payer: payerName,
        clearinghouse: "Change Healthcare (synthetic)",
        transactionType: "EBV 270/271 (synthetic)",
        transactionId,
        responseCode: "no-active-coverage",
        note: "Synthetic EBV response — deterministic mock, not a live 270/271 or FHIR eligibility call."
      }
    };
  }

  const hProfile = hashString("profile:" + seed);
  const hDeduct = hashString("deductible:" + seed);
  const profile = PLAN_PROFILES[hProfile % PLAN_PROFILES.length];

  // Deductible met: a deterministic multiple of $500 between $0 and the
  // plan's total, so "amount met so far" reads like a real EBV response.
  const steps = profile.deductibleTotal / 500;
  const deductibleMet = (hDeduct % (steps + 1)) * 500;
  const deductibleRemaining = profile.deductibleTotal - deductibleMet;

  const inNetwork = CONTRACTED_PAYERS.includes(payerKey);
  const network = inNetwork ? "in-network" : "out-of-network";

  let coinsuranceRate: number;
  let copay: number | undefined;
  let estimatedPatientResponsibility: number;

  if (inNetwork && profile.copay !== undefined) {
    // In-network copay plan: a flat office-visit copay (deductible waived
    // for the copay), which is how HMO/EPO office visits typically bill.
    coinsuranceRate = 0;
    copay = profile.copay;
    estimatedPatientResponsibility = Math.min(profile.copay, estimatedVisitCost);
  } else {
    // Deductible-then-coinsurance. Out-of-network adds 20 points to the
    // coinsurance (copay plans fall back to a 0.3 base OON), capped at 0.6.
    const baseRate =
      profile.coinsuranceRate > 0 ? profile.coinsuranceRate : 0.3;
    // Round to 2 decimals so 0.1 + 0.2 doesn't surface as 0.30000000004.
    coinsuranceRate = inNetwork
      ? profile.coinsuranceRate
      : Math.round(Math.min(baseRate + 0.2, 0.6) * 100) / 100;
    const towardDeductible = Math.min(estimatedVisitCost, deductibleRemaining);
    const afterDeductible = estimatedVisitCost - towardDeductible;
    const coinsuranceAmount = Math.round(afterDeductible * coinsuranceRate);
    estimatedPatientResponsibility = towardDeductible + coinsuranceAmount;
  }

  return {
    eligibilityStatus: "active",
    network,
    payerName,
    planName: `${payerName} ${profile.planSuffix}`,
    productType: profile.productType,
    serviceType,
    deductibleTotal: profile.deductibleTotal,
    deductibleMet,
    deductibleRemaining,
    coinsuranceRate,
    ...(copay !== undefined ? { copay } : {}),
    estimatedVisitCost,
    estimatedPatientResponsibility,
    source: {
      synthetic: true,
      payer: payerName,
      clearinghouse: "Change Healthcare (synthetic)",
      transactionType: "EBV 270/271 (synthetic)",
      transactionId,
      responseCode: "active-coverage",
      note: "Synthetic EBV response — deterministic mock, not a live 270/271 or FHIR eligibility call."
    }
  };
}

/**
 * Does a coverage result carry a valid (mock) EBV source provenance?
 *
 * This is the honest fact the Benefits Verification Agent reports to the
 * governance gate: policy.benefits.eligibility-source-integrity blocks a
 * returned coverage result that does NOT trace to a payer/clearinghouse
 * EBV response. verifyCoverage() always attaches one, so a genuinely
 * verified result is always source-backed; a caller-asserted "coverage"
 * object lacking a source is what this guards against.
 */
export function hasEbvSource(
  result: Pick<CoverageBenefitResult, "source"> | null | undefined
): boolean {
  const src = result?.source;
  return Boolean(
    src &&
      src.synthetic === true &&
      typeof src.transactionId === "string" &&
      src.transactionId.length > 0 &&
      typeof src.payer === "string" &&
      src.payer.length > 0 &&
      typeof src.clearinghouse === "string" &&
      src.clearinghouse.length > 0
  );
}

/**
 * Build a CoverageQuery from an IntakeRecord (additive spine helper).
 * Pulls patientInsurance → payer and patientZip → patientZip so a real
 * coverage check can precede routing when the intake carries a plan.
 */
export function coverageQueryFromIntake(
  intake: Pick<IntakeRecord, "patientInsurance" | "patientZip">,
  extra?: { memberId?: string; serviceType?: string }
): CoverageQuery {
  return {
    payer: intake.patientInsurance,
    patientZip: intake.patientZip,
    ...(extra?.memberId ? { memberId: extra.memberId } : {}),
    serviceType: extra?.serviceType ?? DEFAULT_SERVICE_TYPE
  };
}

/**
 * A compact, trace-safe summary of a coverage result — the shape stamped
 * onto the Agent Fabric trace + the intake→router response `meta`. Carries
 * no free-text PII (payer + plan names + numbers only).
 */
export function coverageSummary(result: CoverageBenefitResult): {
  eligibilityStatus: string;
  network: string;
  payerName: string;
  planName: string;
  deductibleTotal: number;
  deductibleMet: number;
  deductibleRemaining: number;
  coinsuranceRate: number;
  copay?: number;
  estimatedVisitCost: number;
  estimatedPatientResponsibility: number;
  ebvTransactionId: string;
  sourced: boolean;
} {
  return {
    eligibilityStatus: result.eligibilityStatus,
    network: result.network,
    payerName: result.payerName,
    planName: result.planName,
    deductibleTotal: result.deductibleTotal,
    deductibleMet: result.deductibleMet,
    deductibleRemaining: result.deductibleRemaining,
    coinsuranceRate: result.coinsuranceRate,
    ...(result.copay !== undefined ? { copay: result.copay } : {}),
    estimatedVisitCost: result.estimatedVisitCost,
    estimatedPatientResponsibility: result.estimatedPatientResponsibility,
    ebvTransactionId: result.source.transactionId,
    sourced: hasEbvSource(result)
  };
}
