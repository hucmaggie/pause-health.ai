"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AGENTFORCE_COPY } from "../lib/agentforce";

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

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const currentStep = SCRIPT[stepIndex];
  const isComplete = stepIndex >= SCRIPT.length;
  const redFlagTriggered = captured.redFlagsAcknowledged === "yes";

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

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
