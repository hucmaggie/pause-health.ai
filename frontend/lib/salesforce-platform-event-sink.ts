/**
 * Salesforce Platform Event sink — Agent Fabric trace egress.
 *
 * Honestly-labeled implementation of audit-page gap #3.
 *
 * IMPORTANT NAMING NOTE. The audit page originally called this
 * "Agent Fabric event-monitoring trace export" with the implication
 * that we'd write into Salesforce's Real-Time Event Monitoring
 * stream. That is NOT what this module does, and the audit-page
 * wording has been corrected in the same commit that introduced
 * this file. Real-Time Event Monitoring's event catalog (LoginEvent,
 * ApiEvent, LightningUriEvent, etc. — ~50 types) is
 * Salesforce-platform-internal. External apps cannot define a new
 * RTEM event type and cannot POST records into the RTEM stream.
 * Pub/Sub API's own comparison table lists RTEM under SUBSCRIBE
 * capabilities and "platform events" under PUBLISH capabilities —
 * the partner-facing pattern is the latter.
 *
 * What this module DOES do: when configured, post each agent-fabric
 * span as a Salesforce **custom Platform Event** record via REST
 * sObjects. A customer-org admin defines a `Pause_Agent_Trace__e`
 * Platform Event with the field shape this module emits, and then
 * subscribes (Flow, Apex, Pub/Sub gRPC) to ingest the records into
 * whatever audit pipeline they want — Transaction Security
 * policies, a custom audit object, Shield Event Monitoring stream
 * transforms via Flow, etc.
 *
 * Authoritative sources:
 *   - https://developer.salesforce.com/docs/platform/pub-sub-api/guide/intro.html
 *   - https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_api.htm
 *
 * Auth: OAuth 2.0 Client Credentials grant against a Connected App
 * dedicated to this sink. We use Client Credentials (not the PKCE
 * External Client App from `salesforce-headless360.ts`) because
 * trace events fire server-side from API routes that don't have a
 * signed-in user; the events are attributed to the Connected App's
 * integration user, which is then mapped onto Pause's
 * Agent_Fabric_Agent__c records on the Salesforce side.
 *
 * Behavior:
 *   - Always non-blocking. The sink runs as a fire-and-forget
 *     Promise — agent-fabric routes never wait on it, never throw
 *     when it fails. Failures are logged to stderr and counted in
 *     a process-local error tally exposed by the /config route.
 *   - Token cached for `expires_in - 60s` (Salesforce default 7200s).
 *   - Skipped when env vars unset. /config returns "designed".
 */

export type SfPlatformEventSinkConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /**
   * API name of the Platform Event sObject. Must end with `__e`
   * (Salesforce custom-event suffix). Default
   * `Pause_Agent_Trace__e`.
   */
  eventApiName: string;
  /**
   * Salesforce REST API version. Default `v60.0` (broadly supported
   * across orgs as of 2026).
   */
  apiVersion: string;
};

const ENV_KEYS = {
  baseUrl: "SF_PLATFORM_EVENT_BASE_URL",
  clientId: "SF_PLATFORM_EVENT_CLIENT_ID",
  clientSecret: "SF_PLATFORM_EVENT_CLIENT_SECRET",
  eventApiName: "SF_PLATFORM_EVENT_API_NAME",
  apiVersion: "SF_PLATFORM_EVENT_API_VERSION",
  verified: "SF_PLATFORM_EVENT_VERIFIED"
} as const;

function readEnv(key: string): string {
  const v = process.env[key];
  return typeof v === "string" ? v.trim() : "";
}

export function getSfPlatformEventSinkConfig(): SfPlatformEventSinkConfig | null {
  const baseUrl = readEnv(ENV_KEYS.baseUrl);
  const clientId = readEnv(ENV_KEYS.clientId);
  const clientSecret = readEnv(ENV_KEYS.clientSecret);
  const eventApiName = readEnv(ENV_KEYS.eventApiName) || "Pause_Agent_Trace__e";
  const apiVersion = readEnv(ENV_KEYS.apiVersion) || "v60.0";

  if (!baseUrl || !clientId || !clientSecret) return null;
  if (!/^https:\/\//i.test(baseUrl)) {
    console.warn(
      `[sf-platform-event-sink] ${ENV_KEYS.baseUrl} must be https://; got ${JSON.stringify(baseUrl)}. Treating as unset.`
    );
    return null;
  }
  if (!/__e$/.test(eventApiName)) {
    console.warn(
      `[sf-platform-event-sink] ${ENV_KEYS.eventApiName} must end with __e (Platform Event suffix); got ${JSON.stringify(eventApiName)}. Treating as unset.`
    );
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    eventApiName,
    apiVersion
  };
}

