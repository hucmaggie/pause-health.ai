/**
 * Care-Transition Routing / Least-Burden Path — the deterministic, transparent care-coordination layer that,
 * given a patient's current care SETTING (a start node), a goal setting, and a directed graph of PERMITTED
 * transitions between settings each carrying a non-negative BURDEN weight (wait days + travel + cost proxy +
 * risk), finds the MINIMUM-TOTAL-BURDEN path from start to goal — or reports that the goal is unreachable —
 * without ever initiating the transition, booking the setting, or moving the patient on its own. A care lead
 * confirms.
 *
 * Deterministic, dependency-free domain core the Care Routing agent (app/api/agents/care-routing) wraps — a
 * care-coordination / transition-planning service on the patient & clinical plane of Pause's Agent Fabric.
 * UNLIKE the KPI Trend agent's LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1
 * KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge
 * agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE
 * EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's
 * GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the
 * Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE
 * / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Medication Name Safety
 * agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Enrollment
 * Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and,
 * CRUCIALLY, UNLIKE the Care Pathway agent's TOPOLOGICAL ORDERING (which sequences ALL the required steps of
 * ONE protocol into a dependency order — no weights, no source/target, no choosing among alternative routes),
 * the Claim Lifecycle agent's BFS REACHABILITY (which finds the fewest-HOPS path across an UNWEIGHTED status
 * state machine — edge count, not edge weight), and the Transitions of Care agent's MEDICATION RECONCILIATION
 * (which reconciles meds across ONE encounter — it routes nothing) — the heart of this service is DIJKSTRA'S
 * WEIGHTED SHORTEST PATH: the classic single-source shortest-path over a graph with non-negative edge
 * weights, repeatedly settling the nearest unsettled node and relaxing its out-edges (dist[v] = min(dist[v],
 * dist[u] + w(u,v))), then reconstructing the minimum-total-weight path by walking predecessors back. A
 * greedy or hand-picked route sends a patient the long way round — more waiting, more travel, more cost — so
 * this optimizes DETERMINISTICALLY and hands the route to a human.
 *
 *   Inbound:  a CareRouteRequest { routeRef, start, goal, edges[] }
 *   Outbound: a CareRouteDetermination { path[], totalCost, hops, reachable, disposition,
 *             requiresCareLeadReview:true, autoRouted:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the reported path is sourced and well-formed.
 * ─────────────────────────────────────────────────────────────────────
 *  A route is trustworthy only if the reported path is a REAL walk of the submitted graph: it must start at
 *  the start node and end at the goal, every consecutive pair must be a SUBMITTED edge (no FABRICATED
 *  transition), and the reported totalCost must equal the sum of those edges' weights (the hop count must
 *  match too). A fabricated edge invents a transition that isn't permitted. pathSourced() verifies it; the
 *  Agent Fabric enforces it via policy.route.path-sourced. It does NOT check that the path is the shortest —
 *  that is the optimality gate's job — so the two are isolable. (The sourced + well-formedness gate — mirrors
 *  the Claim Lifecycle Agent's states-sourced and the Care Pathway Agent's steps-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the route is optimal (or honestly unreachable).
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing Dijkstra's shortest path over the submitted edges must reproduce the reported minimum total
 *  burden (and the reachable flag + disposition). A sub-optimal route over-burdens the patient; a false
 *  "unreachable" strands them. routeOptimal() recomputes it end-to-end, INDEPENDENT of the reported path (it
 *  compares only the reported totalCost + reachability against the recompute), so a fabricated-edge path
 *  reporting the true optimum fails sourced only, and a real-edge but sub-optimal path fails optimal only —
 *  the two gates are isolable. The Agent Fabric enforces it via policy.route.route-optimal. (The load-bearing
 *  correctness gate — mirrors the Claim Lifecycle Agent's transition-consistent and the Outreach Agent's
 *  allocation-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous routing.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ROUTES on paper — it never initiates the transition, books the setting, or moves the patient on
 *  its own (each is a care-delivery action that must be authorized); every route is a RECOMMENDATION
 *  requiring a care lead to confirm. noAutonomousRouting() reports the honest signal the Agent Fabric
 *  enforces via policy.route.no-autonomous-routing. (Mirrors the Care Gap Agent's human-review posture and
 *  the Outreach Agent's no-autonomous-schedule — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A route — route-found or no-route — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCareLeadReview:true, autoRouted:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (a fabricated-edge path, a sub-optimal / false-unreachable route, or an autonomous routing)
 *  — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified care-transition / discharge-planning system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real transition planning weighs clinical appropriateness, bed availability, payer authorization, patient
 *  preference, and caregiver capacity — not a single scalar burden per edge. This optimizes the supplied
 *  illustrative graph only. TIME IS DATA: the route is a pure function of the graph's own edges + weights (no
 *  clock, no randomness), so the same request always yields the same path, which is what lets the demo, the
 *  seeded trace, and the tests agree. The settings + transitions are clearly-labeled ILLUSTRATIVE synthetics.
 */

