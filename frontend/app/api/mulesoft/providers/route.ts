import { NextResponse } from "next/server";
import {
  getProvidersPreferReal,
  isMulesoftProvidersLive
} from "../../../../lib/mulesoft/providers";
import { queryProviderDirectory } from "../../../../lib/mulesoft-mocks";
import { lookupZipCentroid } from "../../../../lib/zip-centroids";

/**
 * Pause-Health.ai Experience-tier endpoint: GET /api/mulesoft/providers
 *
 *   ?zip=92614&menopause=true&limit=10
 *
 * Behavior (mirrors /api/mulesoft/health):
 *
 *   - When MULESOFT_PROVIDERS_BASE_URL is set and reachable, proxies to
 *     the live MuleSoft /providers endpoint on CloudHub 2.0. Response
 *     meta reports _source: "live-mulesoft".
 *
 *   - When MULESOFT_PROVIDERS_BASE_URL is unset, or when the live call
 *     fails, degrades transparently to the deterministic mock in
 *     lib/mulesoft-mocks.ts. Meta reports _source: "mock" or
 *     _source: "mock-fallback" (live was configured but failed).
 *
 * The MCP server exposes this as the `find_menopause_providers` tool.
 * See docs/MULESOFT_RUNBOOK.md for the deploy runbook.
 */

const MOCK_BASE = queryProviderDirectory({});
const BASE_META = {
  _note:
    "Pause-Health.ai provider directory Experience API. In production this is served by the MuleSoft pause-provider-directory-experience-api. See docs/mulesoft-integration.md.",
  _generatedBy: "next.js mock @ /api/mulesoft/providers",
  _mcpToolEquivalent: "find_menopause_providers",
  _totalProvidersInMock: MOCK_BASE.providers.length
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zipRaw = searchParams.get("zip") ?? undefined;
  const zip = zipRaw && /^\d{3,5}$/.test(zipRaw) ? zipRaw : undefined;
  const menopauseOnly =
    searchParams.get("menopause") === "true" ||
    searchParams.get("menopauseOnly") === "true";
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw) || 0)) : undefined;
  // Graceful fallback is on by default for the agent-facing Experience API:
  // a patient outside the certified-provider footprint still gets a useful,
  // honestly-labeled answer (nearby relevant or national telehealth specialists)
  // instead of an empty result. Pass ?fallback=false to force strict behavior.
  const fallback = searchParams.get("fallback") !== "false";

  // When the patient ZIP resolves to a Census ZCTA centroid, the directory
  // ranks providers by distance from that centroid (Haversine miles). No
  // centroid → score-only ranking, no errors. Skipped via ?distance=false
  // for callers that need the prior score-only ordering.
  const distanceParam = searchParams.get("distance") !== "false";
  const zipCentroid = distanceParam ? lookupZipCentroid(zip) : null;

  const query = { zip, menopauseOnly, limit, fallback, zipCentroid };

  if (!isMulesoftProvidersLive()) {
    const result = queryProviderDirectory(query);
    return jsonResponse({ meta: { ...BASE_META, _source: "mock" }, ...result });
  }

  const { source, result } = await getProvidersPreferReal(query);
  if (source === "live") {
    return jsonResponse({
      meta: {
        ...BASE_META,
        _source: "live-mulesoft",
        _liveUrl:
          (process.env.MULESOFT_PROVIDERS_BASE_URL ?? "")
            .trim()
            .replace(/\/+$/, "") + "/providers",
        _generatedBy: "MuleSoft pause-provider-directory-experience-api (proxied)"
      },
      ...result
    });
  }

  return jsonResponse({
    meta: {
      ...BASE_META,
      _source: "mock-fallback",
      _liveAttempted: true,
      _liveUrl:
        (process.env.MULESOFT_PROVIDERS_BASE_URL ?? "")
          .trim()
          .replace(/\/+$/, "") + "/providers"
    },
    ...result
  });
}

function jsonResponse(body: Record<string, unknown>) {
  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
    }
  });
}
