import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSinkCountersForTests,
  emitSpanEvent,
  getSfPlatformEventSinkConfig,
  getSfPlatformEventSinkStatus,
  getSinkCounters,
  isSfPlatformEventSinkConfigured,
  spanToEventPayload,
  toPublicConfig,
  type SfPlatformEventSinkConfig,
  type SpanLike
} from "./salesforce-platform-event-sink";

/**
 * Tests for the Salesforce Platform Event sink (audit gap #3).
 *
 * Invariants pinned here:
 *   1. Env unset → status "designed", null config, emit short-
 *      circuits to "skipped", counters untouched.
 *   2. Required env set + well-formed → status "prototype", typed
 *      config. emit goes through the token + sObjects POST path.
 *   3. SF_PLATFORM_EVENT_VERIFIED=true (and provisioned) → "shipped".
 *   4. Malformed env (non-https baseUrl, non-__e event name) degrades
 *      to null with a console.warn — does NOT throw, does NOT 5xx
 *      the agent-fabric routes that import this module.
 *   5. spanToEventPayload maps every field; truncates Attributes_Json__c
 *      sanely; handles unserialisable values.
 *   6. emitSpanEvent never throws on Salesforce errors; counters
 *      reflect the outcome.
 */

const KEYS = [
  "SF_PLATFORM_EVENT_BASE_URL",
  "SF_PLATFORM_EVENT_CLIENT_ID",
  "SF_PLATFORM_EVENT_CLIENT_SECRET",
  "SF_PLATFORM_EVENT_API_NAME",
  "SF_PLATFORM_EVENT_API_VERSION",
  "SF_PLATFORM_EVENT_VERIFIED"
] as const;

function clearEnv() {
  for (const k of KEYS) delete process.env[k];
}

function fullyProvisioned() {
  process.env.SF_PLATFORM_EVENT_BASE_URL = "https://test.my.salesforce.com";
  process.env.SF_PLATFORM_EVENT_CLIENT_ID = "3MVG9_test_client_id";
  process.env.SF_PLATFORM_EVENT_CLIENT_SECRET = "test-client-secret";
}

function fakeSpan(overrides: Partial<SpanLike> = {}): SpanLike {
  return {
    id: "span-test-1",
    taskId: "task-test-1",
    agentId: "care-router-claude",
    operation: "a2a.tasks/send",
    protocol: "a2a",
    status: "ok",
    durationMs: 142,
    startedAt: "2026-06-24T08:00:00.000Z",
    attributes: { pathway: "mscp-virtual-visit", acuity: "routine" },
    ...overrides
  };
}

describe("getSfPlatformEventSinkConfig + isSfPlatformEventSinkConfigured", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    clearEnv();
    _resetSinkCountersForTests();
  });
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns null when unset", () => {
    expect(getSfPlatformEventSinkConfig()).toBeNull();
    expect(isSfPlatformEventSinkConfigured()).toBe(false);
  });

  it("returns null when any required var is missing", () => {
    fullyProvisioned();
    delete process.env.SF_PLATFORM_EVENT_CLIENT_SECRET;
    expect(getSfPlatformEventSinkConfig()).toBeNull();
  });

  it("returns a typed config with defaults when only required vars are set", () => {
    fullyProvisioned();
    const cfg = getSfPlatformEventSinkConfig();
    expect(cfg).not.toBeNull();
    expect(cfg).toEqual<SfPlatformEventSinkConfig>({
      baseUrl: "https://test.my.salesforce.com",
      clientId: "3MVG9_test_client_id",
      clientSecret: "test-client-secret",
      eventApiName: "Pause_Agent_Trace__e",
      apiVersion: "v60.0"
    });
  });

  it("respects eventApiName + apiVersion overrides", () => {
    fullyProvisioned();
    process.env.SF_PLATFORM_EVENT_API_NAME = "Pause_Custom_Audit__e";
    process.env.SF_PLATFORM_EVENT_API_VERSION = "v59.0";
    const cfg = getSfPlatformEventSinkConfig();
    expect(cfg?.eventApiName).toBe("Pause_Custom_Audit__e");
    expect(cfg?.apiVersion).toBe("v59.0");
  });

  it("rejects non-https baseUrl with console.warn (does not throw)", () => {
    fullyProvisioned();
    process.env.SF_PLATFORM_EVENT_BASE_URL = "http://insecure.example/";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSfPlatformEventSinkConfig()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects an event name that doesn't end in __e", () => {
    fullyProvisioned();
    process.env.SF_PLATFORM_EVENT_API_NAME = "Pause_Audit__c"; // sObject suffix, not event
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSfPlatformEventSinkConfig()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("strips trailing slashes from baseUrl", () => {
    fullyProvisioned();
    process.env.SF_PLATFORM_EVENT_BASE_URL = "https://test.my.salesforce.com///";
    expect(getSfPlatformEventSinkConfig()?.baseUrl).toBe(
      "https://test.my.salesforce.com"
    );
  });
});

