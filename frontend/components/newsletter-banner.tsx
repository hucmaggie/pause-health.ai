"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "ph_newsletter_banner_dismissed_v1";

export function NewsletterBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(DISMISS_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore storage errors */
    }
  }

  function scrollToForm(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const el = document.getElementById("footer-email");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        try {
          (el as HTMLInputElement).focus({ preventScroll: true });
        } catch {
          (el as HTMLInputElement).focus();
        }
      }, 400);
    }
  }

  if (!visible) return null;

  return (
    <div className="newsletter-banner" role="region" aria-label="Newsletter promotion">
      <div className="container newsletter-banner-row">
        <p>
          <strong>Subscribe to our newsletter</strong> &mdash; monthly notes on menopause AI,
          clinical evidence, and product updates.
        </p>
        <div className="newsletter-banner-actions">
          <a href="#footer-email" className="btn btn-primary" onClick={scrollToForm}>
            Subscribe
          </a>
          <button
            type="button"
            className="newsletter-banner-dismiss"
            aria-label="Dismiss newsletter banner"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
