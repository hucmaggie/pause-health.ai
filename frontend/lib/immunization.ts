/**
 * Immunization Forecasting (ACIP) — the deterministic, transparent clinical-decision layer
 * that forecasts which vaccines a patient is up-to-date / due / overdue / contraindicated /
 * not-indicated for against an ACIP-style schedule, honoring recorded contraindications and
 * never autonomously administering a vaccine.
 *
 * Deterministic, dependency-free domain core the Immunization Forecasting Agent
 * (app/api/agents/immunization) wraps — a clinical-decision service on the patient &
 * clinical plane of Pause's Agent Fabric. Given a patient (a synthetic reference, a birth
 * date, an immunization history, and any recorded contraindications) evaluated against a
 * provided asOfDate, it DETERMINISTICALLY computes the patient's age, then for each schedule
 * rule computes a per-vaccine forecast (up-to-date / due / overdue / contraindicated /
 * not-indicated), citing the governing schedule rule and the next-due date.
 *
 *   Inbound:  an ImmunizationRequest { patientRef, asOfDate, birthDate, history[], contraindications? }
 *   Outbound: an ImmunizationDetermination { ageYears, forecast[], dueCount, overdueCount,
 *             contraindicatedCount, requiresClinicianOrder, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other clinical / care agents: distinct from
 * the Care Gap Closure agent (broad missing preventive measures), the Lab Result agent
 * (discrete diagnostic results), the Care Plan agent (the longitudinal plan), and the Care
 * Router (triage): this forecasts the specific vaccine schedule — dose series, booster
 * intervals, and age-eligibility — against ACIP-style rules.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every forecast entry cites a recorded schedule rule.
 * ─────────────────────────────────────────────────────────────────────
 *  Every per-vaccine forecast must cite a recorded ACIP schedule rule from the catalog —
 *  there is no ad-hoc, un-sourced vaccine recommendation. immunizationScheduleCited() reports
 *  the honest signal the Agent Fabric enforces via policy.immunization.schedule-sourced.
 *  (Mirrors the Lab Result Agent's reference-range-sourced and the Data Retention Agent's
 *  schedule-sourced posture — every decision traces to a defined source.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a contraindicated vaccine is never recommended.
 * ─────────────────────────────────────────────────────────────────────
 *  A vaccine for which the patient has a recorded contraindication is NEVER recommended (due
 *  / overdue) — it is flagged `contraindicated` and withheld. Recommending a contraindicated
 *  vaccine is a patient-safety hazard. immunizationContraindicationHonored() reports the
 *  honest signal the Agent Fabric enforces via policy.immunization.contraindication-honored.
 *  (This is the load-bearing safety gate — mirrors the Lab Result Agent's
 *  critical-value-notified: a clinical-safety obligation that cannot be skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the agent never autonomously administers.
 * ─────────────────────────────────────────────────────────────────────
 *  A due / overdue vaccine is a RECOMMENDATION requiring a clinician order — the agent NEVER
 *  administers, orders, or records a vaccine autonomously. A determination with due / overdue
 *  vaccines that does not require a clinician order is dishonest. immunizationNoAutonomousAdministration()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.immunization.no-autonomous-administration. (Mirrors the Lab Result Agent's
 *  no-autonomous-clinical-action and the Balance Billing Agent's no-autonomous-balance-bill
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A forecast — with due / overdue vaccines — is a SAFE, honest OUTPUT: the task COMPLETES
 *  (due / overdue vaccines carry requiresClinicianOrder:true). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (an off-catalog rule, a recommended
 *  contraindicated vaccine, or an autonomous administration) — which the Agent Fabric rejects
 *  before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified immunization forecaster.
 * ─────────────────────────────────────────────────────────────────────
 *  The schedule catalog, age-eligibility, dose series, and booster intervals below are
 *  ILLUSTRATIVE synthetic/demo rules chosen to model the SHAPE of a governed immunization
 *  forecast — they are NOT a certified clinical decision support system, and a REAL forecast
 *  uses the current ACIP recommendations, the CDC immunization schedules, and the patient's
 *  full clinical context. The patient reference + dates are synthetic. There is NO randomness
 *  and NO clock anywhere here: the forecast is a pure function of the request + its own
 *  asOfDate + the schedule catalog (no Date.now()), so the same patient always yields the
 *  same forecast + cited rules + next-due dates — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** A per-vaccine forecast status. */
