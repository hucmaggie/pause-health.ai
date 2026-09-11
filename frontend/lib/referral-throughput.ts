/**
 * Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp) — the deterministic, transparent
 * care-coordination layer that, given a referral-routing NETWORK — a source that feeds intake pools, which route
 * through capacity-limited CHANNELS (specialist types / facilities) to a sink of available appointment slots,
 * every edge carrying a CAPACITY (how many referrals per period it can carry) — computes the MAXIMUM number of
 * referrals that can be routed end-to-end (the maximum flow), and identifies the BOTTLENECK (the minimum cut:
 * the saturated edges whose total capacity caps throughput) — without ever booking, dispatching, or routing a
 * single referral on its own. A referral coordinator confirms.
 *
 * Deterministic, dependency-free domain core the Referral Throughput agent (app/api/agents/referral-throughput)
 * wraps — a network-capacity agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the heart
 * of this service is the MAXIMUM-FLOW / MINIMUM-CUT computation via EDMONDS–KARP (the BFS-augmenting-path
 * refinement of FORD–FULKERSON): repeatedly find a shortest augmenting path from source to sink in the residual
 * graph by breadth-first search, push the path's bottleneck residual capacity along it, and update residual
 * capacities (including back-edges) until no augmenting path remains; the total pushed is the maximum flow, and
 * the set of nodes still reachable from the source in the final residual graph induces the minimum cut. By the
 * max-flow min-cut theorem the maximum flow EQUALS the minimum cut capacity — that equality is the invariant this
 * service reports and defends. This is DIFFERENT from every other fabric pattern: it is NOT the Network Build-Out
 * agent's MINIMUM SPANNING TREE (Kruskal's — connect all nodes at least cost; this pushes as much flow as
 * possible through capacities), NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH (one cheapest path; this
 * saturates the whole network), NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, NOT the Batch
 * Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK, NOT the Caseload Balancing agent's
 * BIN-PACKING, NOT the Household Composition agent's UNION-FIND, NOT the SLA Worklist agent's EARLIEST-DEADLINE-
 * FIRST SCHEDULING, and NOT the Timeline Merge agent's K-WAY MERGE — it is max-flow / min-cut.
 *
 *   Inbound:  a ReferralNetworkRequest { networkRef, source, sink, edges[] }  (edges: { from, to, capacity })
 *   Outbound: a ReferralThroughputDetermination { flows[], maxFlow, totalDemand, minCutEdges[], minCutCapacity,
 *             disposition, nodeCount, edgeCount, requiresCoordinatorReview:true, autoRouted:false, reason,
 *             synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the flow is sourced and conservation-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A throughput plan is trustworthy only if the reported per-edge flows are a REAL, FEASIBLE flow over the
 *  submitted network: every edge's flow must be between 0 and its SUBMITTED capacity (no fabricated edge, no
 *  over-capacity flow), flow must be CONSERVED at every node other than the source and sink (total in === total
 *  out), the reported maxFlow must equal the net flow OUT of the source AND the net flow INTO the sink, and
 *  nodeCount / edgeCount must be honest. A fabricated edge, an over-capacity flow, or a conservation violation
 *  corrupts the plan. flowSourced() verifies it; the Agent Fabric enforces it via policy.referralflow.flow-
 *  sourced. It does NOT recompute the optimum — that is the optimality gate's job — so the two are isolable.
 *  (The sourced + self-consistency gate — mirrors the Network Build-Out Agent's tree-sourced and the Batch
 *  Partition Agent's partition-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the throughput is optimal (Edmonds–Karp recomputes; max-flow = min-cut).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running Edmonds–Karp over the submitted network must reproduce the reported maxFlow, and the reported
 *  minCutCapacity must equal that maxFlow (the max-flow min-cut theorem). A sub-maximal flow understates the
 *  achievable throughput; an overstated flow claims capacity that doesn't exist. throughputOptimal() recomputes
 *  the maximum flow + the min-cut capacity from the network INDEPENDENT of the reported flows (it compares the
 *  scalar optimum, not the per-edge assignment — different maximum flows can achieve the same value), so a
 *  fabricated flow that still reports the optimal value fails sourced only, and a real-but-sub-maximal flow fails
 *  optimal only — the two gates are isolable. The Agent Fabric enforces it via policy.referralflow.throughput-
 *  optimal. (The load-bearing correctness gate — mirrors the Network Build-Out Agent's cost-optimal and the Care
 *  Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous routing.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PLANS on paper — it never books, dispatches, or routes a referral on its own (each is a scheduling
 *  action that must be authorized); every throughput plan is a RECOMMENDATION requiring a referral coordinator to
 *  confirm. noAutonomousRoute() reports the honest signal the Agent Fabric enforces via
 *  policy.referralflow.no-autonomous-route. (Mirrors the Network Build-Out Agent's no-autonomous-provision and
 *  the Batch Partition Agent's no-autonomous-assign — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A throughput plan — unconstrained or bottlenecked — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCoordinatorReview:true, autoRouted:false). A bottlenecked disposition is NOT a governance block — it is
 *  the honest finding that a min-cut caps throughput below demand (surfacing the bottleneck is the whole point). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (an infeasible / over-capacity flow, a
 *  sub-maximal or overstated throughput, or an autonomous routing) — which the Agent Fabric rejects before it can
 *  leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified capacity-planning / scheduling system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real referral capacity planning weighs clinical urgency, specialty match, geography, payer networks, and
 *  provider preference — not a bare max-flow over illustrative capacities. This routes the supplied illustrative
 *  capacities only. TIME IS DATA: the capacities are plain numbers and the flow is a pure function of them (no
 *  clock, no randomness — augmenting paths chosen by a deterministic BFS with a stable node order), so the same
 *  request always yields the same determination, which is what lets the demo, the seeded trace, and the tests
 *  agree. The network is a clearly-labeled ILLUSTRATIVE synthetic. The node labels reference intake pools /
 *  specialties / slots, so a determination is treated as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** One directed capacity edge in the referral network. */
