/**
 * Salesforce Agentforce / Embedded Messaging configuration.
 *
 * Pause-Health.ai's intake demo can be backed by either:
 *
 *   1. A real Salesforce Embedded Messaging for Web deployment running an
 *      Agentforce Service Agent. This is GA Salesforce surface area
 *      (Enhanced Chat v2 inline mode) and is the path most customer
 *      health systems already deploy.
 *
 *   2. A Pause-branded scripted fallback that mirrors the same
 *      conversational pattern. Used when the four NEXT_PUBLIC_AGENTFORCE_*
 *      env vars are not all present.
 *
 * The four required values come from the Salesforce Setup screen for the
 * Embedded Service Deployment under: Setup → Embedded Service Deployments →
 * <your deployment> → Code Snippet. The snippet has the exact shape:
 *
 *   embeddedservice_bootstrap.init(
 *     '<ORG_ID>',
 *     '<DEPLOYMENT_API_NAME>',
 *     '<SITE_URL>',
 *     { scrt2URL: '<SCRT2_URL>' }
 *   );
 *
 * All four values are public — they are designed to ship in client JS, are
 * scoped to the specific deployment, and do not grant API access. They are
 * therefore safe to expose as NEXT_PUBLIC_ vars on the Vercel-hosted site.
 *
 * Sensitive items (Connected App secrets, Frontdoor URLs for the Conversation
 * Client SDK, employee-agent credentials) MUST NOT live in this module.
 */

export type AgentforceConfig = {
  orgId: string;
  deploymentApiName: string;
  siteUrl: string;
  scrt2Url: string;
  /**
   * URL of bootstrap.min.js for this deployment. Derived from siteUrl if
   * not explicitly set; allows a customer to point at a different CDN if
   * their Salesforce instance is hosted somewhere non-standard.
   */
  bootstrapScriptUrl: string;
  language: string;
};

const ENV_KEYS = {
  orgId: "NEXT_PUBLIC_AGENTFORCE_ORG_ID",
  deploymentApiName: "NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME",
  siteUrl: "NEXT_PUBLIC_AGENTFORCE_SITE_URL",
  scrt2Url: "NEXT_PUBLIC_AGENTFORCE_SCRT2_URL"
} as const;

function readEnv(key: string): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Return a fully-typed config if all four required env vars are present
 * and non-empty. Returns null when any one is missing so callers can fall
 * back to the scripted intake without throwing.
 */
export function getAgentforceConfig(): AgentforceConfig | null {
  const orgId = readEnv(ENV_KEYS.orgId);
  const deploymentApiName = readEnv(ENV_KEYS.deploymentApiName);
  const siteUrl = readEnv(ENV_KEYS.siteUrl);
  const scrt2Url = readEnv(ENV_KEYS.scrt2Url);

  if (!orgId || !deploymentApiName || !siteUrl || !scrt2Url) {
    return null;
  }

  const normalizedSiteUrl = siteUrl.replace(/\/+$/, "");

  return {
    orgId,
    deploymentApiName,
    siteUrl: normalizedSiteUrl,
    scrt2Url: scrt2Url.replace(/\/+$/, ""),
    bootstrapScriptUrl: `${normalizedSiteUrl}/assets/js/bootstrap.min.js`,
    language: "en_US"
  };
}

export function isAgentforceConfigured(): boolean {
  return getAgentforceConfig() !== null;
}

/**
 * Defensive normalization for hidden prechat fields before they reach the
 * Salesforce Embedded Messaging SDK.
 *
 * Trims keys and values, drops empty / whitespace-only entries, and returns
 * null when nothing usable remains so the caller can skip the
 * setHiddenPrechatFields call entirely. This matters because the V2 SDK now
 * transmits valid registered fields to SCRT2 (the empty-Proxy bug is fixed),
 * so an empty string handed for a REGISTERED field (e.g. Patient_Zip) would
 * land on MessagingSession and overwrite real context with blank — worse than
 * never sending it. Keeping this pure makes the contract unit-testable away
 * from the SDK side effects.
 */
