"use client";

import { useCallback, useEffect, useState } from "react";

type NavLink = { href: string; label: string; external?: boolean };

const links: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/proposal", label: "Investor Brief" },
  { href: "/demo/intake", label: "Prototype" },
  {
    href: "https://github.com/hucmaggie/pause-health.ai",
    label: "Code Repository",
    external: true
  }
];

const PANEL_ID = "mobile-nav-panel";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`mobile-nav-burger${open ? " is-open" : ""}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div
          className="mobile-nav-scrim"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <nav
        id={PANEL_ID}
        className={`mobile-nav-panel${open ? " is-open" : ""}`}
        aria-label="Primary mobile"
        aria-hidden={!open}
      >
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={close}
                {...(link.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