export type ReferralEdge = {
  from: string;
  to: string;
  /** Capacity — referrals per period this edge can carry. Non-negative. */
  capacity: number;
};

/** A request: the network (source, sink, capacity edges). */
export type ReferralNetworkRequest = {
  networkRef: string;
  source: string;
  sink: string;
  edges: ReferralEdge[];
};

export type ReferralThroughputDisposition = "unconstrained" | "bottlenecked";

/** One edge's assigned flow in the reported plan. */
export type EdgeFlow = {
  from: string;
  to: string;
  flow: number;
};

/** One saturated edge on the minimum cut (the bottleneck). */
export type CutEdge = {
  from: string;
  to: string;
  capacity: number;
};

/** The deterministic finding the agent returns. */
export type ReferralThroughputDetermination = {
  networkRef: string;
  source: string;
  sink: string;
  /** The submitted edges, echoed so the guards can recompute. */
  edges: ReferralEdge[];
  /** The per-edge flow assignment (a feasible maximum flow). */
  flows: EdgeFlow[];
  /** The maximum number of referrals routable end-to-end. */
  maxFlow: number;
  /** Total capacity leaving the source — the demand the network is asked to satisfy. */
  totalDemand: number;
  /** The minimum-cut edges — the saturated bottleneck. */
  minCutEdges: CutEdge[];
  /** The minimum-cut capacity — equals maxFlow (max-flow min-cut theorem). */
  minCutCapacity: number;
  /** Number of distinct nodes in the network. */
  nodeCount: number;
  /** Number of capacity edges submitted. */
  edgeCount: number;
  disposition: ReferralThroughputDisposition;
  /** Always true — a referral coordinator confirms every throughput plan. */
  requiresCoordinatorReview: true;
  /** Always false — the agent never autonomously routes referrals. */
  autoRouted: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Collect the distinct node ids referenced by the edges + the source/sink, in a stable order. */
function collectNodes(request: ReferralNetworkRequest): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  add(request.source);
  add(request.sink);
  for (const e of Array.isArray(request.edges) ? request.edges : []) {
    add(e.from);
    add(e.to);
  }
  return order.sort();
}