export function sanitizePrechatFields(
  fields: Record<string, string> | null | undefined
): Record<string, string> | null {
  if (!fields) return null;
  const cleaned: Record<string, string> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const k = typeof key === "string" ? key.trim() : "";
    const v = typeof raw === "string" ? raw.trim() : "";
    if (k && v) cleaned[k] = v;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/**
 * How long to wait after init() before warning the user that the launcher
 * hasn't appeared. The most common production cause is a deployment that
 * hasn't been Published, or a host domain missing from the Embedded Service
 * allow-list — both leave init() succeeding but onEmbeddedMessagingReady
 * never firing. We surface an actionable hint rather than spinning forever.
 */
export const AGENTFORCE_READY_TIMEOUT_MS = 12_000;

/**
 * Human-readable copy paired with the Agentforce UI. Centralized so the
 * embed, the fallback, and the investor page stay consistent.
 */
export const AGENTFORCE_COPY = {
  brandedTitle: "Pause Intake Assistant",
  brandedSubtitle:
    "A guided menopause intake conversation. The assistant captures symptoms, screens for red flags, and hands the structured record to your care team.",
  fallbackBadge: "Prototype experience",
  productionBadge: "Live agent",
  fallbackNote:
    "This public prototype shows the intake flow without a connected Salesforce org. Provider deployments run on a live Agentforce Service Agent backed by Service Cloud.",
  loadingLabel: "Loading the live Pause Intake agent…",
  connectingLabel: "Connecting to Salesforce Agentforce Service Cloud…",
  // Shown when init() succeeded but onEmbeddedMessagingReady never fired
  // within AGENTFORCE_READY_TIMEOUT_MS. Deliberately honest: the component
  // cannot read the cross-origin fetch/frame failures directly, so it names
  // the two org-side causes in likelihood order and points the operator at
  // the DevTools Console strings that disambiguate them.
  slowLead:
    "Still connecting to Salesforce Agentforce — the chat launcher hasn't appeared yet. init() succeeded, but the SDK never fired onEmbeddedMessagingReady. That is almost always an org-side configuration issue, not a bug on this page.",
  slowCauseBootstrap:
    "The bootstrap.min.js script may not have finished loading — check the Network tab for a 404 or a blocked request on the deployment's /assets/js/bootstrap.min.js.",
  slowCauseUnpublished:
    "The Embedded Service deployment {deployment} may not have been re-Published after its last change. A stale published config loads but never signals ready. Re-Publish it (Setup → Embedded Service Deployments) and wait ~5–15 min for CDN propagation.",
  slowCauseCors:
    "This page's origin ({origin}) may be missing from the Experience site's CORS allow-list and Trusted Sites for Frames (the frame-ancestors CSP). Add it in Experience Builder → Settings → Security & Privacy, then re-Publish the site.",
  slowDevtools:
    'To confirm which one it is, open DevTools → Console on this page and look for "CORS policy", "frame-ancestors", or "Error loading configuration settings" — whichever appears pinpoints the cause above.',
  bootstrapLoadFailed:
    "Failed to load Salesforce Embedded Messaging bootstrap from {url}.",
  initErrorFallback:
    "Salesforce Embedded Messaging dispatched an initialization error.",
  genericLoadFailure:
    "The live agent could not load. Please refresh, or contact your Pause-Health.ai administrator."
} as const;

/**
 * DevTools Console substrings an operator should grep for when the launcher
 * fails to appear. Each maps 1:1 to a known Salesforce failure mode
 * documented in docs/PHASE_3_RUNBOOK.md.
 */
export const AGENTFORCE_CONSOLE_SIGNATURES = [
  "CORS policy",
  "frame-ancestors",
  "Error loading configuration settings"
] as const;

/**
 * Shape of the `detail` payload the V2 SDK attaches to its error
 * CustomEvents (onEmbeddedMessagingInitError / onEmbeddedMessagingBootstrapError).
 * The SDK is not strongly typed on the window, so every field is `unknown`
 * and coerced defensively — we never trust its shape.
 */
export type AgentforceErrorDetail =
  | {
      message?: unknown;
      code?: unknown;
      reason?: unknown;
      error?: unknown;
    }
  | null
  | undefined;

export type AgentforceSurfacedError = {
  message: string;
  code: string | null;
};

function coerceDiagnosticString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Turn a raw SDK error-event `detail` into a specific, user-facing message
 * plus an optional error code. Reads `detail.message` (the field the SDK
 * populates most often), then `detail.reason`, then a nested `detail.error`
 * object, and finally falls back to a supplied generic string. Pure so the
 * embed's error path is unit-testable away from the DOM.
 */
export function describeAgentforceError(
  detail: AgentforceErrorDetail,
  fallbackMessage: string
): AgentforceSurfacedError {
  if (!detail || typeof detail !== "object") {
    return { message: fallbackMessage, code: null };
  }
  const nested =
    detail.error && typeof detail.error === "object"
      ? (detail.error as { message?: unknown; code?: unknown })
      : null;
  const message =
    coerceDiagnosticString(detail.message) ??
    coerceDiagnosticString(detail.reason) ??
    (nested ? coerceDiagnosticString(nested.message) : null) ??
    fallbackMessage;
  const code =
    coerceDiagnosticString(detail.code) ??
    (nested ? coerceDiagnosticString(nested.code) : null);
  return { message, code };
}

/** Render an AgentforceSurfacedError as a single display string. */
export function formatAgentforceError(
  surfaced: AgentforceSurfacedError
): string {
  return surfaced.code
    ? `${surfaced.message} (code: ${surfaced.code})`
    : surfaced.message;
}

/** Extract just the host from a URL, or null if it can't be parsed. */
export function hostFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export type AgentforceSlowDiagnostic = {
  lead: string;
  /** Likely causes in descending order of probability. */
  causes: string[];
  devtoolsHint: string;
};

/**
 * Build the enriched, ranked-cause hint shown when the ready watchdog fires.
 * Order: (optional) bootstrap-didn't-load, then stale/unpublished deployment,
 * then missing CORS / Trusted-Sites-for-Frames origin.
 */
export function buildAgentforceSlowDiagnostic(params: {
  deploymentApiName: string;
  origin: string;
  bootstrapLoaded: boolean;
}): AgentforceSlowDiagnostic {
  const deployment = params.deploymentApiName || "(unknown deployment)";
  const origin = params.origin || "this origin";
  const causes: string[] = [];
  if (!params.bootstrapLoaded) {
    causes.push(AGENTFORCE_COPY.slowCauseBootstrap);
  }
  causes.push(AGENTFORCE_COPY.slowCauseUnpublished.replace("{deployment}", deployment));
  causes.push(AGENTFORCE_COPY.slowCauseCors.replace("{origin}", origin));
  return {
    lead: AGENTFORCE_COPY.slowLead,
    causes,
    devtoolsHint: AGENTFORCE_COPY.slowDevtools
  };
}

/**
 * The single structured object logged via console.warn when the launcher
 * times out, so an operator has one line to copy. Intentionally logs only
 * public deployment metadata (host names + deployment api name + this page's
 * origin) — never the full config or any secret.
 */
export type AgentforceTimeoutDiagnostic = {
  event: "agentforce-launcher-timeout";
  deploymentApiName: string;
  siteUrlHost: string | null;
  scrt2Host: string | null;
  origin: string;
  elapsedMs: number;
  bootstrapLoaded: boolean;
  likelyCauses: string[];
  checkConsoleFor: readonly string[];
};

export function buildAgentforceTimeoutDiagnostic(params: {
  config: AgentforceConfig;
  origin: string;
  elapsedMs: number;
  bootstrapLoaded: boolean;
}): AgentforceTimeoutDiagnostic {
  const { config, origin, elapsedMs, bootstrapLoaded } = params;
  return {
    event: "agentforce-launcher-timeout",
    deploymentApiName: config.deploymentApiName,
    siteUrlHost: hostFromUrl(config.siteUrl),
    scrt2Host: hostFromUrl(config.scrt2Url),
    origin,
    elapsedMs,
    bootstrapLoaded,
    likelyCauses: buildAgentforceSlowDiagnostic({
      deploymentApiName: config.deploymentApiName,
      origin,
      bootstrapLoaded
    }).causes,
    checkConsoleFor: AGENTFORCE_CONSOLE_SIGNATURES
  };
}