describe("getSfPlatformEventSinkStatus + toPublicConfig", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    clearEnv();
    _resetSinkCountersForTests();
  });
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns designed when unprovisioned", () => {
    expect(getSfPlatformEventSinkStatus()).toBe("designed");
    const pub = toPublicConfig();
    expect(pub.status).toBe("designed");
    expect(pub.eventApiName).toBeUndefined();
    expect(pub.apiVersion).toBeUndefined();
    expect(pub.counters).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      lastError: null
    });
  });

  it("returns prototype when provisioned but not verified", () => {
    fullyProvisioned();
    expect(getSfPlatformEventSinkStatus()).toBe("prototype");
    const pub = toPublicConfig();
    expect(pub.status).toBe("prototype");
    expect(pub.eventApiName).toBe("Pause_Agent_Trace__e");
    expect(pub.apiVersion).toBe("v60.0");
  });

  it("returns shipped only when VERIFIED truthy AND provisioned", () => {
    fullyProvisioned();
    for (const truthy of ["true", "1", "on", "TRUE"]) {
      process.env.SF_PLATFORM_EVENT_VERIFIED = truthy;
      expect(getSfPlatformEventSinkStatus()).toBe("shipped");
    }
  });

  it("VERIFIED alone (without provisioning) stays designed", () => {
    process.env.SF_PLATFORM_EVENT_VERIFIED = "true";
    expect(getSfPlatformEventSinkStatus()).toBe("designed");
  });

  it("public payload never surfaces secrets", () => {
    fullyProvisioned();
    const pub = toPublicConfig();
    expect(pub).not.toHaveProperty("clientId");
    expect(pub).not.toHaveProperty("clientSecret");
    expect(pub).not.toHaveProperty("baseUrl");
  });
});

describe("spanToEventPayload", () => {
  it("maps every field on a typical span", () => {
    expect(spanToEventPayload(fakeSpan())).toEqual({
      Span_Id__c: "span-test-1",
      Task_Id__c: "task-test-1",
      Agent_Id__c: "care-router-claude",
      Operation__c: "a2a.tasks/send",
      Protocol__c: "a2a",
      Status__c: "ok",
      Started_At__c: "2026-06-24T08:00:00.000Z",
      Duration_Ms__c: 142,
      Attributes_Json__c: '{"pathway":"mscp-virtual-visit","acuity":"routine"}'
    });
  });

  it("omits Parent_Span_Id__c, Duration_Ms__c, Attributes_Json__c when absent", () => {
    const payload = spanToEventPayload(
      fakeSpan({ parentSpanId: undefined, durationMs: undefined, attributes: undefined })
    );
    expect(payload).not.toHaveProperty("Parent_Span_Id__c");
    expect(payload).not.toHaveProperty("Duration_Ms__c");
    expect(payload).not.toHaveProperty("Attributes_Json__c");
  });

  it("threads parentSpanId through when present", () => {
    const payload = spanToEventPayload(fakeSpan({ parentSpanId: "span-parent-xyz" }));
    expect(payload.Parent_Span_Id__c).toBe("span-parent-xyz");
  });

  it("truncates oversize attribute JSON and tags the truncation", () => {
    const big = { junk: "x".repeat(60_000) };
    const payload = spanToEventPayload(fakeSpan({ attributes: big }));
    expect(payload.Attributes_Json__c).toBeDefined();
    expect(payload.Attributes_Json__c!.length).toBeLessThanOrEqual(30_100);
    expect(payload.Attributes_Json__c).toContain("…[truncated;");
  });

  it("handles attributes that fail to serialise (circular ref)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const payload = spanToEventPayload(fakeSpan({ attributes: circular }));
    expect(payload.Attributes_Json__c).toBe('{"_serialize_error":true}');
  });
});