/**
 * EDMONDS–KARP maximum flow. Builds a residual-capacity map (summing parallel edges), then repeatedly BFS for a
 * shortest augmenting path from source to sink, pushing the path's bottleneck along it and decrementing forward /
 * incrementing reverse residuals, until no path remains. Returns the max-flow value and the residual map (from
 * which the min-cut is read). Neighbours are visited in sorted node order so augmenting-path selection — and
 * therefore the whole computation — is deterministic. Pure.
 */
function edmondsKarp(
  nodes: string[],
  edges: ReferralEdge[],
  source: string,
  sink: string
): { maxFlow: number; residual: Map<string, Map<string, number>> } {
  const known = new Set(nodes);
  // residual[u][v] = remaining capacity on u->v (forward + accumulated reverse).
  const residual = new Map<string, Map<string, number>>();
  const ensure = (u: string) => {
    if (!residual.has(u)) residual.set(u, new Map());
    return residual.get(u)!;
  };
  for (const n of nodes) ensure(n);
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue; // edge to an unknown node
    if (e.from === e.to) continue; // self-loop carries nothing
    if (!(e.capacity > 0)) continue;
    const row = ensure(e.from);
    row.set(e.to, (row.get(e.to) ?? 0) + e.capacity);
    // Make sure the reverse entry exists (starts at 0) so back-edges can carry cancelling flow.
    const rev = ensure(e.to);
    if (!rev.has(e.from)) rev.set(e.from, rev.get(e.from) ?? 0);
  }

  if (source === sink || !known.has(source) || !known.has(sink)) {
    return { maxFlow: 0, residual };
  }

  const neighbours = (u: string): string[] =>
    Array.from(residual.get(u)?.keys() ?? []).sort();

  let maxFlow = 0;
  for (;;) {
    // BFS for a shortest augmenting path; record parents.
    const parent = new Map<string, string>();
    parent.set(source, source);
    const queue: string[] = [source];
    let found = false;
    while (queue.length > 0 && !found) {
      const u = queue.shift()!;
      for (const v of neighbours(u)) {
        const cap = residual.get(u)!.get(v) ?? 0;
        if (cap > 0 && !parent.has(v)) {
          parent.set(v, u);
          if (v === sink) {
            found = true;
            break;
          }
          queue.push(v);
        }
      }
    }
    if (!found) break;

    // Bottleneck along the found path.
    let bottleneck = Number.POSITIVE_INFINITY;
    for (let v = sink; v !== source; v = parent.get(v)!) {
      const u = parent.get(v)!;
      bottleneck = Math.min(bottleneck, residual.get(u)!.get(v) ?? 0);
    }
    // Apply it: decrement forward, increment reverse.
    for (let v = sink; v !== source; v = parent.get(v)!) {
      const u = parent.get(v)!;
      residual.get(u)!.set(v, (residual.get(u)!.get(v) ?? 0) - bottleneck);
      residual.get(v)!.set(u, (residual.get(v)!.get(u) ?? 0) + bottleneck);
    }
    maxFlow += bottleneck;
  }
  return { maxFlow, residual };
}

/** The maximum flow value (scalar optimum) — recomputed by the optimality gate INDEPENDENT of any reported flow. */
export function maxFlowValue(request: ReferralNetworkRequest): number {
  const nodes = collectNodes(request);
  const edges = Array.isArray(request.edges) ? request.edges : [];
  return edmondsKarp(nodes, edges, request.source, request.sink).maxFlow;
}

/**
 * The minimum cut — the saturated edges from the source-reachable side of the final residual graph to the rest.
 * By the max-flow min-cut theorem the total capacity of these edges equals the maximum flow. Deterministic:
 * source-side membership is computed by BFS over positive residuals, and the cut edges are the SUBMITTED edges
 * whose tail is source-side and head is not, returned in a stable order.
 */
