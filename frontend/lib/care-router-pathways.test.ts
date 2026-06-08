import { describe, expect, it } from "vitest";
import {
  CARE_ROUTER_PATHWAYS,
  PATHWAY_LABELS,
  PATHWAY_TARGETS,
  describePathway,
  type CareRouterPathway
} from "./care-router-pathways";

/**
 * Tests for the canonical Care Router pathway enum.
 *
 * The module exists specifically because labels and pathway ids
 * previously drifted across /demo/routing, the live decision card,
 * and the risk-band suggestion. These tests pin the contract so the
 * drift cannot reappear.
 */

const EXPECTED_PATHWAYS: CareRouterPathway[] = [
  "self-care-tracking",
  "mscp-virtual-visit",
  "mscp-in-person",
  "behavioral-health-handoff",
  "urgent-gynecology",
  "ed-referral"
];

describe("CARE_ROUTER_PATHWAYS · canonical descriptor list", () => {
  it("contains exactly the six pathways the Care Router can emit", () => {
    const ids = CARE_ROUTER_PATHWAYS.map((p) => p.pathway).sort();
    expect(ids).toEqual([...EXPECTED_PATHWAYS].sort());
  });

  it("has a unique acuityOrder for every pathway", () => {
    const orders = CARE_ROUTER_PATHWAYS.map((p) => p.acuityOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("orders acuity from routine to emergency monotonically", () => {
    // The matrix card on /demo/routing relies on acuityOrder for
    // its visual sort. A regression here would scramble the rows.
    const acuityRank: Record<string, number> = {
      routine: 1,
      elevated: 2,
      urgent: 3,
      emergency: 4
    };
    const sorted = [...CARE_ROUTER_PATHWAYS].sort(
      (a, b) => a.acuityOrder - b.acuityOrder
    );
    let prev = -Infinity;
    for (const p of sorted) {
      const rank = acuityRank[p.acuity];
      expect(rank).toBeGreaterThanOrEqual(prev);
      prev = rank;
    }
  });

  it("has a non-empty trigger and target for every pathway", () => {
    for (const p of CARE_ROUTER_PATHWAYS) {
      expect(p.trigger.length).toBeGreaterThan(20);
      expect(p.target.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("uses a tone string from the documented enum", () => {
    const validTones = new Set([
      "calm",
      "moderate",
      "elevated",
      "urgent",
      "critical"
    ]);
    for (const p of CARE_ROUTER_PATHWAYS) {
      expect(validTones.has(p.tone)).toBe(true);
    }
  });
});

describe("PATHWAY_LABELS / PATHWAY_TARGETS · derived lookup tables", () => {
  it("PATHWAY_LABELS covers every pathway", () => {
    for (const p of EXPECTED_PATHWAYS) {
      expect(PATHWAY_LABELS[p]).toBeTruthy();
    }
  });

  it("PATHWAY_TARGETS covers every pathway", () => {
    for (const p of EXPECTED_PATHWAYS) {
      expect(PATHWAY_TARGETS[p]).toBeTruthy();
    }
  });

  it("label lookup agrees with the descriptor list", () => {
    for (const desc of CARE_ROUTER_PATHWAYS) {
      expect(PATHWAY_LABELS[desc.pathway]).toBe(desc.label);
    }
  });

  it("target lookup agrees with the descriptor list", () => {
    for (const desc of CARE_ROUTER_PATHWAYS) {
      expect(PATHWAY_TARGETS[desc.pathway]).toBe(desc.target);
    }
  });
});

describe("describePathway", () => {
  it("returns the descriptor for every known pathway id", () => {
    for (const p of EXPECTED_PATHWAYS) {
      const out = describePathway(p);
      expect(out).not.toBeNull();
      expect(out!.pathway).toBe(p);
    }
  });

  it("returns null for unknown pathway ids", () => {
    // Examples of labels that previously appeared on /demo/routing
    // but were NOT actually emitted by the Care Router. The single
    // source of truth should reject them.
    expect(describePathway("primary-care-optimization")).toBeNull();
    expect(describePathway("")).toBeNull();
    expect(describePathway("URGENT-GYNECOLOGY")).toBeNull();
  });
});
