/**
 * Network Adequacy / Time-and-Distance — the deterministic, transparent payer-operations layer that takes a
 * member's location plus the plan's in-network providers and decides whether the network meets the
 * applicable TIME-AND-DISTANCE adequacy standard for a required specialty: it computes the GREAT-CIRCLE
 * (haversine) distance from the member to each in-network provider of that specialty, finds the NEAREST,
 * and flags an adequacy GAP when the nearest exceeds the standard; never autonomously CERTIFYING the
 * network to a regulator, CLOSING a gap, or ADDING / REMOVING a provider.
 *
 * Deterministic, dependency-free domain core the Network Adequacy agent (app/api/agents/network-adequacy)
 * wraps — a network-integrity service on the payer & plan operations plane of Pause's Agent Fabric. UNLIKE
 * the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM (the NPI Luhn check digit), the Household
 * Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK
 * STATISTICS, the Master-Patient-Index agent's WEIGHTED identity MATCHING, the Claim Lifecycle agent's FSM
 * TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict
 * agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly
 * agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway
 * agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit
 * Log Integrity agent's HASH CHAIN — the heart of this service is GEOSPATIAL GREAT-CIRCLE DISTANCE: the
 * haversine formula that converts two (latitude, longitude) pairs into a distance in miles, plus a
 * NEAREST-NEIGHBOR scan and a THRESHOLD comparison against the regulatory standard. A member with no
 * in-network specialist within the standard distance has a network-adequacy GAP — a compliance failure and
 * an access-to-care failure — so this service measures the distances deterministically and hands a gap to a
 * network manager.
 *
 *   Inbound:  a NetworkAdequacyRequest { caseRef, member, requiredSpecialty, maxDistanceMiles, providers[] }
 *   Outbound: a NetworkAdequacyDetermination { disposition, evaluated[], nearest, nearestDistanceMiles,
 *             matchingProviderCount, providers[], requiresNetworkReview:true, autoCertified:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other provider / network agents: distinct from the Provider
 * Credentialing agent (whether a provider is QUALIFIED and in the directory), the Referral Management agent
 * (routing a specific referral), and the Provider Benchmarking agent (a provider's cost / quality
 * percentile): this measures whether the network is geographically ADEQUATE — is there an in-network
 * provider of the required specialty within the time-and-distance standard.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every evaluated provider is sourced and the set is complete.
 * ─────────────────────────────────────────────────────────────────────
 *  An adequacy finding is trustworthy only if it evaluates exactly the submitted in-network providers of
 *  the required specialty: every evaluated provider must be a submitted one (same id, same coordinates,
 *  same specialty — no PHANTOM provider fabricating coverage that isn't in the network), every submitted
 *  provider of that specialty must be evaluated (none dropped), the counts must agree, and the nearest must
 *  be one of the evaluated. A phantom nearby provider turns a real access GAP into false adequacy.
 *  providersSourced() verifies it; the Agent Fabric enforces it via policy.adequacy.providers-sourced. (The
 *  sourced + completeness gate — mirrors the Identifier Validation Agent's identifiers-sourced and the
 *  Household Composition Agent's links-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the distances are recomputed correctly.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the haversine distance from the member to each evaluated provider's own coordinates must
 *  reproduce every reported distance, the ascending order, the nearest provider, the nearest distance, and
 *  the adequacy disposition against the standard. A mis-measured distance understates a gap (falsely
 *  certifying adequacy) or overstates one (falsely flagging a gap). The whole point is the geometry.
 *  distancesConsistent() recomputes it end-to-end; the Agent Fabric enforces it via
 *  policy.adequacy.distances-consistent. (The load-bearing correctness gate — mirrors the Medication Name
 *  Safety Agent's distances-consistent and the Provider Benchmarking Agent's stats-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the network is never autonomously certified / changed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ASSESSES adequacy — it never CERTIFIES the network as adequate to a regulator, CLOSES a gap,
 *  or ADDS / REMOVES a provider (each is a consequential action that must be authorized); every finding is a
 *  RECOMMENDATION requiring a network manager to confirm. noAutonomousNetworkChange() reports the honest
 *  signal the Agent Fabric enforces via policy.adequacy.no-autonomous-network-change. (Mirrors the Provider
 *  Benchmarking Agent's no-autonomous-tiering and the Provider Credentialing Agent's
 *  no-referral-to-expired-or-sanctioned posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — adequacy-met or adequacy-gap — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresNetworkReview:true, autoCertified:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (one that evaluates a phantom provider, mis-measures a distance, or autonomously
 *  certifies) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified network-adequacy engine.
 * ─────────────────────────────────────────────────────────────────────
 *  This computes STRAIGHT-LINE great-circle distance only — it does NOT compute drive TIME, road distance,
 *  or honor the full CMS / state ratio, county-designation, and provider-capacity rules (real time-and-
 *  distance adequacy under 42 CFR 422.116 / state QHP standards uses drive-time isochrones, county type,
 *  minimum provider counts, and telehealth credits). It IS PHI-bearing — the member's location + the
 *  specialty they need is health information — so it is on the HIPAA-audit policy. TIME IS DATA: the finding
 *  is a pure function of the coordinates + standard (no clock, no randomness), so the same request always
 *  yields the same result, which is what lets the demo, the seeded trace, and the tests agree. The member,
 *  providers, coordinates, and standards are clearly-labeled ILLUSTRATIVE synthetics.
 */