export function minCut(request: ReferralNetworkRequest): { edges: CutEdge[]; capacity: number } {
  const nodes = collectNodes(request);
  const edges = Array.isArray(request.edges) ? request.edges : [];
  const { residual } = edmondsKarp(nodes, edges, request.source, request.sink);

  // Source-reachable set in the residual graph.
  const reachable = new Set<string>();
  const queue: string[] = [request.source];
  reachable.add(request.source);
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of Array.from(residual.get(u)?.keys() ?? []).sort()) {
      if ((residual.get(u)!.get(v) ?? 0) > 0 && !reachable.has(v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }

  // Aggregate submitted capacity across the cut, per (from,to), then emit stable, de-duplicated edges.
  const known = new Set(nodes);
  const agg = new Map<string, { from: string; to: string; capacity: number }>();
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    if (e.from === e.to || !(e.capacity > 0)) continue;
    if (reachable.has(e.from) && !reachable.has(e.to)) {
      const key = `${e.from} ${e.to}`;
      const prev = agg.get(key);
      if (prev) prev.capacity += e.capacity;
      else agg.set(key, { from: e.from, to: e.to, capacity: e.capacity });
    }
  }
  const cutEdges = Array.from(agg.values()).sort((a, b) =>
    a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to < b.to ? -1 : a.to > b.to ? 1 : 0
  );
  const capacity = cutEdges.reduce((s, e) => s + e.capacity, 0);
  return { edges: cutEdges, capacity };
}

/**
 * Reconstruct a feasible maximum flow's per-edge flows. Runs Edmonds–Karp, then for each submitted forward edge
 * reads the flow as (original capacity − remaining residual on that ordered pair), clamped at ≥ 0 and never above
 * the edge's own capacity. Parallel edges to the same (from,to) share the residual; the reconstruction assigns
 * the shared flow greedily across them in submission order so each edge's reported flow ≤ its own capacity and
 * the per-pair total matches. Deterministic. Empty / trivial networks → [].
 */
export function reconstructFlows(request: ReferralNetworkRequest): EdgeFlow[] {
  const nodes = collectNodes(request);
  const edges = Array.isArray(request.edges) ? request.edges : [];
  const known = new Set(nodes);
  const { residual } = edmondsKarp(nodes, edges, request.source, request.sink);

  // Per ordered pair, the total flow = submitted capacity − remaining residual (bounded ≥ 0).
  const submittedCap = new Map<string, number>();
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to || !(e.capacity > 0)) continue;
    const key = `${e.from} ${e.to}`;
    submittedCap.set(key, (submittedCap.get(key) ?? 0) + e.capacity);
  }
  const pairFlow = new Map<string, number>();
  for (const [key, cap] of submittedCap) {
    const [u, v] = key.split(" ");
    const remaining = residual.get(u)?.get(v) ?? 0;
    pairFlow.set(key, Math.max(0, Math.min(cap, cap - remaining)));
  }

  // Distribute each pair's flow across its parallel edges in submission order.
  const remainingToAssign = new Map(pairFlow);
  const flows: EdgeFlow[] = [];
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to || !(e.capacity > 0)) {
      flows.push({ from: e.from, to: e.to, flow: 0 });
      continue;
    }
    const key = `${e.from} ${e.to}`;
    const left = remainingToAssign.get(key) ?? 0;
    const assigned = Math.max(0, Math.min(e.capacity, left));
    remainingToAssign.set(key, left - assigned);
    flows.push({ from: e.from, to: e.to, flow: assigned });
  }
  return flows;
}

/**
 * The deterministic throughput-planning function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own network (no randomness, no clock). It computes the maximum flow, reconstructs the per-edge
 * flows, reads off the min-cut, derives the total demand (capacity leaving the source) and the disposition.
 * Nothing is routed — the plan is handed to a referral coordinator.
 */
