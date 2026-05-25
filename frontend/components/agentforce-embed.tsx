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
  const targetRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!targetRef.current) return;

    const tryInit = () => {
      const bootstrap = window.embeddedservice_bootstrap;
      if (!bootstrap || !targetRef.current) return false;
      try {
        bootstrap.settings.language = config.language;
        bootstrap.settings.displayMode = "inline";
        bootstrap.settings.targetElement = targetRef.current;

        bootstrap.init(config.orgId, config.deploymentApiName, config.siteUrl, {
          scrt2URL: config.scrt2Url
        });

        initializedRef.current = true;
        setStatus("ready");
        return true;
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return true; // don't keep retrying once init has thrown
      }
    };

    if (tryInit()) return;

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-agentforce-bootstrap="${config.deploymentApiName}"]`
    );
    if (existing) {
      existing.addEventListener("load", tryInit, { once: true });
      return () => existing.removeEventListener("load", tryInit);
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

      <div className="agentforce-embed-host" ref={targetRef} aria-live="polite">
        {status === "loading" && (
          <p style={{ color: "var(--muted)", padding: "1rem" }}>
            Connecting to the live agent…
          </p>
        )}
        {status === "error" && (
          <p role="alert" style={{ color: "#ffb6c8", padding: "1rem" }}>
            {errorMessage ??
              "The live agent could not load. Please refresh, or contact your Pause-Health.ai administrator."}
          </p>
        )}
      </div>
    </article>
  );
}
