/**
 * Salesforce Agentforce Voice configuration.
 *
 * Agentforce Voice is GA (announced Oct 13, 2025; Agentforce Contact
 * Center add-on shipped Mar 10, 2026) and runs the same Agentforce
 * subagents over a real-time speech pipeline. Salesforce ships voice
 * over phone (Amazon Connect / Five9 / NiCE / Vonage), web, and
 * mobile. The marketing page advertises "click-to-talk on your
 * website" but the partner-web developer surface is, as of June 2026,
 * sales-gated — no public LWC, no published Agent API voice endpoint,
 * no SDK index page that survives a curl.
 *
 * This module is the prototype-side seam for that activation:
 *
 *   - When the env vars below are unset, `getAgentforceVoiceConfig()`
 *     returns null. Callers (the UI button, the /api config route,
 *     the proposal page status pill) report "designed" — the seam
 *     exists, activation is gated on procurement.
 *   - When the env vars are set, the same callers report "prototype"
 *     and the UI surfaces a launch button that issues the documented
 *     CCaaS handshake (currently parameterized for Amazon Connect
 *     Streams; the other partners ship their own client SDKs and
 *     would mount through the same seam with a different `provider`
 *     value).
 *   - After end-to-end verification against a real Agentforce
 *     Contact Center instance, the proposal page pill flips to
 *     "shipped" via a 2026-XX-XX dated activation entry.
 *
 * What this module does NOT do today:
 *   - Browser Web Speech API STT/TTS. That is a separate path the
 *     PO explicitly opted not to ship in the same activation — it
 *     would be labeled "voice input for Agentforce chat," not
 *     "Agentforce Voice," and is intentionally out of scope here.
 *   - Phone-leg call control. PSTN is the CCaaS partner's surface.
 *
 * Authoritative sources for the contract values here:
 *   - https://www.salesforce.com/agentforce/voice/
 *   - https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/
 *   - https://www.salesforce.com/news/stories/agentforce-contact-center-announcement/
 *   - docs/AGENTFORCE_VOICE_RUNBOOK.md (procurement checklist)
 */

/** CCaaS partner that fronts the PSTN / WebRTC leg. */
export type AgentforceVoiceProvider =
  | "amazon-connect"
  | "five9"
  | "nice"
  | "vonage";

export type AgentforceVoiceConfig = {
  /**
   * CCaaS partner. Determines which client SDK the voice button loads
   * once the env is provisioned. Default Amazon Connect because its
   * Streams client SDK has the most documented partner-web surface.
   */
  provider: AgentforceVoiceProvider;
  /**
   * Base URL the partner SDK calls home to. Examples:
   *   - amazon-connect: `https://<alias>.my.connect.aws`
   *   - five9:          `https://<region>.app.five9.com`
   * Validated only for shape (must be https://) — partner-specific
   * structure is the runbook's job.
   */
  baseUrl: string;
  /**
   * CCaaS-side identifier the agent runtime resolves to a contact
   * flow / Agentforce binding. For Amazon Connect this is the
   * Instance ID GUID; for Five9 it's the campaign reference. Opaque
   * to this module; surfaced as `deploymentRef` in client responses.
   */
  deploymentRef: string;
  /**
   * The Agentforce Service Agent the CCaaS contact flow should route
   * voice turns to. Matches the deployment API name already in
   * NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME when both surfaces target
   * the same agent — but we read it separately so the voice and chat
   * channels can target different agents during pilot.
   */
  agentDeployment: string;
  /**
   * Optional locale override for ASR + TTS. Defaults to "en-US" when
   * unset — the same locale the chat channel uses today.
   */
  language: string;
};

const ENV_KEYS = {
  provider: "AGENTFORCE_VOICE_PROVIDER",
  baseUrl: "AGENTFORCE_VOICE_BASE_URL",
  deploymentRef: "AGENTFORCE_VOICE_DEPLOYMENT_REF",
  agentDeployment: "AGENTFORCE_VOICE_AGENT_DEPLOYMENT",
  language: "AGENTFORCE_VOICE_LANGUAGE"
} as const;

const VALID_PROVIDERS: ReadonlySet<AgentforceVoiceProvider> = new Set([
  "amazon-connect",
  "five9",
  "nice",
  "vonage"
]);

function readEnv(key: string): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Return a fully-typed config when ALL required env vars are present
 * and well-formed. Returns null when any one is missing so callers
 * can degrade to the designed-pill UI without throwing.
 *
 * Required: provider, baseUrl, deploymentRef, agentDeployment.
 * Optional: language (defaults "en-US").
 *
 * "Well-formed" here is intentionally cheap. We validate provider
 * against the documented enum, require baseUrl to be https://, and
 * require both ids to be non-empty trimmed strings. We do NOT
 * round-trip a real handshake — that's the runbook's verification
 * step, not module-load semantics.
 */
