import { NextResponse } from "next/server";
import { buildPatientTimelineBundle } from "../../../../lib/mulesoft-mocks";
import {
  getHealthBundlePreferLive,
  isMulesoftHealthLive
} from "../../../../lib/mulesoft/health";

/**
 * Pause-Health.ai Experience-tier endpoint.
 *
 * Behavior:
 *
 *   - When MULESOFT_HEALTH_BASE_URL is set and reachable, this route
 *     proxies to the live MuleSoft Experience API deployed on
 *     CloudHub 2.0 (or any equivalent runtime). Response metadata
 *     reports `_source: "live-mulesoft"` and the upstream URL.
 *
 *   - When MULESOFT_HEALTH_BASE_URL is unset, OR when the live call
 *     fails (network, timeout, non-2xx, bad shape), the route
 *     transparently degrades to the deterministic FHIR Bundle in
 *     `lib/mulesoft-mocks.ts`. Response metadata reports
 *     `_source: "mock-fallback"` (live mode but the call failed) or
 *     `_source: "mock"` (live mode never configured).
 *
 * In production the live URL is the Pause Experience API
 * `pause-patient-bundle-process-api` on Anypoint Runtime Fabric or
 * CloudHub 2.0. The bundle generator is shared with
 * `/api/mulesoft/patient/[id]/timeline` and the Pause MCP server
 * under `mcp/` -- see lib/mulesoft-mocks.ts.
 *
 * Cache for 5 minutes -- the payload is deterministic when served
 * by either the mock or by the static-payload Phase 1 Mule app.
 * Iteration 2 will introduce upstream-derived data, at which point
 * this cache header should be revisited.
 *
 * See docs/MULESOFT_RUNBOOK.md and docs/MULESOFT_PHASE_1_HANDOFF.md
 * for the deploy-side runbook.
 */

const MOCK_BUNDLE = buildPatientTimelineBundle();
const MOCK_ENTRY_COUNT = MOCK_BUNDLE.entry.length;

const BASE_META = {
  _note:
    "Pause-Health.ai Experience API. In production this URL is served by the MuleSoft pause-patient-bundle-process-api on Anypoint Runtime Fabric / CloudHub 2.0. See docs/mulesoft-integration.md.",
  _generatedBy: "next.js mock @ /api/mulesoft/health",
  _bundleEntries: MOCK_ENTRY_COUNT,
  _mcpToolEquivalent: "get_patient_timeline"
};

export async function GET() {
  // Fast path: not configured for live; serve the mock without
  // touching the network. This is what every Vercel preview, CI
  // run, and unconfigured dev environment hits, and is the public
  // default for the prototype.
  if (!isMulesoftHealthLive()) {
    return jsonResponse({
      meta: { ...BASE_META, _source: "mock" },
      bundle: MOCK_BUNDLE
    });
  }

  // Configured for live: prefer the real Mule, fall back to the
  // mock on any failure. `getHealthBundlePreferLive` performs its
  // own warn-once on failures so we don't double-log here.
  const { source, bundle, liveUrl } = await getHealthBundlePreferLive();
  if (source === "live") {
    return jsonResponse({
      meta: {
        ...BASE_META,
        _source: "live-mulesoft",
        _liveUrl: liveUrl,
        _generatedBy: "MuleSoft pause-patient-bundle-process-api (proxied)",
        _bundleEntries: bundle.entry.length
      },
      bundle
    });
  }

  return jsonResponse({
    meta: {
      ...BASE_META,
      _source: "mock-fallback",
      _liveAttempted: true,
      _liveUrl:
        (process.env.MULESOFT_HEALTH_BASE_URL ?? "")
          .trim()
          .replace(/\/+$/, "") + "/health"
    },
    bundle: MOCK_BUNDLE
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
