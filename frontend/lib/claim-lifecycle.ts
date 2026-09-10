/**
 * Claim Lifecycle / Status-Transition Guard — the deterministic, transparent payer-operations layer that
 * takes a claim's CURRENT status plus a REQUESTED next status and, against a claim-status STATE MACHINE,
 * decides whether the transition is a LEGAL single step, whether the requested status is REACHABLE at all
 * (and by what shortest path), or whether it can NEVER follow the current status — never autonomously
 * ADVANCING the claim, POSTING a payment, or FINALIZING; an adjuster confirms every transition.
 *
 * Deterministic, dependency-free domain core the Claim Lifecycle agent (app/api/agents/claim-lifecycle)
 * wraps — a claims / payer-operations service on the payer & plan operations plane of Pause's Agent
 * Fabric. UNLIKE the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's
 * GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's
 * SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's
 * TOPOLOGICAL ORDERING (which orders a DAG's nodes), the Enrollment Reconciliation agent's KEYED
 * SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the DDI agent's PAIRWISE
 * KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's EXACT identity MATCHING, or the Audit Log Integrity
 * agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely Filing, Right of Access, Amendment)
 * that add N days to a single date — the heart of this service is FINITE-STATE-MACHINE TRANSITION
 * VALIDATION: a transition-table lookup (is current → requested a legal edge?) plus a BREADTH-FIRST
 * SEARCH over the state graph (is requested reachable from current, and what is the shortest legal path?).
 * A claim moves through a lifecycle — draft, submitted, acknowledged, adjudicated, paid, denied,
 * appealed, void — and skipping a step (e.g., draft → paid with no adjudication) is a control failure and
 * a fraud / leakage risk; this service catches an illegal or impossible transition deterministically.
 *
 *   Inbound:  a ClaimLifecycleRequest { claimRef, patientRef, currentStatus, requestedStatus, stateMachine? }
 *   Outbound: a ClaimLifecycleDetermination { disposition, directEdge, reachable, allowedNextStates[],
 *             shortestPath[], pathLength, stateMachine, requiresAdjusterReview:true, autoAdvanced:false,
 *             reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other claim / payer-operations agents: distinct from the
 * Claims Adjudication Assistant (per-claim edits / medical-necessity adjudication), the Coordination of
 * Benefits agent (payer ORDER across coverages), the Claims Overpayment & Recovery agent (POST-payment
 * clawback), the Timely Filing agent (was the claim FILED IN TIME), and the Subrogation agent (third-party
 * liability): this validates one narrow, purely STRUCTURAL question — is this STATUS TRANSITION legal, and
 * if not, is the target even reachable.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every state and edge is sourced from the machine.
 * ─────────────────────────────────────────────────────────────────────
 *  A transition finding is trustworthy only if every status it names — in the allowed-next set and in the
 *  shortest path — is a DEFINED state of the state machine, and every consecutive pair in the shortest
 *  path is a REAL transition. A fabricated state invents a lifecycle stage that doesn't exist; a
 *  fabricated edge invents a legal move that isn't allowed. claimStatesSourced() verifies it; the Agent
 *  Fabric enforces it via policy.claim.states-sourced. (The sourced gate — mirrors the Care Pathway
 *  Agent's steps-sourced and the Medication Name Safety Agent's candidates-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the transition logic is exact.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the transition table + the BFS from the machine must reproduce the reported direct-edge
 *  flag, the reachability flag, the allowed-next set, the shortest-path length, and the disposition. A
 *  wrong direct-edge flag would wave through an illegal transition (or block a legal one); a wrong
 *  reachability / path would misroute the claim. claimTransitionConsistent() recomputes it end-to-end from
 *  the echoed machine; the Agent Fabric enforces it via policy.claim.transition-consistent. (The
 *  load-bearing correctness gate — mirrors the Care Pathway Agent's sequence-valid and the Medication Name
 *  Safety Agent's distances-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the claim is never autonomously advanced / paid / finalized.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent VALIDATES — it never ADVANCES the claim to the next status, POSTS a payment, or FINALIZES a
 *  denial (each is a payer action that must be authorized); every finding is a RECOMMENDATION requiring an
 *  adjuster to confirm. claimNoAutonomousAdvance() reports the honest signal the Agent Fabric enforces via
 *  policy.claim.no-autonomous-advance. (Mirrors the Timely Filing Agent's no-autonomous-write-off and the
 *  Overpayment Recovery Agent's no-autonomous-clawback posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — transition-allowed, transition-illegal-but-reachable, or transition-unreachable — is a
 *  SAFE, honest OUTPUT: the task COMPLETES (it carries requiresAdjusterReview:true, autoAdvanced:false). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (one that fabricates a state /
 *  edge, miscomputes the transition logic, or autonomously advances) — which the Agent Fabric rejects
 *  before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified claims-processing system.
 * ─────────────────────────────────────────────────────────────────────
 *  The claim-status state machine below is a clearly-labeled ILLUSTRATIVE synthetic chosen to model the
 *  SHAPE of a claim lifecycle deterministically in the demo. Real claim-status management uses the X12 277
 *  claim-status category / status codes, the payer's adjudication system, and the plan's business rules.
 *  TIME IS DATA: the finding is a pure function of the request's own statuses + machine (no clock, no
 *  randomness), so the same input always yields the same finding, which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** A claim-status state machine: the defined states, the allowed transitions, and the terminal states. */
