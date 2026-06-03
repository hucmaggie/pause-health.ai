"use client";

import { useEffect, useRef, useState } from "react";

import { AGENTFORCE_COPY, type AgentforceConfig } from "../lib/agentforce";

/**
 * Salesforce Embedded Messaging for Web — inline-mode mount.
 *
 * Loads the deployment-specific bootstrap.min.js, configures inline
 * display mode with a target element under our control, and calls
 * embeddedservice_bootstrap.init with the four values from
 * `lib/agentforce.getAgentforceConfig()`.
 *
 * Matches the Salesforce Enhanced Chat v2 inline-mode pattern:
 * https://developer.salesforce.com/docs/ai/agentforce/guide/enhanced-chat-inline-mode.html
 *
 * Notes:
 *   - All four config values are public deployment metadata (they ship
 *     in the Salesforce-provided snippet). They do not grant API access.
 *   - We mount once per page lifecycle. If a customer SPA navigates away
 *     and back, the script is already loaded; we no-op the second mount.
 *   - When `prechatFields` is supplied, we call
 *     `embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields()`
 *     inside the `onEmbeddedMessagingReady` handler — which is the only
 *     window in which Salesforce accepts hidden-field assignment (after
 *     the SDK is ready, before the conversation begins). The fields
 *     then surface to the Agentforce Service Agent as Conversation
 *     Variables so the agent walks in pre-grounded.
 *   - To switch between patients in the same browser session, the
 *     parent must re-mount this component (e.g. via React key). The
 *     Salesforce SDK is global, sticky-state, and intentionally does
 *     not expose a swap-fields-mid-conversation API.
 */

type PrechatFields = Record<string, string>;

declare global {
  interface Window {
    embeddedservice_bootstrap?: {
      settings: {
        language?: string;
        displayMode?: "inline" | "floating";
        targetElement?: HTMLElement | null;
        hideChatButtonOnLoad?: boolean;
        headerEnabled?: boolean;
      };
      init: (
        orgId: string,
        deploymentApiName: string,
        siteUrl: string,
        options: { scrt2URL: string }
      ) => void;
      prechatAPI?: {
        setHiddenPrechatFields?: (fields: PrechatFields) => void;
        removeHiddenPrechatFields?: (fieldNames: string[]) => void;
      };
    };
  }
}

type AgentforceEmbedProps = {
  config: AgentforceConfig;
  /**
   * Optional hidden-prechat dossier handed to Salesforce after the
   * SDK fires `onEmbeddedMessagingReady`. Keys must be registered as
   * Parameter Mappings on the Messaging Channel (or use one of
   * Salesforce's underscore-prefixed standard fields: _firstName,
   * _lastName, _email, _subject). Unregistered keys are silently
   * dropped server-side.
   */
  prechatFields?: PrechatFields | null;
};

