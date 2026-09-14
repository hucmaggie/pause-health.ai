/**
 * Interpreter Assignment / Optimal Assignment (Hungarian Algorithm) — the deterministic, transparent
 * care-coordination layer that, given a set of qualified INTERPRETERS and a set of concurrent APPOINTMENTS with a
 * COST matrix (each interpreter↔appointment pairing carrying a cost — travel + wait + skill-mismatch, or an
 * "unavailable" sentinel when an interpreter can't cover an appointment), computes the MINIMUM-TOTAL-COST
 * one-to-one ASSIGNMENT — the provably optimal perfect matching of interpreters to appointments — without ever
 * booking, dispatching, or notifying a single interpreter on its own. A language-access coordinator confirms.
 *
 * Deterministic, dependency-free domain core the Interpreter Assignment agent (app/api/agents/interpreter-
 * assignment) wraps — an assignment agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the
 * heart of this service is the HUNGARIAN ALGORITHM (Kuhn–Munkres): the O(n³) combinatorial method that finds a
 * minimum-cost perfect matching in a bipartite graph by maintaining dual potentials and augmenting along
 * tight-edge alternating paths until every row is matched. This is a genuinely NEW computation pattern for the
 * fabric, and it is EMPHATICALLY DISTINCT from the two matching agents it sits near: it is NOT the PCP Matching
 * agent's GALE–SHAPLEY STABLE MATCHING (which produces a STABLE matching from two-sided PREFERENCE lists — no
 * costs, no global optimum, and stability, not minimum total cost, is its property) and NOT the Caseload
 * Balancing agent's WORST-FIT-DECREASING BIN-PACKING (an UNORDERED greedy capacity fill, not a one-to-one
 * optimal matching). It is also NOT the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's
 * MINIMUM SPANNING TREE, NOT the Batch Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK,
 * and NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH — it is the ASSIGNMENT PROBLEM, solved to the
 * provable minimum. The minimum total assignment cost is the invariant this service reports and defends.
 *
 *   Inbound:  an InterpreterAssignmentRequest { rosterRef, interpreters[], appointments[], costs[][] }
 *   Outbound: an InterpreterAssignmentDetermination { assignments[], totalCost, feasible, unmatched[],
 *             interpreterCount, appointmentCount, disposition, requiresCoordinatorReview:true,
 *             autoDispatched:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the assignment is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  An assignment is trustworthy only if it is a REAL one-to-one matching over the submitted sets: each assignment
 *  pairs a SUBMITTED interpreter with a SUBMITTED appointment, no interpreter is used twice, no appointment is
 *  covered twice, every appointment that CAN be covered is covered, each pairing's cost equals the SUBMITTED cost
 *  matrix cell (and is not an "unavailable" sentinel), the reported totalCost equals the sum of the chosen cells,
 *  and the disposition follows (assignable iff a complete finite-cost matching was found). A fabricated pairing,
 *  a reused interpreter, or an overstated cost corrupts the assignment. assignmentSourced() verifies it; the
 *  Agent Fabric enforces it via policy.interpasg.assignment-sourced. It does NOT recompute the optimum — that is
 *  the optimality gate's job — so the two are isolable. (The sourced + self-consistency gate — mirrors the
 *  Benefit Accumulator Agent's ledger-sourced and the Network Build-Out Agent's tree-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the assignment is cost-optimal (the Hungarian algorithm recomputes).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the Hungarian algorithm over the submitted cost matrix must reproduce the reported totalCost (and
 *  the feasible / infeasible disposition). A sub-optimal assignment wastes interpreter time and money — the whole
 *  point of the minimization. assignmentOptimal() recomputes the minimum total cost INDEPENDENT of the reported
 *  pairings (it compares the scalar optimum, not the specific permutation — different optimal assignments can tie
 *  on total cost), so a fabricated assignment that still reports the optimal cost fails sourced only, and a
 *  real-but-sub-optimal assignment fails optimal only — the two gates are isolable. The Agent Fabric enforces it
 *  via policy.interpasg.cost-optimal. (The load-bearing correctness gate — mirrors the Benefit Accumulator
 *  Agent's accumulator-exact and the Network Build-Out Agent's cost-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous dispatch.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ASSIGNS on paper — it never books, dispatches, or notifies an interpreter on its own (each is a
 *  scheduling action that must be authorized); every assignment is a RECOMMENDATION requiring a language-access
 *  coordinator to confirm. noAutonomousDispatch() reports the honest signal the Agent Fabric enforces via
 *  policy.interpasg.no-autonomous-dispatch. (Mirrors the Benefit Accumulator Agent's no-autonomous-adjust and the
 *  Referral Throughput Agent's no-autonomous-route — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An assignment — assignable or infeasible — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCoordinatorReview:true, autoDispatched:false). An infeasible disposition is NOT a governance block —
 *  it is the honest finding that some appointment has no qualified interpreter (surfacing the coverage gap is the
 *  whole point). A GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / double-
 *  used assignment, a sub-optimal cost, or an autonomous dispatch) — which the Agent Fabric rejects before it can
 *  leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified interpreter-scheduling / workforce system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real interpreter scheduling weighs certification & specialty (medical / legal), modality (in-person / video /
 *  phone), union & labor rules, travel logistics, and member language preference — not a bare cost matrix. This
 *  assigns the supplied illustrative costs only. TIME IS DATA: the costs are plain numbers and the assignment is
 *  a pure function of them (no clock, no randomness — ties broken by a stable row/column order), so the same
 *  request always yields the same determination, which is what lets the demo, the seeded trace, and the tests
 *  agree. The roster is a clearly-labeled ILLUSTRATIVE synthetic. The appointments reference member encounters,
 *  so a determination is treated as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/**
 * A sentinel cost meaning "this interpreter cannot cover this appointment" (unqualified / unavailable). A large
 * FINITE value (not Infinity) so it survives JSON serialization across the A2A boundary — JSON.stringify(Infinity)
 * is `null`, which would corrupt the cost matrix. Any cost at or above this threshold is treated as unavailable.
 */
