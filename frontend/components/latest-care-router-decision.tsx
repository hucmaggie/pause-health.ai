"use client";

import { useEffect, useState } from "react";

import {
  PATHWAY_LABELS,
  PATHWAY_TARGETS,
  type CareRouterPathway
} from "../lib/care-router-pathways";

type RecommendedProviderEntry = {
  name: string;
  specialty?: string;
  city?: string;
  state?: string;
  telehealth?: boolean;
  distanceMiles?: number | null;
  serviceSignals?: string[];
};

// Plain-English labels for the public-registry signal tokens. Anything not in
// this map renders as the raw token in lowercase — fine, since the agent and
// the UI both prefer the human label when one exists.
const SIGNAL_LABELS: Record<string, string> = {
  facog: "Board-cert OB/GYN",
  faafp: "Board-cert family med",
  face: "Board-cert endocrinology",
  facp: "Board-cert internal med",
  whnp: "Women's Health NP",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty"
};

type LatestDecision = {
  pathway: string;
  pathwayLabel: string;
  acuity: string;
  rationale: string[];
  recommendedTargetResponse: string;
  modelProvenance: { provider: string; model: string; via: string };
  recommendedProviders: {
    source: string | null;
    providers: RecommendedProviderEntry[];
  };
  taskId: string;
};

