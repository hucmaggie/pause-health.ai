"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AGENTFORCE_COPY } from "../lib/agentforce";
import {
  RecommendedProviders,
  type RecommendedProviderEntry
} from "./recommended-providers";

type RoutingArtifact = {
  pathway: string;
  pathwayLabel: string;
  acuity: string;
  rationale: string[];
  redFlagsTriggered: string[];
  recommendedTargetResponse: string;
  modelProvenance: { provider: string; model: string; via: string };
  /**
   * MSCP provider recommendations attached by the Care Router for the
   * mscp-virtual-visit / mscp-in-person pathways (certified-only, strict —
   * no fallback tiers on this path). Absent for non-MSCP pathways or when the
   * provider graph found no certified clinician near the patient.
   */
  recommendedProviders?: {
    source: "live" | "mock";
    providers: RecommendedProviderEntry[];
  };
};

/**
 * Pause-Health.ai Intake Assistant — scripted fallback.
 *
 * Mirrors the Salesforce Agentforce Service Agent conversational pattern
 * (greeting → guided questions → live structured-field capture → handoff
 * confirmation) but runs entirely on a local state machine. Rendered when
 * the four NEXT_PUBLIC_AGENTFORCE_* env vars aren't all set.
 *
 * Design constraints honored here:
 *   - No Salesforce trademarks or logos. The UI is Pause-branded.
 *   - No claim that this is the live Agentforce experience. A
 *     "Prototype experience" badge stays visible at all times.
 *   - No real PHI capture. Inputs live only in component state.
 *   - The component is upgradeable: when env vars are set later, the
 *     intake page renders <AgentforceEmbed/> in this slot instead of
 *     this component, with no changes to surrounding layout.
 */

type AgentMessage = {
  id: string;
  role: "agent" | "patient";
  text: string;
};

type IntakeFieldKey =
  | "preferredName"
  | "patientZip"
  | "patientInsurance"
  | "ageBand"
  | "cycleStatus"
  | "primarySymptom"
  | "severity"
  | "redFlagsAcknowledged";

type IntakeStep = {
  id: IntakeFieldKey;
  prompt: string;
  helper?: string;
  options?: { value: string; label: string }[];
  inputType: "freeText" | "choice";
  validation?: (input: string) => string | null;
};

