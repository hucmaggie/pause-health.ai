import { NextResponse } from "next/server";
import { listAgents } from "../../../../lib/agent-fabric";

/**
 * Mocked MuleSoft Agent Fabric: Agent Registry.
 *
 *   GET /api/agent-fabric/agents
 *
 * Returns every agent currently registered on the fabric, with its
 * protocol (A2A / MCP / REST), endpoint, version, status, and
 * declared capabilities + governance policies.
 */
export async function GET() {
  const agents = listAgents();
  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Pause Agent Fabric registry. In production this is served by the MuleSoft Agent Fabric console on Anypoint, populated by agent self-registration and OAuth identity claims.",
        _agentCount: agents.length
      },
      agents
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
