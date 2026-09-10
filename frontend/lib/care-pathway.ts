/**
 * Care Pathway Sequencing — the deterministic, transparent clinical-workflow layer that takes a
 * clinical pathway's STEPS, each declaring the prerequisite steps that must precede it, and produces a
 * valid EXECUTION ORDER that respects every dependency — detecting DEPENDENCY CYCLES (no valid order
 * exists) and MISSING PREREQUISITES (a step depends on a step that isn't in the pathway) — never
 * autonomously EXECUTING / administering any step; a clinician confirms and orders every one.
 *
 * Deterministic, dependency-free domain core the Care Pathway Sequencing Agent
 * (app/api/agents/care-pathway) wraps — a clinical-decision service on the patient / clinical plane of
 * Pause's Agent Fabric. UNLIKE the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member
 * Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, the Drug
 * Interaction agent's pairwise LOOKUP, or the MLR Rebate agent's RATIO + apportionment, the heart of
 * this service is a TOPOLOGICAL ORDERING (Kahn's algorithm) over a dependency graph + CYCLE DETECTION.
 * A clinical pathway (a staged, evidence-based plan — e.g. a menopause work-up-to-treatment pathway)
 * is a set of steps with prerequisite dependencies; sequencing puts them in a safe order.
 *
 *   Inbound:  a CarePathwayRequest { requestRef, pathwayRef, patientRef, steps[] }
 *   Outbound: a CarePathwayDetermination { disposition, orderedSteps[], stageByStep, cycleMembers[],
 *             unmetPrerequisites[], steps[], requiresClinicianReview:true, autoExecuted:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other clinical agents: distinct from the Care Plan agent
 * (which AUTHORS a plan's goals / interventions / cadence from a template), the Transitions of Care and
 * Care Coordination Handoff agents (moving a patient between settings / teams), the Prior Authorization
 * agent (assembling a PA package), and the Drug Interaction / Controlled Substance agents (medication
 * safety): this ORDERS the steps of a pathway so that no step is scheduled before its prerequisites —
 * a pure graph-sequencing service.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every step is sourced — no fabricated step id.
 * ─────────────────────────────────────────────────────────────────────
 *  Every step id appearing anywhere in the determination's output — the ordered sequence, the stage
 *  map, the reported cycle members, the reported missing-prerequisite holders — must reference a step
 *  actually submitted in the pathway; a fabricated / dangling step id would order or flag care that
 *  doesn't exist. pathwayStepsSourced() verifies every referenced step id resolves to a submitted step;
 *  it reports the honest signal the Agent Fabric enforces via policy.pathway.steps-sourced. (Mirrors the
 *  Drug Interaction Agent's interaction-sourced and the Enrollment Reconciliation Agent's
 *  actions-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the sequence is valid — it respects every prerequisite.
 * ─────────────────────────────────────────────────────────────────────
 *  A sequence is trustworthy only if, when the pathway is reported SEQUENCED, the ordered steps are a
 *  COMPLETE permutation of the pathway's steps (none dropped or duplicated) and EVERY step appears
 *  AFTER all of its prerequisites — ordering a treatment step before its safety-screening prerequisite
 *  is the worst failure mode — and, when the pathway is reported UN-sequenceable (a cycle or a missing
 *  prerequisite), no order is asserted. pathwaySequenceValid() re-derives the ordering constraints from
 *  the steps and verifies them; it reports the honest signal the Agent Fabric enforces via
 *  policy.pathway.sequence-valid. (The load-bearing correctness gate — mirrors the Member Cost-Share
 *  Agent's math-consistent and the Enrollment Reconciliation Agent's reconciliation-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a step is never autonomously executed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent SEQUENCES — it never EXECUTES / orders / administers a step (ordering a lab, a screening,
 *  or a therapy is a clinical action that must be authorized); every determination is a RECOMMENDATION
 *  requiring a clinician to confirm and order. pathwayNoAutonomousExecution() reports the honest signal
 *  the Agent Fabric enforces via policy.pathway.no-autonomous-execution. (Mirrors the Drug Interaction
 *  Agent's no-autonomous-hold-or-override and the Lab Result Agent's no-autonomous-clinical-action
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE SEQUENCE vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — a sequenced pathway, a detected cycle, OR a missing prerequisite — is a SAFE,
 *  honest OUTPUT: the task COMPLETES (it carries requiresClinicianReview:true, autoExecuted:false). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (one that references a
 *  fabricated step, asserts a sequence that violates a prerequisite or drops a step, or was
 *  autonomously executed / not review-gated) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical pathway engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The pathways + steps below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the SHAPE of
 *  a dependency-ordered clinical pathway deterministically in the demo. Real pathway management uses
 *  evidence-based order sets, a patient's clinical context, timing / scheduling constraints, and the
 *  care team's judgment. There is NO randomness and NO clock anywhere here: the determination is a pure
 *  function of the request's own steps, so the same pathway always yields the same order — which is what
 *  lets the demo, the seeded trace, and the tests agree.
 */

