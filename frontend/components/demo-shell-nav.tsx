"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * Persona-preserving in-page navigation for the /demo/* shell.
 *
 * Why this exists: every persona-aware stage (intake, patient,
 * routing) keeps `?personaId=` in sync with its local picker via
 * router.replace(). But the shell's top nav was previously rendered
 * server-side with hardcoded hrefs like `/demo/patient`, so clicking
 * from "Care Detail" to "Care Routing" silently dropped the persona
 * context.
 *
 * The fix is small but high-leverage: append the current URL's
 * `?personaId=` to each shell link so persona survives every tab
 * click. We carry through any other simple URL params (e.g.
 * ?taskId= on /demo/agent-fabric) as well, since they're cheap and
 * often the user wants them preserved.
 *
 * useSearchParams() suspends during streaming render, so the
 * shell wraps this in a <Suspense> boundary with a server-rendered
 * fallback (the same nav links without persona threading).
 */

const LINKS = [
  { href: "/demo/intake", label: "Signal Intake" },
  { href: "/demo/patient", label: "Care Detail" },
  { href: "/demo/routing", label: "Care Routing" },
  { href: "/demo/analytics", label: "Outcome Analytics" },
  { href: "/demo/agent-fabric", label: "Agent Fabric" }
] as const;

/**
 * URL params that should ride along with shell-nav clicks.
 *
 * - personaId   : the big one. Anchors all patient-facing stages.
 * - taskId      : agent-fabric trace anchor. Useful so a user who
 *                 pivoted from /demo/routing to /demo/agent-fabric
 *                 with a specific trace open can pop back to
 *                 /demo/analytics and the URL still records which
 *                 trace they were inspecting (analytics doesn't use
 *                 it today, but it's harmless to carry).
 */
const PRESERVED_PARAMS = ["personaId", "taskId"] as const;

function PersonaPreservingNavInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const preserved = new URLSearchParams();
  for (const key of PRESERVED_PARAMS) {
    const value = searchParams.get(key);
    if (value) preserved.set(key, value);
  }
  const suffix = preserved.toString();

  return (
    <nav className="demo-nav" aria-label="Prototype pages">
      {LINKS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <a
            key={item.href}
            href={suffix ? `${item.href}?${suffix}` : item.href}
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
    <nav className="demo-nav" aria-label="Prototype pages">
      {LINKS.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function DemoShellNav() {
  return (
    <Suspense fallback={<StaticFallbackNav />}>
      <PersonaPreservingNavInner />
    </Suspense>
  );
}