/** A directed, weighted transition between two care settings. `weight` is a non-negative burden. */
export type CareEdge = {
  from: string;
  to: string;
  weight: number;
  label?: string;
};

/** A care-routing request. `start` / `goal` are node ids referenced by the edges. */
export type CareRouteRequest = {
  routeRef: string;
  start: string;
  goal: string;
  edges: CareEdge[];
};

export type CareRouteDisposition = "route-found" | "no-route";

/** The deterministic finding the agent returns. */
export type CareRouteDetermination = {
  routeRef: string;
  start: string;
  goal: string;
  /** The submitted edges, echoed so the guards can recompute. */
  edges: CareEdge[];
  /** The minimum-total-burden path as an ordered list of node ids (empty when no-route). */
  path: string[];
  /** The minimum total burden along `path` (null when no-route). */
  totalCost: number | null;
  /** The number of transitions in the path (path.length - 1; 0 when no-route). */
  hops: number;
  reachable: boolean;
  disposition: CareRouteDisposition;
  /** Always true — a care lead confirms every route. */
  requiresCareLeadReview: true;
  /** Always false — the agent never autonomously routes. */
  autoRouted: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Collect the node set referenced by the edges plus the start/goal. */
function nodesOf(edges: CareEdge[], start: string, goal: string): Set<string> {
  const nodes = new Set<string>([start, goal]);
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return nodes;
}

/**
 * DIJKSTRA'S WEIGHTED SHORTEST PATH — the heart of the service. Computes the minimum-total-weight path from
 * `start` to `goal` over a graph with non-negative edge weights, repeatedly settling the nearest unsettled
 * node (deterministic tie-break: lowest node id) and relaxing its out-edges, then reconstructing the path by
 * walking predecessors back. Returns the path (empty if the goal is unreachable) and the distance (null if
 * unreachable). Deterministic: relaxations use strict `<`, so the first-settled predecessor wins a tie.
 */
export function dijkstra(
  edges: CareEdge[],
  start: string,
  goal: string
): { path: string[]; distance: number | null } {
  const nodes = nodesOf(edges, start, goal);
  const adjacency = new Map<string, CareEdge[]>();
  for (const n of nodes) adjacency.set(n, []);
  for (const e of edges) {
    // Ignore negative weights defensively (Dijkstra requires non-negative).
    if (e.weight < 0) continue;
    adjacency.get(e.from)?.push(e);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const settled = new Set<string>();
  for (const n of nodes) {
    dist.set(n, Infinity);
    prev.set(n, null);
  }
  dist.set(start, 0);

  while (settled.size < nodes.size) {
    // Pick the unsettled node with the smallest distance (tie-break: lowest node id).
    let u: string | null = null;
    let best = Infinity;
    for (const n of [...nodes].sort()) {
      if (settled.has(n)) continue;
      const d = dist.get(n) ?? Infinity;
      if (d < best) {
        best = d;
        u = n;
      }
    }
    if (u === null || best === Infinity) break; // remaining nodes unreachable
    settled.add(u);
    if (u === goal) break;

    for (const e of adjacency.get(u) ?? []) {
      const alt = (dist.get(u) ?? Infinity) + e.weight;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, u);
      }
    }
  }

  const goalDist = dist.get(goal) ?? Infinity;
  if (goalDist === Infinity) return { path: [], distance: null };

  // Reconstruct the path start → goal.
  const path: string[] = [];
  let cur: string | null = goal;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return { path, distance: goalDist };
}

/**
 * The deterministic routing function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own edges + weights (no randomness, no clock). It runs Dijkstra, reconstructs the least-burden
 * path, and derives the disposition. Nothing is routed — the path is handed to a care lead.
 */
