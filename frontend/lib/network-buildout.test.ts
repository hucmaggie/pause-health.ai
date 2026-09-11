import { describe, expect, it } from "vitest";

import {
  DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST,
  DEMO_NETWORK_BUILDOUT_REQUEST,
  DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
  evaluateNetworkBuildout,
  kruskalMST,
  networkBuildoutSummary,
  noAutonomousProvision,
  treeOptimal,
  treeSourced
} from "./network-buildout";

describe("kruskalMST", () => {
  it("builds the minimum spanning tree connecting every site", () => {
    const { chosenLinks, totalCost, componentCount } = kruskalMST(
      DEMO_NETWORK_BUILDOUT_REQUEST.sites,
      DEMO_NETWORK_BUILDOUT_REQUEST.links
    );
    expect(totalCost).toBe(18);
    expect(chosenLinks).toHaveLength(4);
    expect(componentCount).toBe(1);
  });

  it("drops a cycle-closing link (keeps the two cheapest of a triangle)", () => {
    const { chosenLinks, totalCost, componentCount } = kruskalMST(
      DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST.sites,
      DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST.links
    );
    expect(totalCost).toBe(3);
    expect(chosenLinks.map((l) => l.cost)).toEqual([1, 2]);
    expect(componentCount).toBe(1);
  });

  it("produces a spanning forest when the links can't connect everything", () => {
    const { totalCost, componentCount } = kruskalMST(
      DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST.sites,
      DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST.links
    );
    expect(totalCost).toBe(9);
    expect(componentCount).toBe(2);
  });

  it("ignores links to unknown sites and self-loops", () => {
    const { chosenLinks, totalCost, componentCount } = kruskalMST(
      ["a", "b"],
      [
        { a: "a", b: "ghost", cost: 1 },
        { a: "a", b: "a", cost: 1 },
        { a: "a", b: "b", cost: 5 }
      ]
    );
    expect(chosenLinks).toHaveLength(1);
    expect(totalCost).toBe(5);
    expect(componentCount).toBe(1);
  });

  it("reports 0 components for no sites", () => {
    expect(kruskalMST([], []).componentCount).toBe(0);
  });
});

describe("evaluateNetworkBuildout", () => {
  it("classifies a connected network", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(d.disposition).toBe("connected");
    expect(d.totalCost).toBe(18);
    expect(d.chosenLinks).toHaveLength(4);
    expect(d.componentCount).toBe(1);
    expect(d.siteCount).toBe(5);
    expect(d.linkCount).toBe(7);
    expect(d.requiresArchitectReview).toBe(true);
    expect(d.autoProvisioned).toBe(false);
  });

  it("classifies a partitioned network", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST);
    expect(d.disposition).toBe("partitioned");
    expect(d.totalCost).toBe(9);
    expect(d.componentCount).toBe(2);
  });

  it("is deterministic", () => {
    expect(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST)).toEqual(
      evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST)
    );
  });
});

describe("treeSourced", () => {
  it("is true for each demo plan", () => {
    expect(treeSourced(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST))).toBe(true);
    expect(treeSourced(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST))).toBe(true);
    expect(treeSourced(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST))).toBe(true);
  });

  it("is false for a fabricated link not among the candidates", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    const chosenLinks = [...d.chosenLinks.slice(0, 3), { a: "hub", b: "west", cost: 1 }];
    const total = chosenLinks.reduce((s, l) => s + l.cost, 0);
    expect(treeSourced({ ...d, chosenLinks, totalCost: total })).toBe(false);
  });

  it("is false for a dishonest total cost", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(treeSourced({ ...d, totalCost: d.totalCost + 1 })).toBe(false);
  });

  it("is false for a cycle among the chosen links", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST);
    // Add the third triangle link back in — now the chosen set has a cycle.
    const chosenLinks = [...d.chosenLinks, { a: "site-x", b: "site-z", cost: 9 }];
    const total = chosenLinks.reduce((s, l) => s + l.cost, 0);
    expect(treeSourced({ ...d, chosenLinks, totalCost: total })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(treeSourced(null)).toBe(false);
  });
});

describe("treeOptimal", () => {
  it("is true for each demo plan", () => {
    expect(treeOptimal(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST))).toBe(true);
    expect(treeOptimal(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal tree (while tree-sourced stays true)", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST);
    // A valid, acyclic spanning tree that is NOT minimal: x-y(1) + x-z(9) connects all three (skip y-z(2)).
    const chosenLinks = [
      { a: "site-x", b: "site-y", cost: 1 },
      { a: "site-x", b: "site-z", cost: 9 }
    ];
    const tampered = { ...d, chosenLinks, totalCost: 10, componentCount: 1 };
    expect(treeSourced(tampered)).toBe(true);
    expect(treeOptimal(tampered)).toBe(false);
  });

  it("is false for an understated total cost", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(treeOptimal({ ...d, totalCost: 17 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(treeOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousProvision", () => {
  it("is true for a produced plan", () => {
    expect(noAutonomousProvision(evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST))).toBe(true);
  });

  it("is false when auto-provisioned", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(noAutonomousProvision({ ...d, autoProvisioned: true as unknown as false })).toBe(false);
  });

  it("is false when architect review is skipped", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(noAutonomousProvision({ ...d, requiresArchitectReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousProvision(null)).toBe(false);
  });
});

describe("networkBuildoutSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
    expect(networkBuildoutSummary(d)).toEqual({
      networkRef: "network-buildout-hub-4501",
      disposition: "connected",
      siteCount: 5,
      linkCount: 7,
      chosenLinkCount: 4,
      totalCost: 18,
      componentCount: 1,
      requiresArchitectReview: true,
      synthetic: true
    });
  });
});
