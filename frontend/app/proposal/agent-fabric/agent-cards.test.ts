import { describe, expect, it } from "vitest";
import {
  agentCards,
  AGENT_CARD_COUNT,
  AGENT_CARD_COUNT_WORD,
  integerToEnglishWord
} from "./agent-cards";
import { listAgents } from "../../../lib/agent-fabric";
import {
  GOVERNANCE_TIERS,
  PLANES_IN_ORDER,
  planeForTier
} from "../../../lib/governance-tiers";

/**
 * Brief <-> registry DRIFT GUARD.
 *
 * The investor brief at ./page.tsx renders a hand-curated card per agent from
 * ./agent-cards.ts. The live registry in lib/agent-fabric.ts (surfaced here via
 * listAgents()) is the SOURCE OF TRUTH. These assertions lock the two together
 * so the brief can never silently drift from what is actually registered:
 * exactly one card per registered agent, and the per-tier (and therefore
 * per-plane) distribution must match 1:1.
 *
 * ON FAILURE: the REGISTRY wins. Do NOT edit the registry or relax this test —
 * correct the offending card's `tier` in agent-cards.ts to match that agent's
 * `governanceTier` in the registry.
 */

function histogramByTier(tiers: string[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const tier of tiers) {
    hist[tier] = (hist[tier] ?? 0) + 1;
  }
  return hist;
}

describe("agent-fabric brief <-> registry drift guard", () => {
  const registry = listAgents();

  it("has exactly one card per registered agent (both 58)", () => {
    expect(agentCards.length).toBe(registry.length);
    expect(agentCards.length).toBe(58);
    expect(registry.length).toBe(58);
  });

  it("matches the registry's per-tier histogram exactly", () => {
    const briefHist = histogramByTier(agentCards.map((card) => card.tier));
    const registryHist = histogramByTier(
      registry.map((agent) => agent.governanceTier)
    );
    // A mismatch means a card is filed under the wrong tier, or a card is
    // missing/extra in some tier. Because tier -> plane is a fixed mapping,
    // matching the tier histogram transitively guarantees the per-plane
    // counts rendered in the brief match the registry too.
    expect(briefHist).toEqual(registryHist);
  });

  it("only uses real governance tiers that resolve to a plane", () => {
    for (const card of agentCards) {
      expect(GOVERNANCE_TIERS).toHaveProperty(card.tier);
      expect(planeForTier(card.tier)).toBeDefined();
    }
  });

  it("only places cards on planes that exist in PLANES_IN_ORDER", () => {
    const planesWithCards = new Set(
      agentCards.map((card) => planeForTier(card.tier))
    );
    for (const plane of planesWithCards) {
      expect(plane).toBeDefined();
      expect(PLANES_IN_ORDER).toContain(plane);
    }
  });
});

describe("derived agent count", () => {
  it("locks the derived count word at the current registry size", () => {
    expect(AGENT_CARD_COUNT).toBe(agentCards.length);
    expect(AGENT_CARD_COUNT_WORD).toBe("Fifty-eight");
  });

  it("spells counts correctly via the pure helper (hyphenated tens + ones)", () => {
    expect(integerToEnglishWord(0)).toBe("Zero");
    expect(integerToEnglishWord(21)).toBe("Twenty-one");
    expect(integerToEnglishWord(50)).toBe("Fifty");
    expect(integerToEnglishWord(99)).toBe("Ninety-nine");
    expect(integerToEnglishWord(AGENT_CARD_COUNT)).toBe(AGENT_CARD_COUNT_WORD);
  });
});