export function evaluateCareRoute(request: CareRouteRequest): CareRouteDetermination {
  const edges = Array.isArray(request.edges) ? request.edges : [];
  const { path, distance } = dijkstra(edges, request.start, request.goal);
  const reachable = distance !== null;
  const disposition: CareRouteDisposition = reachable ? "route-found" : "no-route";
  const hops = reachable ? Math.max(0, path.length - 1) : 0;

  const reason = reachable
    ? `Least-burden route from ${request.start} to ${request.goal}: total burden ${distance} over ${hops} transition(s) (${path.join(" \u2192 ")}).`
    : `No route from ${request.start} to ${request.goal}: the goal setting is unreachable across the submitted transitions.`;

  return {
    routeRef: request.routeRef,
    start: request.start,
    goal: request.goal,
    edges,
    path,
    totalCost: distance,
    hops,
    reachable,
    disposition,
    requiresCareLeadReview: true,
    autoRouted: false,
    reason,
    synthetic: true,
    note:
      `Care-transition routing ${request.routeRef}: ${disposition.toUpperCase()} \u2014 ` +
      (reachable
        ? `minimum total burden ${distance} from ${request.start} to ${request.goal} over ${hops} transition(s), via DIJKSTRA'S WEIGHTED SHORTEST PATH (dist[v] = min(dist[v], dist[u] + w(u,v))).`
        : `the goal ${request.goal} is unreachable from ${request.start} across the submitted transitions.`) +
      " Real transition planning weighs clinical appropriateness, bed availability, payer authorization, patient preference, and caregiver capacity \u2014 not a single scalar burden per edge. Synthetic/illustrative settings + transitions \u2014 NOT a certified care-transition / discharge-planning system. The agent never initiates the transition, books the setting, or moves the patient on its own \u2014 a care lead confirms every route."
  };
}

/** Index the submitted edges by "from|to" for O(1) membership + weight lookup. */
function edgeIndex(edges: CareEdge[]): Map<string, CareEdge> {
  const idx = new Map<string, CareEdge>();
  for (const e of edges) idx.set(`${e.from}|${e.to}`, e);
  return idx;
}

/**
 * Sourced + well-formedness check: is the reported path a REAL walk of the submitted graph? For a route-found
 * determination: the path must be non-empty, start at `start`, end at `goal`, every consecutive pair must be
 * a SUBMITTED edge (no fabricated transition), the reported totalCost must equal the sum of those edges'
 * weights, and hops must equal path.length - 1. For a no-route determination: the path must be empty, the
 * totalCost null, and reachable false. Catches a fabricated edge or a malformed path. Does NOT recompute the
 * shortest path (that is the optimality gate's job), so it is independent of it. Anything evaluateCareRoute()
 * produces satisfies it. This is the honest signal the route reports to policy.route.path-sourced. A
 * non-object / malformed input is a violation.
 */
export function pathSourced(
  decision:
    | {
        start?: unknown;
        goal?: unknown;
        edges?: unknown;
        path?: unknown;
        totalCost?: unknown;
        hops?: unknown;
        reachable?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const edges = Array.isArray(decision.edges) ? (decision.edges as CareEdge[]) : null;
  const path = Array.isArray(decision.path) ? (decision.path as string[]) : null;
  if (!edges || !path) return false;
  if (typeof decision.start !== "string" || typeof decision.goal !== "string") return false;

  if (decision.disposition === "no-route" || decision.reachable === false) {
    // An honest no-route: empty path, null cost, not reachable.
    if (path.length !== 0) return false;
    if (decision.totalCost !== null && decision.totalCost !== undefined) return false;
    if (decision.reachable === true) return false;
    return true;
  }

  // A route-found path must be a real walk of the graph.
  if (path.length === 0) return false;
  if (path[0] !== decision.start) return false;
  if (path[path.length - 1] !== decision.goal) return false;

  const idx = edgeIndex(edges);
  let sum = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const e = idx.get(`${path[i]}|${path[i + 1]}`);
    if (!e) return false; // fabricated transition
    sum += e.weight;
  }
  if (typeof decision.totalCost !== "number" || decision.totalCost !== sum) return false;
  if (decision.hops !== undefined && decision.hops !== path.length - 1) return false;
  return true;
}

/**
 * Optimality check: recomputing Dijkstra's shortest path over the submitted edges must reproduce the reported
 * minimum total burden, the reachable flag, and the disposition. True only when the recompute agrees.
 * Catches a sub-optimal route or a false "unreachable". The load-bearing correctness gate — it recomputes the
 * optimum from the edges INDEPENDENT of the reported path (it compares only the reported totalCost +
 * reachability, not the path edges), so a fabricated-edge path that still reports the true optimum fails
 * sourced while recomputing here, and a real-edge but sub-optimal path fails here while passing sourced — the
 * two gates are isolable. Anything evaluateCareRoute() produces satisfies it. A non-object input is a
 * violation.
 */
