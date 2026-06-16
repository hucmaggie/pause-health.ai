import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTFORCE_READY_TIMEOUT_MS,
  getAgentforceConfig,
  isAgentforceConfigured,
  sanitizePrechatFields
} from "./agentforce";

describe("sanitizePrechatFields", () => {
  it("returns null for nullish input", () => {
    expect(sanitizePrechatFields(null)).toBeNull();
    expect(sanitizePrechatFields(undefined)).toBeNull();
  });

  it("returns null when every value is empty or whitespace", () => {
    expect(sanitizePrechatFields({ Patient_Zip: "", Patient_Insurance: "   " })).toBeNull();
  });

  it("trims values and keys and keeps the usable ones", () => {
    expect(
      sanitizePrechatFields({ "  Patient_Zip  ": "  92614 ", Patient_Insurance: "aetna" })
    ).toEqual({ Patient_Zip: "92614", Patient_Insurance: "aetna" });
  });

  it("drops empty values but keeps populated siblings (no blank overwrite)", () => {
    // The load-bearing case: an empty registered field would overwrite real
    // MessagingSession context with blank, so it must be dropped, not sent.
    expect(
      sanitizePrechatFields({ Patient_Zip: "92614", Patient_Insurance: "" })
    ).toEqual({ Patient_Zip: "92614" });
  });

  it("drops entries whose key is blank", () => {
    expect(sanitizePrechatFields({ "   ": "value" })).toBeNull();
  });

  it("does not mutate the input object", () => {
    const input = { Patient_Zip: " 92614 ", drop: "  " };
    const out = sanitizePrechatFields(input);
    expect(input).toEqual({ Patient_Zip: " 92614 ", drop: "  " });
    expect(out).toEqual({ Patient_Zip: "92614" });
  });
});

describe("getAgentforceConfig", () => {
  const KEYS = [
    "NEXT_PUBLIC_AGENTFORCE_ORG_ID",
    "NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME",
    "NEXT_PUBLIC_AGENTFORCE_SITE_URL",
    "NEXT_PUBLIC_AGENTFORCE_SCRT2_URL"
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const setAll = () => {
    process.env.NEXT_PUBLIC_AGENTFORCE_ORG_ID = "00Dxx";
    process.env.NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME = "Pause_Intake";
    process.env.NEXT_PUBLIC_AGENTFORCE_SITE_URL = "https://pause.my.site.com/";
    process.env.NEXT_PUBLIC_AGENTFORCE_SCRT2_URL = "https://pause.salesforce-scrt.com//";
  };

  it("returns null and reports unconfigured when any var is missing", () => {
    process.env.NEXT_PUBLIC_AGENTFORCE_ORG_ID = "00Dxx";
    expect(getAgentforceConfig()).toBeNull();
    expect(isAgentforceConfigured()).toBe(false);
  });

  it("returns null when a var is whitespace-only", () => {
    setAll();
    process.env.NEXT_PUBLIC_AGENTFORCE_ORG_ID = "   ";
    expect(getAgentforceConfig()).toBeNull();
  });

  it("builds a normalized config when all four vars are present", () => {
    setAll();
    const cfg = getAgentforceConfig();
    expect(cfg).not.toBeNull();
    // Trailing slashes stripped from siteUrl + scrt2Url.
    expect(cfg!.siteUrl).toBe("https://pause.my.site.com");
    expect(cfg!.scrt2Url).toBe("https://pause.salesforce-scrt.com");
    // bootstrap script URL derived from the normalized site URL.
    expect(cfg!.bootstrapScriptUrl).toBe(
      "https://pause.my.site.com/assets/js/bootstrap.min.js"
    );
    expect(cfg!.language).toBe("en_US");
    expect(isAgentforceConfigured()).toBe(true);
  });
});

describe("AGENTFORCE_READY_TIMEOUT_MS", () => {
  it("is a sane positive watchdog interval", () => {
    expect(AGENTFORCE_READY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AGENTFORCE_READY_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
