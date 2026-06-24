#!/usr/bin/env node
/**
 * @pause-health/mcp — stdio transport
 *
 * Model Context Protocol (MCP) server that exposes the Pause-Health.ai
 * MuleSoft Experience APIs as tools for AI agents over **stdio**.
 *
 * stdio is the standard transport for local MCP clients — Claude
 * Desktop, Cursor, the Agentforce Service Agent's local connector. The
 * parent client process spawns this server and talks JSON-RPC over
 * stdin/stdout.
 *
 * For Agentforce 3.0 Registry intake (HTTP-fronted), see the sibling
 * Next.js route handler at `frontend/app/api/mcp/route.ts` — same tool
 * surface, Streamable HTTP transport, deploys with the rest of the
 * prototype on Vercel.
 *
 * Tool definitions live in `./tools.ts` so both transports stay in
 * lockstep when descriptions or schemas change.
 *
 * Environment variables:
 *   PAUSE_MCP_BASE_URL  Base URL for the Experience APIs. Default:
 *                      https://pause-health.ai
 *   PAUSE_MCP_API_KEY  Optional. Sent as `Authorization: Bearer <key>`.
 *                      Not used against the public mock.
 *
 * Run:
 *   npx @pause-health/mcp
 *   # or, after `npm run build`:
 *   node dist/server.js
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  createPauseMcpServer,
  SERVER_NAME
} from "./tools.js";

const BASE_URL = (
  process.env.PAUSE_MCP_BASE_URL ?? "https://pause-health.ai"
).replace(/\/+$/, "");
const API_KEY = process.env.PAUSE_MCP_API_KEY;

async function main() {
  const server = createPauseMcpServer({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    userAgent: `${SERVER_NAME}/stdio`
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[${SERVER_NAME}] connected over stdio. base=${BASE_URL}\n`
  );
}

main().catch((e) => {
  process.stderr.write(`[${SERVER_NAME}] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
