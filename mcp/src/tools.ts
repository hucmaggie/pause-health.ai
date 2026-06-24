/**
 * Tool registration for the Pause-Health MCP server.
 *
 * Transport-agnostic: this module configures an McpServer with the four
 * Pause tools (timeline, intake, providers, health) and is consumed by
 * both transports we ship:
 *
 *   - `mcp/src/server.ts`              stdio (Claude Desktop, Cursor)
 *   - `frontend/app/api/mcp/route.ts`  Streamable HTTP, web-standard
 *                                       Request/Response (Agentforce 3.0
 *                                       Registry, any HTTP-based MCP
 *                                       client)
 *
 * Keep tool definitions here so a new tool, a description tweak, or a
 * schema change ships to both transports in one place.
 *
 * The Experience API base URL is passed in by the caller so a single
 * deployed Next.js route can serve the same MCP contract whether it's
 * fronting prod, the local dev server, or a customer's Anypoint
 * Experience tier.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SERVER_NAME = "pause-health-mcp";
export const SERVER_VERSION = "0.3.0";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface ToolDeps {
  /** Experience API base URL (e.g. `https://pause-health.ai`). */
  baseUrl: string;
  /** Optional bearer token sent as `Authorization: Bearer ...`. */
  apiKey?: string;
  /** Override the underlying fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Identifier sent as `User-Agent` (transport label appended downstream). */
  userAgent?: string;
}

