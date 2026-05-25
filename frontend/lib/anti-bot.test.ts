import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientIpFromHeaders,
  isBotSubmission,
  isHoneypotTriggered,
  isTimeTrapTriggered,
  isValidEmail,
  MIN_HUMAN_FILL_MS,
  verifyTurnstile
} from "./anti-bot";

describe("isValidEmail", () => {
  it.each([
    "user@example.com",
    "first.last+tag@sub.example.co",
    "a@b.co"
  ])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "not-an-email",
    "missing@tld",
    "no-at-sign.com",
    "spaces in@email.com",
    "double@@example.com"
  ])("rejects %j", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
    expect(isValidEmail({ email: "user@example.com" })).toBe(false);
  });

  it("rejects emails longer than 254 chars", () => {
    const local = "a".repeat(250);
    const tooLong = `${local}@x.co`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(isValidEmail(tooLong)).toBe(false);
  });
});

describe("isHoneypotTriggered", () => {
  it("returns true when the honeypot field has a non-empty string", () => {
    expect(isHoneypotTriggered("https://spam.example.com")).toBe(true);
    expect(isHoneypotTriggered(" not-empty ")).toBe(true);
  });

  it("returns false for empty / whitespace / non-string", () => {
    expect(isHoneypotTriggered("")).toBe(false);
    expect(isHoneypotTriggered("   ")).toBe(false);
    expect(isHoneypotTriggered(undefined)).toBe(false);
    expect(isHoneypotTriggered(null)).toBe(false);
    expect(isHoneypotTriggered(0)).toBe(false);
  });
});

describe("isTimeTrapTriggered", () => {
  const NOW = 10_000_000;

  it("returns true when submitted faster than the human fill threshold", () => {
    expect(isTimeTrapTriggered(NOW - 100, NOW)).toBe(true);
    expect(isTimeTrapTriggered(NOW - (MIN_HUMAN_FILL_MS - 1), NOW)).toBe(true);
  });

  it("returns false when enough time has passed", () => {
    expect(isTimeTrapTriggered(NOW - MIN_HUMAN_FILL_MS, NOW)).toBe(false);
    expect(isTimeTrapTriggered(NOW - (MIN_HUMAN_FILL_MS + 500), NOW)).toBe(false);
  });

  it("returns true when renderedAt is in the future (clock tamper)", () => {
    expect(isTimeTrapTriggered(NOW + 5000, NOW)).toBe(true);
  });

  it("returns false when renderedAt is missing or not a finite number", () => {
    expect(isTimeTrapTriggered(undefined, NOW)).toBe(false);
    expect(isTimeTrapTriggered(null, NOW)).toBe(false);
    expect(isTimeTrapTriggered("not a number", NOW)).toBe(false);
    expect(isTimeTrapTriggered(Number.NaN, NOW)).toBe(false);
    expect(isTimeTrapTriggered(Infinity, NOW)).toBe(false);
  });
});

describe("isBotSubmission", () => {
  const NOW = Date.now();

  it("flags honeypot hits", () => {
    expect(isBotSubmission({ website: "filled", renderedAt: NOW - 10_000 })).toBe(true);
  });

  it("flags fast submissions", () => {
    expect(isBotSubmission({ website: "", renderedAt: NOW - 100 })).toBe(true);
  });

  it("allows real-looking submissions", () => {
    const slowEnough = NOW - (MIN_HUMAN_FILL_MS + 500);
    expect(isBotSubmission({ website: "", renderedAt: slowEnough })).toBe(false);
  });

  it("ignores a missing renderedAt (still allows if honeypot is empty)", () => {
    expect(isBotSubmission({ website: "" })).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers cf-connecting-ip", () => {
    const h = new Headers({
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "10.0.0.1, 203.0.113.6"
    });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.5");
  });

  it("falls back to the first hop in x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.7");
  });

  it("returns null when no IP headers are present", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("verifyTurnstile", () => {
  const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
    }
    vi.restoreAllMocks();
  });

  it("skips verification (returns true) when no secret is configured", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fakeFetch = vi.fn();
    await expect(verifyTurnstile("any-token", null, fakeFetch as unknown as typeof fetch)).resolves.toBe(true);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("fails immediately if no token is provided", async () => {
    const fakeFetch = vi.fn();
    await expect(verifyTurnstile("", "1.1.1.1", fakeFetch as unknown as typeof fetch)).resolves.toBe(false);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("returns true when Cloudflare confirms success", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true })
    });
    await expect(verifyTurnstile("token", "1.1.1.1", fakeFetch as unknown as typeof fetch)).resolves.toBe(true);
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toContain("turnstile/v0/siteverify");
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("secret")).toBe("test-secret");
    expect(body.get("response")).toBe("token");
    expect(body.get("remoteip")).toBe("1.1.1.1");
  });

  it("returns false when Cloudflare reports failure", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: false })
    });
    await expect(verifyTurnstile("token", null, fakeFetch as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("returns false when the verify call throws", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(verifyTurnstile("token", null, fakeFetch as unknown as typeof fetch)).resolves.toBe(false);
  });
});
