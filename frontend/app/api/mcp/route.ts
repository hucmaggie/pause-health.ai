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
 * Auth: no bearer enforcement on this prototype endpoint — the
 * underlying Experience APIs are the public mock surface. When pointed
 * at a customer Anypoint instance, layer auth at the Vercel proxy or
 * the Anypoint Experience tier; do not bolt it on here without coordinating
 * with the Agentforce Registry's connection profile.
 */
import {
  WebStandardStreamableHTTPServerTransport
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createPauseMcpServer, SERVER_NAME } from "../../../lib/mcp/tools";

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

async function handle(req: Request): Promise<Response> {
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