export function evaluateReferralThroughput(
  request: ReferralNetworkRequest
): ReferralThroughputDetermination {
  const nodes = collectNodes(request);
  const edges = Array.isArray(request.edges) ? request.edges : [];
  const known = new Set(nodes);
  const maxFlow = maxFlowValue(request);
  const flows = reconstructFlows(request);
  const { edges: minCutEdges, capacity: minCutCapacity } = minCut(request);

  const totalDemand = edges
    .filter((e) => known.has(e.from) && known.has(e.to) && e.from === request.source && e.from !== e.to)
    .reduce((s, e) => s + Math.max(0, e.capacity), 0);

  const disposition: ReferralThroughputDisposition =
    maxFlow >= totalDemand ? "unconstrained" : "bottlenecked";

  const reason =
    disposition === "unconstrained"
      ? `Network ${request.networkRef} can route all ${totalDemand} referral(s) of demand end-to-end — maximum throughput ${maxFlow}, no binding bottleneck below demand.`
      : `Network ${request.networkRef} is BOTTLENECKED — maximum throughput ${maxFlow} of ${totalDemand} referral(s) demanded; the minimum cut (capacity ${minCutCapacity}) across ${minCutEdges.length} edge(s) caps it. Add capacity on the cut to raise throughput.`;

  return {
    networkRef: request.networkRef,
    source: request.source,
    sink: request.sink,
    edges,
    flows,
    maxFlow,
    totalDemand,
    minCutEdges,
    minCutCapacity,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    disposition,
    requiresCoordinatorReview: true,
    autoRouted: false,
    reason,
    synthetic: true,
    note:
      `Maximum flow ${request.networkRef}: ${disposition.toUpperCase()} — ` +
      (disposition === "unconstrained"
        ? `throughput ${maxFlow} meets demand ${totalDemand} via EDMONDS–KARP MAX-FLOW. `
        : `throughput ${maxFlow} < demand ${totalDemand}; min-cut capacity ${minCutCapacity} is the bottleneck (EDMONDS–KARP MAX-FLOW / MIN-CUT). `) +
      "Real referral capacity planning weighs clinical urgency, specialty match, geography, payer networks, and provider preference — not a bare max-flow over illustrative capacities. Synthetic/illustrative capacities — NOT a certified capacity-planning / scheduling system. The agent never books, dispatches, or routes a referral on its own — a referral coordinator confirms every plan. Node labels reference intake pools / specialties / slots, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + conservation-consistency check: is the reported plan a REAL, FEASIBLE flow over the submitted
 * network? Every edge's flow must be between 0 and its SUBMITTED capacity (matched by from/to, aggregating
 * parallel edges), flow must be CONSERVED at every node other than source and sink (in === out), the reported
 * maxFlow must equal the net out of source AND the net into sink, and nodeCount / edgeCount must be honest.
 * Catches a fabricated edge, an over-capacity flow, or a conservation violation. Does NOT recompute the optimum
 * (that is the optimality gate's job), so it is independent of it. Anything evaluateReferralThroughput()
 * produces satisfies it. This is the honest signal the plan reports to policy.referralflow.flow-sourced. A
 * non-object / malformed input is a violation.
 */
export function flowSourced(
  decision:
    | {
        source?: unknown;
        sink?: unknown;
        edges?: unknown;
        flows?: unknown;
        maxFlow?: unknown;
        nodeCount?: unknown;
        edgeCount?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const source = typeof decision.source === "string" ? decision.source : null;
  const sink = typeof decision.sink === "string" ? decision.sink : null;
  const edges = Array.isArray(decision.edges) ? (decision.edges as ReferralEdge[]) : null;
  const flows = Array.isArray(decision.flows) ? (decision.flows as EdgeFlow[]) : null;
  if (!source || !sink || !edges || !flows) return false;

  const validEdge = (e: ReferralEdge): boolean =>
    !!e &&
    typeof e.from === "string" &&
    typeof e.to === "string" &&
    typeof e.capacity === "number" &&
    Number.isFinite(e.capacity);
  for (const e of edges) if (!validEdge(e)) return false;
  for (const f of flows) {
    if (!f || typeof f.from !== "string" || typeof f.to !== "string" || typeof f.flow !== "number" || !Number.isFinite(f.flow)) {
      return false;
    }
  }
  if (flows.length !== edges.length) return false; // one reported flow per submitted edge, in order

  // Aggregate submitted capacity per ordered pair.
  const capByPair = new Map<string, number>();
  for (const e of edges) {
    const key = `${e.from} ${e.to}`;
    capByPair.set(key, (capByPair.get(key) ?? 0) + Math.max(0, e.capacity));
  }
  // Each reported flow must be non-negative and each pair's total flow ≤ that pair's capacity.
  const flowByPair = new Map<string, number>();
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    const e = edges[i];
    if (f.from !== e.from || f.to !== e.to) return false; // flow must align with its edge
    if (f.flow < 0) return false;
    const key = `${f.from} ${f.to}`;
    flowByPair.set(key, (flowByPair.get(key) ?? 0) + f.flow);
  }
  for (const [key, totalFlow] of flowByPair) {
    if (totalFlow > (capByPair.get(key) ?? 0) + 1e-9) return false; // over capacity
  }

  // Conservation: for every node except source/sink, inflow === outflow.
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const f of flows) {
    outflow.set(f.from, (outflow.get(f.from) ?? 0) + f.flow);
    inflow.set(f.to, (inflow.get(f.to) ?? 0) + f.flow);
  }
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  nodes.add(source);
  nodes.add(sink);
  for (const n of nodes) {
    if (n === source || n === sink) continue;
    if (Math.abs((inflow.get(n) ?? 0) - (outflow.get(n) ?? 0)) > 1e-9) return false;
  }

  // maxFlow === net out of source === net into sink.
  const netOutSource = (outflow.get(source) ?? 0) - (inflow.get(source) ?? 0);
  const netInSink = (inflow.get(sink) ?? 0) - (outflow.get(sink) ?? 0);
  if (typeof decision.maxFlow !== "number") return false;
  if (Math.abs(decision.maxFlow - netOutSource) > 1e-9) return false;
  if (Math.abs(decision.maxFlow - netInSink) > 1e-9) return false;

  if (decision.nodeCount !== undefined && decision.nodeCount !== nodes.size) return false;
  if (decision.edgeCount !== undefined && decision.edgeCount !== edges.length) return false;
  return true;
}

/**
 * Optimality check: re-running Edmonds–Karp over the submitted network must reproduce the reported maxFlow, and
 * the reported minCutCapacity must equal that maxFlow (max-flow min-cut theorem), and the disposition must
 * follow. True only when the recompute agrees. Catches a sub-maximal flow (understated throughput) and an
 * overstated flow. The load-bearing correctness gate — it recomputes the maximum flow + min-cut from the network
 * INDEPENDENT of the reported per-edge flows, so a fabricated flow that still reports the optimal value fails
 * sourced only while a real-but-sub-maximal flow fails here — the two gates are isolable. Anything
 * evaluateReferralThroughput() produces satisfies it. A non-object input is a violation.
 */
export function throughputOptimal(
  decision:
    | {
        networkRef?: unknown;
        source?: unknown;
        sink?: unknown;
        edges?: unknown;
        maxFlow?: unknown;
        totalDemand?: unknown;
        minCutCapacity?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const source = typeof decision.source === "string" ? decision.source : null;
  const sink = typeof decision.sink === "string" ? decision.sink : null;
  const edges = Array.isArray(decision.edges) ? (decision.edges as ReferralEdge[]) : null;
  if (!source || !sink || !edges) return false;
  for (const e of edges) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string" || typeof e.capacity !== "number" || !Number.isFinite(e.capacity)) {
      return false;
    }
  }
  const request: ReferralNetworkRequest = {
    networkRef: typeof decision.networkRef === "string" ? decision.networkRef : "",
    source,
    sink,
    edges
  };
  const optimal = maxFlowValue(request);
  if (typeof decision.maxFlow !== "number" || decision.maxFlow !== optimal) return false;

  const { capacity: cutCapacity } = minCut(request);
  if (decision.minCutCapacity !== undefined && decision.minCutCapacity !== cutCapacity) return false;
  // Max-flow min-cut theorem: they must agree.
  if (cutCapacity !== optimal) return false;

  if (decision.totalDemand !== undefined && decision.disposition !== undefined) {
    const known = new Set(collectNodes(request));
    const totalDemand = edges
      .filter((e) => known.has(e.from) && known.has(e.to) && e.from === source && e.from !== e.to)
      .reduce((s, e) => s + Math.max(0, e.capacity), 0);
    const expected: ReferralThroughputDisposition =
      optimal >= totalDemand ? "unconstrained" : "bottlenecked";
    if (decision.disposition !== expected) return false;
  }
  return true;
}

