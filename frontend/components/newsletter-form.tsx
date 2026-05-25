"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Toast } from "./toast";

type Status = "idle" | "submitting" | "success" | "error";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "invisible";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const renderedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    renderedAtRef.current = Date.now();
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
    setMessage(null);

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: honeypot,
          turnstileToken,
          renderedAt: renderedAtRef.current
        })
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!res.ok) {
        setStatus("error");
        setMessage(data?.error || "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      setMessage("Thanks — you're on the list.");
      setToast("Subscribed. Look out for our next update.");
      setEmail("");
      if (TURNSTILE_SITE_KEY && window.turnstile && turnstileWidgetId.current) {
        window.turnstile.reset(turnstileWidgetId.current);
        setTurnstileToken(null);
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  const requireTurnstile = Boolean(TURNSTILE_SITE_KEY);

  return (
    <>
      <form
        className="site-footer-newsletter"
        onSubmit={handleSubmit}
        aria-label="Newsletter signup"
        noValidate
      >
        <label htmlFor="footer-email" className="site-footer-newsletter-label">
          Stay in the loop
        </label>
        <div className="site-footer-newsletter-row">
          <input
            id="footer-email"
            type="email"
            name="email"
            required
            placeholder="you@clinic.org"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "submitting"}
            aria-describedby="footer-email-status"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              status === "submitting" || !email || (requireTurnstile && !turnstileToken)
            }
          >
            {status === "submitting" ? "Subscribing…" : "Subscribe"}
          </button>
        </div>

        <div className="hp-field" aria-hidden="true">
          <label htmlFor="hp-website">Website</label>
          <input
            id="hp-website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {requireTurnstile ? (
          <div ref={turnstileContainerRef} className="cf-turnstile-slot" />
        ) : null}

        <p
          id="footer-email-status"
          className="site-footer-newsletter-hint"
          role={status === "error" ? "alert" : undefined}
          data-status={status}
        >
          {message ?? "Monthly notes on menopause AI, clinical evidence, and product updates."}
        </p>
      </form>

      <Toast message={toast} onDismiss={dismissToast} />
    </>
  );
}
