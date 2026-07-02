import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_VERSION } from "./tools";
import { getAgent } from "../agent-fabric";

/**
 * Cross-surface drift guard: the Agent Fabric registry entry for the Pause
 * MCP server (what an operator sees in the fabric console + what
 * GET /api/agent-fabric/agents returns) must match the MCP server the
 * codebase actually ships.
 *
 * Two things drift silently otherwise:
 *   1. Version. The registry hard-codes a version string; the real server
 *      reports SERVER_VERSION on `initialize` (both stdio and Streamable
 *      HTTP). These fell out of sync (registry said 0.1.0 while the server
 *      was 0.3.0), so the console advertised a stale build.
 *   2. Tool surface. The registry lists the MCP tools as capabilities. If a
 *      tool is added, renamed, or removed in tools.ts without updating the
 *      registry (or vice-versa), the advertised capability set lies about
 *      what the server can do.
 *
 * The registration calls in tools.ts are the source of truth for tool
 * names; we extract them from source (same approach as tools.parity.test).
 */

const TOOLS_SRC = resolve(__dirname, "tools.ts");

function registeredToolNames(): string[] {
  const src = readFileSync(TOOLS_SRC, "utf-8");
  const names: string[] = [];
  const re = /registerTool\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

/** Leading token of a capability string, e.g. "get_patient_timeline (…)". */
function capabilityToolToken(capability: string): string {
  return capability.split(/[\s(]/)[0];
}

describe("Agent Fabric registry ⇄ Pause MCP server", () => {
  it("advertises the version the MCP server actually reports", () => {
    const mcp = getAgent("pause-mcp");
    expect(mcp).toBeDefined();
    expect(mcp!.version).toBe(SERVER_VERSION);
  });

  it("lists exactly the tools the server registers (bijection, by name)", () => {
    const tools = registeredToolNames();
    // Sanity: the source extraction found the expected surface.
    expect(tools.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tools).size).toBe(tools.length); // no dupes

    const mcp = getAgent("pause-mcp")!;
    const advertised = mcp.capabilities.map(capabilityToolToken);

    // Every registered tool is advertised, and every advertised capability
    // names a real registered tool -- no extras, no omissions.
    expect(advertised.slice().sort()).toEqual(tools.slice().sort());
  });
});
