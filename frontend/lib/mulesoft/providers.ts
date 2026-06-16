/**
 * Live MuleSoft Experience-API client for /api/mulesoft/providers.
 *
 * Mirrors the prefer-real / degrade-to-mock / warn-once pattern from
 * lib/mulesoft/health.ts. Activated by the MULESOFT_PROVIDERS_BASE_URL
 * env var; falls back to the mock in lib/mulesoft-mocks.ts when unset
 * or when the live call fails.
 *
 * The live Mule app serves GET /providers?zip=&menopause=&limit= and
 * returns a shape identical to queryProviderDirectory() in mulesoft-mocks.ts
 * so the API route and MCP tool don't need to branch.
 */

import { queryProviderDirectory } from "../mulesoft-mocks";
import { buildMulesoftAuthHeaders } from "./auth";

export type ProviderDirectoryResult = ReturnType<typeof queryProviderDirectory>;

export type LiveProvidersFetchOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 4_000;

export function isMulesoftProvidersLive(baseUrl?: string): boolean {
  const v = (baseUrl ?? process.env.MULESOFT_PROVIDERS_BASE_URL ?? "").trim();
  if (!v) return false;
  if (!/^https?:\/\//i.test(v)) return false;
  return true;
}

type ProvidersQuery = {
  zip?: string;
  menopauseOnly?: boolean;
  limit?: number;
  fallback?: boolean;
  /**
   * Patient ZIP centroid; used by the mock fallback to rank by distance.
   * Not forwarded to the live Mule API yet — the live worker still ranks by
   * graphScore until its DataWeave is updated.
   */
  zipCentroid?: { latitude: number; longitude: number } | null;
  /**
   * Canonical plan token to filter on (e.g. "uhc", "bcbs"). The API route
   * normalizes user input (aliases like "United" → "uhc") BEFORE building this
   * query, so it is forwarded verbatim to the live Mule API — the live worker
   * only lowercases, so it relies on receiving the canonical token. If the live
   * worker doesn't honor the param yet, the response just won't be filtered,
   * which is honest degradation.
   */
  insurance?: string | null;
  /** When true, forward ?telehealth=true so the worker narrows to telehealth. */
  telehealth?: boolean;
};

export async function fetchLiveProviders(
  query: ProvidersQuery,
  opts: LiveProvidersFetchOptions = {}
): Promise<ProviderDirectoryResult | null> {
  const baseUrl = (opts.baseUrl ?? process.env.MULESOFT_PROVIDERS_BASE_URL ?? "").trim();
  if (!isMulesoftProvidersLive(baseUrl)) return null;

  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(
      `MULESOFT_PROVIDERS_BASE_URL must start with http(s):// (got ${JSON.stringify(baseUrl)})`
    );
  }

  const params = new URLSearchParams();
  if (query.zip) params.set("zip", query.zip);
  if (query.menopauseOnly) params.set("menopause", "true");
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.fallback) params.set("fallback", "true");
  if (query.insurance) params.set("insurance", query.insurance);
  if (query.telehealth) params.set("telehealth", "true");

  const url = `${baseUrl.replace(/\/$/, "")}/providers?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const fetchFn = opts.fetchImpl ?? fetch;
    const authHeaders = await buildMulesoftAuthHeaders();
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // Parity with the /health client so Mule can distinguish prototype
        // traffic in both Experience-API flows.
        "X-Pause-Source": "pause-health.ai/prototype",
        ...authHeaders
      },
      cache: "no-store"
    });
    if (!res.ok) {
      throw new Error(`Mule /providers responded ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (
      typeof json !== "object" ||
      json === null ||
      !Array.isArray(json.providers)
    ) {
      throw new Error("Mule /providers response missing providers array");
    }
    return json as ProviderDirectoryResult;
  } finally {
    clearTimeout(timer);
  }
}

const warnedFailures = new Set<string>();

export function warnMulesoftProvidersDegradationOnce(
  context: string,
  err: unknown
): void {
  if (!isMulesoftProvidersLive()) return;
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  const bucket = `${context}::${name}::${msg.slice(0, 80)}`;
  if (warnedFailures.has(bucket)) return;
  warnedFailures.add(bucket);
  console.warn(
    `[mulesoft/providers] ${context} failed (dedup-once); degrading to mock:`,
    msg
  );
}

export function _resetProvidersWarnDedupForTests(): void {
  warnedFailures.clear();
}

export async function getProvidersPreferReal(
  query: ProvidersQuery,
  opts: LiveProvidersFetchOptions = {}
): Promise<{ source: "live" | "mock"; result: ProviderDirectoryResult }> {
  if (isMulesoftProvidersLive(opts.baseUrl)) {
    try {
      const live = await fetchLiveProviders(query, opts);
      if (live) return { source: "live", result: live };
    } catch (err) {
      warnMulesoftProvidersDegradationOnce("providers.fetch", err);
    }
  }
  return { source: "mock", result: queryProviderDirectory(query) };
}
