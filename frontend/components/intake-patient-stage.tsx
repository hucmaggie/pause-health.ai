"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AgentforceEmbed } from "./agentforce-embed";
import { PreBriefPanel } from "./pre-brief-panel";
import type { AgentforceConfig } from "../lib/agentforce";
import {
  DEMO_COHORT,
  findDemoPersona,
  type DemoPersona
} from "../lib/demo-cohort";

/**
 * "View as <patient>" stage above the live Agentforce widget.
 *
 * Picks a persona, fetches `/api/intake/prechat-context?personaId=...`,
 * then renders the dossier as a visible <PreBriefPanel/> ABOVE the
 * <AgentforceEmbed/>. The clinician sees the same identity-resolved
 * Data 360 dossier (identity confidence, cohort percentile, care
 * program / care plan state, vasomotor/sleep/mood scores, narrative
 * profile note) before the conversation begins. The live Agentforce
 * agent answers menopause-care questions generically while the
 * personalization lives in the surrounding UI.
 *
 * Why a visible panel and not hidden prechat fields:
 *
 *   The Salesforce Embedded Messaging V2 SDK ships
 *   `embeddedservice_bootstrap.prechatAPI` as a no-op Proxy when the
 *   deployment hasn't fully wired the prechat-field surface server
 *   side. Calls to `setHiddenPrechatFields(...)` return `true` but
 *   no values actually traverse SCRT2; the routing Flow fires with
 *   all input variables null. Verified end-to-end on 2026-06-04 with
 *   the form-fields block + Publish + custom parameters + Flow input
 *   variables all correctly deployed. See docs/PHASE_3_RUNBOOK.md
 *   ("empty-Proxy prechatAPI" finding). Rather than ship a feature
 *   that quietly does nothing, we surface the dossier visibly.
 *
 *   The hidden-prechat plumbing (Pause_*__c custom fields on
 *   MessagingSession, the Pause_Intake_Prechat_Router routing Flow,
 *   the channel customParameters, the agent contextVariables) is
 *   left in place — it's harmless when unused and ready for the day
 *   Salesforce fixes the prechatAPI binding for V2 deployments.
 *
 * The component still re-keys the embed on persona change so the
 * SDK does a clean remount, which keeps the chat transcript in
 * sync with the currently-selected patient even though the
 * conversation context isn't being handed to the agent in-band.
 */

type PrechatFields = Record<string, string>;

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      fields: PrechatFields;
      identitySource: "real" | "mock";
      groundingSource: "real" | "mock";
    }
  | { status: "error"; message: string };

type Props = {
  agentforceConfig: AgentforceConfig;
};

const DEFAULT_PERSONA_ID = DEMO_COHORT[0]?.id ?? "anika-patel";

function IntakePatientStageInner({ agentforceConfig }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPersonaId = searchParams.get("personaId");

  const [selectedId, setSelectedId] = useState<string>(
    findDemoPersona(urlPersonaId ?? "")?.id ?? DEFAULT_PERSONA_ID
  );
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });

  // Sync selectedId -> URL (replace, not push, so back-button isn't
  // polluted with every persona click).
  useEffect(() => {
    const current = searchParams.get("personaId");
    if (current === selectedId) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("personaId", selectedId);
    router.replace(`/demo/intake?${params.toString()}`, { scroll: false });
  }, [selectedId, searchParams, router]);

  useEffect(() => {
    let cancelled = false;
    setFetchState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/intake/prechat-context?personaId=${encodeURIComponent(selectedId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `prechat-context failed (HTTP ${res.status}): ${text.slice(0, 200)}`
          );
        }
        const payload = (await res.json()) as {
          prechatFields: PrechatFields;
          meta: {
            _identitySource: "real" | "mock";
            _groundingSource: "real" | "mock";
          };
        };
        if (cancelled) return;
        setFetchState({
          status: "ready",
          fields: payload.prechatFields,
          identitySource: payload.meta._identitySource,
          groundingSource: payload.meta._groundingSource
        });
      } catch (err) {
        if (cancelled) return;
        setFetchState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedPersona: DemoPersona | undefined = DEMO_COHORT.find(
    (p) => p.id === selectedId
  );

  return (
    <>
      <article
        className="card"
        aria-label="View intake as patient"
        style={{ marginBottom: "1rem" }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p className="eyebrow">View intake as</p>
          <h3 style={{ margin: 0 }}>
            {selectedPersona
              ? `${selectedPersona.firstName} ${selectedPersona.lastName}`
              : "Select a demo patient"}
          </h3>
          {selectedPersona && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.92rem" }}>
              {selectedPersona.ageBand} · {selectedPersona.cycleStatus} ·{" "}
              primary symptom <strong>{selectedPersona.primarySymptom}</strong>
              {" · "}intake scores V{selectedPersona.vasomotorScore}/S
              {selectedPersona.sleepScore}/M{selectedPersona.moodScore}
            </p>
          )}
        </header>

        <div
          role="radiogroup"
          aria-label="Demo patient picker"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginTop: "0.8rem"
          }}
        >
          {DEMO_COHORT.map((persona) => {
            const isSelected = persona.id === selectedId;
            return (
              <button
                key={persona.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedId(persona.id)}
                className={isSelected ? "btn btn-primary" : "btn btn-secondary"}
                style={{
                  fontSize: "0.92rem",
                  padding: "0.45rem 0.8rem"
                }}
              >
                {persona.firstName} {persona.lastName}
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "0.9rem",
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap"
          }}
        >
          <a
            href={`/demo/patient?personaId=${encodeURIComponent(selectedId)}`}
            className="btn btn-secondary"
            style={{ fontSize: "0.88rem", padding: "0.4rem 0.75rem" }}
          >
            Open Care Detail →
          </a>
        </div>
      </article>

      <PreBriefPanel
        persona={selectedPersona}
        status={fetchState.status}
        fields={fetchState.status === "ready" ? fetchState.fields : undefined}
        identitySource={
          fetchState.status === "ready" ? fetchState.identitySource : undefined
        }
        groundingSource={
          fetchState.status === "ready" ? fetchState.groundingSource : undefined
        }
        errorMessage={
          fetchState.status === "error" ? fetchState.message : undefined
        }
        // The PreBriefPanel's compact switch-persona chip row drives
        // selectedId so picker, dossier fetch, and embedded chat all
        // re-key in sync. The selectedId -> URL sync useEffect above
        // also re-runs, so personaId stays accurate in the address
        // bar (and therefore in the shell nav).
        onSwitchPersona={setSelectedId}
        currentStage="intake"
      />

      <AgentforceEmbed
        // Re-keying on personaId forces a clean SDK remount, so each
        // patient switch starts a fresh conversation thread. We no
        // longer rely on prechatFields handing the dossier to the
        // agent in-band — see PreBriefPanel above and
        // components/pre-brief-panel.tsx for why.
        key={selectedId}
        config={agentforceConfig}
        prechatFields={null}
      />
    </>
  );
}

export function IntakePatientStage(props: Props) {
  return (
    <Suspense
      fallback={
        <p style={{ color: "var(--muted)" }}>Loading intake stage…</p>
      }
    >
      <IntakePatientStageInner {...props} />
    </Suspense>
  );
}
