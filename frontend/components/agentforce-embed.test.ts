import { describe, expect, it } from "vitest";

import {
  AGENTFORCE_CONSOLE_SIGNATURES,
  AGENTFORCE_COPY,
  buildAgentforceSlowDiagnostic,
  buildAgentforceTimeoutDiagnostic,
  describeAgentforceError,
  formatAgentforceError,
  hostFromUrl,
  type AgentforceConfig
} from "../lib/agentforce";

/**
 * Diagnostic coverage for <AgentforceEmbed/>. Like the rest of this repo
 * (see recommended-providers.test.ts and chat-to-care-router-handoff.test.ts),
 * components are tested as node-env pure functions rather than rendered — the
 * embed's failure-surface logic lives in the exported helpers below, and the
 * component is a thin wiring layer over them. These tests exercise the exact
 * strings/objects the embed renders and logs:
 *   (a) a dispatched onEmbeddedMessagingInitError → the specific detail message,
 *   (b) the slowToReady timeout path → the enriched ranked-cause hint,
 *   (c) a bootstrap script-load error → the red error copy with the URL.
 */

const config: AgentforceConfig = {
  orgId: "00DHp00000L08KK",
  deploymentApiName: "Pause_Health_Intake",
  siteUrl: "https://trailsignup-c2d761a3b89bf2.my.site.com/ESWPauseHealthIntake1780455502567",
  scrt2Url: "https://trailsignup-c2d761a3b89bf2.my.salesforce-scrt.com",
  bootstrapScriptUrl:
    "https://trailsignup-c2d761a3b89bf2.my.site.com/ESWPauseHealthIntake1780455502567/assets/js/bootstrap.min.js",
  language: "en_US"
};

describe("describeAgentforceError (init/bootstrap error detail)", () => {
  it("surfaces the SDK's detail.message verbatim", () => {
    const surfaced = describeAgentforceError(
      { message: "Error loading configuration settings" },
      AGENTFORCE_COPY.initErrorFallback
    );
    expect(surfaced.message).toBe("Error loading configuration settings");
    expect(surfaced.code).toBeNull();
    expect(formatAgentforceError(surfaced)).toBe(
      "Error loading configuration settings"
    );
  });

  it("appends an error code when the detail carries one", () => {
    const surfaced = describeAgentforceError(
      { message: "Bootstrap failed", code: "ESW_404" },
      AGENTFORCE_COPY.initErrorFallback
    );
    expect(surfaced.code).toBe("ESW_404");
    expect(formatAgentforceError(surfaced)).toBe(
      "Bootstrap failed (code: ESW_404)"
    );
  });

  it("reads a nested detail.error object and coerces a numeric code", () => {
    const surfaced = describeAgentforceError(
      { error: { message: "RPC connection timeout", code: 504 } },
      AGENTFORCE_COPY.initErrorFallback
    );
    expect(surfaced.message).toBe("RPC connection timeout");
    expect(surfaced.code).toBe("504");
  });

  it("falls back to the provided generic message when detail is empty/absent", () => {
    expect(describeAgentforceError(null, AGENTFORCE_COPY.initErrorFallback).message).toBe(
      AGENTFORCE_COPY.initErrorFallback
    );
    expect(
      describeAgentforceError({ message: "   " }, "onEmbeddedMessagingInitError fired")
        .message
    ).toBe("onEmbeddedMessagingInitError fired");
  });
});

describe("buildAgentforceSlowDiagnostic (ready-watchdog timeout hint)", () => {
  it("ranks stale/unpublished deployment before the CORS/frame-ancestors cause", () => {
    const diag = buildAgentforceSlowDiagnostic({
      deploymentApiName: "Pause_Health_Intake",
      origin: "https://pause-health.ai",
      bootstrapLoaded: true
    });
    expect(diag.lead).toBe(AGENTFORCE_COPY.slowLead);
    // Bootstrap loaded, so exactly the two org-side causes, in rank order.
    expect(diag.causes).toHaveLength(2);
    expect(diag.causes[0]).toContain("re-Published");
    expect(diag.causes[0]).toContain("Pause_Health_Intake");
    expect(diag.causes[1]).toContain("CORS");
    expect(diag.causes[1]).toContain("frame-ancestors");
    expect(diag.causes[1]).toContain("https://pause-health.ai");
  });

  it("points the operator at the specific DevTools Console strings", () => {
    const diag = buildAgentforceSlowDiagnostic({
      deploymentApiName: "Pause_Health_Intake",
      origin: "https://pause-health.ai",
      bootstrapLoaded: true
    });
    for (const signature of AGENTFORCE_CONSOLE_SIGNATURES) {
      expect(diag.devtoolsHint).toContain(signature);
    }
  });

  it("prepends a bootstrap-didn't-load cause when the script never loaded", () => {
    const diag = buildAgentforceSlowDiagnostic({
      deploymentApiName: "Pause_Health_Intake",
      origin: "https://pause-health.ai",
      bootstrapLoaded: false
    });
    expect(diag.causes).toHaveLength(3);
    expect(diag.causes[0]).toContain("bootstrap.min.js");
  });
});

describe("buildAgentforceTimeoutDiagnostic (structured console.warn payload)", () => {
  it("logs only host names, deployment api name, origin, elapsed, and causes — no secrets", () => {
    const diag = buildAgentforceTimeoutDiagnostic({
      config,
      origin: "https://pause-health.ai",
      elapsedMs: 12000,
      bootstrapLoaded: true
    });
    expect(diag).toEqual({
      event: "agentforce-launcher-timeout",
      deploymentApiName: "Pause_Health_Intake",
      siteUrlHost: "trailsignup-c2d761a3b89bf2.my.site.com",
      scrt2Host: "trailsignup-c2d761a3b89bf2.my.salesforce-scrt.com",
      origin: "https://pause-health.ai",
      elapsedMs: 12000,
      bootstrapLoaded: true,
      likelyCauses: expect.arrayContaining([expect.stringContaining("re-Published")]),
      checkConsoleFor: AGENTFORCE_CONSOLE_SIGNATURES
    });
    // The full config values (orgId, scrt2Url path, bootstrap URL) must not leak.
    const serialized = JSON.stringify(diag);
    expect(serialized).not.toContain(config.orgId);
    expect(serialized).not.toContain("/assets/js/bootstrap.min.js");
    expect(serialized).not.toContain("https://trailsignup");
  });
});

describe("hostFromUrl", () => {
  it("extracts the host and returns null for unparseable input", () => {
    expect(hostFromUrl("https://example.my.site.com/path")).toBe("example.my.site.com");
    expect(hostFromUrl("not a url")).toBeNull();
    expect(hostFromUrl(null)).toBeNull();
    expect(hostFromUrl(undefined)).toBeNull();
  });
});

describe("bootstrap script-load failure copy", () => {
  it("interpolates the failing bootstrap URL into the red error message", () => {
    const message = AGENTFORCE_COPY.bootstrapLoadFailed.replace(
      "{url}",
      config.bootstrapScriptUrl
    );
    expect(message).toContain(config.bootstrapScriptUrl);
    expect(message).toContain("Failed to load Salesforce Embedded Messaging bootstrap");
  });
});