/** A member's location. */
export type AdequacyMember = {
  /** Synthetic member reference. */
  memberRef: string;
  latitude: number;
  longitude: number;
};

/** An in-network provider with a location + specialty. */
export type NetworkProvider = {
  providerId: string;
  specialty: string;
  latitude: number;
  longitude: number;
  /** Optional human label. */
  label?: string;
};

/** A network-adequacy request. */
export type NetworkAdequacyRequest = {
  /** Synthetic case reference. */
  caseRef: string;
  /** The member whose network adequacy is assessed. */
  member: AdequacyMember;
  /** The specialty the member needs an in-network provider for. */
  requiredSpecialty: string;
  /** The applicable time-and-distance standard, in miles. */
  maxDistanceMiles: number;
  /** The plan's in-network providers. */
  providers: NetworkProvider[];
};

/** A provider of the required specialty with its computed distance. */
export type EvaluatedProvider = {
  providerId: string;
  label?: string;
  specialty: string;
  latitude: number;
  longitude: number;
  /** Great-circle distance from the member, in miles (2 dp). */
  distanceMiles: number;
};

/** The nearest in-network provider of the required specialty. */
export type NearestProvider = {
  providerId: string;
  label?: string;
  distanceMiles: number;
};

/** The disposition of an adequacy assessment. */
export type NetworkAdequacyDisposition = "adequacy-met" | "adequacy-gap";

/** The deterministic finding the agent returns. */
export type NetworkAdequacyDetermination = {
  caseRef: string;
  /** The member, echoed so the distance guard can recompute. */
  member: AdequacyMember;
  requiredSpecialty: string;
  maxDistanceMiles: number;
  /** The submitted providers, echoed so the sourced guard can check correspondence. */
  providers: NetworkProvider[];
  /** The required-specialty providers with distances, sorted ascending (providerId tie-break). */
  evaluated: EvaluatedProvider[];
  /** The nearest required-specialty provider (null when there are none). */
  nearest: NearestProvider | null;
  /** The nearest distance in miles (null when there are none). */
  nearestDistanceMiles: number | null;
  /** The number of required-specialty providers evaluated. */
  matchingProviderCount: number;
  /** The disposition. */
  disposition: NetworkAdequacyDisposition;
  /** Always true — a network manager confirms every finding. */
  requiresNetworkReview: true;
  /** Always false — the agent never autonomously certifies / changes the network. */
  autoCertified: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the data is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Mean Earth radius in miles used by the great-circle computation. */
export const EARTH_RADIUS_MILES = 3958.7613;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Round to 2 decimal places (miles). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The haversine great-circle distance between two (lat, lon) points, in miles. Shared by the engine + the
 * consistency guard so they compute identically. Pure + deterministic.
 */
export function haversineMiles(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s));
}

/** Sort evaluated providers ascending by distance, tie-broken by providerId (stable, deterministic). */
function sortEvaluated(rows: EvaluatedProvider[]): EvaluatedProvider[] {
  return [...rows].sort((x, y) =>
    x.distanceMiles !== y.distanceMiles
      ? x.distanceMiles - y.distanceMiles
      : x.providerId < y.providerId
        ? -1
        : x.providerId > y.providerId
          ? 1
          : 0
  );
}

/** Derive the disposition from the nearest distance vs. the standard. */
function adequacyDisposition(
  nearestDistanceMiles: number | null,
  maxDistanceMiles: number
): NetworkAdequacyDisposition {
  return nearestDistanceMiles !== null && nearestDistanceMiles <= maxDistanceMiles
    ? "adequacy-met"
    : "adequacy-gap";
}

