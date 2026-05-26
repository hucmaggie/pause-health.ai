import { NextResponse } from "next/server";
import { listPolicies } from "../../../../lib/agent-fabric";

/**
 * Mocked MuleSoft Agent Fabric: Policy Catalog.
 *
 *   GET /api/agent-fabric/policies
 *
 * Returns every governance policy currently defined on the fabric,
 * which agents it applies to, and its enforcement mode (block / audit /
 * rate-limit / redact).
 */
export async function GET() {
  const policies = listPolicies();
  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Pause Agent Fabric policy catalog. In production policies are authored in the MuleSoft Agent Fabric console and pushed to runtime enforcement points (Anypoint API gateway, MCP server, A2A inbound).",
        _policyCount: policies.length,
        _enforcedCount: policies.filter((p) => p.status === "enforced").length
      },
      policies
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