export type VaccineStatus =
  | "up-to-date"
  | "due"
  | "overdue"
  | "contraindicated"
  | "not-indicated";

/** An ACIP-style schedule rule. */
export type ScheduleRule = {
  /** Stable catalog id (cited on every forecast entry). */
  id: string;
  /** The vaccine key. */
  vaccine: string;
  /** Human-readable label. */
  label: string;
  /** Minimum age (years) for eligibility. */
  minAgeYears: number;
  /** Maximum age (years) for eligibility (undefined = no upper bound). */
  maxAgeYears?: number;
  /** Whether the vaccine recurs (annual / periodic booster) vs. a one-time dose series. */
  recurring: boolean;
  /** For a recurring vaccine: the interval (months) after which another dose is due. */
  intervalMonths?: number;
  /** For a dose series: the number of doses required for the series. */
  doses: number;
  /** Illustrative description. Demo-honest. */
  description: string;
};

/**
 * The ACIP-style schedule catalog — every forecast entry cites one of these. Illustrative/
 * synthetic (see the header). Midlife-focused (influenza, Tdap, zoster/RZV at 50+,
 * pneumococcal at 65+, COVID-19).
 */
export const ACIP_SCHEDULE: ScheduleRule[] = [
  {
    id: "rule.influenza",
    vaccine: "influenza",
    label: "Influenza (annual)",
    minAgeYears: 0,
    recurring: true,
    intervalMonths: 12,
    doses: 1,
    description: "Annual influenza vaccination for all persons 6 months and older. (Illustrative.)"
  },
  {
    id: "rule.tdap-booster",
    vaccine: "tdap",
    label: "Td/Tdap booster (every 10 years)",
    minAgeYears: 19,
    recurring: true,
    intervalMonths: 120,
    doses: 1,
    description: "Td or Tdap booster every 10 years for adults. (Illustrative.)"
  },
  {
    id: "rule.zoster-rzv",
    vaccine: "zoster",
    label: "Recombinant zoster (Shingrix), 2-dose series at 50+",
    minAgeYears: 50,
    recurring: false,
    doses: 2,
    description: "Two-dose recombinant zoster vaccine (RZV/Shingrix) for adults 50 and older. (Illustrative.)"
  },
  {
    id: "rule.pneumococcal",
    vaccine: "pneumococcal",
    label: "Pneumococcal (age 65+)",
    minAgeYears: 65,
    recurring: false,
    doses: 1,
    description: "Pneumococcal vaccination for adults 65 and older (or younger high-risk). (Illustrative.)"
  },
  {
    id: "rule.covid19",
    vaccine: "covid19",
    label: "COVID-19 (annual updated dose)",
    minAgeYears: 0,
    recurring: true,
    intervalMonths: 12,
    doses: 1,
    description: "Updated COVID-19 vaccination per current guidance. (Illustrative.)"
  }
];

const RULE_BY_ID = new Map(ACIP_SCHEDULE.map((r) => [r.id, r]));
const RULE_IDS = new Set<string>(ACIP_SCHEDULE.map((r) => r.id));

/** Is `id` a recognized schedule-rule id? */
export function isScheduleRule(id: unknown): boolean {
  return typeof id === "string" && RULE_IDS.has(id);
}

/** Look up a schedule rule by id (undefined for an off-catalog id). */
export function getScheduleRule(id: string): ScheduleRule | undefined {
  return RULE_BY_ID.get(id);
}

/** A recorded immunization-history item. */
export type ImmunizationHistoryItem = {
  /** The schedule-rule id (or vaccine key) the dose applies to. */
  ruleId: string;
  /** The ISO date the dose was administered. */
  administeredDate: string;
};

/** An immunization-forecast request. */
export type ImmunizationRequest = {
  /** Synthetic patient reference. */
  patientRef: string;
  /** The ISO date the forecast is evaluated against (time as data — no clock). */
  asOfDate: string;
  /** The patient's ISO birth date. */
  birthDate: string;
  /** The patient's immunization history. */
  history: ImmunizationHistoryItem[];
  /** Schedule-rule ids the patient has a recorded contraindication for. */
  contraindications?: string[];
};

