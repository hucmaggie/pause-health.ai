/**
 * Quality-Measure Attribution — deterministic patient-to-provider /
 * -to-contract attribution for value-based-care rate calculations.
 *
 * Deterministic, dependency-free domain core the Quality-Measure Attribution
 * Agent (app/api/agents/quality-attribution) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud attribution analog on Pause's Agent
 * Fabric. It pairs with the HEDIS & Quality Reporting Agent: HEDIS computes
 * the RATES (numerator / denominator / catalog-sourced exclusions per
 * measure); THIS agent decides WHOSE PANEL each patient counts on. Getting
 * that wrong is how value-based-care contracts get argued over: a provider
 * gets credit (or blame) for a patient they never actually saw, or a
 * contract's specifically-excluded population still shows up on the
 * scorecard.
 *
 *   Inbound:  PatientAttributionContext (a synthetic patientRef — clearly
 *             labeled illustrative — the patient's demographic + network
 *             flags, a visit history of provider encounters accepted as
 *             data, the target methodology from the catalog, the target
 *             VBC contract from the contract catalog, and an asOfDate)
 *   Outbound: PatientAttribution { patientRef, methodology, providerRef,
 *             clinicRef, contractRef, tieBreakApplied?, excludedByContract,
 *             synthetic:true, note } and a QualityAttributionReport rolling
 *             up per-provider counts (in-network, excluded, ties-broken)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: methodology traces to the catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every attribution must trace to a defined methodology on the
 *  ATTRIBUTION_METHODOLOGIES catalog (plurality-of-visits, pcp-of-record,
 *  prospective-medicare-advantage, contract-defined-window). A bespoke /
 *  off-catalog / "we-just-guessed" attribution methodology fails.
 *  attributionsTraceToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.attribution.methodology-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no attribution against contract terms.
 * ─────────────────────────────────────────────────────────────────────
 *  Every VBC contract carries explicit terms (age band, network status,
 *  exclusion codes). An attribution that puts a patient in a contract's
 *  numerator/denominator when the contract EXPLICITLY EXCLUDES that
 *  patient is a violation — this is how a contract's scorecard gets
 *  polluted with patients the contract never covered. When the caller
 *  attributes-anyway, the block fires; when the agent's own analysis
 *  detects an excludedByContract:true, it returns the attribution but
 *  with the excluded flag set so downstream HEDIS scoring correctly drops
 *  it from the denominator. attributionsHonorContractTerms() reports the
 *  honest signal the Agent Fabric enforces via
 *  policy.attribution.no-conflicting-contract-terms.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: tie-break rule is documented.
 * ─────────────────────────────────────────────────────────────────────
 *  When two providers tie on the primary metric (equal visit counts under
 *  plurality-of-visits, for example), the tie-break rule MUST be one of the
 *  documented, deterministic rules — most-recent-visit-wins, then
 *  provider-ref-lexical-ascending. A coin-flip / undocumented / opaque
 *  tie-break is a violation: it turns attribution into gameable non-
 *  determinism. attributionTieBreaksAreDocumented() reports the honest
 *  signal the Agent Fabric enforces via
 *  policy.attribution.tie-break-documented.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified attribution engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The methodology catalog, contract catalog, tie-break rules, and visit-
 *  weighting below are ILLUSTRATIVE synthetic/demo values chosen to model
 *  the SHAPE of quality-measure attribution — they are NOT CMS Shared
 *  Savings Program attribution, an ACO REACH prospective assignment
 *  algorithm, an NCQA HEDIS attribution appendix, or a real payer's VBC
 *  contract terms. The patientRefs, providerRefs, and contractRefs are
 *  synthetic / de-identified. There is NO randomness and NO clock anywhere
 *  here: attribution is a pure function of the visit history + contract
 *  terms + the caller-provided asOfDate (accepted as data), so the same
 *  context always yields the same attribution — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/**
 * A single attribution methodology in the (illustrative) catalog. Every
 * methodology exposes its primary metric and its documented tie-break rules.
 */
