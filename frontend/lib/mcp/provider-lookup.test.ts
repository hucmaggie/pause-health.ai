import { describe, it, expect, vi } from "vitest";

import type { MCPHost, MCPToolResult } from "./host";
import { providerLookupViaMcpHost } from "./provider-lookup";

// We stub MCPHost rather than booting a real one. The adapter only
// cares about three things:
//   - listRemotes().length
//   - callTool() return shape
//   - the structured JSON in the second content block
// Anything else is the host's responsibility.

function makeHostStub(opts: {
  remoteCount: number;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<MCPToolResult | undefined>;
}): MCPHost {
  return {
    listRemotes: () =>
      Array.from({ length: opts.remoteCount }, (_, i) => ({
        id: `r${i}`,
        url: `https://r${i}.example/mcp`
      })),
    callTool: opts.callTool,
    close: async () => {}
  } as unknown as MCPHost;
}

const TOY_PROVIDERS_PAYLOAD = {
  total: 2,
  returned: 2,
  matchType: "certified-local",
  sort: "distance",
  providers: [
    {
      npi: "1234567890",
      name: "Dr. Test One",
      specialty: "Obstetrics & Gynecology",
      menopauseCertified: true,
      distanceMiles: 4.2,
      insuranceAccepted: ["aetna"]
    },
    {
      npi: "1234567891",
      name: "Dr. Test Two",
      specialty: "Family Medicine",
      menopauseCertified: true,
      distanceMiles: 6.1,
      insuranceAccepted: ["bcbs"]
    }
  ]
};

function toolContent(payload: unknown): MCPToolResult {
  return {
    ok: true,
    remoteId: "loopback",
    isError: false,
    content: [
      { type: "text", text: "Pause provider directory: returned 2 of 2." },
      { type: "text", text: JSON.stringify(payload) }
    ]
  };
}

describe("providerLookupViaMcpHost", () => {
  it("returns the parsed payload with source='mock' for loopback", async () => {
    const fallback = vi.fn();
    const host = makeHostStub({
      remoteCount: 1,
      callTool: async (params) => {
        expect(params.name).toBe("find_menopause_providers");
        return toolContent(TOY_PROVIDERS_PAYLOAD);
      }
    });
    const lookup = providerLookupViaMcpHost({
      host,
      fallback: fallback as unknown as Parameters<typeof providerLookupViaMcpHost>[0]["fallback"]
    });
    const res = await lookup({ menopauseOnly: true, limit: 5 });
    expect(res.source).toBe("mock");
    expect(res.result.total).toBe(2);
    expect(res.result.providers).toHaveLength(2);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("returns source='live' when the serving remote is non-loopback", async () => {
    const host = makeHostStub({
      remoteCount: 1,
      callTool: async () => ({
        ok: true,
        remoteId: "partner-tools",
        isError: false,
        content: [
          { type: "text", text: "summary" },
          { type: "text", text: JSON.stringify(TOY_PROVIDERS_PAYLOAD) }
        ]
      })
    });
    const res = await providerLookupViaMcpHost({ host })({
      menopauseOnly: true,
      limit: 5
    });
    expect(res.source).toBe("live");
  });

  it("falls back when the host has no remotes", async () => {
    const fallback = vi.fn(async () => ({
      source: "mock" as const,
      result: { total: 0, providers: [] }
    }));
    const host = makeHostStub({
      remoteCount: 0,
      callTool: async () => undefined
    });
    const events: Array<{ remoteId: string | null; ok: boolean; error?: string }> = [];
    const lookup = providerLookupViaMcpHost({
      host,
      fallback,
      onAttempt: (e) => events.push(e)
    });
    const res = await lookup({});
    expect(fallback).toHaveBeenCalledOnce();
    expect(res.result.providers).toEqual([]);
    expect(events).toEqual([{ remoteId: null, ok: false, error: "no remotes" }]);
  });

  it("falls back when the host returns an error", async () => {
    const fallback = vi.fn(async () => ({
      source: "mock" as const,
      result: { total: 0, providers: [] }
    }));
    const host = makeHostStub({
      remoteCount: 1,
      callTool: async () => ({
        ok: false,
        remoteId: "loopback",
        error: "boom"
      })
    });
    const events: Array<{ remoteId: string | null; ok: boolean; error?: string }> = [];
    const lookup = providerLookupViaMcpHost({
      host,
      fallback,
      onAttempt: (e) => events.push(e)
    });
    await lookup({});
    expect(fallback).toHaveBeenCalledOnce();
    expect(events).toEqual([{ remoteId: "loopback", ok: false, error: "boom" }]);
  });

  it("falls back when the tool returns no parseable JSON payload", async () => {
    const fallback = vi.fn(async () => ({
      source: "mock" as const,
      result: { total: 99, providers: [] }
    }));
    const host = makeHostStub({
      remoteCount: 1,
      callTool: async () => ({
        ok: true,
        remoteId: "loopback",
        isError: false,
        content: [{ type: "text", text: "just a summary line" }]
      })
    });
    const events: Array<{ remoteId: string | null; ok: boolean; error?: string }> = [];
    const res = await providerLookupViaMcpHost({
      host,
      fallback,
      onAttempt: (e) => events.push(e)
    })({});
    expect(fallback).toHaveBeenCalledOnce();
    expect(res.result.total).toBe(99);
    expect(events[0]?.error).toContain("no parseable provider payload");
  });

  it("forwards optional query params as tool arguments", async () => {
    let observed: Record<string, unknown> = {};
    const host = makeHostStub({
      remoteCount: 1,
      callTool: async (params) => {
        observed = params.arguments;
        return toolContent(TOY_PROVIDERS_PAYLOAD);
      }
    });
    await providerLookupViaMcpHost({ host })({
      zip: "92614",
      menopauseOnly: false,
      limit: 25,
      insurance: "aetna"
    });
    expect(observed).toEqual({
      zip: "92614",
      menopauseOnly: false,
      limit: 25,
      insurance: "aetna"
    });
  });
});
