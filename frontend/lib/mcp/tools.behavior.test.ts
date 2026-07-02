import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  createPauseMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  type ToolDeps
} from "./tools";

/**
 * Behavioral tests for the four Pause MCP tool handlers.
 *
 * tools.parity / registry-parity / public-descriptor-parity already pin the
 * tool NAMES and versions across surfaces, but nothing exercised what the
 * handlers actually DO: which Experience-API URL each builds, the request
 * headers (User-Agent, Accept, optional Bearer), and the human-readable
 * summary string each returns — the text an LLM reads first when deciding how
 * to phrase a result. We drive a real McpServer over an in-memory transport
 * (same rig as host.integration.test) with an injected fetch so we assert the
 * genuine tools/call round-trip, not a re-implementation.
 */

type ToolText = { type: string; text: string };
type ToolResult = { content: ToolText[]; isError?: boolean };

type Recorded = { url: string; headers: Record<string, string> };

function fakeFetch(
  body: unknown,
  opts: { status?: number; statusText?: string } = {}
): { impl: ToolDeps["fetchImpl"]; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) } });
    return new Response(JSON.stringify(body), {
      status: opts.status ?? 200,
      statusText: opts.statusText ?? "OK",
      headers: { "Content-Type": "application/json" }
    });
  }) as unknown as ToolDeps["fetchImpl"];
  return { impl, calls };
}

async function connect(deps: ToolDeps) {
  const server = createPauseMcpServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(clientSide);
  const close = async () => {
    await client.close();
    await server.close();
  };
  return { client, close };
}

async function callTool(
  deps: ToolDeps,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ result: ToolResult; calls: Recorded[] }> {
  const { client, close } = await connect(deps);
  try {
    const result = (await client.callTool({
      name,
      arguments: args
    })) as unknown as ToolResult;
    return { result, calls: (deps as { __calls?: Recorded[] }).__calls ?? [] };
  } finally {
    await close();
  }
}

/** Build deps with a recording fetch; the calls array is stashed on deps. */
function depsWith(
  body: unknown,
  extra: Partial<ToolDeps> = {},
  fetchOpts?: { status?: number; statusText?: string }
): ToolDeps & { __calls: Recorded[] } {
  const { impl, calls } = fakeFetch(body, fetchOpts);
  return {
    baseUrl: "https://pause-health.ai",
    fetchImpl: impl,
    __calls: calls,
    ...extra
  };
}

describe("Pause MCP tools — registration surface", () => {
  it("exposes exactly the four Pause tools via tools/list", async () => {
    const { client, close } = await connect(depsWith({}));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "experience_api_health",
        "find_menopause_providers",
        "get_patient_intake",
        "get_patient_timeline"
      ]);
    } finally {
      await close();
    }
  });
});

describe("get_patient_timeline", () => {
  it("builds the timeline URL, encodes the id, and narrates the entry count", async () => {
    const deps = depsWith({ bundle: { entry: [1, 2, 3] } });
    const { result } = await callTool(deps, "get_patient_timeline", {
      patientId: "pause-demo-patient-001"
    });
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/patient/pause-demo-patient-001/timeline"
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("FHIR Bundle with 3 entries");
    // Second block is the raw JSON payload.
    expect(JSON.parse(result.content[1].text).bundle.entry).toHaveLength(3);
  });

  it("URL-encodes an id containing a slash", async () => {
    const deps = depsWith({ bundle: { entry: [] } });
    await callTool(deps, "get_patient_timeline", { patientId: "a/b" });
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/patient/a%2Fb/timeline"
    );
  });
});

describe("get_patient_intake", () => {
  it("narrates acuity + chief complaint when present", async () => {
    const deps = depsWith({
      intake: {
        chiefComplaint: "Hot flashes",
        triageRecommendation: { acuity: "routine" }
      }
    });
    const { result } = await callTool(deps, "get_patient_intake", {
      patientId: "p1"
    });
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/patient/p1/intake"
    );
    expect(result.content[0].text).toContain("routine acuity: Hot flashes");
  });

  it("falls back to a bare summary when the record has no chief complaint", async () => {
    const deps = depsWith({ intake: {} });
    const { result } = await callTool(deps, "get_patient_intake", {
      patientId: "p1"
    });
    expect(result.content[0].text).toBe("Pause intake for p1.");
  });
});