export function AgentforceEmbed({ config, prechatFields }: AgentforceEmbedProps) {
  const initializedRef = useRef(false);
  const prechatAppliedRef = useRef(false);
  // "loading"      = script not yet loaded OR init() not yet called
  // "initializing" = init() returned but launcher not yet injected
  // "ready"        = onEmbeddedMessagingReady fired (launcher visible)
  // "error"        = sync throw or async init error from the SDK
  const [status, setStatus] = useState<
    "loading" | "initializing" | "ready" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prechatStatus, setPrechatStatus] = useState<
    "idle" | "applied" | "skipped-no-api" | "error"
  >("idle");

  useEffect(() => {
    if (initializedRef.current) return;

    const applyPrechatFields = () => {
      if (prechatAppliedRef.current) return;
      if (!prechatFields || Object.keys(prechatFields).length === 0) return;
      const api = window.embeddedservice_bootstrap?.prechatAPI;
      if (!api || typeof api.setHiddenPrechatFields !== "function") {
        // SDK version doesn't expose prechatAPI. The agent still works;
        // the conversation just starts without the dossier.
        setPrechatStatus("skipped-no-api");
        return;
      }
      try {
        api.setHiddenPrechatFields(prechatFields);
        prechatAppliedRef.current = true;
        setPrechatStatus("applied");
      } catch (err) {
        setPrechatStatus("error");
        console.error(
          "[agentforce] setHiddenPrechatFields threw; conversation will proceed without prechat context.",
          err
        );
      }
    };

    const onReady = () => {
      applyPrechatFields();
      setStatus("ready");
    };
    const onInitError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const msg =
        (detail && typeof detail.message === "string" && detail.message) ||
        "Salesforce Embedded Messaging dispatched onEmbeddedMessagingInitError.";
      setStatus("error");
      setErrorMessage(msg);
    };

    window.addEventListener("onEmbeddedMessagingReady", onReady);
    window.addEventListener(
      "onEmbeddedMessagingInitError",
      onInitError as EventListener
    );

    const tryInit = () => {
      const bootstrap = window.embeddedservice_bootstrap;
      if (!bootstrap) return false;
      try {
        bootstrap.settings.language = config.language;
        // Floating launcher mode is what the V2 deployment is configured for;
        // it injects a fixed-position chat button at the bottom-right and the
        // chat panel opens as a modal-like overlay above the host page.
        bootstrap.settings.displayMode = "floating";

        bootstrap.init(config.orgId, config.deploymentApiName, config.siteUrl, {
          scrt2URL: config.scrt2Url
        });

        initializedRef.current = true;
        setStatus("initializing");
        return true;
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return true;
      }
    };

    const cleanup = () => {
      window.removeEventListener("onEmbeddedMessagingReady", onReady);
      window.removeEventListener(
        "onEmbeddedMessagingInitError",
        onInitError as EventListener
      );
    };

    if (tryInit()) return cleanup;

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-agentforce-bootstrap="${config.deploymentApiName}"]`
    );
    if (existing) {
      const handleLoad = () => tryInit();
      existing.addEventListener("load", handleLoad, { once: true });
      return () => {
        existing.removeEventListener("load", handleLoad);
        cleanup();
      };
    }

    const script = document.createElement("script");
    script.src = config.bootstrapScriptUrl;
    script.type = "text/javascript";
    script.async = true;
    script.dataset.agentforceBootstrap = config.deploymentApiName;
    script.addEventListener("load", () => {
      tryInit();
    });
    script.addEventListener("error", () => {
      setStatus("error");
      setErrorMessage(
        `Failed to load Salesforce Embedded Messaging bootstrap from ${config.bootstrapScriptUrl}.`
      );
    });
    document.body.appendChild(script);

    return cleanup;
  }, [config, prechatFields]);

  const prechatFieldCount = prechatFields
    ? Object.keys(prechatFields).length
    : 0;

  return (
    <article className="card agentforce-shell" aria-label="Pause Intake Assistant">
      <header className="agentforce-header">
        <div>
          <p className="eyebrow">Pause Intake Assistant</p>
          <h3 style={{ marginTop: "0.2rem" }}>{AGENTFORCE_COPY.brandedTitle}</h3>
        </div>
        <span className="agentforce-badge agentforce-badge-live">
          {AGENTFORCE_COPY.productionBadge}
        </span>
      </header>
      <p style={{ color: "var(--muted)", marginTop: "0.4rem" }}>
        {AGENTFORCE_COPY.brandedSubtitle}
      </p>

      <div className="agentforce-launcher-callout" aria-live="polite">
        {status === "loading" && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Loading the live Pause Intake agent…
          </p>
        )}
        {status === "initializing" && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Connecting to Salesforce Agentforce Service Cloud…
          </p>
        )}
        {status === "ready" && (
          <>
            <span aria-hidden="true" style={{ fontSize: "1.4rem" }}>↘</span>
            <div>
              <strong style={{ display: "block" }}>
                The live agent is ready.
              </strong>
              <span style={{ color: "var(--muted)" }}>
                Click the chat launcher in the bottom-right corner to start
                an intake conversation. Salesforce-hosted, real-time, with
                full session history on the Service Cloud side.
              </span>
              {prechatFieldCount > 0 && prechatStatus === "applied" && (
                <span
                  style={{
                    display: "block",
                    marginTop: "0.4rem",
                    color: "var(--muted)",
                    fontSize: "0.85rem"
                  }}
                >
                  Prechat context pre-loaded: {prechatFieldCount} fields
                  handed to Salesforce (Conversation Variables on the
                  agent side). The agent walks in already knowing the
                  patient.
                </span>
              )}
              {prechatFieldCount > 0 && prechatStatus === "skipped-no-api" && (
                <span
                  style={{
                    display: "block",
                    marginTop: "0.4rem",
                    color: "var(--muted)",
                    fontSize: "0.85rem"
                  }}
                >
                  Prechat API not exposed by this SDK build — agent will
                  proceed without the pre-resolved patient dossier.
                </span>
              )}
              {prechatFieldCount > 0 && prechatStatus === "error" && (
                <span
                  style={{
                    display: "block",
                    marginTop: "0.4rem",
                    color: "#ffb6c8",
                    fontSize: "0.85rem"
                  }}
                >
                  Prechat context failed to apply — agent will proceed
                  without the dossier. Check the browser console.
                </span>
              )}
            </div>
          </>
        )}
        {status === "error" && (
          <p role="alert" style={{ color: "#ffb6c8", margin: 0 }}>
            {errorMessage ??
              "The live agent could not load. Please refresh, or contact your Pause-Health.ai administrator."}
          </p>
        )}
      </div>
    </article>
  );
}
