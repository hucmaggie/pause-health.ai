/**
 * Tests for the /api/mcp/whoami diagnostic endpoint.
 *
 * Doesn't exercise the MCP transport — just the gate-on/gate-off
 * branching and the identity-resolved JSON shape. The underlying
 * validateMcpApiBearer is already pinned in salesforce-headless360.test.ts;
 * here we verify that whoami's wiring lines up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { GET } from "./route";
import { _resetIntrospectCacheForTesting } from "../../../../lib/salesforce-headless360";

const KEYS = [
  "SF_HEADLESS360_CLIENT_ID",
  "SF_HEADLESS360_AUTH_BASE_URL",
  "SF_HEADLESS360_REDIRECT_URI",
  "SF_HEADLESS360_SESSION_SECRET",
  "SF_HEADLESS360_REQUIRE_MCP_AUTH"
] as const;

function clearEnv(): void {
  for (const k of KEYS) delete process.env[k];
}

function fullyProvisioned(): void {
  process.env.SF_HEADLESS360_CLIENT_ID = "3MVG9_test_client_id";
  process.env.SF_HEADLESS360_AUTH_BASE_URL = "https://test.my.salesforce.com";
  process.env.SF_HEADLESS360_REDIRECT_URI =
    "https://pause-health.ai/api/salesforce/headless-360/callback";
  process.env.SF_HEADLESS360_SESSION_SECRET = randomBytes(32).toString("hex");
}

describe("/api/mcp/whoami", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    clearEnv();
    _resetIntrospectCacheForTesting();
  });
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
    vi.unstubAllGlobals();
  });

  it("returns gate:off when SF_HEADLESS360_REQUIRE_MCP_AUTH is unset", async () => {
    const res = await GET(new Request("https://pause-health.ai/api/mcp/whoami"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gate: "off" });
  });

  it("returns 401 when gate is on but no bearer is presented", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    const res = await GET(new Request("https://pause-health.ai/api/mcp/whoami"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('realm="mcp_api"');
    expect(res.headers.get("WWW-Authenticate")).toContain('error="missing-bearer"');
  });

  it("returns 503 when gate is on but Headless 360 env is not provisioned", async () => {
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    // Note: NOT calling fullyProvisioned() — env is intentionally incomplete.
    const res = await GET(new Request("https://pause-health.ai/api/mcp/whoami"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("mcp-auth-misconfigured");
  });

  it("returns gate:on + via + username when a valid bearer is presented", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    // Stub global fetch so the introspect call inside validateMcpApiBearer
    // resolves without hitting the network.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ active: true, scope: "mcp_api refresh_token", username: "u@example.com" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const res = await GET(
      new Request("https://pause-health.ai/api/mcp/whoami", {
        headers: { authorization: "Bearer real-token" }
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gate: "on",
      via: "introspect",
      username: "u@example.com"
    });
  });

  it("returns 403 when the bearer is missing mcp_api scope", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ active: true, scope: "api refresh_token" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const res = await GET(
      new Request("https://pause-health.ai/api/mcp/whoami", {
        headers: { authorization: "Bearer wrong-scope-token" }
      })
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="scope-mismatch"');
  });

  it("returns username:null when the bearer is valid but Salesforce omits username", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ active: true, scope: "mcp_api" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const res = await GET(
      new Request("https://pause-health.ai/api/mcp/whoami", {
        headers: { authorization: "Bearer no-username-token" }
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      gate: "on",
      via: "introspect",
      username: null
    });
  });
});
