import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { GET } from "./route";

/**
 * GET /api/salesforce/headless-360/config — the public provisioning probe.
 *
 * This is the ONLY headless-360 route that answers when the env is unset
 * (the others 503). It must expose provisioning status without leaking the
 * External Client App id, the session secret, or the Salesforce base URL.
 */

const KEYS = [
  "SF_HEADLESS360_CLIENT_ID",
  "SF_HEADLESS360_AUTH_BASE_URL",
  "SF_HEADLESS360_REDIRECT_URI",
  "SF_HEADLESS360_SCOPES",
  "SF_HEADLESS360_SESSION_SECRET",
  "SF_HEADLESS360_VERIFIED"
] as const;

const ORIGINAL = { ...process.env };

function clearEnv() {
  for (const k of KEYS) delete process.env[k];
}

function fullyProvisioned() {
  process.env.SF_HEADLESS360_CLIENT_ID = "3MVG9_test_client_id";
  process.env.SF_HEADLESS360_AUTH_BASE_URL = "https://test.my.salesforce.com";
  process.env.SF_HEADLESS360_REDIRECT_URI =
    "https://pause-health.ai/api/salesforce/headless-360/callback";
  process.env.SF_HEADLESS360_SESSION_SECRET = randomBytes(32).toString("hex");
}

beforeEach(() => clearEnv());
afterEach(() => {
  Object.keys(process.env).forEach((k) => {
    if (!(k in ORIGINAL)) delete process.env[k];
  });
  Object.assign(process.env, ORIGINAL);
});

describe("GET /api/salesforce/headless-360/config", () => {
  it("reports 'designed' with no secrets when unprovisioned", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("designed");
    expect(json.meta._source).toBe("designed");
    expect(json.meta._doc).toContain("HEADLESS_360_RUNBOOK");
    // Designed state carries no scopes / authorizeUrl.
    expect(json.scopes).toBeUndefined();
    expect(json.authorizeUrl).toBeUndefined();
  });

  it("reports 'prototype' with the local authorize URL once provisioned", async () => {
    fullyProvisioned();
    const json = await (await GET()).json();
    expect(json.status).toBe("prototype");
    expect(json.scopes).toBe("mcp_api refresh_token");
    expect(json.authorizeUrl).toBe("/api/salesforce/headless-360/authorize");
  });

  it("never leaks the client id, secret, or Salesforce base URL", async () => {
    fullyProvisioned();
    const raw = JSON.stringify(await (await GET()).json());
    expect(raw).not.toContain("3MVG9_test_client_id");
    expect(raw).not.toContain("test.my.salesforce.com");
    expect(raw.toLowerCase()).not.toContain("secret");
  });
});
