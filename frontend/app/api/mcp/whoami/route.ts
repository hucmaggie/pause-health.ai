/**
 * GET /api/mcp/whoami — gate diagnostic.
 *
 * Lets an operator verify that the Headless 360 `mcp_api` gate
 * (`SF_HEADLESS360_REQUIRE_MCP_AUTH`) is wired correctly without
 * having to parse the SSE response stream from `/api/mcp`. Same
 * authentication path, plain JSON response.
 *
 *   - Gate off → `{ gate: "off" }` (200). No bearer required.
 *   - Gate on, no bearer / bad bearer / wrong scope → same 401/403/503
 *     responses /api/mcp would return (so the runbook smoke tests
 *     match).
 *   - Gate on, valid bearer → `{ gate: "on", via, username }` (200).
 *
 * NOT a security boundary — this endpoint exists for diagnosis, not
 * for authorization decisions. The real gate is on `/api/mcp`.
 */
import { guardMcpAuth } from "../../../../lib/mcp/http-auth";
import { isMcpApiAuthRequired } from "../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isMcpApiAuthRequired()) {
    return Response.json({ gate: "off" });
  }
  const guard = await guardMcpAuth(req);
  if (guard.kind === "blocked") return guard.response;
  // kind: "off" can't happen here (we just checked the flag), but
  // typescript wants the exhaustiveness check.
  if (guard.kind === "off") return Response.json({ gate: "off" });

  return Response.json({
    gate: "on",
    via: guard.identity.via,
    username: guard.identity.username ?? null
  });
}
