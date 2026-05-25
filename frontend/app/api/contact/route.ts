import { NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  isBotSubmission,
  isValidEmail,
  verifyTurnstile
} from "../../../lib/anti-bot";

type ContactProvider = "log" | "formspree" | "resend";

const MAX_NAME = 120;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function forwardContact(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<{ ok: boolean; status: number; detail?: unknown }> {
  const provider = (process.env.CONTACT_PROVIDER || "log") as ContactProvider;

  if (provider === "log") {
    console.log(
      `[contact] new message (no provider configured) from ${input.email} (${input.name}): ${input.subject}`
    );
    return { ok: true, status: 200 };
  }

  if (provider === "formspree") {
    const formId = process.env.CONTACT_FORMSPREE_FORM_ID;
    if (!formId) return { ok: false, status: 500, detail: "Missing CONTACT_FORMSPREE_FORM_ID" };
    const res = await fetch(`https://formspree.io/f/${formId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...input, source: "pause-health-contact" })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.CONTACT_FROM_EMAIL;
    const to = process.env.CONTACT_TO_EMAIL;
    if (!apiKey || !from || !to) {
      return {
        ok: false,
        status: 500,
        detail: "Missing RESEND_API_KEY, CONTACT_FROM_EMAIL, or CONTACT_TO_EMAIL"
      };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: input.email,
        subject: `[Contact] ${input.subject || "New message"} — from ${input.name || input.email}`,
        text: `From: ${input.name} <${input.email}>\n\n${input.message}`
      })
    });
    return { ok: res.ok, status: res.status, detail: await safeJson(res) };
  }

  return { ok: false, status: 500, detail: `Unknown CONTACT_PROVIDER: ${provider}` };
}

export async function POST(request: Request) {
  let payload: {
    name?: string;
    email?: string;
    subject?: string;
    message?: string;
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
  const name = clean(payload.name, MAX_NAME);
  const subject = clean(payload.subject, MAX_SUBJECT);
  const message = clean(payload.message, MAX_MESSAGE);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Please provide a valid email." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Please provide your name." }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json(
      { error: "Please share a few sentences about what you need." },
      { status: 400 }
    );
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

  const result = await forwardContact({ name, email, subject, message });

  if (!result.ok) {
    console.error("[contact] provider error:", result.detail);
    return NextResponse.json(
      { error: "Sending failed. Please try again shortly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
