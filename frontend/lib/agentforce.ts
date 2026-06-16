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
    "This public prototype shows the intake flow without a connected Salesforce org. Provider deployments run on a live Agentforce Service Agent backed by Service Cloud."
} as const;
