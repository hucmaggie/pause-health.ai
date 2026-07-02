import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { listPolicies } from "../../../../lib/agent-fabric";

/**
 * Route test for GET /api/agent-fabric/policies -- the policy catalog.
 * Pins that the payload mirrors the library and that the advertised meta
 * counts are computed (not hardcoded), so they can't drift from the catalog.
 */
describe("GET /api/agent-fabric/policies", () => {
  it("returns the full policy catalog with a stable shape", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const lib = listPolicies();
    expect(json.policies).toHaveLength(lib.length);
    expect(json.policies.map((p: { id: string }) => p.id)).toEqual(
      lib.map((p) => p.id)
    );
    for (const p of json.policies) {
      expect(p.id).toMatch(/^policy\./);
      expect(["block", "audit", "rate-limit", "redact"]).toContain(
        p.enforcement
      );
      expect(["enforced", "advisory", "draft"]).toContain(p.status);
      expect(Array.isArray(p.appliesTo)).toBe(true);
    }
  });

  it("meta counts are derived from the catalog, not hardcoded", async () => {
    const res = await GET();
    const json = await res.json();
    const lib = listPolicies();
    expect(json.meta._policyCount).toBe(lib.length);
    expect(json.meta._enforcedCount).toBe(
      lib.filter((p) => p.status === "enforced").length
    );
  });

  it("is cacheable (public s-maxage)", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toMatch(/public/);
  });
});
