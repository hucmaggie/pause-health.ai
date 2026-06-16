/**
 * Live MuleSoft Experience-API client for /api/mulesoft/health.
 *
 * Mirrors the same prefer-real / degrade-to-mock pattern that
 * lib/salesforce/grounding.ts established for the Care Router's
 * grounding path. The two modules share three properties by design:
 *
 *   1. Configuration is a single env var (MULESOFT_HEALTH_BASE_URL).
 *      Unset = the prototype is mock-only; this module's fetch path
 *      never runs and no warnings are emitted.
 *   2. Any non-OK live response, network error, or timeout falls back
 *      to the mock silently from the caller's perspective. Failures
 *      are logged at WARN level, deduplicated by (context, error
 *      class, first 80 chars of message) so a persistent
 *      misconfiguration doesn't spam logs.
 *   3. The return shape (`{ source: "live" | "mock", bundle }`)
 *      makes the served bundle's provenance visible to callers, so
 *      the API route can surface it in response metadata and the
 *      Agent Fabric trace span knows whether to record a live or
 *      mock attribute.
 *
 * Phase 1 deliberately stays narrow: only the static FHIR Bundle
 * served by GET /health. Iteration 2 will extend this module to
 * the timeline / intake / providers endpoints, optionally via API
 * Manager policies (rate limit, client credentials).
 *
 * See docs/MULESOFT_RUNBOOK.md and docs/MULESOFT_PHASE_1_HANDOFF.md
 * for the deploy-side runbook this module is wired to receive.
 */

import { buildPatientTimelineBundle } from "../mulesoft-mocks";
import { buildMulesoftAuthHeaders } from "./auth";

/**
 * Subset of the bundle generator's output we type-guard on. The
 * mock and the live Mule app both produce a FHIR R5 Bundle, but
 * we only assume the minimal shape needed for the API route to
 * render a response.
 */
export type PauseHealthBundle = {
  resourceType: "Bundle";
  type: string;
  meta?: {
    lastUpdated?: string;
    source?: string;
  };
  entry: Array<Record<string, unknown>>;
};

export type LiveHealthFetchOptions = {
  /** Override the env-driven base URL (used by tests). */
  baseUrl?: string;
  /** Override the global fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /**
   * Override the abort timeout in ms. Defaults to 4_000 -- short
   * enough that a degraded Mule app doesn't stall the response,
   * long enough that a cold CloudHub worker has a chance to wake.
   */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * True when the prototype is configured to attempt the live Mule
 * Experience API. False (the default) means the API route serves
 * the mock without any network call -- the documented Phase 0
 * behavior.
 */
export function isMulesoftHealthLive(baseUrl?: string): boolean {
  const v = (baseUrl ?? process.env.MULESOFT_HEALTH_BASE_URL ?? "").trim();
  if (!v) return false;
  // Reject obvious misconfigurations cheaply before issuing a fetch.
  if (!/^https?:\/\//i.test(v)) return false;
  return true;
}

/**
 * One-shot fetch of the live Mule Experience-API /health endpoint.
 * Returns the parsed bundle on 2xx + JSON, or null on any failure.
 * Caller is responsible for falling back to the mock; this function
 * deliberately never throws past its own catch.
 */
export async function fetchLiveHealthBundle(
  opts: LiveHealthFetchOptions = {}
): Promise<PauseHealthBundle | null> {
  const baseUrl = (opts.baseUrl ?? process.env.MULESOFT_HEALTH_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) return null;
  if (!/^https?:\/\//i.test(baseUrl)) {
    warnMulesoftDegradationOnce(
      "health.live-fetch.baseurl",
      new Error(
        `MULESOFT_HEALTH_BASE_URL must start with http(s):// (got ${JSON.stringify(
          baseUrl
        )})`
      )
    );
    return null;
  }

  const url = `${baseUrl}/health`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const authHeaders = await buildMulesoftAuthHeaders();
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Pause-Source": "pause-health.ai/prototype",
        ...authHeaders
      },
      signal: controller.signal
    });

    if (!res.ok) {
      warnMulesoftDegradationOnce(
        "health.live-fetch.http",
        new Error(`HTTP ${res.status} from ${url}`)
      );
      return null;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      warnMulesoftDegradationOnce("health.live-fetch.parse", parseErr);
      return null;
    }

    const bundle = extractBundle(body);
    if (!bundle) {
      warnMulesoftDegradationOnce(
        "health.live-fetch.shape",
        new Error(
          "Live Mule response was 200 but did not contain a FHIR Bundle in expected shape"
        )
      );
      return null;
    }
    return bundle;
  } catch (err) {
    // Both fetch errors and aborts land here. The dedup bucket
    // separates them by err.name (AbortError vs TypeError vs ...).
    warnMulesoftDegradationOnce("health.live-fetch.transport", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mule apps in this prototype may return either:
 *   (a) the bare FHIR Bundle, or
 *   (b) the same { meta, bundle } envelope the mock route returns,
 *       so the Mule developer can copy-paste the mock output as
 *       a starting payload.
 * Both shapes resolve to the same bundle for downstream consumers.
 */
function extractBundle(body: unknown): PauseHealthBundle | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if (rec.resourceType === "Bundle" && Array.isArray(rec.entry)) {
    return rec as unknown as PauseHealthBundle;
  }
  const inner = rec.bundle;
  if (
    inner &&
    typeof inner === "object" &&
    (inner as Record<string, unknown>).resourceType === "Bundle" &&
    Array.isArray((inner as Record<string, unknown>).entry)
  ) {
    return inner as unknown as PauseHealthBundle;
  }
  return null;
}

/**
 * Convenience wrapper: prefers the live bundle, falls back to the
 * deterministic mock. Returns the provenance alongside so the API
 * route can surface it in response metadata + the Agent Fabric
 * trace can record live vs mock.
 */
export async function getHealthBundlePreferLive(
  opts: LiveHealthFetchOptions = {}
): Promise<{
  source: "live" | "mock";
  bundle: PauseHealthBundle;
  liveUrl?: string;
}> {
  if (isMulesoftHealthLive(opts.baseUrl)) {
    const live = await fetchLiveHealthBundle(opts);
    if (live) {
      const baseUrl =
        (opts.baseUrl ?? process.env.MULESOFT_HEALTH_BASE_URL ?? "")
          .trim()
          .replace(/\/+$/, "");
      return { source: "live", bundle: live, liveUrl: `${baseUrl}/health` };
    }
  }
  return {
    source: "mock",
    bundle: buildPatientTimelineBundle() as unknown as PauseHealthBundle
  };
}

// ---------------------------------------------------------------------------
// Warn-once log dedup, mirroring lib/salesforce/grounding.ts
// ---------------------------------------------------------------------------

const warnedFailures = new Set<string>();

export function warnMulesoftDegradationOnce(
  context: string,
  err: unknown
): void {
  // Intentional silent fallback when env vars are unset: the
  // prototype is mock-only by design and the live module's
  // failure path should not emit warnings the user didn't ask for.
  if (!process.env.MULESOFT_HEALTH_BASE_URL) return;

  const errMessage = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : "Unknown";
  const bucket = `${context}::${errName}::${errMessage.slice(0, 80)}`;
  if (warnedFailures.has(bucket)) return;
  warnedFailures.add(bucket);
  console.warn(
    `[mulesoft] ${context} failed (dedup-once per failure category); degrading to mock:`,
    errMessage
  );
}

/** Test-only: clear the dedup set so a test can re-trigger the warning. */
export function _resetMulesoftWarnDedupForTests(): void {
  warnedFailures.clear();
}
