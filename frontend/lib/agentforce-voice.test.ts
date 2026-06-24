import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAgentforceVoiceConfig,
  getAgentforceVoiceStatus,
  isAgentforceVoiceConfigured,
  toPublicConfig
} from "./agentforce-voice";

/**
 * Tests for the Agentforce Voice provisioning seam.
 *
 * The four env-driven invariants we want pinned:
 *
 *   1. Unset env → status "designed", null config, no leak.
 *   2. All required env set + well-formed → status "prototype",
 *      typed config, public-safe payload omits baseUrl/deploymentRef.
 *   3. AGENTFORCE_VOICE_VERIFIED=true on top of (2) → status "shipped".
 *   4. Malformed env (bad provider, http:// baseUrl) → degrade to
 *      "designed" loudly (console.warn) rather than throwing or
 *      silently routing voice traffic through unconfigured infra.
 */

const VOICE_KEYS = [
  "AGENTFORCE_VOICE_PROVIDER",
  "AGENTFORCE_VOICE_BASE_URL",
  "AGENTFORCE_VOICE_DEPLOYMENT_REF",
  "AGENTFORCE_VOICE_AGENT_DEPLOYMENT",
  "AGENTFORCE_VOICE_LANGUAGE",
  "AGENTFORCE_VOICE_VERIFIED"
] as const;

function clearVoiceEnv() {
  for (const k of VOICE_KEYS) delete process.env[k];
}

function fullyProvisioned() {
  process.env.AGENTFORCE_VOICE_PROVIDER = "amazon-connect";
  process.env.AGENTFORCE_VOICE_BASE_URL = "https://pause.my.connect.aws";
  process.env.AGENTFORCE_VOICE_DEPLOYMENT_REF = "instance-guid-abc";
  process.env.AGENTFORCE_VOICE_AGENT_DEPLOYMENT = "Pause_Health_Intake_Agent";
}

describe("getAgentforceVoiceConfig", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => clearVoiceEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns null when no env vars are set", () => {
    expect(getAgentforceVoiceConfig()).toBeNull();
    expect(isAgentforceVoiceConfigured()).toBe(false);
  });

  it("returns null when any one required var is missing", () => {
    fullyProvisioned();
    delete process.env.AGENTFORCE_VOICE_DEPLOYMENT_REF;
    expect(getAgentforceVoiceConfig()).toBeNull();
  });

  it("returns a typed config when all required vars are set", () => {
    fullyProvisioned();
    const cfg = getAgentforceVoiceConfig();
    expect(cfg).toEqual({
      provider: "amazon-connect",
      baseUrl: "https://pause.my.connect.aws",
      deploymentRef: "instance-guid-abc",
      agentDeployment: "Pause_Health_Intake_Agent",
      language: "en-US"
    });
  });

  it("strips trailing slashes from baseUrl", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_BASE_URL = "https://pause.my.connect.aws///";
    expect(getAgentforceVoiceConfig()?.baseUrl).toBe(
      "https://pause.my.connect.aws"
    );
  });

  it("respects an explicit language override", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_LANGUAGE = "es-MX";
    expect(getAgentforceVoiceConfig()?.language).toBe("es-MX");
  });

  it("rejects a non-https baseUrl and degrades to null", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_BASE_URL = "http://insecure.example/";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getAgentforceVoiceConfig()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects an unknown provider and degrades to null", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_PROVIDER = "twilio";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getAgentforceVoiceConfig()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("normalizes provider casing", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_PROVIDER = "  Amazon-Connect  ";
    expect(getAgentforceVoiceConfig()?.provider).toBe("amazon-connect");
  });
});

describe("getAgentforceVoiceStatus", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearVoiceEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns 'designed' when unprovisioned", () => {
    expect(getAgentforceVoiceStatus()).toBe("designed");
  });

  it("returns 'prototype' when provisioned but not verified", () => {
    fullyProvisioned();
    expect(getAgentforceVoiceStatus()).toBe("prototype");
  });

  it("returns 'shipped' only when AGENTFORCE_VOICE_VERIFIED is truthy", () => {
    fullyProvisioned();
    for (const truthy of ["true", "1", "on", "TRUE"]) {
      process.env.AGENTFORCE_VOICE_VERIFIED = truthy;
      expect(getAgentforceVoiceStatus()).toBe("shipped");
    }
  });

  it("treats AGENTFORCE_VOICE_VERIFIED=anything-else as not-verified", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_VERIFIED = "false";
    expect(getAgentforceVoiceStatus()).toBe("prototype");
  });

  it("never returns 'shipped' if the underlying config is unprovisioned", () => {
    process.env.AGENTFORCE_VOICE_VERIFIED = "true";
    // No other env vars set; the flag alone must not promote status.
    expect(getAgentforceVoiceStatus()).toBe("designed");
  });
});

describe("toPublicConfig", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearVoiceEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns just { status: 'designed' } when unprovisioned", () => {
    expect(toPublicConfig()).toEqual({ status: "designed" });
  });

  it("omits baseUrl and deploymentRef when provisioned", () => {
    fullyProvisioned();
    const pub = toPublicConfig();
    expect(pub).toEqual({
      status: "prototype",
      provider: "amazon-connect",
      agentDeployment: "Pause_Health_Intake_Agent",
      language: "en-US"
    });
    expect(pub).not.toHaveProperty("baseUrl");
    expect(pub).not.toHaveProperty("deploymentRef");
  });

  it("reports shipped when verified flag is set", () => {
    fullyProvisioned();
    process.env.AGENTFORCE_VOICE_VERIFIED = "true";
    expect(toPublicConfig().status).toBe("shipped");
  });
});