/**
 * The deterministic adequacy function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own coordinates + standard (no randomness, no clock). It filters the providers to the required
 * specialty, computes the haversine distance from the member to each, sorts ascending, takes the nearest,
 * and decides adequacy-met / adequacy-gap against the standard. Nothing is certified — the finding is handed
 * to a network manager.
 */
export function evaluateNetworkAdequacy(
  request: NetworkAdequacyRequest
): NetworkAdequacyDetermination {
  const member = request.member;
  const requiredSpecialty = request.requiredSpecialty;
  const maxDistanceMiles = request.maxDistanceMiles;
  const providers = Array.isArray(request.providers) ? request.providers : [];

  const evaluated = sortEvaluated(
    providers
      .filter((p) => p.specialty === requiredSpecialty)
      .map((p) => ({
        providerId: p.providerId,
        ...(p.label !== undefined ? { label: p.label } : {}),
        specialty: p.specialty,
        latitude: p.latitude,
        longitude: p.longitude,
        distanceMiles: round2(
          haversineMiles(member.latitude, member.longitude, p.latitude, p.longitude)
        )
      }))
  );

  const nearestRow = evaluated.length > 0 ? evaluated[0] : null;
  const nearest: NearestProvider | null = nearestRow
    ? {
        providerId: nearestRow.providerId,
        ...(nearestRow.label !== undefined ? { label: nearestRow.label } : {}),
        distanceMiles: nearestRow.distanceMiles
      }
    : null;
  const nearestDistanceMiles = nearestRow ? nearestRow.distanceMiles : null;
  const disposition = adequacyDisposition(nearestDistanceMiles, maxDistanceMiles);

  const reason =
    disposition === "adequacy-met"
      ? `Nearest in-network ${requiredSpecialty} provider is ${nearestDistanceMiles} mi away, within the ${maxDistanceMiles} mi standard.`
      : evaluated.length === 0
        ? `No in-network ${requiredSpecialty} provider was submitted — a network-adequacy gap.`
        : `Nearest in-network ${requiredSpecialty} provider is ${nearestDistanceMiles} mi away, beyond the ${maxDistanceMiles} mi standard — a network-adequacy gap.`;

  return {
    caseRef: request.caseRef,
    member,
    requiredSpecialty,
    maxDistanceMiles,
    providers,
    evaluated,
    nearest,
    nearestDistanceMiles,
    matchingProviderCount: evaluated.length,
    disposition,
    requiresNetworkReview: true,
    autoCertified: false,
    reason,
    synthetic: true,
    note:
      `Network adequacy ${request.caseRef}: ${disposition.toUpperCase()} for ${requiredSpecialty} — nearest ${nearestDistanceMiles === null ? "n/a" : `${nearestDistanceMiles} mi`} vs a ${maxDistanceMiles} mi standard across ${evaluated.length} in-network provider(s).` +
      " Computes STRAIGHT-LINE great-circle (haversine) distance only — NOT drive time / road distance, and NOT the full CMS 42 CFR 422.116 / state ratio, county-designation, provider-capacity, or telehealth rules. PHI-bearing — the member's location + the specialty they need is health information. Synthetic/illustrative member + providers — NOT a certified network-adequacy engine. The agent never certifies the network, closes a gap, or adds / removes a provider on its own — a network manager confirms every finding."
  };
}

/**
 * Providers-sourced + completeness check: does the finding evaluate exactly the submitted providers of the
 * required specialty? True only when every evaluated provider is a submitted one (same id, coordinates, and
 * specialty === requiredSpecialty), every submitted provider of that specialty is evaluated (none dropped),
 * the evaluated set has no duplicate id, matchingProviderCount equals the evaluated length, and the nearest
 * (if any) is one of the evaluated with a matching reported distance (else null when there are none).
 * Catches a phantom provider or a dropped one. Does NOT recompute the geometry (that is the consistency
 * check's job), so it is independent of it. Anything evaluateNetworkAdequacy() produces satisfies it. This
 * is the honest signal the route reports to policy.adequacy.providers-sourced. A non-object / malformed
 * input is a violation.
 */
