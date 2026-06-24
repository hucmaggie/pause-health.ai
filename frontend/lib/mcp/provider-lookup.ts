/**
 * MCP-host-driven ProviderLookup adapter.
 *
 * Implements the same `ProviderLookup` contract the Care Router
 * consumes (lib/care-router.ts), but resolves providers by invoking
 * `find_menopause_providers` on the MCP host instead of calling
 * /api/mulesoft/providers directly. The two paths return identical
 * shapes — the bridge is transparent to routing logic and the UI.
 *
 * When the host has zero remotes (e.g. PAUSE_MCP_HOST_LOOPBACK=off
 * with no PAUSE_MCP_HOST_REMOTES), the adapter falls back to the
 * direct getProvidersPreferReal call so we never regress.
 */
import type { ProviderLookup } from "../care-router";
import type { ProviderRecord } from "../mulesoft-mocks";
import { getProvidersPreferReal } from "../mulesoft/providers";
import type { MCPHost, MCPToolResult } from "./host";

type ProvidersToolPayload = {
  total?: number;
  returned?: number;
  providers?: Array<ProviderRecord & { distanceMiles?: number | null }>;
};

/**
 * Pull the JSON payload out of an MCP tool result's content array.
 * `tools.ts` returns two content blocks per call: a human-readable
 * summary first, then the JSON-stringified payload. Older callers
 * may emit just the JSON. Try both.
 */
function payloadFromContent(content: unknown): ProvidersToolPayload | null {
  if (!Array.isArray(content)) return null;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const block = content[i];
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = (block as { text: string }).text.trim();
      if (text.startsWith("{")) {
        try {
          return JSON.parse(text) as ProvidersToolPayload;
        } catch {
          /* try the next block */
        }
      }
    }
  }
  return null;
}

export type HostProviderLookupOptions = {
  /** Host to drive (per-request). Owned by the caller. */
  host: MCPHost;
  /**
   * Fallback when the host has no remotes or every remote errors.
   * Defaults to getProvidersPreferReal — matches the legacy behavior.
   */
  fallback?: ProviderLookup;
  /**
   * Optional hook that receives every host attempt for the agent
   * fabric trace. Never throws; observability only.
   */
  onAttempt?: (event: {
    remoteId: string | null;
    ok: boolean;
    error?: string;
  }) => void;
};

/**
 * Build a ProviderLookup backed by the MCP host. Returned shape is
 * intentionally identical to getProvidersPreferReal so the Care Router
 * cannot tell which path served the call.
 */
export function providerLookupViaMcpHost(
  opts: HostProviderLookupOptions
): ProviderLookup {
  const fallback = opts.fallback ?? getProvidersPreferReal;
  return async (query) => {
    if (opts.host.listRemotes().length === 0) {
      opts.onAttempt?.({ remoteId: null, ok: false, error: "no remotes" });
      return fallback(query);
    }
    const toolArgs: Record<string, unknown> = {
      menopauseOnly: query.menopauseOnly ?? true,
      limit: query.limit ?? 10
    };
    if (query.zip) toolArgs.zip = query.zip;
    if (query.insurance) toolArgs.insurance = query.insurance;
    const result: MCPToolResult | undefined = await opts.host.callTool({
      name: "find_menopause_providers",
      arguments: toolArgs
    });
    if (!result || !result.ok) {
      opts.onAttempt?.({
        remoteId: result?.remoteId ?? null,
        ok: false,
        error: result && "error" in result ? result.error : "no result"
      });
      return fallback(query);
    }
    const payload = payloadFromContent(result.content);
    if (!payload || !Array.isArray(payload.providers)) {
      opts.onAttempt?.({
        remoteId: result.remoteId,
        ok: false,
        error: "tool returned no parseable provider payload"
      });
      return fallback(query);
    }
    opts.onAttempt?.({ remoteId: result.remoteId, ok: true });
    // The tool is backed by /api/mulesoft/providers which already
    // honors `zipCentroid` (it lives in the directory itself, not in
    // the MCP call) — so the bridge surfaces `distanceMiles` on every
    // returned row whenever the underlying API supplies it.
    //
    // We label the source `live` only when the call resolved through
    // a non-loopback remote — loopback fronts the same mock the
    // direct-call path serves, so honest provenance is `mock`. This
    // keeps the rationale line on the routing decision truthful
    // (`(NPPES-derived directory)` vs `(live MuleSoft directory)`).
    const source: "live" | "mock" =
      result.remoteId === "loopback" ? "mock" : "live";
    return {
      source,
      result: {
        total: payload.total ?? payload.providers.length,
        providers: payload.providers
      }
    };
  };
}
