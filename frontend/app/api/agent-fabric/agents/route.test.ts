import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { listAgents } from "../../../../lib/agent-fabric";

/**
 * Tests for GET /api/agent-fabric/agents — the mocked Agent Fabric registry
 * listing. Mock-only. Pins that the payload IS the registry (so it can't
 * drift from listAgents), meta._agentCount is derived rather than hardcoded,
 * and every agent carries the discovery fields the console renders.
 */

describe("GET /api/agent-fabric/agents", () => {
  it("returns 200 with the full registry", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const agents = listAgents();
    expect(json.agents).toHaveLength(agents.length);
    expect(json.agents.map((a: { id: string }) => a.id)).toEqual(
      agents.map((a) => a.id)
    );
  });

  it("derives meta._agentCount from the registry", async () => {
    const json = await (await GET()).json();
    expect(json.meta._agentCount).toBe(listAgents().length);
  });

  it("exposes protocol, version, and policies on each agent", async () => {
    const json = await (await GET()).json();
    for (const agent of json.agents) {
      expect(typeof agent.protocol).toBe("string");
      expect(typeof agent.version).toBe("string");
      expect(Array.isArray(agent.policies)).toBe(true);
    }
  });

  it("emits the documented cacheable Cache-Control header", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=60/);
  });
});