/** A single pathway step declaring its prerequisite step ids. */
export type PathwayStep = {
  /** The step identifier — the sequencing key. */
  stepId: string;
  /** Human-readable step name. */
  name: string;
  /** The step ids that must be completed BEFORE this step. */
  prerequisites: string[];
};

/** A care pathway sequencing request. */
export type CarePathwayRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic pathway reference. */
  pathwayRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The pathway's steps + their prerequisite dependencies. */
  steps: PathwayStep[];
};

/** The disposition of a sequencing determination. */
export type CarePathwayDisposition =
  | "sequenced"
  | "cannot-sequence-cycle-detected"
  | "cannot-sequence-missing-prerequisite";

/** A step whose prerequisites reference ids absent from the pathway. */
export type UnmetPrerequisite = {
  stepId: string;
  missing: string[];
};

/** The deterministic sequencing determination the agent returns. */
export type CarePathwayDetermination = {
  requestRef: string;
  pathwayRef: string;
  patientRef: string;
  disposition: CarePathwayDisposition;
  /** The topologically-ordered step ids (empty unless disposition === "sequenced"). */
  orderedSteps: string[];
  /** For a sequenced pathway, each step's stage (0-based longest-prerequisite-chain depth). */
  stageByStep: Record<string, number>;
  /** For a cycle, the step ids that could not be ordered (participate in / depend on a cycle). */
  cycleMembers: string[];
  /** For a missing prerequisite, the steps whose prerequisites reference absent ids. */
  unmetPrerequisites: UnmetPrerequisite[];
  /** The pathway's steps, echoed so the honesty guards are self-contained. */
  steps: PathwayStep[];
  /** Always true — a clinician confirms and orders every step. */
  requiresClinicianReview: true;
  /** Always false — the agent never autonomously executes a step. */
  autoExecuted: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the pathways are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Normalize the step list to a deterministic, de-duplicated, id-keyed map. */
function indexSteps(steps: PathwayStep[]): Map<string, PathwayStep> {
  const map = new Map<string, PathwayStep>();
  for (const s of steps) {
    if (s && typeof s.stepId === "string" && s.stepId) {
      map.set(s.stepId, {
        stepId: s.stepId,
        name: typeof s.name === "string" ? s.name : s.stepId,
        prerequisites: Array.isArray(s.prerequisites)
          ? s.prerequisites.filter((p): p is string => typeof p === "string" && p.length > 0)
          : []
      });
    }
  }
  return map;
}

/**
 * The deterministic sequencing function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own steps (no randomness, no clock). It first detects MISSING PREREQUISITES (a
 * prerequisite id absent from the pathway); if any, it reports cannot-sequence-missing-prerequisite.
 * Otherwise it runs Kahn's algorithm — repeatedly emitting a ready step (in-degree 0) with the smallest
 * step id, so ties break deterministically — and, if every step is emitted, reports the SEQUENCED order
 * (with each step's stage = longest prerequisite-chain depth); if some steps remain, they participate
 * in a DEPENDENCY CYCLE and it reports cannot-sequence-cycle-detected. Nothing is executed here — every
 * determination is handed to a clinician.
 */
export function evaluateCarePathway(request: CarePathwayRequest): CarePathwayDetermination {
  const stepMap = indexSteps(Array.isArray(request.steps) ? request.steps : []);
  const stepIds = Array.from(stepMap.keys());
  const echoedSteps = stepIds.map((id) => stepMap.get(id)!);

  const base = {
    requestRef: request.requestRef,
    pathwayRef: request.pathwayRef,
    patientRef: request.patientRef,
    steps: echoedSteps,
    requiresClinicianReview: true as const,
    autoExecuted: false as const,
    synthetic: true as const
  };

  // 1) Missing prerequisites — a step depends on an id not in the pathway.
  const unmet: UnmetPrerequisite[] = [];
  for (const id of stepIds.slice().sort()) {
    const step = stepMap.get(id)!;
    const missing = step.prerequisites.filter((p) => !stepMap.has(p)).sort();
    if (missing.length > 0) unmet.push({ stepId: id, missing });
  }
  if (unmet.length > 0) {
    const total = unmet.reduce((n, u) => n + u.missing.length, 0);
    return {
      ...base,
      disposition: "cannot-sequence-missing-prerequisite",
      orderedSteps: [],
      stageByStep: {},
      cycleMembers: [],
      unmetPrerequisites: unmet,
      reason: `Pathway ${request.pathwayRef} cannot be sequenced: ${unmet.length} step(s) reference ${total} missing prerequisite(s).`,
      note:
        `Care pathway ${request.requestRef}: NOT sequenceable — ${unmet.length} step(s) reference a prerequisite that isn't in the pathway (${unmet
          .map((u) => `${u.stepId}→[${u.missing.join(", ")}]`)
          .join("; ")}). ` +
        "PHI-bearing — the pathway references the patient. Synthetic/illustrative pathway — NOT a certified clinical pathway engine. The agent never executes a step on its own — a clinician confirms and orders every one."
    };
  }

  // 2) Kahn's algorithm — deterministic (smallest ready step id first).
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of stepIds) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const id of stepIds) {
    for (const pre of stepMap.get(id)!.prerequisites) {
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      dependents.get(pre)!.push(id);
    }
  }

  const ordered: string[] = [];
  const stage: Record<string, number> = {};
  // Ready set kept sorted by stepId for determinism.
  const ready = stepIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    const preStages = stepMap.get(id)!.prerequisites.map((p) => stage[p] ?? 0);
    stage[id] = preStages.length === 0 ? 0 : Math.max(...preStages) + 1;
    for (const dep of dependents.get(id)!.slice().sort()) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if ((indegree.get(dep) ?? 0) === 0) {
        // Insert keeping ready sorted.
        ready.push(dep);
        ready.sort();
      }
    }
  }

  if (ordered.length === stepIds.length) {
    const maxStage = ordered.length > 0 ? Math.max(...ordered.map((id) => stage[id])) : 0;
    return {
      ...base,
      disposition: "sequenced",
      orderedSteps: ordered,
      stageByStep: stage,
      cycleMembers: [],
      unmetPrerequisites: [],
      reason: `Pathway ${request.pathwayRef} sequenced: ${ordered.length} step(s) across ${maxStage + 1} stage(s).`,
      note:
        `Care pathway ${request.requestRef}: SEQUENCED — ${ordered.length} step(s) ordered to respect every prerequisite across ${maxStage + 1} stage(s). ` +
        "PHI-bearing — the pathway references the patient. Synthetic/illustrative pathway — NOT a certified clinical pathway engine; real pathway management uses evidence-based order sets, the patient's clinical context, scheduling constraints, and the care team's judgment. The agent never executes a step on its own — a clinician confirms and orders every one."
    };
  }

  // 3) Cycle — the un-emitted steps participate in / depend on a cycle.
  const cycleMembers = stepIds.filter((id) => !ordered.includes(id)).sort();
  return {
    ...base,
    disposition: "cannot-sequence-cycle-detected",
    orderedSteps: [],
    stageByStep: {},
    cycleMembers,
    unmetPrerequisites: [],
    reason: `Pathway ${request.pathwayRef} cannot be sequenced: a dependency cycle involves ${cycleMembers.length} step(s).`,
    note:
      `Care pathway ${request.requestRef}: NOT sequenceable — a circular dependency involves ${cycleMembers.length} step(s) (${cycleMembers.join(", ")}); no valid order exists. ` +
      "PHI-bearing — the pathway references the patient. Synthetic/illustrative pathway — NOT a certified clinical pathway engine. The agent never executes a step on its own — a clinician confirms and orders every one."
  };
}

