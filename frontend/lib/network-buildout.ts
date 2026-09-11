/**
 * Provider Network Build-Out / Minimum Spanning Tree (Kruskal's Algorithm) — the deterministic, transparent
 * care-coordination layer that, given a set of care SITES (clinics / facilities / exchange endpoints) and a set
 * of candidate LINKS between them — each link carrying a build COST (data-exchange setup cost, referral-corridor
 * distance, integration effort) — selects the MINIMUM-TOTAL-COST set of links that connects every site into ONE
 * network (a minimum spanning tree), reporting the chosen links, the total build cost, and whether the candidate
 * links can connect everything at all — without ever provisioning, activating, or ordering a single link on its
 * own. A network architect confirms.
 *
 * Deterministic, dependency-free domain core the Network Build-Out agent (app/api/agents/network-buildout) wraps
 * — a network-planning agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the heart of
 * this service is MINIMUM SPANNING TREE construction via KRUSKAL'S ALGORITHM: sort the candidate links by
 * ascending cost, then walk them cheapest-first, adding a link to the tree iff it JOINS TWO DISTINCT COMPONENTS
 * (a union-find cycle check rejects a link whose endpoints are already connected). Union-find here is a
 * SUBROUTINE — the cycle test inside the greedy edge selection — NOT the computation itself: this is emphatically
 * NOT the Household Composition agent's UNION-FIND CONNECTED-COMPONENT LABELING (which groups records into
 * families by transitively merging match edges — it does not choose a minimum-cost subset, has no edge weights,
 * and reports components, not a tree). It is also DIFFERENT from every other fabric pattern — NOT the Care
 * Routing agent's DIJKSTRA'S SHORTEST PATH (which minimizes the cost of ONE path between TWO nodes; MST minimizes
 * the total cost to connect ALL nodes), NOT the Batch Partition agent's LINEAR PARTITION, NOT the Care Pathway
 * agent's TOPOLOGICAL ORDERING, NOT the Outreach agent's 0/1 KNAPSACK, NOT the PCP Matching agent's GALE–SHAPLEY
 * STABLE MATCHING, NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Huffman agent's
 * OPTIMAL PREFIX CODING, NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, NOT the Timeline Merge
 * agent's K-WAY MERGE, and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY. Kruskal's tree is provably
 * optimal — no spanning tree of the candidate links has a smaller total cost — and the minimum total build cost
 * is the invariant this service reports and defends.
 *
 *   Inbound:  a NetworkBuildoutRequest { networkRef, sites[], links[] }  (links: { a, b, cost })
 *   Outbound: a NetworkBuildoutDetermination { chosenLinks[], totalCost, componentCount, disposition, siteCount,
 *             linkCount, requiresArchitectReview:true, autoProvisioned:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the tree is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A build plan is trustworthy only if it is a REAL, self-consistent accounting of the submitted candidates: the
 *  chosen links must each be a SUBMITTED candidate link (same endpoints, same cost — no fabricated link, no
 *  altered cost), they must form a FOREST over the submitted sites (NO cycle — verified by a union-find pass over
 *  the chosen links), the reported totalCost must equal the sum of the chosen links' costs, the reported
 *  componentCount must equal the number of connected components the chosen links induce over the sites, and
 *  siteCount / linkCount must be honest; the disposition must follow (connected iff componentCount === 1). A
 *  connected build plan chooses exactly siteCount-1 links; a partitioned one chooses (siteCount - componentCount)
 *  links. A fabricated link, an altered cost, or a cycle corrupts the plan. treeSourced() verifies it; the Agent
 *  Fabric enforces it via policy.netbuildout.tree-sourced. It does NOT recompute the optimal tree — that is the
 *  optimality gate's job — so the two are isolable. (The sourced + self-consistency gate — mirrors the Batch
 *  Partition Agent's partition-sourced and the Huffman Agent's code-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the tree is cost-optimal (Kruskal's recomputes).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running Kruskal's algorithm over the submitted sites + links must reproduce the reported totalCost (and the
 *  connected / partitioned disposition). A sub-optimal tree wastes build budget — the whole point of the
 *  minimization. treeOptimal() recomputes the minimum total cost by KRUSKAL'S ALGORITHM INDEPENDENT of the
 *  reported links (it recomputes the scalar optimum from the sites + links, not from the reported tree —
 *  different minimum spanning trees can tie on total cost), so a fabricated tree that still reports the optimal
 *  total cost fails sourced only, and a real-but-sub-optimal tree fails optimal only — the two gates are
 *  isolable. The Agent Fabric enforces it via policy.netbuildout.cost-optimal. (The load-bearing correctness
 *  gate — mirrors the Batch Partition Agent's load-optimal and the Care Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous provisioning.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PLANS on paper — it never provisions, activates, or orders a link on its own (each is an
 *  infrastructure change that must be authorized); every build plan is a RECOMMENDATION requiring a network
 *  architect to confirm. noAutonomousProvision() reports the honest signal the Agent Fabric enforces via
 *  policy.netbuildout.no-autonomous-provision. (Mirrors the Batch Partition Agent's no-autonomous-assign and the
 *  Huffman Agent's no-autonomous-deploy — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A build plan — connected or partitioned — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresArchitectReview:true, autoProvisioned:false). A partitioned disposition is NOT a governance block — it
 *  is the honest finding that the candidate links cannot connect every site (surfacing it is the whole point). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / cyclic tree, a
 *  sub-optimal plan, or an autonomous provisioning) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified network-design system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real provider-network design weighs adequacy standards, contracted rates, capacity, redundancy, and
 *  regulatory requirements — not a bare minimum spanning tree over illustrative costs. This builds a tree over
 *  the supplied illustrative costs only. TIME IS DATA: the costs are plain numbers and the tree is a pure
 *  function of them (no clock, no randomness — ties broken by a stable link ordering), so the same request
 *  always yields the same determination, which is what lets the demo, the seeded trace, and the tests agree. The
 *  network is a clearly-labeled ILLUSTRATIVE synthetic. The site labels reference clinics / facilities, so a
 *  determination is treated as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** One candidate link between two sites + its build cost. */
