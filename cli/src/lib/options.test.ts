import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultBaseUrl, parseFlags } from "./options";

describe("defaultBaseUrl", () => {
  const ORIGINAL = process.env.PAUSE_BASE_URL;
  beforeEach(() => delete process.env.PAUSE_BASE_URL);
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAUSE_BASE_URL;
    else process.env.PAUSE_BASE_URL = ORIGINAL;
  });

  it("falls back to https://pause-health.ai when unset", () => {
    expect(defaultBaseUrl()).toBe("https://pause-health.ai");
  });

  it("honors PAUSE_BASE_URL when set", () => {
    process.env.PAUSE_BASE_URL = "https://preview-abc.vercel.app";
    expect(defaultBaseUrl()).toBe("https://preview-abc.vercel.app");
  });

  it("trims whitespace from PAUSE_BASE_URL", () => {
    process.env.PAUSE_BASE_URL = "  https://preview.example.com  ";
    expect(defaultBaseUrl()).toBe("https://preview.example.com");
  });
});

describe("parseFlags", () => {
  const ORIGINAL = process.env.PAUSE_BASE_URL;
  beforeEach(() => delete process.env.PAUSE_BASE_URL);
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAUSE_BASE_URL;
    else process.env.PAUSE_BASE_URL = ORIGINAL;
  });

  it("returns the defaults when given no args", () => {
    expect(parseFlags([])).toEqual({
      json: false,
      baseUrl: "https://pause-health.ai",
      menopause: false,
      fallback: false,
      telehealth: false,
      positional: []
    });
  });

  it("parses boolean flags", () => {
    const f = parseFlags(["--json", "--menopause", "--fallback", "--telehealth"]);
    expect(f.json).toBe(true);
    expect(f.menopause).toBe(true);
    expect(f.fallback).toBe(true);
    expect(f.telehealth).toBe(true);
  });

  it("parses value flags", () => {
    const f = parseFlags([
      "--zip",
      "92614",
      "--limit",
      "5",
      "--insurance",
      "aetna",
      "--base-url",
      "https://preview.example.com"
    ]);
    expect(f.zip).toBe("92614");
    expect(f.limit).toBe("5");
    expect(f.insurance).toBe("aetna");
    expect(f.baseUrl).toBe("https://preview.example.com");
  });

  it("collects positional args in order", () => {
    const f = parseFlags(["pause-demo-patient-001", "--json"]);
    expect(f.positional).toEqual(["pause-demo-patient-001"]);
    expect(f.json).toBe(true);
  });

  it("allows positional args after value flags", () => {
    const f = parseFlags(["--zip", "92614", "pause-demo-patient-001"]);
    expect(f.zip).toBe("92614");
    expect(f.positional).toEqual(["pause-demo-patient-001"]);
  });

  it("throws on unknown flags", () => {
    expect(() => parseFlags(["--bogus"])).toThrow(/unknown flag: --bogus/);
  });

  it("throws when a value flag is missing its value", () => {
    expect(() => parseFlags(["--zip"])).toThrow(/--zip requires a value/);
    expect(() => parseFlags(["--zip", "--json"])).toThrow(/--zip requires a value/);
  });

  it("inherits PAUSE_BASE_URL when --base-url is absent", () => {
    process.env.PAUSE_BASE_URL = "https://from-env.example";
    expect(parseFlags([]).baseUrl).toBe("https://from-env.example");
  });

  it("--base-url overrides PAUSE_BASE_URL", () => {
    process.env.PAUSE_BASE_URL = "https://from-env.example";
    expect(
      parseFlags(["--base-url", "https://from-flag.example"]).baseUrl
    ).toBe("https://from-flag.example");
  });
});
