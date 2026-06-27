/**
 * MCP Streamable HTTP endpoint for the Pause-Health MCP server.
 *
 * Discoverable by **Agentforce 3.0 Registry** (Setup → New MCP server →
 * paste `https://pause-health.ai/api/mcp`) and any other HTTP-based MCP
 * client. Same four tools as the stdio binary in `mcp/` —
 * `get_patient_timeline`, `get_patient_intake`, `find_menopause_providers`,
 * `experience_api_health` — sharing the canonical tool registrations in
 * `frontend/lib/mcp/tools.ts`.
 *
 * Transport: Streamable HTTP (web-standard `Request`/`Response`), the
 * current MCP spec revision. The SDK's `WebStandardStreamableHTTPServerTransport`
 * drops directly into the App Router's `Request → Response` handler
 * shape, so there is no Express adapter, no shim, no body parser to
 * configure.
 *
 * Stateless mode: `sessionIdGenerator` is left undefined, so we don't
 * issue session cookies and we don't keep per-connection state across
 * requests. That matches Vercel's serverless invocation model and is
 * what the Agentforce 3.0 Registry expects today (it stores the
 * agent's session at its own layer). If a future client needs sticky
 * sessions, swap to a stateful generator + an `EventStore`.
 *
 * Auth: by default no bearer enforcement on this prototype endpoint — the
 * underlying Experience APIs are the public mock surface, and the
 * Agentforce 3.0 Registry expects a public connection profile.
 *
 * **Headless 360 audit gap #2 (`mcp_api` scope) — env-gated activation.**
 * When the operator sets `SF_HEADLESS360_REQUIRE_MCP_AUTH=on` (and the
 * other `SF_HEADLESS360_*` env vars are provisioned), this route requires
 * every request to carry an `Authorization: Bearer <token>` header that
 * Salesforce validates as active with the `mcp_api` scope. Validation is
 * introspect-first with a userinfo fallback for orgs that disable
 * introspect — see `validateMcpApiBearer` in
 * `frontend/lib/salesforce-headless360.ts` for the trust model rationale
 * and `docs/HEADLESS_360_RUNBOOK.md` § "Closing gap #2" for the operator
 * runbook. Without the env, this route stays public for backwards
 * compatibility with the Agentforce Registry.
 */
import {
  WebStandardStreamableHTTPServerTransport
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createPauseMcpServer, SERVER_NAME } from "../../../lib/mcp/tools";
import {
  getHeadless360Config,
  isMcpApiAuthRequired,
  validateMcpApiBearer
} from "../../../lib/salesforce-headless360";

// The MCP SDK depends on Node-only APIs (crypto, streams). Pin Node
// runtime so Vercel doesn't try to compile this for the Edge runtime.
export const runtime = "nodejs";
// Always evaluate on request — the tool surface depends on env-driven
// base URL.
export const dynamic = "force-dynamic";

function pauseBaseUrl(req: Request): string {
  const fromEnv = process.env.PAUSE_MCP_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // Default: the same origin as the incoming request. So a preview
  // deployment's MCP server fronts that preview's Experience APIs, and
  // production fronts production. Avoids cross-deploy contamination.
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Bearer-gate guard. Returns a Response when the gate is active and the
 * request fails validation; returns null when the request should
 * proceed (gate off, or gate on + bearer valid).
 *
 * `WWW-Authenticate: Bearer realm="mcp_api"` follows RFC 6750 so MCP
 * clients that handle 401 challenges can prompt for re-auth.
 */
async function guardMcpAuth(req: Request): Promise<Response | null> {
  if (!isMcpApiAuthRequired()) return null;
  const cfg = getHeadless360Config();
  if (!cfg) {
    // Operator opted into auth without provisioning the Headless 360
    // config. Fail closed; 503 + diagnostic so the runbook check is
    // actionable.
    return new Response(
      JSON.stringify({
        error: "mcp-auth-misconfigured",
        detail:
          "SF_HEADLESS360_REQUIRE_MCP_AUTH is set but the Headless 360 env vars are not. Either unset the gate or provision SF_HEADLESS360_CLIENT_ID + AUTH_BASE_URL + REDIRECT_URI + SESSION_SECRET."
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  const check = await validateMcpApiBearer(req, cfg);
  if (check.ok) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "WWW-Authenticate": `Bearer realm="mcp_api", error="${check.reason}"`
  };
  const status = check.reason === "scope-mismatch" ? 403 : 401;
  return new Response(JSON.stringify({ error: check.reason, ...("detail" in check ? { detail: check.detail } : {}) }), {
    status,
    headers
  });
}

async function handle(req: Request): Promise<Response> {
  const blocked = await guardMcpAuth(req);
  if (blocked) return blocked;

  const baseUrl = pauseBaseUrl(req);
  const server = createPauseMcpServer({
    baseUrl,
    apiKey: process.env.PAUSE_MCP_API_KEY,
    userAgent: `${SERVER_NAME}/streamable-http`
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session ids issued. See file header for the
    // rationale.
    sessionIdGenerator: undefined
  });

  // Per the SDK's example: connect the server to the transport BEFORE
  // calling handleRequest, so the McpServer is ready to receive any
  // tools/list or tools/call message that arrives on this request.
  // Do NOT eagerly close the transport in a finally block — the SDK
  // returns a `Response` whose body is a still-pending SSE stream, and
  // closing the transport too early severs that stream before the
  // initialize / tools/list response can flush.
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(req);
}
