import { describe, expect, it } from "vitest";
import { GET } from "./route";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import {
  getAgent,
  getPoliciesForAgent,
  listPolicies
} from "../../../../../../lib/agent-fabric";

/**
 * Contract test for the A2A Agent Card served at
 *   GET /api/agents/care-router/.well-known/agent.json
 *
 * The card is a PUBLIC discovery document: any A2A client reads it to learn
 * what the Care Router supports before issuing tasks/send. So the card must
 * not overclaim capabilities the /tasks handler doesn't implement, and its
 * advertised governance must match what the Agent Fabric actually enforces.
 * These assertions pin both.
 */

async function fetchCard(): Promise<A2AAgentCard & { _model: string }> {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as A2AAgentCard & { _model: string };
}

describe("Care Router Agent Card · shape", () => {
  it("serves a well-formed card with the required A2A fields", async () => {
    const card = await fetchCard();
    expect(card.name).toBe("Pause Care Router");
    expect(typeof card.description).toBe("string");
    expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.provider?.organization).toBe("Pause-Health.ai");
    expect(card.defaultInputModes).toEqual(
      expect.arrayContaining(["text", "data"])
    );
    expect(card.defaultOutputModes).toEqual(
      expect.arrayContaining(["text", "data"])
    );
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card.skills[0].id).toBe("route-care-pathway");
  });

  it("advertises the tasks endpoint the A2A client posts to", async () => {
    const card = await fetchCard();
    // sendA2ATask() posts to `${card.url}/tasks`; the card url must be the
    // agent base, not the tasks endpoint itself.
    expect(card.url).toMatch(/\/api\/agents\/care-router$/);
    expect(card.url).not.toMatch(/\/tasks$/);
  });
});

describe("Care Router Agent Card · capabilities honesty", () => {
  it("does not claim streaming or push (the /tasks handler is single-turn only)", async () => {
    const card = await fetchCard();
    // a2a.ts documents tasks/sendSubscribe (SSE) and push notifications as
    // out of scope for the prototype, and the /tasks route implements a
    // single synchronous tasks/send. Flipping either of these to true is a
    // contract lie until the server actually implements it.
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(typeof card.capabilities.stateTransitionHistory).toBe("boolean");
  });
});

describe("Care Router Agent Card · governance parity", () => {
  it("fabricRegisteredAs points at a real registered agent", async () => {
    const card = await fetchCard();
    expect(card.pauseGovernance?.fabricRegisteredAs).toBe("care-router-claude");
    expect(getAgent(card.pauseGovernance!.fabricRegisteredAs)).toBeDefined();
  });

  it("advertised policies exactly match what the fabric enforces for this agent", async () => {
    const card = await fetchCard();
    const enforced = getPoliciesForAgent("care-router-claude").map((p) => p.id);
    expect(card.pauseGovernance?.policies).toEqual(enforced);
  });

  it("every advertised policy id exists in the policy catalog (no phantoms)", async () => {
    const card = await fetchCard();
    const catalog = new Set(listPolicies().map((p) => p.id));
    for (const pid of card.pauseGovernance?.policies ?? []) {
      expect(catalog.has(pid), `card advertises unknown policy "${pid}"`).toBe(
        true
      );
    }
  });
});
