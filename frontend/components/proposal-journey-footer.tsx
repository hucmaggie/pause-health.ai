"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";

import { proposalSections } from "./proposal-shell";

/**
 * Linear prev/next journey footer for the /proposal/* investor briefs.
 *
 * This is the brief-side analog of persona-journey-footer.tsx on the
 * demo console. The reasoning is the same: keep readers oriented and
 * moving forward without asking them to scroll back to the shell-nav
 * every time they finish a brief.
 *
 * Two shape differences from the console footer:
 *
 *   1. There's no persona anchor to carry across pages, so we don't
 *      touch useSearchParams — usePathname() alone tells us where we
 *      are in the linear proposalSections order.
 *
 *   2. There's no "switch persona" chip row. Instead we surface a
 *      compact "jump to any brief" affordance below the prev/next
 *      pair, because 15 briefs is too many for a full chip row but
 *      too few to make readers hunt back up the page.
 *
 * The footer is mounted from inside ProposalShell by default so we
 * don't have to touch all 18 proposal pages. ProposalShell exposes
 * a `showJourneyFooter={false}` escape hatch for pages like
 * /proposal (the hub) and /proposal/full (the single-page rollup)
 * where a per-brief prev/next doesn't map cleanly onto the layout.
 */

function findIndex(pathname: string | null): number {
  if (!pathname) return -1;
  return proposalSections.findIndex((s) => s.href === pathname);
}

function ProposalJourneyFooterInner() {
  const pathname = usePathname();
  const currentIdx = findIndex(pathname);

  // If we can't locate the current page in the section list, render
  // nothing — this keeps the footer inert on pages that were added
  // to /proposal/* but aren't part of the numbered section walk
  // (e.g. /proposal/full, /proposal/headless-360 pre-linkage).
  if (currentIdx === -1) return null;

  const prev = currentIdx > 0 ? proposalSections[currentIdx - 1] : null;
  const next =
    currentIdx < proposalSections.length - 1
      ? proposalSections[currentIdx + 1]
      : null;
  const current = proposalSections[currentIdx];

  return (
    <article
      className="card proposal-journey-footer"
      style={{
        marginTop: "1.5rem",
        marginBottom: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "baseline",
          justifyContent: "space-between"
        }}
      >
        <div>
          <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
            Continuing the investor brief
          </p>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{current.label}</h3>
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            alignItems: "center",
            color: "var(--muted)",
            fontSize: "0.82rem"
          }}
        >
          <span>Brief</span>
          <strong style={{ color: "var(--text)" }}>
            {currentIdx + 1} of {proposalSections.length}
          </strong>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "0.75rem"
        }}
      >
        {prev ? (
          <a
            href={prev.href}
            className="btn btn-secondary"
            style={{
              padding: "0.75rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.2rem",
              textAlign: "left",
              alignItems: "flex-start"
            }}
          >
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              ← Previous brief
            </span>
            <strong style={{ fontSize: "0.98rem" }}>{prev.label}</strong>
          </a>
        ) : (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius)",
              border: "1px dashed rgba(255,255,255,0.08)",
              color: "var(--muted)",
              fontSize: "0.82rem",
              display: "flex",
              alignItems: "center"
            }}
          >
            You&apos;re at the first brief. Start of the investor thesis.
          </div>
        )}
        {next ? (
          <a
            href={next.href}
            className="btn btn-primary"
            style={{
              padding: "0.75rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.2rem",
              textAlign: "left",
              alignItems: "flex-start"
            }}
          >
            <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>
              Next brief →
            </span>
            <strong style={{ fontSize: "0.98rem" }}>{next.label}</strong>
          </a>
        ) : (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius)",
              border: "1px dashed rgba(255,255,255,0.08)",
              color: "var(--muted)",
              fontSize: "0.82rem",
              display: "flex",
              alignItems: "center"
            }}
          >
            You&apos;ve reached the last brief. Head back to the hub for
            the full picture, or open the prototype to see it in motion.
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          alignItems: "center",
          paddingTop: "0.5rem",
          borderTop: "1px solid rgba(255,255,255,0.06)"
        }}
      >
        <span
          style={{
            fontSize: "0.82rem",
            color: "var(--muted)",
            marginRight: "0.3rem"
          }}
        >
          Jump to another brief:
        </span>
        {proposalSections
          .filter((_, i) => i !== currentIdx)
          .slice(0, 8)
          .map((other) => (
            <a
              key={other.href}
              href={other.href}
              className="btn btn-secondary"
              style={{
                fontSize: "0.78rem",
                padding: "0.3rem 0.65rem"
              }}
            >
              {other.label}
            </a>
          ))}
      </div>
    </article>
  );
}

function ProposalJourneyFooterFallback() {
  return (
    <article
      className="card proposal-journey-footer"
      style={{ marginTop: "1.5rem", marginBottom: "1.25rem" }}
    >
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Loading brief navigation…
      </p>
    </article>
  );
}

export function ProposalJourneyFooter() {
  return (
    <Suspense fallback={<ProposalJourneyFooterFallback />}>
      <ProposalJourneyFooterInner />
    </Suspense>
  );
}