/**
 * No-autonomous-routing check: did the agent avoid booking / routing on its own? True unless the determination
 * reports it auto-routed referrals (autoRouted:true) or does not require coordinator review
 * (requiresCoordinatorReview:false). Anything evaluateReferralThroughput() produces satisfies it. This is the
 * honest signal the plan reports to policy.referralflow.no-autonomous-route. A non-object input is a violation.
 */
export function noAutonomousRoute(
  decision: { autoRouted?: boolean; requiresCoordinatorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoRouted === true) return false;
  if (decision.requiresCoordinatorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a throughput plan. */
export function referralThroughputSummary(decision: ReferralThroughputDetermination): {
  networkRef: string;
  disposition: ReferralThroughputDisposition;
  maxFlow: number;
  totalDemand: number;
  minCutCapacity: number;
  minCutEdgeCount: number;
  nodeCount: number;
  edgeCount: number;
  requiresCoordinatorReview: boolean;
  synthetic: boolean;
} {
  return {
    networkRef: decision.networkRef,
    disposition: decision.disposition,
    maxFlow: decision.maxFlow,
    totalDemand: decision.totalDemand,
    minCutCapacity: decision.minCutCapacity,
    minCutEdgeCount: decision.minCutEdges.length,
    nodeCount: decision.nodeCount,
    edgeCount: decision.edgeCount,
    requiresCoordinatorReview: decision.requiresCoordinatorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a menopause-clinic referral network. The source (intake) feeds two intake pools,
 * which route through capacity-limited specialty channels (gyn, endo) to a sink of appointment slots. The
 * source's outbound capacity (demand) exceeds what the specialty channels can carry, so throughput is capped by a
 * min-cut on the specialty edges — "bottlenecked." Synthetic; PHI-adjacent (intake/specialty/slot labels).
 */
export const DEMO_REFERRAL_THROUGHPUT_REQUEST: ReferralNetworkRequest = {
  networkRef: "referral-network-menoclinic-5510",
  source: "intake",
  sink: "slots",
  edges: [
    { from: "intake", to: "pool-a", capacity: 6 },
    { from: "intake", to: "pool-b", capacity: 6 },
    { from: "pool-a", to: "gyn", capacity: 5 },
    { from: "pool-b", to: "endo", capacity: 4 },
    { from: "pool-a", to: "endo", capacity: 2 },
    { from: "gyn", to: "slots", capacity: 4 },
    { from: "endo", to: "slots", capacity: 4 }
  ]
};

/**
 * A representative demo request whose specialty + slot capacities comfortably exceed the source demand, so every
 * referral routes — "unconstrained." Synthetic.
 */
export const DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST: ReferralNetworkRequest = {
  networkRef: "referral-network-clinic-2201",
  source: "intake",
  sink: "slots",
  edges: [
    { from: "intake", to: "triage", capacity: 3 },
    { from: "triage", to: "gyn", capacity: 5 },
    { from: "gyn", to: "slots", capacity: 5 }
  ]
};

/**
 * A representative demo request with a classic diamond that exercises the residual back-edge cancellation (the
 * augmenting path s→a→b→t uses the cross edge a→b): maximum flow is 3 against a demand of 4, capped by the
 * min-cut {s→a (2), b→t (1)}. "Bottlenecked." Synthetic.
 */
export const DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST: ReferralNetworkRequest = {
  networkRef: "referral-network-diamond-88",
  source: "s",
  sink: "t",
  edges: [
    { from: "s", to: "a", capacity: 2 },
    { from: "s", to: "b", capacity: 2 },
    { from: "a", to: "b", capacity: 1 },
    { from: "a", to: "t", capacity: 2 },
    { from: "b", to: "t", capacity: 1 }
  ]
};
