"use client";

import { useState } from "react";

/**
 * Acquisition-funnel runner for the intake demo.
 *
 * Fires the real, server-side A2A funnel at
 * /api/intake/acquisition-funnel — Inbound Lead Generation →
 * Qualification → { Patient Intake → Care Router | Prospecting &
 * Nurture } — and surfaces the outcome plus a deep link to the parented
 * trace on /demo/agent-fabric. Every hop is a genuine A2A call with
 * governance enforced inside each agent route; the "no consent" scenario
 * is expected to be blocked at the inbound gate, which the panel reports
 * honestly rather than pretending the lead advanced.
 */

type FunnelLead = {
  source?: string;
  ageBand?: string;
  primarySymptom?: string;
  cycleStatus?: string;
  zip?: string;
  preferredName?: string;
  consentOptIn?: boolean;
};

type Scenario = {
  label: string;
  hint: string;
  lead: FunnelLead;
};

const SCENARIOS: Scenario[] = [
  {
    label: "Web-chat lead → intake",
    hint: "48, vasomotor, opted in, high-intent source → qualified & ready.",
    lead: {
      source: "web-chat",
      ageBand: "46-50",
      primarySymptom: "vasomotor",
      cycleStatus: "irregular",
      zip: "94110",
      preferredName: "Casey",
      consentOptIn: true
    }
  },
  {
    label: "Content download → nurture",
    hint: "52, sleep, opted in, lower-intent source → qualified but warming.",
    lead: {
      source: "content-download",
      ageBand: "51-55",
      primarySymptom: "sleep",
      cycleStatus: "stopped>=12mo",
      preferredName: "Rowan",
      consentOptIn: true
    }
  },
  {
    label: "No consent → blocked",
    hint: "Opted-out lead — blocked at the inbound gate by policy.",
    lead: {
      source: "symptom-check-form",
      ageBand: "46-50",
      primarySymptom: "vasomotor",
      consentOptIn: false
    }
  },
  {
    label: "Out of ICP → disqualified",
    hint: "Under 40 — outside the menopause-care ICP.",
    lead: {
      source: "web-chat",
      ageBand: "<40",
      primarySymptom: "vasomotor",
      consentOptIn: true
    }
  }
];

type FunnelResult = {
  taskId?: string;
  outcome?: string;
  blockedAt?: string;
  decision?: { decision?: string; route?: string; rationale?: string; score?: number };
  routingDecision?: { pathway?: string } | null;
  nurture?: { channel?: string; cadenceDays?: number } | null;
  error?: string;
};

const OUTCOME_COPY: Record<string, string> = {
  "routed-to-intake": "Qualified & ready → routed through Patient Intake to the Care Router.",
  nurturing: "Qualified but warming → handed to Prospecting & Nurture (touch drafted for approval).",
  disqualified: "Disqualified → logged for human review; not routed to intake.",
  blocked: "Blocked by the Agent Fabric before any handoff."
};

export function AcquisitionFunnelPanel() {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (scenario: Scenario) => {
    setRunning(scenario.label);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/intake/acquisition-funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead: scenario.lead })
      });
      const data = (await res.json()) as FunnelResult;
      if (!res.ok && !data.taskId) {
        throw new Error(data.error || `Funnel failed: ${res.status}`);
      }
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Upstream of intake
      </p>
      <h3 style={{ margin: 0 }}>The acquisition funnel that feeds this agent</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Before a patient reaches the intake agent above, a lead flows through
        three Agentforce agents over Google A2A:{" "}
        <strong>Inbound Lead Generation → Qualification →</strong> then either{" "}
        <strong>Patient Intake → Care Router</strong> (qualified &amp; ready) or{" "}
        <strong>Prospecting &amp; Nurture</strong> (warming). Each hop enforces
        its own Agent Fabric policies. Run a scenario, then open the trace.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginTop: "0.8rem"
        }}
      >
        {SCENARIOS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="btn btn-primary"
            disabled={running !== null}
            onClick={() => run(s)}
            title={s.hint}
            style={{ fontSize: "0.85rem" }}
          >
            {running === s.label ? "Running…" : s.label}
          </button>
        ))}
      </div>

      {error && (
        <p style={{ marginTop: "0.6rem", color: "var(--alert, #b00020)" }}>{error}</p>
      )}

      {result && (
        <div
          style={{
            marginTop: "0.9rem",
            padding: "0.8rem 1rem",
            border: "1px solid var(--line)",
            borderRadius: "0.5rem",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            {result.outcome ? OUTCOME_COPY[result.outcome] ?? result.outcome : "Done"}
            {result.blockedAt ? ` (at ${result.blockedAt})` : ""}
          </p>
          {result.decision?.rationale && (
            <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.86rem" }}>
              Qualification: {result.decision.rationale}
            </p>
          )}
          {result.routingDecision?.pathway && (
            <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.86rem" }}>
              Care Router pathway: <code>{result.routingDecision.pathway}</code>
            </p>
          )}
          {result.nurture?.channel && (
            <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.86rem" }}>
              Nurture touch drafted over <code>{result.nurture.channel}</code> (cadence{" "}
              {result.nurture.cadenceDays}d) — awaiting human approval.
            </p>
          )}
          {result.taskId && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.86rem" }}>
              <a
                href={`/demo/agent-fabric?taskId=${encodeURIComponent(result.taskId)}`}
                className="agentforce-voice-help-link"
              >
                Open the multi-agent trace →
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