export function LatestCareRouterDecision() {
  const [decision, setDecision] = useState<LatestDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const idxRes = await fetch("/api/agent-fabric/traces", { cache: "no-store" });
        const idxData = (await idxRes.json()) as { recentTaskIds?: string[] };
        const taskIds = idxData.recentTaskIds ?? [];
        for (const tid of taskIds) {
          const spanRes = await fetch(
            `/api/agent-fabric/traces?taskId=${encodeURIComponent(tid)}`,
            { cache: "no-store" }
          );
          const spanData = (await spanRes.json()) as {
            traces?: Array<{
              agentId: string;
              attributes?: Record<string, unknown>;
              status: string;
            }>;
          };
          const routerSpan = spanData.traces?.find(
            (s) => s.agentId === "care-router-claude" && s.status === "ok"
          );
          if (routerSpan && routerSpan.attributes) {
            const attrs = routerSpan.attributes as Record<string, unknown>;
            const pathway = typeof attrs.pathway === "string" ? attrs.pathway : null;
            if (!pathway) continue;
            const pw = pathway as CareRouterPathway;
            if (cancelled) return;
            // Prefer the richer `recommendedProviders` attribute; fall back
            // to `recommendedProviderNames` for traces written before that
            // field shipped (only the name+specialty string is recoverable
            // from the legacy shape).
            const richProviders: RecommendedProviderEntry[] = Array.isArray(
              attrs.recommendedProviders
            )
              ? (attrs.recommendedProviders as unknown[])
                  .filter(
                    (e): e is Record<string, unknown> =>
                      typeof e === "object" && e !== null
                  )
                  .map((e) => ({
                    name: typeof e.name === "string" ? e.name : "",
                    specialty:
                      typeof e.specialty === "string" ? e.specialty : undefined,
                    city: typeof e.city === "string" ? e.city : undefined,
                    state: typeof e.state === "string" ? e.state : undefined,
                    telehealth:
                      typeof e.telehealth === "boolean" ? e.telehealth : undefined,
                    distanceMiles:
                      typeof e.distanceMiles === "number"
                        ? e.distanceMiles
                        : null,
                    serviceSignals: Array.isArray(e.serviceSignals)
                      ? (e.serviceSignals as unknown[]).filter(
                          (s): s is string => typeof s === "string"
                        )
                      : []
                  }))
                  .filter((p) => p.name.length > 0)
              : Array.isArray(attrs.recommendedProviderNames)
                ? (attrs.recommendedProviderNames as unknown[])
                    .filter((n): n is string => typeof n === "string")
                    .map((label) => ({ name: label }))
                : [];
            setDecision({
              pathway,
              pathwayLabel: PATHWAY_LABELS[pw] ?? pathway,
              acuity: typeof attrs.acuity === "string" ? attrs.acuity : "routine",
              rationale: [],
              recommendedTargetResponse: PATHWAY_TARGETS[pw] ?? "",
              recommendedProviders: {
                source:
                  typeof attrs.recommendedProvidersSource === "string"
                    ? (attrs.recommendedProvidersSource as string)
                    : null,
                providers: richProviders
              },
              modelProvenance: {
                provider:
                  typeof attrs.provider === "string"
                    ? (attrs.provider as string)
                    : "pause-scripted",
                model:
                  typeof attrs.model === "string"
                    ? (attrs.model as string)
                    : "pause-care-router-policy@1.0",
                via:
                  typeof attrs.via === "string"
                    ? (attrs.via as string)
                    : "scripted-fallback"
              },
              taskId: tid
            });
            return;
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    load();
    const handle = setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  if (error) {
    return (
      <article className="card">
        <p className="eyebrow">Latest Care Router decision</p>
        <p style={{ color: "var(--muted)", marginTop: "0.4rem" }}>
          Could not load the latest Care Router decision ({error}). Run a fresh
          intake from <a href="/demo/intake">/demo/intake</a> and the result will
          appear here.
        </p>
      </article>
    );
  }

  if (!decision) {
    return (
      <article className="card">
        <p className="eyebrow">Latest Care Router decision</p>
        <p style={{ color: "var(--muted)", marginTop: "0.4rem" }}>
          Loading the most recent decision from the Pause Agent Fabric…
        </p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="eyebrow">Latest Care Router decision (live)</p>
      <h3 style={{ marginTop: "0.4rem" }}>{decision.pathwayLabel}</h3>
      <p
        style={{
          color: "var(--brand)",
          fontWeight: 600,
          fontSize: "0.85rem",
          marginBottom: "0.4rem"
        }}
      >
        Acuity: {decision.acuity} · Target response:{" "}
        {decision.recommendedTargetResponse}
      </p>
      <p style={{ fontSize: "0.85rem" }}>
        Decided by <code>{decision.modelProvenance.provider}</code> /{" "}
        <code>{decision.modelProvenance.model}</code> (
        {decision.modelProvenance.via}).
      </p>
      {decision.recommendedProviders.providers.length > 0 && (
        <div
          style={{
            marginTop: "0.6rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid var(--border, rgba(0,0,0,0.08))"
          }}
        >
          <p
            style={{
              color: "var(--brand)",
              fontWeight: 600,
              fontSize: "0.8rem",
              marginBottom: "0.3rem"
            }}
          >
            Provider graph · MSCP recommendations
            {decision.recommendedProviders.source
              ? ` (${
                  decision.recommendedProviders.source === "live"
                    ? "live MuleSoft directory"
                    : "NPPES-derived directory"
                })`
              : ""}
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
            {decision.recommendedProviders.providers.map((p) => {
              const meta: string[] = [];
              if (p.city && p.state) meta.push(`${p.city}, ${p.state}`);
              if (typeof p.distanceMiles === "number") {
                // Tight rounding for the chip — the source value is already
                // 0.1-mi-precision, but a single decimal reads cleaner inline.
                const miles = Math.round(p.distanceMiles * 10) / 10;
                meta.push(`${miles} mi away`);
              }
              if (p.telehealth) meta.push("telehealth");
              const signals = p.serviceSignals ?? [];
              return (
                <li key={`${p.name}-${p.city ?? ""}`} style={{ marginBottom: "0.25rem" }}>
                  {p.specialty ? `${p.name} · ${p.specialty}` : p.name}
                  {meta.length > 0 ? (
                    <span style={{ color: "var(--muted)", marginLeft: "0.4rem" }}>
                      ({meta.join(" · ")})
                    </span>
                  ) : null}
                  {signals.length > 0 ? (
                    <span style={{ marginLeft: "0.4rem", display: "inline-flex", gap: "0.3rem", flexWrap: "wrap" }}>
                      {signals.map((s) => (
                        <span
                          key={s}
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.05rem 0.4rem",
                            borderRadius: "999px",
                            background: "rgba(0, 122, 158, 0.08)",
                            color: "var(--brand)",
                            border: "1px solid rgba(0, 122, 158, 0.2)"
                          }}
                        >
                          {SIGNAL_LABELS[s] ?? s}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p style={{ marginTop: "0.6rem" }}>
        <a
          href={`/demo/agent-fabric?taskId=${encodeURIComponent(decision.taskId)}`}
          className="btn btn-secondary"
        >
          View multi-agent trace
        </a>
      </p>
    </article>
  );
}