function makeCallExperienceApi(deps: ToolDeps) {
  const baseUrl = deps.baseUrl.replace(/\/+$/, "");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const userAgent = deps.userAgent ?? `${SERVER_NAME}/${SERVER_VERSION}`;
  return async function callExperienceApi(path: string): Promise<JsonValue> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": userAgent
    };
    if (deps.apiKey) headers.Authorization = `Bearer ${deps.apiKey}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(
        `Pause Experience API ${res.status} ${res.statusText} for ${url}`
      );
    }
    return (await res.json()) as JsonValue;
  };
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

/**
 * Register the four Pause tools on an McpServer instance.
 *
 * Tool descriptions are LLM-facing and intentionally verbose — they
 * carry the "how to phrase recommendations to the patient" guidance the
 * Care Router relies on. When Agentforce 3.0 reads `tools/list` to
 * populate the Asset Library, this text becomes the agent's reasoning
 * instructions; don't trim it.
 */
export function registerPauseTools(server: McpServer, deps: ToolDeps): void {
  const callExperienceApi = makeCallExperienceApi(deps);

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
          .describe(
            "Pause patient id. Use 'pause-demo-patient-001' for the demo cohort."
          )
      }
    },
    async ({ patientId }) => {
      try {
        const id = encodeURIComponent(patientId);
        const data = await callExperienceApi(
          `/api/mulesoft/patient/${id}/timeline`
        );
        const bundle = (data as { bundle?: { entry?: unknown[] } }).bundle;
        const entries = Array.isArray(bundle?.entry)
          ? bundle!.entry!.length
          : 0;
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
          .describe(
            "Pause patient id. Use 'pause-demo-patient-001' for the demo cohort."
          )
      }
    },
    async ({ patientId }) => {
      try {
        const id = encodeURIComponent(patientId);
        const data = await callExperienceApi(
          `/api/mulesoft/patient/${id}/intake`
        );
        const intake = (data as {
          intake?: {
            chiefComplaint?: string;
            triageRecommendation?: { acuity?: string };
          };
        }).intake;
        const summary = intake?.chiefComplaint
          ? `Pause intake for ${patientId} — ${
              intake.triageRecommendation?.acuity ?? "unknown"
            } acuity: ${intake.chiefComplaint}`
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
        "Search Pause's provider directory: 2,015 NPPES-derived providers, ranked by distance from the patient's ZIP when its Census ZCTA centroid is known. Filterable by ZIP prefix, a menopause-certified-only flag, and an insurance plan. Returned providers are GUARANTEED currently-licensed: licenseStatus is always 'active' on the response, because sanctioned providers (CA Medi-Cal + NY OPMC + TX TMB; 1,720 dropped this build) were filtered out at build time — the agent does NOT need to add safety disclaimers about license status. ALWAYS read `matchType` and present accordingly: 'certified-local' = MSCP-certified & local (the happy path); 'relevant-local' = nearby clinicians who are NOT menopause-certified — say so explicitly, then surface their strongest serviceSignals in plain English so the patient understands why they're being recommended; 'certified-remote' = certified specialists elsewhere offering telehealth (no local certified match — frame as a telehealth option); 'certified-national' = certified, no ZIP filter; 'none' = no match. Read `sort`: 'distance' means rows are sorted distanceMiles ascending (prefer reporting distance, e.g. 'about 4 miles away'); 'score' means graphScore-only ranking (the live worker can't always compute distance — that's honest, not a bug). Each provider carries `serviceSignals` (public-registry tokens like facog = board-certified OB/GYN, faafp = board-certified family medicine, whnp = Women's Health NP, cnm = Certified Nurse-Midwife, multi-taxonomy = practice spans ≥2 menopause-relevant specialties) and `insuranceAccepted` (canonical tokens: medicare, medicaid, aetna, bcbs, uhc, cigna, humana, kaiser). IMPORTANT: insuranceAccepted is synthetically derived per-NPI today (no public payer feed exists; calibrated to plausible real-world participation rates). Phrase as 'appears to accept Aetna' rather than 'accepts Aetna', and recommend the patient confirm in-network status before booking. Worked example for relevant-local: 'No MSCP-certified provider was available within your ZIP-3 area. Dr. Helen Okafor is about 4.2 miles from you — she's not menopause-certified but is board-certified in obstetrics & gynecology (FACOG), which is a strong signal she handles menopause care. Profile: https://pause-health.ai/provider/<NPI>?from=<patient_zip>'. The profile URL is a real page — include it when surfacing a recommendation so the patient can read the full chip set (distance, plans, signals, license, provenance) without leaving the conversation.",
      inputSchema: {
        zip: z
          .string()
          .regex(/^\d{3,5}$/)
          .optional()
          .describe(
            "Optional 3–5 digit US ZIP code. 3-digit prefix is used for matching."
          ),
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
          .describe(
            "Maximum number of providers to return. Default 10, max 50."
          ),
        insurance: z
          .string()
          .optional()
          .describe(
            "Optional insurance plan to filter by. Case-insensitive; aliases like 'United' / 'Blue Cross' are normalized. Canonical tokens: medicare, medicaid, aetna, bcbs, uhc, cigna, humana, kaiser. Synthetically derived today (no public payer feed); use provisionally."
          )
      }
    },
    async ({ zip, menopauseOnly, limit, insurance }) => {
      try {
        const qs = new URLSearchParams();
        if (zip) qs.set("zip", zip);
        qs.set("menopause", String(menopauseOnly));
        qs.set("limit", String(limit));
        if (insurance) qs.set("insurance", insurance);
        const data = await callExperienceApi(
          `/api/mulesoft/providers?${qs.toString()}`
        );
        const total = (data as { total?: number }).total ?? 0;
        const returned = (data as { returned?: number }).returned ?? 0;
        const matchType =
          (data as { matchType?: string }).matchType ?? "certified-local";
        const sort = (data as { sort?: string }).sort ?? "score";
        const providers =
          (data as {
            providers?: Array<{ npi?: string; name?: string }>;
          }).providers ?? [];
        const matchNote: Record<string, string> = {
          "certified-local": "menopause-certified and local",
          "relevant-local":
            "nearby but NOT menopause-certified — present them as menopause-experienced, not certified",
          "certified-remote":
            "menopause-certified specialists elsewhere offering telehealth (no local certified match)",
          "certified-national": "menopause-certified (no ZIP filter applied)",
          none: "no matching providers"
        };
        const topNpi = providers[0]?.npi;
        const profileHint = topNpi
          ? `Profile URL for top result: ${deps.baseUrl}/provider/${topNpi}${
              zip ? `?from=${zip}` : ""
            }`
          : `Browse the directory: ${deps.baseUrl}/provider${
              zip ? `?zip=${zip}` : ""
            }`;
        return ok(
          data,
          `Pause provider directory: returned ${returned} of ${total} providers (zip=${
            zip ?? "any"
          }, menopauseOnly=${menopauseOnly}). sort=${sort}${
            sort === "distance"
              ? " (distanceMiles ascending)"
              : " (graphScore descending)"
          }. matchType=${matchType} — ${matchNote[matchType] ?? matchType}. licenseStatus on every returned provider is 'active' (sanctioned providers were filtered at build). ${profileHint}.`
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
        const entries = Array.isArray(bundle?.entry)
          ? bundle!.entry!.length
          : 0;
        return ok(
          data,
          `Pause Experience API is reachable at ${deps.baseUrl}. Demo bundle returned with ${entries} entries.`
        );
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );
}

/**
 * Build a fully-configured McpServer instance with the four Pause tools
 * registered. Use this from any transport.
 */
export function createPauseMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  registerPauseTools(server, deps);
  return server;
}
