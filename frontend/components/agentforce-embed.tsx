"use client";

import { useEffect, useRef, useState } from "react";

import {
  AGENTFORCE_COPY,
  AGENTFORCE_READY_TIMEOUT_MS,
  buildAgentforceSlowDiagnostic,
  buildAgentforceTimeoutDiagnostic,
  describeAgentforceError,
  formatAgentforceError,
  sanitizePrechatFields,
  type AgentforceConfig
} from "../lib/agentforce";

/**
 * Salesforce Embedded Messaging for Web — floating-launcher mount.
 *
 * Loads the deployment-specific bootstrap.min.js, configures floating
 * display mode (a fixed bottom-right chat launcher that opens the chat
 * panel as an overlay), and calls embeddedservice_bootstrap.init with the
 * four values from `lib/agentforce.getAgentforceConfig()`.
 *
 * Reference: Salesforce Enhanced Chat v2 (Messaging for In-App and Web).
 *
 * Notes:
 *   - All four config values are public deployment metadata (they ship
 *     in the Salesforce-provided snippet). They do not grant API access.
 *   - We mount once per page lifecycle. If a customer SPA navigates away
 *     and back, the script is already loaded; we no-op the second mount.
 *   - When `prechatFields` is supplied, we call
 *     `embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields()`
 *     inside the `onEmbeddedMessagingReady` handler — the only window in
 *     which Salesforce accepts hidden-field assignment.
 *
 *     HISTORY: the V2 SDK once shipped `prechatAPI` as a no-op Proxy
 *     (verified 2026-06-04) whose `setHiddenPrechatFields(...)` returned
 *     without transmitting, so values never reached SCRT2 and we pivoted
 *     to the visible <PreBriefPanel/>. That is FIXED as of 2026-06-14:
 *     prechatAPI now validates field names against the deployment's
 *     registered hidden-field list and transmits the valid ones, so we
 *     hand `Patient_Zip` to the Find-a-Provider action in-band and the
 *     agent skips asking for the ZIP. See PHASE_3_RUNBOOK.md (Phase 18d).
 *
 *     CAVEAT: a non-throwing setHiddenPrechatFields call — what this
 *     component surfaces as prechatStatus "applied" — does NOT by itself
 *     guarantee the value lands on MessagingSession. The field must be
 *     registered as a hidden prechat field AND the Embedded Service
 *     Deployment must be re-Published (then ~5–15 min CDN propagation).
 *     Treat in-band delivery as best-effort; the agent reasoning falls
 *     back gracefully (national results) when the ZIP is absent.
 *   - To switch between patients in the same browser session, the
 *     parent must re-mount this component via React key (see
 *     intake-patient-stage's `key={selectedId}`), which re-applies the
 *     new prechat fields on the fresh mount. The Salesforce SDK is
 *     global, sticky-state, and does not expose a swap-fields-mid-
 *     conversation API.
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
  // True once the launcher has taken longer than AGENTFORCE_READY_TIMEOUT_MS to
  // appear without erroring — almost always an unpublished deployment or a host
  // domain missing from the Embedded Service allow-list. Surfaced as an
  // actionable hint instead of an indefinite "Connecting…" spinner.
  const [slowToReady, setSlowToReady] = useState(false);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether bootstrap.min.js actually loaded (script `load` vs `error`, or the
  // global already being present). Feeds the timeout diagnostic so we can rank
  // "script never loaded" above the org-side causes when it applies.
  const scriptLoadedRef = useRef(false);
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);
  // Wall-clock start of init(), used to report the real elapsed time in the
  // structured console diagnostic rather than assuming the timeout constant.
  const initStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;

    const markBootstrapLoaded = () => {
      if (scriptLoadedRef.current) return;
      scriptLoadedRef.current = true;
      setBootstrapLoaded(true);
    };

    const clearReadyTimer = () => {
      if (readyTimerRef.current !== null) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
    const startReadyTimer = () => {
      if (readyTimerRef.current !== null) return;
      readyTimerRef.current = setTimeout(() => {
        const elapsedMs =
          initStartedAtRef.current !== null
            ? Date.now() - initStartedAtRef.current
            : AGENTFORCE_READY_TIMEOUT_MS;
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        // One structured line an operator can copy. Only public deployment
        // metadata (hosts + deployment api name + this page's origin) — never
        // the full config or any secret.
        console.warn(
          "[agentforce] launcher did not appear within the ready timeout",
          buildAgentforceTimeoutDiagnostic({
            config,
            origin,
            elapsedMs,
            bootstrapLoaded: scriptLoadedRef.current
          })
        );
        setSlowToReady(true);
      }, AGENTFORCE_READY_TIMEOUT_MS);
    };

    const applyPrechatFields = () => {
      if (prechatAppliedRef.current) return;
      const clean = sanitizePrechatFields(prechatFields);
      if (!clean) return;
      const api = window.embeddedservice_bootstrap?.prechatAPI;
      if (!api || typeof api.setHiddenPrechatFields !== "function") {
        // SDK version doesn't expose prechatAPI. The agent still works;
        // the conversation just starts without the dossier.
        setPrechatStatus("skipped-no-api");
        return;
      }
      try {
        api.setHiddenPrechatFields(clean);
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
      clearReadyTimer();
      setSlowToReady(false);
      applyPrechatFields();
      setStatus("ready");
    };
    // Both the init and bootstrap error events carry a `detail` payload in the
    // V2 SDK. Surface its actual message + any error code instead of a generic
    // string, and stop the ready watchdog since we already know it failed.
    const handleSdkError = (event: Event, source: string) => {
      clearReadyTimer();
      const detail = (event as CustomEvent).detail as
        | Record<string, unknown>
        | null
        | undefined;
      const surfaced = describeAgentforceError(
        detail,
        `Salesforce Embedded Messaging dispatched ${source}.`
      );
      setStatus("error");
      setErrorMessage(formatAgentforceError(surfaced));
    };
    const onInitError = (event: Event) =>
      handleSdkError(event, "onEmbeddedMessagingInitError");
    const onBootstrapError = (event: Event) =>
      handleSdkError(event, "onEmbeddedMessagingBootstrapError");

    window.addEventListener("onEmbeddedMessagingReady", onReady);
    window.addEventListener(
      "onEmbeddedMessagingInitError",
      onInitError as EventListener
    );
    window.addEventListener(
      "onEmbeddedMessagingBootstrapError",
      onBootstrapError as EventListener
    );

    const tryInit = () => {
      const bootstrap = window.embeddedservice_bootstrap;
      if (!bootstrap) return false;
      // The global being present means bootstrap.min.js executed.
      markBootstrapLoaded();
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
        // init() resolved synchronously; the launcher appears only once the
        // SDK fires onEmbeddedMessagingReady. Start the watchdog now.
        initStartedAtRef.current = Date.now();
        startReadyTimer();
        return true;
      } catch (err) {
        clearReadyTimer();
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
        return true;
      }
    };

    const cleanup = () => {
      clearReadyTimer();
      window.removeEventListener("onEmbeddedMessagingReady", onReady);
      window.removeEventListener(
        "onEmbeddedMessagingInitError",
        onInitError as EventListener
      );
      window.removeEventListener(
        "onEmbeddedMessagingBootstrapError",
        onBootstrapError as EventListener
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
      markBootstrapLoaded();
      tryInit();
    });
    script.addEventListener("error", () => {
      clearReadyTimer();
      setStatus("error");
      setErrorMessage(
        AGENTFORCE_COPY.bootstrapLoadFailed.replace(
          "{url}",
          config.bootstrapScriptUrl
        )
      );
    });
    document.body.appendChild(script);

    return cleanup;
  }, [config, prechatFields]);

  const sanitizedPrechat = sanitizePrechatFields(prechatFields);
  const prechatFieldCount = sanitizedPrechat
    ? Object.keys(sanitizedPrechat).length
    : 0;

  const slowDiagnostic = buildAgentforceSlowDiagnostic({
    deploymentApiName: config.deploymentApiName,
    origin: typeof window !== "undefined" ? window.location.origin : "",
    bootstrapLoaded
  });

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
            {AGENTFORCE_COPY.loadingLabel}
          </p>
        )}
        {status === "initializing" && !slowToReady && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            {AGENTFORCE_COPY.connectingLabel}
          </p>
        )}
        {status === "initializing" && slowToReady && (
          <div role="status" style={{ color: "var(--muted)", margin: 0 }}>
            <p style={{ margin: 0 }}>{slowDiagnostic.lead}</p>
            <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
              {slowDiagnostic.causes.map((cause) => (
                <li key={cause} style={{ marginTop: "0.25rem" }}>
                  {cause}
                </li>
              ))}
            </ol>
            <p style={{ margin: "0.5rem 0 0" }}>{slowDiagnostic.devtoolsHint}</p>
          </div>
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
            {errorMessage ?? AGENTFORCE_COPY.genericLoadFailure}
          </p>
        )}
      </div>
    </article>
  );
}
