import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/voice/config. The load-bearing invariant is
 * a SECURITY one: this publicly-reachable route must surface the provisioning
 * status for the client button WITHOUT ever leaking baseUrl or deploymentRef
 * (partner-side identifiers a third party could use to open a session against
 * the CCaaS instance). Covers the designed (unset) and prototype (set) states
 * and asserts the secrets never appear in either response.
 */

const ENV_KEYS = [
  "AGENTFORCE_VOICE_PROVIDER",
  "AGENTFORCE_VOICE_BASE_URL",
  "AGENTFORCE_VOICE_DEPLOYMENT_REF",
  "AGENTFORCE_VOICE_AGENT_DEPLOYMENT",
  "AGENTFORCE_VOICE_LANGUAGE",
  "AGENTFORCE_VOICE_VERIFIED"
] as const;
const original: Record<string, string | undefined> = {};

const SECRET_BASE_URL = "https://pause-secret.my.connect.aws";
const SECRET_DEPLOYMENT_REF = "instance-guid-do-not-leak";

beforeEach(() => {
  for (const k of ENV_KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  vi.restoreAllMocks();
});

describe("GET /api/agentforce/voice/config", () => {
  it("reports 'designed' with no provider details when env is unset", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("designed");
    expect(json.meta._source).toBe("designed");
    expect(json.provider).toBeUndefined();
    expect(json.agentDeployment).toBeUndefined();
  });

  it("reports 'prototype' when provisioned but NEVER leaks baseUrl / deploymentRef", async () => {
    process.env.AGENTFORCE_VOICE_PROVIDER = "amazon-connect";
    process.env.AGENTFORCE_VOICE_BASE_URL = SECRET_BASE_URL;
    process.env.AGENTFORCE_VOICE_DEPLOYMENT_REF = SECRET_DEPLOYMENT_REF;
    process.env.AGENTFORCE_VOICE_AGENT_DEPLOYMENT = "Pause_Menopause_Concierge";

    const res = await GET();
    const json = await res.json();
    expect(json.status).toBe("prototype");
    expect(json.provider).toBe("amazon-connect");
    expect(json.agentDeployment).toBe("Pause_Menopause_Concierge");
    expect(json.language).toBe("en-US");

    // The security guarantee: neither the keys nor the values appear anywhere
    // in the serialized response.
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("deploymentRef");
    expect(serialized).not.toContain(SECRET_BASE_URL);
    expect(serialized).not.toContain(SECRET_DEPLOYMENT_REF);
  });

  it("flips to 'shipped' only when explicitly verified", async () => {
    process.env.AGENTFORCE_VOICE_PROVIDER = "five9";
    process.env.AGENTFORCE_VOICE_BASE_URL = "https://pause.app.five9.com";
    process.env.AGENTFORCE_VOICE_DEPLOYMENT_REF = "campaign-ref";
    process.env.AGENTFORCE_VOICE_AGENT_DEPLOYMENT = "Pause_Voice";
    process.env.AGENTFORCE_VOICE_VERIFIED = "true";

    const json = await (await GET()).json();
    expect(json.status).toBe("shipped");
  });
});