/** Collect every step id referenced anywhere in the determination's output. */
function referencedStepIds(decision: {
  orderedSteps?: unknown;
  stageByStep?: unknown;
  cycleMembers?: unknown;
  unmetPrerequisites?: unknown;
}): string[] {
  const ids: string[] = [];
  if (Array.isArray(decision.orderedSteps)) {
    for (const x of decision.orderedSteps) if (typeof x === "string") ids.push(x);
  }
  if (decision.stageByStep && typeof decision.stageByStep === "object") {
    for (const k of Object.keys(decision.stageByStep as Record<string, unknown>)) ids.push(k);
  }
  if (Array.isArray(decision.cycleMembers)) {
    for (const x of decision.cycleMembers) if (typeof x === "string") ids.push(x);
  }
  if (Array.isArray(decision.unmetPrerequisites)) {
    for (const u of decision.unmetPrerequisites as Array<{ stepId?: unknown }>) {
      if (u && typeof u.stepId === "string") ids.push(u.stepId);
    }
  }
  return ids;
}

/**
 * Steps-sourced check: does every step id in the determination's output reference a submitted step?
 * True only when the ordered sequence, the stage map, the reported cycle members, and the
 * missing-prerequisite holders all reference ids present in decision.steps. Catches a fabricated /
 * dangling step id. Anything evaluateCarePathway() produces satisfies it. This is the honest signal the
 * route reports to policy.pathway.steps-sourced. A non-object / malformed input is a violation.
 */
