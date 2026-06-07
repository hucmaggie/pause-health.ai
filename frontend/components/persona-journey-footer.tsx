"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { DEMO_COHORT, findDemoPersona, type DemoPersona } from "../lib/demo-cohort";

/**
 * Persona-aware journey footer shared across the five /demo/* pages.
 *
 * Why this exists:
 *
 * Before this footer, each /demo/* page had its own ad-hoc set of
 * bottom CTAs:
 *   - /demo/intake had an inline "Open Care Detail" link tucked
 *     into the persona-picker card (easy to miss).
 *   - /demo/patient had "Continue to Routing" + "Back to Intake".
 *   - /demo/routing had "Back to Care Detail" + (optionally)
 *     "View the trace".
 *   - /demo/agent-fabric had no footer.
 *   - /demo/analytics had no footer.
 *
 * Three problems with that:
 *   1. Inconsistent visual position -- on some pages the next-step
 *      link was at the top, on others at the bottom, on others
 *      nowhere at all.
 *   2. No persona-attribution context. Once the user clicked
 *      "Continue", they had to remember which patient they were
 *      tracking.
 *   3. No way to switch personas without backtracking to /demo/intake.
 *
 * This component solves all three. Every /demo/* page mounts the
 * same footer at the bottom. The footer:
 *
 *   - Shows the active persona (name + 1-line context) so the
 *     user always knows which patient's journey they're walking.
 *   - Renders contextual prev / next CTAs that preserve
 *     ?personaId= so persona context survives every click.
 *   - Offers a "switch persona" chip row to swap patients without
 *     leaving the page.
 *
 * The journey order is:
 *
 *     intake -> patient -> routing -> agent-fabric -> analytics
 *
 * Intake has no prev (it's the entry point). Analytics has no next
 * (it's the exit). Agent Fabric is the last span-level view before
 * the cohort-level analytics view.
 *
 * useSearchParams() suspends during streaming render, so the
 * exported PersonaJourneyFooter wraps the inner component in a
 * <Suspense> boundary with a small fallback. If for any reason
 * useSearchParams() never resolves a personaId (e.g. user landed
 * on /demo/patient directly with no query string), the footer
 * falls back to DEMO_COHORT[0] (anika-patel) so the journey
 * affordances still render with a sensible default rather than
 * disappearing.
 */

type Stage = "intake" | "patient" | "routing" | "agent-fabric" | "analytics";

type StageDescriptor = {
  id: Stage;
  href: string;
  label: string;
  /** One-line description of what this stage does. */
  shortBlurb: string;
};

const STAGE_ORDER: StageDescriptor[] = [
  {
    id: "intake",
    href: "/demo/intake",
    label: "Signal Intake",
    shortBlurb: "Patient completes the menopause intake form."
  },
  {
    id: "patient",
    href: "/demo/patient",
    label: "Care Detail",
    shortBlurb: "Federated patient record + intake dossier."
  },
  {
    id: "routing",
    href: "/demo/routing",
    label: "Care Routing",
    shortBlurb: "Care Router decides the pathway."
  },
  {
    id: "agent-fabric",
    href: "/demo/agent-fabric",
    label: "Agent Fabric",
    shortBlurb: "Multi-agent trace of the routing decision."
  },
  {
    id: "analytics",
    href: "/demo/analytics",
    label: "Outcome Analytics",
    shortBlurb: "Cohort-level metrics; scoped to persona when set."
  }
];

function withPersonaId(href: string, personaId: string | null): string {
  if (!personaId) return href;
  const url = new URL(href, "https://placeholder.example");
  url.searchParams.set("personaId", personaId);
  return `${url.pathname}${url.search}`;
}

function PersonaJourneyFooterInner({ stage }: { stage: Stage }) {
  const searchParams = useSearchParams();
  const urlPersonaId = searchParams.get("personaId");
  const persona: DemoPersona =
    findDemoPersona(urlPersonaId ?? "") ??
    DEMO_COHORT[0] ?? // anika-patel fallback
    ({
      id: "anika-patel",
      firstName: "Anika",
      lastName: "Patel"
    } as DemoPersona);

  const currentIdx = STAGE_ORDER.findIndex((s) => s.id === stage);
  const prev = currentIdx > 0 ? STAGE_ORDER[currentIdx - 1] : null;
  const next =
    currentIdx >= 0 && currentIdx < STAGE_ORDER.length - 1
      ? STAGE_ORDER[currentIdx + 1]
      : null;

  const otherPersonas = DEMO_COHORT.filter((p) => p.id !== persona.id);

  return (
    <article
      className="card persona-journey-footer"
      style={{
        marginTop: "1.5rem",
        marginBottom: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      {/* Top row: active persona + journey position */}
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
            Continuing the journey for
          </p>
          <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
            {persona.firstName} {persona.lastName}
          </h3>
          <p
            style={{
              margin: "0.2rem 0 0",
              color: "var(--muted)",
              fontSize: "0.88rem"
            }}
          >
            {persona.ageBand} · {persona.cycleStatus} · {persona.primarySymptom}
          </p>
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
          <span>Stage</span>
          <strong style={{ color: "var(--text)" }}>
            {currentIdx + 1} of {STAGE_ORDER.length}
          </strong>
          <span>·</span>
          <strong style={{ color: "var(--text)" }}>
            {STAGE_ORDER[currentIdx]?.label ?? "—"}
          </strong>
        </div>
      </header>

      {/* Middle row: prev / next nav CTAs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "0.75rem"
        }}
      >
        {prev ? (
          <a
            href={withPersonaId(prev.href, persona.id)}
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
              ← Previous stage
            </span>
            <strong style={{ fontSize: "0.98rem" }}>{prev.label}</strong>
            <span
              style={{
                fontSize: "0.8rem",
                color: "var(--muted)",
                fontWeight: 400
              }}
            >
              {prev.shortBlurb}
            </span>
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
            You&apos;re at the start of the journey. The patient hasn&apos;t
            completed intake yet.
          </div>
        )}
        {next ? (
          <a
            href={withPersonaId(next.href, persona.id)}
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
              Next stage →
            </span>
            <strong style={{ fontSize: "0.98rem" }}>{next.label}</strong>
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: 400,
                opacity: 0.9
              }}
            >
              {next.shortBlurb}
            </span>
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
            You&apos;ve reached cohort-level analytics — the end of the
            persona journey. Switch persona below to walk another patient
            through.
          </div>
        )}
      </div>

      {/* Bottom row: switch-persona chips */}
      {otherPersonas.length > 0 && (
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
            Or switch persona on this page:
          </span>
          {otherPersonas.map((other) => (
            <a
              key={other.id}
              href={withPersonaId(STAGE_ORDER[currentIdx]?.href ?? "/demo/intake", other.id)}
              className="btn btn-secondary"
              style={{
                fontSize: "0.78rem",
                padding: "0.3rem 0.65rem"
              }}
              title={`${other.firstName} ${other.lastName} · ${other.ageBand} · ${other.cycleStatus} · ${other.primarySymptom}`}
            >
              {other.firstName}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function PersonaJourneyFooterFallback() {
  return (
    <article
      className="card persona-journey-footer"
      style={{ marginTop: "1.5rem", marginBottom: "1.25rem" }}
    >
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
        Loading journey context…
      </p>
    </article>
  );
}

export function PersonaJourneyFooter({ stage }: { stage: Stage }) {
  return (
    <Suspense fallback={<PersonaJourneyFooterFallback />}>
      <PersonaJourneyFooterInner stage={stage} />
    </Suspense>
  );
}