export function providersSourced(
  decision:
    | {
        providers?: unknown;
        requiredSpecialty?: unknown;
        evaluated?: unknown;
        matchingProviderCount?: unknown;
        nearest?: unknown;
        nearestDistanceMiles?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const providers = Array.isArray(decision.providers) ? decision.providers : null;
  const evaluated = Array.isArray(decision.evaluated) ? decision.evaluated : null;
  const requiredSpecialty = decision.requiredSpecialty;
  if (!providers || !evaluated || typeof requiredSpecialty !== "string") return false;

  const matchingSubmitted = providers.filter(
    (p) => p && (p as NetworkProvider).specialty === requiredSpecialty
  ) as NetworkProvider[];
  if (evaluated.length !== matchingSubmitted.length) return false;
  if (decision.matchingProviderCount !== evaluated.length) return false;

  const submittedById = new Map<string, NetworkProvider>();
  for (const p of matchingSubmitted) submittedById.set(p.providerId, p);

  const seen = new Set<string>();
  for (const row of evaluated as EvaluatedProvider[]) {
    if (!row || typeof row.providerId !== "string") return false;
    if (seen.has(row.providerId)) return false;
    seen.add(row.providerId);
    const submitted = submittedById.get(row.providerId);
    if (!submitted) return false; // phantom — not a submitted required-specialty provider
    if (row.specialty !== requiredSpecialty) return false;
    if (row.latitude !== submitted.latitude || row.longitude !== submitted.longitude) return false;
  }
  // Every submitted required-specialty provider must be evaluated (none dropped).
  if (seen.size !== matchingSubmitted.length) return false;

  // Nearest linkage (internal echo, not geometry).
  const nearest = decision.nearest as NearestProvider | null | undefined;
  if (evaluated.length === 0) {
    if (nearest != null) return false;
    if (decision.nearestDistanceMiles !== null) return false;
  } else {
    if (!nearest || typeof nearest.providerId !== "string") return false;
    const row = (evaluated as EvaluatedProvider[]).find(
      (r) => r.providerId === nearest.providerId
    );
    if (!row) return false;
    if (nearest.distanceMiles !== row.distanceMiles) return false;
    if (decision.nearestDistanceMiles !== nearest.distanceMiles) return false;
  }
  return true;
}

/**
 * Distances-consistent check: recomputing the haversine distance from the member to each evaluated
 * provider's own coordinates must reproduce every reported distance, the ascending order, the nearest
 * provider, the nearest distance, and the disposition against the standard. True only when they all match.
 * Catches a mis-measured distance (a gap understated, or a false gap). The load-bearing correctness gate —
 * it recomputes the geometry from the evaluated rows' own coordinates and does NOT check the
 * providers↔evaluated correspondence (that is the sourced check's job), so it is independent of it.
 * Anything evaluateNetworkAdequacy() produces satisfies it. A non-object input is a violation.
 */
export function distancesConsistent(
  decision:
    | {
        member?: unknown;
        maxDistanceMiles?: unknown;
        evaluated?: unknown;
        nearest?: unknown;
        nearestDistanceMiles?: unknown;
        matchingProviderCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const member = decision.member as AdequacyMember | undefined;
  const evaluated = Array.isArray(decision.evaluated) ? decision.evaluated : null;
  const maxDistanceMiles = decision.maxDistanceMiles;
  if (
    !member ||
    typeof member.latitude !== "number" ||
    typeof member.longitude !== "number" ||
    !evaluated ||
    typeof maxDistanceMiles !== "number"
  ) {
    return false;
  }

  // Recompute each row's distance from its own coordinates.
  const recomputed: EvaluatedProvider[] = [];
  for (const r of evaluated as EvaluatedProvider[]) {
    if (
      !r ||
      typeof r.providerId !== "string" ||
      typeof r.latitude !== "number" ||
      typeof r.longitude !== "number"
    ) {
      return false;
    }
    const dist = round2(haversineMiles(member.latitude, member.longitude, r.latitude, r.longitude));
    if (r.distanceMiles !== dist) return false;
    recomputed.push({ ...r, distanceMiles: dist });
  }

  if (decision.matchingProviderCount !== evaluated.length) return false;

  // The reported order must be the correct ascending order (providerId tie-break).
  const sorted = sortEvaluated(recomputed);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].providerId !== (evaluated[i] as EvaluatedProvider).providerId) return false;
  }

  const nearestRow = sorted.length > 0 ? sorted[0] : null;
  const nearest = decision.nearest as NearestProvider | null | undefined;
  if (nearestRow === null) {
    if (nearest != null) return false;
    if (decision.nearestDistanceMiles !== null) return false;
  } else {
    if (!nearest) return false;
    if (nearest.providerId !== nearestRow.providerId) return false;
    if (nearest.distanceMiles !== nearestRow.distanceMiles) return false;
    if (decision.nearestDistanceMiles !== nearestRow.distanceMiles) return false;
  }

  const recomputedDisposition = adequacyDisposition(
    nearestRow ? nearestRow.distanceMiles : null,
    maxDistanceMiles
  );
  if (decision.disposition !== recomputedDisposition) return false;
  return true;
}

