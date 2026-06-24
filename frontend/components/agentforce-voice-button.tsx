"use client";

import { useEffect, useState } from "react";

import type {
  AgentforceVoicePublicConfig,
  AgentforceVoiceStatus
} from "../lib/agentforce-voice";

/**
 * Agentforce Voice launch button.
 *
 * Reads the public-safe provisioning status from
 * /api/agentforce/voice/config and renders one of three affordances:
 *
 *   - status="designed"   → disabled "Voice (designed)" button +
 *                            link to the proposal page that explains
 *                            what activation needs. The /about and
 *                            /demo/intake pages can mount this in
 *                            the marketing slot without any side
 *                            effects.
 *   - status="prototype"  → enabled "Talk to the Pause agent" button.
 *                            On click, the button POSTs to the
 *                            partner SDK handshake. Today the
 *                            handshake itself is not implemented in
 *                            the prototype (it's gated on a live
 *                            CCaaS instance to verify against); the
 *                            click currently surfaces a clear
 *                            "verification pending" toast so an
 *                            operator can tell the env vars resolved
 *                            but no contact-flow round-trip has been
 *                            recorded.
 *   - status="shipped"    → same enabled affordance as "prototype",
 *                            no caveat copy. Reserved for the
 *                            post-verification activation day.
 *
 * Honest by design. The button never claims to have done something
 * it didn't do. Compare to the text-chat embed (agentforce-embed.tsx)
 * which had to ship a similar "the GA SDK once returned a no-op
 * Proxy" caveat in 2026-Q2.
 */

type FetchState =
  | { kind: "loading" }
  | { kind: "loaded"; config: AgentforceVoicePublicConfig }
  | { kind: "error"; message: string };

const PROPOSAL_HREF = "/proposal/agentforce-voice";
const PROVIDER_DISPLAY: Record<string, string> = {
  "amazon-connect": "Amazon Connect",
  "five9": "Five9",
  "nice": "NiCE",
  "vonage": "Vonage"
};

export function AgentforceVoiceButton() {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [launchToast, setLaunchToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agentforce/voice/config", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as AgentforceVoicePublicConfig;
      })
      .then((config) => {
        if (cancelled) return;
        setState({ kind: "loaded", config });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <button
        type="button"
        className="btn btn-secondary agentforce-voice-btn"
        disabled
        aria-busy="true"
      >
        <span aria-hidden="true">🎙️</span>
        <span>Loading voice surface…</span>
      </button>
    );
  }
  if (state.kind === "error") {
    return (
      <button
        type="button"
        className="btn btn-secondary agentforce-voice-btn"
        disabled
        aria-disabled="true"
        title={`Could not load voice config: ${state.message}`}
      >
        <span aria-hidden="true">🎙️</span>
        <span>Voice surface unavailable</span>
      </button>
    );
  }

  const { status, provider, agentDeployment, language } = state.config;
  const providerLabel =
    provider && PROVIDER_DISPLAY[provider] ? PROVIDER_DISPLAY[provider] : provider;

  if (status === "designed") {
    return (
      <div className="agentforce-voice-wrap">
        <button
          type="button"
          className="btn btn-secondary agentforce-voice-btn"
          disabled
          aria-describedby="agentforce-voice-status"
        >
          <span aria-hidden="true">🎙️</span>
          <span>Talk to the Pause agent</span>
          <span className="agentforce-voice-pill agentforce-voice-pill-designed">
            designed
          </span>
        </button>
        <p
          id="agentforce-voice-status"
          className="agentforce-voice-help"
        >
          Agentforce Voice is GA from Salesforce (Oct 2025) — the seam is
          wired on the Pause prototype and waiting on Agentforce Contact
          Center licensing + a CCaaS partner (Amazon Connect, Five9, NiCE,
          or Vonage) before it can route real audio.{" "}
          <a href={PROPOSAL_HREF} className="agentforce-voice-help-link">
            See the activation plan →
          </a>
        </p>
      </div>
    );
  }

  // status === "prototype" or "shipped"
  const handleLaunch = () => {
    if (status === "prototype") {
      setLaunchToast(
        `Voice launch handshake against ${providerLabel} is pending operator verification. The env vars are set; the runbook's "Verify" step has not been recorded for this deployment yet.`
      );
      return;
    }
    setLaunchToast(
      "Launching the live Agentforce Voice session… (real handshake lands here after activation-day commit.)"
    );
  };

  return (
    <div className="agentforce-voice-wrap">
      <button
        type="button"
        className="btn btn-primary agentforce-voice-btn"
        onClick={handleLaunch}
        aria-describedby="agentforce-voice-status"
      >
        <span aria-hidden="true">🎙️</span>
        <span>Talk to the Pause agent</span>
        <span
          className={`agentforce-voice-pill agentforce-voice-pill-${status}`}
        >
          {status}
        </span>
      </button>
      <p
        id="agentforce-voice-status"
        className="agentforce-voice-help"
      >
        Routes through {providerLabel ?? "the configured CCaaS partner"} to
        Agentforce deployment{" "}
        <code>{agentDeployment ?? "(unknown)"}</code> · locale{" "}
        {language ?? "en-US"}.{" "}
        <a href={PROPOSAL_HREF} className="agentforce-voice-help-link">
          What does this do? →
        </a>
      </p>
      {launchToast && (
        <p role="status" className="agentforce-voice-toast">
          {launchToast}
        </p>
      )}
    </div>
  );
}

/**
 * Standalone label helper for non-component contexts (status pages
 * etc). Keeps the human-readable status copy in one place.
 */
export function statusLabel(status: AgentforceVoiceStatus): string {
  switch (status) {
    case "designed":
      return "Designed — seam wired, activation gated on CCaaS licensing";
    case "prototype":
      return "Prototype — env vars set, verification pending";
    case "shipped":
      return "Shipped — verified end-to-end against the configured CCaaS instance";
  }
}
