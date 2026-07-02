import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Route test for GET /api/agent-fabric/sf-sink/config -- the public-safe
 * provisioning probe for the Salesforce Platform Event sink. The critical
 * invariant is leak-safety: this endpoint is curl-able by anyone, so it must
 * never echo the OAuth client id/secret or the base URL. It must also always
 * expose the emit counters so an operator can confirm span flow.
 */
describe("GET /api/agent-fabric/sf-sink/config", () => {
  it("reports a valid status and never leaks secrets", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(["designed", "prototype", "shipped"]).toContain(json.status);
    expect(json.meta._source).toBe(json.status);
    expect(json.meta._doc).toMatch(/SF_PLATFORM_EVENT_SINK_RUNBOOK/);

    // Leak guard -- no credential/host material in the public payload,
    // at the top level or anywhere nested.
    const blob = JSON.stringify(json).toLowerCase();
    expect(blob).not.toContain("clientsecret");
    expect(blob).not.toContain("client_secret");
    expect(blob).not.toContain("clientid");
    expect(json).not.toHaveProperty("baseUrl");
    expect(json).not.toHaveProperty("clientId");
    expect(json).not.toHaveProperty("clientSecret");
  });

  it("always exposes the emit counters with a numeric shape", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.counters).toBeDefined();
    expect(typeof json.counters.attempted).toBe("number");
    expect(typeof json.counters.succeeded).toBe("number");
    expect(typeof json.counters.failed).toBe("number");
    expect(
      json.counters.lastError === null ||
        typeof json.counters.lastError === "string"
    ).toBe(true);
  });

  it("omits eventApiName/apiVersion while unconfigured (status designed)", async () => {
    const res = await GET();
    const json = await res.json();
    if (json.status === "designed") {
      expect(json.eventApiName).toBeUndefined();
      expect(json.apiVersion).toBeUndefined();
    }
  });
});