const SCRIPT: IntakeStep[] = [
  {
    id: "preferredName",
    inputType: "freeText",
    prompt: "Hi — I'm the Pause Intake Assistant. What name should I use for you today?",
    helper: "First name or initials are fine; this stays in your draft intake until you confirm.",
    validation: (input) =>
      input.trim().length === 0
        ? "Please share a name or initial so I know how to refer to you."
        : null
  },
  {
    id: "patientZip",
    inputType: "freeText",
    prompt:
      "What's your 5-digit ZIP code? I'll use it to find menopause specialists near you.",
    helper:
      "Optional — leave it blank to skip. When provided, Pause narrows MSCP-credentialed clinician recommendations to your area.",
    validation: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) return null; // optional — blank skips geo-narrowing
      return /^\d{5}$/.test(trimmed)
        ? null
        : "Please enter a 5-digit US ZIP code, or leave it blank to skip.";
    }
  },
  {
    id: "patientInsurance",
    inputType: "choice",
    prompt:
      "Which insurance do you have? I'll narrow recommendations to in-network providers.",
    helper:
      "Optional — pick \"Skip\" to see everyone. Pause's in-network signal is synthetically derived today (no public payer feed), so treat the match as a soft filter, not a guarantee.",
    options: [
      { value: "", label: "Skip" },
      { value: "medicare", label: "Medicare" },
      { value: "medicaid", label: "Medicaid" },
      { value: "aetna", label: "Aetna" },
      { value: "bcbs", label: "Blue Cross Blue Shield" },
      { value: "uhc", label: "UnitedHealthcare" },
      { value: "cigna", label: "Cigna" },
      { value: "humana", label: "Humana" },
      { value: "kaiser", label: "Kaiser Permanente" }
    ]
  },
  {
    id: "ageBand",
    inputType: "choice",
    prompt: "Thanks. Which age range fits you best?",
    helper: "Pause is designed for the perimenopause-to-post-menopause window.",
    options: [
      { value: "<40", label: "Under 40" },
      { value: "40-45", label: "40–45" },
      { value: "46-50", label: "46–50" },
      { value: "51-55", label: "51–55" },
      { value: "56-60", label: "56–60" },
      { value: ">60", label: "Over 60" }
    ]
  },
  {
    id: "cycleStatus",
    inputType: "choice",
    prompt: "How would you describe your cycle right now?",
    helper: "We'll use this to choose the right clinical pathway.",
    options: [
      { value: "regular", label: "Regular" },
      { value: "irregular", label: "Irregular over the past year" },
      { value: "stopped<12mo", label: "Stopped, but less than 12 months ago" },
      { value: "stopped>=12mo", label: "Stopped 12+ months ago" },
      { value: "surgical", label: "Surgical menopause / hysterectomy" }
    ]
  },
  {
    id: "primarySymptom",
    inputType: "choice",
    prompt: "Which symptom is bothering you most right now?",
    helper: "You'll be able to add more later. We're picking a starting point.",
    options: [
      { value: "hot_flashes", label: "Hot flashes / night sweats" },
      { value: "sleep", label: "Sleep disruption" },
      { value: "mood", label: "Mood changes / anxiety" },
      { value: "cognition", label: "Brain fog / memory" },
      { value: "gsm", label: "Vaginal / urinary symptoms" },
      { value: "weight_gain", label: "Weight gain / metabolism changes" },
      { value: "bleeding", label: "Unexpected bleeding" },
      { value: "other", label: "Something else" }
    ]
  },
  {
    id: "severity",
    inputType: "choice",
    prompt: "On a typical day this past week, how much has that symptom affected your life?",
    options: [
      { value: "mild", label: "Mild — noticeable but manageable" },
      { value: "moderate", label: "Moderate — affecting daily activities" },
      { value: "severe", label: "Severe — significantly impairing daily life" }
    ]
  },
  {
    id: "redFlagsAcknowledged",
    inputType: "choice",
    prompt:
      "Last quick safety check: are you experiencing any of — chest pain, sudden severe headache, postmenopausal bleeding, or thoughts of harming yourself — right now?",
    helper:
      "If yes, please call 911 or your local emergency number. This prototype isn't a substitute for emergency care.",
    options: [
      { value: "none", label: "No, none of those" },
      { value: "yes", label: "Yes — I need urgent help" }
    ]
  }
];

type CapturedFields = Partial<Record<IntakeFieldKey, string>>;

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function summarizeField(step: IntakeStep, raw: string): string {
  if (step.inputType === "choice" && step.options) {
    const match = step.options.find((opt) => opt.value === raw);
    return match ? match.label : raw;
  }
  return raw;
}

