import { describe, expect, it } from "vitest";

import {
  DEMO_CARE_ROUTE_DIRECT_REQUEST,
  DEMO_CARE_ROUTE_NO_ROUTE_REQUEST,
  DEMO_CARE_ROUTE_REQUEST,
  careRouteSummary,
  dijkstra,
  evaluateCareRoute,
  noAutonomousRouting,
  pathSourced,
  routeOptimal
} from "./care-routing";

describe("dijkstra", () => {
  it("finds the minimum-total-weight path", () => {
    const { path, distance } = dijkstra(
      DEMO_CARE_ROUTE_REQUEST.edges,
      "hospital",
      "home"
    );
    expect(distance).toBe(7);
    expect(path).toEqual(["hospital", "snf", "home-health", "home"]);
  });

  it("prefers a cheaper direct edge over a longer detour", () => {
    const { path, distance } = dijkstra(
      DEMO_CARE_ROUTE_DIRECT_REQUEST.edges,
      "clinic",
      "specialist"
    );
    expect(distance).toBe(2);
    expect(path).toEqual(["clinic", "specialist"]);
  });

  it("returns no path when the goal is unreachable", () => {
    const { path, distance } = dijkstra(
      DEMO_CARE_ROUTE_NO_ROUTE_REQUEST.edges,
      "hospital",
      "home"
    );
    expect(distance).toBeNull();
    expect(path).toEqual([]);
  });
});

describe("evaluateCareRoute", () => {
  it("routes a multi-hop least-burden path (route-found)", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(d.disposition).toBe("route-found");
    expect(d.totalCost).toBe(7);
    expect(d.hops).toBe(3);
    expect(d.path).toEqual(["hospital", "snf", "home-health", "home"]);
    expect(d.reachable).toBe(true);
    expect(d.requiresCareLeadReview).toBe(true);
    expect(d.autoRouted).toBe(false);
  });

  it("routes the direct edge when it is cheapest", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_DIRECT_REQUEST);
    expect(d.totalCost).toBe(2);
    expect(d.path).toEqual(["clinic", "specialist"]);
  });

  it("reports no-route when the goal is unreachable", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_NO_ROUTE_REQUEST);
    expect(d.disposition).toBe("no-route");
    expect(d.totalCost).toBeNull();
    expect(d.path).toEqual([]);
    expect(d.reachable).toBe(false);
    expect(d.hops).toBe(0);
  });

  it("is deterministic", () => {
    expect(evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST)).toEqual(
      evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST)
    );
  });
});

describe("pathSourced", () => {
  it("is true for each demo route", () => {
    expect(pathSourced(evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST))).toBe(true);
    expect(pathSourced(evaluateCareRoute(DEMO_CARE_ROUTE_DIRECT_REQUEST))).toBe(true);
    expect(pathSourced(evaluateCareRoute(DEMO_CARE_ROUTE_NO_ROUTE_REQUEST))).toBe(true);
  });

  it("is false for a fabricated-edge path (isolated from route-optimal)", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    // Path uses hospital -> home-health directly, which is NOT a submitted edge,
    // but still reports the true optimum totalCost 7.
    const tampered = { ...d, path: ["hospital", "home-health", "home"], hops: 2 };
    expect(pathSourced(tampered)).toBe(false);
    expect(routeOptimal(tampered)).toBe(true);
  });

  it("is false when the path doesn't start at the start node", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(pathSourced({ ...d, path: ["snf", "home-health", "home"] })).toBe(false);
  });

  it("is false when the totalCost doesn't match the path edges", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(pathSourced({ ...d, totalCost: 999 })).toBe(false);
  });

  it("is false when a no-route determination carries a non-empty path", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_NO_ROUTE_REQUEST);
    expect(pathSourced({ ...d, path: ["hospital", "snf"] })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(pathSourced(null)).toBe(false);
  });
});

describe("routeOptimal", () => {
  it("is true for each demo route", () => {
    expect(routeOptimal(evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST))).toBe(true);
    expect(routeOptimal(evaluateCareRoute(DEMO_CARE_ROUTE_DIRECT_REQUEST))).toBe(true);
    expect(routeOptimal(evaluateCareRoute(DEMO_CARE_ROUTE_NO_ROUTE_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal real-edge route (while path-sourced stays true)", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    // A valid real-edge path (hospital -> snf -> home = 2 + 6 = 8) that is not the optimum (7).
    const tampered = { ...d, path: ["hospital", "snf", "home"], totalCost: 8, hops: 2 };
    expect(pathSourced(tampered)).toBe(true);
    expect(routeOptimal(tampered)).toBe(false);
  });

  it("is false for a false 'unreachable' when a route exists", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    const tampered = {
      ...d,
      path: [] as string[],
      totalCost: null,
      reachable: false,
      disposition: "no-route" as const
    };
    expect(routeOptimal(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(routeOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousRouting", () => {
  it("is true for a produced route", () => {
    expect(noAutonomousRouting(evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST))).toBe(true);
  });

  it("is false when auto-routed", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(noAutonomousRouting({ ...d, autoRouted: true as unknown as false })).toBe(false);
  });

  it("is false when care-lead review is skipped", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(noAutonomousRouting({ ...d, requiresCareLeadReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousRouting(null)).toBe(false);
  });
});

describe("careRouteSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);
    expect(careRouteSummary(d)).toEqual({
      routeRef: "care-route-001",
      disposition: "route-found",
      edgeCount: 7,
      hops: 3,
      totalCost: 7,
      reachable: true,
      requiresCareLeadReview: true,
      synthetic: true
    });
  });
});