export const UNAVAILABLE = 1e9;

/** True when a cost cell means "unavailable" — the sentinel, at-or-above it, or a non-finite value. */
function isUnavailable(cost: number): boolean {
  return !Number.isFinite(cost) || cost >= UNAVAILABLE;
}

/** A request: the interpreters, the appointments, and the cost matrix (rows = interpreters, cols = appointments). */
export type InterpreterAssignmentRequest = {
  rosterRef: string;
  interpreters: string[];
  appointments: string[];
  /** costs[i][j] = cost of interpreter i covering appointment j; UNAVAILABLE (Infinity) if not qualified. */
  costs: number[][];
};

export type InterpreterAssignmentDisposition = "assignable" | "infeasible";

/** One interpreter↔appointment pairing in the assignment. */
export type Assignment = {
  interpreter: string;
  appointment: string;
  cost: number;
};

/** The deterministic finding the agent returns. */
export type InterpreterAssignmentDetermination = {
  rosterRef: string;
  interpreters: string[];
  appointments: string[];
  costs: number[][];
  /** The chosen pairings (a partial or full matching). */
  assignments: Assignment[];
  /** Total cost of the chosen pairings. */
  totalCost: number;
  /** True iff every appointment was covered with a finite-cost interpreter. */
  feasible: boolean;
  /** Appointments left uncovered (no qualified interpreter) — empty when feasible. */
  unmatched: string[];
  interpreterCount: number;
  appointmentCount: number;
  disposition: InterpreterAssignmentDisposition;
  /** Always true — a language-access coordinator confirms every assignment. */
  requiresCoordinatorReview: true;
  /** Always false — the agent never autonomously dispatches an interpreter. */
  autoDispatched: false;
  reason: string;
  synthetic: true;
  note: string;
};

const BIG = 1e12; // a large finite stand-in for UNAVAILABLE inside the solver, so duals stay finite.

/**
 * HUNGARIAN ALGORITHM (Kuhn–Munkres), O(n³), on a padded square matrix. Returns, for each row (interpreter), the
 * column (appointment) it is matched to, plus the total cost over the ORIGINAL (unpadded, finite) cells only.
 * Unavailable / padded cells are given the BIG stand-in so the solver never prefers them; a match that lands on a
 * BIG cell is reported as unmatched (col = -1). Deterministic: this is the standard potentials + augmenting-path
 * formulation, which visits rows and columns in index order. Pure.
 */
function hungarian(costMatrix: number[][], rows: number, cols: number): { rowToCol: number[] } {
  const n = Math.max(rows, cols);
  // Pad to a square n×n matrix; padded / unavailable cells get BIG.
  const a: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      const raw = i <= rows && j <= cols ? costMatrix[i - 1][j - 1] : BIG;
      a[i][j] = isUnavailable(raw) ? BIG : raw;
    }
  }

  const u = new Array<number>(n + 1).fill(0); // row potentials
  const v = new Array<number>(n + 1).fill(0); // col potentials
  const p = new Array<number>(n + 1).fill(0); // p[j] = row matched to col j (0 = none)
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = a[i0][j] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // p[j] = row assigned to col j. Invert to rowToCol; drop matches on padded / BIG cells.
  const rowToCol = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    if (i >= 1 && i <= rows && j <= cols && a[i][j] < BIG) {
      rowToCol[i - 1] = j - 1;
    }
  }
  return { rowToCol };
}

