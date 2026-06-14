/**
 * Salesforce Data Cloud (formerly CDP / Customer Data Platform) client.
 *
 * Phase 2 of the Data 360 grounding strategy. This module calls the
 * Data Cloud Query API and Calculated Insights API to fetch wearable/EHR
 * signals that aren't available via plain SOQL against Health Cloud.
 *
 * Architecture:
 *   Phase 1 (grounding.ts)  — SOQL against Health Cloud objects
 *                              (Contact, CareProgramEnrollee, CarePlan, Case)
 *   Phase 2 (this module)   — Data Cloud Query API against Data Model Objects
 *                              (UnifiedIndividual, ssot__Observation__dlm,
 *                               ssot__CalculatedInsight__dlm, etc.)
 *
 * The two phases COMPOSE: grounding.ts calls into this module to layer
 * real calculated insights (HRV, vasomotor, sleep) on top of the SOQL-
 * derived Health Cloud insights. If this module is unconfigured or the
 * DC tenant isn't provisioned, it returns null and grounding.ts falls
 * back to the intake-baseline mocks silently.
 *
 * Env vars (all optional — absence silently disables Phase 2):
 *   SF_DC_TENANT_URL      Base URL of the Data Cloud tenant, e.g.:
 *                           https://00DHp00000L08KK.c360a.salesforce.com
 *                         In most orgs this is derivable from the SF_INSTANCE_URL
 *                         org ID; set it explicitly when the org uses a custom domain.
 *   SF_DC_API_VERSION     Data Cloud API version, default "v1". Used in path
 *                         /api/v1/query and /api/v1/insight/query.
 *   SF_CLIENT_ID          Shared with Phase 1 — the same Connected App / External
 *                         Client App is used, since DC auth is handled through the
 *                         core Salesforce token endpoint.
 *   SF_CLIENT_SECRET      Shared with Phase 1.
 *   SF_INSTANCE_URL       Used to derive SF_DC_TENANT_URL when the explicit var
 *                         is absent.
 *
 * Data Cloud Query API reference:
 *   https://developer.salesforce.com/docs/atlas.en-us.c360a_api.meta/c360a_api/
 *
 * Activation path (what to do in the Anypoint / Salesforce UI):
 *   See docs/MULESOFT_PHASE_2_DATA_CLOUD.md (generated alongside this file).
 */

import { getAccessToken, isSalesforceConfigured } from "./auth";
import type { CalculatedInsight, FederatedSource } from "../data-360";

const DC_API_VERSION = process.env.SF_DC_API_VERSION || "v1";

/**
 * Derive the Data Cloud tenant URL from SF_DC_TENANT_URL (explicit) or
 * from the 15-char org ID embedded in SF_INSTANCE_URL.
 *
 * Pattern: https://<15-char-orgId>.c360a.salesforce.com
 *
 * Returns null if we can't derive it (user needs to set SF_DC_TENANT_URL).
 */
function getDataCloudTenantUrl(): string | null {
  const explicit = process.env.SF_DC_TENANT_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const instanceUrl = process.env.SF_INSTANCE_URL;
  if (!instanceUrl) return null;

  // Extract the 18-char org ID from the subdomain, e.g.:
  //   https://trailsignup-c2d761a3b89bf2.my.salesforce.com
  // The c360a domain uses the 15-char version of the org ID from
  // /services/data/vXX.0/sobjects Organization.Id (e.g. 00DHp00000L08KK).
  // We can't derive it here without a live SOQL call, so we require the
  // explicit env var. Return null to signal misconfiguration.
  return null;
}

export function isDataCloudConfigured(): boolean {
  if (!isSalesforceConfigured()) return false;
  return getDataCloudTenantUrl() !== null;
}

/**
 * Raw shape returned by the Data Cloud Query API
 * POST /api/v1/query
 */
type DcQueryResponse = {
  data?: Array<Record<string, unknown>>;
  metadata?: Record<string, { type: string }>;
  nextBatchId?: string;
  done?: boolean;
  rowCount?: number;
};

/**
 * Raw shape returned by Data Cloud Calculated Insights API
 * GET /api/v1/insight/query?insight_api_name=<name>&filter=<expr>
 */
type DcInsightResponse = {
  data?: Array<Record<string, unknown>>;
  metadata?: Record<string, { type: string }>;
  rowCount?: number;
};

async function dcFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const tenantUrl = getDataCloudTenantUrl();
  if (!tenantUrl) throw new Error("SF_DC_TENANT_URL is not set or derivable");

  const { accessToken } = await getAccessToken();
  const url = `${tenantUrl}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!res.ok) {
    const body = await res.text();
    // Log the response body on its own line so Vercel's row-truncated log
    // viewer doesn't eat the part that explains *why* the request failed.
    console.warn(`[data-cloud] ${path} → ${res.status}\nbody: ${body.slice(0, 800)}`);
    throw new Error(`Data Cloud API ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Execute a Data Cloud SQL query via POST /api/v1/query.
 * Returns the rows array (empty if no results).
 */
export async function dcQuery(sql: string): Promise<Array<Record<string, unknown>>> {
  const resp = await dcFetch<DcQueryResponse>(`/api/${DC_API_VERSION}/query`, {
    method: "POST",
    body: JSON.stringify({ sql })
  });
  return resp.data ?? [];
}

/**
 * Query a named Calculated Insight via GET /api/v1/insight/query.
 * insightApiName  — the Developer Name of the CI in Data Cloud.
 * filterExpr      — optional SSOT filter, e.g. "ssot__Id__c = 'pause-demo-patient-001'"
 */