/**
 * No-autonomous-network-change check: did the agent avoid autonomously certifying the network / closing a
 * gap / adding-removing a provider? True unless the determination reports it auto-certified
 * (autoCertified:true) or does not require network review (requiresNetworkReview:false). Anything
 * evaluateNetworkAdequacy() produces satisfies it. This is the honest signal the route reports to
 * policy.adequacy.no-autonomous-network-change. A non-object input is a violation.
 */
export function noAutonomousNetworkChange(
  decision:
    | { autoCertified?: boolean; requiresNetworkReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoCertified === true) return false;
  if (decision.requiresNetworkReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function networkAdequacySummary(decision: NetworkAdequacyDetermination): {
  caseRef: string;
  disposition: NetworkAdequacyDisposition;
  requiredSpecialty: string;
  maxDistanceMiles: number;
  matchingProviderCount: number;
  nearestDistanceMiles: number | null;
  requiresNetworkReview: boolean;
  synthetic: boolean;
} {
  return {
    caseRef: decision.caseRef,
    disposition: decision.disposition,
    requiredSpecialty: decision.requiredSpecialty,
    maxDistanceMiles: decision.maxDistanceMiles,
    matchingProviderCount: decision.matchingProviderCount,
    nearestDistanceMiles: decision.nearestDistanceMiles,
    requiresNetworkReview: decision.requiresNetworkReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a member with two in-network cardiology providers (one nearby, one across
 * town) and an off-specialty dermatology provider; the nearest cardiologist is within the standard →
 * adequacy-met. Synthetic.
 */
export const DEMO_NETWORK_ADEQUACY_REQUEST: NetworkAdequacyRequest = {
  caseRef: "adequacy-case-001",
  member: { memberRef: "mbr-1", latitude: 40.7128, longitude: -74.006 },
  requiredSpecialty: "cardiology",
  maxDistanceMiles: 10,
  providers: [
    { providerId: "p1", specialty: "cardiology", latitude: 40.72, longitude: -74.01, label: "Downtown Cardiology" },
    { providerId: "p2", specialty: "cardiology", latitude: 40.8, longitude: -73.95, label: "Midtown Heart" },
    { providerId: "p3", specialty: "dermatology", latitude: 40.713, longitude: -74.007, label: "Village Dermatology" }
  ]
};

/**
 * A representative demo request: a member whose only in-network endocrinologists are both beyond the
 * standard distance → adequacy-gap. Synthetic.
 */
export const DEMO_NETWORK_ADEQUACY_GAP_REQUEST: NetworkAdequacyRequest = {
  caseRef: "adequacy-case-002",
  member: { memberRef: "mbr-2", latitude: 40.7128, longitude: -74.006 },
  requiredSpecialty: "endocrinology",
  maxDistanceMiles: 10,
  providers: [
    { providerId: "e1", specialty: "endocrinology", latitude: 40.9, longitude: -74.2, label: "Uptown Endocrine" },
    { providerId: "e2", specialty: "endocrinology", latitude: 41.0, longitude: -74.5, label: "Suburban Endocrine" },
    { providerId: "p3", specialty: "dermatology", latitude: 40.713, longitude: -74.007, label: "Village Dermatology" }
  ]
};

/**
 * A representative demo request: the required specialty has no in-network provider at all → adequacy-gap
 * with a null nearest. Synthetic.
 */
export const DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST: NetworkAdequacyRequest = {
  caseRef: "adequacy-case-003",
  member: { memberRef: "mbr-3", latitude: 40.7128, longitude: -74.006 },
  requiredSpecialty: "rheumatology",
  maxDistanceMiles: 20,
  providers: [
    { providerId: "p1", specialty: "cardiology", latitude: 40.72, longitude: -74.01, label: "Downtown Cardiology" },
    { providerId: "p3", specialty: "dermatology", latitude: 40.713, longitude: -74.007, label: "Village Dermatology" }
  ]
};