export type AttributionMethodology = {
  /** Stable catalog id every attribution references (never invented). */
  id: string;
  /** Human-readable methodology label. */
  label: string;
  /** Illustrative description of the primary metric. */
  primaryMetric: string;
  /** Documented, deterministic tie-break rules (applied in order). */
  tieBreaks: readonly string[];
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative attribution-methodology catalog. Four methodologies that
 * model the SHAPE of value-based-care attribution — CMS Shared Savings /
 * ACO REACH / commercial-VBC-contract attribution — without being certified.
 */
export const ATTRIBUTION_METHODOLOGIES: AttributionMethodology[] = [
  {
    id: "methodology.plurality-of-visits",
    label: "Plurality of visits",
    primaryMetric:
      "The provider (and their clinic) with the most primary-care visits in the attribution window.",
    tieBreaks: ["most-recent-visit-wins", "provider-ref-lexical-ascending"],
    synthetic: true
  },
  {
    id: "methodology.pcp-of-record",
    label: "PCP of record",
    primaryMetric:
      "The patient's designated primary-care physician on file (from Data 360), regardless of visit counts.",
    tieBreaks: ["provider-ref-lexical-ascending"],
    synthetic: true
  },
  {
    id: "methodology.prospective-medicare-advantage",
    label: "Prospective (Medicare Advantage)",
    primaryMetric:
      "The provider prospectively assigned to the patient by the payer at the start of the measurement year.",
    tieBreaks: ["provider-ref-lexical-ascending"],
    synthetic: true
  },
  {
    id: "methodology.contract-defined-window",
    label: "Contract-defined attribution window",
    primaryMetric:
      "Attribution follows the contract's defined attribution window — e.g. most visits within the last 24 months for a commercial VBC contract.",
    tieBreaks: ["most-recent-visit-wins", "provider-ref-lexical-ascending"],
    synthetic: true
  }
];

const METHODOLOGY_BY_ID = new Map<string, AttributionMethodology>(
  ATTRIBUTION_METHODOLOGIES.map((m) => [m.id, m])
);

/** Is `id` a defined attribution methodology catalog id? */
export function isAttributionMethodology(id: unknown): boolean {
  return typeof id === "string" && METHODOLOGY_BY_ID.has(id);
}

/** Look up a methodology by id (undefined for an off-catalog id). */
export function getMethodology(id: string): AttributionMethodology | undefined {
  return METHODOLOGY_BY_ID.get(id);
}

/** The documented tie-break rule ids the fabric recognizes as legitimate. */
export const DOCUMENTED_TIE_BREAKS: readonly string[] = [
  "most-recent-visit-wins",
  "provider-ref-lexical-ascending"
];

const DOCUMENTED_TIE_BREAK_SET = new Set<string>(DOCUMENTED_TIE_BREAKS);

/** Is `rule` on the documented tie-break list? */
export function isDocumentedTieBreak(rule: unknown): boolean {
  return typeof rule === "string" && DOCUMENTED_TIE_BREAK_SET.has(rule);
}

/** A single VBC contract in the (illustrative) contract catalog. */
export type VbcContract = {
  /** Stable catalog id every attribution's contractRef references. */
  id: string;
  /** Human-readable contract label. */
  label: string;
  /** Inclusive age range for contract eligibility (illustrative). */
  ageRange: { minAge: number; maxAge: number };
  /** Whether the contract requires the patient to be in-network. */
  requiresInNetwork: boolean;
  /** Illustrative exclusion codes (a patient carrying any of these is excluded). */
  exclusionCodes: readonly string[];
  /** Illustrative attribution window in days. */
  attributionWindowDays: number;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative VBC contract catalog. Two contracts that model the SHAPE
 * of a Medicare Advantage HEDIS contract and a commercial VBC contract — NOT
 * a real payer's contract terms.
 */
export const VBC_CONTRACTS: VbcContract[] = [
  {
    id: "contract.medicare-advantage-hedis-my2026",
    label: "Medicare Advantage HEDIS MY2026",
    ageRange: { minAge: 65, maxAge: 120 },
    requiresInNetwork: true,
    exclusionCodes: ["exclusion.hospice", "exclusion.long-term-institutional"],
    attributionWindowDays: 365,
    synthetic: true
  },
  {
    id: "contract.commercial-vbc-my2026",
    label: "Commercial VBC MY2026",
    ageRange: { minAge: 18, maxAge: 64 },
    requiresInNetwork: true,
    exclusionCodes: ["exclusion.hospice"],
    attributionWindowDays: 730,
    synthetic: true
  }
];

const CONTRACT_BY_ID = new Map<string, VbcContract>(VBC_CONTRACTS.map((c) => [c.id, c]));

/** Is `id` a defined VBC contract catalog id? */
export function isVbcContract(id: unknown): boolean {
  return typeof id === "string" && CONTRACT_BY_ID.has(id);
}

/** Look up a VBC contract by id (undefined for an off-catalog id). */
export function getContract(id: string): VbcContract | undefined {
  return CONTRACT_BY_ID.get(id);
}

/** A single provider visit in the patient's history. */
export type ProviderVisit = {
  /** Stable illustrative provider reference. */
  providerRef: string;
  /** Illustrative clinic reference (a provider may sit in one clinic). */
  clinicRef: string;
  /** ISO date of the visit accepted as data (no clock). */
  date: string;
  /**
   * Whether the visit was a primary-care visit (illustrative). Only primary-
   * care visits count toward plurality-of-visits attribution.
   */
  isPrimaryCare: boolean;
};

/**
 * The structured signals the attribution planner reads. `patientRef` is a
 * synthetic, de-identified id — clearly labeled illustrative. Every field
 * is accepted as data (no clock, no randomness).
 */
export type PatientAttributionContext = {
  patientRef: string;
  /** ISO asOfDate the attribution is computed against. */
  asOfDate: string;
  /** Patient age (illustrative). Missing → contract eligibility fails. */
  age?: number;
  /** Whether the patient is in-network with the reporting organization. */
  inNetwork?: boolean;
  /** Illustrative claim/condition exclusion codes on file for the patient. */
  patientExclusionCodes?: readonly string[];
  /** The methodology catalog id this attribution should follow. */
  methodologyId: string;
  /** The target VBC contract catalog id. */
  contractId: string;
  /** The visit history — accepted as data (no clock). */
  visitHistory?: readonly ProviderVisit[];
  /**
   * The PCP-of-record providerRef (illustrative). Required only for
   * methodology.pcp-of-record; ignored otherwise.
   */
  pcpOfRecordRef?: string;
  /**
   * The prospectively-assigned providerRef (illustrative). Required only for
   * methodology.prospective-medicare-advantage; ignored otherwise.
   */
  prospectiveProviderRef?: string;
};

/** A single patient's attribution decision. */
export type PatientAttribution = {
  /** The synthetic patient reference. */
  patientRef: string;
  /** The methodology this attribution used (catalog-sourced). */
  methodologyId: string;
  /** The provider the patient is attributed to, or null when unattributable. */
  providerRef: string | null;
  /** The clinic the provider sits in, or null when unattributable. */
  clinicRef: string | null;
  /** The VBC contract this attribution counts against (catalog-sourced). */
  contractRef: string;
  /**
   * The documented tie-break rule that was applied to break a tie, or null
   * when no tie-break was needed.
   */
  tieBreakApplied: string | null;
  /**
   * True when the contract's terms EXCLUDE this patient (age band, out-of-
   * network, exclusion code). When true, the attribution still lists a
   * providerRef (so audit knows which provider was checked) but downstream
   * HEDIS scoring drops it from the denominator.
   */
  excludedByContract: boolean;
  /** Illustrative reason(s) for exclusion, when excludedByContract:true. */
  exclusionReasons: readonly string[];
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Per-provider counts across a rolled-up panel of attributions. */
export type ProviderAttributionRollup = {
  providerRef: string;
  clinicRef: string;
  contractRef: string;
  attributedCount: number;
  excludedByContractCount: number;
  tieBrokenCount: number;
};

/** The panel-level attribution report the agent returns. */
export type QualityAttributionReport = {
  asOfDate: string;
  contractRef: string;
  methodologyId: string;
  patients: readonly PatientAttribution[];
  perProvider: readonly ProviderAttributionRollup[];
  unattributableCount: number;
  synthetic: true;
  note: string;
};

/** Whether an ISO date sits within N days before asOfDate. */
function withinWindow(date: string, asOfDate: string, windowDays: number): boolean {
  const d = Date.parse(date);
  const a = Date.parse(asOfDate);
  if (Number.isNaN(d) || Number.isNaN(a)) return false;
  if (d > a) return false; // future visits ignored
  const days = Math.floor((a - d) / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= windowDays;
}

/**
 * Evaluate whether a contract's terms EXCLUDE this patient. Returns
 * excludedByContract + exclusionReasons. Pure — no clock.
 */
function evaluateContractExclusion(
  contract: VbcContract,
  ctx: PatientAttributionContext
): { excluded: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (typeof ctx.age !== "number") {
    reasons.push("age missing on the patient record");
  } else if (ctx.age < contract.ageRange.minAge || ctx.age > contract.ageRange.maxAge) {
    reasons.push(
      `age ${ctx.age} outside contract range ${contract.ageRange.minAge}-${contract.ageRange.maxAge}`
    );
  }
  if (contract.requiresInNetwork && ctx.inNetwork !== true) {
    reasons.push("patient is not in-network for this contract");
  }
  const patientCodes = new Set(ctx.patientExclusionCodes ?? []);
  for (const code of contract.exclusionCodes) {
    if (patientCodes.has(code)) reasons.push(`patient carries exclusion code ${code}`);
  }
  return { excluded: reasons.length > 0, reasons };
}

/**
 * Pick the winning provider from a visits-in-window list using plurality-
 * of-visits + the documented tie-break rules. Deterministic. Returns null
 * when the list is empty.
 */
function pickByPluralityWithTieBreak(
  visits: readonly ProviderVisit[]
): { providerRef: string; clinicRef: string; tieBreakApplied: string | null } | null {
  const primary = visits.filter((v) => v.isPrimaryCare);
  if (primary.length === 0) return null;
  const countByProvider = new Map<string, number>();
  const latestByProvider = new Map<string, string>();
  const clinicByProvider = new Map<string, string>();
  for (const v of primary) {
    countByProvider.set(v.providerRef, (countByProvider.get(v.providerRef) ?? 0) + 1);
    const currentLatest = latestByProvider.get(v.providerRef);
    if (!currentLatest || v.date > currentLatest) latestByProvider.set(v.providerRef, v.date);
    if (!clinicByProvider.has(v.providerRef)) {
      clinicByProvider.set(v.providerRef, v.clinicRef);
    }
  }
  const maxCount = Math.max(...countByProvider.values());
  const topProviders = [...countByProvider.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([provider]) => provider);
  if (topProviders.length === 1) {
    const providerRef = topProviders[0];
    return {
      providerRef,
      clinicRef: clinicByProvider.get(providerRef)!,
      tieBreakApplied: null
    };
  }
  // Tie-break 1: most recent visit wins.
  const sortedByRecency = [...topProviders].sort((a, b) => {
    const la = latestByProvider.get(a) ?? "";
    const lb = latestByProvider.get(b) ?? "";
    if (la === lb) return 0;
    return la > lb ? -1 : 1;
  });
  const mostRecentDate = latestByProvider.get(sortedByRecency[0]);
  const recentTied = sortedByRecency.filter(
    (p) => latestByProvider.get(p) === mostRecentDate
  );
  if (recentTied.length === 1) {
    const providerRef = recentTied[0];
    return {
      providerRef,
      clinicRef: clinicByProvider.get(providerRef)!,
      tieBreakApplied: "most-recent-visit-wins"
    };
  }
  // Tie-break 2: provider-ref lexical ascending.
  const [providerRef] = [...recentTied].sort();
  return {
    providerRef,
    clinicRef: clinicByProvider.get(providerRef)!,
    tieBreakApplied: "provider-ref-lexical-ascending"
  };
}

/**
 * Attribute a single patient. DETERMINISTIC — a pure function of the context
 * (visits + PCP-of-record / prospective refs + methodology + contract +
 * asOfDate). Off-catalog methodology or contract IDs raise an exception —
 * the caller should ensure both are catalog-sourced (the fabric's source-
 * integrity policy catches that separately).
 */
export function attributePatient(
  ctx: PatientAttributionContext
): PatientAttribution {
  const methodology = getMethodology(ctx.methodologyId);
  const contract = getContract(ctx.contractId);
  if (!methodology || !contract) {
    // Return a shape-valid unattributed record so callers can still fabric-
    // enforce; the source-integrity signal separately flags this.
    return {
      patientRef: ctx.patientRef,
      methodologyId: ctx.methodologyId,
      providerRef: null,
      clinicRef: null,
      contractRef: ctx.contractId,
      tieBreakApplied: null,
      excludedByContract: true,
      exclusionReasons: ["methodology or contract id is off-catalog"],
      synthetic: true,
      note: `Unable to attribute ${ctx.patientRef}: methodology (${ctx.methodologyId}) or contract (${ctx.contractId}) is off-catalog.`
    };
  }

  const exclusion = evaluateContractExclusion(contract, ctx);

  let providerRef: string | null = null;
  let clinicRef: string | null = null;
  let tieBreakApplied: string | null = null;

  if (methodology.id === "methodology.pcp-of-record") {
    providerRef = ctx.pcpOfRecordRef ?? null;
    clinicRef =
      (ctx.visitHistory ?? []).find((v) => v.providerRef === providerRef)?.clinicRef ??
      null;
  } else if (methodology.id === "methodology.prospective-medicare-advantage") {
    providerRef = ctx.prospectiveProviderRef ?? null;
    clinicRef =
      (ctx.visitHistory ?? []).find((v) => v.providerRef === providerRef)?.clinicRef ??
      null;
  } else {
    const window =
      methodology.id === "methodology.contract-defined-window"
        ? contract.attributionWindowDays
        : contract.attributionWindowDays;
    const visitsInWindow = (ctx.visitHistory ?? []).filter((v) =>
      withinWindow(v.date, ctx.asOfDate, window)
    );
    const pick = pickByPluralityWithTieBreak(visitsInWindow);
    if (pick) {
      providerRef = pick.providerRef;
      clinicRef = pick.clinicRef;
      tieBreakApplied = pick.tieBreakApplied;
    }
  }

  const note = exclusion.excluded
    ? `Attributed ${ctx.patientRef} via ${methodology.label} to ${
        providerRef ?? "no-provider"
      } on ${contract.label}, but the contract terms EXCLUDE this patient: ${exclusion.reasons.join(
        "; "
      )}. Downstream HEDIS scoring drops this attribution from the denominator.`
    : `Attributed ${ctx.patientRef} via ${methodology.label} to ${
        providerRef ?? "no-provider"
      } (${clinicRef ?? "no-clinic"}) on ${contract.label}${
        tieBreakApplied ? `; tie-break applied: ${tieBreakApplied}` : ""
      }.`;

  return {
    patientRef: ctx.patientRef,
    methodologyId: methodology.id,
    providerRef,
    clinicRef,
    contractRef: contract.id,
    tieBreakApplied,
    excludedByContract: exclusion.excluded,
    exclusionReasons: exclusion.reasons,
    synthetic: true,
    note
  };
}

/**
 * Roll up a panel of patient attributions into per-provider counts.
 * DETERMINISTIC — a pure function of the attributions. Providers are sorted
 * by providerRef ascending for a stable, documented display.
 */
export function rollUpAttributions(
  attributions: readonly PatientAttribution[]
): {
  perProvider: readonly ProviderAttributionRollup[];
  unattributableCount: number;
  contractRef: string;
  methodologyId: string;
} {
  const perProviderMap = new Map<
    string,
    { clinicRef: string; contractRef: string; attributed: number; excluded: number; tied: number }
  >();
  let unattributable = 0;
  for (const a of attributions) {
    if (!a.providerRef) {
      unattributable += 1;
      continue;
    }
    const existing = perProviderMap.get(a.providerRef) ?? {
      clinicRef: a.clinicRef ?? "unknown",
      contractRef: a.contractRef,
      attributed: 0,
      excluded: 0,
      tied: 0
    };
    if (a.excludedByContract) existing.excluded += 1;
    else existing.attributed += 1;
    if (a.tieBreakApplied) existing.tied += 1;
    perProviderMap.set(a.providerRef, existing);
  }
  const perProvider: ProviderAttributionRollup[] = [...perProviderMap.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a > b ? 1 : -1))
    .map(([providerRef, v]) => ({
      providerRef,
      clinicRef: v.clinicRef,
      contractRef: v.contractRef,
      attributedCount: v.attributed,
      excludedByContractCount: v.excluded,
      tieBrokenCount: v.tied
    }));
  const contractRef = attributions[0]?.contractRef ?? "unknown";
  const methodologyId = attributions[0]?.methodologyId ?? "unknown";
  return { perProvider, unattributableCount: unattributable, contractRef, methodologyId };
}

/**
 * Attribute a whole panel of patients under a single methodology / contract
 * and roll up per-provider counts. DETERMINISTIC.
 */
export function attributePanel(
  panel: readonly PatientAttributionContext[]
): QualityAttributionReport {
  const attributions = panel.map((p) => attributePatient(p));
  const rollup = rollUpAttributions(attributions);
  const contract = getContract(rollup.contractRef);
  const methodology = getMethodology(rollup.methodologyId);
  const note =
    `Attributed ${attributions.length} patient${attributions.length === 1 ? "" : "s"} via ${
      methodology?.label ?? "unknown methodology"
    } on ${contract?.label ?? "unknown contract"}: ` +
    `${rollup.perProvider.reduce((s, p) => s + p.attributedCount, 0)} in-network attributed, ${
      rollup.perProvider.reduce((s, p) => s + p.excludedByContractCount, 0)
    } excluded by contract terms (dropped from downstream HEDIS denominators), ${
      rollup.perProvider.reduce((s, p) => s + p.tieBrokenCount, 0)
    } tie-broken by documented rules, ${rollup.unattributableCount} unattributable.` +
    ` Synthetic/illustrative catalog + refs — not a certified CMS Shared Savings / ACO REACH / commercial-VBC attribution engine.`;
  return {
    asOfDate: panel[0]?.asOfDate ?? "unknown",
    contractRef: rollup.contractRef,
    methodologyId: rollup.methodologyId,
    patients: attributions,
    perProvider: rollup.perProvider,
    unattributableCount: rollup.unattributableCount,
    synthetic: true,
    note
  };
}

/**
 * Methodology-catalog-sourced check: does EVERY attribution cite a methodology
 * on the ATTRIBUTION_METHODOLOGIES catalog AND a contract on the VBC_CONTRACTS
 * catalog? True when every entry meets both. The guard that catches a
 * caller-asserted bespoke / off-catalog attribution. This is the honest
 * signal the route reports to policy.attribution.methodology-catalog-sourced.
 * A non-array input is a violation.
 */
export function attributionsTraceToCatalog(
  attributions:
    | ReadonlyArray<{ methodologyId?: string; contractRef?: string }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(attributions)) return false;
  return attributions.every(
    (a) => isAttributionMethodology(a.methodologyId) && isVbcContract(a.contractRef)
  );
}

/**
 * Contract-terms-honored check: does EVERY attribution honor its contract's
 * terms? An attribution honors terms when either excludedByContract:true (the
 * agent detected the exclusion and set the flag) OR when the caller has NOT
 * asserted an in-numerator attribution on a patient whose contract terms
 * exclude them. The guard that catches a caller-asserted "attribute anyway"
 * override. Caller-asserted excludedByContract:false on a patient whose
 * contract-check WOULD have excluded them is a violation.
 *
 * This function is called by the route AFTER re-checking each attribution
 * against the contract to make sure the caller can't lie by omission.
 */
export function attributionsHonorContractTerms(
  input:
    | ReadonlyArray<{
        assertedExcludedByContract?: boolean;
        actualExcludedByContract?: boolean;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(input)) return false;
  return input.every((row) => {
    if (row.actualExcludedByContract === true) {
      // The contract's actual terms exclude this patient. The attribution
      // must acknowledge it with excludedByContract:true.
      return row.assertedExcludedByContract === true;
    }
    // The actual terms don't exclude the patient — either value is fine.
    return true;
  });
}

/**
 * Tie-break-documented check: does EVERY attribution's tieBreakApplied
 * value, when present, appear on the DOCUMENTED_TIE_BREAKS list? True when
 * every present tie-break is documented (and when there's no tie-break at
 * all — a null tie-break is legitimate). The guard that catches a caller-
 * asserted opaque / coin-flip / undocumented tie-break. This is the honest
 * signal the route reports to policy.attribution.tie-break-documented. A
 * non-array input is a violation.
 */
export function attributionTieBreaksAreDocumented(
  attributions:
    | ReadonlyArray<{ tieBreakApplied?: string | null }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(attributions)) return false;
  return attributions.every((a) => {
    if (a.tieBreakApplied === null || a.tieBreakApplied === undefined) return true;
    return isDocumentedTieBreak(a.tieBreakApplied);
  });
}

/**
 * A representative demo panel (illustrative). Five midlife/menopause
 * patients spanning the four methodologies + contract-exclusion path — so
 * plurality, PCP-of-record, prospective, contract-window, tie-break, and
 * contract-exclusion cases are all demonstrable in a single call.
 */
export const DEMO_ATTRIBUTION_PANEL: readonly PatientAttributionContext[] = [
  // patient 1: plurality-of-visits, clear winner in Commercial VBC.
  {
    patientRef: "attr-patient-001",
    asOfDate: "2026-07-01",
    age: 52,
    inNetwork: true,
    methodologyId: "methodology.plurality-of-visits",
    contractId: "contract.commercial-vbc-my2026",
    visitHistory: [
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-01-15", isPrimaryCare: true },
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-04-01", isPrimaryCare: true },
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-06-01", isPrimaryCare: true },
      { providerRef: "provider-b", clinicRef: "clinic-south", date: "2026-02-01", isPrimaryCare: true }
    ]
  },
  // patient 2: plurality tie broken by most-recent-visit-wins.
  {
    patientRef: "attr-patient-002",
    asOfDate: "2026-07-01",
    age: 58,
    inNetwork: true,
    methodologyId: "methodology.plurality-of-visits",
    contractId: "contract.commercial-vbc-my2026",
    visitHistory: [
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-01-15", isPrimaryCare: true },
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-03-01", isPrimaryCare: true },
      { providerRef: "provider-b", clinicRef: "clinic-south", date: "2026-02-01", isPrimaryCare: true },
      { providerRef: "provider-b", clinicRef: "clinic-south", date: "2026-06-15", isPrimaryCare: true }
    ]
  },
  // patient 3: PCP-of-record designated (visit history ignored for method).
  {
    patientRef: "attr-patient-003",
    asOfDate: "2026-07-01",
    age: 61,
    inNetwork: true,
    methodologyId: "methodology.pcp-of-record",
    contractId: "contract.commercial-vbc-my2026",
    pcpOfRecordRef: "provider-c",
    visitHistory: [
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-01-15", isPrimaryCare: true },
      { providerRef: "provider-c", clinicRef: "clinic-west", date: "2026-04-01", isPrimaryCare: true }
    ]
  },
  // patient 4: contract-defined-window (365d for MA); age 70 fits MA HEDIS.
  {
    patientRef: "attr-patient-004",
    asOfDate: "2026-07-01",
    age: 70,
    inNetwork: true,
    methodologyId: "methodology.contract-defined-window",
    contractId: "contract.medicare-advantage-hedis-my2026",
    visitHistory: [
      { providerRef: "provider-d", clinicRef: "clinic-east", date: "2025-10-15", isPrimaryCare: true },
      { providerRef: "provider-d", clinicRef: "clinic-east", date: "2026-04-01", isPrimaryCare: true }
    ]
  },
  // patient 5: contract-excluded by age band on MA HEDIS (52 < 65).
  {
    patientRef: "attr-patient-005",
    asOfDate: "2026-07-01",
    age: 52,
    inNetwork: true,
    methodologyId: "methodology.contract-defined-window",
    contractId: "contract.medicare-advantage-hedis-my2026",
    visitHistory: [
      { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-03-01", isPrimaryCare: true }
    ]
  }
];

/**
 * A representative single-patient tie-break demo (illustrative). Same as
 * patient 2 above — exposed as its own constant so the /demo panel can fire
 * it independently.
 */
export const DEMO_TIE_BREAK_PATIENT: PatientAttributionContext =
  DEMO_ATTRIBUTION_PANEL[1];

/**
 * A representative single-patient contract-excluded demo (illustrative).
 * Same as patient 5 above.
 */
export const DEMO_CONTRACT_EXCLUDED_PATIENT: PatientAttributionContext =
  DEMO_ATTRIBUTION_PANEL[4];