export async function dcInsightQuery(
  insightApiName: string,
  filterExpr?: string
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({ insight_api_name: insightApiName });
  if (filterExpr) params.set("filter", filterExpr);
  const resp = await dcFetch<DcInsightResponse>(
    `/api/${DC_API_VERSION}/insight/query?${params}`
  );
  return resp.data ?? [];
}

// ---------------------------------------------------------------------------
// Phase 2 Calculated Insight names
//
// Data Cloud appends a "__cio" suffix to every CI's API name (Calculated
// Insight Object), the same way custom sObjects get "__c". The Developer
// Name you type in the New Insight modal becomes the bare prefix; the
// Insight Query API expects the full __cio-suffixed name.
//
// Activated on the trailsignup org 2026-06-13 (session 3).
// See docs/MULESOFT_PHASE_2_DATA_CLOUD.md and data-cloud/_mock_path.sql
// for the source-of-truth definitions.
// ---------------------------------------------------------------------------

const CI_HRV_RMSSD_30D = "Pause_HRV_RMSSD_30d__cio";
const CI_VASOMOTOR_BURDEN_30D = "Pause_Vasomotor_Burden_30d__cio";
const CI_SLEEP_DISRUPTION_7D = "Pause_Sleep_Disruption_7d__cio";

/**
 * Fetch the three wearable/EHR Calculated Insights for a patient from
 * Data Cloud. These replace the intake-baseline mocks in grounding.ts.
 *
 * Returns null if Data Cloud is not configured or the tenant doesn't
 * have the CIs provisioned yet — callers fall back to the mock baseline.
 *
 * Row shapes expected (one row per insight, one column per metric).
 * All CI output columns get a "__c" suffix from the DC engine, and the
 * Dimension column we GROUP BY on is named "unified_id" (renamed from
 * the validator-incompatible "ssot__Id__c" alias):
 *   Pause_HRV_RMSSD_30d__cio       → { unified_id__c, hrv_rmssd_ms__c, z_score__c, window_days__c }
 *   Pause_Vasomotor_Burden_30d__cio → { unified_id__c, burden_score_0_100__c, flash_count_30d__c }
 *   Pause_Sleep_Disruption_7d__cio  → { unified_id__c, disruption_index_0_1__c, disrupted_nights__c }
 */
export async function getWearableInsights(unifiedPatientId: string): Promise<{
  hrv: CalculatedInsight | null;
  vasomotor: CalculatedInsight | null;
  sleep: CalculatedInsight | null;
} | null> {
  if (!isDataCloudConfigured()) return null;

  const now = new Date().toISOString();
  const src: FederatedSource = "dbdp-wearable-features";
  const filter = `unified_id__c = '${unifiedPatientId.replace(/'/g, "\\'")}'`;

  try {
    const [hrvRows, vasomotorRows, sleepRows] = await Promise.all([
      dcInsightQuery(CI_HRV_RMSSD_30D, filter),
      dcInsightQuery(CI_VASOMOTOR_BURDEN_30D, filter),
      dcInsightQuery(CI_SLEEP_DISRUPTION_7D, filter)
    ]);

    const hrv: CalculatedInsight | null = hrvRows[0]
      ? {
          id: "insight.hrv-rmssd-30d",
          name: "HRV RMSSD variability (30-day)",
          description: `RMSSD ${hrvRows[0].hrv_rmssd_ms__c} ms · z-score ${hrvRows[0].z_score__c} vs menopause cohort. Source: Oura/DBDP via Data Cloud.`,
          value: Number(hrvRows[0].z_score__c ?? 0),
          unit: "z-score",
          computedAt: now,
          sourceWindow: "30d",
          federatedFrom: [src, "jupyterhealth-fhir"]
        }
      : null;

    const vasomotor: CalculatedInsight | null = vasomotorRows[0]
      ? {
          id: "insight.vasomotor-burden-30d",
          name: "Vasomotor symptom burden (30-day)",
          description: `Burden score ${vasomotorRows[0].burden_score_0_100__c}/100 · ${vasomotorRows[0].flash_count_30d__c} events in 30d. Source: wearable thermoregulation + intake via Data Cloud.`,
          value: Number(vasomotorRows[0].burden_score_0_100__c ?? 0),
          unit: "score",
          computedAt: now,
          sourceWindow: "30d",
          federatedFrom: [src, "agentforce-intake-history"]
        }
      : null;

    const sleep: CalculatedInsight | null = sleepRows[0]
      ? {
          id: "insight.sleep-disruption-7d",
          name: "Sleep disruption index (7-day)",
          description: `Disruption index ${sleepRows[0].disruption_index_0_1__c} · ${sleepRows[0].disrupted_nights__c} disrupted nights. Source: Oura sleep staging via Data Cloud.`,
          value: Number(sleepRows[0].disruption_index_0_1__c ?? 0),
          unit: "fraction",
          computedAt: now,
          sourceWindow: "7d",
          federatedFrom: [src, "jupyterhealth-fhir"]
        }
      : null;

    return { hrv, vasomotor, sleep };
  } catch (err) {
    // Surface to logs so silent fallbacks are debuggable in production.
    // The caller in grounding.ts still treats null as "degrade to baseline".
    console.warn(
      "[data-cloud] getWearableInsights failed; degrading to Phase 1 baseline.",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
    return null;
  }
}
