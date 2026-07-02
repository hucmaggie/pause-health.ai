import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, DELETE } from "./route";

/**
 * Route tests for the /api/mcp Streamable HTTP endpoint — the HTTP-fronted
 * MCP server the Agentforce 3.0 Registry connects to.
 *
 * The tool HANDLERS are unit-tested in lib/mcp/tools.behavior.test (via an
 * in-memory transport), and the auth GATE is unit-tested in
 * lib/mcp/http-auth.test. What only this route owns — and had no direct
 * coverage — is the wiring: a real Streamable-HTTP round-trip through the
 * SDK transport, the request-origin base-URL derivation that decides which
 * Experience-API plane the tools front (so a preview deploy fronts its own
 * mocks, not prod), and that all three HTTP verbs run through the same auth
 * guard. We drive it with hand-built JSON-RPC frames and parse the SSE the
 * transport emits.
 */

const AUTH_KEYS = [
  "SF_HEADLESS360_CLIENT_ID",
  "SF_HEADLESS360_AUTH_BASE_URL",
  "SF_HEADLESS360_REDIRECT_URI",
  "SF_HEADLESS360_SESSION_SECRET",
  "SF_HEADLESS360_REQUIRE_MCP_AUTH"
] as const;

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const k of AUTH_KEYS) delete process.env[k];
  delete process.env.PAUSE_MCP_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.keys(process.env).forEach((k) => {
    if (!(k in ORIGINAL)) delete process.env[k];
  });
  Object.assign(process.env, ORIGINAL);
});

function mcpPost(body: unknown, url = "http://localhost:3000/api/mcp") {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26"
    },
    body: JSON.stringify(body)
  });
}

type JsonRpcFrame = {
  result?: Record<string, unknown> & {
    serverInfo?: { name?: string; version?: string };
    capabilities?: { tools?: unknown };
    tools?: Array<{ name: string }>;
    content?: Array<{ text: string }>;
  };
  error?: { code?: number; message?: string };
};

/** Pull the JSON-RPC payload out of the transport's single SSE `data:` frame. */
function parseSse(text: string): JsonRpcFrame {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`no SSE data frame in response: ${text}`);
  return JSON.parse(line.slice("data:".length).trim()) as JsonRpcFrame;
}

/** Stub global fetch to capture Experience-API URLs the tools hit. */
function captureFetch(body: unknown) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: unknown) => {
      seen.push(String(u));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    })
  );
  return seen;
}

describe("POST /api/mcp · initialize handshake", () => {
  it("returns the Pause server identity + tools capability over SSE", async () => {
    const res = await POST(
      mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" }
        }
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const rpc = parseSse(await res.text());
    expect(rpc.result?.serverInfo?.name).toBe("pause-health-mcp");
    expect(rpc.result?.serverInfo?.version).toBe("0.3.0");
    expect(rpc.result?.capabilities?.tools).toBeDefined();
  });
});

describe("POST /api/mcp · tools/list", () => {
  it("lists exactly the four Pause tools", async () => {
    const res = await POST(
      mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    );
    expect(res.status).toBe(200);
    const rpc = parseSse(await res.text());
    const names = (rpc.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      "experience_api_health",
      "find_menopause_providers",
      "get_patient_intake",
      "get_patient_timeline"
    ]);
  });
});

describe("POST /api/mcp · tools/call base-URL derivation", () => {
  it("fronts the Experience API on the request's own origin by default", async () => {
    const seen = captureFetch({ bundle: { entry: [1, 2] } });
    const res = await POST(
      mcpPost({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "experience_api_health", arguments: {} }
      })
    );
    // Draining the SSE body lets the tool's async fetch complete.
    const rpc = parseSse(await res.text());
    expect(seen).toEqual([
      "http://localhost:3000/api/mulesoft/health"
    ]);
    const text0 = rpc.result?.content?.[0]?.text ?? "";
    expect(text0).toContain("reachable at http://localhost:3000");
    expect(text0).toContain("2 entries");
  });

  it("honors PAUSE_MCP_BASE_URL (trailing slash trimmed) over the request origin", async () => {
    process.env.PAUSE_MCP_BASE_URL = "https://anypoint.example.com/";
    const seen = captureFetch({ bundle: { entry: [] } });
    const res = await POST(
      mcpPost({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "experience_api_health", arguments: {} }
      })
    );
    await res.text();
    expect(seen).toEqual([
      "https://anypoint.example.com/api/mulesoft/health"
    ]);
  });
});

describe("POST /api/mcp · transport request validation", () => {
  it("rejects a request that does not accept text/event-stream (406)", async () => {
    const req = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    });
    const res = await POST(req);
    expect(res.status).toBe(406);
  });

  it("rejects a non-JSON content type (415)", async () => {
    const req = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        accept: "application/json, text/event-stream"
      },
      body: "not json"
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });
});

describe("/api/mcp · auth gate wiring (all verbs run through the guard)", () => {
  function enableGateUnprovisioned() {
    process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = "on";
    // Deliberately NOT provisioning the other SF_HEADLESS360_* vars.
  }

  it("POST returns 503 mcp-auth-misconfigured when the gate is on but unprovisioned", async () => {
    enableGateUnprovisioned();
    const res = await POST(
      mcpPost({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("mcp-auth-misconfigured");
  });

  it("GET is gated by the same guard (503), not left as an open SSE stream", async () => {
    enableGateUnprovisioned();
    const res = await GET(new Request("http://localhost:3000/api/mcp"));
    expect(res.status).toBe(503);
  });

  it("DELETE is gated by the same guard (503)", async () => {
    enableGateUnprovisioned();
    const res = await DELETE(
      new Request("http://localhost:3000/api/mcp", { method: "DELETE" })
    );
    expect(res.status).toBe(503);
  });
});