export function routeOptimal(
  decision:
    | {
        start?: unknown;
        goal?: unknown;
        edges?: unknown;
        totalCost?: unknown;
        reachable?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const edges = Array.isArray(decision.edges) ? (decision.edges as CareEdge[]) : null;
  if (!edges) return false;
  if (typeof decision.start !== "string" || typeof decision.goal !== "string") return false;

  const { distance } = dijkstra(edges, decision.start, decision.goal);
  const reachable = distance !== null;

  if (reachable) {
    if (decision.reachable !== true) return false;
    if (decision.disposition !== undefined && decision.disposition !== "route-found") return false;
    if (typeof decision.totalCost !== "number" || decision.totalCost !== distance) return false;
  } else {
    if (decision.reachable !== false) return false;
    if (decision.disposition !== undefined && decision.disposition !== "no-route") return false;
    if (decision.totalCost !== null && decision.totalCost !== undefined) return false;
  }
  return true;
}

/**
 * No-autonomous-routing check: did the agent avoid autonomously routing the patient? True unless the
 * determination reports it auto-routed (autoRouted:true) or does not require care-lead review
 * (requiresCareLeadReview:false). Anything evaluateCareRoute() produces satisfies it. This is the honest
 * signal the route reports to policy.route.no-autonomous-routing. A non-object input is a violation.
 */
export function noAutonomousRouting(
  decision:
    | { autoRouted?: boolean; requiresCareLeadReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoRouted === true) return false;
  if (decision.requiresCareLeadReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a route. */
export function careRouteSummary(decision: CareRouteDetermination): {
  routeRef: string;
  disposition: CareRouteDisposition;
  edgeCount: number;
  hops: number;
  totalCost: number | null;
  reachable: boolean;
  requiresCareLeadReview: boolean;
  synthetic: boolean;
} {
  return {
    routeRef: decision.routeRef,
    disposition: decision.disposition,
    edgeCount: decision.edges.length,
    hops: decision.hops,
    totalCost: decision.totalCost,
    reachable: decision.reachable,
    requiresCareLeadReview: decision.requiresCareLeadReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request whose least-burden route is a 3-hop path through a skilled-nursing facility
 * and home-health (route-found, total burden 7). Synthetic settings.
 */
export const DEMO_CARE_ROUTE_REQUEST: CareRouteRequest = {
  routeRef: "care-route-001",
  start: "hospital",
  goal: "home",
  edges: [
    { from: "hospital", to: "snf", weight: 2, label: "Discharge to skilled nursing" },
    { from: "hospital", to: "rehab", weight: 4, label: "Discharge to inpatient rehab" },
    { from: "snf", to: "home-health", weight: 3, label: "Step down to home health" },
    { from: "rehab", to: "home-health", weight: 1, label: "Step down to home health" },
    { from: "snf", to: "home", weight: 6, label: "Discharge home from SNF" },
    { from: "rehab", to: "home", weight: 5, label: "Discharge home from rehab" },
    { from: "home-health", to: "home", weight: 2, label: "Graduate to self-care at home" }
  ]
};

/** A representative demo request whose least-burden route is the direct edge (route-found, total burden 2). */
export const DEMO_CARE_ROUTE_DIRECT_REQUEST: CareRouteRequest = {
  routeRef: "care-route-002",
  start: "clinic",
  goal: "specialist",
  edges: [
    { from: "clinic", to: "specialist", weight: 2, label: "Direct referral" },
    { from: "clinic", to: "imaging", weight: 1, label: "Order imaging first" },
    { from: "imaging", to: "specialist", weight: 5, label: "Specialist after imaging" }
  ]
};

/** A representative demo request whose goal setting is unreachable (no-route). Synthetic. */
export const DEMO_CARE_ROUTE_NO_ROUTE_REQUEST: CareRouteRequest = {
  routeRef: "care-route-003",
  start: "hospital",
  goal: "home",
  edges: [
    { from: "hospital", to: "snf", weight: 2, label: "Discharge to skilled nursing" },
    { from: "snf", to: "rehab", weight: 3, label: "Transfer to rehab" }
    // No edge reaches "home": the goal is unreachable.
  ]
};