export function pathwayStepsSourced(
  decision:
    | {
        steps?: Array<{ stepId?: string }>;
        orderedSteps?: unknown;
        stageByStep?: unknown;
        cycleMembers?: unknown;
        unmetPrerequisites?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (!Array.isArray(decision.steps)) return false;
  const known = new Set<string>();
  for (const s of decision.steps) {
    if (!s || typeof s.stepId !== "string" || !s.stepId) return false;
    known.add(s.stepId);
  }
  for (const id of referencedStepIds(decision)) {
    if (!known.has(id)) return false;
  }
  return true;
}

/**
 * Sequence-valid check: is the asserted disposition consistent with the steps? For a SEQUENCED
 * determination, orderedSteps must be a complete permutation of the pathway's step ids (none dropped or
 * duplicated) and every step must appear AFTER all of its prerequisites. For an UN-sequenceable
 * determination (a cycle or a missing prerequisite), orderedSteps must be empty. Catches an ordering
 * that violates a prerequisite, drops / duplicates a step, or asserts an order where none exists. The
 * load-bearing correctness gate. Anything evaluateCarePathway() produces satisfies it. This is the
 * honest signal the route reports to policy.pathway.sequence-valid. A non-object input is a violation.
 */
export function pathwaySequenceValid(
  decision:
    | {
        disposition?: string;
        orderedSteps?: unknown;
        steps?: Array<{ stepId?: string; prerequisites?: string[] }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (!Array.isArray(decision.steps)) return false;

  if (decision.disposition !== "sequenced") {
    // A non-sequenced disposition must not assert an order.
    return Array.isArray(decision.orderedSteps) && decision.orderedSteps.length === 0;
  }

  const ordered = Array.isArray(decision.orderedSteps)
    ? decision.orderedSteps.filter((x): x is string => typeof x === "string")
    : null;
  if (!ordered) return false;

  const stepIds = decision.steps
    .map((s) => s?.stepId)
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  // Complete permutation: same set, no duplicates, same length.
  if (ordered.length !== stepIds.length) return false;
  const orderedSet = new Set(ordered);
  if (orderedSet.size !== ordered.length) return false;
  for (const id of stepIds) if (!orderedSet.has(id)) return false;

  // Every prerequisite appears strictly before its dependent.
  const position = new Map<string, number>();
  ordered.forEach((id, i) => position.set(id, i));
  for (const s of decision.steps) {
    if (!s || typeof s.stepId !== "string") continue;
    const here = position.get(s.stepId);
    if (here === undefined) return false;
    const prereqs = Array.isArray(s.prerequisites) ? s.prerequisites : [];
    for (const pre of prereqs) {
      const there = position.get(pre);
      if (there === undefined) return false; // dangling prerequisite in a "sequenced" result
      if (there >= here) return false; // prerequisite not before dependent
    }
  }
  return true;
}

/**
 * No-autonomous-execution check: did the agent avoid autonomously executing a step? True unless the
 * determination reports it autonomously executed the pathway (autoExecuted:true) or does not require
 * clinician review (requiresClinicianReview:false). Anything evaluateCarePathway() produces satisfies
 * it. This is the honest signal the route reports to policy.pathway.no-autonomous-execution. A
 * non-object input is a violation.
 */
export function pathwayNoAutonomousExecution(
  decision:
    | { autoExecuted?: boolean; requiresClinicianReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoExecuted === true) return false;
  if (decision.requiresClinicianReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function carePathwaySummary(decision: CarePathwayDetermination): {
  requestRef: string;
  pathwayRef: string;
  disposition: CarePathwayDisposition;
  stepCount: number;
  stageCount: number;
  cycleCount: number;
  missingCount: number;
  requiresClinicianReview: boolean;
  synthetic: boolean;
} {
  const stageCount =
    decision.disposition === "sequenced" && decision.orderedSteps.length > 0
      ? Math.max(...decision.orderedSteps.map((id) => decision.stageByStep[id] ?? 0)) + 1
      : 0;
  return {
    requestRef: decision.requestRef,
    pathwayRef: decision.pathwayRef,
    disposition: decision.disposition,
    stepCount: decision.steps.length,
    stageCount,
    cycleCount: decision.cycleMembers.length,
    missingCount: decision.unmetPrerequisites.reduce((n, u) => n + u.missing.length, 0),
    requiresClinicianReview: decision.requiresClinicianReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a menopause work-up-to-treatment pathway that sequences cleanly —
 * baseline labs → confirm diagnosis + risk screening (parallel) → shared decision-making → initiate
 * therapy → follow-up. Synthetic.
 */
export const DEMO_CARE_PATHWAY_REQUEST: CarePathwayRequest = {
  requestRef: "pathway-001",
  pathwayRef: "menopause-workup-v1",
  patientRef: "patient-4821",
  steps: [
    { stepId: "s1", name: "Baseline labs & symptom assessment", prerequisites: [] },
    { stepId: "s2", name: "Confirm menopause diagnosis", prerequisites: ["s1"] },
    { stepId: "s3", name: "Cardiovascular & breast-cancer risk screening", prerequisites: ["s1"] },
    { stepId: "s4", name: "Shared decision-making visit", prerequisites: ["s2", "s3"] },
    { stepId: "s5", name: "Initiate MHT or non-hormonal therapy", prerequisites: ["s4"] },
    { stepId: "s6", name: "3-month follow-up & titration", prerequisites: ["s5"] }
  ]
};

/**
 * A representative demo request: a pathway with a circular dependency (a↔) that cannot be sequenced.
 * Synthetic.
 */
export const DEMO_CARE_PATHWAY_CYCLE_REQUEST: CarePathwayRequest = {
  requestRef: "pathway-002",
  pathwayRef: "broken-cycle-v1",
  patientRef: "patient-7799",
  steps: [
    { stepId: "a", name: "Step A", prerequisites: ["c"] },
    { stepId: "b", name: "Step B", prerequisites: ["a"] },
    { stepId: "c", name: "Step C", prerequisites: ["b"] }
  ]
};

/**
 * A representative demo request: a pathway whose step depends on a prerequisite that isn't in the
 * pathway. Synthetic.
 */
export const DEMO_CARE_PATHWAY_MISSING_REQUEST: CarePathwayRequest = {
  requestRef: "pathway-003",
  pathwayRef: "missing-prereq-v1",
  patientRef: "patient-9001",
  steps: [
    { stepId: "s1", name: "Order baseline labs", prerequisites: [] },
    { stepId: "s2", name: "Start therapy", prerequisites: ["s1", "s9"] }
  ]
};
