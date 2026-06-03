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
 *   - We do not call any APIs before the SDK dispatches
 *     `onEmbeddedMessagingReady`; future enhancements (auto-launch,
 *     prechat field hydration, etc.) should listen for that event.
 */

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
    };
  }
}

type AgentforceEmbedProps = {
  config: AgentforceConfig;
};

export function AgentforceEmbed({ config }: AgentforceEmbedProps) {
  const initializedRef = useRef(false);
  // "loading"      = script not yet loaded OR init() not yet called
  // "initializing" = init() returned but launcher not yet injected
  // "ready"        = onEmbeddedMessagingReady fired (launcher visible)
  // "error"        = sync throw or async init error from the SDK
  const [status, setStatus] = useState<
    "loading" | "initializing" | "ready" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;

    const onReady = () => setStatus("ready");
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
  }, [config]);

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
