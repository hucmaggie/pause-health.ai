"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Toast } from "./toast";

type Status = "idle" | "submitting" | "success" | "error";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type ContactFormProps = {
  defaultSubject?: string;
  defaultMessage?: string;
};

export function ContactForm({ defaultSubject = "", defaultMessage = "" }: ContactFormProps = {}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [status, setStatus] = useState<Status>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const renderedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    renderedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qSubject = params.get("subject");
    const qMessage = params.get("message");
    if (qSubject) setSubject(qSubject);
    if (qMessage) setMessage(qMessage);
    if (qSubject || qMessage) {
      const el = document.getElementById("contact-name");
      window.setTimeout(() => el?.focus(), 50);
    }
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const id = "cf-turnstile-script";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    const t = window.setInterval(() => {
      if (window.turnstile && turnstileContainerRef.current && !turnstileWidgetId.current) {
        turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "compact",
          callback: (token) => setTurnstileToken(token),
          "error-callback": () => setTurnstileToken(null),
          "expired-callback": () => setTurnstileToken(null)
        });
        window.clearInterval(t);
      }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const honeypot = (
      (event.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value || ""
    ).trim();

    setStatus("submitting");
    setHint(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
          website: honeypot,
          turnstileToken,
          renderedAt: renderedAtRef.current
        })
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!res.ok) {
        setStatus("error");
        setHint(data?.error || "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      setHint("Thanks — we'll be in touch.");
      setToast("Message sent. We typically reply within two business days.");
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      if (TURNSTILE_SITE_KEY && window.turnstile && turnstileWidgetId.current) {
        window.turnstile.reset(turnstileWidgetId.current);
        setTurnstileToken(null);
      }
    } catch {
      setStatus("error");
      setHint("Network error. Please try again.");
    }
  }

  const requireTurnstile = Boolean(TURNSTILE_SITE_KEY);
  const submitDisabled =
    status === "submitting" ||
    !name.trim() ||
    !email.trim() ||
    message.trim().length < 10 ||
    (requireTurnstile && !turnstileToken);

  return (
    <>
      <form
        className="contact-form"
        onSubmit={handleSubmit}
        aria-label="Contact form"
        noValidate
      >
        <div className="contact-form-row">
          <label htmlFor="contact-name">
            <span>Name</span>
            <input
              id="contact-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={status === "submitting"}
            />
          </label>
          <label htmlFor="contact-email">
            <span>Email</span>
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "submitting"}
            />
          </label>
        </div>

        <label htmlFor="contact-subject">
          <span>Subject</span>
          <input
            id="contact-subject"
            name="subject"
            type="text"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={status === "submitting"}
            placeholder="e.g. Provider pilot inquiry"
          />
        </label>

        <label htmlFor="contact-message">
          <span>Message</span>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={6}
            maxLength={5000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={status === "submitting"}
            placeholder="A few sentences about what you're hoping to discuss."
          />
        </label>

        <div className="hp-field" aria-hidden="true">
          <label htmlFor="hp-website-contact">Website</label>
          <input
            id="hp-website-contact"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {requireTurnstile ? (
          <div ref={turnstileContainerRef} className="cf-turnstile-slot" />
        ) : null}

        <div className="contact-form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitDisabled}>
            {status === "submitting" ? "Sending…" : "Send Message"}
          </button>
          <p
            className="contact-form-hint"
            data-status={status}
            role={status === "error" ? "alert" : undefined}
          >
            {hint ?? "We typically respond within two business days."}
          </p>
        </div>
      </form>

      <Toast message={toast} onDismiss={dismissToast} />
    </>
  );
}