export function getAgentforceVoiceConfig(): AgentforceVoiceConfig | null {
  const providerRaw = readEnv(ENV_KEYS.provider).toLowerCase();
  const baseUrl = readEnv(ENV_KEYS.baseUrl);
  const deploymentRef = readEnv(ENV_KEYS.deploymentRef);
  const agentDeployment = readEnv(ENV_KEYS.agentDeployment);
  const language = readEnv(ENV_KEYS.language) || "en-US";

  if (!providerRaw || !baseUrl || !deploymentRef || !agentDeployment) {
    return null;
  }

  if (!VALID_PROVIDERS.has(providerRaw as AgentforceVoiceProvider)) {
    // Reachable when ops mistypes the env var. Loud-failing on a
    // string boundary is the kind of misconfiguration we want to
    // catch in deployment logs, but throwing would break renders
    // for /api/agentforce/voice/config and the proposal page. Log
    // and pretend unset so the UI shows "designed".
    console.warn(
      `[agentforce-voice] AGENTFORCE_VOICE_PROVIDER must be one of ` +
        `${[...VALID_PROVIDERS].join(", ")}; got ${JSON.stringify(providerRaw)}. ` +
        `Treating as unset.`
    );
    return null;
  }

  if (!/^https:\/\//i.test(baseUrl)) {
    console.warn(
      `[agentforce-voice] AGENTFORCE_VOICE_BASE_URL must be https://; ` +
        `got ${JSON.stringify(baseUrl)}. Treating as unset.`
    );
    return null;
  }

  return {
    provider: providerRaw as AgentforceVoiceProvider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    deploymentRef,
    agentDeployment,
    language
  };
}

export function isAgentforceVoiceConfigured(): boolean {
  return getAgentforceVoiceConfig() !== null;
}

/**
 * Provisioning status surfaced to clients.
 *
 *   - "designed" — env vars unset; the seam exists, activation is
 *     gated on procurement (see AGENTFORCE_VOICE_RUNBOOK.md).
 *   - "prototype" — env vars set; the seam is wired but end-to-end
 *     has not been independently verified for this deployment. The
 *     voice button is enabled.
 *   - "shipped" — operator has flagged this deployment as verified
 *     end-to-end (sets AGENTFORCE_VOICE_VERIFIED=true). Reserved for
 *     the activation-day commit.
 *
 * "shipped" is intentionally explicit rather than auto-derived from
 * "the env vars are set" — provisioning the env vars proves the
 * Vercel side; verification means audio was round-tripped against
 * the CCaaS instance.
 */
export type AgentforceVoiceStatus = "designed" | "prototype" | "shipped";

export function getAgentforceVoiceStatus(): AgentforceVoiceStatus {
  if (!isAgentforceVoiceConfigured()) return "designed";
  const verified = readEnv("AGENTFORCE_VOICE_VERIFIED").toLowerCase();
  if (verified === "1" || verified === "true" || verified === "on") {
    return "shipped";
  }
  return "prototype";
}

/**
 * Shape returned by GET /api/agentforce/voice/config. Surfaces just
 * enough for the UI button to decide whether to mount, and never
 * leaks anything that could let a third party initiate a session
 * against the CCaaS instance.
 *
 * Notable omissions vs. AgentforceVoiceConfig: baseUrl and
 * deploymentRef. Both are partner-side opaque identifiers; the
 * client SDK derives the endpoint URL from cookies + an STS token
 * during the handshake (per Amazon Connect Streams docs), so the
 * raw values don't belong in a publicly-cacheable response.
 */
export type AgentforceVoicePublicConfig = {
  status: AgentforceVoiceStatus;
  /** Present when status !== "designed". */
  provider?: AgentforceVoiceProvider;
  /** Present when status !== "designed". */
  agentDeployment?: string;
  /** Present when status !== "designed". Defaults "en-US". */
  language?: string;
};

export function toPublicConfig(): AgentforceVoicePublicConfig {
  const status = getAgentforceVoiceStatus();
  if (status === "designed") {
    return { status };
  }
  const cfg = getAgentforceVoiceConfig();
  if (!cfg) return { status: "designed" };
  return {
    status,
    provider: cfg.provider,
    agentDeployment: cfg.agentDeployment,
    language: cfg.language
  };
}