/** Validate a request's matrix shape; returns the effective dimensions or null if malformed. */
function shapeOf(request: {
  interpreters?: unknown;
  appointments?: unknown;
  costs?: unknown;
}): { interpreters: string[]; appointments: string[]; costs: number[][] } | null {
  const interpreters = Array.isArray(request.interpreters) ? (request.interpreters as string[]) : null;
  const appointments = Array.isArray(request.appointments) ? (request.appointments as string[]) : null;
  const costs = Array.isArray(request.costs) ? (request.costs as number[][]) : null;
  if (!interpreters || !appointments || !costs) return null;
  for (const s of interpreters) if (typeof s !== "string") return null;
  for (const s of appointments) if (typeof s !== "string") return null;
  if (costs.length !== interpreters.length) return null;
  for (const row of costs) {
    if (!Array.isArray(row) || row.length !== appointments.length) return null;
    for (const c of row) if (typeof c !== "number" || Number.isNaN(c)) return null;
  }
  return { interpreters, appointments, costs };
}

/** Solve the optimal assignment; returns the chosen pairings + the total finite cost + the uncovered appointments. */
export function solveAssignment(request: InterpreterAssignmentRequest): {
  assignments: Assignment[];
  totalCost: number;
  unmatched: string[];
} {
  const shape = shapeOf(request);
  if (!shape) return { assignments: [], totalCost: 0, unmatched: [] };
  const { interpreters, appointments, costs } = shape;
  if (interpreters.length === 0 || appointments.length === 0) {
    return { assignments: [], totalCost: 0, unmatched: [...appointments] };
  }

  const { rowToCol } = hungarian(costs, interpreters.length, appointments.length);
  const assignments: Assignment[] = [];
  const coveredCols = new Set<number>();
  let totalCost = 0;
  for (let i = 0; i < interpreters.length; i++) {
    const j = rowToCol[i];
    if (j >= 0) {
      assignments.push({ interpreter: interpreters[i], appointment: appointments[j], cost: costs[i][j] });
      coveredCols.add(j);
      totalCost += costs[i][j];
    }
  }
  const unmatched = appointments.filter((_, j) => !coveredCols.has(j));
  return { assignments, totalCost: Math.round(totalCost * 100) / 100, unmatched };
}

/**
 * The deterministic assignment function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own interpreters + appointments + cost matrix (no randomness, no clock). It solves the optimal
 * assignment, tallies the total cost, lists any uncovered appointments, and derives the disposition. Nothing is
 * dispatched — the assignment is handed to a language-access coordinator.
 */
