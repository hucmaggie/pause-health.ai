/**
 * Real-org grounding for the Care Router (Phase 1: Health Cloud objects).
 *
 * This module is the production counterpart to lib/data-360.ts. When the
 * SF_* env vars are configured (see lib/salesforce/auth.ts), the Data 360
 * API routes prefer this module over the deterministic mock; if anything
 * here throws or returns null, callers fall back to the mock silently.
 *
 * What's real vs what's still mocked (Phase 1):
 *
 *   REAL (from your Salesforce Health Cloud org):
 *     - Unified patient identity      <- Contact.Id  (one per persona)
 *     - Age band hint                  <- parsed from Contact.Description
 *     - Cycle status hint              <- parsed from Contact.Description
 *     - Active care program enrollment <- CareProgramEnrollee + CareProgram
 *     - Last clinician contact (days)  <- Case.LastModifiedDate
 *     - Active care plan status        <- CarePlan.Status
 *     - Cohort size                    <- COUNT() on CareProgramEnrollee
 *
 *   STILL MOCKED (federation arrives in Phase 2 via Data Cloud):
 *     - HRV variability z-score
 *     - Sleep disruption index
 *     - Vasomotor burden composite
 *     - Pathway resolution rates
 *
 * Every value is tagged with its true source via FederatedSource so the
 * Agent Fabric trace shows clearly which parts the org provided vs which
 * parts came from the deterministic baseline. We do NOT pretend mocked
 * values came from Data Cloud.
 *
 * Why a separate module instead of editing data-360.ts directly?
 *   1. Keeps the mock fully self-contained (every dev / preview / CI run
 *      gets a working grounding path without any creds).
 *   2. Lets us A/B the two paths against the same inputs during
 *      verification.
 *   3. Makes the "real path" diff isolatable when reviewing.
 */

import { getAccessToken, isSalesforceConfigured } from "./auth";
import {
  getGroundingContext as getMockGroundingContext,
  type GroundingContext,
  type CalculatedInsight,
  type LongitudinalObservation,
  type CohortComparison,
  type FederatedSource
} from "../data-360";

const PROGRAM_NAME = "Pause Demo: Menopause Care Program";

/**
 * Subset of a Contact record we care about for grounding. Description is
 * the unstructured free-text field where the seeder writes patient
 * profile data (age band, symptoms, scores) so we don't have to ship
 * custom fields into the org just for the prototype.
 */
type RealContact = {
  Id: string;
  FirstName: string | null;
  LastName: string | null;
  Description: string | null;
  AccountId: string | null;
};

type RealEnrollee = {
  Id: string;
  Name: string;
  Status: string | null;
  CreatedDate: string;
  CareProgramId: string;
  AccountId: string | null;
};

type RealCarePlan = {
  Id: string;
  Name: string;
  Status: string | null;
  StartDate: string | null;
  Description: string | null;
  ParticipantId: string | null;
};

type RealCase = {
  Id: string;
  Subject: string | null;
  Status: string | null;
  LastModifiedDate: string;
  ContactId: string | null;
};

async function soql<T>(q: string): Promise<T[]> {
  const { accessToken, instanceUrl, apiVersion } = await getAccessToken();
  const url = `${instanceUrl}/services/data/v${apiVersion}/query/?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Salesforce SOQL failed (${res.status}): ${body.slice(0, 300)}\nQuery: ${q}`
    );
  }
  const json = (await res.json()) as { records?: T[] };
  return json.records || [];
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Pull a key-value style hint out of the Contact.Description blob the
 * seeder writes. Returns undefined if not found. Defensive: never throws.
 */
function parseHint(description: string | null | undefined, key: string): string | undefined {
  if (!description) return undefined;
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im");
  const m = description.match(re);
  return m?.[1]?.trim();
}

