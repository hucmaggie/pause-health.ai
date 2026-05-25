import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { MIN_HUMAN_FILL_MS } from "../../../lib/anti-bot";

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function buildRawRequest(rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody
  });
}

const SLOW_ENOUGH = () => Date.now() - (MIN_HUMAN_FILL_MS + 1000);

describe("POST /api/subscribe", () => {
  beforeEach(() => {
    process.env.NEWSLETTER_PROVIDER = "log";
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(buildRawRequest("not json {"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
  });

  it("silently absorbs honeypot hits with 200", async () => {
    const res = await POST(
      buildRequest({
        email: "user@example.com",
        website: "https://spam.example.com",
        renderedAt: SLOW_ENOUGH()
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("silently absorbs time-trap hits with 200", async () => {
    const res = await POST(
      buildRequest({
        email: "user@example.com",
        renderedAt: Date.now() - 200
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("rejects clearly invalid emails with 400", async () => {
    const res = await POST(
      buildRequest({ email: "not-an-email", renderedAt: SLOW_ENOUGH() })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Please provide a valid email." });
  });

  it("rejects missing email with 400", async () => {
    const res = await POST(buildRequest({ renderedAt: SLOW_ENOUGH() }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Please provide a valid email." });
  });

  it("accepts a valid submission and returns 200", async () => {
    const res = await POST(
      buildRequest({ email: "user@example.com", renderedAt: SLOW_ENOUGH() })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("lowercases and trims the email before logging", async () => {
    const res = await POST(
      buildRequest({ email: "  USER@Example.COM  ", renderedAt: SLOW_ENOUGH() })
    );
    expect(res.status).toBe(200);
    const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(logged).toContain("user@example.com");
    expect(logged).not.toContain("USER@Example.COM");
  });

  it("requires turnstile when configured and fails when verification fails", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 })
    );

    const res = await POST(
      buildRequest(
        { email: "user@example.com", turnstileToken: "bad-token", renderedAt: SLOW_ENOUGH() },
        { "x-forwarded-for": "203.0.113.5" }
      )
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Verification failed. Please try again." });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("passes when turnstile verification succeeds", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const res = await POST(
      buildRequest({ email: "user@example.com", turnstileToken: "good-token", renderedAt: SLOW_ENOUGH() })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("returns 502 when the provider call fails", async () => {
    process.env.NEWSLETTER_PROVIDER = "formspree";
    delete process.env.FORMSPREE_FORM_ID;

    const res = await POST(
      buildRequest({ email: "user@example.com", renderedAt: SLOW_ENOUGH() })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Subscription failed. Please try again shortly."
    });
    expect(console.error).toHaveBeenCalled();
  });
});