export function evaluateInterpreterAssignment(
  request: InterpreterAssignmentRequest
): InterpreterAssignmentDetermination {
  const interpreters = Array.isArray(request.interpreters) ? request.interpreters : [];
  const appointments = Array.isArray(request.appointments) ? request.appointments : [];
  const costs = Array.isArray(request.costs) ? request.costs : [];
  const { assignments, totalCost, unmatched } = solveAssignment(request);
  const feasible = unmatched.length === 0 && appointments.length > 0 && assignments.length === appointments.length;
  const disposition: InterpreterAssignmentDisposition = feasible ? "assignable" : "infeasible";

  const reason = feasible
    ? `Assigned all ${appointments.length} appointment(s) in ${request.rosterRef} to interpreters at minimum total cost ${totalCost}.`
    : `Roster ${request.rosterRef} is INFEASIBLE — ${unmatched.length} appointment(s) have no qualified interpreter (${unmatched.join(", ")}); ${assignments.length} of ${appointments.length} assignable at cost ${totalCost}. Add interpreter coverage to close the gap.`;

  return {
    rosterRef: request.rosterRef,
    interpreters,
    appointments,
    costs,
    assignments,
    totalCost,
    feasible,
    unmatched,
    interpreterCount: interpreters.length,
    appointmentCount: appointments.length,
    disposition,
    requiresCoordinatorReview: true,
    autoDispatched: false,
    reason,
    synthetic: true,
    note:
      `Optimal assignment ${request.rosterRef}: ${disposition.toUpperCase()} — ` +
      (feasible
        ? `${appointments.length} appointment(s) matched at minimum total cost ${totalCost} via the HUNGARIAN ALGORITHM. `
        : `${unmatched.length} appointment(s) uncoverable; ${assignments.length} matched at cost ${totalCost} (HUNGARIAN ALGORITHM). `) +
      "Real interpreter scheduling weighs certification & specialty (medical / legal), modality (in-person / video / phone), union & labor rules, travel logistics, and member language preference — not a bare cost matrix. Synthetic/illustrative costs — NOT a certified interpreter-scheduling / workforce system. The agent never books, dispatches, or notifies an interpreter on its own — a language-access coordinator confirms every assignment. Appointments reference member encounters, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported assignment a REAL one-to-one matching over the submitted
 * sets? Each pairing must use a SUBMITTED interpreter + appointment, no interpreter or appointment used twice,
 * every coverable appointment covered (the unmatched list is exactly the appointments with no finite-cost cell in
 * the chosen matching's complement — checked by requiring feasible === (unmatched empty)), each cost equal to the
 * SUBMITTED matrix cell and finite (not the UNAVAILABLE sentinel), the totalCost equal to the sum of the chosen
 * cells, and the disposition following. Catches a fabricated pairing, a reused interpreter, or an overstated
 * cost. Does NOT recompute the optimum (that is the optimality gate's job), so it is independent of it. Anything
 * evaluateInterpreterAssignment() produces satisfies it. This is the honest signal the assignment reports to
 * policy.interpasg.assignment-sourced. A non-object / malformed input is a violation.
 */
export function assignmentSourced(
  decision:
    | {
        interpreters?: unknown;
        appointments?: unknown;
        costs?: unknown;
        assignments?: unknown;
        totalCost?: unknown;
        feasible?: unknown;
        unmatched?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const shape = shapeOf(decision);
  if (!shape) return false;
  const { interpreters, appointments, costs } = shape;
  const assignments = Array.isArray(decision.assignments) ? (decision.assignments as Assignment[]) : null;
  if (!assignments) return false;

  const interpreterIndex = new Map(interpreters.map((id, i) => [id, i]));
  const appointmentIndex = new Map(appointments.map((id, j) => [id, j]));
  if (interpreterIndex.size !== interpreters.length) return false; // duplicate interpreter id
  if (appointmentIndex.size !== appointments.length) return false; // duplicate appointment id

  const usedInterpreters = new Set<string>();
  const usedAppointments = new Set<string>();
  let total = 0;
  for (const asg of assignments) {
    if (!asg || typeof asg.interpreter !== "string" || typeof asg.appointment !== "string") return false;
    if (typeof asg.cost !== "number" || !Number.isFinite(asg.cost)) return false;
    const i = interpreterIndex.get(asg.interpreter);
    const j = appointmentIndex.get(asg.appointment);
    if (i === undefined || j === undefined) return false; // not a submitted interpreter/appointment
    if (usedInterpreters.has(asg.interpreter) || usedAppointments.has(asg.appointment)) return false; // reused
    const cell = costs[i][j];
    if (isUnavailable(cell) || cell !== asg.cost) return false; // altered cost / unavailable cell used
    usedInterpreters.add(asg.interpreter);
    usedAppointments.add(asg.appointment);
    total += asg.cost;
  }
  total = Math.round(total * 100) / 100;
  if (decision.totalCost !== undefined && decision.totalCost !== total) return false;

  const coveredAppointments = new Set(assignments.map((a) => a.appointment));
  const expectedUnmatched = appointments.filter((ap) => !coveredAppointments.has(ap));
  const reportedUnmatched = Array.isArray(decision.unmatched) ? (decision.unmatched as string[]) : null;
  if (reportedUnmatched) {
    if (reportedUnmatched.length !== expectedUnmatched.length) return false;
    const exp = new Set(expectedUnmatched);
    for (const ap of reportedUnmatched) if (!exp.has(ap)) return false;
  }

  const feasible = expectedUnmatched.length === 0 && appointments.length > 0;
  if (decision.feasible !== undefined && decision.feasible !== feasible) return false;
  const expectedDisposition: InterpreterAssignmentDisposition = feasible ? "assignable" : "infeasible";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Optimality check: re-running the Hungarian algorithm over the submitted cost matrix must reproduce the reported
 * totalCost (and the feasible / infeasible disposition). True only when the recompute agrees. Catches a
 * sub-optimal assignment that wastes interpreter time. The load-bearing correctness gate — it recomputes the
 * minimum total cost by the HUNGARIAN ALGORITHM from the matrix INDEPENDENT of the reported pairings (it compares
 * the scalar optimum, not the permutation — different optimal assignments can tie on total cost), so a fabricated
 * assignment that still reports the optimal cost fails sourced only while a real-but-sub-optimal assignment fails
 * here — the two gates are isolable. Anything evaluateInterpreterAssignment() produces satisfies it. A non-object
 * input is a violation.
 */
export function assignmentOptimal(
  decision:
    | {
        rosterRef?: unknown;
        interpreters?: unknown;
        appointments?: unknown;
        costs?: unknown;
        totalCost?: unknown;
        feasible?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const shape = shapeOf(decision);
  if (!shape) return false;
  const solved = solveAssignment({
    rosterRef: typeof decision.rosterRef === "string" ? decision.rosterRef : "",
    interpreters: shape.interpreters,
    appointments: shape.appointments,
    costs: shape.costs
  });
  if (typeof decision.totalCost !== "number" || decision.totalCost !== solved.totalCost) return false;

  const feasible = solved.unmatched.length === 0 && shape.appointments.length > 0;
  if (decision.feasible !== undefined && decision.feasible !== feasible) return false;
  const expectedDisposition: InterpreterAssignmentDisposition = feasible ? "assignable" : "infeasible";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * No-autonomous-dispatch check: did the agent avoid booking / dispatching on its own? True unless the
 * determination reports it auto-dispatched interpreters (autoDispatched:true) or does not require coordinator
 * review (requiresCoordinatorReview:false). Anything evaluateInterpreterAssignment() produces satisfies it. This
 * is the honest signal the assignment reports to policy.interpasg.no-autonomous-dispatch. A non-object input is a
 * violation.
 */
export function noAutonomousDispatch(
  decision: { autoDispatched?: boolean; requiresCoordinatorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDispatched === true) return false;
  if (decision.requiresCoordinatorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of an assignment. */
export function interpreterAssignmentSummary(decision: InterpreterAssignmentDetermination): {
  rosterRef: string;
  disposition: InterpreterAssignmentDisposition;
  interpreterCount: number;
  appointmentCount: number;
  assignedCount: number;
  totalCost: number;
  unmatchedCount: number;
  requiresCoordinatorReview: boolean;
  synthetic: boolean;
} {
  return {
    rosterRef: decision.rosterRef,
    disposition: decision.disposition,
    interpreterCount: decision.interpreterCount,
    appointmentCount: decision.appointmentCount,
    assignedCount: decision.assignments.length,
    totalCost: decision.totalCost,
    unmatchedCount: decision.unmatched.length,
    requiresCoordinatorReview: decision.requiresCoordinatorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: three interpreters and three concurrent appointments with a cost matrix (travel
 * + wait + skill-mismatch points). The optimal assignment is NOT the greedy per-row minimum — the Hungarian
 * algorithm finds the min-total perfect matching. "Assignable." Synthetic; PHI-adjacent (appointment encounters).
 *
 * Costs (rows = interpreters ES/ZH/AR, cols = appts A/B/C):
 *   ES: [4, 2, 8]   ZH: [4, 3, 7]   AR: [3, 1, 6]
 */
export const DEMO_INTERPRETER_ASSIGNMENT_REQUEST: InterpreterAssignmentRequest = {
  rosterRef: "lang-access-roster-2026-3310",
  interpreters: ["interp-ES", "interp-ZH", "interp-AR"],
  appointments: ["appt-A-spanish", "appt-B-mandarin", "appt-C-arabic"],
  costs: [
    [4, 2, 8],
    [4, 3, 7],
    [3, 1, 6]
  ]
};

/**
 * A representative demo request that is INFEASIBLE: appointment C requires a language none of the available
 * interpreters covers (UNAVAILABLE across the column), so no perfect matching exists. "Infeasible." Synthetic.
 */
export const DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST: InterpreterAssignmentRequest = {
  rosterRef: "lang-access-roster-2026-3311",
  interpreters: ["interp-ES", "interp-ZH"],
  appointments: ["appt-A-spanish", "appt-B-mandarin", "appt-C-somali"],
  costs: [
    [2, 5, UNAVAILABLE],
    [6, 2, UNAVAILABLE]
  ]
};

/**
 * A representative demo request where a naive greedy (assign each appointment its cheapest interpreter) would
 * double-book one interpreter, but the Hungarian optimum spreads them for a lower total. "Assignable." Synthetic.
 */
export const DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST: InterpreterAssignmentRequest = {
  rosterRef: "lang-access-roster-2026-3312",
  interpreters: ["interp-1", "interp-2"],
  appointments: ["appt-X", "appt-Y"],
  costs: [
    [1, 2],
    [1, 9]
  ]
};
