/**
 * Bearer-gate helpers for the MCP Streamable HTTP endpoint.
 *
 * These live in lib/ (not in the route file) because Next.js App Router route
 * modules may only export HTTP method handlers plus a small config allowlist
 * (`runtime`, `dynamic`, …). Exporting `guardMcpAuth` directly from
 * app/api/mcp/route.ts fails the build with "guardMcpAuth is not a valid Route
 * export field". Both /api/mcp and the /api/mcp/whoami diagnostic import the
 * gate from here.
 *
 * Headless 360 audit gap #2 (`mcp_api` scope): when the operator sets
 * SF_HEADLESS360_REQUIRE_MCP_AUTH=on (and the other SF_HEADLESS360_* vars are
 * provisioned), every request must carry an `Authorization: Bearer <token>`
 * that Salesforce validates as active with the `mcp_api` scope — introspect-
 * first with a userinfo fallback. See `validateMcpApiBearer` in
 * lib/salesforce-headless360.ts and docs/HEADLESS_360_RUNBOOK.md § "Closing
 * gap #2". Without the env, the gate is off and the endpoints stay public for
 * backwards compatibility with the Agentforce 3.0 Registry.
 */
import {
  getHeadless360Config,
  isMcpApiAuthRequired,
  validateMcpApiBearer
} from "../salesforce-headless360";

export type McpAuthIdentity = {
  username?: string;
  via: "introspect" | "userinfo-fallback";
};

export type GuardResult =
  | { kind: "off" }
  | { kind: "blocked"; response: Response }
  | { kind: "allowed"; identity: McpAuthIdentity };

/**
 * Bearer-gate guard. Returns either a `Response` (blocked) or an
 * `identity` object describing who was let through (or null when the
 * gate is off).
 *
 * `WWW-Authenticate: Bearer realm="mcp_api"` follows RFC 6750 so MCP
 * clients that handle 401 challenges can prompt for re-auth. The
 * identity from the success path is attached to the eventual MCP
 * response as `X-Pause-MCP-User` + `X-Pause-MCP-Via` headers so the
 * Agent Fabric trace plane can attribute tool calls; this also
 * powers the `GET /api/mcp/whoami` diagnostic endpoint.
 */
export async function guardMcpAuth(req: Request): Promise<GuardResult> {
  if (!isMcpApiAuthRequired()) return { kind: "off" };
  const cfg = getHeadless360Config();
  if (!cfg) {
    // Operator opted into auth without provisioning the Headless 360
    // config. Fail closed; 503 + diagnostic so the runbook check is
    // actionable.
    return {
      kind: "blocked",
      response: new Response(
        JSON.stringify({
          error: "mcp-auth-misconfigured",
          detail:
            "SF_HEADLESS360_REQUIRE_MCP_AUTH is set but the Headless 360 env vars are not. Either unset the gate or provision SF_HEADLESS360_CLIENT_ID + AUTH_BASE_URL + REDIRECT_URI + SESSION_SECRET."
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" }
        }
      )
    };
  }
  const check = await validateMcpApiBearer(req, cfg);
  if (check.ok) {
    return {
      kind: "allowed",
      identity: { username: check.username, via: check.via }
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "WWW-Authenticate": `Bearer realm="mcp_api", error="${check.reason}"`
  };
  const status = check.reason === "scope-mismatch" ? 403 : 401;
  return {
    kind: "blocked",
    response: new Response(
      JSON.stringify({
        error: check.reason,
        ...("detail" in check ? { detail: check.detail } : {})
      }),
      { status, headers }
    )
  };
}

/**
 * Decorate the MCP response with the gate's identity headers when the
 * gate is on. Streamable HTTP responses are SSE streams — we attach
 * headers on the outer Response and let the body stream through.
 */
export function attachIdentityHeaders(
  response: Response,
  identity: McpAuthIdentity | null
): Response {
  if (!identity) return response;
  const headers = new Headers(response.headers);
  if (identity.username) headers.set("X-Pause-MCP-User", identity.username);
  headers.set("X-Pause-MCP-Via", identity.via);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
