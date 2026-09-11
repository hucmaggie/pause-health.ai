import { describe, expect, it } from "vitest";

import {
  DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
  evaluateReferralThroughput,
  flowSourced,
  maxFlowValue,
  minCut,
  noAutonomousRoute,
  referralThroughputSummary,
  reconstructFlows,
  throughputOptimal
} from "./referral-throughput";

describe("maxFlowValue / minCut", () => {
  it("computes the bottlenecked menoclinic network", () => {
    expect(maxFlowValue(DEMO_REFERRAL_THROUGHPUT_REQUEST)).toBe(8);
    const { capacity } = minCut(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(capacity).toBe(8); // max-flow min-cut theorem
  });

  it("computes the unconstrained network", () => {
    expect(maxFlowValue(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST)).toBe(3);
    expect(minCut(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST).capacity).toBe(3);
  });

  it("computes the diamond with back-edge cancellation", () => {
    expect(maxFlowValue(DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST)).toBe(3);
    expect(minCut(DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST).capacity).toBe(3);
  });

  it("is 0 when source equals sink or the sink is unreachable", () => {
    expect(maxFlowValue({ networkRef: "x", source: "a", sink: "a", edges: [] })).toBe(0);
    expect(
      maxFlowValue({ networkRef: "x", source: "a", sink: "z", edges: [{ from: "a", to: "b", capacity: 5 }] })
    ).toBe(0);
  });
});

describe("reconstructFlows", () => {
  it("produces a feasible flow whose net out of source equals the max flow", () => {
    const flows = reconstructFlows(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    const out = flows
      .filter((f) => f.from === "intake")
      .reduce((s, f) => s + f.flow, 0);
    expect(out).toBe(8);
    // No edge exceeds its capacity.
    for (const f of flows) {
      const edge = DEMO_REFERRAL_THROUGHPUT_REQUEST.edges.find(
        (e) => e.from === f.from && e.to === f.to
      )!;
      expect(f.flow).toBeLessThanOrEqual(edge.capacity);
      expect(f.flow).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("evaluateReferralThroughput", () => {
  it("classifies a bottlenecked network", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(d.disposition).toBe("bottlenecked");
    expect(d.maxFlow).toBe(8);
    expect(d.totalDemand).toBe(12);
    expect(d.minCutCapacity).toBe(8);
    expect(d.minCutEdges.length).toBeGreaterThan(0);
    expect(d.requiresCoordinatorReview).toBe(true);
    expect(d.autoRouted).toBe(false);
  });

  it("classifies an unconstrained network", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST);
    expect(d.disposition).toBe("unconstrained");
    expect(d.maxFlow).toBe(3);
    expect(d.totalDemand).toBe(3);
  });

  it("is deterministic", () => {
    expect(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST)).toEqual(
      evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST)
    );
  });
});

describe("flowSourced", () => {
  it("is true for each demo plan", () => {
    expect(flowSourced(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST))).toBe(true);
    expect(flowSourced(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST))).toBe(true);
    expect(flowSourced(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST))).toBe(true);
  });

  it("is false for a flow that exceeds an edge capacity", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    const flows = d.flows.map((f, i) => (i === 0 ? { ...f, flow: f.flow + 100 } : f));
    expect(flowSourced({ ...d, flows })).toBe(false);
  });

  it("is false for a conservation violation (dropped mid-network flow)", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    // Zero out one gyn->slots edge flow without adjusting inflow: gyn no longer conserves.
    const flows = d.flows.map((f) =>
      f.from === "gyn" && f.to === "slots" ? { ...f, flow: 0 } : f
    );
    expect(flowSourced({ ...d, flows })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(flowSourced(null)).toBe(false);
  });
});

describe("throughputOptimal", () => {
  it("is true for each demo plan", () => {
    expect(throughputOptimal(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST))).toBe(true);
    expect(throughputOptimal(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST))).toBe(true);
  });

  it("is false for a sub-maximal throughput (while flow-sourced stays true)", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST);
    // A feasible but sub-maximal flow: push only 2 of the achievable 3 along the single path.
    const flows = d.flows.map((f) => ({ ...f, flow: 2 }));
    const tampered = { ...d, flows, maxFlow: 2, minCutCapacity: 2, disposition: "unconstrained" as const };
    expect(flowSourced(tampered)).toBe(true);
    expect(throughputOptimal(tampered)).toBe(false);
  });

  it("is false for an overstated max flow", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(throughputOptimal({ ...d, maxFlow: 9, minCutCapacity: 9 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(throughputOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousRoute", () => {
  it("is true for a produced plan", () => {
    expect(noAutonomousRoute(evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST))).toBe(true);
  });

  it("is false when auto-routed", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(noAutonomousRoute({ ...d, autoRouted: true as unknown as false })).toBe(false);
  });

  it("is false when coordinator review is skipped", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(noAutonomousRoute({ ...d, requiresCoordinatorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousRoute(null)).toBe(false);
  });
});

describe("referralThroughputSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
    expect(referralThroughputSummary(d)).toEqual({
      networkRef: "referral-network-menoclinic-5510",
      disposition: "bottlenecked",
      maxFlow: 8,
      totalDemand: 12,
      minCutCapacity: 8,
      minCutEdgeCount: d.minCutEdges.length,
      nodeCount: d.nodeCount,
      edgeCount: 7,
      requiresCoordinatorReview: true,
      synthetic: true
    });
  });
});
