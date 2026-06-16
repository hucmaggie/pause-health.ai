"use client";

import { useEffect, useState } from "react";

import {
  PATHWAY_LABELS,
  PATHWAY_TARGETS,
  type CareRouterPathway
} from "../lib/care-router-pathways";
import {
  RecommendedProviders,
  type RecommendedProviderEntry
} from "./recommended-providers";

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
                    npi: typeof e.npi === "string" ? e.npi : undefined,
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
                      : [],
                    insuranceAccepted: Array.isArray(e.insuranceAccepted)
                      ? (e.insuranceAccepted as unknown[]).filter(
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
      <RecommendedProviders
        providers={decision.recommendedProviders.providers}
        source={decision.recommendedProviders.source}
      />
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