export type ClaimStateMachine = {
  /** Every defined lifecycle state. */
  states: string[];
  /** For each state, the states it may legally transition to. */
  transitions: Record<string, string[]>;
  /** The terminal states (no outgoing transitions). */
  terminalStates: string[];
};

/** A claim-lifecycle transition request. */
export type ClaimLifecycleRequest = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The claim's current lifecycle status. */
  currentStatus: string;
  /** The status the caller wants to move the claim to. */
  requestedStatus: string;
  /** The state machine to validate against (defaults to DEFAULT_CLAIM_STATE_MACHINE). */
  stateMachine?: ClaimStateMachine;
};

/** The disposition of a transition finding. */
export type ClaimLifecycleDisposition =
  | "transition-allowed"
  | "transition-illegal-but-reachable"
  | "transition-unreachable";

/** The deterministic finding the agent returns. */
export type ClaimLifecycleDetermination = {
  claimRef: string;
  patientRef: string;
  currentStatus: string;
  requestedStatus: string;
  /** The state machine echoed so the honesty guards can recompute end-to-end. */
  stateMachine: ClaimStateMachine;
  /** Whether current → requested is a legal single-step transition. */
  directEdge: boolean;
  /** Whether requested is reachable from current via any legal path. */
  reachable: boolean;
  /** The states current may legally transition to next (sorted). */
  allowedNextStates: string[];
  /** The shortest legal path from current to requested inclusive ([] if unreachable). */
  shortestPath: string[];
  /** The number of transitions in the shortest path (-1 if unreachable, 1 for a direct edge). */
  pathLength: number;
  /** The disposition. */
  disposition: ClaimLifecycleDisposition;
  /** Always true — an adjuster confirms every transition. */
  requiresAdjusterReview: true;
  /** Always false — the agent never autonomously advances / pays / finalizes. */
  autoAdvanced: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the state machine is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * An ILLUSTRATIVE synthetic claim-status state machine — a canonical claim lifecycle. Clearly labeled
 * synthetic, NOT the X12 277 claim-status code set.
 */
export const DEFAULT_CLAIM_STATE_MACHINE: ClaimStateMachine = {
  states: [
    "draft",
    "submitted",
    "acknowledged",
    "rejected",
    "pending",
    "adjudicated",
    "paid",
    "denied",
    "appealed",
    "reopened",
    "void"
  ],
  transitions: {
    draft: ["submitted", "void"],
    submitted: ["acknowledged", "rejected"],
    acknowledged: ["pending", "adjudicated"],
    rejected: ["draft"],
    pending: ["adjudicated"],
    adjudicated: ["paid", "denied"],
    paid: ["reopened", "void"],
    denied: ["appealed", "void"],
    appealed: ["adjudicated"],
    reopened: ["adjudicated"],
    void: []
  },
  terminalStates: ["void"]
};

/**
 * Breadth-first search for the shortest legal path from `start` to `goal` over the transition graph.
 * Returns the path (inclusive of both endpoints) or null if `goal` is not reachable. Deterministic:
 * neighbors are explored in sorted order, and BFS guarantees the fewest transitions. A start === goal
 * request returns the trivial path [start].
 */
export function shortestTransitionPath(
  transitions: Record<string, string[]>,
  start: string,
  goal: string
): string[] | null {
  if (start === goal) return [start];
  const visited = new Set<string>([start]);
  // Queue of paths; BFS over the graph.
  let frontier: string[][] = [[start]];
  while (frontier.length > 0) {
    const next: string[][] = [];
    for (const path of frontier) {
      const node = path[path.length - 1];
      const neighbors = [...(transitions[node] ?? [])].sort();
      for (const nb of neighbors) {
        if (nb === goal) return [...path, nb];
        if (!visited.has(nb)) {
          visited.add(nb);
          next.push([...path, nb]);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** Derive the disposition from the direct-edge and reachability flags. */
function deriveDisposition(directEdge: boolean, reachable: boolean): ClaimLifecycleDisposition {
  if (directEdge) return "transition-allowed";
  if (reachable) return "transition-illegal-but-reachable";
  return "transition-unreachable";
}

/**
 * The deterministic transition-validation function — the heart of the service. DETERMINISTIC: a pure
 * function of the request's own statuses + state machine (no randomness, no clock). It looks up whether
 * current → requested is a legal single-step edge, runs a BFS to determine whether requested is reachable
 * from current at all (and the shortest legal path), and derives the disposition: transition-allowed (a
 * legal single step), transition-illegal-but-reachable (not a single step, but a valid future state — the
 * path shows the required intermediate steps), or transition-unreachable (requested can never follow
 * current — e.g., paying a voided claim). Nothing is advanced — the finding is handed to an adjuster.
 */
export function evaluateClaimLifecycle(
  request: ClaimLifecycleRequest
): ClaimLifecycleDetermination {
  const machine =
    request.stateMachine && typeof request.stateMachine === "object"
      ? request.stateMachine
      : DEFAULT_CLAIM_STATE_MACHINE;
  const transitions = machine.transitions ?? {};
  const stateSet = new Set(machine.states ?? []);

  const current = request.currentStatus;
  const requested = request.requestedStatus;

  const currentKnown = stateSet.has(current);
  const requestedKnown = stateSet.has(requested);

  const allowedNextStates = currentKnown ? [...(transitions[current] ?? [])].sort() : [];
  const directEdge = allowedNextStates.includes(requested);

  const path =
    currentKnown && requestedKnown
      ? shortestTransitionPath(transitions, current, requested)
      : null;
  const reachable = path !== null;
  const shortestPath = path ?? [];
  const pathLength = reachable ? shortestPath.length - 1 : -1;

  const disposition = deriveDisposition(directEdge, reachable);

  const reason =
    disposition === "transition-allowed"
      ? `"${current}" → "${requested}" is a legal single-step transition.`
      : disposition === "transition-illegal-but-reachable"
        ? `"${current}" → "${requested}" is NOT a legal single step, but "${requested}" is reachable in ${pathLength} step(s) via ${shortestPath.join(" → ")}.`
        : `"${current}" → "${requested}" is not a legal transition and "${requested}" is not reachable from "${current}" — the transition can never occur.`;

  return {
    claimRef: request.claimRef,
    patientRef: request.patientRef,
    currentStatus: current,
    requestedStatus: requested,
    stateMachine: {
      states: [...(machine.states ?? [])],
      transitions: { ...transitions },
      terminalStates: [...(machine.terminalStates ?? [])]
    },
    directEdge,
    reachable,
    allowedNextStates,
    shortestPath,
    pathLength,
    disposition,
    requiresAdjusterReview: true,
    autoAdvanced: false,
    reason,
    synthetic: true,
    note:
      `Claim lifecycle ${request.claimRef}: ${disposition.toUpperCase()} for "${current}" → "${requested}".` +
      (disposition === "transition-allowed"
        ? " A legal single-step transition — an adjuster must confirm before it is applied."
        : disposition === "transition-illegal-but-reachable"
          ? ` Not a single step; the claim must pass through ${shortestPath.slice(1, -1).join(", ") || "no intermediate states"} first. An adjuster must review.`
          : " The target status can never follow the current status — an adjuster must review.") +
      " PHI-bearing — the claim references a patient. Synthetic/illustrative state machine — NOT a certified claims-processing system; real claim-status management uses the X12 277 claim-status codes, the payer's adjudication system, and the plan's business rules. The agent never advances, pays, or finalizes a claim on its own — an adjuster confirms every transition."
  };
}

/**
 * States-sourced check: is every status named in the finding — in allowedNextStates and in shortestPath —
 * a defined state of the (echoed) machine, and is every consecutive pair in shortestPath a real
 * transition? True only when nothing is fabricated. Catches an invented lifecycle stage or an invented
 * legal move. Anything evaluateClaimLifecycle() produces satisfies it. This is the honest signal the route
 * reports to policy.claim.states-sourced. A non-object / malformed input is a violation.
 */
export function claimStatesSourced(
  decision:
    | {
        stateMachine?: { states?: unknown; transitions?: unknown } | null;
        allowedNextStates?: unknown;
        shortestPath?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const machine = decision.stateMachine;
  if (!machine || typeof machine !== "object") return false;
  const states = Array.isArray(machine.states) ? machine.states : null;
  const transitions =
    machine.transitions && typeof machine.transitions === "object"
      ? (machine.transitions as Record<string, unknown>)
      : null;
  if (!states || !transitions) return false;
  const stateSet = new Set(states.filter((s): s is string => typeof s === "string"));

  const allowed = Array.isArray(decision.allowedNextStates) ? decision.allowedNextStates : null;
  const path = Array.isArray(decision.shortestPath) ? decision.shortestPath : null;
  if (!allowed || !path) return false;

  // Every allowed-next state must be a defined state.
  for (const s of allowed) {
    if (typeof s !== "string" || !stateSet.has(s)) return false;
  }
  // Every state in the path must be defined.
  for (const s of path) {
    if (typeof s !== "string" || !stateSet.has(s)) return false;
  }
  // Every consecutive pair in the path must be a real transition.
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i] as string;
    const to = path[i + 1] as string;
    const outs = Array.isArray(transitions[from]) ? (transitions[from] as unknown[]) : [];
    if (!outs.includes(to)) return false;
  }
  return true;
}

/**
 * Transition-consistent check: recomputing the transition table + BFS from the echoed machine must
 * reproduce the reported direct-edge flag, the reachability flag, the allowed-next set, the shortest-path
 * length, the shortest-path endpoints, and the disposition. True only when they all match. Catches a
 * wrong direct-edge flag, a wrong reachability / path length, a wrong allowed-next set, or a disposition
 * that doesn't follow. The load-bearing correctness gate — it recomputes from the machine and does NOT
 * re-verify each interior path edge (that is the sourced check's job), so it is independent of it.
 * Anything evaluateClaimLifecycle() produces satisfies it. A non-object input is a violation.
 */
export function claimTransitionConsistent(
  decision:
    | {
        stateMachine?: { states?: unknown; transitions?: unknown } | null;
        currentStatus?: unknown;
        requestedStatus?: unknown;
        directEdge?: unknown;
        reachable?: unknown;
        allowedNextStates?: unknown;
        shortestPath?: unknown;
        pathLength?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.currentStatus !== "string" || typeof decision.requestedStatus !== "string") {
    return false;
  }
  const machine = decision.stateMachine;
  if (!machine || typeof machine !== "object") return false;
  const states = Array.isArray(machine.states)
    ? machine.states.filter((s): s is string => typeof s === "string")
    : null;
  const rawTransitions =
    machine.transitions && typeof machine.transitions === "object"
      ? (machine.transitions as Record<string, unknown>)
      : null;
  if (!states || !rawTransitions) return false;
  const transitions: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rawTransitions)) {
    transitions[k] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  }
  const stateSet = new Set(states);

  const current = decision.currentStatus;
  const requested = decision.requestedStatus;
  const currentKnown = stateSet.has(current);
  const requestedKnown = stateSet.has(requested);

  // Recompute allowed-next.
  const recomputedAllowed = currentKnown ? [...(transitions[current] ?? [])].sort() : [];
  const reportedAllowed = Array.isArray(decision.allowedNextStates)
    ? [...(decision.allowedNextStates as unknown[])].map((x) => String(x)).sort()
    : null;
  if (!reportedAllowed) return false;
  if (reportedAllowed.length !== recomputedAllowed.length) return false;
  for (let i = 0; i < recomputedAllowed.length; i++) {
    if (reportedAllowed[i] !== recomputedAllowed[i]) return false;
  }

  // Recompute direct edge.
  const recomputedDirect = recomputedAllowed.includes(requested);
  if (decision.directEdge !== recomputedDirect) return false;

  // Recompute reachability + shortest distance via BFS.
  const path =
    currentKnown && requestedKnown ? shortestTransitionPath(transitions, current, requested) : null;
  const recomputedReachable = path !== null;
  if (decision.reachable !== recomputedReachable) return false;

  const recomputedPathLength = recomputedReachable ? (path as string[]).length - 1 : -1;
  if (decision.pathLength !== recomputedPathLength) return false;

  // Path endpoints must line up (interior edges are the sourced check's job).
  const reportedPath = Array.isArray(decision.shortestPath) ? (decision.shortestPath as unknown[]) : null;
  if (!reportedPath) return false;
  if (recomputedReachable) {
    if (reportedPath.length !== recomputedPathLength + 1) return false;
    if (reportedPath[0] !== current || reportedPath[reportedPath.length - 1] !== requested) return false;
  } else if (reportedPath.length !== 0) {
    return false;
  }

  // Disposition.
  const recomputedDisposition = deriveDisposition(recomputedDirect, recomputedReachable);
  if (decision.disposition !== recomputedDisposition) return false;
  return true;
}

/**
 * No-autonomous-advance check: did the agent avoid autonomously advancing / paying / finalizing? True
 * unless the determination reports it auto-advanced (autoAdvanced:true) or does not require adjuster
 * review (requiresAdjusterReview:false). Anything evaluateClaimLifecycle() produces satisfies it. This is
 * the honest signal the route reports to policy.claim.no-autonomous-advance. A non-object input is a
 * violation.
 */
export function claimNoAutonomousAdvance(
  decision:
    | { autoAdvanced?: boolean; requiresAdjusterReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAdvanced === true) return false;
  if (decision.requiresAdjusterReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function claimLifecycleSummary(decision: ClaimLifecycleDetermination): {
  claimRef: string;
  patientRef: string;
  currentStatus: string;
  requestedStatus: string;
  disposition: ClaimLifecycleDisposition;
  directEdge: boolean;
  reachable: boolean;
  pathLength: number;
  allowedCount: number;
  requiresAdjusterReview: boolean;
  synthetic: boolean;
} {
  return {
    claimRef: decision.claimRef,
    patientRef: decision.patientRef,
    currentStatus: decision.currentStatus,
    requestedStatus: decision.requestedStatus,
    disposition: decision.disposition,
    directEdge: decision.directEdge,
    reachable: decision.reachable,
    pathLength: decision.pathLength,
    allowedCount: decision.allowedNextStates.length,
    requiresAdjusterReview: decision.requiresAdjusterReview,
    synthetic: decision.synthetic
  };
}

/** A representative demo request: a legal single-step transition (adjudicated → paid). Synthetic. */
export const DEMO_CLAIM_LIFECYCLE_REQUEST: ClaimLifecycleRequest = {
  claimRef: "clm-001",
  patientRef: "patient-4417",
  currentStatus: "adjudicated",
  requestedStatus: "paid"
};

/**
 * A representative demo request: an illegal single step that is nonetheless reachable (draft → paid skips
 * adjudication) — the path shows the required steps. Synthetic.
 */
export const DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST: ClaimLifecycleRequest = {
  claimRef: "clm-002",
  patientRef: "patient-5528",
  currentStatus: "draft",
  requestedStatus: "paid"
};

/**
 * A representative demo request: an unreachable transition (paying a voided claim) — void is terminal.
 * Synthetic.
 */
export const DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST: ClaimLifecycleRequest = {
  claimRef: "clm-003",
  patientRef: "patient-6639",
  currentStatus: "void",
  requestedStatus: "paid"
};
