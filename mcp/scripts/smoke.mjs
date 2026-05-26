#!/usr/bin/env node
/**
 * Smoke test for the Pause MCP server.
 *
 * Spawns the built server (dist/server.js) as a child process and drives
 * it as a real MCP client would: initialize, list tools, then call each
 * of the four tools. Prints a one-line PASS/FAIL per tool.
 *
 * Assumes a Pause Experience API is reachable at PAUSE_MCP_BASE_URL.
 * For local development, start the Next.js dev server first
 *   (cd frontend && npm run dev) and set
 *   PAUSE_MCP_BASE_URL=http://localhost:3000.
 *
 * Usage:
 *   PAUSE_MCP_BASE_URL=http://localhost:3000 node scripts/smoke.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "..", "dist", "server.js");

const baseUrl = process.env.PAUSE_MCP_BASE_URL ?? "http://localhost:3000";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...process.env,
    PAUSE_MCP_BASE_URL: baseUrl
  }
});

const client = new Client(
  { name: "pause-mcp-smoke", version: "0.0.1" },
  { capabilities: {} }
);

const failures = [];
async function check(label, fn) {
  try {
    const out = await fn();
    console.log(`PASS  ${label}`);
    return out;
  } catch (e) {
    console.log(`FAIL  ${label} -> ${e?.message ?? e}`);
    failures.push(label);
    return null;
  }
}

await client.connect(transport);

await check("listTools returns 4 tools", async () => {
  const { tools } = await client.listTools();
  if (tools.length !== 4) throw new Error(`expected 4 tools, got ${tools.length}`);
  const names = tools.map((t) => t.name).sort();
  const expected = [
    "experience_api_health",
    "find_menopause_providers",
    "get_patient_intake",
    "get_patient_timeline"
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`unexpected names: ${names.join(",")}`);
  }
});

await check("experience_api_health", async () => {
  const r = await client.callTool({ name: "experience_api_health", arguments: {} });
  if (r.isError) throw new Error("tool returned isError");
});

await check("get_patient_timeline (demo id)", async () => {
  const r = await client.callTool({
    name: "get_patient_timeline",
    arguments: { patientId: "pause-demo-patient-001" }
  });
  if (r.isError) throw new Error("tool returned isError");
});

await check("get_patient_intake (demo id)", async () => {
  const r = await client.callTool({
    name: "get_patient_intake",
    arguments: { patientId: "pause-demo-patient-001" }
  });
  if (r.isError) throw new Error("tool returned isError");
});

await check("find_menopause_providers (zip=926)", async () => {
  const r = await client.callTool({
    name: "find_menopause_providers",
    arguments: { zip: "92614", menopauseOnly: true, limit: 5 }
  });
  if (r.isError) throw new Error("tool returned isError");
});

await client.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} tool(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll Pause MCP tools healthy.");
