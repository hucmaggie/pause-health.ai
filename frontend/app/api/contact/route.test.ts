import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { MIN_HUMAN_FILL_MS } from "../../../lib/anti-bot";

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function buildRawRequest(rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody
  });
}

const SLOW_ENOUGH = () => Date.now() - (MIN_HUMAN_FILL_MS + 1000);

const VALID = () => ({
  name: "Maggie",
  email: "maggie@example.com",
  subject: "Provider pilot",
  message: "We'd love to learn more about a pilot for our clinics.",
  renderedAt: SLOW_ENOUGH()
});

describe("POST /api/contact", () => {
  beforeEach(() => {
    process.env.CONTACT_PROVIDER = "log";
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(buildRawRequest("{not-valid"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
  });

  it("silently absorbs honeypot hits", async () => {
    const res = await POST(buildRequest({ ...VALID(), website: "https://spam.example.com" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("silently absorbs time-trap hits", async () => {
    const res = await POST(buildRequest({ ...VALID(), renderedAt: Date.now() - 100 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("rejects an invalid email with 400", async () => {
    const res = await POST(buildRequest({ ...VALID(), email: "not-an-email" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Please provide a valid email." });
  });

  it("rejects when name is missing", async () => {
    const res = await POST(buildRequest({ ...VALID(), name: "   " }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Please provide your name." });
  });

  it("rejects when message is too short", async () => {
    const res = await POST(buildRequest({ ...VALID(), message: "hi" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Please share a few sentences about what you need."
    });
  });

  it("accepts a valid submission and returns 200", async () => {
    const res = await POST(buildRequest(VALID()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("trims overly long fields rather than crashing", async () => {
    const huge = "a".repeat(10_000);
    const res = await POST(buildRequest({ ...VALID(), message: huge, subject: huge }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("requires turnstile when configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 })
    );

    const res = await POST(
      buildRequest({ ...VALID(), turnstileToken: "bad" }, { "cf-connecting-ip": "203.0.113.10" })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Verification failed. Please try again." });
  });

  it("returns 502 when the provider call fails", async () => {
    process.env.CONTACT_PROVIDER = "formspree";
    delete process.env.CONTACT_FORMSPREE_FORM_ID;

    const res = await POST(buildRequest(VALID()));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Sending failed. Please try again shortly."
    });
    expect(console.error).toHaveBeenCalled();
  });
});
