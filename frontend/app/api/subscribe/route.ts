import { NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  isBotSubmission,
  isValidEmail,
  verifyTurnstile
} from "../../../lib/anti-bot";

type Provider = "log" | "formspree" | "resend" | "mailchimp" | "buttondown" | "convertkit";

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function forwardToProvider(
  email: string
): Promise<{ ok: boolean; status: number; detail?: unknown }> {
  const provider = (process.env.NEWSLETTER_PROVIDER || "log") as Provider;

  if (provider === "log") {
    console.log(`[newsletter] subscribe (no provider configured): ${email}`);
    return { ok: true, status: 200 };
  }

  if (provider === "formspree") {
    const formId = process.env.FORMSPREE_FORM_ID;
    if (!formId) return { ok: false, status: 500, detail: "Missing FORMSPREE_FORM_ID" };
    const res = await fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, source: "pause-health-footer" })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    if (!apiKey || !audienceId) {
      return { ok: false, status: 500, detail: "Missing RESEND_API_KEY or RESEND_AUDIENCE_ID" };
    }
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ email, unsubscribed: false })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  if (provider === "mailchimp") {
    const apiKey = process.env.MAILCHIMP_API_KEY;
    const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
    if (!apiKey || !audienceId) {
      return { ok: false, status: 500, detail: "Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID" };
    }
    const dc = apiKey.split("-")[1];
    if (!dc) return { ok: false, status: 500, detail: "Invalid Mailchimp API key format" };
    const res = await fetch(
      `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`
        },
        body: JSON.stringify({ email_address: email, status: "subscribed" })
      }
    );
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  if (provider === "buttondown") {
    const apiKey = process.env.BUTTONDOWN_API_KEY;
    if (!apiKey) return { ok: false, status: 500, detail: "Missing BUTTONDOWN_API_KEY" };
    const res = await fetch("https://api.buttondown.email/v1/subscribers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`
      },
      body: JSON.stringify({ email })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  if (provider === "convertkit") {
    const apiKey = process.env.CONVERTKIT_API_KEY;
    const formId = process.env.CONVERTKIT_FORM_ID;
    if (!apiKey || !formId) {
      return { ok: false, status: 500, detail: "Missing CONVERTKIT_API_KEY or CONVERTKIT_FORM_ID" };
    }
    const res = await fetch(`https://api.convertkit.com/v3/forms/${formId}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, email })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  return { ok: false, status: 500, detail: `Unknown NEWSLETTER_PROVIDER: ${provider}` };
}

export async function POST(request: Request) {
  let payload: {
    email?: string;
    website?: string;
    turnstileToken?: string;
    renderedAt?: number;
  } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (isBotSubmission(payload)) {
    return NextResponse.json({ ok: true });
  }

  const email = (payload.email || "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Please provide a valid email." }, { status: 400 });
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    const ip = clientIpFromHeaders(request.headers);
    const ok = await verifyTurnstile(payload.turnstileToken || "", ip);
    if (!ok) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 }
      );
    }
  }

  const result = await forwardToProvider(email);

  if (!result.ok) {
    console.error("[newsletter] provider error:", result.detail);
    return NextResponse.json(
      { error: "Subscription failed. Please try again shortly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