export function AgentforceFallback() {
  const [stepIndex, setStepIndex] = useState(0);
  const [captured, setCaptured] = useState<CapturedFields>({});
  const [textDraft, setTextDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>(() => [
    {
      id: generateId("m"),
      role: "agent",
      text: SCRIPT[0].prompt
    }
  ]);
  const [a2aStatus, setA2aStatus] = useState<
    "idle" | "handing-off" | "completed" | "failed"
  >("idle");
  const [routing, setRouting] = useState<RoutingArtifact | null>(null);
  const [traceTaskId, setTraceTaskId] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const currentStep = SCRIPT[stepIndex];
  const isComplete = stepIndex >= SCRIPT.length;
  const redFlagTriggered = captured.redFlagsAcknowledged === "yes";

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!isComplete || a2aStatus !== "idle") return;
    let cancelled = false;
    const intake = {
      preferredName: captured.preferredName,
      ageBand: captured.ageBand,
      cycleStatus: captured.cycleStatus,
      primarySymptom: captured.primarySymptom,
      severity: captured.severity,
      redFlagsAcknowledged: captured.redFlagsAcknowledged,
      // Blank ZIP is sent as undefined so the Care Router falls back to
      // top-national matches rather than filtering on an empty string.
      patientZip: captured.patientZip?.trim() ? captured.patientZip.trim() : undefined,
      // "Skip" maps to "" and we forward as undefined so the Care Router
      // doesn't filter on an empty string and silently empty the directory.
      patientInsurance: captured.patientInsurance && captured.patientInsurance.length > 0
        ? captured.patientInsurance
        : undefined
    };
    setA2aStatus("handing-off");
    (async () => {
      try {
        const res = await fetch("/api/intake/route-to-care-router", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intake })
        });
        if (!res.ok) throw new Error(`handoff failed: ${res.status}`);
        const payload = (await res.json()) as {
          taskId?: string;
          decision?: RoutingArtifact | null;
        };
        if (cancelled) return;
        if (payload.decision) {
          setRouting(payload.decision);
          setTraceTaskId(payload.taskId ?? null);
          setA2aStatus("completed");
        } else {
          setA2aStatus("failed");
        }
      } catch {
        if (!cancelled) setA2aStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isComplete, a2aStatus, captured]);

  const advance = useCallback(
    (rawAnswer: string) => {
      const step = SCRIPT[stepIndex];
      if (!step) return;

      const validationError = step.validation ? step.validation(rawAnswer) : null;
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      const labeled = summarizeField(step, rawAnswer);

      setCaptured((prev) => ({ ...prev, [step.id]: rawAnswer }));
      setMessages((prev) => {
        const patientTurn: AgentMessage = {
          id: generateId("m"),
          role: "patient",
          text: labeled
        };

        const nextStep = SCRIPT[stepIndex + 1];
        const agentTurns: AgentMessage[] = nextStep
          ? [
              {
                id: generateId("m"),
                role: "agent",
                text: nextStep.prompt
              }
            ]
          : [
              {
                id: generateId("m"),
                role: "agent",
                text:
                  rawAnswer === "yes"
                    ? "Thank you for telling me. This intake will be flagged for the urgent gynecology pathway. Please call 911 if you are in immediate danger."
                    : "Thanks. I've drafted your intake on the right. Your Pause-Health.ai care team will review and reach out within one business day."
              }
            ];

        return [...prev, patientTurn, ...agentTurns];
      });

      setStepIndex((idx) => idx + 1);
      setTextDraft("");
      setErrorMessage(null);
    },
    [stepIndex]
  );

  const onSubmitFreeText = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      advance(textDraft);
    },
    [advance, textDraft]
  );

  const onChoose = useCallback(
    (value: string) => {
      advance(value);
    },
    [advance]
  );

  const restart = useCallback(() => {
    setStepIndex(0);
    setCaptured({});
    setTextDraft("");
    setErrorMessage(null);
    setRouting(null);
    setTraceTaskId(null);
    setA2aStatus("idle");
    setMessages([
      {
        id: generateId("m"),
        role: "agent",
        text: SCRIPT[0].prompt
      }
    ]);
  }, []);

  const capturedSummary = useMemo(() => {
    return SCRIPT.filter((step) => captured[step.id] !== undefined).map((step) => ({
      key: step.id,
      label: step.prompt.split("?")[0].split(".")[0].slice(0, 60),
      value: summarizeField(step, captured[step.id] as string)
    }));
  }, [captured]);

  return (
    <article className="card agentforce-shell" aria-label="Pause Intake Assistant">
      <header className="agentforce-header">
        <div>
          <p className="eyebrow">Pause Intake Assistant</p>
          <h3 style={{ marginTop: "0.2rem" }}>{AGENTFORCE_COPY.brandedTitle}</h3>
        </div>
        <span className="agentforce-badge agentforce-badge-prototype">
          {AGENTFORCE_COPY.fallbackBadge}
        </span>
      </header>
      <p style={{ color: "var(--muted)", marginTop: "0.4rem" }}>
        {AGENTFORCE_COPY.brandedSubtitle}
      </p>

      <div className="agentforce-grid" style={{ marginTop: "1rem" }}>
        <div className="agentforce-chat" role="log" aria-live="polite">
          <div className="agentforce-transcript" ref={transcriptRef}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`agentforce-bubble agentforce-bubble-${msg.role}`}
              >
                <span className="agentforce-bubble-author">
                  {msg.role === "agent" ? "Assistant" : "You"}
                </span>
                <p>{msg.text}</p>
              </div>
            ))}
          </div>

          {!isComplete && currentStep && (
            <div className="agentforce-composer">
              {currentStep.helper && (
                <p className="agentforce-helper">{currentStep.helper}</p>
              )}
              {currentStep.inputType === "choice" && currentStep.options ? (
                <div className="agentforce-choices">
                  {currentStep.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="btn btn-secondary agentforce-choice"
                      onClick={() => onChoose(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <form className="agentforce-text-form" onSubmit={onSubmitFreeText}>
                  <label htmlFor="agentforce-text-input" className="sr-only">
                    Your response
                  </label>
                  <input
                    id="agentforce-text-input"
                    type="text"
                    autoComplete="off"
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    placeholder="Type your response..."
                    className="agentforce-input"
                  />
                  <button type="submit" className="btn btn-primary">
                    Send
                  </button>
                </form>
              )}
              {errorMessage && (
                <p role="alert" className="agentforce-error">
                  {errorMessage}
                </p>
              )}
            </div>
          )}

          {isComplete && (
            <div className="agentforce-composer">
              <p
                className={
                  redFlagTriggered
                    ? "agentforce-helper agentforce-helper-alert"
                    : "agentforce-helper"
                }
              >
                {redFlagTriggered
                  ? "Urgent escalation flagged. Pause routes this case to the urgent gynecology pathway."
                  : "Intake captured. The care team will review and reach out within one business day."}
              </p>

              <div className="agentforce-a2a-status" aria-live="polite">
                {a2aStatus === "handing-off" && (
                  <p>
                    <strong>A2A handoff in progress…</strong> Agentforce is sending
                    this intake to the Pause Care Router via Google A2A
                    (<code>tasks/send</code>). The MuleSoft Agent Fabric is
                    recording the trace.
                  </p>
                )}
                {a2aStatus === "completed" && routing && (
                  <>
                    <p>
                      <strong>Care Router decision:</strong>{" "}
                      {routing.pathwayLabel}{" "}
                      <em>({routing.acuity})</em>
                    </p>
                    <p style={{ fontSize: "0.88rem", marginTop: "0.3rem" }}>
                      {routing.rationale[0]}
                    </p>
                    <p
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--muted)",
                        marginTop: "0.3rem"
                      }}
                    >
                      Decided by {routing.modelProvenance.provider} /{" "}
                      <code>{routing.modelProvenance.model}</code> ({routing.modelProvenance.via})
                    </p>
                    {routing.recommendedProviders && (
                      <RecommendedProviders
                        providers={routing.recommendedProviders.providers}
                        source={routing.recommendedProviders.source}
                        fromZip={captured.patientZip?.trim() || undefined}
                        heading={
                          captured.patientZip?.trim()
                            ? `MSCP-certified specialists near ${captured.patientZip.trim()}`
                            : "MSCP-certified specialists (nationwide)"
                        }
                      />
                    )}
                    {traceTaskId && (
                      <p style={{ marginTop: "0.5rem" }}>
                        <a
                          href={`/demo/agent-fabric?taskId=${encodeURIComponent(traceTaskId)}`}
                          className="btn btn-secondary"
                        >
                          View multi-agent trace in Agent Fabric
                        </a>
                      </p>
                    )}
                  </>
                )}
                {a2aStatus === "failed" && (
                  <p style={{ color: "var(--alert, #b00020)" }}>
                    A2A handoff to the Care Router failed. The Pause team will
                    follow up manually.
                  </p>
                )}
              </div>

              <button type="button" className="btn btn-secondary" onClick={restart}>
                Restart intake
              </button>
            </div>
          )}
        </div>

        <aside className="agentforce-trace" aria-label="Live intake record">
          <p className="eyebrow">Live intake record</p>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "0.3rem" }}>
            What Pause has captured so far. Each field is what would be written to FHIR
            and to your provider&apos;s Salesforce Health Cloud record.
          </p>
          {capturedSummary.length === 0 ? (
            <p style={{ marginTop: "0.8rem", color: "var(--muted)" }}>
              No fields captured yet. Answer the first question to begin.
            </p>
          ) : (
            <ul className="agentforce-trace-list">
              {capturedSummary.map((field) => (
                <li key={field.key}>
                  <span>{field.label}</span>
                  <strong>{field.value}</strong>
                </li>
              ))}
            </ul>
          )}
          {redFlagTriggered && (
            <p className="agentforce-trace-alert" role="alert">
              Urgent escalation pathway flagged.
            </p>
          )}
        </aside>
      </div>

      <p className="agentforce-footer-note">{AGENTFORCE_COPY.fallbackNote}</p>
    </article>
  );
}