export function isSfPlatformEventSinkConfigured(): boolean {
  return getSfPlatformEventSinkConfig() !== null;
}

export type SfPlatformEventSinkStatus = "designed" | "prototype" | "shipped";

export function getSfPlatformEventSinkStatus(): SfPlatformEventSinkStatus {
  if (!isSfPlatformEventSinkConfigured()) return "designed";
  const verified = readEnv(ENV_KEYS.verified).toLowerCase();
  if (verified === "1" || verified === "true" || verified === "on") {
    return "shipped";
  }
  return "prototype";
}

// -----------------------------------------------------------------------------
// Token cache. Module-scoped on purpose; survives within a single Vercel
// invocation (typically one warm Lambda) so we don't re-mint a token
// on every span. Falls back gracefully across cold starts.
// -----------------------------------------------------------------------------

type CachedToken = {
  accessToken: string;
  instanceUrl: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

// Process-local counters exposed by the /config route so an operator
// can confirm "yes, traces are flowing" without scraping logs.
let eventsAttempted = 0;
let eventsSucceeded = 0;
let eventsFailed = 0;
let lastErrorMessage: string | null = null;

export function getSinkCounters(): {
  attempted: number;
  succeeded: number;
  failed: number;
  lastError: string | null;
} {
  return {
    attempted: eventsAttempted,
    succeeded: eventsSucceeded,
    failed: eventsFailed,
    lastError: lastErrorMessage
  };
}

export function _resetSinkCountersForTests(): void {
  eventsAttempted = 0;
  eventsSucceeded = 0;
  eventsFailed = 0;
  lastErrorMessage = null;
  cachedToken = null;
}

async function fetchToken(
  cfg: SfPlatformEventSinkConfig,
  fetchImpl: typeof fetch
): Promise<CachedToken> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret
  });
  const res = await fetchImpl(`${cfg.baseUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Salesforce token endpoint ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
    );
  }
  const payload = JSON.parse(text) as {
    access_token?: string;
    instance_url?: string;
    expires_in?: string;
  };
  if (!payload.access_token || !payload.instance_url) {
    throw new Error(
      `Salesforce token response missing access_token or instance_url: ${text.slice(0, 200)}`
    );
  }
  const lifetimeSec = payload.expires_in
    ? parseInt(payload.expires_in, 10)
    : 7200;
  cachedToken = {
    accessToken: payload.access_token,
    instanceUrl: payload.instance_url.replace(/\/+$/, ""),
    expiresAtMs: Date.now() + lifetimeSec * 1000
  };
  return cachedToken;
}

// -----------------------------------------------------------------------------
// Mapping: TraceSpan → Pause_Agent_Trace__e record.
// -----------------------------------------------------------------------------
//
// Salesforce custom-field naming uses `__c` for object fields and `__e`
// for the event sObject itself. The customer-org admin's checklist in
// docs/SF_PLATFORM_EVENT_SINK_RUNBOOK.md lists exactly these fields so
// the schema is reproducible. Attributes are JSON-stringified into a
// long-text field; doing it any other way would require the customer
// admin to define a custom field per attribute key, which doesn't
// scale across Pause routes.

export type AgentTraceEventPayload = {
  Span_Id__c: string;
  Task_Id__c: string;
  Parent_Span_Id__c?: string;
  Agent_Id__c: string;
  Operation__c: string;
  Protocol__c: string;
  Status__c: string;
  Duration_Ms__c?: number;
  Started_At__c: string;
  Attributes_Json__c?: string;
};

export type SpanLike = {
  id: string;
  taskId: string;
  parentSpanId?: string;
  agentId: string;
  operation: string;
  protocol: string;
  status: string;
  durationMs?: number;
  startedAt: string;
  attributes?: Record<string, unknown>;
};

export function spanToEventPayload(span: SpanLike): AgentTraceEventPayload {
  const payload: AgentTraceEventPayload = {
    Span_Id__c: span.id,
    Task_Id__c: span.taskId,
    Agent_Id__c: span.agentId,
    Operation__c: span.operation,
    Protocol__c: span.protocol,
    Status__c: span.status,
    Started_At__c: span.startedAt
  };
  if (span.parentSpanId) payload.Parent_Span_Id__c = span.parentSpanId;
  if (typeof span.durationMs === "number") {
    payload.Duration_Ms__c = span.durationMs;
  }
  if (span.attributes && Object.keys(span.attributes).length > 0) {
    try {
      // Salesforce Platform Event long-text fields cap at 131,072 chars;
      // we truncate well below that to stay polite. Truncation is
      // logged into the payload itself so a subscriber can see when
      // it happened.
      const json = JSON.stringify(span.attributes);
      payload.Attributes_Json__c =
        json.length > 30_000
          ? `${json.slice(0, 30_000)}…[truncated;${json.length}]`
          : json;
    } catch {
      payload.Attributes_Json__c = '{"_serialize_error":true}';
    }
  }
  return payload;
}

// -----------------------------------------------------------------------------
// The actual sink. Best-effort; never throws into the caller.
// -----------------------------------------------------------------------------

export type EmitOptions = {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override the config; primarily for tests. */
  config?: SfPlatformEventSinkConfig | null;
};

/**
 * Fire-and-forget Platform Event emit. Returns a Promise so tests can
 * await it, but callers in production agent-fabric paths should NOT
 * await — the agent fabric must not delay routing on telemetry.
 *
 * Resolves to:
 *   - `"skipped"` when no config (designed mode).
 *   - `"ok"` when Salesforce returned 201 + the published-event id.
 *   - `"error"` when any step failed. The error is logged + counted.
 */
export async function emitSpanEvent(
  span: SpanLike,
  opts: EmitOptions = {}
): Promise<"skipped" | "ok" | "error"> {
  const cfg = opts.config === undefined ? getSfPlatformEventSinkConfig() : opts.config;
  if (!cfg) return "skipped";
  const fetchImpl = opts.fetchImpl ?? fetch;
  eventsAttempted += 1;
  try {
    const token = await fetchToken(cfg, fetchImpl);
    const url = `${token.instanceUrl}/services/data/${cfg.apiVersion}/sobjects/${cfg.eventApiName}/`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token.accessToken}`
      },
      body: JSON.stringify(spanToEventPayload(span))
    });
    if (!res.ok) {
      const text = await res.text();
      // 401 here usually means the cached token was revoked under us.
      // Wipe the cache so the next call re-mints; don't retry inline
      // because the caller is fire-and-forget.
      if (res.status === 401) cachedToken = null;
      throw new Error(
        `sObjects POST ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
      );
    }
    eventsSucceeded += 1;
    return "ok";
  } catch (err) {
    eventsFailed += 1;
    lastErrorMessage = (err as Error).message;
    // stderr so the failure surfaces in Vercel function logs.
    console.warn(
      `[sf-platform-event-sink] emit failed: ${lastErrorMessage}`
    );
    return "error";
  }
}

// -----------------------------------------------------------------------------
// Public config (status probe). Mirrors the other Headless 360 seams.
// -----------------------------------------------------------------------------

export type SfPlatformEventSinkPublicConfig = {
  status: SfPlatformEventSinkStatus;
  /** Present when status !== "designed". */
  eventApiName?: string;
  /** Present when status !== "designed". */
  apiVersion?: string;
  /** Always present; useful for an operator confirming flow. */
  counters: {
    attempted: number;
    succeeded: number;
    failed: number;
    lastError: string | null;
  };
};

export function toPublicConfig(): SfPlatformEventSinkPublicConfig {
  const status = getSfPlatformEventSinkStatus();
  const counters = getSinkCounters();
  if (status === "designed") return { status, counters };
  const cfg = getSfPlatformEventSinkConfig();
  if (!cfg) return { status: "designed", counters };
  return {
    status,
    eventApiName: cfg.eventApiName,
    apiVersion: cfg.apiVersion,
    counters
  };
}
