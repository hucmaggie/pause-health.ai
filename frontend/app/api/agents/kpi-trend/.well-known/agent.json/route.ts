import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Commercial KPI Trend & Projection agent — a commercial-operations /
 * analytics service on the commercial CRM plane (no patient PHI).
 *
 *   GET /api/agents/kpi-trend/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "kpi-trend-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Commercial KPI Trend & Projection",
  description:
    "A commercial-operations / analytics service on the commercial CRM plane (NO patient PHI, NOT on the HIPAA-audit policy) — a DETERMINISTIC (no-Claude) agent that, given a time-ordered series of a business METRIC (monthly provider-org adoption, active enrolled patients, ARR, bookings), fits an ordinary LEAST-SQUARES linear-regression line through the observations, reports its SLOPE + INTERCEPT + R² (goodness of fit), classifies the trend (rising / flat / declining) against a documented flat tolerance, and PROJECTS the metric to a future horizon. UNLIKE the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Pipeline Management agent's FORECAST ROLLUP (which SUMS CRM opportunity records into committed / best-case figures — an aggregation of records, no fitted model), the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS (which ranks ONE value against a static distribution; it fits no line and projects nothing), the Quality Shift agent's CUSUM (which accumulates a running deviation to catch a SUSTAINED shift; it fits no model and extrapolates nothing), and the Remote Patient Monitoring agent's WINDOW-VS-BASELINE trend classification (which compares a recent window to a baseline window; it fits no line) — the heart of this service is ORDINARY LEAST-SQUARES LINEAR REGRESSION: the closed-form best-fit line minimizing the sum of squared residuals (slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²), intercept = (Σy − slope·Σx) / n, R² = 1 − SSres/SStot), plus a projection ŷ = slope·horizon + intercept. A mis-fit line reports a trend the data doesn't support and a projection nobody should plan against, so the agent fits DETERMINISTICALLY (a pure function of the observations' own indices + values + the parameters — no clock, no randomness — so the same request always yields the same line) and hands the forecast to a human. Every fitted point traces to a submitted observation (a fabricated / dropped point is blocked — the sourced + completeness gate), the fit + projection recompute (a mis-fit line or a fabricated projection is blocked — the load-bearing correctness gate), and no projection is committed as a forecast, no quota adjusted, and finance not notified autonomously (an autonomous commit is blocked). It COMPLEMENTS — it does not duplicate — the other commercial agents: distinct from the Pipeline Management agent (which rolls up opportunity records into a forecast) and the Account Management agent (which health-scores signed accounts) — this fits a least-squares trend line to a KPI series and projects it. It operates ONLY on the commercial CRM plane and carries NO patient PHI. The metrics are illustrative, clearly labeled — NOT a certified forecasting / FP&A system (real commercial forecasting weighs seasonality, pipeline mix, cohort dynamics, macro conditions, and human judgment — not a single straight line through past points). Enforces, via the Pause Agent Fabric, that every fitted point is sourced, the fit + projection recompute, and no projection is ever committed autonomously.",
  url: `${HOST}/api/agents/kpi-trend`,
  provider: {
    organization: "Salesforce Agentforce (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "fit-and-project-kpi-trend",
      name: "Fit a least-squares trend line to a KPI series and project it forward",
      description:
        "Given a time-ordered series of a business metric, deterministically fits an ordinary least-squares linear-regression line, reports slope + intercept + R² (goodness of fit), classifies the trend (rising / flat / declining) against a documented flat tolerance, and projects the metric to a future horizon. Every fitted point is sourced; the fit + projection recompute; no projection is committed autonomously. No patient PHI.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "commercial-operations",
        "analytics",
        "forecasting",
        "linear-regression",
        "least-squares",
        "governance"
      ]
    }
  ],
  pauseGovernance: {
    fabricRegisteredAs: FABRIC_AGENT_ID,
    policies: getPoliciesForAgent(FABRIC_AGENT_ID).map((p) => p.id)
  }
};

export async function GET() {
  return NextResponse.json(CARD, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
    }
  });
}