describe("find_menopause_providers", () => {
  it("assembles the query string (zip, menopause, limit, insurance) and narrates distance sort", async () => {
    const deps = depsWith({
      total: 10,
      returned: 2,
      matchType: "relevant-local",
      sort: "distance",
      providers: [{ npi: "1234567890", name: "Dr. A" }]
    });
    const { result } = await callTool(deps, "find_menopause_providers", {
      zip: "92614",
      menopauseOnly: true,
      limit: 5,
      insurance: "aetna"
    });
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/providers?zip=92614&menopause=true&limit=5&insurance=aetna"
    );
    const summary = result.content[0].text;
    expect(summary).toContain("returned 2 of 10 providers");
    expect(summary).toContain("sort=distance (distanceMiles ascending)");
    expect(summary).toContain("matchType=relevant-local");
    // Profile hint points at the top provider's real page, carrying the zip.
    expect(summary).toContain(
      "https://pause-health.ai/provider/1234567890?from=92614"
    );
  });

  it("omits zip from the query and narrates graphScore sort + browse hint when no zip is given", async () => {
    const deps = depsWith({
      total: 4,
      returned: 4,
      matchType: "certified-national",
      sort: "score",
      providers: []
    });
    const { result } = await callTool(deps, "find_menopause_providers", {
      menopauseOnly: true,
      limit: 10
    });
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/providers?menopause=true&limit=10"
    );
    const summary = result.content[0].text;
    expect(summary).toContain("sort=score (graphScore descending)");
    // No providers -> browse-directory hint rather than a per-NPI profile URL.
    expect(summary).toContain("Browse the directory: https://pause-health.ai/provider");
  });
});

describe("experience_api_health", () => {
  it("hits /api/mulesoft/health and reports reachability + entry count", async () => {
    const deps = depsWith({ bundle: { entry: [1, 2] } });
    const { result } = await callTool(deps, "experience_api_health", {});
    expect(deps.__calls[0].url).toBe(
      "https://pause-health.ai/api/mulesoft/health"
    );
    expect(result.content[0].text).toContain(
      "reachable at https://pause-health.ai"
    );
    expect(result.content[0].text).toContain("2 entries");
  });
});

describe("request shaping (headers + baseUrl)", () => {
  it("sends the default User-Agent and Accept, and no Authorization without an apiKey", async () => {
    const deps = depsWith({ bundle: { entry: [] } });
    await callTool(deps, "experience_api_health", {});
    const h = deps.__calls[0].headers;
    expect(h["User-Agent"]).toBe(`${SERVER_NAME}/${SERVER_VERSION}`);
    expect(h["Accept"]).toBe("application/json");
    expect(h["Authorization"]).toBeUndefined();
  });

  it("attaches a Bearer Authorization header when an apiKey is configured", async () => {
    const deps = depsWith({ bundle: { entry: [] } }, { apiKey: "sekret" });
    await callTool(deps, "experience_api_health", {});
    expect(deps.__calls[0].headers["Authorization"]).toBe("Bearer sekret");
  });

  it("honors a custom userAgent and trims trailing slashes on baseUrl", async () => {
    const deps = depsWith(
      { bundle: { entry: [] } },
      { baseUrl: "https://x.example///", userAgent: "care-router/1.0" }
    );
    await callTool(deps, "experience_api_health", {});
    expect(deps.__calls[0].url).toBe("https://x.example/api/mulesoft/health");
    expect(deps.__calls[0].headers["User-Agent"]).toBe("care-router/1.0");
  });
});

describe("error path", () => {
  it("returns an isError result carrying the upstream status when the Experience API is not ok", async () => {
    const deps = depsWith({ error: "boom" }, {}, { status: 502, statusText: "Bad Gateway" });
    const { result } = await callTool(deps, "get_patient_timeline", {
      patientId: "p1"
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("502");
  });
});
