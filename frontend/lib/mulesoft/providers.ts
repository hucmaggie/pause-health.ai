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
import { getMulesoftBearerToken } from "./auth";

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

export async function fetchLiveProviders(
  query: { zip?: string; menopauseOnly?: boolean; limit?: number },
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

  const url = `${baseUrl.replace(/\/$/, "")}/providers?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const fetchFn = opts.fetchImpl ?? fetch;
    const jwtToken = await getMulesoftBearerToken();
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(jwtToken
          ? { Authorization: `Bearer ${jwtToken}` }
          : process.env.MULESOFT_CLIENT_ID
          ? {
              Authorization: "Basic " + Buffer.from(
                `${process.env.MULESOFT_CLIENT_ID}:${process.env.MULESOFT_CLIENT_SECRET ?? ""}`
              ).toString("base64"),
              "client_id": process.env.MULESOFT_CLIENT_ID,
              "client_secret": process.env.MULESOFT_CLIENT_SECRET ?? "",
            }
          : {})
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
  query: { zip?: string; menopauseOnly?: boolean; limit?: number },
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
