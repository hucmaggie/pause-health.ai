#!/usr/bin/env node
/**
 * @pause-health/mcp
 *
 * Model Context Protocol (MCP) server that exposes the Pause-Health.ai
 * MuleSoft Experience APIs as tools for AI agents.
 *
 * Transport: stdio (standard for local MCP clients like Claude Desktop,
 * Cursor, and the Agentforce Service Agent's local connector).
 *
 * Today the server fronts the mocked Experience APIs in this repo
 * (https://pause-health.ai/api/mulesoft/...). When a customer's MuleSoft
 * runtime is deployed, point PAUSE_MCP_BASE_URL at their Anypoint
 * Experience-tier base URL and these same tools transparently call
 * production -- no client changes required.
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_NAME = "pause-health-mcp";
const SERVER_VERSION = "0.1.0";

const BASE_URL = (process.env.PAUSE_MCP_BASE_URL ?? "https://pause-health.ai").replace(
  /\/+$/,
  ""
);
const API_KEY = process.env.PAUSE_MCP_API_KEY;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

async function callExperienceApi(path: string): Promise<JsonValue> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `${SERVER_NAME}/${SERVER_VERSION}`
  };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `Pause Experience API ${res.status} ${res.statusText} for ${url}`
    );
  }
  return (await res.json()) as JsonValue;
}

function ok(payload: JsonValue, summary: string) {
  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "text" as const, text: JSON.stringify(payload, null, 2) }
    ]
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true
  };
}

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION
});

server.registerTool(
  "get_patient_timeline",
  {
    title: "Get Pause patient timeline",
    description:
      "Return a FHIR R5 Bundle for a patient containing raw wearable Observations (heart rate, sleep duration, HRV RR-interval) plus a DBDP-computed feature Observation (sliding-window RMSSD) with `derivedFrom` provenance. Backed by the Pause MuleSoft Experience API `pause-patient-bundle-process-api`. Today the demo cohort only contains one synthetic patient; any id resolves to the same shape.",
    inputSchema: {
      patientId: z
        .string()
        .min(1)
        .default("pause-demo-patient-001")
        .describe("Pause patient id. Use 'pause-demo-patient-001' for the demo cohort.")
    }
  },
  async ({ patientId }) => {
    try {
      const id = encodeURIComponent(patientId);
      const data = await callExperienceApi(`/api/mulesoft/patient/${id}/timeline`);
      const bundle = (data as { bundle?: { entry?: unknown[] } }).bundle;
      const entries = Array.isArray(bundle?.entry) ? bundle!.entry!.length : 0;
      return ok(
        data,
        `Pause patient timeline for ${patientId}: FHIR Bundle with ${entries} entries (Patient + Observations).`
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

server.registerTool(
  "get_patient_intake",
  {
    title: "Get Pause patient intake record",
    description:
      "Return the structured intake record produced by the Salesforce Agentforce Service Agent (or the Pause Agentforce-style fallback) and persisted by the MuleSoft Process API `pause-intake-process-api`. Contains chief complaint, symptom cluster with severity/frequency, menopause stage, red-flag screen, triage recommendation, and provenance.",
    inputSchema: {
      patientId: z
        .string()
        .min(1)
        .default("pause-demo-patient-001")
        .describe("Pause patient id. Use 'pause-demo-patient-001' for the demo cohort.")
    }
  },
  async ({ patientId }) => {
    try {
      const id = encodeURIComponent(patientId);
      const data = await callExperienceApi(`/api/mulesoft/patient/${id}/intake`);
      const intake = (data as { intake?: { chiefComplaint?: string; triageRecommendation?: { acuity?: string } } }).intake;
      const summary = intake?.chiefComplaint
        ? `Pause intake for ${patientId} — ${intake.triageRecommendation?.acuity ?? "unknown"} acuity: ${intake.chiefComplaint}`
        : `Pause intake for ${patientId}.`;
      return ok(data, summary);
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

server.registerTool(
  "find_menopause_providers",
  {
    title: "Find menopause-experienced providers",
    description:
      "Search Pause's provider directory (a defensible synthesis of CMS NPPES, self-reported MSCP/NCMP credentials, and a curated overlay). Supports filtering by ZIP prefix and a menopause-certified-only flag. Results are ranked by distance from the patient ZIP when its Census ZCTA centroid is known (each provider carries `distanceMiles`); otherwise by Pause's internal graph score. Read the response `sort` field to see which ranking applied, and prefer reporting distance (e.g. \"about 4 miles away\") to the patient when present. When a certified search finds nobody in the patient's ZIP area, results gracefully fall back — to nearby menopause-relevant (non-certified) clinicians, or to telehealth-capable certified specialists nationally. ALWAYS read the response `matchType` and present accordingly: 'certified-local' = certified & local; 'relevant-local' = nearby but NOT menopause-certified (say so); 'certified-remote' = certified specialists elsewhere offering telehealth (no local match); 'none' = no match.",
    inputSchema: {
      zip: z
        .string()
        .regex(/^\d{3,5}$/)
        .optional()
        .describe("Optional 3–5 digit US ZIP code. 3-digit prefix is used for matching."),
      menopauseOnly: z
        .boolean()
        .default(true)
        .describe(
          "When true, return only providers with a menopause certification (e.g. MSCP). Default true."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of providers to return. Default 10, max 50.")
    }
  },
  async ({ zip, menopauseOnly, limit }) => {
    try {
      const qs = new URLSearchParams();
      if (zip) qs.set("zip", zip);
      qs.set("menopause", String(menopauseOnly));
      qs.set("limit", String(limit));
      const data = await callExperienceApi(`/api/mulesoft/providers?${qs.toString()}`);
      const total = (data as { total?: number }).total ?? 0;
      const returned = (data as { returned?: number }).returned ?? 0;
      const matchType = (data as { matchType?: string }).matchType ?? "certified-local";
      const sort = (data as { sort?: string }).sort ?? "score";
      const matchNote: Record<string, string> = {
        "certified-local": "menopause-certified and local",
        "relevant-local": "nearby but NOT menopause-certified — present them as menopause-experienced, not certified",
        "certified-remote": "menopause-certified specialists elsewhere offering telehealth (no local certified match)",
        "certified-national": "menopause-certified (no ZIP filter applied)",
        none: "no matching providers"
      };
      return ok(
        data,
        `Pause provider directory: returned ${returned} of ${total} providers (zip=${zip ?? "any"}, menopauseOnly=${menopauseOnly}). sort=${sort}${sort === "distance" ? " (distanceMiles ascending)" : " (graphScore descending)"}. matchType=${matchType} — ${matchNote[matchType] ?? matchType}.`
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

server.registerTool(
  "experience_api_health",
  {
    title: "Pause Experience API liveness",
    description:
      "Liveness check for the Pause-Health.ai MuleSoft Experience API plane. Returns the demo FHIR Bundle from `/api/mulesoft/health`. Use this to verify connectivity before issuing larger tool calls.",
    inputSchema: {}
  },
  async () => {
    try {
      const data = await callExperienceApi(`/api/mulesoft/health`);
      const bundle = (data as { bundle?: { entry?: unknown[] } }).bundle;
      const entries = Array.isArray(bundle?.entry) ? bundle!.entry!.length : 0;
      return ok(
        data,
        `Pause Experience API is reachable at ${BASE_URL}. Demo bundle returned with ${entries} entries.`
      );
    } catch (e) {
      return err((e as Error).message);
    }
  }
);

async function main() {
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
