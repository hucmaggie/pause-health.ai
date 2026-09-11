import { describe, expect, it } from "vitest";

import {
  type NetworkAdequacyDetermination,
  DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
  DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST,
  DEMO_NETWORK_ADEQUACY_REQUEST,
  distancesConsistent,
  evaluateNetworkAdequacy,
  haversineMiles,
  networkAdequacySummary,
  noAutonomousNetworkChange,
  providersSourced,
  round2
} from "./network-adequacy";

describe("haversineMiles", () => {
  it("is zero for identical points", () => {
    expect(round2(haversineMiles(40.7128, -74.006, 40.7128, -74.006))).toBe(0);
  });

  it("computes a known short distance (member → downtown cardiology)", () => {
    expect(round2(haversineMiles(40.7128, -74.006, 40.72, -74.01))).toBe(0.54);
  });

  it("is symmetric", () => {
    const a = haversineMiles(40.7128, -74.006, 41.0, -74.5);
    const b = haversineMiles(41.0, -74.5, 40.7128, -74.006);
    expect(round2(a)).toBe(round2(b));
  });
});

describe("evaluateNetworkAdequacy", () => {
  it("reports adequacy-met when the nearest provider is within the standard", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(d.disposition).toBe("adequacy-met");
    expect(d.matchingProviderCount).toBe(2);
    expect(d.nearest?.providerId).toBe("p1");
    expect(d.nearestDistanceMiles).toBe(0.54);
    // Off-specialty dermatology provider is excluded.
    expect(d.evaluated.map((e) => e.providerId)).toEqual(["p1", "p2"]);
    expect(d.requiresNetworkReview).toBe(true);
    expect(d.autoCertified).toBe(false);
  });

  it("sorts evaluated providers ascending by distance", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(d.evaluated[0].distanceMiles).toBeLessThanOrEqual(d.evaluated[1].distanceMiles);
  });

  it("reports adequacy-gap when the nearest provider is beyond the standard", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(d.disposition).toBe("adequacy-gap");
    expect(d.nearest?.providerId).toBe("e1");
    expect(d.nearestDistanceMiles).toBe(16.44);
  });

  it("reports adequacy-gap with a null nearest when there is no matching provider", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST);
    expect(d.disposition).toBe("adequacy-gap");
    expect(d.matchingProviderCount).toBe(0);
    expect(d.nearest).toBeNull();
    expect(d.nearestDistanceMiles).toBeNull();
    expect(d.evaluated).toEqual([]);
  });

  it("echoes the member + providers so the guards can recompute", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(d.member.latitude).toBe(40.7128);
    expect(d.providers).toHaveLength(3);
    expect(d.evaluated[0].latitude).toBe(40.72);
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    const b = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("providersSourced", () => {
  it("is true for each demo finding", () => {
    expect(providersSourced(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST))).toBe(true);
    expect(providersSourced(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST))).toBe(true);
    expect(
      providersSourced(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST))
    ).toBe(true);
  });

  it("is false when a phantom provider (not in the submitted network) is evaluated", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    const tampered = {
      ...d,
      evaluated: [
        {
          providerId: "ex",
          label: "Phantom Endocrine",
          specialty: "endocrinology",
          latitude: 40.715,
          longitude: -74.008,
          distanceMiles: 0.18
        },
        ...d.evaluated
      ],
      nearest: { providerId: "ex", label: "Phantom Endocrine", distanceMiles: 0.18 },
      nearestDistanceMiles: 0.18,
      matchingProviderCount: 3,
      disposition: "adequacy-met" as const
    };
    expect(providersSourced(tampered)).toBe(false);
  });

  it("is false when a submitted matching provider is dropped", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(
      providersSourced({
        ...d,
        evaluated: [d.evaluated[0]],
        nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 16.44 },
        nearestDistanceMiles: 16.44,
        matchingProviderCount: 1
      })
    ).toBe(false);
  });

  it("is false when the matching count doesn't match the evaluated length", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(providersSourced({ ...d, matchingProviderCount: 5 })).toBe(false);
  });

  it("ignores a mis-measured distance — isolated from the consistency check", () => {
    // Understate e1's distance: still a submitted provider, so sourced passes …
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    const tampered = {
      ...d,
      evaluated: [{ ...d.evaluated[0], distanceMiles: 5.0 }, d.evaluated[1]],
      nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 5.0 },
      nearestDistanceMiles: 5.0,
      disposition: "adequacy-met" as const
    };
    expect(providersSourced(tampered)).toBe(true);
    // … while the consistency check flags the mis-measured distance.
    expect(distancesConsistent(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(providersSourced(null)).toBe(false);
  });
});

describe("distancesConsistent", () => {
  it("is true for each demo finding", () => {
    expect(distancesConsistent(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST))).toBe(true);
    expect(distancesConsistent(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST))).toBe(
      true
    );
    expect(
      distancesConsistent(evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST))
    ).toBe(true);
  });

  it("is false when a reported distance doesn't recompute", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    const tampered = {
      ...d,
      evaluated: [{ ...d.evaluated[0], distanceMiles: 5.0 }, d.evaluated[1]],
      nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 5.0 },
      nearestDistanceMiles: 5.0,
      disposition: "adequacy-met" as const
    };
    expect(distancesConsistent(tampered)).toBe(false);
  });

  it("is false when the disposition doesn't follow the recomputed nearest", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(distancesConsistent({ ...d, disposition: "adequacy-met" })).toBe(false);
  });

  it("is false when the nearest is wrong", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(
      distancesConsistent({
        ...d,
        nearest: { providerId: "e2", label: "Suburban Endocrine", distanceMiles: 32.56 },
        nearestDistanceMiles: 32.56
      })
    ).toBe(false);
  });

  it("ignores a phantom provider's network membership — recomputes its geometry from its own coords", () => {
    // The phantom's coordinates are self-consistent, so the geometry recomputes …
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    const tampered = {
      ...d,
      evaluated: [
        {
          providerId: "ex",
          label: "Phantom Endocrine",
          specialty: "endocrinology",
          latitude: 40.715,
          longitude: -74.008,
          distanceMiles: 0.18
        },
        ...d.evaluated
      ],
      nearest: { providerId: "ex", label: "Phantom Endocrine", distanceMiles: 0.18 },
      nearestDistanceMiles: 0.18,
      matchingProviderCount: 3,
      disposition: "adequacy-met" as const
    };
    expect(distancesConsistent(tampered)).toBe(true);
    // … while the sourced check flags the phantom membership.
    expect(providersSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(distancesConsistent(null)).toBe(false);
  });
});

describe("noAutonomousNetworkChange", () => {
  it("is true for a produced determination", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(noAutonomousNetworkChange(d)).toBe(true);
  });

  it("is false when the network was auto-certified", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(
      noAutonomousNetworkChange({
        ...(d as NetworkAdequacyDetermination),
        autoCertified: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when network review is skipped", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_REQUEST);
    expect(
      noAutonomousNetworkChange({
        ...(d as NetworkAdequacyDetermination),
        requiresNetworkReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousNetworkChange(null)).toBe(false);
  });
});

describe("networkAdequacySummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateNetworkAdequacy(DEMO_NETWORK_ADEQUACY_GAP_REQUEST);
    expect(networkAdequacySummary(d)).toEqual({
      caseRef: "adequacy-case-002",
      disposition: "adequacy-gap",
      requiredSpecialty: "endocrinology",
      maxDistanceMiles: 10,
      matchingProviderCount: 2,
      nearestDistanceMiles: 16.44,
      requiresNetworkReview: true,
      synthetic: true
    });
  });
});