export type NetworkLink = {
  /** One endpoint site id. */
  a: string;
  /** The other endpoint site id. */
  b: string;
  /** Build cost (non-negative). */
  cost: number;
};

/** A request: the sites + the candidate links to connect them. */
export type NetworkBuildoutRequest = {
  networkRef: string;
  /** The site ids. */
  sites: string[];
  /** The candidate links. */
  links: NetworkLink[];
};

export type NetworkBuildoutDisposition = "connected" | "partitioned";

/** The deterministic finding the agent returns. */
export type NetworkBuildoutDetermination = {
  networkRef: string;
  /** The submitted sites, echoed so the guards can recompute. */
  sites: string[];
  /** The submitted candidate links, echoed so the guards can recompute. */
  links: NetworkLink[];
  /** The chosen links — the minimum spanning tree (or forest, if partitioned). */
  chosenLinks: NetworkLink[];
  /** The minimum total build cost — the sum of the chosen links' costs. */
  totalCost: number;
  /** The number of connected components the chosen links induce over the sites (1 iff connected). */
  componentCount: number;
  /** Number of sites in the network. */
  siteCount: number;
  /** Number of candidate links submitted. */
  linkCount: number;
  disposition: NetworkBuildoutDisposition;
  /** Always true — a network architect confirms every build plan. */
  requiresArchitectReview: true;
  /** Always false — the agent never autonomously provisions links. */
  autoProvisioned: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * A tiny union-find (disjoint-set) with path compression — used ONLY as the cycle-check SUBROUTINE inside
 * Kruskal's greedy edge selection: find(x) returns x's component root; union(x,y) merges two components and
 * returns false if they were already the same (i.e. adding this edge would form a cycle). This is not the
 * computation — the computation is the minimum-spanning-tree construction that calls it.
 */
class DisjointSet {
  private parent = new Map<string, string>();

  make(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  /** Merge the components of x and y; return false if they were already connected (a cycle). */
  union(x: string, y: string): boolean {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;
    this.parent.set(rx, ry);
    return true;
  }
}

/**
 * A deterministic, stable ordering of the links by ASCENDING cost, ties broken by (a, b, original index) so the
 * chosen tree is unique and reproducible. Returns links paired with their original index for the stable
 * tie-break.
 */
function sortedByCost(links: NetworkLink[]): Array<{ link: NetworkLink; idx: number }> {
  return links
    .map((link, idx) => ({ link, idx }))
    .sort((p, q) => {
      if (p.link.cost !== q.link.cost) return p.link.cost - q.link.cost;
      if (p.link.a !== q.link.a) return p.link.a < q.link.a ? -1 : 1;
      if (p.link.b !== q.link.b) return p.link.b < q.link.b ? -1 : 1;
      return p.idx - q.idx;
    });
}

/**
 * KRUSKAL'S ALGORITHM — build the minimum spanning tree (or forest, if the candidate links can't connect
 * everything). Sort the links cheapest-first, then walk them adding each link IFF it joins two distinct
 * components (the union-find cycle check). Only links whose endpoints are both known sites are considered.
 * Returns the chosen links, the total cost, and the number of connected components the chosen links induce.
 * Pure — a function of the sites + links only.
 */
export function kruskalMST(
  sites: string[],
  links: NetworkLink[]
): { chosenLinks: NetworkLink[]; totalCost: number; componentCount: number } {
  const known = new Set(sites);
  const dsu = new DisjointSet();
  for (const site of sites) dsu.make(site);

  const chosenLinks: NetworkLink[] = [];
  let totalCost = 0;
  for (const { link } of sortedByCost(links)) {
    if (!known.has(link.a) || !known.has(link.b)) continue; // link to an unknown site — cannot build it
    if (link.a === link.b) continue; // a self-loop never connects two sites
    if (dsu.union(link.a, link.b)) {
      chosenLinks.push(link);
      totalCost += link.cost;
    }
  }

  // Count components over the sites after the chosen links are applied.
  const roots = new Set<string>();
  for (const site of sites) roots.add(dsu.find(site));
  const componentCount = sites.length === 0 ? 0 : roots.size;

  return { chosenLinks, totalCost, componentCount };
}

/**
 * The deterministic build-planning function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own sites + links (no randomness, no clock). It builds the minimum spanning tree, reads off the
 * total cost + component count, and derives the disposition. Nothing is provisioned — the plan is handed to a
 * network architect.
 */
export function evaluateNetworkBuildout(request: NetworkBuildoutRequest): NetworkBuildoutDetermination {
  const sites = Array.isArray(request.sites) ? request.sites : [];
  const links = Array.isArray(request.links) ? request.links : [];
  const { chosenLinks, totalCost, componentCount } = kruskalMST(sites, links);
  const disposition: NetworkBuildoutDisposition = componentCount <= 1 ? "connected" : "partitioned";

  const reason =
    disposition === "connected"
      ? `Connected ${sites.length} site(s) of ${request.networkRef} into one network with ${chosenLinks.length} link(s) at minimum total build cost ${totalCost}.`
      : `Plan ${request.networkRef} is PARTITIONED — the candidate links connect the ${sites.length} site(s) into only ${componentCount} separate component(s) (${chosenLinks.length} link(s), cost ${totalCost}); more candidate links are needed to reach one network.`;

  return {
    networkRef: request.networkRef,
    sites,
    links,
    chosenLinks,
    totalCost,
    componentCount,
    siteCount: sites.length,
    linkCount: links.length,
    disposition,
    requiresArchitectReview: true,
    autoProvisioned: false,
    reason,
    synthetic: true,
    note:
      `Minimum spanning tree ${request.networkRef}: ${disposition.toUpperCase()} — ` +
      (disposition === "connected"
        ? `${sites.length} site(s) connected by ${chosenLinks.length} link(s) at minimum total cost ${totalCost} via KRUSKAL'S ALGORITHM. `
        : `${componentCount} component(s) remain; the candidate links cannot form one network (KRUSKAL'S ALGORITHM). `) +
      "Real provider-network design weighs adequacy standards, contracted rates, capacity, redundancy, and regulatory requirements — not a bare minimum spanning tree over illustrative costs. Synthetic/illustrative costs — NOT a certified network-design system. The agent never provisions, activates, or orders a link on its own — a network architect confirms every build plan. Site labels reference clinics / facilities, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/** Count the connected components a set of links induces over a set of sites (via union-find). */
function componentsOf(sites: string[], edges: NetworkLink[]): number {
  if (sites.length === 0) return 0;
  const known = new Set(sites);
  const dsu = new DisjointSet();
  for (const site of sites) dsu.make(site);
  for (const e of edges) {
    if (known.has(e.a) && known.has(e.b)) dsu.union(e.a, e.b);
  }
  const roots = new Set<string>();
  for (const site of sites) roots.add(dsu.find(site));
  return roots.size;
}

/**
 * Sourced + self-consistency check: is the reported build plan a REAL, self-consistent accounting of the
 * submitted candidates? Each chosen link must be a SUBMITTED candidate link (same endpoints — in either
 * orientation — same cost; no fabricated link, no altered cost), the chosen links must form a FOREST (no cycle,
 * verified by union-find), the reported totalCost must equal the sum of the chosen links' costs, the reported
 * componentCount must equal the components the chosen links induce over the sites, siteCount / linkCount must be
 * honest, and the disposition must follow (connected iff componentCount === 1). Catches a fabricated link, an
 * altered cost, or a cycle. Does NOT recompute the optimal tree (that is the optimality gate's job), so it is
 * independent of it. Anything evaluateNetworkBuildout() produces satisfies it. This is the honest signal the
 * plan reports to policy.netbuildout.tree-sourced. A non-object / malformed input is a violation.
 */
export function treeSourced(
  decision:
    | {
        sites?: unknown;
        links?: unknown;
        chosenLinks?: unknown;
        totalCost?: unknown;
        componentCount?: unknown;
        siteCount?: unknown;
        linkCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const sites = Array.isArray(decision.sites) ? (decision.sites as string[]) : null;
  const links = Array.isArray(decision.links) ? (decision.links as NetworkLink[]) : null;
  const chosen = Array.isArray(decision.chosenLinks) ? (decision.chosenLinks as NetworkLink[]) : null;
  if (!sites || !links || !chosen) return false;
  for (const s of sites) {
    if (typeof s !== "string") return false;
  }
  const knownSites = new Set(sites);
  if (knownSites.size !== sites.length) return false; // duplicate site ids

  const validLink = (l: NetworkLink): boolean =>
    !!l &&
    typeof l.a === "string" &&
    typeof l.b === "string" &&
    typeof l.cost === "number" &&
    Number.isFinite(l.cost);
  for (const l of links) {
    if (!validLink(l)) return false;
  }

  // Honest siteCount / linkCount.
  if (decision.siteCount !== undefined && decision.siteCount !== sites.length) return false;
  if (decision.linkCount !== undefined && decision.linkCount !== links.length) return false;

  // Each chosen link must be a submitted candidate (same endpoints in either orientation + same cost).
  const candidateKey = (l: NetworkLink) => {
    const [x, y] = l.a <= l.b ? [l.a, l.b] : [l.b, l.a];
    return `${x}|${y}|${l.cost}`;
  };
  const candidateKeys = new Set(links.map(candidateKey));
  const dsu = new DisjointSet();
  for (const site of sites) dsu.make(site);
  let total = 0;
  for (const l of chosen) {
    if (!validLink(l)) return false;
    if (!knownSites.has(l.a) || !knownSites.has(l.b)) return false; // endpoint not a submitted site
    if (!candidateKeys.has(candidateKey(l))) return false; // fabricated / altered link
    if (!dsu.union(l.a, l.b)) return false; // cycle — not a forest
    total += l.cost;
  }
  if (typeof decision.totalCost !== "number" || decision.totalCost !== total) return false;

  const componentCount = componentsOf(sites, chosen);
  if (decision.componentCount !== undefined && decision.componentCount !== componentCount) return false;

  const expectedDisposition: NetworkBuildoutDisposition = componentCount <= 1 ? "connected" : "partitioned";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Optimality check: re-running Kruskal's algorithm over the submitted sites + links must reproduce the reported
 * totalCost (and the connected / partitioned disposition). True only when the recompute agrees. Catches a
 * sub-optimal tree that wastes build budget. The load-bearing correctness gate — it recomputes the minimum total
 * cost by KRUSKAL'S ALGORITHM from the sites + links INDEPENDENT of the reported tree (it compares the scalar
 * optimum, not the tree — different minimum spanning trees can tie on cost), so a fabricated tree that still
 * reports the optimal total cost fails sourced only while a real-but-sub-optimal tree fails here — the two gates
 * are isolable. Anything evaluateNetworkBuildout() produces satisfies it. A non-object input is a violation.
 */
export function treeOptimal(
  decision:
    | { sites?: unknown; links?: unknown; totalCost?: unknown; componentCount?: unknown; disposition?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const sites = Array.isArray(decision.sites) ? (decision.sites as string[]) : null;
  const links = Array.isArray(decision.links) ? (decision.links as NetworkLink[]) : null;
  if (!sites || !links) return false;
  for (const s of sites) {
    if (typeof s !== "string") return false;
  }
  for (const l of links) {
    if (
      !l ||
      typeof l.a !== "string" ||
      typeof l.b !== "string" ||
      typeof l.cost !== "number" ||
      !Number.isFinite(l.cost)
    ) {
      return false;
    }
  }

  const { totalCost, componentCount } = kruskalMST(sites, links);
  if (typeof decision.totalCost !== "number" || decision.totalCost !== totalCost) return false;
  if (decision.componentCount !== undefined && decision.componentCount !== componentCount) return false;

  const expectedDisposition: NetworkBuildoutDisposition = componentCount <= 1 ? "connected" : "partitioned";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * No-autonomous-provisioning check: did the agent avoid provisioning / activating on its own? True unless the
 * determination reports it auto-provisioned links (autoProvisioned:true) or does not require architect review
 * (requiresArchitectReview:false). Anything evaluateNetworkBuildout() produces satisfies it. This is the honest
 * signal the plan reports to policy.netbuildout.no-autonomous-provision. A non-object input is a violation.
 */
export function noAutonomousProvision(
  decision: { autoProvisioned?: boolean; requiresArchitectReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoProvisioned === true) return false;
  if (decision.requiresArchitectReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a build plan. */
export function networkBuildoutSummary(decision: NetworkBuildoutDetermination): {
  networkRef: string;
  disposition: NetworkBuildoutDisposition;
  siteCount: number;
  linkCount: number;
  chosenLinkCount: number;
  totalCost: number;
  componentCount: number;
  requiresArchitectReview: boolean;
  synthetic: boolean;
} {
  return {
    networkRef: decision.networkRef,
    disposition: decision.disposition,
    siteCount: decision.siteCount,
    linkCount: decision.linkCount,
    chosenLinkCount: decision.chosenLinks.length,
    totalCost: decision.totalCost,
    componentCount: decision.componentCount,
    requiresArchitectReview: decision.requiresArchitectReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: five care sites and seven candidate links. Kruskal (ascending cost) picks
 * hub-north(3), north-east(4), hub-south(5), south-west(6) — four links connecting all five sites at a minimum
 * total build cost of 18; the cost-7/8/9 links close cycles and are dropped. "Connected." Synthetic;
 * PHI-adjacent (site labels).
 */
export const DEMO_NETWORK_BUILDOUT_REQUEST: NetworkBuildoutRequest = {
  networkRef: "network-buildout-hub-4501",
  sites: ["hub", "north", "south", "east", "west"],
  links: [
    { a: "hub", b: "north", cost: 3 },
    { a: "hub", b: "south", cost: 5 },
    { a: "north", b: "east", cost: 4 },
    { a: "south", b: "west", cost: 6 },
    { a: "north", b: "south", cost: 8 },
    { a: "east", b: "west", cost: 7 },
    { a: "hub", b: "west", cost: 9 }
  ]
};

/**
 * A representative demo request whose candidate links cannot connect everything: two sites ("annex-a",
 * "annex-b") have no link to the main cluster, so the best plan is a spanning FOREST — "partitioned." Synthetic.
 */
export const DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST: NetworkBuildoutRequest = {
  networkRef: "network-buildout-region-77",
  sites: ["main", "clinic-1", "clinic-2", "annex-a", "annex-b"],
  links: [
    { a: "main", b: "clinic-1", cost: 2 },
    { a: "main", b: "clinic-2", cost: 4 },
    { a: "clinic-1", b: "clinic-2", cost: 5 },
    { a: "annex-a", b: "annex-b", cost: 3 }
  ]
};

/**
 * A representative demo request with a small triangle where the two cheapest links suffice — the third (most
 * expensive) closes a cycle and is correctly dropped. "Connected." Synthetic.
 */
export const DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST: NetworkBuildoutRequest = {
  networkRef: "network-buildout-triad-12",
  sites: ["site-x", "site-y", "site-z"],
  links: [
    { a: "site-x", b: "site-y", cost: 1 },
    { a: "site-y", b: "site-z", cost: 2 },
    { a: "site-x", b: "site-z", cost: 9 }
  ]
};
