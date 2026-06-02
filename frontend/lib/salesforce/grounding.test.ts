import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSalesforceWarnDedupForTests,
  warnSalesforceDegradationOnce
} from "./grounding";

const ENV_KEYS = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const;

function setSfConfigured(configured: boolean) {
  if (configured) {
    process.env.SF_INSTANCE_URL = "https://x.my.salesforce.com";
    process.env.SF_CLIENT_ID = "id";
    process.env.SF_CLIENT_SECRET = "secret";
  } else {
    for (const k of ENV_KEYS) delete process.env[k];
  }
}

beforeEach(() => {
  _resetSalesforceWarnDedupForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  setSfConfigured(false);
});

describe("warnSalesforceDegradationOnce", () => {
  it("is silent when Salesforce is intentionally unconfigured (env vars unset)", () => {
    setSfConfigured(false);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("test.op", new Error("boom"));
    warnSalesforceDegradationOnce("test.op", new Error("boom"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns once per failure category when Salesforce IS configured", () => {
    setSfConfigured(true);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("test.op", new Error("oauth invalid_client"));
    warnSalesforceDegradationOnce("test.op", new Error("oauth invalid_client"));
    warnSalesforceDegradationOnce("test.op", new Error("oauth invalid_client"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warns separately for distinct error messages in the same context", () => {
    setSfConfigured(true);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("test.op", new Error("auth failed"));
    warnSalesforceDegradationOnce("test.op", new Error("SOQL malformed"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("warns separately for the same error in distinct contexts", () => {
    setSfConfigured(true);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("op-a", new Error("network down"));
    warnSalesforceDegradationOnce("op-b", new Error("network down"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("handles non-Error throwables gracefully", () => {
    setSfConfigured(true);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("test.op", "string-error");
    warnSalesforceDegradationOnce("test.op", { weird: "object" });
    // Two distinct stringifications -> two warnings.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-warns after the dedup set is cleared (test reset)", () => {
    setSfConfigured(true);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSalesforceDegradationOnce("test.op", new Error("x"));
    warnSalesforceDegradationOnce("test.op", new Error("x"));
    expect(spy).toHaveBeenCalledTimes(1);

    _resetSalesforceWarnDedupForTests();
    warnSalesforceDegradationOnce("test.op", new Error("x"));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
