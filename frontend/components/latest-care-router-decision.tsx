"use client";

import { useEffect, useState } from "react";

type LatestDecision = {
  pathway: string;
  pathwayLabel: string;
  acuity: string;
  rationale: string[];
  recommendedTargetResponse: string;
  modelProvenance: { provider: string; model: string; via: string };
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
            const PATHWAY_LABELS: Record<string, string> = {
              "self-care-tracking": "Self-care + symptom tracking",
              "mscp-virtual-visit": "Menopause specialist (virtual)",
              "mscp-in-person": "Menopause specialist (in person)",
              "urgent-gynecology": "Urgent gynecology review",
              "behavioral-health-handoff": "Behavioral health handoff",
              "ed-referral": "Emergency department"
            };
            const PATHWAY_TARGETS: Record<string, string> = {
              "self-care-tracking": "Self-paced; wearable + symptom tracker enabled",
              "mscp-virtual-visit": "< 7 days",
              "mscp-in-person": "< 14 days",
              "urgent-gynecology": "< 24h",
              "behavioral-health-handoff": "Same day",
              "ed-referral": "Immediate (call 911 or go to ED)"
            };
            if (cancelled) return;
            setDecision({
              pathway,
              pathwayLabel: PATHWAY_LABELS[pathway] ?? pathway,
              acuity: typeof attrs.acuity === "string" ? attrs.acuity : "routine",
              rationale: [],
              recommendedTargetResponse: PATHWAY_TARGETS[pathway] ?? "",
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
