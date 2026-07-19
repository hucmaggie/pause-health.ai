"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { proposalSections } from "./proposal-shell";

/**
 * In-page navigation for the /proposal/* investor-brief shell.
 *
 * Mirrors demo-shell-nav.tsx so the console and the briefs feel like
 * one product: the same server-rendered fallback for streaming, the
 * same Suspense-wrapped useSearchParams() call for URL-param
 * preservation, and the same aria-current="page" hook the demo nav
 * now uses to highlight the active section.
 *
 * URL-param preservation exists so any deep-link a reader arrives on
 * (e.g. /proposal/agent-fabric?highlight=governance) doesn't get its
 * context stripped the moment they click a sibling brief. The list of
 * preserved keys is deliberately small — we don't want to accidentally
 * carry per-page state onto a page that would misinterpret it.
 *
 * Active-section highlighting uses usePathname() rather than a prop
 * because the shell itself is server-rendered and we want the highlight
 * to be automatic on every page. The href-vs-pathname match is exact:
 * /proposal/customers highlights the "Customer Selection" link but
 * NOT the /proposal index or /proposal/full rollup.
 */

const PRESERVED_PARAMS = ["highlight", "personaId"] as const;

function ProposalShellNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preserved = new URLSearchParams();
  for (const key of PRESERVED_PARAMS) {
    const value = searchParams.get(key);
    if (value) preserved.set(key, value);
  }
  const suffix = preserved.toString();

  return (
    <nav className="demo-nav" aria-label="Investor proposal sections">
      {proposalSections.map((item) => {
        const href = suffix ? `${item.href}?${suffix}` : item.href;
        const isActive = pathname === item.href;
        return (
          <a
            key={item.href}
            href={href}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function StaticFallbackNav() {
  return (
    <nav className="demo-nav" aria-label="Investor proposal sections">
      {proposalSections.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function ProposalShellNav() {
  return (
    <Suspense fallback={<StaticFallbackNav />}>
      <ProposalShellNavInner />
    </Suspense>
  );
}