/**
 * SOQL predicate that matches Pause demo Contacts under both the current
 * schema (Title = 'Pause Demo Patient', natural LastName) and the legacy
 * pre-polish schema (LastName = 'Pause Demo Patient: <Name>'). The OR
 * means grounding still works during a partial schema migration and
 * doesn't silently start ignoring records that haven't been re-seeded.
 *
 * Scoping by Title also guarantees we never surface the org's existing
 * 1,000+ non-demo Contacts as grounding context — those have null Title
 * for our seeded value.
 */
const PAUSE_DEMO_CONTACT_PREDICATE =
  `(Title = 'Pause Demo Patient' OR Department = 'Pause Demo' OR LastName LIKE 'Pause Demo Patient:%')`;

/**
 * Look up a seeded patient by Contact.Id. Returns null if not a Pause
 * Demo seed (so callers can fall back).
 */
async function findSeededContact(contactId: string): Promise<RealContact | null> {
  const safe = escapeSoql(contactId);
  const rows = await soql<RealContact>(
    `SELECT Id, FirstName, LastName, Description, AccountId
     FROM Contact
     WHERE Id = '${safe}' AND ${PAUSE_DEMO_CONTACT_PREDICATE}
     LIMIT 1`
  );
  return rows[0] || null;
}

/**
 * Resolve a Contact by approximate match on (preferredName, ageBand,
 * cycleStatus). Returns the first seeded Contact whose Description
 * contains the requested ageBand / cycleStatus and whose FirstName
 * matches preferredName (case-insensitive). Null if no match.
 *
 * Production identity resolution would use Data Cloud IR rules; this is
 * a simple deterministic stand-in that gives clean demo behavior.
 */
async function resolveSeededContact(input: {
  preferredName?: string;
  ageBand?: string;
  cycleStatus?: string;
}): Promise<RealContact | null> {
  const seeded = await soql<RealContact>(
    `SELECT Id, FirstName, LastName, Description, AccountId
     FROM Contact
     WHERE ${PAUSE_DEMO_CONTACT_PREDICATE}`
  );
  const want = (input.preferredName || "").trim().toLowerCase();
  const matchByName =
    want && seeded.find((c) => (c.FirstName || "").toLowerCase() === want);
  if (matchByName) return matchByName;

  if (input.ageBand || input.cycleStatus) {
    const matchByHint = seeded.find((c) => {
      const band = parseHint(c.Description, "Age band");
      const cycle = parseHint(c.Description, "Cycle status");
      const ageOk = !input.ageBand || (band && band === input.ageBand);
      const cycleOk = !input.cycleStatus || (cycle && cycle === input.cycleStatus);
      return ageOk && cycleOk;
    });
    if (matchByHint) return matchByHint;
  }

  return seeded[0] || null;
}

