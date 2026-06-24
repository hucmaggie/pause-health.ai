import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  MCPHost,
  resolveRemotesFromEnv,
  type MCPRemoteConfig
} from "./host";

// We avoid spinning the real SDK transports for these unit tests.
// MCPHost accepts both a Client factory and a transport factory; we
// stub the Client and supply a no-op transport. The Client stub
// records calls so each assertion is explicit about which remote
// served which tool invocation.

interface ClientStub {
  connect: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeClientStub(handler: (params: {
  name: string;
  arguments: Record<string, unknown>;
}) => { isError?: boolean; content: unknown } | Promise<{ isError?: boolean; content: unknown }>): ClientStub {
  return {
    connect: vi.fn(async () => {}),
    callTool: vi.fn(async (params) => handler(params)),
    close: vi.fn(async () => {})
  };
}

function noopTransport() {
  return {
    start: async () => {},
    close: async () => {},
    send: async () => {}
  };
}

describe("resolveRemotesFromEnv", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.PAUSE_MCP_HOST_LOOPBACK;
    delete process.env.PAUSE_MCP_HOST_REMOTES;
  });
  afterEach(() => {
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, original);
  });

  it("returns just the loopback by default", () => {
    const remotes = resolveRemotesFromEnv("https://pause-health.ai");
    expect(remotes).toEqual([
      { id: "loopback", url: "https://pause-health.ai/api/mcp" }
    ]);
  });

  it("disables loopback when PAUSE_MCP_HOST_LOOPBACK=off", () => {
    process.env.PAUSE_MCP_HOST_LOOPBACK = "off";
    const remotes = resolveRemotesFromEnv("https://pause-health.ai");
    expect(remotes).toEqual([]);
  });

  it("appends valid external remotes from JSON env", () => {
    process.env.PAUSE_MCP_HOST_REMOTES = JSON.stringify([
      { id: "salesforce", url: "https://partner.example/mcp" },
      {
        id: "partner-tools",
        url: "https://partner.example/tools",
        headers: { Authorization: "Bearer abc" }
      }
    ]);
    const remotes = resolveRemotesFromEnv("https://pause-health.ai");
    expect(remotes).toHaveLength(3);
    expect(remotes[1]).toEqual({
      id: "salesforce",
      url: "https://partner.example/mcp"
    });
    expect(remotes[2]).toEqual({
      id: "partner-tools",
      url: "https://partner.example/tools",
      headers: { Authorization: "Bearer abc" }
    });
  });

  it("strips trailing slashes from the loopback origin", () => {
    const remotes = resolveRemotesFromEnv("https://pause-health.ai///");
    expect(remotes[0]?.url).toBe("https://pause-health.ai/api/mcp");
  });

  it("ignores malformed PAUSE_MCP_HOST_REMOTES JSON without throwing", () => {
    process.env.PAUSE_MCP_HOST_REMOTES = "not-json";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remotes = resolveRemotesFromEnv("https://pause-health.ai");
    expect(remotes).toEqual([
      { id: "loopback", url: "https://pause-health.ai/api/mcp" }
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips entries missing id or url with a warning", () => {
    process.env.PAUSE_MCP_HOST_REMOTES = JSON.stringify([
      { id: "ok", url: "https://ok.example/mcp" },
      { id: "bad-missing-url" },
      "string-entry"
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remotes = resolveRemotesFromEnv("https://pause-health.ai");
    expect(remotes.map((r) => r.id)).toEqual(["loopback", "ok"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("MCPHost.callTool", () => {
  const remoteA: MCPRemoteConfig = { id: "remote-a", url: "https://a.example/mcp" };
  const remoteB: MCPRemoteConfig = { id: "remote-b", url: "https://b.example/mcp" };

  it("returns the first ok result without trying later remotes", async () => {
    const a = makeClientStub(() => ({ isError: false, content: [{ type: "text", text: "from-a" }] }));
    const b = makeClientStub(() => ({ isError: false, content: [{ type: "text", text: "from-b" }] }));
    let i = 0;
    const host = new MCPHost({
      remotes: [remoteA, remoteB],
      clientFactory: () => (i++ === 0 ? (a as unknown as never) : (b as unknown as never)),
      transportFactory: () => noopTransport()
    });
    const res = await host.callTool({ name: "any", arguments: {} });
    expect(res?.ok).toBe(true);
    expect(res?.remoteId).toBe("remote-a");
    expect(a.callTool).toHaveBeenCalledTimes(1);
    expect(b.callTool).not.toHaveBeenCalled();
  });

  it("falls through on isError=true and tries the next remote", async () => {
    const a = makeClientStub(() => ({ isError: true, content: [] }));
    const b = makeClientStub(() => ({ isError: false, content: [{ type: "text", text: "from-b" }] }));
    let i = 0;
    const host = new MCPHost({
      remotes: [remoteA, remoteB],
      clientFactory: () => (i++ === 0 ? (a as unknown as never) : (b as unknown as never)),
      transportFactory: () => noopTransport()
    });
    const res = await host.callTool({ name: "any", arguments: {} });
    expect(res?.ok).toBe(true);
    expect(res?.remoteId).toBe("remote-b");
    expect(a.callTool).toHaveBeenCalledTimes(1);
    expect(b.callTool).toHaveBeenCalledTimes(1);
  });

  it("falls through on thrown errors and returns the last failure when all fail", async () => {
    const a = makeClientStub(() => {
      throw new Error("a is down");
    });
    const b = makeClientStub(() => {
      throw new Error("b is down");
    });
    let i = 0;
    const host = new MCPHost({
      remotes: [remoteA, remoteB],
      clientFactory: () => (i++ === 0 ? (a as unknown as never) : (b as unknown as never)),
      transportFactory: () => noopTransport()
    });
    const res = await host.callTool({ name: "any", arguments: {} });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toBe("b is down");
  });

  it("returns undefined when no remotes are configured", async () => {
    const host = new MCPHost({
      remotes: [],
      clientFactory: () => makeClientStub(() => ({ isError: false, content: [] })) as unknown as never,
      transportFactory: () => noopTransport()
    });
    expect(await host.callTool({ name: "any", arguments: {} })).toBeUndefined();
  });
});