/** A per-vaccine forecast entry. */
export type ForecastEntry = {
  /** The cited schedule-rule id. */
  ruleId: string;
  /** The vaccine key. */
  vaccine: string;
  /** The rule label. */
  label: string;
  /** The forecast status. */
  status: VaccineStatus;
  /** Whether the patient has a recorded contraindication for this vaccine. */
  contraindicated: boolean;
  /** The ISO date of the most recent recorded dose (if any). */
  lastDose?: string;
  /** The number of recorded doses. */
  dosesReceived: number;
  /** The ISO next-due date (if applicable). */
  nextDueDate?: string;
  /** Human-readable reason. */
  reason: string;
};

/** The deterministic immunization determination the agent returns. */
export type ImmunizationDetermination = {
  /** Synthetic patient reference. */
  patientRef: string;
  /** The asOfDate evaluated. */
  asOfDate: string;
  /** The patient's computed age (years) as of asOfDate. */
  ageYears: number;
  /** The per-vaccine forecast. */
  forecast: ForecastEntry[];
  /** The number of due vaccines. */
  dueCount: number;
  /** The number of overdue vaccines. */
  overdueCount: number;
  /** The number of contraindicated vaccines. */
  contraindicatedCount: number;
  /** Whether the determination requires a clinician order (any due / overdue vaccine). */
  requiresClinicianOrder: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the schedule is illustrative synthetic. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Parse an ISO date into a UTC-midnight timestamp; NaN for an unparseable date. */
function parseDate(iso: string): number {
  if (typeof iso !== "string") return NaN;
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return t;
}

/** Whole years between two ISO dates (birth → asOf). */
function ageInYears(birthDate: string, asOfDate: string): number {
  const b = new Date(parseDate(birthDate));
  const a = new Date(parseDate(asOfDate));
  if (Number.isNaN(b.getTime()) || Number.isNaN(a.getTime())) return 0;
  let years = a.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    a.getUTCMonth() < b.getUTCMonth() ||
    (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) years -= 1;
  return Math.max(0, years);
}

/** Whole months between two ISO dates (earlier → later); negative if later precedes earlier. */
function diffMonths(earlier: string, later: string): number {
  const e = new Date(parseDate(earlier));
  const l = new Date(parseDate(later));
  if (Number.isNaN(e.getTime()) || Number.isNaN(l.getTime())) return 0;
  let months = (l.getUTCFullYear() - e.getUTCFullYear()) * 12 + (l.getUTCMonth() - e.getUTCMonth());
  if (l.getUTCDate() < e.getUTCDate()) months -= 1;
  return months;
}

/** Add whole months to an ISO date, returning an ISO date (YYYY-MM-DD). */
function addMonths(iso: string, months: number): string {
  const d = new Date(parseDate(iso));
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * The deterministic immunization-forecast function — the heart of the service. DETERMINISTIC:
 * a pure function of the request + its own asOfDate + the schedule catalog (no randomness, no
 * clock). It computes the patient's age, then for each schedule rule computes a per-vaccine
 * forecast: not-indicated when age-ineligible; contraindicated when the patient has a recorded
 * contraindication (never recommended); up-to-date / due / overdue from the dose history and
 * the rule's interval (recurring) or dose series. A due / overdue vaccine requires a clinician
 * order. Nothing is administered here — this produces a forecast, not an order.
 */
export function evaluateImmunization(
  request: ImmunizationRequest
): ImmunizationDetermination {
  const asOfDate = request.asOfDate;
  const ageYears = ageInYears(request.birthDate, asOfDate);
  const history = Array.isArray(request.history) ? request.history : [];
  const contraindications = Array.isArray(request.contraindications)
    ? request.contraindications
    : [];

  const forecast: ForecastEntry[] = ACIP_SCHEDULE.map((rule) => {
    const doses = history
      .filter((h) => h.ruleId === rule.id)
      .map((h) => h.administeredDate)
      .sort();
    const dosesReceived = doses.length;
    const lastDose = dosesReceived > 0 ? doses[doses.length - 1] : undefined;
    const contraindicated = contraindications.includes(rule.id);

    const ageEligible =
      ageYears >= rule.minAgeYears &&
      (rule.maxAgeYears === undefined || ageYears <= rule.maxAgeYears);

    let status: VaccineStatus;
    let nextDueDate: string | undefined;
    let reason: string;

    if (!ageEligible) {
      status = "not-indicated";
      reason = `Not indicated: patient age ${ageYears} is outside the eligible range (min ${rule.minAgeYears}${rule.maxAgeYears !== undefined ? `, max ${rule.maxAgeYears}` : ""}).`;
    } else if (contraindicated) {
      // Contraindication ALWAYS takes precedence — never recommended.
      status = "contraindicated";
      reason = `Contraindicated: the patient has a recorded contraindication for ${rule.label}; withheld and flagged for clinician review — never recommended.`;
    } else if (rule.recurring) {
      const interval = rule.intervalMonths ?? 12;
      if (lastDose) {
        const monthsSince = diffMonths(lastDose, asOfDate);
        if (monthsSince <= interval) {
          status = "up-to-date";
          nextDueDate = addMonths(lastDose, interval);
          reason = `Up-to-date: last dose ${lastDose} is within the ${interval}-month interval; next due ${nextDueDate}.`;
        } else {
          status = "overdue";
          nextDueDate = asOfDate;
          reason = `Overdue: last dose ${lastDose} is ${monthsSince} months ago, beyond the ${interval}-month interval.`;
        }
      } else {
        status = "due";
        nextDueDate = asOfDate;
        reason = `Due: no recorded dose and the patient is age-eligible for ${rule.label}.`;
      }
    } else {
      // Dose series.
      if (dosesReceived >= rule.doses) {
        status = "up-to-date";
        reason = `Up-to-date: ${dosesReceived} of ${rule.doses} doses completed.`;
      } else if (dosesReceived > 0) {
        status = "due";
        nextDueDate = asOfDate;
        reason = `Due: dose series in progress (${dosesReceived} of ${rule.doses} doses).`;
      } else {
        // No doses and eligible: overdue once the patient is well past the minimum age.
        const monthsPastMinAge = (ageYears - rule.minAgeYears) * 12;
        if (monthsPastMinAge >= 12) {
          status = "overdue";
          reason = `Overdue: no recorded doses of the ${rule.doses}-dose series and the patient is well past the minimum age (${rule.minAgeYears}).`;
        } else {
          status = "due";
          reason = `Due: no recorded doses of the ${rule.doses}-dose series and the patient is newly age-eligible.`;
        }
        nextDueDate = asOfDate;
      }
    }

    return {
      ruleId: rule.id,
      vaccine: rule.vaccine,
      label: rule.label,
      status,
      contraindicated,
      lastDose,
      dosesReceived,
      nextDueDate,
      reason
    };
  });

  const dueCount = forecast.filter((f) => f.status === "due").length;
  const overdueCount = forecast.filter((f) => f.status === "overdue").length;
  const contraindicatedCount = forecast.filter((f) => f.status === "contraindicated").length;
  const requiresClinicianOrder = dueCount + overdueCount > 0;

  const reason = requiresClinicianOrder
    ? `Patient ${request.patientRef} (age ${ageYears}): ${dueCount} due + ${overdueCount} overdue vaccine(s) — a RECOMMENDATION requiring a clinician order (never autonomously administered)${contraindicatedCount > 0 ? `; ${contraindicatedCount} contraindicated vaccine(s) withheld` : ""}`
    : `Patient ${request.patientRef} (age ${ageYears}): no due or overdue vaccines${contraindicatedCount > 0 ? `; ${contraindicatedCount} contraindicated vaccine(s) withheld` : ""}`;

  return {
    patientRef: request.patientRef,
    asOfDate,
    ageYears,
    forecast,
    dueCount,
    overdueCount,
    contraindicatedCount,
    requiresClinicianOrder,
    reason,
    synthetic: true,
    note:
      `Immunization forecast for ${request.patientRef} as of ${asOfDate} (age ${ageYears}): ${dueCount} due, ${overdueCount} overdue, ${contraindicatedCount} contraindicated across ${forecast.length} schedule rule(s). ` +
      "Synthetic/illustrative ACIP-style schedule + age-eligibility + dose intervals — NOT a certified immunization forecaster; a real forecast uses the current ACIP recommendations, the CDC immunization schedules, and the patient's full clinical context."
  };
}

/**
 * Schedule-sourced check: does every forecast entry cite a recorded schedule rule? True when
 * every entry's ruleId is a recognized catalog rule; the guard that catches an ad-hoc /
 * un-sourced vaccine recommendation (a missing or off-catalog rule id). Anything
 * evaluateImmunization() produces satisfies it. This is the honest signal the route reports to
 * policy.immunization.schedule-sourced. A non-object / empty-forecast input is a violation.
 */
export function immunizationScheduleCited(
  determination: Pick<ImmunizationDetermination, "forecast"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const forecast = Array.isArray(determination.forecast) ? determination.forecast : [];
  if (forecast.length === 0) return false;
  return forecast.every((f) => isScheduleRule(f?.ruleId));
}

/**
 * Contraindication-honored check: is every contraindicated vaccine withheld (never
 * recommended)? True unless a forecast entry recommends (due / overdue) a vaccine the patient
 * is contraindicated for; the guard that catches recommending a contraindicated vaccine.
 * Anything evaluateImmunization() produces satisfies it (a contraindicated vaccine is always
 * status "contraindicated"). This is the honest signal the route reports to
 * policy.immunization.contraindication-honored. A non-object input is a violation.
 */
export function immunizationContraindicationHonored(
  determination: Pick<ImmunizationDetermination, "forecast"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const forecast = Array.isArray(determination.forecast) ? determination.forecast : [];
  return !forecast.some(
    (f) => f?.contraindicated === true && (f?.status === "due" || f?.status === "overdue")
  );
}

/**
 * No-autonomous-administration check: does a determination with due / overdue vaccines require
 * a clinician order? True unless a determination reports due / overdue vaccines but does not
 * require a clinician order; the guard that catches an autonomous administration (acting on a
 * forecast without a clinician). Anything evaluateImmunization() produces satisfies it. This is
 * the honest signal the route reports to policy.immunization.no-autonomous-administration. A
 * non-object input is a violation.
 */
export function immunizationNoAutonomousAdministration(
  determination:
    | Pick<ImmunizationDetermination, "dueCount" | "overdueCount" | "requiresClinicianOrder">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const due = typeof determination.dueCount === "number" ? determination.dueCount : 0;
  const overdue = typeof determination.overdueCount === "number" ? determination.overdueCount : 0;
  return !(due + overdue > 0 && determination.requiresClinicianOrder === false);
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`. Carries no free-text PHI (ref, age, and the counts only).
 */
export function immunizationSummary(determination: ImmunizationDetermination): {
  patientRef: string;
  asOfDate: string;
  ageYears: number;
  ruleCount: number;
  dueCount: number;
  overdueCount: number;
  contraindicatedCount: number;
  requiresClinicianOrder: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: determination.patientRef,
    asOfDate: determination.asOfDate,
    ageYears: determination.ageYears,
    ruleCount: determination.forecast.length,
    dueCount: determination.dueCount,
    overdueCount: determination.overdueCount,
    contraindicatedCount: determination.contraindicatedCount,
    requiresClinicianOrder: determination.requiresClinicianOrder,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A 52-year-old with a recent flu dose, a very
 * old Tdap, no zoster, and no COVID → flu up-to-date, Tdap overdue, zoster overdue,
 * pneumococcal not-indicated (age < 65), COVID due. Synthetic / de-identified.
 */
export const DEMO_IMMUNIZATION_REQUEST: ImmunizationRequest = {
  patientRef: "imm-patient-001",
  asOfDate: "2026-09-05",
  birthDate: "1974-03-15",
  history: [
    { ruleId: "rule.influenza", administeredDate: "2025-10-01" },
    { ruleId: "rule.tdap-booster", administeredDate: "2014-01-01" }
  ],
  contraindications: []
};

/**
 * A representative demo request with a contraindication (illustrative). The same patient, now
 * immunocompromised with a recorded zoster contraindication → zoster contraindicated
 * (withheld, never recommended). Synthetic.
 */
export const DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST: ImmunizationRequest = {
  patientRef: "imm-patient-002",
  asOfDate: "2026-09-05",
  birthDate: "1974-03-15",
  history: [{ ruleId: "rule.influenza", administeredDate: "2025-10-01" }],
  contraindications: ["rule.zoster-rzv"]
};

/**
 * A representative demo request for an up-to-date patient (illustrative). A 40-year-old with
 * a recent flu, a recent Tdap, and a recent COVID → all recurring up-to-date, zoster /
 * pneumococcal not-indicated (age < 50 / 65). Synthetic.
 */
export const DEMO_IMMUNIZATION_UPTODATE_REQUEST: ImmunizationRequest = {
  patientRef: "imm-patient-003",
  asOfDate: "2026-09-05",
  birthDate: "1986-06-01",
  history: [
    { ruleId: "rule.influenza", administeredDate: "2026-06-01" },
    { ruleId: "rule.tdap-booster", administeredDate: "2020-06-01" },
    { ruleId: "rule.covid19", administeredDate: "2026-06-01" }
  ],
  contraindications: []
};