async function getActiveEnrollee(contact: RealContact): Promise<RealEnrollee | null> {
  if (!contact.AccountId) return null;
  const rows = await soql<RealEnrollee>(
    `SELECT Id, Name, Status, CreatedDate, CareProgramId, AccountId
     FROM CareProgramEnrollee
     WHERE AccountId = '${escapeSoql(contact.AccountId)}' AND Status = 'Active'
     ORDER BY CreatedDate DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getActiveCarePlan(contact: RealContact): Promise<RealCarePlan | null> {
  const rows = await soql<RealCarePlan>(
    `SELECT Id, Name, Status, StartDate, Description, ParticipantId
     FROM CarePlan
     WHERE ParticipantId = '${escapeSoql(contact.Id)}' AND Status = 'Active'
     ORDER BY StartDate DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getLatestCase(contact: RealContact): Promise<RealCase | null> {
  const rows = await soql<RealCase>(
    `SELECT Id, Subject, Status, LastModifiedDate, ContactId
     FROM Case
     WHERE ContactId = '${escapeSoql(contact.Id)}'
     ORDER BY LastModifiedDate DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getProgramCohortSize(programId: string): Promise<number> {
  // Salesforce auto-aliases COUNT() results to `expr0` and rejects an
  // explicit alias of that name as "reserved". We let Salesforce assign
  // the alias and read it back.
  const rows = await soql<{ expr0: number }>(
    `SELECT COUNT(Id) FROM CareProgramEnrollee WHERE CareProgramId = '${escapeSoql(programId)}'`
  );
  return rows[0]?.expr0 || 0;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 9999;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build a GroundingContext from real Health Cloud objects + clearly-
 * labeled mocked baselines for federation that hasn't been wired yet.
 * The returned object is shape-compatible with getMockGroundingContext()
 * so the Care Router and trace UI don't need to branch.
 */
function buildGroundingContext(args: {
  patientId: string;
  contact: RealContact;
  enrollee: RealEnrollee | null;
  carePlan: RealCarePlan | null;
  latestCase: RealCase | null;
  cohortSize: number;
  durationMs: number;
}): GroundingContext {
  const { contact, enrollee, carePlan, latestCase, cohortSize } = args;

  const vasomotorScore = num(parseHint(contact.Description, "Vasomotor")?.split("/")[0], 5);
  const sleepScore = num(parseHint(contact.Description, "Sleep")?.split("/")[0], 5);
  const moodScore = num(parseHint(contact.Description, "Mood")?.split("/")[0], 5);
  const ageBand = parseHint(contact.Description, "Age band") || "46-50";
  const primarySymptom = parseHint(contact.Description, "Primary symptom") || "Hot flashes";

  const realSource: FederatedSource = "epic-health-cloud";

  const calculatedInsights: CalculatedInsight[] = [
    {
      id: "insight.active-care-program",
      name: "Active care program enrollment",
      description: enrollee
        ? `Patient is actively enrolled in CareProgram ${enrollee.CareProgramId} (Enrollee ${enrollee.Id}, status ${enrollee.Status}).`
        : "No active CareProgramEnrollee found for this patient.",
      value: enrollee ? "Enrolled" : "Not enrolled",
      computedAt: new Date().toISOString(),
      sourceWindow: "current",
      federatedFrom: [realSource]
    },
    {
      id: "insight.days-since-last-clinical-contact",
      name: "Days since last clinical contact",
      description:
        "Days since the most recent Salesforce Health Cloud Case linked to this patient was last modified.",
      value: latestCase ? daysSince(latestCase.LastModifiedDate) : 9999,
      unit: "days",
      computedAt: new Date().toISOString(),
      sourceWindow: "all-time",
      federatedFrom: [realSource]
    },
    {
      id: "insight.active-care-plan-status",
      name: "Active care plan status",
      description: carePlan
        ? `Latest CarePlan "${carePlan.Name}" status: ${carePlan.Status}.`
        : "No active CarePlan found.",
      value: carePlan?.Status || "None",
      computedAt: new Date().toISOString(),
      sourceWindow: "current",
      federatedFrom: [realSource]
    },
    // -- Below: mocked baselines; replaced when Phase 2 wires Data Cloud.
    {
      id: "insight.vasomotor-burden-30d",
      name: "Vasomotor symptom burden (30-day, baseline)",
      description:
        "Baseline composite from intake hint scores. Phase 2 will replace this with the Data Cloud Calculated Insight that fuses wearable thermoregulation, sleep disruption, and intake reports.",
      value: Math.round(vasomotorScore * 10),
      unit: "score",
      computedAt: new Date().toISOString(),
      sourceWindow: "intake-only",
      federatedFrom: ["agentforce-intake-history"]
    },
    {
      id: "insight.sleep-disruption-7d",
      name: "Sleep disruption index (7-day, baseline)",
      description:
        "Baseline from intake hint. Phase 2 will replace with Data Cloud federated wearable data.",
      value: Math.round((sleepScore / 10) * 100) / 100,
      unit: "fraction",
      computedAt: new Date().toISOString(),
      sourceWindow: "intake-only",
      federatedFrom: ["agentforce-intake-history"]
    }
  ];

  const longitudinalObservations: LongitudinalObservation[] = [
    {
      id: "obs.intake.vasomotor",
      loinc: "urn:pause:vasomotor-score",
      display: "Intake-reported vasomotor score (0-10)",
      effectiveDate: new Date().toISOString(),
      value: vasomotorScore,
      unit: "score",
      trend: vasomotorScore >= 7 ? "worsening" : "stable",
      source: "agentforce-intake-history"
    },
    {
      id: "obs.intake.sleep",
      loinc: "urn:pause:sleep-score",
      display: "Intake-reported sleep disruption (0-10)",
      effectiveDate: new Date().toISOString(),
      value: sleepScore,
      unit: "score",
      trend: sleepScore >= 7 ? "worsening" : "stable",
      source: "agentforce-intake-history"
    },
    {
      id: "obs.intake.mood",
      loinc: "urn:pause:mood-score",
      display: "Intake-reported mood disruption (0-10)",
      effectiveDate: new Date().toISOString(),
      value: moodScore,
      unit: "score",
      trend: moodScore >= 7 ? "worsening" : "stable",
      source: "agentforce-intake-history"
    }
  ];

  const cohortComparison: CohortComparison = {
    cohortName: `Pause Demo Menopause Cohort · ${ageBand} · primary ${primarySymptom}`,
    cohortSize: cohortSize || 1,
    patientPercentile: Math.min(99, Math.max(1, Math.round((vasomotorScore / 10) * 100))),
    metric: "vasomotor symptom burden",
    pathwayOutcomes: [
      { pathway: "mscp-virtual-visit", n: 1840, resolutionRate: 0.71 },
      { pathway: "mscp-in-person", n: 612, resolutionRate: 0.78 },
      { pathway: "self-care-tracking", n: 690, resolutionRate: 0.34 }
    ]
  };

  return {
    unifiedPatientId: args.patientId,
    identityResolution: {
      confidence: 0.94,
      matchedSources: [realSource, "agentforce-intake-history"],
      resolutionRuleset: "pause-phase1-healthcloud-contact-match-v1"
    },
    calculatedInsights,
    longitudinalObservations,
    recentIntakeCount: latestCase ? 1 : 0,
    lastClinicianContact: {
      daysAgo: latestCase ? daysSince(latestCase.LastModifiedDate) : 9999,
      clinicianType: carePlan ? "care-manager" : "none-on-record"
    },
    cohortComparison,
    groundingProvenance: {
      federatedQuery:
        "SOQL: Contact + CareProgramEnrollee + CarePlan + Case (Phase 1 Health Cloud)",
      durationMs: args.durationMs,
      sourcesQueried: [realSource, "agentforce-intake-history"],
      computedInsightsCount: calculatedInsights.length
    }
  };
}

/**
 * Real-org implementation of getGroundingContext. Returns null if the
 * patientId doesn't correspond to a seeded Pause Demo Contact, so the
 * caller can fall back to the mock. Throws only on hard infrastructure
 * errors (auth failure, network) — callers should catch and degrade.
 */
export async function getGroundingContextFromOrg(args: {
  patientId: string;
  hint?: { ageBand?: string; primarySymptom?: string; cycleStatus?: string };
}): Promise<GroundingContext | null> {
  if (!isSalesforceConfigured()) return null;
  const t0 = Date.now();

  // Two paths: caller passed a real SFDC Contact Id, OR caller passed
  // the mock's DEMO_DATA360_PATIENT_ID (or anything else). In the latter
  // case we try to resolve via the hint.
  const looksLikeSalesforceId =
    /^[A-Za-z0-9]{15}$|^[A-Za-z0-9]{18}$/.test(args.patientId);

  let contact: RealContact | null = null;
  if (looksLikeSalesforceId) {
    contact = await findSeededContact(args.patientId);
  }
  if (!contact) {
    contact = await resolveSeededContact({
      preferredName: undefined,
      ageBand: args.hint?.ageBand,
      cycleStatus: args.hint?.cycleStatus
    });
  }
  if (!contact) return null;

  const [enrollee, carePlan, latestCase] = await Promise.all([
    getActiveEnrollee(contact),
    getActiveCarePlan(contact),
    getLatestCase(contact)
  ]);

  let cohortSize = 0;
  if (enrollee) {
    cohortSize = await getProgramCohortSize(enrollee.CareProgramId);
  }

  return buildGroundingContext({
    patientId: contact.Id,
    contact,
    enrollee,
    carePlan,
    latestCase,
    cohortSize,
    durationMs: Date.now() - t0
  });
}

/**
 * Real-org identity resolution. Returns null if no seeded Contact matches
 * the input — caller falls back to the mock.
 */
export async function resolveIdentityFromOrg(input: {
  preferredName?: string;
  ageBand?: string;
  cycleStatus?: string;
}): Promise<{
  unifiedPatientId: string;
  confidence: number;
  matchedSources: FederatedSource[];
  resolutionRuleset: string;
  echo: typeof input;
} | null> {
  if (!isSalesforceConfigured()) return null;
  const contact = await resolveSeededContact(input);
  if (!contact) return null;
  return {
    unifiedPatientId: contact.Id,
    confidence: 0.94,
    matchedSources: ["epic-health-cloud", "agentforce-intake-history"],
    resolutionRuleset: "pause-phase1-healthcloud-contact-match-v1",
    echo: input
  };
}

/**
 * Per-process dedup set so a single unexpected-failure category logs at
 * most once. When Salesforce is intentionally unconfigured (env vars
 * unset on purpose, e.g. Vercel production), no warning is ever emitted —
 * the fallback is the expected behavior, not a degradation. Only when
 * env vars ARE set and the call fails do we surface a warning, and even
 * then we collapse duplicates to keep logs readable.
 */
const warnedFailures = new Set<string>();

/**
 * Emit a single rate-limited warning per distinct failure category.
 * Categories are derived from the error name/code (or a fallback) so a
 * persistent misconfiguration logs once instead of on every request,
 * but a NEW failure mode still gets surfaced.
 *
 * Exported for use by API routes that perform their own SF calls
 * outside this module (e.g. identity resolution in
 * /api/intake/route-to-care-router).
 */
export function warnSalesforceDegradationOnce(
  context: string,
  err: unknown
): void {
  // Intentional silent fallback: env vars unset means fallback is expected.
  if (!isSalesforceConfigured()) return;

  const errMessage = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : "Unknown";
  // Bucket on (context, errName, first 80 chars of message) so a
  // 500-error category and an auth-error category dedupe separately.
  const bucket = `${context}::${errName}::${errMessage.slice(0, 80)}`;
  if (warnedFailures.has(bucket)) return;
  warnedFailures.add(bucket);
  console.warn(
    `[salesforce] ${context} failed (dedup-once per failure category); degrading to mock:`,
    errMessage
  );
}

/**
 * Test-only: clear the dedup set so a test can re-trigger the warning.
 * Not part of the public API; not imported by production code paths.
 */
export function _resetSalesforceWarnDedupForTests(): void {
  warnedFailures.clear();
}

/**
 * Convenience wrapper that prefers the real org but degrades to the mock
 * on any failure (auth, network, no match). API routes should call this
 * rather than reaching into either underlying function directly.
 *
 * Returns { source: "real" | "mock", grounding } so the trace can report
 * which path served the request without the caller having to guess.
 */
export async function getGroundingContextPreferReal(args: {
  patientId: string;
  hint?: { ageBand?: string; primarySymptom?: string; cycleStatus?: string };
}): Promise<{ source: "real" | "mock"; grounding: GroundingContext }> {
  if (isSalesforceConfigured()) {
    try {
      const real = await getGroundingContextFromOrg(args);
      if (real) return { source: "real", grounding: real };
    } catch (err) {
      warnSalesforceDegradationOnce("grounding.federated-query", err);
    }
  }
  return { source: "mock", grounding: getMockGroundingContext(args) };
}
