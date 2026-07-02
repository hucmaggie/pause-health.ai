/**
 * Tests for the MCP Streamable HTTP bearer gate (lib/mcp/http-auth.ts).
 *
 * guardMcpAuth is imported by BOTH /api/mcp and /api/mcp/whoami, so its
 * discriminated return contract (off | blocked | allowed) is pinned here
 * directly rather than only through one route's HTTP shape. The whoami
 * route test covers the wiring; this covers the gate itself plus
 * attachIdentityHeaders, which had no coverage at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { attachIdentityHeaders, guardMcpAuth } from "./http-auth";
import { _resetIntrospectCacheForTesting } from "../salesforce-headless360";

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

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://pause-health.ai/api/mcp", { headers });
}

function stubIntrospect(body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )
  );
}

describe("guardMcpAuth", () => {
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

  it("returns {kind:'off'} when the gate env is unset", async () => {
    const result = await guardMcpAuth(req());
    expect(result).toEqual({ kind: "off" });
  });

  it("blocks with 503 when the gate is on but Headless 360 is unprovisioned", async () => {
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    const result = await guardMcpAuth(req());
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe("mcp-auth-misconfigured");
  });

  it("blocks with 401 + RFC6750 challenge when the gate is on and no bearer is sent", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    const result = await guardMcpAuth(req());
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.response.status).toBe(401);
    const wwwAuth = result.response.headers.get("WWW-Authenticate") ?? "";
    expect(wwwAuth).toContain('realm="mcp_api"');
    expect(wwwAuth).toContain('error="missing-bearer"');
  });

  it("blocks with 403 when the bearer lacks the mcp_api scope", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    stubIntrospect({ active: true, scope: "api refresh_token" });
    const result = await guardMcpAuth(req({ authorization: "Bearer wrong-scope" }));
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get("WWW-Authenticate")).toContain(
      'error="scope-mismatch"'
    );
  });

  it("allows and surfaces the identity when a valid mcp_api bearer is presented", async () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    stubIntrospect({
      active: true,
      scope: "mcp_api refresh_token",
      username: "u@example.com"
    });
    const result = await guardMcpAuth(req({ authorization: "Bearer good" }));
    expect(result).toEqual({
      kind: "allowed",
      identity: { username: "u@example.com", via: "introspect" }
    });
  });
});

describe("attachIdentityHeaders", () => {
  it("returns the SAME response unchanged when identity is null (gate off)", () => {
    const original = new Response("body", { status: 200 });
    expect(attachIdentityHeaders(original, null)).toBe(original);
  });

  it("stamps X-Pause-MCP-User + X-Pause-MCP-Via and preserves status/body", async () => {
    const original = new Response("payload", {
      status: 207,
      headers: { "Content-Type": "text/event-stream" }
    });
    const decorated = attachIdentityHeaders(original, {
      username: "u@example.com",
      via: "introspect"
    });
    expect(decorated).not.toBe(original);
    expect(decorated.status).toBe(207);
    expect(decorated.headers.get("X-Pause-MCP-User")).toBe("u@example.com");
    expect(decorated.headers.get("X-Pause-MCP-Via")).toBe("introspect");
    // Existing headers are carried over, body streams through untouched.
    expect(decorated.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await decorated.text()).toBe("payload");
  });

  it("omits X-Pause-MCP-User when the identity has no username, but still sets Via", () => {
    const decorated = attachIdentityHeaders(new Response("x"), {
      via: "userinfo-fallback"
    });
    expect(decorated.headers.get("X-Pause-MCP-User")).toBeNull();
    expect(decorated.headers.get("X-Pause-MCP-Via")).toBe("userinfo-fallback");
  });
});
