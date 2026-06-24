import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";

import { MCPHost, type MCPTransportLike } from "./host";
import { providerLookupViaMcpHost } from "./provider-lookup";

/**
 * In-process integration test: a real McpServer answers tools/call on
 * one end of an InMemoryTransport pair while the MCPHost's client
 * speaks JSON-RPC over the other end. This pins the wire contract
 * between our host and any MCP-compliant server (loopback or
 * external), without needing the Next.js dev server up.
 *
 * If `providerLookupViaMcpHost` ever stops parsing the canonical tool
 * response shape, this test fails with a clear "no parseable
 * provider payload" signal rather than a routing regression in
 * production.
 */

function makeUpstreamServer(payload: Record<string, unknown>) {
  const server = new McpServer({ name: "test-upstream", version: "0.0.1" });
  server.registerTool(
    "find_menopause_providers",
    {
      title: "Find menopause providers (test)",
      description: "Test double for the canonical tool.",
      inputSchema: {
        zip: z.string().optional(),
        menopauseOnly: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
        insurance: z.string().optional()
      }
    },
    async () => ({
      content: [
        { type: "text", text: "Test directory summary." },
        { type: "text", text: JSON.stringify(payload) }
      ]
    })
  );
  return server;
}

describe("MCPHost ↔ providerLookupViaMcpHost (in-memory wire)", () => {
  it("round-trips a real tools/call through the host adapter", async () => {
    const payload = {
      total: 3,
      returned: 3,
      matchType: "certified-local",
      sort: "distance",
      providers: [
        {
          npi: "1111111111",
          name: "Dr. Alpha",
          specialty: "OBGYN",
          menopauseCertified: true,
          distanceMiles: 1.2
        },
        {
          npi: "2222222222",
          name: "Dr. Beta",
          specialty: "Family Medicine",
          menopauseCertified: true,
          distanceMiles: 2.8
        },
        {
          npi: "3333333333",
          name: "Dr. Gamma",
          specialty: "Internal Medicine",
          menopauseCertified: true,
          distanceMiles: 5.1
        }
      ]
    };
    const upstream = makeUpstreamServer(payload);

    // Pair the in-memory transports. The host's clientFor() will pull
    // its end (clientSide) via the transportFactory; the upstream
    // server connects to the other end (serverSide).
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await upstream.connect(serverSide);

    const host = new MCPHost({
      remotes: [
        { id: "loopback", url: "in-memory://test" }
      ],
      clientFactory: () =>
        new Client(
          { name: "test-host", version: "0.0.1" },
          { capabilities: {} }
        ),
      transportFactory: () => clientSide as unknown as MCPTransportLike
    });

    try {
      const lookup = providerLookupViaMcpHost({ host });
      const result = await lookup({
        zip: "92614",
        menopauseOnly: true,
        limit: 10
      });
      expect(result.source).toBe("mock"); // loopback remote
      expect(result.result.total).toBe(3);
      expect(result.result.providers).toHaveLength(3);
      expect(result.result.providers[0]?.npi).toBe("1111111111");
      expect(result.result.providers[0]?.distanceMiles).toBe(1.2);
    } finally {
      await host.close();
      await upstream.close();
    }
  });
});