describe("emitSpanEvent — end-to-end (stubbed Salesforce)", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    clearEnv();
    _resetSinkCountersForTests();
  });
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns 'skipped' when unprovisioned + leaves counters at zero", async () => {
    expect(await emitSpanEvent(fakeSpan())).toBe("skipped");
    expect(getSinkCounters()).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      lastError: null
    });
  });

  it("emits a Platform Event via token-then-POST when configured", async () => {
    fullyProvisioned();
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch = vi.fn(async (url: unknown, init: unknown) => {
      const u = String(url);
      const body = String(
        (init as { body?: BodyInit }).body ?? ""
      );
      calls.push({ url: u, body });
      if (u.endsWith("/services/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "00D...token",
            instance_url: "https://test.my.salesforce.com",
            expires_in: "7200"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ id: "e00xx0000004testEAA", success: true }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    });
    const result = await emitSpanEvent(fakeSpan(), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    expect(result).toBe("ok");
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(calls[0].url).toContain("/services/oauth2/token");
    expect(calls[0].body).toContain("grant_type=client_credentials");
    expect(calls[1].url).toBe(
      "https://test.my.salesforce.com/services/data/v60.0/sobjects/Pause_Agent_Trace__e/"
    );
    const posted = JSON.parse(calls[1].body) as Record<string, unknown>;
    expect(posted.Span_Id__c).toBe("span-test-1");
    expect(posted.Operation__c).toBe("a2a.tasks/send");
    expect(getSinkCounters()).toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      lastError: null
    });
  });

  it("never throws on a 401 from Salesforce; bumps failed + records lastError", async () => {
    fullyProvisioned();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeFetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/services/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "00D...token",
            instance_url: "https://test.my.salesforce.com",
            expires_in: "7200"
          }),
          { status: 200 }
        );
      }
      return new Response("invalid session", { status: 401 });
    });
    const result = await emitSpanEvent(fakeSpan(), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    expect(result).toBe("error");
    const counters = getSinkCounters();
    expect(counters.attempted).toBe(1);
    expect(counters.failed).toBe(1);
    expect(counters.lastError).toContain("401");
    warn.mockRestore();
  });

  it("never throws on a network failure; bumps failed", async () => {
    fullyProvisioned();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeFetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const result = await emitSpanEvent(fakeSpan(), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    expect(result).toBe("error");
    expect(getSinkCounters().lastError).toContain("ETIMEDOUT");
    warn.mockRestore();
  });

  it("reuses the cached token across multiple emits", async () => {
    fullyProvisioned();
    let tokenCalls = 0;
    const fakeFetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/services/oauth2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: "00D...token",
            instance_url: "https://test.my.salesforce.com",
            expires_in: "7200"
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 201 });
    });
    await emitSpanEvent(fakeSpan({ id: "s1" }), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    await emitSpanEvent(fakeSpan({ id: "s2" }), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    await emitSpanEvent(fakeSpan({ id: "s3" }), {
      fetchImpl: fakeFetch as unknown as typeof fetch
    });
    expect(tokenCalls).toBe(1);
    expect(getSinkCounters().succeeded).toBe(3);
  });
});
