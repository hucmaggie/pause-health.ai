"use client";

import { useEffect, useState } from "react";

import { AgentforceEmbed } from "./agentforce-embed";
import type { AgentforceConfig } from "../lib/agentforce";
import { DEMO_COHORT, type DemoPersona } from "../lib/demo-cohort";

/**
 * "View as <patient>" stage above the live Agentforce widget.
 *
 * Picks a persona, fetches `/api/intake/prechat-context?personaId=...`,
 * then re-mounts <AgentforceEmbed/> keyed on the persona so the
 * Salesforce SDK boots fresh with that patient's hidden-prechat
 * dossier already loaded. The Service Agent walks into the chat
 * already knowing who the patient is and what their care state
 * looks like.
 *
 * Why re-key the embed instead of swapping fields mid-conversation:
 * the Salesforce Embedded Messaging SDK is process-global and
 * sticky. There is no public API to swap conversation context
 * after init; the supported pattern is "configure once, before
 * onEmbeddedMessagingReady fires." Re-keying React forces the
 * component (and the SDK's view) to remount cleanly.
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

export function IntakePatientStage({ agentforceConfig }: Props) {
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PERSONA_ID);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });

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
        style={{ marginBottom: "1.25rem" }}
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
          aria-live="polite"
          style={{
            marginTop: "0.9rem",
            fontSize: "0.9rem",
            color: "var(--muted)"
          }}
        >
          {fetchState.status === "loading" && (
            <span>Resolving {selectedPersona?.firstName ?? "patient"} via Data 360…</span>
          )}
          {fetchState.status === "ready" && (
            <span>
              Resolved.{" "}
              <strong>
                Identity: {fetchState.identitySource} · Grounding:{" "}
                {fetchState.groundingSource}
              </strong>
              . {Object.keys(fetchState.fields).length} hidden-prechat fields
              will hand to Salesforce when you open the chat. The Agentforce
              Service Agent will see them as Conversation Variables.
            </span>
          )}
          {fetchState.status === "error" && (
            <span role="alert" style={{ color: "#ffb6c8" }}>
              Could not resolve prechat context: {fetchState.message}. The
              agent will still load, but without the pre-resolved dossier.
            </span>
          )}
        </div>

        {selectedPersona && (
          <p
            style={{
              marginTop: "0.6rem",
              fontSize: "0.88rem",
              color: "var(--muted)"
            }}
          >
            <em>Profile note (handed to the agent verbatim):</em>{" "}
            {selectedPersona.profileNote}
          </p>
        )}
      </article>

      <AgentforceEmbed
        // Re-keying on personaId forces a clean SDK remount so the
        // hidden-prechat fields for the newly-selected patient are
        // applied before onEmbeddedMessagingReady fires.
        key={selectedId}
        config={agentforceConfig}
        prechatFields={
          fetchState.status === "ready" ? fetchState.fields : null
        }
      />
    </>
  );
}
