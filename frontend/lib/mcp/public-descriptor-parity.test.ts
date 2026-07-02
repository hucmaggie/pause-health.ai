import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_NAME, SERVER_VERSION } from "./tools";

/**
 * Cross-surface drift guard: the PUBLIC MCP descriptor
 * (`public/.well-known/mcp.json`) is what external MCP clients — Claude
 * Desktop, Cursor, the Agentforce Registry — read to discover the Pause
 * server. It hand-authors the server name, version, and tool list, so it
 * drifts from the code exactly the way the Agent Fabric registry did.
 *
 * registry-parity.test.ts already pins the *internal* Agent Fabric entry
 * to SERVER_VERSION + the registered tools, but the public descriptor was
 * left out of that guard and silently re-drifted: it advertised version
 * "0.1.0" while the server reports "0.3.0", and its find_menopause_providers
 * blurb claimed results are "ranked by Pause's internal graph score" — the
 * inverse of the real behavior, which ranks distance-first when a ZIP
 * centroid is known (graph score is only the fallback). This test binds the
 * descriptor to the same source of truth so both classes of lie fail CI.
 *
 * Tool names in tools.ts are the source of truth; we extract them from
 * source (same technique as tools.parity / registry-parity).
 */

const DESCRIPTOR_PATH = resolve(
  __dirname,
  "../../public/.well-known/mcp.json"
);
const TOOLS_SRC = resolve(__dirname, "tools.ts");

type Descriptor = {
  name: string;
  version: string;
  tools: Array<{ name: string; description: string }>;
};

function readDescriptor(): Descriptor {
  return JSON.parse(readFileSync(DESCRIPTOR_PATH, "utf-8")) as Descriptor;
}

function registeredToolNames(): string[] {
  const src = readFileSync(TOOLS_SRC, "utf-8");
  const names: string[] = [];
  const re = /registerTool\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

describe("public mcp.json descriptor ⇄ Pause MCP server", () => {
  it("advertises the server name the code actually reports", () => {
    expect(readDescriptor().name).toBe(SERVER_NAME);
  });

  it("advertises the version the MCP server actually reports", () => {
    expect(readDescriptor().version).toBe(SERVER_VERSION);
  });

  it("lists exactly the tools the server registers (bijection, by name)", () => {
    const registered = registeredToolNames();
    // Sanity: source extraction found the expected surface.
    expect(registered.length).toBeGreaterThanOrEqual(4);
    expect(new Set(registered).size).toBe(registered.length); // no dupes

    const advertised = readDescriptor().tools.map((t) => t.name);
    expect(new Set(advertised).size).toBe(advertised.length); // no dupes
    expect(advertised.slice().sort()).toEqual(registered.slice().sort());
  });

  it("describes provider ranking honestly (distance-first, not graph-score-primary)", () => {
    const providerTool = readDescriptor().tools.find(
      (t) => t.name === "find_menopause_providers"
    );
    expect(providerTool).toBeDefined();
    const desc = providerTool!.description.toLowerCase();
    // The real ranking is distance-first (mulesoft-mocks sets sort:"distance"
    // when a ZIP centroid is known); graph score is only the fallback.
    expect(desc).toContain("distance");
    // Guard against a regression to the old inverted claim.
    expect(desc).not.toContain("ranked by pause's internal graph score");
  });
});
