import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Changelog",
  description:
    "What's shipped at Pause-Health.ai. Grouped by week, with links to the underlying GitHub commits. Updated after every polish pass — the git log is part of the artifact.",
  path: "/changelog",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Pause-Health.ai changelog — what's shipped, week by week."
});

const GITHUB_REPO = "https://github.com/hucmaggie/pause-health.ai";

type ChangelogEntry = {
  title: string;
  summary: string;
  commits: Array<{ sha: string; label: string }>;
  status: StatusPillStatus;
};

type ChangelogWeek = {
  range: string;
  headline: string;
  intro: string;
  entries: ChangelogEntry[];
};

const weeks: ChangelogWeek[] = [
  {
    range: "Week of July 12, 2026",
    headline: "The Care Router's live-Claude path goes green — and the chat can invoke it",
    intro:
      "With ANTHROPIC_API_KEY finally set in production, the Care Router's live Claude Sonnet 4.5 path was still silently falling back to the deterministic engine — the model's JSON was being rejected before it could be used, and nothing in the trace said why. Two changes fixed that and made it observable, then the live Agentforce intake chat got an explicit handoff so a completed conversation can actually route to the Claude-backed Care Router as one continuous trace.",
    entries: [
      {
        title: "Agent Fabric: added the Clinical Trials & Research Matching agent — deterministic criteria-sourced trial-eligibility matching + consent-gated outreach (the 28th agent)",
        summary:
          "Added the twenty-eighth agent on the fabric — clinical-trials-agent, the Salesforce 'Agentforce for Health' / Health Cloud clinical-trials / research-matching analog — as a first-class patient/clinical-plane agent that REUSES the existing care-coordination governance tier (research matching is a care-navigation / coordination activity, not a new clinical decision). It is a DETERMINISTIC, no-Claude agent modeled on the Care Gap Closure and Population Health agents: in a new pure lib/clinical-trials.ts, matchTrials(patient, {researchConsent}) evaluates a single menopause/midlife patient's STRUCTURED context (age band, symptom profile, comorbidities, geography, prior therapy, HRT status, postmenopausal status) against a synthetic STUDY_CATALOG whose eligibility is composed from a defined TRIAL_CRITERIA catalog (inclusion + exclusion criteria), returns the matching studies ranked with per-criterion match explanations (eligible first, then match score, then studyId — a stable, documented tie-break), and draftTrialOutreach(recommended, researchConsent) drafts a CONSENT-GATED outreach that NEVER auto-enrolls. It is a pure function of the context + research-consent flag (no randomness, no clock), so the same inputs always yield the same matches + ranking + outreach state. It ties thematically to the Consent & Preferences Management agent's `research` consent scope (withheld by default in that agent's demo ledger) — deferring to that authoritative research-consent state before any outreach — but does its own eligibility logic. THREE load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.trials.eligibility-criteria-sourced (signal eligibilityTracesToCriteria, violating value false) blocks a fabricated / ad-hoc / off-catalog eligibility determination that doesn't trace to a defined study criterion (the pure guard eligibilityTracesToCriteria backs it); policy.trials.research-consent-required (signal researchConsentPresent, violating value false) blocks an active trial outreach drafted without the patient's research consent — and when consent is absent the agent WITHHOLDS outreach (a safe completed answer, not a block) via the guard outreachHasResearchConsent; and policy.trials.no-autonomous-enrollment (signal enrollmentRequiresHuman, violating value false) blocks any attempt to enroll a patient autonomously — enrollment requires informed consent AND a human (every outreach is requiresHuman:true / enrolled:false, there is no 'enrolled' state), backed by the guard enrollmentRequiresHuman. It also reuses, by extending appliesTo, the HIPAA-audit policy (it touches patient clinical context — it is NOT a commercial-plane agent), and is deliberately NOT on the live-Claude model allow-list (no Claude). A runnable A2A endpoint (POST /api/agents/clinical-trials/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — trials.load-catalog → trials.match → trials.draft-outreach, every span phiAccessed:true — returning the TrialMatchResult as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is surfaced on /demo/intake via a new Clinical Trials panel (match-with-consent and match-no-consent-withheld happy-path presets plus fabricated-eligibility, outreach-without-consent, and autonomous-enrollment governance-block presets — rendering the per-study matched/failed criteria, the recommended studies, the consent-gated outreach state, synthetic labels, and a trace deep link), and a seeded load-catalog→match→draft-outreach trace, the console subtitle, and the investor brief (now 'twenty-eight agents across three planes', with the Clinical Trials & Research Matching agent on the patient/clinical plane) all reflect it. Frontend tests green (+ clinical-trials catalog/criteria-integrity/determinism/ranking-tie-break/consent-gated-outreach/never-enrolled/traces-to-criteria-true-and-false/consent-and-enrollment guards, the route's envelope/three governance blocks/allow + withheld-outreach happy paths, the governance-evaluate passthrough for the three new signals, the panel's request-body + view-lift, and the registry drift guards raised to twenty-eight agents); the study catalog, sponsors, criteria, and patient references are clearly-labeled illustrative synthetics, NOT real studies or a certified trial-eligibility engine. Lint + build clean.",
        commits: [
          {
            sha: "68ab655",
            label:
              "agent fabric: add the Clinical Trials & Research Matching agent (deterministic criteria-sourced trial-eligibility matching + consent-gated outreach, the 28th agent)"
          }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Consent & Preferences Management agent — the authoritative consent ledger + deterministic consent-decision service (the 27th agent)",
        summary:
          "Added the twenty-seventh agent on the fabric — consent-management-agent, the MuleSoft control-plane / data-substrate consent service — as the AUTHORITATIVE, cross-cutting consent & communication-preferences service the rest of the fabric's consent-before-outreach / consent-before-referral / consent-to-monitor gates logically defer to. Unlike every other agent (which CONSUMES consent), this one is the SOURCE OF TRUTH FOR consent, so it REUSES the existing data-plane governance tier (platform plane — a control-plane / data-substrate service) rather than inventing one, and is a DETERMINISTIC, no-Claude agent. In a new pure lib/consent-management.ts it holds, per patient, a consent LEDGER (a set of consent scopes — contact-outreach, data-sharing, remote-monitoring, research, marketing — each with a status granted / withheld / revoked, a recorded basis/source, a timestamp, and an optional expiry) and communication PREFERENCES (allowed channels sms/email/voice, quiet hours, preferred language, frequency cap), and evaluateConsent(ledger, {scope, channel, atTime, priorTouches}) DETERMINISTICALLY answers one question — may this patient be contacted / have data used for this scope over this channel at this time? — denying a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch (quiet hours are read from the query's own atTime, not a clock), or a frequency-cap breach (priorTouches is taken as data), and otherwise allowing, always citing the consent record it relied on (matchedConsentEventId). It is a pure function of the ledger + the query's own atTime + priorTouches (no randomness, no clock), so the same inputs always yield the same decision. THREE load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.consent.recorded-source (signal consentTracesToRecord, violating value false) blocks an asserted-but-unrecorded consent that doesn't trace to a recorded event/basis — an off-catalog scope, an unrecognized status, or a missing recorded source (the pure guard consentTracesToRecord backs it); policy.consent.honor-revocation (signal honorsRevocation, violating value false) blocks any decision that would ALLOW outreach against a revoked / expired scope — a revocation must be honored immediately (the guard honorsRevocation backs it); and policy.consent.no-scope-override (signal respectsConsentScope, violating value false) blocks any decision that overrides a withheld scope or borrows consent for a scope the patient never granted — an allow requires a granted, current record for that exact scope (the guard respectsConsentScope backs it). It also reuses, by extending appliesTo, the HIPAA-audit policy (it holds patient consent data — it is NOT a commercial-plane agent even though it's on the platform plane), and is deliberately NOT on the live-Claude model allow-list (no Claude). A runnable A2A endpoint (POST /api/agents/consent-management/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — consent.load-ledger → consent.evaluate → consent.decision, every span phiAccessed:true — returning the ConsentDecision + ledger as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is surfaced on /demo/intake via a new Consent & Preferences Management panel (granted→allowed, withheld→denied, and quiet-hours→denied happy-path presets plus unrecorded-consent, allow-against-revoked, and scope-override governance-block presets — rendering the consent ledger, the decision with its reason + matched consent record, the comms preferences, synthetic labels, and a trace deep link), and a seeded load-ledger→evaluate→decision trace, the console subtitle, and the investor brief (now 'twenty-seven agents across three planes', with the Consent & Preferences Management agent on the platform & data substrate) all reflect it. Frontend tests green (+ consent-management catalog/time-helper/resolve-latest/determinism/decision-order/traces-to-record-true-and-false/honor-revocation-true-and-false/no-scope-override guards, the route's envelope/three governance blocks/allow + honored-denial happy paths, the governance-evaluate passthrough for the three new signals, the panel's request-body + view-lift, and the registry drift guards raised to twenty-seven agents); the consent scopes, recorded sources, preferences, and patient references are clearly-labeled illustrative synthetics, NOT a certified consent-management system. Lint + build clean.",
        commits: [
          {
            sha: "750caad",
            label:
              "agent fabric: add the Consent & Preferences Management agent (authoritative consent ledger + deterministic consent-decision service, the 27th agent)"
          }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Population Health & Risk Stratification agent — deterministic panel-level risk tiering + prioritized outreach worklist (the 26th agent)",
        summary:
          "Added the twenty-sixth agent on the fabric — population-health-agent, the Salesforce 'Agentforce for Health' / Health Cloud population-health / risk-stratification analog — as a first-class patient/clinical-plane agent that REUSES the existing care-coordination governance tier (population health / care-management triage, not a new clinical decision). It is a DETERMINISTIC, no-Claude agent modeled on the Care Gap Closure and Remote Patient Monitoring agents, and introduces a NEW granularity: unlike every other patient-plane agent (which reasons over a SINGLE patient), it reasons over a whole PANEL/COHORT at once. In a new pure lib/population-health.ts, stratifyPanel(panel) DETERMINISTICALLY scores each patient from already-produced per-patient signals (intake severity, validated-assessment band, open care gaps, positive SDOH domains, medication-adherence status, monitored-symptom trend) with a TRANSPARENT additive/weighted risk model — a defined RISK_FACTORS spec (each factor carrying a synthetic weight + rationale) and fixed TIER_CUTOFFS mapping a numeric score to a low / rising / high tier — a pure function of the signals (no randomness, no clock), so the same panel always yields the same tiers + worklist ordering with a stable, documented tie-break (score desc, then patientRef asc), and every patient's tier cites the contributing factors that produced it. It then emits a prioritized outreach worklist (which patients to reach first, and why) for a human care manager. THREE load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.pophealth.transparent-risk-model (signal riskScoreTracesToFactors, violating value false) blocks an opaque / off-spec / black-box score whose tier doesn't trace to the documented risk-factor spec (the pure guard riskScoreTracesToFactors backs it); policy.pophealth.no-protected-class-factors (signal excludesProtectedAttributes, violating value false) blocks any attempt to score on a protected-class attribute (race, ethnicity, gender identity, religion, national origin, disability status, sexual orientation, marital status) — a fairness / responsible-AI requirement (the guard excludesProtectedAttributes backs it); and policy.pophealth.no-autonomous-care-decision (signal tierReviewedByHuman, violating value false) blocks any attempt to let a risk tier trigger an autonomous care action — a tier is a prioritization signal only, every tier→action requires human / care-manager review. It also reuses, by extending appliesTo, the HIPAA-audit policy (panel-level PHI — it is NOT a commercial-plane agent), and is deliberately NOT on the live-Claude model allow-list (no Claude). A runnable A2A endpoint (POST /api/agents/population-health/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — pophealth.ingest-panel → pophealth.score → pophealth.stratify → pophealth.build-worklist, every span phiAccessed:true — returning the PanelStratification as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is surfaced on /demo/intake via a new Population Health panel (mixed-panel and high-risk-cohort happy-path presets producing a mix of low/rising/high tiers + a prioritized worklist, plus opaque-score, protected-class-factor, and autonomous-care-decision governance-block presets — rendering the tier counts, the per-patient tiers with their contributing factors, the ordered worklist, synthetic labels, and a trace deep link), and a seeded ingest-panel→score→stratify→build-worklist trace, the console subtitle, and the investor brief (now 'twenty-six agents across three planes', with the Population Health & Risk Stratification agent on the patient/clinical plane) all reflect it. Frontend tests green (+ population-health catalog/cutoff-integrity/determinism/tier-mapping/worklist-ordering/traces-to-factors-true-and-false/excludes-protected-true-and-false/human-review guards, the route's envelope/three governance blocks/happy-path, the governance-evaluate passthrough for the three new signals, the panel's request-body + view-lift, and the registry drift guards raised to twenty-six agents); the risk factors, weights, cutoffs, and patient references are clearly-labeled illustrative synthetics, NOT a certified risk-stratification model. Lint + build clean.",
        commits: [
          {
            sha: "1fccf16",
            label:
              "agent fabric: add the Population Health & Risk Stratification agent (deterministic panel-level risk tiering + prioritized outreach worklist, the 26th agent)"
          }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Remote Patient Monitoring & Symptom-Trend Tracking agent — deterministic longitudinal trend detection + clinician-routed escalation (the 25th agent)",
        summary:
          "Added the twenty-fifth agent on the fabric — remote-monitoring-agent, the remote-patient-monitoring (RPM) analog — as a first-class patient/clinical-plane agent that REUSES the existing care-coordination governance tier (longitudinal monitoring + coordinating a clinician escalation, not a new clinical decision). It is a DETERMINISTIC, no-Claude agent modeled on the Care Gap Closure and Medication Adherence agents, and is distinct from all four: it ingests longitudinal (time-series) symptom/vital readings — self-reported or from wearables/devices — for a menopause/midlife patient (hot-flash frequency, sleep hours, mood score, resting heart rate, weight). In a new pure lib/remote-monitoring.ts, assessMonitoring(readings) DETERMINISTICALLY detects a per-metric trend (improving / stable / worsening) by comparing a recent window against a baseline window against a defined monitored-metrics catalog (each metric carrying a synthetic unit, stable band, worsening direction, and red-flag cutoff), then raises escalations for worsening or red-flag trends — a pure function of the reading series (timestamps are accepted as data, no randomness, no clock), so the same series always yields the same trend + escalation decision, and every escalation cites the metric + the threshold rule that triggered it and is routed to a clinician (routedTo:'clinician-review'). THREE load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.rpm.reading-source-integrity (signal readingsTraceToSource, violating value false) blocks a fabricated / off-source reading or an off-catalog metric (the pure guard readingsTraceToSource backs it); policy.rpm.no-autonomous-escalation (signal escalationRoutedToHuman, violating value false) blocks any attempt to act on a trend autonomously — every escalation must be routed to a human clinician, never an autonomous clinical action (no auto-ordering, auto-medication, auto-titration); and policy.rpm.consent-to-monitor (signal monitoringHasConsent, violating value false) blocks longitudinal monitoring / trend outreach without the patient's consent. It also reuses, by extending appliesTo, the HIPAA-audit policy (it touches patient clinical context — it is NOT a commercial-plane agent), and is deliberately NOT on the live-Claude model allow-list (no Claude). A runnable A2A endpoint (POST /api/agents/remote-monitoring/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — rpm.ingest → rpm.detect-trends → rpm.route-to-clinician, every span phiAccessed:true — returning the MonitoringAssessment as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is surfaced on /demo/intake via a new Remote Patient Monitoring panel (improving/stable/worsening multi-metric, benign, and red-flag happy-path presets plus fabricated-reading, autonomous-escalation, and no-consent governance-block presets — rendering the per-metric trends, escalations with their triggering rule + 'routed to clinician review', synthetic labels, and a trace deep link), and a seeded ingest→detect→route-to-clinician trace, the console subtitle, and the investor brief (now 'twenty-five agents across three planes', with the Remote Patient Monitoring & Symptom-Trend Tracking agent on the patient/clinical plane) all reflect it. Frontend tests green (+ remote-monitoring catalog-integrity/determinism/trend-classification/red-flag/escalation-routing/source-guard-true-and-false, the route's envelope/three governance blocks/happy-path, the governance-evaluate passthrough for the three new signals, the panel's request-body + view-lift, and the registry drift guards raised to twenty-five agents); the monitored-metric catalog, thresholds, and red-flag cutoffs are clearly-labeled illustrative synthetics, NOT a certified remote-monitoring or clinical-alerting engine. Lint + build clean.",
        commits: [
          {
            sha: "5db88e4",
            label:
              "agent fabric: add the Remote Patient Monitoring & Symptom-Trend Tracking agent (deterministic longitudinal trend detection + clinician-routed escalation, the 25th agent)"
          }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Patient Education & Health Coaching agent — evidence-sourced education + live-Claude coaching (the fourth live-Claude agent)",
        summary:
          "Added the twenty-fourth agent on the fabric — patient-education-agent, the Salesforce 'Agentforce for Health' patient-education / health-coaching analog — as a first-class patient/clinical-plane agent that REUSES the existing patient-engagement governance tier (patient-facing education + coaching, not a new clinical decision). It is distinct from the clinician-authored Care Plan agent and the refill-focused Medication Adherence agent: it turns already-produced signals (intake symptoms/severity, an optional validated-instrument assessment, Care Plan focus areas, and detected care gaps) into a personalized, evidence-sourced menopause/midlife education curriculum and a warm coaching message. In a new pure lib/patient-education.ts, buildEducationCurriculum(context) DETERMINISTICALLY selects modules from a defined evidence-sourced catalog (bone health, cardiovascular risk, sleep hygiene, vasomotor self-management, mood/stress, nutrition, physical activity — each carrying a synthetic source label: The Menopause Society, USPSTF, NAMS/ACOG-style) — a pure function of the inputs (no randomness, no clock), so the same context always yields the same curriculum. coachEducation(curriculum) then phrases a motivational coaching message with live Anthropic Claude — the FOURTH live-Claude agent after the Care Router, Care Plan, and Clinical Summary agents — falling back to a DETERMINISTIC scripted message (scriptedCoachEducation, with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails, exactly like the Care Plan agent, returning an EducationCoachingResult (coachingMessage, moduleIds, via: 'claude-api' | 'scripted-fallback', optional fallbackReason, synthetic:true). THREE load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.education.evidence-sourced (signal educationTracesToEvidenceSource, violating value false) blocks a fabricated / off-catalog topic that doesn't trace to a defined evidence source (the pure guard curriculumTracesToEvidenceSource backs it); policy.education.no-medical-advice (signal staysWithinEducationScope, violating value false) blocks content that strays beyond general education into diagnosis, medication dosing, or individualized medical advice; and policy.education.consent-before-outreach (signal coachingOutreachHasConsent, violating value false) blocks a coaching push without the patient's consent — every outreach is consent-gated and human-approval-gated. It also reuses, by extending appliesTo, the anthropic-claude-sonnet model allow-list (live-Claude) and the HIPAA-audit policy (it touches patient clinical context — it is NOT a commercial-plane agent). A runnable A2A endpoint (POST /api/agents/patient-education/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — patient-education.curate → patient-education.coach, every span phiAccessed:true, the coach span carrying via + any fallbackReason and the consent/human-approval/never-sent flags — returning the curriculum + coaching as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is surfaced on /demo/intake via a new Patient Education panel (vasomotor, postmenopausal-prevention, and mood-dominant happy-path presets plus off-catalog, medical-advice, and no-consent governance-block presets — rendering the selected modules with their source labels, the coaching message with a via/fallbackReason badge, the evidence-source signal, and a trace deep link), and a seeded curate→coach (scripted-fallback) trace, the console subtitle, and the investor brief (now 'twenty-four agents across three planes', with the Patient Education & Health Coaching agent on the patient/clinical plane) all reflect it. Frontend tests green (+ patient-education determinism/module-selection/evidence-source-guard-true-and-false/scope-guard/live-Claude-success-via-mocked-SDK + SDK-error + missing-key fallback with fallbackReason, the route's envelope/three governance blocks/model-allow-list/happy-path, the governance-evaluate passthrough for the three new signals, the panel's request-body + view-lift, and the registry drift guards raised to twenty-four agents); the education modules + source labels are clearly-labeled illustrative synthetics, NOT a certified patient-education engine. Lint + build clean.",
        commits: [
          {
            sha: "e8a7383",
            label:
              "agent fabric: add the Patient Education & Health Coaching agent (evidence-sourced education + live-Claude coaching, the fourth live-Claude agent)"
          }
        ],
        status: "shipped"
      },
      {
        title: "Intake: the assistant greets the patient by name",
        summary:
          "Made the intake experience address the patient by name across both surfaces. The scripted intake assistant (agentforce-fallback.tsx) now greets and closes using the name typed at step 0 — a subtle acknowledgment on the next turn (\"Thanks, Maggie! …\") and the completion / red-flag messages (\"Thanks, Maggie. I've drafted your intake…\"), with a graceful fallback to the name-less copy when no usable name is captured. Name parsing lives in pure, unit-tested helpers in lib/agentforce.ts (firstNameFromInput, withNameAcknowledgment, intakeCompletionMessage, intakeRedFlagMessage). For the LIVE Salesforce Agentforce agent, the intake stage now forwards the Salesforce-standard _firstName/_lastName hidden prechat fields in-band (auto-accepted, no org registration), and — because a static welcome message can't interpolate a name and the LLM may not see the standard field in its reasoning — a durable context-variable route was wired end to end, mirroring the Patient_Zip plumbing exactly: a new MessagingSession.Pause_Patient_First_Name__c field (Text 80), a Patient_First_Name input + assignment on the Pause_Intake_Prechat_Router Flow, a Patient_First_Name channel customParameter, FLS on the Pause_Health_Intake_Prechat_Dossier permission set, both package manifests + deploy.sh inventory + README track-table, and /api/intake/prechat-context emitting Patient_First_Name (intake-patient-stage forwards it in-band) so the agent can greet by $Context.Pause_Patient_First_Name. Deployable XML is comment-free (the documented deploy trap) and validates with xmllint; frontend tests + lint + build green. Org-side remainder (documented in docs/AGENTFORCE_PROVIDER_ACTION_RUNBOOK.md \"Greeting the patient by name\"): deploy the metadata, register Patient_First_Name as a hidden prechat field, add the Pause_Patient_First_Name bot context variable, reference it in the Agent-Level Instructions, then re-Publish the Embedded Service Deployment + Deactivate → Save → Activate the agent.",
        commits: [
          { sha: "0fc0903", label: "intake: personalize the assistant greeting by the patient's name" },
          { sha: "59a3ad0", label: "salesforce: wire Patient_First_Name prechat → context var (greet the patient by name)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the SDOH Screening agent — validated social-needs screening + consent-gated community referral (whole-person care)",
        summary:
          "Added the twenty-third agent on the fabric — sdoh-screening-agent, the Salesforce 'Agentforce for Health' whole-person-care analog — as a first-class patient/clinical-plane agent on a NEW whole-person-care governance tier (screening + referral for social determinants of health is a distinct kind of work from the clinical-decision and care-coordination agents, so it warrants its own tier rather than overloading an existing one; the tier maps to the patient-care plane so the console/proposal grouping and drift guards render it). In a new pure lib/sdoh.ts it screens a patient for health-related social needs / social determinants of health with a validated, public-domain instrument — the CMS Accountable Health Communities HRSN (AHC-HRSN) screening tool's five CORE domains (housing instability, food insecurity, transportation needs, utility needs, interpersonal safety) — where screenSocialNeeds(response) DETERMINISTICALLY flags the positive social-need domains with real rule-based scoring (the Hunger Vital Sign two-item food screen; the HITS interpersonal-safety cutoff of >10) — no LLM, no randomness, no clock, so the same responses always screen identically — and returns an SdohScreeningResult (per-domain positive/negative, a count of positive domains, and any interpersonal-safety red flag). Like the Assessment Agent's validated-instrument allow-list, it refuses to administer any screener not on ALLOWLISTED_SDOH_SCREENERS. draftCommunityReferralsForResult(result, {patientConsent}) then drafts CONSENT-GATED, catalog-sourced community-resource referrals (211, food bank, housing assistance, utility/LIHEAP assistance, a domestic-violence hotline for the safety domain) — each referencing a defined community-resource catalog id, human-approval-gated, and never an autonomous enrollment. TWO load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.sdoh.validated-screener-only (signal usesValidatedSdohScreener, violating value false) blocks a screener outside the validated allow-list, and policy.sdoh.consent-before-referral (signal sdohReferralHasConsent, violating value false) blocks a community referral drafted without the patient's explicit consent. A positive interpersonal-safety screen is a mandatory escalation to a human social worker (mirroring the Assessment Agent's PHQ-9 item 9 handling), recorded as its own trace span. SDOH is SEPARATE from clinical severity — sdohToIntakeSignal(result) raises a whole-person care-coordination flag (and a safety escalation), NOT an intake clinical severity — so it composes with the intake spine WITHOUT ever changing IntakeRecord.severity. It reuses, by extending appliesTo, the HIPAA-audit policy (it touches patient social/clinical context — it is NOT a commercial-plane agent). A runnable A2A endpoint (POST /api/agents/sdoh-screening/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — sdoh.screen → sdoh.safety.escalate (when the red flag fires) → sdoh.refer, every span phiAccessed:true — returning the result + consent-gated referral drafts as an artifact with metadata.agentFabric carrying the trace ids and the honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is also threaded ADDITIVELY into POST /api/intake/route-to-care-router (when a body.sdoh is present it screens + drafts consented referrals, attaching _sdoh to the response meta with its own spans, and never mutates the routing decision), surfaced on /demo/intake via a new SDOH Screening panel (multi-domain positive screen with consented referrals, an interpersonal-safety escalation, a consent-withheld governance block, and a non-allow-listed screener block — rendering the positive domains, the safety escalation, the consent/human-approval/no-autonomous-enrollment referral flags, synthetic labels, and a trace deep link), and a seeded screen→refer + safety-escalation trace, the console subtitle, and the investor brief (now 'twenty-three agents across three planes', with the SDOH Screening agent on the patient/clinical plane) all reflect it. Frontend tests green (+ sdoh determinism/per-domain-scoring/safety-red-flag-escalation/allow-list-rejection/referral-draft-shape-and-consent-gating, the route's envelope/consent-block/allow-list-block/safety-escalation/happy-path, the panel's request-body + view-lift, and the registry drift guards raised to twenty-three agents with the new whole-person-care tier covered); the community-resource catalog is a clearly-labeled illustrative synthetic, NOT a live directory of real programs. Lint + build clean.",
        commits: [
          { sha: "8248f2e", label: "agent fabric: add the SDOH Screening agent (validated social-needs screening + consent-gated community referral)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Clinical Summary agent — after-visit summary + clinician handoff (the third live-Claude agent)",
        summary:
          "Added the twenty-second agent on the fabric — clinical-summary-agent, the Salesforce 'Agentforce for Health' After-Visit Summary / clinical-documentation analog — as a first-class patient/clinical-plane agent on the existing care-coordination governance tier (it is a documentation/coordination artifact, not a new clinical decision, so it REUSES a tier rather than proliferating one). It runs POST-VISIT, downstream of the whole lifecycle, and COMPOSES the outputs the other agents already produced — the intake severity/symptoms, the Care Router pathway, and (optionally) a validated-instrument assessment, an instantiated care plan, and detected care gaps — into TWO artifacts: a patient-friendly After-Visit Summary and a clinician handoff note. In a new pure lib/clinical-summary.ts, assembleClinicalSummaryContext(inputs) DETERMINISTICALLY gathers ONLY the facts present in the provided lifecycle inputs and records the exact sourceRecords the context was assembled from (intake, care-router:<pathway>, assessment:<instrument>, care-plan:<id>, care-gap:<id>) — the agent never invents a clinical fact or a source. summarizeClinical(context, opts?) then phrases the two artifacts with live Anthropic Claude — the THIRD live-Claude agent after the Care Router and the Care Plan agent — falling back to a DETERMINISTIC scripted composition (scriptedSummarizeClinical, with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails, exactly like the Care Plan agent, and returns a ClinicalSummaryResult (patientSummary, clinicianHandoff, sourceRecords, via: 'claude-api' | 'scripted-fallback', optional fallbackReason, synthetic:true). The load-bearing honesty property — every summary must trace to the defined source records the context was assembled from — is genuinely governance-enforced by a NEW enforced-block policy, policy.clinical-summary.source-record-sourced, with its matching boolean signal (summaryTracesToSourceRecords, violating value false) wired into the shared governance-signals metadata so evaluateGovernance() blocks a fabricated / off-context summary that cites a record absent from the assembled context; the pure guard summaryTracesToSourceRecords(result, context) backs it and the route sets the signal honestly from the domain. It also reuses, by extending appliesTo, the anthropic-claude-sonnet model allow-list (live-Claude), the no-prescribing, consent-before-grounding, and HIPAA-audit policies (it touches clinical data — it is NOT a commercial-plane agent) and commits no clinical action. A runnable A2A endpoint (POST /api/agents/clinical-summary/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — clinical-summary.assemble → clinical-summary.summarize, every span phiAccessed:true, the summarize span carrying via + any fallbackReason — returning both artifacts + the sourceRecords as an artifact with metadata.agentFabric carrying the trace ids and the grounding signal, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. It is also threaded ADDITIVELY into POST /api/intake/route-to-care-router (when clinicalSummary is present it assembles + summarizes after the care-router decision and any care plan, attaching _clinicalSummary to the response meta with its own spans), surfaced on /demo/intake via a new Clinical Summary panel (happy-path + governance-blocked 'ungrounded summary' presets, both artifacts, the sourceRecords provenance, via/fallbackReason badges, a synthetic label, and a trace deep link), and a seeded assemble→summarize (scripted-fallback) trace, the console subtitle, and the investor brief (now 'twenty-two agents across three planes', with the Clinical Summary agent on the patient/clinical plane) all reflect it. Frontend tests green (+ clinical-summary determinism/grounding-guard-true-and-false/live-Claude-success-via-mocked-SDK/SDK-error + missing-key fallback with fallbackReason, the route's envelope/governance-block-on-ungrounded-summary/model-allow-list/happy-path, the panel's request-body + view-lift, and the registry drift guards raised to twenty-two agents); both artifacts are clearly-labeled illustrative synthetics — a composition of already-synthetic records for two audiences that requires clinician review — NOT a certified clinical-documentation engine. Lint + build clean.",
        commits: [
          { sha: "598796f", label: "agent fabric: add the Clinical Summary agent (after-visit summary + clinician handoff, the third live-Claude agent)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Prior Authorization agent — clinician-gated, documentation-complete PA assembly",
        summary:
          "Added the twenty-first agent on the fabric — prior-authorization-agent, the Salesforce 'Agentforce for Health' / Health Cloud CareRequest + Utilization Management analog — as a first-class clinical-plane agent that REUSES the Care Router / Care Plan clinical-decision governance tier (PA is a clinical / utilization decision). It is the HEAVIEST agent and, deliberately, the LEAST demo-honest of the set: real prior authorization is a genuinely multi-system X12 278 (or FHIR PAS / Da Vinci) EDI workflow against a payer's utilization-management system, so the mock is labeled especially clearly, and — per Salesforce's own guidance to do PA last — we did it last. In a new pure lib/prior-auth.ts a small catalog of PA-requiring menopause items (systemic HRT / compounded estradiol, a bone-density DEXA scan, and a specialized hormone lab panel), each carrying the payer medical-necessity criteria it must satisfy and its required supporting-documentation checklist, backs assemblePriorAuth(request), which DETERMINISTICALLY matches the criteria against the (synthetic) clinical context, assembles the required-documentation checklist (present vs missing), and returns a PriorAuthPackage — matched criteria (every one referencing a defined catalog id), documentation completeness, a synthetic Health Cloud CareRequest / authorization id (hashed from stable request keys — no randomness, no clock), a status (draft / ready-for-clinician / submitted / approved / denied), requiresClinicianApproval:true, submitted:false, and a source/provenance block marked synthetic:true. TWO load-bearing honesty properties are genuinely governance-enforced, each with its own NEW enforced-block policy + matching boolean signal wired into the shared governance-signals metadata: policy.pa.no-autonomous-submission (signal paHasClinicianApproval, violating value false) blocks a caller-asserted submit-without-clinician-approval — the agent may only assemble a clinician-gated draft, and a clinician must approve before submission; and policy.pa.documentation-integrity (signal paDocumentationComplete, violating value false) blocks a submission missing a required supporting document — assembling a DRAFT with missing docs is fine (it honestly lists what's outstanding), only a submission must be documentation-complete. The route sets both signals honestly from the domain (priorAuthHasClinicianApproval / priorAuthDocumentationComplete), and submitPriorAuth() refuses (throws) on either violation as defense in depth. It also reuses, by extending appliesTo, the no-prescribing, consent-before-grounding, and HIPAA-audit policies. A runnable A2A endpoint (POST /api/agents/prior-authorization/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — priorauth.criteria.match → priorauth.docs.assemble → priorauth.await-clinician (the human-approval gate; a clinician-approved + documentation-complete submit instead advances to priorauth.submit) — returning the PA package as an artifact with metadata.agentFabric carrying the trace ids and the two honesty signals, failed-task on a block) and a /.well-known/agent.json card whose policies derive from the registry round it out. As a standalone agent (downstream of the Care Plan / clinical decision) a seeded criteria-match→docs-assemble→await-clinician trace (drafted, not submitted), the console subtitle, and the investor brief (now 'twenty-one agents across three planes', with a Prior Authorization card noting it's the heaviest, deliberately-last workflow and the two new policies in the enforcement paragraph) all reflect it. Frontend tests green (+ prior-auth determinism/criteria-matching/documentation-completeness/clinician-gated-package-shape/off-catalog-rejection, the route's envelope/governance-block-for-both-policies/happy-path + submit, and the registry drift guards raised to twenty-one agents); the payer criteria + document checklists are clearly-labeled illustrative synthetics, NOT a certified utilization-management engine — and no PA assembled here is a real coverage determination or a real 278/EDI / payer PA portal submission. Lint + build clean.",
        commits: [
          { sha: "397de6a", label: "agent fabric: add the Prior Authorization agent (clinician-gated, documentation-complete PA assembly)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Member Service / Billing agent — claim-sourced billing answers + human routing",
        summary:
          "Added the twentieth agent on the fabric — member-service-agent, the Salesforce 'Agentforce for Health' Claims & Coverage / patient-service analog — as a first-class, patient-facing self-service agent on the patient/clinical plane that REUSES the intake agent's patient-facing governance tier. It answers a member's BILLING & COVERAGE self-service questions — claim status, copay / patient responsibility, outstanding balance, and EOB explanation — grounded on the member's synthetic claim/EOB records, and routes anything out of scope (a clinical, prescription, or scheduling request) to a human member-services specialist with a PII-safe billing context bundle, keeping it scoped to billing/coverage self-service so it stays distinct from the Engagement Agent. In a new pure lib/member-service.ts a ClaimRecord model (claim id, date-of-service, provider, billed / allowed / plan-paid / patient-responsibility, and a submitted / adjudicated / paid / denied status) is generated DETERMINISTICALLY by hashing the member/claim key (FNV-1a) into realistic figures (billed $150–$1,025; allowed 55–70% of billed; member coinsurance 10–30%; dates counted back from a fixed anchor — no randomness, no clock), so the same member always yields the same claims. classifyIntent() maps a free-text question to one of the four in-scope billing intents or out-of-scope, and answerBillingQuestion(query, claims) returns a structured BillingAnswer that ALWAYS cites the specific ClaimRecord(s) it derived from (a source + citedClaims block, synthetic:true) plus a routeToHuman escalation path with a PII-safe context bundle when out of scope. The critical honesty property is that a billing/claim answer must trace to a synthetic claim/EOB record — the agent may NOT fabricate claim data. That is genuinely enforced by a NEW enforced-block policy, policy.billing.claim-data-sourced, with its matching boolean signal (billingTracesToClaim, violating value false) wired into the shared governance-signals metadata so evaluateGovernance() blocks a caller-asserted billing answer that cites no claim — the route sets the signal honestly from the domain's answerTracesToClaim() (a route-to-human handoff asserts no billing figure, so it is source-clean; an in-scope answer must cite a claim). It also reuses, by extending appliesTo, the no-free-text-pii policy (structured, claim-referenced answers only) and the HIPAA audit. A runnable A2A endpoint (POST /api/agents/member-service/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — billing.claim.lookup → billing.answer → an optional billing.route-to-human handoff — returning the answer + cited claims as an artifact with metadata.agentFabric carrying the trace ids, the intent, the cosign signal, and nextAgent on a handoff) and a /.well-known/agent.json card whose policies derive from the registry round it out. As a standalone patient-service node (not threaded into route-to-care-router) a seeded claim-lookup→answer→route-to-human trace, the console subtitle, and the investor brief (now 'twenty agents across three planes', with a Member Service / Billing card and the new policy in the enforcement paragraph, noting it's scoped to billing/coverage self-service) all reflect it. Frontend tests green (+ member-service determinism/claim-generation-ranges/every-answer-cites-a-claim/route-to-human-context-bundle/unsourced-rejection, the route's envelope/governance-block/happy-path + route-to-human, and the registry drift guards raised to twenty agents); the claim/EOB records are clearly-labeled illustrative synthetics, NOT a real claims / 835-ERA / payer system. Lint + build clean.",
        commits: [
          { sha: "397de6a", label: "agent fabric: add the Member Service / Billing agent (claim-sourced billing answers + human routing)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Referral Management agent — clinician-cosigned outbound referrals",
        summary:
          "Added the nineteenth agent on the fabric — referral-management-agent, the Salesforce 'Agentforce for Health' Referrals ('Create Referral') analog — as a first-class care-coordination agent on the patient/clinical plane that REUSES the Scheduling agent's care-coordination governance tier. It GENERALIZES the Care Router's behavioral-health-handoff into a full outbound-referral node: rather than expressing a single handoff pathway, it triages a patient's intake + Care Router routing signals into referrals across the adjacent specialists menopause commonly touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, and behavioral health. In a new pure lib/referrals.ts a small illustrative ReferralSpecialty catalog (each with an id, label, and typical trigger) backs triageReferrals(context), which DETERMINISTICALLY derives recommended referral(s) from age/cycle/symptom/severity/red-flag signals + explicit risk flags (red-flag mood → behavioral-health; osteoporosis / high-fracture-risk → bone-health; high cholesterol / CVD signals → cardiology; GSM / pelvic-floor dysfunction → pelvic-floor-PT; menopause-pattern symptoms under 40 → endocrinology for a POI workup) — no randomness, no clock — so the same context always yields the same recommendations. The load-bearing integrity property is that EVERY recommended referral references a defined specialty-catalog id AND carries a documented reason (never fabricated, never reasonless), and draftReferral(specialty, context) builds a referral request marked requiresClinicianCosign:true, status:'drafted', sent:false. The critical honesty property is that it can only DRAFT: an outbound referral requires a clinician's sign-off before it is sent — a human-in-the-loop clinical action. That is genuinely enforced by a NEW enforced-block policy, policy.referral.clinician-cosign, with its matching boolean signal (referralHasClinicianCosign, violating value false) wired into the shared governance-signals metadata so evaluateGovernance() blocks a caller-asserted send-without-cosign — the route sets the signal honestly from the domain's referralHasClinicianCosign(); a draft (or a clinician-cosigned send) passes. It also reuses, by extending appliesTo, the rationale-required policy (adapted so a referral must carry a documented reason) and the HIPAA audit. A runnable A2A endpoint (POST /api/agents/referral-management/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — referral.triage → per-referral referral.draft → a referral.await-cosign marker — returning recommendations + referrals as an artifact with metadata.agentFabric carrying the trace ids and the cosign signal) and a /.well-known/agent.json card whose policies derive from the registry round it out. As a standalone agent (it complements the Care Router; not threaded into route-to-care-router) a seeded triage→draft→await-cosign trace, the console subtitle, and the investor brief (now 'nineteen agents across three planes', with a Referral Management card and the new policy in the enforcement paragraph, noting it generalizes the behavioral-health handoff) all reflect it. Frontend tests green (+ referrals determinism/triage/catalog-integrity/off-catalog-rejection/cosign-signal, the route's envelope/governance-block/happy-path, and the registry drift guards raised to nineteen agents); the specialties + triage rules are clearly-labeled illustrative synthetics, NOT a certified clinical referral engine. Lint + build clean.",
        commits: [
          { sha: "397de6a", label: "agent fabric: add the Referral Management agent (clinician-cosigned outbound referrals)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Medication Adherence agent — nudge-only HRT/SSRI adherence + refill prompts",
        summary:
          "Added the eighteenth agent on the fabric — medication-adherence-agent, the Salesforce 'Agentforce for Health' / Health Cloud MedicationRequest + MedicationTherapyReview analog — as a first-class, PROACTIVE patient-care agent on the patient-engagement tier (patient/clinical plane), a sibling of the Care Gap Closure agent. In a new pure lib/medication-adherence.ts it tracks menopause-medication adherence + refill timing across a small illustrative catalog — transdermal estradiol + oral micronized progesterone (HRT) and paroxetine (SSRI) / venlafaxine (SNRI) for vasomotor symptoms or mood, each with a days-supply — and DETERMINISTICALLY computes a good / at-risk / lapsed adherence status and a refill-due call from days-since-fill vs supply against an EXPLICIT as-of date (no randomness, no clock), so the same inputs always yield the same assessment. It drafts consent- and quiet-hours-aware refill/adherence NUDGES (draftAdherenceNudges) for each medication due or off-track, and flags adherence drop-off (a lapsed medication) to the care team. The load-bearing honesty property is that it can only NUDGE: every nudge is marked requiresHumanApproval:true, sent:false, nudgeOnly:true, and the agent must NEVER autonomously submit or order a refill — a refill is a clinical action that requires a human-in-the-loop. That is genuinely enforced: a NEW enforced-block policy, policy.medication.no-autonomous-refill, with its matching boolean signal (refillRequiresHumanApproval, violating value false) wired into the shared governance-signals metadata so evaluateGovernance() blocks a caller-asserted autonomous refill (a submit-refill without human approval) — the route sets the signal honestly from the domain's refillRequiresHumanApproval(), and an autonomous refill also trips the reused no-prescribing block (an autonomous refill is a clinical action committed without a clinician). It also reuses the engagement outreach guards extended onto the agent — contact-consent-required, human-approval-before-send, quiet-hours + channel preference, and the HIPAA audit. A runnable A2A endpoint (POST /api/agents/medication-adherence/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — medication.adherence.assess → per-med medication.nudge.draft → a medication.dropoff.flag routed to the care team → an engagement.outreach.handoff span attributed to the Engagement Agent — returning assessments + nudges as an artifact with metadata.agentFabric carrying the trace ids and nextAgent) and a /.well-known/agent.json card whose policies derive from the registry round it out. As a proactive agent it isn't threaded into route-to-care-router; a seeded assess→nudge→dropoff→engagement-handoff trace, the console subtitle, and the investor brief (now 'eighteen agents across three planes', with a Medication Adherence card and the new policy in the enforcement paragraph) all reflect it. Frontend tests green (+ medication-adherence determinism/status-computation/refill-due/nudge-shape/drop-off, the route's envelope/governance-block/happy-path + engagement-handoff, and the registry drift guards raised to eighteen agents); the medications + refill intervals are clearly-labeled illustrative synthetics, NOT a certified pharmacy / e-prescribing system. Lint + build clean.",
        commits: [
          { sha: "397de6a", label: "agent fabric: add the Medication Adherence agent (nudge-only HRT/SSRI adherence + refill prompts)" }
        ],
        status: "shipped"
      },
      {
        title: "Demo: front doors for the Scheduling, Care Gap, and Care Plan agents on the intake demo",
        summary:
          "The three newest agents (Appointment Scheduling, Care Gap Closure, Care Plan) shipped as runnable A2A endpoints but had no UI; this adds their front doors on /demo/intake, mounted after the Benefits panel as exact siblings of the Assessment and Benefits panels (five panels now read as one coherent set). All presentational + client-fetch only — no changes to any agent, domain logic, governance, or API route. components/scheduling-panel.tsx: book / reschedule presets plus BOTH governance blocks — policy.scheduling.no-double-book and policy.scheduling.honor-provider-availability (taken/open slots are derived from getProviderAvailability so the block presets are honest, not hard-coded) — rendering the confirmed slot, the synthetic ServiceAppointment provenance, and the engagement-reminder handoff (nextAgent = engagement-agent, drafted / quiet-hours-aware / human-approval-gated / never auto-sent). components/care-gap-panel.tsx: gap-detection presets (postmenopausal-on-HRT; perimenopausal with partial history, where an up-to-date mammogram is skipped while an overdue lipid panel surfaces) plus consent-required and off-catalog-gap (policy.caregap.clinical-measure-sourced) blocks, rendering per-gap cards (measure, status + priority, rationale, measure id) with their consent-/quiet-hours-aware, human-approval-gated outreach drafts, the grounding/integrity note, and the engagement handoff. components/care-plan-panel.tsx: template-selection presets (vasomotor / on-HRT / behavioral-mood) plus the policy.careplan.template-sourced block, rendering the instantiated plan (goals, interventions, follow-up cadence) and the summary with a green 'live Claude' vs amber 'scripted fallback' badge and, on fallback, the fallbackReason — both branches unit-tested (the sandbox with no ANTHROPIC_API_KEY renders the scripted-fallback branch; a keyed environment renders the claude-api branch). Every panel carries a deep link to the multi-agent trace and honest 'synthetic / illustrative / not a certified engine' framing. 1007 frontend tests green (+35: 11 scheduling, 11 care-gap, 13 care-plan), mirroring the repo's node-env panel-test style; lint + build clean.",
        commits: [
          { sha: "9cf7231", label: "demo: add Scheduling, Care Gap, and Care Plan panels to the intake demo" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Care Plan agent — template-instantiated plan + live-Claude progress summary (second Claude agent)",
        summary:
          "Added the seventeenth agent on the fabric — care-plan-agent, the Salesforce 'Agentforce for Health' / Health Cloud CarePlan + care-plan-summarization analog — as a first-class clinical-plane sibling of the Care Router that REUSES the existing clinical-decision governance tier. Post-visit, it does two things in a new lib/care-plan.ts. First, instantiateCarePlan() DETERMINISTICALLY instantiates a menopause care plan from a defined template catalog — HRT-management, vasomotor/lifestyle, bone-health, and mood/behavioral, each with structured goals, interventions, and a follow-up cadence — selected from the Care Router's pathway/severity + intake with an explicit precedence order and a severity-adjusted cadence (no randomness, no clock), so the same context always yields the same plan and every plan references a defined template id. Second, summarizeCarePlan() is the SECOND live-Claude agent after the Care Router: it mirrors lib/care-router.ts EXACTLY — a dynamic @anthropic-ai/sdk import gated by ANTHROPIC_API_KEY, the same model + PAUSE_CARE_PLAN_MODEL override, a via: 'claude-api' | 'scripted-fallback' discriminator, and a non-clinical fallbackReason stamped on every fallback branch (missing key + any SDK error) — producing a concise, NON-PRESCRIPTIVE patient/clinician progress summary that falls back to a deterministic scripted summary. The honest core is governance: a NEW enforced-block policy, policy.careplan.template-sourced, with its matching boolean signal (planTracesToTemplate) wired into the shared governance-signals metadata so evaluateGovernance() genuinely blocks a caller-asserted off-template (fabricated) plan, PLUS the Care Router's model allow-list, no-prescribing, rationale-required, consent-before-grounding, and HIPAA-audit policies reused by extending appliesTo. A runnable A2A endpoint (POST /api/agents/care-plan/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate INCLUDING the model allow-list, real parented trace spans — careplan.instantiate (deterministic) → careplan.summarize (records via + a conditional fallbackReason attribute exactly like the Care Router route) — returning the plan + summary as an artifact with metadata.agentFabric) and a /.well-known/agent.json card whose policies derive from the registry round it out. It also threads into the spine the light way: POST /api/intake/route-to-care-router accepts an optional carePlan request and, after the Care Router hop, instantiates a plan and attaches a summary to the trace + response meta — additive, so absent = today's behavior unchanged. A seeded router→instantiate→summarize trace shows a deterministic scripted-fallback summary (so it never implies a live call happened at seed time), and the console subtitle + investor brief (now 'seventeen agents across three planes', with a Care Plan card noting it's the second live-Claude agent and the new policy in the enforcement paragraph) reflect it. Tests mirror care-router.test.ts (vi.mock('@anthropic-ai/sdk'): a mocked success yields via: claude-api; a mocked SDK error and the missing-key path both yield via: scripted-fallback WITH a fallbackReason), plus deterministic instantiation + template-integrity, the route's envelope/governance/block/model-allow-list/happy paths, and the registry drift guards raised to seventeen agents — none require a real ANTHROPIC_API_KEY. Lint + build clean.",
        commits: [
          { sha: "7744ed4", label: "agent fabric: add the Care Plan agent (template-instantiated plan + live-Claude progress summary)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Care Gap Closure agent — proactive, Data-360-grounded, clinical-measure-sourced",
        summary:
          "Added the sixteenth agent on the fabric — care-gap-closure-agent, the Salesforce 'Agentforce for Health' / Health Cloud care-gap-closure analog — as a first-class, PROACTIVE patient-care agent on the patient/clinical plane (its own NEW care-gap governance tier). Unlike the reactive intake→router spine, it grounds on the patient's Data 360 context + age/cycle/symptom signals and DETERMINISTICALLY detects menopause-relevant preventive-care gaps in a new pure lib/care-gaps.ts: a small catalog of illustrative clinical measures (bone-density/DEXA for osteoporosis risk, lipid panel, screening mammogram, HRT follow-up visit — each with an id, label, guideline/rationale, and recommended interval), the CareGap type (referencing a clinical-measure catalog id, open/overdue status, dueSince/lastDone, priority), and detectCareGaps(context) that derives gaps against an EXPLICIT as-of date (no randomness, no clock) so the same context always yields the same gaps. The load-bearing property is integrity, not clinical authority: every detected gap references a defined clinical-measure catalog id — never a fabricated one — and the clinical measures + intervals are clearly-labeled illustrative synthetics, NOT a certified guideline engine. It also drafts consent- and quiet-hours-aware outreach per gap (draftGapOutreach), always human-approval-gated and never auto-sent, for handoff to the Engagement Agent. The honest core is governance: a NEW enforced-block policy, policy.caregap.clinical-measure-sourced, with its matching boolean signal (gapsTraceToClinicalMeasure) wired into the shared governance-signals metadata so evaluateGovernance() genuinely blocks a caller-asserted off-catalog gap (the drift guards would have failed otherwise), plus the reused engagement/outreach guards extended onto the agent — contact-consent-required, human-approval-before-send, quiet-hours + channel preference, consent-before-grounding, and the HIPAA audit. A runnable A2A endpoint (POST /api/agents/care-gap-closure/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans — data360.grounding → caregap.detect → per-gap caregap.outreach.draft → an engagement.outreach.handoff span attributed to the Engagement Agent — returning detected gaps + drafts as an artifact with metadata.agentFabric carrying the trace ids and nextAgent) and a /.well-known/agent.json card whose policies derive from the registry round it out. As a proactive agent it isn't threaded into route-to-care-router; a seeded grounding→detect→draft→engagement-handoff trace, the console subtitle, and the investor brief (now 'sixteen agents across three planes', with a Care Gap Closure card and the new policy in the enforcement paragraph) all reflect it. Frontend tests green (+ care-gaps determinism/detection/catalog-integrity/outreach-consent/off-catalog-rejection, the route's envelope/governance/happy-path + engagement-handoff, and the registry drift guards raised to sixteen agents); lint + build clean.",
        commits: [
          { sha: "7744ed4", label: "agent fabric: add the Care Gap Closure agent (proactive, Data-360-grounded, clinical-measure-sourced)" }
        ],
        status: "shipped"
      },
      {
        title: "Demo: gave the Benefits & Coverage Verification (EBV) agent a front door on the intake demo",
        summary:
          "The EBV agent shipped as a runnable A2A endpoint but had no UI; this adds its front door on /demo/intake, mounted directly under the Assessment panel and mirroring its look and honest framing. A new client component (components/benefits-panel.tsx) leads with one-click presets that each POST a coverage query to /api/agents/benefits-verification/tasks: an in-network plan with the deductible met (Aetna Choice PPO, $1,500 met, 20% coinsurance on a $420 visit → ~$84 patient responsibility); a high-deductible plan not yet met (UnitedHealthcare Saver HDHP, $0 of $6,000 met → the full $260 visit lands on the patient); self-pay / no active coverage (inactive, but still a sourced no-active-coverage EBV response); and a caller-asserted coverage object with no source that trips policy.benefits.eligibility-source-integrity so the governance block renders in the UI (blocking policy + reason + policies evaluated). A tidy 'build your own query' affordance (payer / member id / ZIP / service type) rounds it out. Results render the plan name + eligibility/network status pills, deductible met/total/remaining, cost share (copay or coinsurance %), estimated visit cost and estimated patient responsibility, and a labeled SYNTHETIC payer/clearinghouse provenance block (payer, clearinghouse, transaction type/id, response code, honesty note) so the mock nature of the EBV round-trip is explicit. A deep link (Open the multi-agent trace →) jumps to /demo/agent-fabric?taskId=<id>, and an optional 'Carry this coverage into the Care Router →' follow-on POSTs the query to /api/intake/route-to-care-router and shows the returned pathway + acuity, noting the routing was preceded by a verified coverage check. Presentational + client-fetch only — no changes to the agent, domain logic, governance, or API routes. 911 frontend tests green (+14, mirroring the repo's node-env panel-test style); lint + build clean.",
        commits: [
          { sha: "5ecff9d", label: "demo: add the Benefits & Coverage Verification (EBV) panel to the intake demo" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Appointment Scheduling agent — closes the intake→routing→booking loop",
        summary:
          "Added the fifteenth agent on the fabric — appointment-scheduling-agent, the Salesforce 'Agentforce for Health — Book/Reschedule/Update Appointment' analog — as a first-class care-coordination agent on the patient/clinical plane (its own NEW care-coordination governance tier). It books (and can reschedule) the MSCP menopause-specialist visit the Care Router recommends, honoring the requested modality (telehealth / in-person) against a deterministic synthetic provider availability calendar, and returns a structured AppointmentBooking in a new pure lib/scheduling.ts: a synthetic Salesforce ServiceAppointment id, the confirmed slot start/end, modality, provider, status (booked / rescheduled), and a source provenance block marked synthetic:true. It is DETERMINISTIC on its inputs — getProviderAvailability() hashes providerId + date + slot index into a stable set of 30-minute business-hours slots (09:00–16:30, weekdays only), ~a third pre-'booked', each offered in telehealth and/or in-person, with no randomness and no clock — so the same provider + date always produces the same calendar, and it is clearly NOT a real Salesforce Scheduler / ServiceAppointment write. The honest core is governance: TWO NEW enforced-block policies with matching boolean signals wired into the shared governance-signals metadata so evaluateGovernance() genuinely blocks — policy.scheduling.no-double-book (signal requestedSlotIsFree; the scheduler refuses an already-taken slot) and policy.scheduling.honor-provider-availability (signal slotWithinProviderAvailability; the scheduler refuses a time outside the provider's published availability for the modality) — set honestly by the route from the domain layer's checks, with bookAppointment() also throwing on either violation as defense in depth; plus the reused HIPAA-audit policy extended onto the agent. A runnable A2A endpoint (POST /api/agents/appointment-scheduling/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans, and a handoff span to the Engagement Agent for reminders) and a /.well-known/agent.json card whose policies derive from the registry round it out. It wires into the existing spine the light way: POST /api/intake/route-to-care-router now accepts an optional scheduling request and, when the routing decision recommends MSCP provider(s), books the top recommendation (modality defaulted from the pathway) and attaches the booking summary to the trace + response meta after the Care Router hop — additive, so absent = today's behavior unchanged. A seeded care-router→booking→engagement trace, the console subtitle, and the investor brief (now 'fifteen agents across three planes', with an Appointment Scheduling card and the two new policies in the enforcement paragraph) all reflect the closed loop: acquisition → intake → routing → booking → engagement. Frontend tests green (+ scheduling determinism/availability/no-double-book/honor-availability/reschedule/source-provenance, the route's envelope/governance/happy-path + engagement-handoff, and the registry drift guards raised to fifteen agents); lint + build clean.",
        commits: [
          { sha: "7908fc4", label: "agent fabric: add the Appointment Scheduling agent (intake→routing→booking→engagement)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Benefits & Coverage Verification (EBV) agent",
        summary:
          "Added the fourteenth agent on the fabric — benefits-verification-agent, the Salesforce 'Agentforce for Health — Eligibility & Benefit Verification' analog — as a first-class patient-access agent on the patient/clinical plane (its own new benefits-verification governance tier). It verifies a patient's insurance coverage for a menopause specialist (MSCP) visit and returns a structured, DEMO-HONEST synthetic eligibility result in a new pure lib/benefits.ts: plan status (active/inactive), in/out-of-network, deductible + amount met + remaining, coinsurance/copay, and an estimated visit cost + patient out-of-pocket, plus a source provenance block naming a MOCK payer/clearinghouse and a synthetic EBV transaction id. It is DETERMINISTIC on its inputs — the member/plan string is hashed to pick a plausible-but-fake plan profile (deductible $1,500–$6,000, coinsurance 10–30%, visit $180–$420, $500-increment amount-met), with no randomness and no clock — and it is clearly NOT a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse; a known-payer allow-list (Aetna, BCBS, Cigna, UnitedHealthcare, Kaiser in-network; Humana/Medicare and unrecognized payers out-of-network; self-pay → inactive) drives the network logic. The honest core is governance: a NEW enforced-block policy, policy.benefits.eligibility-source-integrity, with its matching boolean signal (eligibilityTracesToSource) wired into the shared governance-signals metadata so evaluateGovernance() genuinely blocks a returned coverage result that doesn't trace to a payer/clearinghouse EBV response — the agent may not fabricate coverage without a source — plus the reused consent-before-grounding and HIPAA-audit policies extended onto the agent. A runnable A2A endpoint (POST /api/agents/benefits-verification/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans) and a /.well-known/agent.json card whose policies derive from the registry round it out. It wires into the existing spine the light way: POST /api/intake/route-to-care-router now runs a coverage check when the intake carries patientInsurance (or an explicit coverageQuery) and attaches the eligibility summary to the trace + response meta before the Care Router hop — additive, so absent = today's behavior unchanged. A seeded coverage→intake→routing trace, the console subtitle, and the investor brief (now 'fourteen agents across three planes', with a Benefits & Coverage Verification card and the new policy in the enforcement paragraph) all reflect it. Frontend tests green (+ benefits scoring/range/network/source-provenance/allow-list determinism, the route's envelope/governance/happy paths, and the registry drift guards raised to fourteen agents); lint + build clean.",
        commits: [
          { sha: "4ea4212", label: "agent fabric: add the Benefits & Coverage Verification (EBV) agent" }
        ],
        status: "shipped"
      },
      {
        title: "Demo: gave the Assessment Agent a front door on the intake demo",
        summary:
          "The Assessment Agent shipped as a runnable A2A endpoint but had no UI; this adds its front door on /demo/intake, mirroring the acquisition-funnel panel's look and honest framing. A new client component (components/assessment-panel.tsx) leads with one-click presets that each POST a valid response vector to /api/agents/assessment/tasks: a moderate PHQ-9; a PHQ-9 whose item-9 (self-harm) red flag escalates intake severity to severe even though the total band stays moderate — the escalation gap made visible; a severe multi-domain MRS with per-domain subscore bands; and an off-allow-list GAD-7 that trips policy.assessment.validated-instrument-only so the governance block renders in the UI (blocking policy + reason + policies evaluated). A 'build your own responses' toggle reveals the four-instrument picker and compact per-item segmented 0..max controls (Greene's 21 items gated behind the toggle so the default view stays tidy). Results render the instrument name, total/maxTotal · band, normalized + intake-severity pills, subscore bands, and a calm role=note 'safety escalation' callout for red flags, plus a deep link (Open the multi-agent trace →) to /demo/agent-fabric?taskId=<id>. An optional 'Carry this score into the Care Router →' follow-on POSTs the assessment to /api/intake/route-to-care-router and shows the returned pathway + acuity, noting when severity was assessment-driven. Presentational + client-fetch only — no changes to the agent, domain logic, governance, or API routes. 836 frontend tests green (+11, mirroring the repo's node-env panel-test style); lint + build clean.",
        commits: [
          { sha: "7a02f9d", label: "demo: add the Assessment Agent panel to the intake demo" }
        ],
        status: "shipped"
      },
      {
        title: "UI: layered surface tokens + a restrained sans-serif polish pass (no display serif)",
        summary:
          "A cohesive, presentational-only polish of the shared design language — done entirely in globals.css, with all text staying on Inter (an earlier pass that introduced a Fraunces display serif was rejected, so this one adds no serif/display typeface at all). The load-bearing part is a real bug fix: --surface-2 and --surface-3 were referenced by page.tsx, the roadmap, and the changelog itself but were never defined, so those raised panels and borders silently resolved to nothing. This defines a proper layered surface scale (bg → surface → surface-2 → surface-3) plus --line-strong / --brand-soft and a radius scale, so those planes finally read as distinct depths. On top of that: tighter heading letter-spacing with balanced heading wrap and pretty paragraph wrap, tabular + lining figures on stat/metric values so number columns stop jittering, a comfortable hero measure and 1.6 body line-height (elegance through weight/size/spacing, not a new face); softer layered card shadows where only interactive a.card/button.card earn a 2px lift + brand-tinted border on hover; refined button hover/active/:focus-visible states; and — the one deliberate accessibility call — primary button text moved to dark plum on the pink brand, lifting contrast from ~2.8:1 (failing) to ~6:1 (WCAG AA). Rounded out with a crisper sticky nav (blur+saturate + hairline highlight), a softened hero glow, and a site-wide prefers-reduced-motion safeguard. No content, routes, component APIs, or logic changed; 825 tests still green, lint + build clean.",
        commits: [
          { sha: "ecb3a88", label: "ui: define layered surface tokens + restrained sans-serif polish pass" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Assessment Agent — validated-instrument scoring feeds intake severity",
        summary:
          "Added the thirteenth agent on the fabric — assessment-agent, the Salesforce 'Agentforce for Health — Assessments' analog — as a first-class patient-facing agent on the patient/clinical plane. It administers and DETERMINISTICALLY scores an allow-listed set of validated instruments (Menopause Rating Scale, Greene Climacteric Scale, PHQ-9, Insomnia Severity Index) in a new pure lib/assessments.ts: real cutoff-based math, no LLM, producing per-instrument subscores, a total, and a severity band normalized onto intake's mild/moderate/severe vocabulary. Cutoffs are faithful to each instrument's published scoring (PHQ-9 0-4/5-9/10-14/15-19/20-27; ISI 0-7/8-14/15-21/22-28; MRS 0-4/5-8/9-16/17+ plus the published subscale cutoffs); the Greene scale has no agreed total-score band, so its three total cutoffs are marked // inferred. Red-flag items are handled explicitly — PHQ-9 item 9 (self-harm ideation) on any non-zero response escalates as its own trace span and forces the intake severity to severe regardless of band. The honest core of the change is governance: a NEW enforced-block policy, policy.assessment.validated-instrument-only, with its matching boolean signal wired into the shared governance-signals metadata so evaluateGovernance() genuinely blocks any instrument off the allow-list (the drift guards would have failed otherwise), plus the reused no-free-text-PII, red-flag-mandatory, and HIPAA-audit policies extended onto the agent. A runnable A2A endpoint (POST /api/agents/assessment/tasks, JSON-RPC tasks/send validated with parseTasksSendEnvelope, a pre-flight governance gate, real parented trace spans) and a /.well-known/agent.json card whose policies derive from the registry round it out. The result wires into the existing spine the light way: POST /api/intake/route-to-care-router now accepts an optional assessment, and when present the scored severity drives IntakeRecord.severity (and the red-flag screen) before the Care Router hop — a real instrument score behind the routing decision instead of a self-report — additive, so absent = today's behavior unchanged. A seeded assessment→intake→routing trace, the console subtitle, and the investor brief (now 'thirteen agents across three planes', with an Assessment Agent card and the new policy in the enforcement paragraph) all reflect it. 825 frontend tests green (+32: instrument scoring correctness, band cutoffs, red-flag handling, allow-list rejection, the route's envelope/governance/happy paths, and the registry drift guards); lint + build clean.",
        commits: [
          { sha: "9d07a69", label: "agent fabric: add the Assessment Agent (validated-instrument scoring → intake severity)" }
        ],
        status: "shipped"
      },
      {
        title: "Home: promoted the Care Router card to a \u201clive\u201d status pill",
        summary:
          "With the Care Router's live Claude Sonnet 4.5 path confirmed working in production (provider: anthropic / via: claude-api), the homepage's 'Anthropic-backed Care Router agent' card graduated from 'partial' to a new, distinct 'live' status. Added a `live` variant to StatusPillStatus (label 'Today \u00b7 live', rendered TODAY \u00b7 LIVE) backed by a saturated emerald --live tone in globals.css \u2014 visually distinct from the mint tone that prototype/partial share, so 'genuinely live in production' reads at a glance while the graceful scripted fallback still exists. Purely additive: audited every StatusPill consumer (homepage, changelog, ~25 proposal/marketing pages) and none needed changes. 793 frontend tests green; lint + build clean.",
        commits: [
          { sha: "dd435cc", label: "home: promote the Care Router card to a \u201clive\u201d status pill" }
        ],
        status: "shipped"
      },
      {
        title: "Intake: routed a completed Agentforce chat intake to the Care Router",
        summary:
          "The live Agentforce Embedded Messaging chat on /demo/intake never handed off to the Pause Care Router. Because the V2 SDK exposes no dependable end-of-conversation event on this deployment (only onEmbeddedMessagingReady / onEmbeddedMessagingInitError are confirmed to fire — trusting an unverified 'closed' event would repeat the prechatAPI no-op-Proxy mistake), a new <ChatToCareRouterHandoff/> renders an explicit 'Complete intake → route to Care Router' affordance beneath the chat. It POSTs the selected persona's deterministic intake to the existing /api/intake/route-to-care-router handoff and renders the live decision inline (pathway, acuity, provider/model/via, and any fallbackReason) with a deep link to the multi-agent trace. An optional origin — sanitized to a strict ^[a-z0-9-]{1,40}$ slug so no free text or PHI leaks — is threaded through the handoff and stamped on every span in the parented tree (intake → Data 360 identity/grounding → care-router → mcp-bridge), so the chat-originated route reads origin=agentforce-chat and stays one continuous task in the viewer, distinct from the /demo/routing button. 793 frontend tests green (+7); lint + build clean.",
        commits: [
          { sha: "b10054f", label: "intake: route completed agentforce chat intake to the care router" }
        ],
        status: "shipped"
      },
      {
        title: "Care Router: hardened the Claude response parsing and surfaced the fallback reason",
        summary:
          "Once the production key was live, the Care Router's Claude call was firing (a ~6s span, vs ~250ms when the key was absent) but still landing on the deterministic fallback: the model wraps its JSON in markdown fences or a lead-in sentence, so a bare JSON.parse threw and the catch swallowed it — and the 800-token cap risked truncating the JSON outright. Added extractJsonObject() to strip code fences and pull the first balanced {…} object, normalized the returned pathway, and raised max_tokens to 1500. Crucially, the scripted-fallback path now records a non-clinical fallbackReason attribute on the care-router trace span (the leading 'Claude API call failed (…)' / 'ANTHROPIC_API_KEY not set…' sentence only — no patient text), present only on fallback and absent on a live claude-api success, so a fallback's cause is visible in the Agent Fabric trace viewer instead of invisible. Verified live on production: the care-router span now reads provider=anthropic / via=claude-api with no fallbackReason. 786 frontend tests green; lint + build clean.",
        commits: [
          { sha: "a217be1", label: "care router: harden Claude response parsing + surface fallback reason" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of July 5, 2026",
    headline: "The acquisition funnel gets wired into the intake agent",
    intro:
      "The patient-acquisition agents — Inbound Lead Generation, Qualification, and Prospecting & Nurture — were registry seeds with illustrative traces. This week they became runnable A2A endpoints that actually hand off down the funnel and into the existing Intake → Care Router flow, as one governed, traced pipeline you can fire from the intake demo.",
    entries: [
      {
        title: "Intake: added osteoporosis and high cholesterol as menopause symptoms",
        summary:
          "Added 'Osteoporosis / bone density loss' and 'High cholesterol' to the scripted intake symptom picker (after weight gain), and added osteoporosis + high_cholesterol to the acquisition funnel's recognized-symptom set so leads flagging either still screen as in-ICP. Both route through the Care Router on the normal severity-based pathway — no red-flag special case. Tests + lint clean.",
        commits: [
          { sha: "7a1fadc", label: "intake: add osteoporosis and high cholesterol as menopause symptoms" }
        ],
        status: "shipped"
      },
      {
        title: "Intake: added weight gain as a perimenopause symptom",
        summary:
          "Added 'Weight gain / metabolism changes' to the scripted intake symptom picker (between vaginal/urinary symptoms and unexpected bleeding), and added weight_gain to the acquisition funnel's recognized-symptom set so a weight-gain lead still screens as in-ICP. It routes through the Care Router on the normal severity-based pathway — no red-flag special case. Tests + lint clean.",
        commits: [
          { sha: "e2b28d8", label: "intake: add weight gain as a perimenopause symptom" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: wired the acquisition funnel into the intake agent",
        summary:
          "Turned the Inbound Lead Generation, Qualification, and Prospecting & Nurture agents from registry-only seeds into runnable Google A2A endpoints, each mirroring the Care Router contract (JSON-RPC tasks/send envelope, a pre-flight evaluateGovernance() gate, real parented Agent Fabric trace spans, and a /.well-known/agent.json card whose policies derive from the registry so it can't overclaim). POST /api/agents/inbound-lead/tasks captures a lead, runs the ICP screen, resolves identity against Data 360, and hands off — enforcing explicit-opt-in+source and identity-resolution-before-create. POST /api/agents/qualification/tasks returns a qualified/disqualified decision with a route (intake | nurture | none) and a mandatory rationale, never touching a protected-class attribute; disqualifications emit a human-review span. POST /api/agents/prospecting/tasks drafts a consent-aware nurture touch that is always human-approval-required and never sent. A new orchestrator, POST /api/intake/acquisition-funnel, chains the hops over real A2A calls under a single taskId, threading each hop's span id as the next hop's parentSpanId so the whole funnel renders as one parented tree at /demo/agent-fabric — branching qualified-&-ready to Intake → Care Router, qualified-but-warming to Prospecting/Nurture, and disqualified to a logged dead-end, with any governance block short-circuiting as outcome:\u201cblocked\u201d. The scoring/branching rubric lives in a pure, deterministic lib/agent-funnel.ts (tuned so a consented lead can land in intake OR nurture), the A2A envelope validation was extracted into a shared parseTasksSendEnvelope, and the three agents' registry endpoints now point at the runnable routes. A new <AcquisitionFunnelPanel/> on /demo/intake runs four one-click scenarios (web-chat→intake, content-download→nurture, no-consent→blocked, out-of-ICP→disqualified) and deep-links to the resulting multi-agent trace. 770 frontend tests green (+25: the funnel rubric, all three routes' happy/blocked paths, and an end-to-end orchestrator test that stubs fetch to dispatch each hop through the real in-process handler); lint + build clean.",
        commits: [
          { sha: "fd1df2f", label: "agent fabric: wire the acquisition funnel into the intake agent" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 28, 2026",
    headline: "Governance & grounding honesty: agents, cards, and cohorts stop advertising what they don't enforce",
    intro:
      "A run of high-integrity fixes across the two highest-stakes surfaces. On Data 360, the cohort comparison's patientPercentile stopped posing as a live segment. On the Agent Fabric, the Care Router's governance policy list — hand-copied into the registry AND its public A2A Agent Card — had drifted from the policies the /tasks handler actually enforces (and even named a policy that doesn't exist); it now derives from a single source of truth so the discovery document can't overclaim.",
    entries: [
      {
        title: "Agent Fabric: added the MCP Bridge — the A2A ↔ MCP egress surface — as a first-class agent",
        summary:
          "Pause’s outbound MCP host already existed in code (lib/mcp/host.ts + provider-lookup.ts: the Care Router calling find_menopause_providers on external MCP servers, loopback-first with graceful fallback) but it wasn’t represented on the fabric, and live tool calls were only observable as attributes folded into the Care Router’s A2A span. Registered it as its own agent — mcp-bridge (new kind ‘mcp-bridge’, protocol mcp, integration tier on the platform plane) — the outbound complement to the inbound Pause MCP Server. Gave it three enforced-block policies that each map to real host.ts behavior (so they’re genuinely enforced, not advertised-only): a remote allow-list (only the same-origin loopback and remotes declared in PAUSE_MCP_HOST_REMOTES), an egress-side tool allow-list, and a no-cross-origin-bearer rule (an inbound bearer is forwarded only to the same-origin loopback, never to an external MCP server). All three are wired into the shared governance-signals metadata so evaluateGovernance() actually blocks on each, and the bridge is on the HIPAA audit policy since it brokers patient-context tool calls. For observability, the live Care Router route now emits each MCP host attempt as a first-class protocol:‘mcp’ span attributed to the bridge (parented to the A2A span) rather than only as A2A-span attributes, and a seeded trace shows the failover story end-to-end: an external partner remote errors with no bearer forwarded → the same-origin loopback succeeds → the Pause MCP Server executes the tool. Console subtitle and the investor brief updated to twelve agents across three planes (the brief gains a bridge card and the egress guards in its policy paragraph). The drift guards did their job throughout — the new block policies had to be given evaluator checks or the coverage test would have failed. 745 frontend tests green (+6); lint + build clean.",
        commits: [
          { sha: "b512e43", label: "agent fabric: add the MCP Bridge (A2A ↔ MCP egress) as a first-class surface" }
        ],
        status: "shipped"
      },
      {
        title: "Investor brief: grouped the Agent Fabric page by plane to match the console (and fixed a stale count)",
        summary:
          "Made /proposal/agent-fabric tell the identical two-plane story the console now does. The brief had drifted: a flat agent grid tagged with raw tier slugs, a stale ‘Four agents, two open protocols’ title, and a Phase-0 line claiming ‘Ten agents registered’ while the registry actually holds eleven (the brief had silently omitted the Data 360 grounding agent that the console lists). Grouped the brief’s cards into the same three planes — Patient & clinical, Platform & data substrate, Commercial · PHI-separated — reading the shared lib/governance-tiers.ts single source of truth, so tiers render as friendly labels and each plane leads with the same PHI-boundary description as the console. Added the missing Data 360 grounding card (zero-copy federation, consent-before-grounding, allow-listed activation) so the brief enumerates the same eleven agents as the registry, and updated the title to ‘Eleven agents across three planes…’, plus the Phase-0 count and subtitle to match. The agents array is now typed to the GovernanceTier union, so a typo’d tier is a compile error rather than an unlabeled card. lint + build clean; 740 tests green.",
        commits: [
          { sha: "33bfeef", label: "proposal/agent-fabric: group the brief by plane to match the console" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric console: grouped the registry by plane so the PHI boundary is visible",
        summary:
          "The console listed all agents in one flat grid labeled with raw governanceTier slugs (‘commercial-operations’, ‘lead-qualification’, ‘data-grounding’) — which buried the two-plane story the rest of the product tells. Added a dependency-free lib/governance-tiers.ts as the single source of truth for the GovernanceTier union (now referenced directly by AgentRecord, so the union and its metadata can’t drift) plus each tier’s friendly label and the plane it belongs to. The registry now renders in three grouped sections — Patient & clinical plane, Platform & data substrate, and Commercial plane · PHI-separated — each with a heading, an agent count, and a one-line description that states the PHI boundary out loud (patient/clinical and commercial are the boundary; platform is the shared substrate serving the patient plane). Tiers show as labels, not slugs. Added an exhaustiveness guard: every registered agent’s tier must resolve to a known plane + non-empty label (and because the metadata is keyed on the GovernanceTier union, adding a tier without a label/plane is already a compile error). Pairs with the new Governance pre-flight panel directly below it. 740 frontend tests green (+1 guard); lint + build clean.",
        commits: [
          { sha: "c8890f4", label: "agent fabric console: group the registry by plane (PHI boundary visible)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric console: a Governance pre-flight panel for any agent + two more drift guards",
        summary:
          "Follow-on to making the block policies real: the /demo/agent-fabric console can now exercise that gate for EVERY agent, not just the Care Router. Extracted the task-signal metadata into a dependency-free lib/governance-signals.ts (GovernanceTask + BOOLEAN_BLOCK_SIGNALS) that both the server evaluator and the client console import, so the UI can't advertise a signal the gate doesn't actually check; evaluateGovernance() now generates its boolean block checks from that same list (the lone string+regex model allow-list check stays spelled out). The new 'Governance pre-flight' panel lets you pick any agent, see its enforced-block policies, toggle whether the inbound task would violate each one, and evaluate against the real /api/agent-fabric/governance/evaluate endpoint — rendering the allow/block decision, the applicable-policy count, and each blocking violation with its reason. Defaults to all-compliant (the gate only blocks on an explicitly-violating signal), with a one-click reset. Added two more drift guards: every seeded console trace span must name a registered agent (catches an orphaned or typo'd agentId in the illustrative traces), and the shared signal metadata must be well-formed and — together with the model policy — exactly equal the evaluable set, keeping the UI, the evaluator, and the policy catalog on a single source of truth. 739 frontend tests green (+2 guards +1 metadata check, and a metadata-driven refactor that left the existing evaluator tests untouched); lint + build clean.",
        commits: [
          { sha: "b9dcfe6", label: "agent fabric: governance pre-flight panel for any agent + drift guards" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: made every enforced-block policy actually evaluated (not advertised-only)",
        summary:
          "Closed a real advertised-vs-actual gap in the governance pre-flight. evaluateGovernance() only ever checked the Care Router's three signals (red-flag screen, model allow-list, rationale); every other policy marked enforcement:'block', status:'enforced' was displayed as an enforced block in the registry, the A2A Agent Card, and the /proposal narrative — but the evaluator never looked at it, so it could not fire. Refactored the evaluator into a per-policy check table: a shared GovernanceTask signal shape plus BLOCK_POLICY_CHECKS mapping each block policy id to a predicate, keeping the established 'fire only on an explicitly-violating signal, never on an absent one' convention so partial fixtures and the demo form don't trip a gate by omission. All 20 enforced-block policies are now wired across the intake, clinical, integration/MuleSoft, Data 360, patient-lifecycle, and commercial planes. Added a drift guard — evaluableBlockPolicyIds() plus two tests — asserting every enforced-block policy has an evaluator check and every check maps back to a real enforced-block policy, so the roster can't grow a new 'enforced' block that silently does nothing. The guard immediately paid for itself: it surfaced SEVEN pre-existing advertised-but-unevaluated blocks (no-free-text-pii, no-prescribing, mcp-tools-allowlisted, fhir-r5-only, and all three Data 360 policies — zero-copy-federation, consent-before-grounding, segment-activation-allowlist), all now genuinely enforced. The evaluate route reuses the shared GovernanceTask type so the HTTP contract can't drift from what the evaluator checks, with a route test pinning the new signals through the boundary. The live Care Router path is unchanged (it passes the same three fields; new signals default absent → allow). 737 frontend tests green (+13); lint + build clean.",
        commits: [
          { sha: "3d48812", label: "agent fabric: make every enforced-block policy actually evaluated" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added Pipeline Management + Account Management — a PHI-separated commercial plane",
        summary:
          "Extended the fabric past the patient-care lifecycle into Pause's own B2B go-to-market with the two commercial Agentforce agents — Pipeline Management (works provider-organization / health-system / employer opportunities in Sales Cloud: stage progression, deal health, next-best-action, and committed/best-case/pipeline forecast roll-ups) and Account Management (post-close customer success: health scoring, renewal & QBR drafts, churn-risk and expansion signals). Both registered in lib/agent-fabric.ts as prototype Agentforce agents on a new commercial-operations governance tier. The honest heart of the change is plane separation: three commercial policies (derived from POLICIES[].appliesTo) — policy.commercial.no-phi-in-commercial-plane (block, both agents: the Sales Cloud commercial plane and the clinical/PHI plane are strictly separated, cross-plane reads blocked), policy.commercial.forecast-integrity (block, pipeline: every forecast figure must trace to a CRM opportunity record, no fabricated/inflated pipeline), and policy.commercial.human-owner-before-contract-change (block, account: no renewal/pricing/contract change without a human owner). Deliberately kept BOTH commercial agents OFF the HIPAA audit policy — an intentional honesty signal, asserted by a test: the commercial plane is not PHI-scoped, so it isn't on the HIPAA-named audit, whereas every clinical/patient-plane agent still is. Seeded a fourth illustrative trace (task-seed-commercial-001) on the commercial plane — pipeline.opportunity.review (at-risk) → pipeline.forecast.rollup (sourcedFromCrm:true) → pipeline.opportunity.close-won → account.onboard → account.renewal.draft (committed:false, humanOwnerApprovalRequired:true) — with EVERY span carrying phiAccessed:false, so the console shows the deal-to-customer arc while making the PHI boundary visible. Narrative synced: /proposal/agent-fabric now lists ten agents with the commercial pair framed as a separate PHI-separated plane, the commercial guards added to the policy paragraph, and the console + metadata enumerations updated. No autonomous send/commit path. 723 frontend tests green (+5: registration on the new tier, the PHI-separation block, the HIPAA-off honesty signal, the forecast/contract policy split, and the phiAccessed:false seeded-trace invariant); lint + build clean.",
        commits: [
          { sha: "25a0117", label: "agent fabric: add pipeline + account management (commercial plane)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Agentforce Qualification agent — the authoritative gate between acquisition and intake",
        summary:
          "Closed the funnel gap between acquisition and conversion. Both acquisition agents (Inbound Lead Generation and Prospecting & Nurture) were feeding intake with their own local notion of 'ready', so there was no single, explainable qualification step. The new Qualification agent is that gate: one consistent rubric (menopause-care fit + eligibility + expressed intent/readiness) applied to inbound and outbound leads alike, producing a qualified/disqualified decision with human-readable rationale, then routing qualified-and-ready leads to intake and qualified-but-warming ones back into nurture. Registered in lib/agent-fabric.ts as a prototype Agentforce agent on a new lead-qualification governance tier. To keep boundaries honest, reworded the Inbound agent's second capability from 'Qualifies visitors' to 'Runs a first-pass ICP screen' and pointed its handoff at Qualification (not straight to intake); the Prospecting agent likewise now hands a warmed prospect 'onward for qualification and intake'. Three qualification-specific governance policies, all derived from POLICIES[].appliesTo: policy.qualification.rationale-required (block — every decision, qualified or disqualified, carries rationale or is rejected), policy.qualification.no-protected-class-criteria (block — race/ethnicity/disability/etc. may never be qualification inputs; only care-fit, eligibility, consent, and intent), and policy.qualification.human-review-on-disqualify (audit — no lead is permanently excluded on an automated decision alone); it also inherits the HIPAA audit policy. Threaded qualification.decide into BOTH seeded traces so the gate is visible on either path: the inbound trace now runs capture → first-pass screen → identity.resolve → handoff → qualification.decide (score 84, protectedClassUsed:false) → intake, and the outbound growth trace inserts qualification.decide (score 88) between the final nurture touch and intake. Narrative synced across the /proposal/agent-fabric brief (now eight agents, with the qualification rubric in the policy paragraph) and the console + metadata enumerations. No autonomous send path. 718 frontend tests green (+4: registration on the new tier, the rationale/no-protected-class blocks + reviewable-disqualify audit, and the gate-before-intake ordering on both traces); lint + build clean.",
        commits: [
          { sha: "a7bdcc5", label: "agent fabric: add agentforce qualification agent" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Agentforce Inbound Lead Generation agent — the inbound complement to outbound prospecting",
        summary:
          "Completed the top-of-funnel with the inbound acquisition path. Where the Prospecting & Nurture agent reaches OUT (Data 360 segments → outreach), the new Inbound Lead Generation agent handles interest coming IN: it captures a visitor from the marketing site, Agentforce web chat, or a symptom-check form; qualifies them against the menopause-care ICP (age band, symptom signals, geography/insurance fit) and scores readiness; creates an opt-in-consented Data 360 lead with acquisition-source attribution; and routes a ready lead straight to intake or a not-yet-ready lead into the nurture cadence — both over A2A. Registered in lib/agent-fabric.ts as a prototype Agentforce agent on the same patient-acquisition tier as prospecting (its outbound sibling). Two inbound-specific governance policies, both enforced blocks and both derived from POLICIES[].appliesTo: policy.lead.explicit-optin-and-source-required (a lead is only persisted with an explicit, timestamped opt-in and a recorded source — anonymous/un-consented captures are discarded at the boundary, never stored) and policy.lead.identity-resolution-before-create (every lead is resolved against Data 360 Identity Resolution before creation, so a returning patient or existing prospect is merged rather than duplicated); it also inherits the HIPAA audit-every-turn policy. Seeded a third illustrative trace (task-seed-inbound-lead-001) showing the inbound arc end-to-end — lead.capture (consentOptIn:true) → lead.qualify (icpMatch, leadScore 81, readiness ready) → lead.identity.resolve (matched:false → create) → lead.route.handoff (a2a, destination agentforce-intake) → intake.complete (convertedFromInboundLead:true) — so the /demo/agent-fabric console shows the capture-to-intake path on first load. Narrative kept in sync: the /proposal/agent-fabric brief lists all seven agents (the Phase-0 line now reads 'seven agents'), the two inbound guards join the policy paragraph, and the metadata/subtitle enumerations include inbound lead generation. No autonomous send path. 714 frontend tests green (+5: agent registration on the acquisition tier, the opt-in + identity-resolution blocks, exclusion of the outbound nurture/marketing policies, and the seeded-trace honesty invariants); lint + build clean.",
        commits: [
          { sha: "d5965fe", label: "agent fabric: add agentforce inbound lead generation agent" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: expanded the Prospecting Agent into Prospecting & Nurture (lead scoring + multi-touch cadence)",
        summary:
          "Follow-up to the lifecycle-agents change, resolving a taxonomy gap: the Engagement Agent is a POST-conversion care-continuity agent (enrolled patients — check-ins, adherence), so lead nurturing (warming prospects who aren't ready to convert) had no home. Rather than overload the retention agent or add a third agent, expanded the top-of-funnel agent into a 'Prospecting & Nurture Agent' (v1.0.0 → v1.1.0). It now scores and warms leads across a multi-touch nurture cadence, advancing only prospects who engage, and drops a prospect from every active sequence the instant they convert, unsubscribe, or revoke consent. Added one nurture-specific governance policy — policy.marketing.nurture-cadence-cap (rate-limit, enforced): sequences are capped in length and cadence per rolling window, with convert/opt-out suppression baked in so there's no post-conversion nurture noise. It's prospecting-only (the enrolled-patient frequency cap stays on the Engagement Agent), and sends stay human-approval-gated via the existing human-approval-before-send block policy — the prototype still never messages a prospect autonomously. The seeded growth-lifecycle trace gained a prospect.nurture.advance span (touch 2, leadScore 72, sent:false) between the first outreach draft and conversion, and intake.complete now records nurtureTouches, so the /demo/agent-fabric console shows the warm-then-convert arc. Narrative kept in sync: the /proposal/agent-fabric brief renames the agent, reframes its role to 'Acquisition + lead nurture', and adds the cadence cap to the policy paragraph. 709 frontend tests green (+1: the cadence-cap policy is rate-limited + prospecting-only, and the seeded nurture span is scored, unsent, and approval-gated); lint + build clean.",
        commits: [
          { sha: "3772205", label: "agent fabric: expand prospecting agent into prospecting & nurture" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: added the Prospecting + Engagement agents — the patient-lifecycle agents that bracket the clinical core",
        summary:
          "Extended the multi-agent architecture beyond the clinical spine (intake → Care Router → MCP/MuleSoft) with the two Agentforce lifecycle agents that bracket it: a Prospecting Agent (top of funnel) that turns Data 360 population segments into consented prospect audiences, drafts consent-aware Marketing Cloud outreach for human review, and hands a qualified prospect to intake over A2A; and an Engagement Agent (post-routing) that picks up the Care Router's pathway output and schedules the follow-up cadence — check-ins and adherence nudges — honoring quiet-hours, channel preference, and frequency caps from Data 360. Both register in lib/agent-fabric.ts as prototype Agentforce agents (salesforce:// endpoints, like the intake agent) under two new governance tiers, patient-acquisition and patient-engagement. Governance is the honest core of the change: four new policies join the catalog and are DERIVED onto each agent from POLICIES[].appliesTo (the same single-source-of-truth path the rest of the fabric uses, so the registry, console, and any Agent Card can never disagree) — contact-consent-required (block: nobody without an active Data 360 contact consent enters an audience), human-approval-before-send (block: the prototype NEVER sends autonomously — every message is drafted for a human-in-the-loop), quiet-hours-and-channel-preference (block, engagement only), and frequency-cap (rate-limit, engagement only); both agents also inherit the HIPAA audit-every-turn policy. To make them tangible rather than static registry rows, seeded a second illustrative trace (task-seed-growth-lifecycle-001) that runs the full lifecycle in one correlated span tree — prospect.audience.qualify → prospect.outreach.draft (sent:false, humanApprovalRequired:true) → intake.complete (convertedFromProspect:true) → Care Router a2a.tasks/send → engagement.followup.schedule — so the /demo/agent-fabric console shows both agents in an actual trace on first load. Kept the investor narrative honest: the /proposal/agent-fabric brief now lists all six agents in lifecycle order (the stale 'four agents' framing is gone), the Phase-0 line reads 'six agents', and the policy paragraph dropped its brittle hardcoded 'twelve' count in favor of describing the catalog (which now includes the lifecycle guards). No runtime send path was added — the agents are wired and governed, and the one thing they will not do without a human is message a patient. 708 frontend tests green (+5, covering agent registration, the consent/approval gates, the engagement-only policies, and the seeded-trace honesty invariant); lint + build clean.",
        commits: [
          { sha: "ff6562d", label: "agent fabric: add prospecting + engagement lifecycle agents + governance" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce Voice: surfaced the voice entry point on the intake demo (fulfilling a written promise) + made the launch toast dismissible",
        summary:
          "Turned to the Agentforce Voice surface. The seam was already honest and well-built — lib/agentforce-voice.ts's env-driven {designed, prototype, shipped} state machine, the secret-omitting /api/agentforce/voice/config route, and the <AgentforceVoiceButton/> that degrades to a disabled 'designed' affordance on the public site. But two gaps stood out. First: both the /proposal/agentforce-voice page ('This is the same <AgentforceVoiceButton/> the intake demo WILL mount') and the component's own docstring ('The /about and /demo/intake pages can mount this in the marketing slot without any side effects') described the button living on the intake demo — yet it was only ever mounted on the proposal page. Delivered on that promise: mounted the button on /demo/intake in an 'Another way in' channel strip beneath the chat intake, with copy that keeps the honest framing (same agent, same subagents, same Data 360 grounding, same Care Router handoff — voice is the channel, not a different agent). On the public deployment (no env vars) it renders the disabled 'designed' pill + link to the activation plan, so it advertises the roadmap channel without claiming a capability the runtime can't prove. Second: a small but real UX bug — the post-click launch toast ('verification pending' in prototype, 'launching…' in shipped) was set once and never cleared, so it lingered on the page indefinitely with no way to dismiss it. Gave it a dismiss button (aria-labelled) and a 12s auto-clear, with the timeout tracked in a ref and torn down on unmount so no stray timer fires after navigation. Component testing tooling isn't wired in this package (vitest runs the node environment; no jsdom/testing-library), so this shipped as a scoped feature + UX fix rather than dragging in a new test toolchain. Build clean; no contract or API changes.",
        commits: [
          { sha: "5bfe2b0", label: "agentforce voice: mount button on intake demo + dismissible launch toast" }
        ],
        status: "shipped"
      },
      {
        title: "Provider directory: a booking-relevant 'accepting new patients only' filter — the one patient-facing filter the search was missing",
        summary:
          "First feature work after a full live end-to-end verification pass (booted the app and drove the real intake→Data360→A2A→Agent-Fabric-trace flow, the provider search, and the MCP initialize handshake against the running server — everything green, including the secret-omission guarantees, so no fixes were needed). The /provider browse directory already exposed ZIP, insurance, MSCP-certified-only, relevant/telehealth fallback, and telehealth filters — but not panel status, which meant a patient (or an agent surfacing a recommendation) could be pointed at a provider whose panel is closed. Added an acceptingNewPatients filter to queryProviderDirectory, applied BEFORE the tier ladder alongside the insurance and telehealth filters so every tier (certified-local, relevant-local, certified-remote, certified-national) honors it rather than silently broadening past the patient's intent, and wired an 'Accepting new patients only' checkbox into the directory's filter form (with the Reset affordance updated to notice it). Deliberately scoped to the browse surface: the filter is NOT added to the agent-facing Experience API or the MCP tool, and it does NOT touch the echoed `query` object — so the API/MCP response shape and the Agentforce OAS contract stay byte-identical (verified: the OAS contract test still passes untouched). Five new tests pin the strict narrowing (open-panel total < unfiltered total; every returned row acceptingNewPatients=true), the before-the-ladder application, composition with the telehealth filter, and the response-shape invariant (no acceptingNewPatients key leaks into query). 703 frontend tests green (+5); build clean.",
        commits: [
          { sha: "cffef36", label: "provider directory: add 'accepting new patients only' filter" }
        ],
        status: "shipped"
      },
      {
        title: "cli/ + mcp/ audit → covered the four pause CLI commands and guarded the standalone MCP package version (the last two untouched packages)",
        summary:
          "Turned the coverage/drift audit onto the two packages the session hadn't looked at: the standalone `pause` CLI and the published `@pause-health/mcp` stdio server. The mcp/ package turned out already well-defended — tools.parity.test.ts enforces byte-identity between mcp/src/tools.ts and the frontend's lib/mcp/tools.ts copy, so the provider-count and tool-surface guards added earlier this session cover the stdio transport transitively; and its tool LOGIC is exercised through the frontend's InMemoryTransport behavior tests against the byte-identical copy. server.ts is a thin stdio bootstrap (env → createPauseMcpServer → StdioServerTransport) with no meaningful unit seam. That left two real gaps. First: the CLI's lib/ (client, options) was tested but the four COMMANDS were not. Added commands.test.ts (+11) driving providers/timeline/intake/health with a stubbed global fetch and captured stdout — asserting query-string construction from flags (zip/menopause/limit/insurance/telehealth, and that absent flags are omitted), the --json branch emitting the raw payload vs the human summary (matchType, returned/total, distance formatting like '4.2mi'), the exactly-one-positional guards on timeline/intake, and patient-id URL-encoding into the path. Second: the standalone @pause-health/mcp package version in mcp/package.json had NO guard tying it to SERVER_VERSION (the value the server reports on the MCP initialize handshake). That string has drifted before — the build journal once advertised v0.2.0 while the code reported 0.3.0 — so a frontend-hosted parity guard (standalone-package-parity.test.ts) now binds mcp/package.json.version === SERVER_VERSION, failing loudly if a future bump touches one and not the other. Test-only; no runtime change. cli 28 pass (+11); frontend 698 pass (+1). Both untouched packages are now audited and the version-drift hole is closed.",
        commits: [
          { sha: "aa3ec53", label: "cli + mcp: cover the four pause commands + guard the standalone package version" }
        ],
        status: "shipped"
      },
      {
        title: "Python ingest audit → a stale contract test had left provider_ingest RED; fixed it and covered centroids / mscp / FHIR (the untested pipeline modules)",
        summary:
          "Carried the coverage/drift hunt onto the Python side (the provider_ingest + pause_ingest pipelines that generate the committed directory + wearable artifacts). The audit's first finding was severe: the provider_ingest suite was RED. ProviderRecord had gained a credentialSource field — the provenance of the menopauseCertified flag, mirroring the TS ProviderRecord and BOTH OAS schemas (curated-overlay = authoritative MSCP roster; self-reported = a self-reported token in NPPES credential text) — but test_record_shape_matches_contract, the guard whose entire job is to fail when the record shape drifts from the frozen cross-language contract, was never updated to include it. So the guard had silently rotted into a failing test that nobody had reconciled. Fixed the expected key set AND strengthened it with a semantics invariant (credentialSource is None exactly when a provider is not certified, else one of the two allowed provenances) so it now pins meaning, not just presence. Then closed the untested pipeline modules (+27 tests). centroids.py — the ZIP→(lat,lng) lookup that powers the directory's distance-first ranking — was entirely untested: added coverage for the Census-Gazetteer parsing edge cases (malformed GEOID rows, unparseable coordinates, and the stray-trailing-whitespace INTPTLONG column header the real file actually ships with), the write/load round-trip and its 6-decimal rounding + key-sort contract, the missing-file → empty-map fallback that keeps a sparse checkout from erroring, a bundled-map sanity check, and the regen CLI. mscp.py — the MSCP overlay loader that is the sole source of the certified flag — now pins that it accepts either a bare NPI list or {\"npis\":[...]}, coerces JSON-numeric NPIs to strings (so they still match the string NPI on a record), and trims/drops blanks on both the load and query sides. fhir.py — the OMH→FHIR R5 Observation wrappers the uploader POSTs to JupyterHealth Exchange, ~220 lines untested — now covers the raw path (OMH payload preserved verbatim through the base64 valueAttachment round-trip, schema code derived from the OMH header with safe omh:unknown:0 defaults, effective-time precedence body→header→now) and the derived-HRV path (dataclass/dict duck-typing with a TypeError guard, the private pause-derived schema, derivedFrom back-pointers, and the FHIR R5 rule that an Observation carries effectiveDateTime XOR effectivePeriod, never both). Test-only apart from the one stale-assertion fix. provider_ingest 98 pass (was 84 + red); pause_ingest 108 pass / 7 skipped.",
        commits: [
          { sha: "34f4d1d", label: "python: fix stale provider contract test + cover centroids/mscp/fhir" }
        ],
        status: "shipped"
      },
      {
        title: "Coverage audit → the last four untested API routes get tests (intake orchestration, prechat-context, voice-config secret-omission, fabric registry)",
        summary:
          "Ran an objective coverage/drift audit across the frontend instead of guessing the next gap: enumerated all 28 app/api route handlers and every lib module. Result — 24/28 routes had co-located tests, every logic-bearing lib had a test (only static data/config like zip-centroids / site / page-metadata / menopause-society don't, and aren't worth pinning), and no NEW advertised-vs-actual drift surfaced beyond what the existing parity guards already cover. The audit's finding was four untested routes; this closes all four (+18). intake/route-to-care-router (5) — the most logic-dense route in the app and the main A2A handoff (Agentforce intake → Data 360 identity → federated grounding → Care Router): 400 JSON guard; the happy path with SF unset (mock identity+grounding) posting an A2A tasks/send to the origin-derived care-router URL and lifting the decision out of the returned artifact's data part (fetch stubbed at the boundary, no live server); the multi-agent trace — intake.complete + data360.identity.resolve + data360.grounding.federated-query spans all recorded under one taskId with the grounding span honestly reporting _source:\"mock\"; optional personaId threaded onto every span; and the 502 path where an A2A transport failure records an a2a.tasks/send.transport-error span (status:error) instead of throwing. intake/prechat-context (6) — the closed-list persona guard (400 missing / 404 unknown), the string-ONLY hidden-prechat field bag every value clamped ≤255 chars (Salesforce's channel hard cap), the Patient_Percentile_Basis honesty marker reading \"intake-estimate\", the deliberate omission of the ~1.4KB Patient_Context_JSON from the in-band payload, and no-store. agentforce/voice/config (3) — the SECURITY invariant on a public route: it reports designed/prototype/shipped for the client button but the serialized response NEVER contains baseUrl or deploymentRef (partner-side identifiers a third party could use to open a CCaaS session) — asserted by string-scanning the whole body for both keys and their secret values. agent-fabric/agents (4) — the registry listing IS listAgents() with a derived _agentCount and the discovery fields (protocol/version/policies) the console renders. Test-only; no runtime change. 697 frontend tests green (+18); build clean. This closes the frontend route-coverage gap end to end.",
        commits: [
          { sha: "cd54426", label: "routes: test the last four untested API handlers (intake/voice/fabric)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360 routes & mock: first co-located route tests for the whole federated-read surface (four routes, zero before this) + the real→mock fallback",
        summary:
          "Closing the last flagged coverage gap on Data 360. The four routes under /api/data-360/* — segments, patient/[id]/record, patient/[id]/grounding, identity/resolve — had NO route tests, and lib/data-360.ts's mock helpers (getFederatedRecord, resolveIdentity, listSegments) were only ever touched indirectly through the Care Router. Two of the four routes are dual-mode (real Salesforce org preferred, deterministic mock fallback) and NEITHER had a test proving the fallback actually degrades instead of 500ing. Added co-located route tests + a mock unit test (+20). lib/data-360.test.ts (7): listSegments returns a defensive copy (mutating the result can't corrupt the catalog); resolveIdentity echoes the demo id with confidence 0.97 + the v3 IR ruleset; getFederatedRecord keys the record to the requested id, carries only granted consents, and attaches a bounded two-segment subset whose ids are real catalog entries. segments route (3): meta._segmentCount and _totalPatients are DERIVED from listSegments rather than hardcoded, so they can't drift; cacheable header. record route (4): record echoes the requested id, meta reports requested-vs-demo id, empty path segment falls back to the demo id, cacheable header. grounding route (6): mock path reports _source:\"mock\" + _salesforceConfigured:false with the cacheable header AND — the load-bearing one — the real→mock fallback (SF_* set, fetch stubbed to throw) degrades to _source:\"mock\" without 500ing, while _salesforceConfigured reports true (it reflects env, not the served source) and the cache header follows the SOURCE not the config. identity route (3): 400 on invalid JSON, mock resolution to the demo id with no-store, and the same real→mock degrade proven not to 500. Test-only; no runtime change. 679 frontend tests green (+20); build clean.",
        commits: [
          { sha: "6ab700d", label: "data-360: route tests for all four routes + mock unit test (incl. real→mock fallback)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360 grounding: the Phase-2 provenance label overclaimed live Data Cloud CIs when the org returned no wearable rows",
        summary:
          "Carrying the advertised-vs-actual drift hunt onto the Salesforce grounding layer that feeds the Care Router. lib/salesforce/grounding.ts stamps every GroundingContext with a groundingProvenance block — federatedQuery (\"Phase 1: SOQL ...\" vs \"Phase 2: ... Data Cloud Calculated Insights (HRV/vasomotor/sleep)\") and sourcesQueried — that the Agent Fabric trace surfaces so a reviewer can see which parts of the grounding came from the real org vs the intake baseline. The bug: that label branched on whether the `wearable` object was truthy. But getWearableInsights (data-cloud.ts) returns a NON-null { hrv, vasomotor, sleep } object whenever Data Cloud is merely configured — each field is independently null when its Calculated Insight returns no rows (only unconfigured/error returns null). So an org with Data Cloud wired up but no CI rows for a given patient produced provenance that advertised \"Data Cloud Calculated Insights (HRV/vasomotor/sleep)\" and listed dbdp-wearable-features + jupyterhealth-fhir as queried — while every one of those insights had actually fallen back to the intake baseline (vasomotor/sleep via `?? {intake}`, HRV omitted). The trace claimed Phase-2 federation that never fired. Fix: provenance now keys on whether any CI actually returned data and names ONLY the live ones — all-null wearable reports Phase 1 with base sources; a single live CI reads \"Data Cloud Calculated Insights (vasomotor)\" and adds only the sources that CI genuinely carries (union of the live insights' federatedFrom, so jupyterhealth-fhir doesn't appear unless an HRV/sleep CI actually returned). buildGroundingContext is now exported and pinned by grounding.provenance.test.ts (+5): wearable=null → Phase 1; all-null object → Phase 1 (the regression, NOT Phase 2, no DC sources); single-live → named + scoped sources; all-live → full label + unioned sources with base sources un-duplicated; computedInsightsCount stays in step. The mock path (data-360.ts) was already honest via `basis: \"intake-estimate\"`; this aligns the real path. 659 frontend tests green (+5); build clean.",
        commits: [
          { sha: "d3a5d87", label: "data-360: stop grounding provenance claiming Phase-2 CIs that returned no rows + pin it" }
        ],
        status: "shipped"
      },
      {
        title: "Salesforce Headless 360: first route-level coverage of the entire OAuth PKCE seam — six endpoints, zero tests before this",
        summary:
          "The Headless 360 LIBRARY (salesforce-headless360.ts — config, PKCE, cookie signing, validateMcpApiBearer + its introspect/userinfo/cache paths) was already deeply unit-tested, but the six ROUTES that wire it into the actual OAuth flow under /api/salesforce/headless-360/* had NO tests at all — including the two most security-load-bearing steps in the whole surface: the PKCE authorize kickoff and the CSRF-guarded callback. Added co-located route tests for all six (+33). authorize (7): 503 when unprovisioned; a 302 to Salesforce /services/oauth2/authorize carrying response_type=code + client_id + redirect_uri + scope + state + code_challenge_method=S256; the pending cookie set with the hardened flags (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=90); a binding check that the state in the signed cookie equals the state sent upstream AND that the redirect's code_challenge is exactly S256(the cookie's verifier); and open-redirect defense (?next=https://evil and ?next=//evil both collapse to '/'). callback (10): the CSRF core — a returned state that doesn't match the signed cookie's state is refused 400 state-mismatch and the token endpoint is NEVER contacted; a missing or tampered pending cookie is refused; a Salesforce ?error is propagated 400 and clears pending; the happy path exchanges the code (presenting the cookie's code_verifier), sets a session cookie that decodes back to the exchanged tokens, clears pending, and 302s to the post-login path; a signed-but-protocol-relative post-login path is still refused off-site (defense in depth → '/'); and upstream failure / missing access_token both surface 502. me (5): the session-state ladder — 503 unprovisioned, 401 not-signed-in, 401 session-expired past expiry, 200 with identity on a live session, and a userinfo failure degrading into user._userinfo_error without breaking the shape. token/refresh (7): 401 with no session / no refresh token; success mints a new access token INTO the cookie and never into the body; a non-rotated refresh token is preserved; a rejected refresh clears the session cookie and returns 502. config (3): the only route that answers unprovisioned, reporting designed/prototype without ever leaking the client id, secret, or Salesforce base URL. logout (1): clears both cookies with Max-Age=0 and the hardened flags. Test-only; no runtime change. 654 frontend tests green (+33); build clean.",
        commits: [
          { sha: "84d0d75", label: "headless-360: route tests for all six OAuth endpoints (authorize/callback/me/refresh/config/logout)" }
        ],
        status: "shipped"
      },
      {
        title: "MCP Streamable-HTTP route: first direct coverage of the /api/mcp endpoint Agentforce 3.0 connects to (round-trip, base-URL derivation, auth wiring)",
        summary:
          "Last unguarded seam on the MCP surface. The tool handlers are now behavior-tested (in-memory transport) and the auth gate is unit-tested, but the /api/mcp route itself — the HTTP-fronted MCP server the Agentforce 3.0 Registry actually connects to — had only INDIRECT coverage. Its own logic was untested: a genuine Streamable-HTTP round-trip through the SDK's WebStandardStreamableHTTPServerTransport, and the request-origin base-URL derivation (pauseBaseUrl) that decides which Experience-API plane the tools front — the guard that keeps a preview deploy fronting its OWN mocks instead of prod, and lets PAUSE_MCP_BASE_URL repoint at a customer's Anypoint tier. Added app/api/mcp/route.test.ts (+9), driving the exported GET/POST/DELETE with hand-built JSON-RPC frames and parsing the SSE the transport emits: initialize returns serverInfo {name: pause-health-mcp, version: 0.3.0} + a tools capability; tools/list surfaces exactly the four tools; a tools/call for experience_api_health (global fetch stubbed) proves base-URL derivation end to end — by default it fronts the request's own origin (http://localhost:3000/api/mulesoft/health) and the summary echoes that origin, while PAUSE_MCP_BASE_URL overrides it (trailing slash trimmed) to https://anypoint.example.com/... ; the transport still enforces its spec contract through our handler (406 without a text/event-stream Accept, 415 on a non-JSON content type); and — importantly — all three verbs run through the same guardMcpAuth: with SF_HEADLESS360_REQUIRE_MCP_AUTH=on but unprovisioned, POST, GET, and DELETE each return 503 mcp-auth-misconfigured, confirming GET is gated BEFORE it can open a standing SSE stream rather than leaking an unauthenticated channel. (Discovered while writing it: the tool's async fetch only fires as the SSE body is consumed, so the test drains res.text() before asserting the captured URL — the same reason the route must NOT eagerly close the transport.) Test-only; no runtime change. 621 frontend tests green (+9); build clean.",
        commits: [
          { sha: "105b048", label: "mcp: cover the /api/mcp Streamable-HTTP route (round-trip, base-url, auth wiring)" }
        ],
        status: "shipped"
      },
      {
        title: "MCP tool handlers: first behavioral coverage of what the four tools actually DO (URL construction, headers, summary narration, error path)",
        summary:
          "The MCP tool layer was pinned three ways for NAMES and versions — tools.parity (byte-identity vs the standalone mcp/ package), registry-parity (Agent Fabric ⇄ SERVER_VERSION + tool names), public-descriptor-parity (mcp.json ⇄ same) — but nothing exercised the handler bodies. So the Experience-API URL each tool builds, the request headers it sends, and the human-readable summary string it returns (the text an LLM reads FIRST when deciding how to phrase a result to a patient) could all have regressed silently. Added lib/mcp/tools.behavior.test.ts (+12): it stands up a real McpServer over an InMemoryTransport with an injected recording fetch — the same in-process rig host.integration.test uses — so every assertion rides a genuine tools/call round-trip, not a re-implementation. Coverage: tools/list surfaces exactly the four tools; get_patient_timeline builds /api/mulesoft/patient/{id}/timeline, URL-encodes an id with a slash, and narrates the FHIR entry count; get_patient_intake narrates 'acuity: chief complaint' and falls back to a bare summary when the record has none; find_menopause_providers assembles the query string in order (zip, menopause, limit, insurance), narrates distance-sort with distanceMiles-ascending phrasing and a per-NPI profile URL carrying the zip, and — with no zip — drops zip from the query, narrates graphScore-descending, and emits the browse-directory hint instead; experience_api_health hits /health and reports reachability + entry count; request shaping sends the default User-Agent (pause-health-mcp/0.3.0) + Accept and NO Authorization without an apiKey, attaches Bearer when an apiKey is set, honors a custom userAgent, and trims trailing slashes on baseUrl; and the error path returns an isError result carrying the upstream 502 when the Experience API is not ok. Test-only; no runtime change. 612 frontend tests green (+12); build clean.",
        commits: [
          { sha: "28a92ce", label: "mcp: behavioral coverage for the four tool handlers (url/headers/summary/error)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Experience APIs: route tests for the two untested patient endpoints + a drift guard on the provider counts baked into the MCP tool description",
        summary:
          "Closing the remaining coverage + honesty gaps on the MuleSoft surface. Two things were unguarded. (1) The GET /api/mulesoft/patient/{id}/timeline and /intake routes — the mocked Experience APIs standing in for pause-patient-bundle-process-api and pause-intake-process-api, and the exact HTTP surface the MCP get_patient_timeline / get_patient_intake tools call — had ZERO route tests, while their siblings /health and /providers were thoroughly covered. Added 13 route cases pinning what actually matters on these mock-only endpoints: a well-formed FHIR searchset Bundle / intake record echoing the requested id; meta._bundleEntries staying in lockstep with the real entry count (it's derived — a mismatch would mean the summary lies); the meta._idAliased bookkeeping that lets an operator or agent tell when they asked for a non-demo id and transparently got the single-synthetic-patient demo shape; the empty-segment fallback to DEMO_PATIENT_ID; provenance/source stamps carrying the MuleSoft process-API identifiers; the _mcpToolEquivalent stamp; and the CDN Cache-Control header. (2) The find_menopause_providers MCP tool description hands the agent hardcoded dataset numbers — \"2,015 NPPES-derived providers\" and \"1,720 dropped this build\" (sanctioned, from CA Medi-Cal + NY OPMC + TX TMB) — as static strings with nothing tying them to provider-directory.generated.meta.json, which is regenerated whenever the directory is rebuilt. So the next `total` / `sanctionedFiltered` change would silently make the tool lie to every agent that reads it. Because tools.ts must stay byte-identical to the standalone mcp/ package copy (can't import the meta file at runtime), added tools-provider-counts.parity.test.ts to pin-not-couple: it asserts the description's numbers equal meta.providers.total / sanctionedFiltered and that the named sanction sources match the meta's per-source keys exactly (ca/ny/tx) — the same \"guard, don't couple\" approach registry-parity uses. Verified the guard bites by bumping the meta total and watching it fail. Test-only; no runtime change. 600 frontend tests green (+16); build clean.",
        commits: [
          { sha: "e3c1f52", label: "mulesoft: cover patient timeline/intake routes + pin provider counts to generated meta" }
        ],
        status: "shipped"
      },
      {
        title: "Public MCP descriptor: the .well-known/mcp.json external clients read had re-drifted (stale version + inverted provider-ranking claim)",
        summary:
          "Carrying the registry-vs-reality drift hunt to the one MCP surface that faces OUTWARD. public/.well-known/mcp.json is the discovery descriptor an external MCP client — Claude Desktop, Cursor, the Agentforce 3.0 Registry — reads to learn the Pause server's name, version, and tool list. It's hand-authored, so it drifts exactly the way the internal Agent Fabric registry did — and it had, in two ways. (1) It advertised version \"0.1.0\" while the server reports SERVER_VERSION \"0.3.0\" on initialize (both transports). This is the SAME \"0.1.0 vs 0.3.0\" bug registry-parity.test.ts was written to kill for the Agent Fabric entry — but that guard only pinned agent-fabric.ts, so the public descriptor was left out and re-drifted to the identical stale number. (2) Worse, the find_menopause_providers blurb claimed results are \"ranked by Pause's internal graph score\" — the INVERSE of the real behavior: mulesoft-mocks ranks distance-first when a ZIP's Census ZCTA centroid is known (sort:\"distance\"), and graph score is only the fallback when distance can't be computed. The canonical tools.ts description has said distance-first all along; only the public descriptor lied, so an agent reading the descriptor to decide how to phrase results (\"ranked by an opaque internal score\" vs \"about 4 miles away\") was mis-primed. Fix: bumped the descriptor to 0.3.0 and rewrote the provider blurb to lead with distance ranking (graph-score fallback named honestly), plus the insurance filter and build-time license filtering it already supports. Then closed the guard gap that let it re-drift: new lib/mcp/public-descriptor-parity.test.ts binds the descriptor to the same source of truth as the internal registry — name === SERVER_NAME, version === SERVER_VERSION, tools a name-for-name bijection with the four registerTool() calls in tools.ts (extracted from source), and a honesty assertion that the provider tool's description mentions distance and does NOT carry the old graph-score-primary claim. Now a version bump or a tool add/rename/remove that skips the public descriptor fails CI, exactly like the internal registry. 584 frontend tests green (+4); build clean.",
        commits: [
          { sha: "76c9b59", label: "mcp: fix stale version + inverted ranking claim in public mcp.json + pin it" }
        ],
        status: "shipped"
      },
      {
        title: "MCP auth gate: direct contract tests for guardMcpAuth + first-ever coverage of attachIdentityHeaders",
        summary:
          "Continuing the MCP hardening pass, from the host wiring down to the bearer gate itself. lib/mcp/http-auth.ts holds the Streamable HTTP auth seam: guardMcpAuth(request) is called by BOTH /api/mcp and /api/mcp/whoami and returns a discriminated result — {kind:\"off\"} when the gate env is unset, {kind:\"blocked\", response} carrying the exact HTTP rejection, or {kind:\"allowed\", identity} — and attachIdentityHeaders(response, identity) stamps the resolved Salesforce user onto the outgoing response. The whoami route test exercised guardMcpAuth INDIRECTLY through one endpoint's HTTP shape, but the discriminated union that the /api/mcp route branches on was never asserted directly, and attachIdentityHeaders had zero coverage — a regression in either could have changed how every MCP response is gated or identity-stamped without a red test. Added lib/mcp/http-auth.test.ts: 5 guardMcpAuth cases pin the full contract (off when unset; blocked/503 mcp-auth-misconfigured when the gate is on but Headless 360 is unprovisioned; blocked/401 with an RFC 6750 realm=\"mcp_api\" error=\"missing-bearer\" challenge when no bearer is sent; blocked/403 error=\"scope-mismatch\" when the bearer lacks the mcp_api scope; and allowed with {username, via:\"introspect\"} on a valid bearer — introspect stubbed so no network), and 3 attachIdentityHeaders cases prove it returns the SAME response object untouched when identity is null (gate off), stamps X-Pause-MCP-User + X-Pause-MCP-Via while preserving status and streaming the body through unchanged, and omits X-Pause-MCP-User but still sets Via when the identity has no username. Test-only; no runtime change. 580 frontend tests green (+8); build clean.",
        commits: [
          { sha: "7fcbb72", label: "mcp: cover guardMcpAuth contract + attachIdentityHeaders" }
        ],
        status: "shipped"
      },
      {
        title: "MCP host: test coverage for the request entry point's bearer parsing + cross-origin guard",
        summary:
          "Closed a coverage gap on a security-relevant seam. createMCPHostFromRequest is what the Care Router route actually calls to build a per-request MCP host: it derives the loopback origin from the inbound Request url and lifts an Authorization: Bearer token onto the loopback remote (so a tool call made under a Salesforce user identity carries that identity to our own /api/mcp). resolveRemotesFromEnv underneath it was thoroughly tested, but the header-parsing + origin-derivation wrapper in front — including the same-origin token-leak guard — had no direct test, so a regex or origin regression could have slipped through silently. Added 8 cases that assert via host.listRemotes(): the loopback origin is protocol+host+port with path/query dropped; a Bearer token lands on the loopback remote; the scheme match is case-insensitive and the token is whitespace-trimmed; a missing header, a non-Bearer scheme (Basic), and an empty-token Bearer all leave loopback unheadered; the inbound Salesforce bearer is NOT forwarded to an external PAUSE_MCP_HOST_REMOTES remote (the cross-origin trust boundary, now pinned at the entry point and not just in the helper); and PAUSE_MCP_HOST_LOOPBACK=off yields no remotes so the token goes nowhere. Test-only; no runtime change. 572 frontend tests green (+8); build clean.",
        commits: [
          { sha: "2af004f", label: "mcp: cover createMCPHostFromRequest header parsing + origin derivation" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: the registry advertised a stale Pause MCP version (0.1.0 vs the server's 0.3.0)",
        summary:
          "Carrying the registry-vs-reality drift hunt from A2A onto the sibling protocol, MCP. The Agent Fabric registry entry for the Pause MCP server — what the fabric console renders and what GET /api/agent-fabric/agents returns — hard-coded version \"0.1.0\". But the server actually reports SERVER_VERSION \"0.3.0\" on the MCP `initialize` handshake, and it does so on BOTH transports (the published stdio binary and the Streamable HTTP /api/mcp route, which both build the server through createPauseMcpServer). So an operator reading the console — or an Agentforce 3.0 Registry ingesting the fabric — saw a two-minor-versions-stale build number for a server that's very much on 0.3.0. Same class as the A2A Agent Card fix: a discovery/registry surface asserting something the runtime contradicts. Corrected the registry to 0.3.0 and added lib/mcp/registry-parity.test.ts to make it self-guarding: it pins that the registry version === the MCP SERVER_VERSION, and that the registry's advertised capabilities are a name-for-name bijection with the four tools tools.ts actually registers (get_patient_timeline, get_patient_intake, find_menopause_providers, experience_api_health) — extracted from source, the same technique the existing tools.parity test uses. Now a version bump, or a tool added/renamed/removed, without updating the registry fails CI instead of silently misrepresenting the server in the console. (Deriving the version by importing SERVER_VERSION into agent-fabric.ts was rejected on purpose: it would drag the full MCP SDK into the import graph of a module loaded by nearly every route. The test-based pin matches how the repo already handles the tools.ts duplication — guard, don't couple.) 564 frontend tests green (+2); build clean.",
        commits: [
          { sha: "8e5e441", label: "agent-fabric: fix stale pause-mcp version in the registry (0.1.0 -> 0.3.0) + pin it" }
        ],
        status: "shipped"
      },
      {
        title: "A2A: the Care Router now accepts the current-spec kind:\"data\" part tag (spec-current clients were silently blocked)",
        summary:
          "Direct follow-up to the smoke-test fix, which surfaced the underlying interop gap. The Google A2A spec renamed the message Part discriminator from `type` (\"text\"|\"data\", the early-draft form) to `kind`. Pause's A2APart type and every one of its own agents still EMIT `type`, and the Care Router's inbound POST /api/agents/care-router/tasks handler matched only p.type === \"data\". So any spec-current external client — Vertex AI Agent Builder, an OpenAI Responses harness, a partner orchestrator — that tags its intake part kind:\"data\" had that part silently ignored: intake collapsed to {}, and the task was rejected by the red-flag-mandatory policy. Clinically the block is correct (never route on an empty intake), but it fired for the wrong reason and was invisible to the caller, who sent a perfectly valid task. Fix: two defensive readers in lib/a2a.ts — partKind() (reads `type`, falls back to `kind`) and findDataPart() (returns the first data part under either discriminator, but only when it actually carries an object `data`, skipping text parts) — and the /tasks route now extracts intake via findDataPart(). Pause deliberately keeps EMITTING the `type` form for its own agents; the readers take `unknown` because inbound bytes come off the wire, not from our typed builders. The empty-intake safety property is explicitly preserved: a message with no data part in EITHER form still routes intake={} into the gate and fails closed. Verified live against a fresh production build — kind:\"data\" now returns state:\"completed\"/decision:\"allow\" with a RoutingDecision (mscp-virtual-visit), type:\"data\" is unchanged, and a text-only message still blocks. Tests: +6 a2a helper cases (both discriminators, precedence, junk, non-object data, first-match) and +1 route case proving a kind:\"data\" task completes. 562 frontend tests green (+8); build clean.",
        commits: [
          { sha: "626e6da", label: "a2a: accept the current-spec kind:\"data\" part tag on inbound tasks/send" }
        ],
        status: "shipped"
      },
      {
        title: "Smoke test: the A2A multi-agent checks were passing on governance-blocked tasks (false green)",
        summary:
          "While hardening the Agent Fabric I found the flagship end-to-end smoke checks were green for the wrong reason. scripts/smoke-test.mjs judged API calls on HTTP status + JSON-parse only — but the A2A layer returns HTTP 200 for JSON-RPC governance BLOCKS too (a blocked task is a 200 with status:\"failed\"), so the probe couldn't tell a completed routing from a rejection. Two payload bugs meant the checks were in fact hitting the block path every run: (1) the POST /api/agents/care-router/tasks case tagged its intake part kind:\"data\", but the route and lib/a2a.ts read type:\"data\" — so the part was silently ignored, intake collapsed to {}, and the red-flag-mandatory policy blocked the task; it also passed redFlagScreen instead of the redFlagsAcknowledged field the gate actually reads. (2) The POST /api/intake/route-to-care-router case sent only personaId, which the handler does NOT expand into an intake (it uses body.intake ?? {}), so it too routed an empty record and blocked. Net effect: the entire Care Router routing surface — the thing these checks exist to protect — could break end to end and the smoke suite would stay green. Confirmed live against a local prod server: the kind:\"data\" payload returns state:\"failed\"/decision:\"block\", the corrected type:\"data\" payload returns state:\"completed\" with a RoutingDecision artifact. Fix: a shared well-formed SMOKE_INTAKE (the exact shape the tasks route unit test proves completes to mscp-virtual-visit), both payloads corrected, and a per-call validate() hook in probeApi so a 200 is necessary but no longer sufficient — the A2A + handoff cases now assert task.status.state === \"completed\" carrying a RoutingDecision, and the governance pass-case asserts decision === \"allow\". Full suite re-run against a local production build: 139 pass / 0 warn / 0 fail. A green smoke run now means the multi-agent path actually worked, not merely that the server answered.",
        commits: [
          { sha: "97132c0", label: "smoke-test: stop the A2A checks passing on governance-blocked tasks (false green)" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: the governance gate now enforces the rationale policy it advertised (+ tests for all four fabric routes)",
        summary:
          "Follow-up on the same surface. evaluateGovernance() accepted task.hasRationaleField — it's in the function's type, in the POST /api/agent-fabric/governance/evaluate request body, and in the route's own docstring — but the evaluator never read it. So policy.clinical.rationale-required, which is enforcement:\"block\" / status:\"enforced\" and applies to care-router-claude, was structurally unenforceable: you could submit hasRationaleField:false and the gate would happily allow. A dead knob wired to the API sitting next to a policy labelled \"enforced\" is the same advertise-what-you-don't-enforce gap the Agent Card fix just closed. Now hasRationaleField === false raises the blocking violation, mirroring the existing red-flag rule exactly — blocks only when the signal is explicitly false, never when it's merely absent, so partial test fixtures and the demo \"Run test case\" form don't trip the gate by omission. No caller regresses: the A2A /tasks handler and the smoke test always pass true. Separately, the four Agent Fabric HTTP routes had zero route-level tests; added them. governance/evaluate: agentId/task defaults, 400 on unparseable JSON, no-store caching, and the newly-wired rationale block surfacing end-to-end. policies: the payload mirrors the library and the meta _policyCount/_enforcedCount are asserted to be DERIVED from the catalog rather than hardcoded (so they can't drift). traces: the recent-task-index branch vs the ?taskId span-tree branch, per-task scoping, and ?limit clamping — every assertion scoped to a per-test unique task id so the shared, seeded span-store global can't make them flaky. sf-sink/config: the leak guard that matters most on a public curl-able probe (never echoes clientId / clientSecret / baseUrl at any nesting depth) plus the always-present emit counters. 554 frontend tests green (+16); build clean.",
        commits: [
          { sha: "150b9fa", label: "agent-fabric: enforce the rationale policy the gate already advertised + cover all four fabric routes" }
        ],
        status: "shipped"
      },
      {
        title: "Agent Fabric: agent + A2A Agent Card policies now derive from one source of truth",
        summary:
          "An agent's governance policy set was hand-maintained in THREE places that had silently drifted apart: REGISTRY[].policies in the fabric registry (lib/agent-fabric.ts), the Care Router's public A2A Agent Card (/api/agents/care-router/.well-known/agent.json — the document any A2A client reads to learn what the agent supports), and the authoritative POLICIES[].appliesTo that evaluateGovernance() actually checks on every tasks/send. For care-router-claude the three disagreed 6 vs 4 vs 7: the registry omitted the red-flag, HIPAA-audit, and Data-360 consent policies the router genuinely applies (the red-flag one is a hard block the handler enforces), and the card omitted consent. The registry also under-listed pause-mcp (missing policy.data.fhir-r5-only) and mulesoft-ingest, where it referenced policy.audit.correlation-id-mandatory — a policy id that exists nowhere in the catalog (the real one is policy.audit.return-mulesoft-correlation-id). A public discovery document advertising governance the server doesn't enforce — and a registry pointing at a phantom policy — is the same overclaim/drift class this project keeps deleting. Fix: appliesTo is now the ONE source. REGISTRY entries are seeds with no policies field (type AgentSeed = Omit<AgentRecord,\"policies\">); listAgents()/getAgent() attach policies via getPoliciesForAgent(), and the Agent Card derives pauseGovernance.policies the same way, so registry ⇄ card ⇄ enforcement can no longer disagree. The demo Agent Fabric UI already grouped policies by appliesTo, so this corrects the raw /api/agent-fabric/agents payload and the card without touching the console. Tests: agent-fabric.test.ts gains registry⇄appliesTo parity + referential integrity (every appliesTo names a real agent; every agent policy id exists in the catalog — the phantom id is now caught). New route.test.ts pins the Agent Card contract: shape, url is the agent base not the /tasks endpoint, capabilities.streaming + pushNotifications asserted false (the /tasks handler is single-turn — a2a.ts documents SSE + push as out of scope, so flipping either is a lie until implemented), and policies exactly equal getPoliciesForAgent. New a2a.test.ts finally covers the untested sendA2ATask client — request shaping, trailing-slash normalization, and all four response outcomes (ok, HTTP error, JSON-RPC error, missing result) — plus the userMessage/agentMessage/newTaskId helpers. 538 frontend tests green (+42); build clean.",
        commits: [
          { sha: "5c303cb", label: "agent-fabric: derive agent + Agent Card policies from one source of truth (kill the drifted copies)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: a preflight \"doctor\" that brackets the manual org-side activation clicks",
        summary:
          "The final Data 360 step is the maintainer clicking through the Salesforce Data Cloud UI (per docs/PHASE_2_INGESTION_API_RUNBOOK.md) — no code can click those for them. But the clicking can be de-risked from both ends: the verifier (shipped last commit) confirms the END (CIs return real values); this adds the FRONT. New examples/data_cloud_preflight.py (pause-dc-preflight console script) probes the org and prints a [x]/[ ]/[?] checklist mapped to the runbook steps — Step 1 (client_credentials + a360 token exchange succeed → creds + Data Cloud enabled), Steps 2-3 (the Pause_Wearable_Feature__dlm DMO exists + is queryable), Step 4 (the DMO holds pushed rows), Step 5 (all three Calculated Insights reachable by __cio API name) — with a specific remediation pointer on each unfinished step and an auth-failure short-circuit that marks everything downstream blocked. Exit 0 = fully wired, run the verifier next; 1 = steps remain; 2 = not configured. So the operator runs it before starting and between clicks, always seeing what's actually taken effect instead of clicking blind. Reused/extended the tested client: added DataCloudQueryClient.query() (generic POST /api/v1/query, mirrors the frontend dcQuery) to probe the DMO, and DataCloudClientBase.check_auth() to isolate an auth failure (bad creds / DC not enabled / missing CDP grant) from a data failure (DMO/CI not created yet). The runbook gained a \"Preflight — know where you stand\" section up front. Tests: test_preflight.py pins the pure assess() classifier across every scenario (auth-fail blocks downstream, missing DMO blocks push, empty DMO → push TODO, missing CI flagged by name, empty-but-reachable CIs still pass with a note) plus the ready_to_verify gate; +3 client cases (query() two-legged HTTP contract, check_auth success + exchange-failure). Ran against a real Python 3.13 venv: 67 relevant pause_ingest tests green. With preflight + verify, the entire manual runbook is now bracketed by automated checks — the only thing left that a human must do is the clicking itself.",
        commits: [
          { sha: "c1fc8b5", label: "data-360: add the org activation preflight doctor (probe DMO/CIs, map to runbook steps)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: a read-back verifier that proves the org-side CI activation actually worked",
        summary:
          "The one remaining Data 360 gap is org-side: activating the three Calculated Insights (swapping the MAX(constant) mock SQL for the real per-CI aggregates) is a manual Salesforce Data Cloud step the maintainer runs per docs/PHASE_2_INGESTION_API_RUNBOOK.md — it can't be done from this repo. What CAN be de-risked is proving the flip worked. Step 6 of the runbook was an eyeball check (\"does Deepa's HRV look lower than Carmen's?\") against a deployed frontend endpoint. Replaced it with a deterministic read-back verifier — the live-org companion to the static contract test shipped earlier. New pause_ingest tooling: (1) DataCloudQueryClient — refactored data_cloud.py to pull the two-legged a360 token exchange into a shared DataCloudClientBase, then added a query client that GETs each CI exactly the way the frontend does (GET /api/v1/insight/calculated-insights/{name}__cio?filters=[unified_id__c=…]); the existing ingest client now extends the same base (its 8 tests unchanged). (2) expected.py — independently recomputes, in Python, the per-patient aggregates each CI should return, using the SAME formulas as the CI SQL (AVG rmssd → z=(avg−42)/12, SUM severity/30*100, nights<0.80/7); this is a deliberate THIRD encoding of the formulas — the verifier's whole job is to catch a mismatch, so the redundancy IS the check. (3) examples/data_cloud_verify.py (also exposed as the pause-dc-verify console script) — queries all three CIs for every demo persona and asserts the returned columns match expected (counts exact, averaged metrics within tolerance), with an explicit \"every patient identical → mock still active\" guard that names the offending CI; exit 0 = verified, 1 = mismatch/mock-still-live, 2 = not configured; it prints a per-patient table and supports --push to ingest-then-verify. 19 new pause_ingest tests (test_expected.py, test_verify.py, +3 query-client cases in test_data_cloud.py) pin the aggregation math, the mock-detection guard, and the query HTTP contract (two-legged auth, tenant host, bracketed filter, HTTP-error handling) against an httpx MockTransport. Runbook Step 6 rewritten around the verifier (curl kept as a secondary spot-check); data-cloud/README notes it. When the maintainer runs the activation, `python -m examples.data_cloud_verify` now turns \"did it work?\" into one green line instead of a judgment call.",
        commits: [
          { sha: "4033816", label: "data-360: add the Data Cloud CI read-back verifier (query client + expected + verify CLI)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: removed the fabricated pathwayOutcomes resolution rates from the grounding context",
        summary:
          "Follow-up to the cohort-percentile honesty pass. cohortComparison carried a pathwayOutcomes array — per-pathway resolution rates (mscp-virtual-visit 0.71, mscp-in-person 0.78, self-care-tracking 0.34) with cohort counts (n=1840/612/690) — hardcoded identically in BOTH the mock (data-360.ts) and the real grounding path (grounding.ts), and emitted inside a context whose provenance string reads \"Phase 2: SOQL + Data Cloud Calculated Insights.\" Two problems: (1) the numbers are pure fabrication — the demo org has no pathway-outcome / resolution data model, and the n values don't even reconcile with the real cohortSize (a live SOQL COUNT() of CareProgramEnrollee), so they can't be sourced from real CareProgram aggregates; (2) they were dead — audited every consumer (Care Router rationale + routing, both intake API routes, the Agentforce prechat dossier, the Care Detail UI, all 516 tests) and NOTHING reads pathwayOutcomes or resolutionRate; it existed only in the type + the two builders + a mirror in care-detail-stage.tsx's local prop type. Unused fabricated data sitting inside a \"grounding\" object next to real Data Cloud provenance is exactly the overclaim this workstream keeps removing, and it's a latent trap — a future dev could wire it into the dossier believing it's org-derived. Removed pathwayOutcomes from the CohortComparison type, both builders, and the care-detail-stage mirror; tightened the CohortBasis JSDoc (it no longer has to caveat pathwayOutcomes — `basis` is now purely the provenance of patientPercentile). cohortSize (real SOQL COUNT), patientPercentile (honestly flagged intake-estimate), cohortName, and metric are untouched. If per-pathway outcomes are ever wanted, they should come from a real CareProgram outcome aggregate with its own provenance marker, not a constant. 516 tests green; build clean.",
        commits: [
          { sha: "628e22c", label: "data-360: remove the fabricated, unused pathwayOutcomes from the grounding context" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: a contract test that de-risks flipping the Calculated Insights off the MAX(constant) mocks",
        summary:
          "The three activated Calculated Insights are still the MAX(constant) placeholders in data-cloud/_mock_path.sql. The real-data flip — the maintainer's Ingestion-API step in docs/PHASE_2_INGESTION_API_RUNBOOK.md — swaps them for the three committed per-CI SQL files (Pause_HRV_RMSSD_30d / Pause_Vasomotor_Burden_30d / Pause_Sleep_Disruption_7d), which aggregate the Pause_Wearable_Feature__dlm DMO that pause_ingest pushes into. That flip only works if FOUR artifacts agree on column names, observation_type literals, and the aggregate output shape: the DLO schema JSON (ingested fields → __c columns + the observation_type enum), pause_ingest's pushed rows (grain + field names), the real CI SQL (which DMO columns it reads, which types it filters, which columns it emits), and data-cloud.ts (which output columns getWearableInsights reads + the __cio CI names it queries). Any single rename silently returns empty/wrong rows and grounding degrades to the baseline with NO error — the exact ssot__Id__c-vs-unified_id__c class of drift that already bit the mock path. Audited all four end-to-end and confirmed they line up today (30 HRV rows AVG'd, 7 sleep nights, N vasomotor events SUM'd — the row grain matches each CI's aggregation), then pinned it: a new TS contract test (data-cloud.real-path.contract.test.ts, 20 cases) reads the committed .sql + schema JSON + data-cloud.ts source directly — no Python runtime needed — and asserts each CI only reads DMO columns that exist as DLO fields, filters exactly the observation_type values the push emits (all in-enum, no type claimed twice), emits exactly its documented output columns, groups by the unified_id__c dimension (never the validator-rejected ssot__Id__c), and that every column the frontend reads is one the CI emits and every __cio name matches. Also corrected a misleading comment in cohort.py that claimed the 850 ms resting NN-interval mean (an input to RMSSD synthesis) \"matches the CI z-score denominator\" — the z-score anchor (42 ms mean / 12 ms SD normative RMSSD) actually lives only in the HRV CI SQL. The activation itself is still an org-side step Pause can't run from here; this makes the flip fail loudly in CI instead of silently in production if any artifact drifts. 516 frontend tests green (+20); build clean; cohort.py byte-compiles.",
        commits: [
          { sha: "7dd7fa9", label: "data-360: pin the real-CI ingestion contract (DLO schema ⇄ SQL ⇄ frontend)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: stopped presenting the intake-scaled cohort percentile as a live Data Cloud segment",
        summary:
          "Truthfulness fix in the highest-stakes surface. Even on the real grounding path, cohortComparison.patientPercentile is scaled straight from the patient's OWN intake vasomotor score (not her rank within a real cohort distribution), and pathwayOutcomes are hardcoded reference resolution rates — yet they're emitted right next to a \"Phase 2: SOQL + Data Cloud Calculated Insights\" provenance string, so the Care Router rationale and the agent dossier would read an intake-derived number as live segment analytics. Same in the mock. Added an explicit `basis` discriminator to CohortComparison (\"intake-estimate\" | \"data-cloud-segment\"); both the mock and the real builder set \"intake-estimate\" (today's truth), and the field is required so any future builder must declare provenance. cohortSize is untouched — in the real path it's a genuine SOQL COUNT() of CareProgramEnrollee. Consumers made honest: the Care Router rationale now says \"…intake-reported vasomotor symptom burden maps to an estimated Nth-percentile burden (intake-derived estimate, not a live Data Cloud segment)\" instead of \"patient sits at the Nth percentile of <cohort>\", reserving the confident phrasing for a real data-cloud-segment; the Agentforce prechat dossier gains Patient_Percentile_Basis and both grounding telemetry spans carry patientPercentileBasis. Routing behavior is unchanged (the percentile-≥75 promotion still fires as a burden proxy) — only the labeling stops overclaiming. Tests: the rationale hedges by default, uses confident phrasing only for data-cloud-segment, and the mock cohort is flagged intake-estimate. 496 frontend tests green; next build clean (after the build fix below).",
        commits: [
          { sha: "a50cbfb", label: "data-360: stop presenting the intake-scaled cohort percentile as a live segment" }
        ],
        status: "shipped"
      },
      {
        title: "Build fix: main was red — guardMcpAuth exported from the /api/mcp route module",
        summary:
          "Caught while verifying the Data 360 work: `npm run build` was failing on main (introduced by the Headless-360 gap-#2 follow-ups) with \"Route app/api/mcp/route.ts does not match the required types of a Next.js Route — guardMcpAuth is not a valid Route export field.\" Next.js App Router route files may only export HTTP method handlers plus a small config allowlist (runtime, dynamic, …), so exporting the bearer-gate helper directly from the route module fails type-checking and left main un-buildable / un-deployable. Extracted guardMcpAuth (plus the McpAuthIdentity / GuardResult types and attachIdentityHeaders) into lib/mcp/http-auth.ts and imported it from both /api/mcp and /api/mcp/whoami. Behavior is identical — the gate still calls the same validateMcpApiBearer with the introspect-first / userinfo-fallback trust model, and the whoami diagnostic tests pass unchanged. 496 tests green; next build clean.",
        commits: [
          { sha: "177c2e8", label: "fix(build): move guardMcpAuth out of the /api/mcp route module" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 21, 2026",
    headline: "MuleSoft Phase 3 = 9 Exchange assets (full API-led coverage + 5 wearable specs); Headless 360 audit reaches all-prototype",
    intro:
      "Big consolidation week. (1) MuleSoft Phase 3 — the /proposal/mulesoft page's Phase 3 (multi-customer fabric) was pilled `future` since launch; this week shipped nine Exchange assets. 2026-06-26: pause-omh-to-fhir-library v1.0.0 + CloudHub worker 1.0.5 consuming it (end-to-end dependency story proven). 2026-06-27: eight spec-tier assets — pause-jhe-system-api-spec, pause-dbdp-system-api-spec, pause-oura-system-api-spec (the per-wearable template), pause-ingest-process-api-spec (the orchestration tier that ties them together), then four per-wearable clones covering both architectural patterns: pull-from-vendor (Whoop, Garmin) and upload-to-Pause (HealthKit iOS-app-side, Empatica E4 researcher-uploaded .zip archives). With the Process-tier spec published, the full MuleSoft API-led three-tier story is on Exchange — System (Oura/Whoop/Garmin/HealthKit/Empatica/JHE/DBDP) + Process (pause-ingest-process-api-spec) + Experience (pause-provider-experience-api-spec, on Exchange since the Phase 1 worker rollout). (2) Headless 360 audit gap #2 — env-gated `mcp_api` bearer validator on /api/mcp (introspect-first + userinfo fallback; loopback-bearer propagation in the Care Router's MCP host with a structural same-origin guarantee). (3) Headless 360 audit gap #4 — the third Headless 360 surface (CLI), shipped as a new in-repo `@pause-health/cli` Node package wrapping /api/mulesoft/*. With #4 closed, ALL FOUR audit gaps on /proposal/headless-360 read `prototype`. Audit is structurally complete; the only path to `shipped` per gap is operator-side env-var procurement.",
    entries: [
      {
        title: "Headless 360 gap #2 follow-ups — introspect cache + identity threading + /api/mcp/whoami",
        summary:
          "Closed the two runbook-flagged limitations of the original gap #2 ship. (1) Introspect caching: bounded process-local Map<token, {expiresAt, result}> in lib/salesforce-headless360.ts with a 60s TTL, 1024-entry LRU-on-insert cap, only positive results cached so a freshly-issued token isn't stuck rejected. Cuts Salesforce introspect round-trips by ~30x on a hot Vercel instance handling a tools/list + tools/call sequence. (2) Identity threading: guardMcpAuth now returns the validated identity (username + via) instead of swallowing it. /api/mcp attaches X-Pause-MCP-User + X-Pause-MCP-Via headers to every successful response so the Agent Fabric trace plane can attribute tool calls. New GET /api/mcp/whoami diagnostic endpoint (route.ts) returns {gate: \"off\"} when unset, {gate: \"on\", via, username} when a valid bearer resolves, and the same 401/403/503 errors as /api/mcp on failure — lets operators verify gate wiring without parsing the SSE stream. 12 new unit tests pin the cache behavior (positive-cached, TTL-expires, userinfo-fallback-cached, negatives-no-cache, per-token-isolation, no-cache-on-missing-bearer) and the whoami envelope (gate-off, no-bearer 401, misconfig 503, ok-with-username, scope-mismatch 403, ok-without-username). Found and fixed two test-side bugs along the way: vi.fn().mockResolvedValue(Response) returns the same Response object across calls, but Response bodies can only be consumed once — second call's .json() throws and triggers an unintended userinfo fallback. mockImplementation(async () => new Response(...)) returns a fresh Response per call and is the correct pattern; existing tests called validateMcpApiBearer once each so they didn't hit the bug, but the new TTL + negative-cache tests call it twice each and revealed the issue. 493/493 vitest tests green (was 481; +12). tsc clean. Runbook (docs/HEADLESS_360_RUNBOOK.md) updated: 'Known limitations' section split into 'Follow-ups shipped 2026-06-27' + 'Still open' (only the userinfo-fallback-doesn't-enforce-scope item remains, and that's a Salesforce-side org-config choice Pause can't close from this side). Audit page gap #2 needed-column rewritten to reflect the follow-ups landing.",
        commits: [
          { sha: "ec056ad", label: "headless-360: ship gap #2 follow-ups (cache + identity headers + whoami)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 — four per-wearable clones (HealthKit + Whoop + Garmin + Empatica E4) published to Anypoint Exchange",
        summary:
          "Four per-wearable System API specs at v1.0.0 each, published to Anypoint Exchange under the Pause Health business group. Demonstrates BOTH architectural patterns the Phase 3 plan describes. Pull-from-vendor (Oura template): pause-whoop-system-api-spec extends with Whoop's data-type catalog (synthetic OMH schemas recovery-score:1.0 and cardiovascular-strain:1.0 for Whoop's composite scoring metrics that aren't in the OMH catalog, plus standard sleep-episode + physical-activity + heart-rate + heart-rate-variability); pause-garmin-system-api-spec extends with body-temperature + oxygen-saturation (Garmin's Body Battery + Pulse Ox feeds) and documents the OAuth 1.0a quirk (Garmin Health API hasn't migrated to OAuth 2.0; the Mule app speaks 1.0a upstream while downstream callers still use OAuth 2.0 client_credentials), and the webhook-ping + pull-on-receipt upstream cadence. Upload-to-Pause (distinct architectural pattern): pause-healthkit-system-api-spec has POST /healthkit/{patient}/upload that accepts iOS-app-shaped HealthKit batches (the iOS app reads HKHealthStore on-device with Apple's per-type consent and uploads JSON; there is no Apple Cloud REST API to poll), plus GET /healthkit/{patient}/types so the iOS app can skip consent prompts for types Pause won't ingest, plus the cycle-tracking types (HKCategoryTypeIdentifierMenstrualFlow etc.) that no other vendor exposes; pause-empatica-system-api-spec has POST /empatica/{patient}/upload accepting multipart .zip archives (E4 session export — one CSV per signal: HR, IBI, EDA, TEMP, ACC, BVP, TAGS), POST /empatica/{patient}/derive for re-running feature derivation against a previously-uploaded session when DBDP feature algorithms improve, plus GET /empatica/{patient}/sessions for audit. The Empatica spec is honestly anchored to pause_ingest/pause_ingest/empatica.py, which currently raises EmpaticaIngestNotImplemented because devicely's numpy<2.0 pin breaks the Python 3.13 scientific stack — Phase 2 of the DBDP integration. All four specs follow the same plain-jar Maven packaging and the curl-PUT publish recipe (POM with Content-Type: application/xml; jar with application/java-archive). All four spec files parse clean (no missing $refs) and registered on Exchange with status: published. Page updates: /proposal/mulesoft Phase 3 detail expanded from five to nine total Exchange assets and explicitly calls out the two architectural patterns covered; metadata description refreshed. Honest framing in every spec's info.description: this is contract-only; no Mule wrapper exists for any of these vendors today; the contracts let customer-side Mule apps and the future Pause integrations wire against a stable shape now.",
        commits: [
          { sha: "90e9cc4", label: "mulesoft: ship four per-wearable Phase 3 specs (HealthKit/Whoop/Garmin/Empatica)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 fifth asset — pause-ingest-process-api-spec v1.0.0 (Process tier; completes API-led coverage on Exchange)",
        summary:
          "Fifth Phase 3 artifact on Anypoint Exchange under the Pause Health business group and the one that completes the MuleSoft API-led three-tier story on Exchange. Single endpoint: POST /samples, the canonical Process-tier orchestration entrypoint. Validates an OMH IEEE 1752.1 envelope → transforms to FHIR R5 via pause-omh-to-fhir-library's dw::pause::health::omh → writes to JHE via pause-jhe-system-api-spec's POST /fhir/r5/Observation → fires DBDP feature compute via pause-dbdp-system-api-spec's POST /features/hrv:compute (fire-and-forget, async per the reference flow's <async> block) → returns {status: accepted, observationId, source, featureComputeTriggered}. The contract is anchored to the real reference Mule XML at mulesoft/flows/pause-process-api.example.xml — five-step <flow> documented step-by-step in the spec's info.description and per-step in the operation description. Error envelope mirrors the reference flow's <error-handler> on-error-propagate: {status: error, error, errorType} with the Mule errorType.identifier propagated (HTTP:CONNECTIVITY, JSON:SCHEMA_NOT_HONOURED, HTTP:UNAUTHORIZED) so the runbook can diagnose without re-decoding. Four schemas: IngestSampleRequest (source + OMH header + body), OmhHeader (IEEE 1752.1), IngestSampleResponse, ProcessApiError. Spec parses clean (no missing $refs). Honest framing in the info block: this is contract-only — the reference XML is labeled REFERENCE, not deployable (lacks customer property files + the bundled OMH JSON schema); Phase 1c materializes the deployable Mule project; today pause_ingest's Python worker does the equivalent orchestration in-process. Plain-jar Maven packaging, same curl-PUT publish recipe as the four prior spec assets. Verified: Exchange asset listing returns status:published. Page updates: /proposal/mulesoft Phase 3 detail now names all five shipped assets and explicitly calls out the full API-led tier coverage (System + Process + Experience); metadata description refreshed.",
        commits: [
          { sha: "3c82200", label: "mulesoft: ship pause-ingest-process-api-spec v1.0.0 (Phase 3 fifth asset; Process tier)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 fourth asset — pause-oura-system-api-spec v1.0.0 (per-wearable template)",
        summary:
          "Fourth Phase 3 artifact on Anypoint Exchange under the Pause Health business group, and the template for additional per-wearable specs (HealthKit, Whoop, Garmin, Empatica E4). OAS 3.0 contract at mulesoft/specs/pause-oura-system-api-spec/src/main/resources/oura-system-api.oas3.yaml describes the HTTP surface a future Mule app wrapping the Oura Cloud API would expose downstream to Process APIs. Two endpoints: GET /oura/{patient}/{dataType}?from=&to=&tz=&limit= (returns an array of IEEE 1752.1 envelopes; six supported dataType values pinned to pause_ingest.convert.SUPPORTED[\"oura_raw\"] — heart-rate, heart-rate-variability, step-count, sleep-duration, sleep-episode, physical-activity) and GET /oura/{patient}/account (lightweight diagnostic returning {linked, tokenFresh, scopes, lastSyncIso} so the Care Router can fail fast on revoked Oura access instead of polling forever). Five schemas: OmhSamplesResponse, the OMH envelope + header (shape fixed by IEEE 1752.1 / omh_shim v1.0.1), AccountStatus, and a SystemApiError envelope with a tight code enum (unsupported-data-type, invalid-time-window, missing-timezone, patient-not-found, account-not-linked, upstream-unavailable, internal-error). Honest framing inside the spec's info.description: this is contract-only, no Mule wrapper exists; pause_ingest's Oura ingest today reads from a synthetic JSON fixture in oura_sample_upload.py, not Oura's live REST API. Phase 1c will materialize the Mule app. README explicitly calls out the per-wearable template story — future HealthKit/Whoop/Garmin specs are near-clones with vendor-specific dataType lists + auth model on securitySchemes. Plain-jar Maven packaging, same curl-PUT publish recipe as the other spec assets. Verified: Exchange asset listing returns status:published. Page updates: /proposal/mulesoft Phase 3 detail now names all four shipped assets; metadata description refreshed.",
        commits: [
          { sha: "2ec0d2e", label: "mulesoft: ship pause-oura-system-api-spec v1.0.0 (Phase 3 fourth asset, per-wearable template)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 third asset — pause-dbdp-system-api-spec v1.0.0 published to Anypoint Exchange",
        summary:
          "Third Phase 3 artifact on Exchange under the Pause Health business group. OAS 3.0 contract at mulesoft/specs/pause-dbdp-system-api-spec/src/main/resources/dbdp-system-api.oas3.yaml describes the HTTP surface a future dbdp-system-api Mule project would expose on top of the existing pause_ingest.features Python layer. Single endpoint, parameterized by mode: POST /features/hrv:compute with mode=sliding-window (wraps hrv_features_flirt — FLIRT-backed, sliding-window default 180s/60s, multiple feature domains td+fd+stat) or mode=time-domain-fallback (wraps hrv_time_domain_fallback — dependency-light, Kubios-validated, single aggregate). Honest framing inside the spec's info.description: this is contract-only; no live REST surface exists today; the existing pause_ingest.features Python functions are called in-process from pause_ingest/examples/oura_sample_upload.py, NOT over HTTP. Phase 1c will materialize the Mule wrapper. Shape pinned to three real things — the endpoint sketch in mulesoft/flows/pause-process-api.example.xml, the Python function signatures in pause_ingest/pause_ingest/features.py, and the FHIR derivation shape (urn:pause-health:code:dbdp-features / hrv_rmssd_sliding_180s with derivedFrom lineage) the CloudHub worker already returns. Five schemas: HrvComputeRequest, two response shapes (sliding-window vs time-domain-fallback), shared HrvTimeDomain (1:1 mirror of pause_ingest.features.HrvTimeDomain dataclass — meanNnMs/sdnnMs/rmssdMs/nn50Count/pnn50Pct/meanHrBpm/sampleCount, Task Force 1996 standard), DbdpError envelope. 400-response examples cover the real validation failures pause_ingest enforces (IBI series outside 100-5000 ms range as unit-confusion check; size < 5 for fallback / < 2 for sliding-window). Plain-jar Maven packaging, same curl-PUT publish path as the JHE spec (mvn-deploy-plugin sends wrong Content-Type for .pom files; the workaround is documented in the README). Verified: Exchange asset listing returns status:published. Page updates: /proposal/mulesoft Phase 3 detail now names all three shipped assets and notes the implementation gating; metadata description refreshed. No code paths in pause-health.ai consume the spec yet — this is contract-first publishing.",
        commits: [
          { sha: "a4258ad", label: "mulesoft: ship pause-dbdp-system-api-spec v1.0.0 (Phase 3 third asset)" }
        ],
        status: "shipped"
      },
      {
        title: "Headless 360 audit gap #4 closed — @pause-health/cli ships (REST + MCP + CLI triad complete)",
        summary:
          "Salesforce's Headless 360 trust model exposes every agent capability through three surfaces — REST API, MCP tool, AND `sf`-style CLI command. The /proposal/headless-360 audit had gap #4 pilled `future` since launch, framed as 'low priority since investors interact via the web surfaces.' Shipped anyway because: completing the triad is a small lift, and the CLI is genuinely useful for operator smoke-tests against preview deploys. New cli/ in-repo package: zero-runtime-dep CLI with four commands wrapping /api/mulesoft/{health,providers,patient/<id>/timeline,patient/<id>/intake}. Pretty default output for human consumption; `--json` for jq piping. Honors PAUSE_BASE_URL + PAUSE_API_KEY env and `--base-url` per-invocation. Hand-rolled argv parser (BOOLEAN_FLAGS + VALUE_FLAGS sets, positional collection, unknown-flag rejection) — keeps the install lean vs commander/yargs for a four-endpoint shim. Same package shape as mcp/ (npm bin entry, tsc → dist/, scripts/smoke.mjs against live endpoints). 17 unit tests pin the parser (flag matrix, value-flag-missing-value, unknown-flag rejection, env precedence) + the http client (Accept + User-Agent headers, PAUSE_API_KEY → Authorization, --base-url override, trailing-slash strip, non-2xx error format). 6/6 smoke cases green against pause-health.ai (--help, --version, unknown-command 2-exit, pause health, pause providers pretty + --json). Audit page intro copy updated to note all four gaps now read prototype as of 2026-06-27. NOT publishing to npm yet — the audit gap ships the artifact; npm-scope ownership is a separate ops decision. New cli/README.md covers install (npm install + npm run build + optional npm link), the four commands, the configuration env vars, what's explicitly not in scope (write commands, OAuth flow, npm publish), and the development workflow. tsc clean across the new package + the frontend. Total project test count: 481 frontend + 17 cli = 498 passing.",
        commits: [
          { sha: "0626bf6", label: "cli: ship @pause-health/cli (gap #4 closed; REST + MCP + CLI triad complete)" }
        ],
        status: "shipped"
      },
      {
        title: "Headless 360 audit gap #2 closed — `mcp_api` bearer gate on /api/mcp (dormant until SF_HEADLESS360_REQUIRE_MCP_AUTH=on)",
        summary:
          "Shipped the second of four Headless 360 audit gap closures. /api/mcp now honors a Salesforce-issued OAuth bearer with `mcp_api` scope when the operator opts in via SF_HEADLESS360_REQUIRE_MCP_AUTH=on. Default stays public — the Agentforce 3.0 Registry's public-mock posture is preserved. New helpers in lib/salesforce-headless360.ts: isMcpApiAuthRequired() (truthy-string env reader) and validateMcpApiBearer(req, cfg, fetch?) — RFC 7662 introspect first (POST /services/oauth2/introspect, strict path: requires `active=true` AND scope contains `mcp_api`); userinfo fallback (GET /services/oauth2/userinfo, permissive path: verifies token aliveness only; result self-documents as `via: \"userinfo-fallback\"` + `scope: null` so callers can log the weaker guarantee). The validator returns a discriminated union — `{ok, via, scope, username} | {ok: false, reason}` where reason ∈ {missing-bearer, token-inactive, scope-mismatch, introspect-error}. Wired into app/api/mcp/route.ts as `guardMcpAuth()` that runs before the existing handle() — returns 401 (missing-bearer / token-inactive / introspect-error), 403 (scope-mismatch), or 503 (env gate on but Headless 360 unprovisioned, fail-closed posture). All non-2xx responses include WWW-Authenticate: Bearer realm=\"mcp_api\", error=\"<reason>\" per RFC 6750 so MCP clients can prompt for re-auth. Cross-origin protection on lib/mcp/host.ts: resolveRemotesFromEnv(origin, {loopbackBearer}) now attaches the inbound bearer to the loopback MCPRemoteConfig only; external remotes from PAUSE_MCP_HOST_REMOTES keep their own headers. createMCPHostFromRequest(req) reads the Authorization header off the inbound request and threads it through — Salesforce user identity gets propagated to the loopback MCP server but never cross-origin (same-origin guarantee is structural, not a check that could regress). 25 new vitest tests pin: isMcpApiAuthRequired truthy/falsy matrix (12 cases), validateMcpApiBearer for missing-bearer + non-Bearer scheme rejection + introspect success/scope-mismatch/inactive + the two userinfo fallback branches + network errors + bogus 200 body + whitespace trim, and the host loopback-bearer attachment + same-origin guarantee + loopback-off interaction (3 cases). 481/481 vitest tests green (was 456; +25). Audit page updated: /proposal/headless-360 gap #2 pill flipped designed → prototype with the activation snippet rewritten to reflect the actually-shipped behavior. New runbook section in docs/HEADLESS_360_RUNBOOK.md § \"Closing gap #2\" covers validation flow, HTTP semantics table, operator activation + smoke-test commands, rollback (single env-var deletion), and three honestly-flagged known limitations (no validated-username threading into MCP handler, no caching, userinfo-fallback doesn't enforce scope). tsc clean.",
        commits: [
          { sha: "3202a2a", label: "headless-360: ship mcp_api bearer gate on /api/mcp (gap #2 closed)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 second asset — pause-jhe-system-api-spec v1.0.0 published to Anypoint Exchange",
        summary:
          "Published the JHE System API contract as a versioned Anypoint Exchange asset under the Pause Health business group. The spec at mulesoft/specs/pause-jhe-system-api-spec/src/main/resources/jhe-system-api.oas3.yaml documents three real JHE REST endpoints — POST /o/token/ (OAuth2 client_credentials, openid+email scopes only — anything else 400s with invalid_scope), POST /fhir/r5/Observation (with the mapped-vs-auxiliary handler routing keyed on code.coding[0].system, and the X-JHE-FHIR-Source-ID header gotcha the auxiliary handler 400s without), and GET /fhir/r5/Observation?patient=… (no-filter-on-unknown-patient invariant pinned by pause_ingest's real-JHE tests). Plus 10 data-plane schemas (Study, Patient, DataSource, FhirSource, etc.) documenting JHE's Django ORM models — honest framing: those are NOT exposed as REST today, they're seeded by jhe-local/bootstrap.sh; documenting them here gives any customer-side Mule app the JHE-internal vocabulary in one place. Packaging is plain Maven jar (same approach as pause-omh-to-fhir-library to dodge Exchange's mule-plugin extension-extraction 502s); consumers add `<dependency>...pause-jhe-system-api-spec...</dependency>` and read the yaml off the classpath. Published via the curl-PUT publish recipe (POM as application/xml, jar as application/java-archive — the Exchange v2 mvn-deploy Content-Type gotcha already documented for the DataWeave library applies here too). Spec validates clean (17 schemas, no missing $refs). Verified: Exchange asset listing returns status: published. Page updates: /proposal/mulesoft Phase 3 detail now names both shipped assets and notes the implementation gating; metadata description refreshed. No code paths in pause-health.ai consume the spec yet — this is contract-first publishing. Phase 1c will materialize the implementation.",
        commits: [
          { sha: "6742c9a", label: "mulesoft: ship pause-jhe-system-api-spec v1.0.0 (Phase 3 second asset)" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft Phase 3 opens — pause-omh-to-fhir-library v1.0.0 published to Anypoint Exchange",
        summary:
          "Promoted the OMH (IEEE 1752.1) → FHIR R5 Observation DataWeave transform out of the pause-mulesoft-health-v1 worker and into a versioned, reusable Anypoint Exchange asset on the Pause Health business group (groupId 56707cc3-a0e3-4318-b110-78126aace370). Shipped: a new mulesoft/pause-omh-to-fhir-library/ Maven project (plain `jar` packaging, no classifier — see below) with the canonical `omhToObservation(sample, patientRef, idx)` function at `dw/pause/health/omh.dwl`, importable as `dw::pause::health::omh` from any Mule DataWeave script. The CloudHub worker bumped to v1.0.5 with the new artifact as a `<dependency>`; the deployable mule-application jar now bundles `repository/.../pause-omh-to-fhir-library-1.0.0.jar`, proving end-to-end consumption of the Exchange asset. Worker flow XML unchanged, so the runtime `/health` and `/providers` responses stay byte-identical to 1.0.4 — this entry is about Phase 3 wiring, not a refactor of the existing flow. Two non-obvious gotchas found and documented: (1) Anypoint Exchange v2 500s on the .pom upload with `application/x-www-form-urlencoded` (mvn-deploy-plugin's default for .pom files), so the publish recipe uses a direct curl PUT with `Content-Type: application/xml` — the .jar upload through mvn is fine because aether sends octet-stream for jars; (2) tagging the library jar `classifier=mule-plugin` triggers Exchange's `ms-exchange-tooling-service` extension-model extraction, which 502s on a no-SDK jar (`invalid json response body: Error proc...`). DataWeave libraries don't need the classifier — the Mule runtime discovers the `dw/` namespace from any jar on the classpath. Page updates: /proposal/mulesoft Phase 3 pill flipped `future` → `prototype`, with a new detail block naming the asset coordinates and the consumer wiring; the protoVsProd table's `OMH → FHIR transform` row now describes the shipped Exchange asset (was: 'reference dwl in the repo'). Verified: Exchange asset listing returns `status: published`; HEAD on both 1.0.0 artifacts returns 200; worker 1.0.5 deployed to CloudHub-US-West-1 Sandbox in 2:12 (BUILD SUCCESS); direct CloudHub `/health` + `/providers` smoke green. New docs at mulesoft/pause-omh-to-fhir-library/README.md (consumer pom snippet, DataWeave import example, the curl-PUT publish recipe with both gotchas inline) and an updated docs/MULESOFT_RUNBOOK.md.",
        commits: [
          { sha: "b7f143b", label: "mulesoft: ship pause-omh-to-fhir-library v1.0.0 + worker 1.0.5 (Phase 3 first asset)" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 13, 2026",
    headline: "Phase 2 across the stack: provider-graph + Data 360 + MuleSoft contract update",
    intro:
      "Two big streams landed and a third caught up. Provider-graph Phase 2 shipped end-to-end: distance ranking from Census 2020 ZCTA centroids, six NPPES board-cert + multi-specialty signals, three state license-sanction overlays dropping 1,720 sanctioned candidates at build, real-shaped synthetic insurance, /provider browseable index + /provider/[npi] profile pages, and a contract-shape vitest pinning live ⇄ mock parity. Data 360 Phase 2 went live on trailsignup — three Calculated Insights (HRV / vasomotor burden / sleep disruption) authored over ssot__Individual__dlm, with SF_DC_TENANT_URL wired into Vercel and the grounding endpoint now returning \"Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights\"; PHASE_2_ACTIVATION_CHECKLIST.md captures the five things the original runbook got wrong (notably that a core Salesforce token is not valid against the c360a tenant and must be exchanged at /services/a360/token first). The MuleSoft live worker's DataWeave was rewritten to match the same Phase-2 contract and is now deployed to CloudHub 2.0 as v1.0.4; production /api/mulesoft/providers reports meta._source: 'live-mulesoft' end-to-end through Auth0-JWT → Flex Gateway → ngrok → the worker. The Care Router and the agent's MCP tool consume both streams: an MSCP-pathway routing decision now attaches a distance-ranked, plan-narrowed, modality-aware recommended-provider list backed by the same queryProviderDirectory the /provider UI reads.",
    entries: [
      {
        title: "Headless 360 audit gap #3 closed — Salesforce Platform Event egress (sink wired, dormant until env vars set)",
        summary:
          "The /proposal/headless-360 audit page originally framed gap #3 as 'Agent Fabric event-monitoring trace export' with the implication that we'd write into Salesforce's Real-Time Event Monitoring stream. Research before writing code corrected that: RTEM's event catalog (LoginEvent, ApiEvent, etc. — ~50 types) is Salesforce-platform-internal. External apps cannot define a new RTEM event type and cannot POST records into the RTEM stream — Pub/Sub API's own comparison table explicitly lists RTEM under SUBSCRIBE capabilities and 'platform events' under PUBLISH capabilities. So we shipped the actual partner-supported pattern: custom Platform Events via REST sObjects. lib/salesforce-platform-event-sink.ts emits each Agent Fabric span as a Pause_Agent_Trace__e Platform Event record (POST /services/data/v60.0/sobjects/Pause_Agent_Trace__e/) authenticated via OAuth 2.0 Client Credentials against a dedicated Connected App. spanToEventPayload maps every TraceSpan field to a custom-field shape (Span_Id__c, Task_Id__c, Operation__c, Protocol__c, Status__c, Duration_Ms__c, Started_At__c, Attributes_Json__c) with sensible truncation on attribute JSON. The sink is hooked into lib/agent-fabric.recordSpan via `void emitSpanEvent(finalSpan)` — fire-and-forget, never blocks routing, swallows all Salesforce errors, bumps process-local counters (attempted/succeeded/failed/lastError) exposed at GET /api/agent-fabric/sf-sink/config. Token cached for expires_in − 60s; 401 wipes the cache so the next call re-mints. 22 unit tests pin env parsing (non-https rejection, __e suffix requirement, trailing-slash normalization), the three-state machine, schema mapping (every field, parent-span optional, truncation tag, circular-reference safety), the no-throw invariant on 401 / network failures, and token-cache reuse across emits. Audit page updated: gap #3 row renamed to 'Agent Fabric → Salesforce Platform Event egress', wording corrected to flag that RTEM is read-only for external clients, pill flipped designed → prototype. Live-verified locally: with env unset, /config returns designed + zero counters and Care Router spans short-circuit emitSpanEvent to 'skipped' (Care Router task still completes cleanly); with env set to a bad Salesforce URL, /config returns prototype + provisioned metadata AND the Care Router task STILL completes successfully (sink fails non-blocking, exactly as designed). docs/SF_PLATFORM_EVENT_SINK_RUNBOOK.md covers Connected App procurement, the exact custom-field schema with API names that match spanToEventPayload(), end-to-end verification, rollback, and the failure modes the sink intentionally swallows. tsc clean; 456/456 vitest tests green (was 434; +22 sink unit tests); smoke 168/168 (was 167; +1 /sf-sink/config probe).",
        commits: [
          { sha: "830bb8e", label: "headless-360: ship Platform Event egress sink (gap #3 of audit; dormant until activated)" }
        ],
        status: "shipped"
      },
      {
        title: "Provider directory filter UI: checkboxes now read as `[ ] label`, not separated by half the page",
        summary:
          "The three checkbox filters on /provider — Only MSCP-certified, Include nearby/relevant fallback, Telehealth only — were rendering with the checkbox at the far-left of its column and the text floating to the right with a large gap. Root cause: the filter form reused `.contact-form-row` (a 2-column grid: `grid-template-columns: 1fr 1fr`) for the checkboxes, AND the global `.contact-form input { width: 100% }` stretched each checkbox to fill its grid cell — so the box sat at column-left while the span text aligned to the right of the same cell. Fixed: new container `.provider-filter-checks` (flex-wrap row, gap 0.4rem × 1.25rem) and new class `.provider-filter-check` (inline-flex with the checkbox `width: 1rem; height: 1rem; margin: 0; flex-shrink: 0`, overriding the global stretch). Markup simplified from three nested labels-with-inline-styles to three clean `<label class=provider-filter-check>` rows. accent-color: var(--brand) so the check itself reads in the Pause pink. Verified live: rendered HTML now shows each label tight-coupled to its checkbox in a single visual unit; tsc clean; 434/434 vitest; smoke 167/167 unchanged.",
        commits: [
          { sha: "b3cc0d2", label: "provider: fix filter-checkbox UI (checkbox glued to its label, no 2-col grid stretch)" }
        ],
        status: "shipped"
      },
      {
        title: "Headless 360 PKCE seam shipped (gap #1 of the audit closed; dormant until External Client App env vars set)",
        summary:
          "The previous entry shipped the /proposal/headless-360 audit page — a four-row table naming the gaps between today's prototype and full Headless 360 conformance. This entry closes the first gap (PKCE External Client App OAuth flow) in the same env-driven pattern as Agentforce Voice. Shipped: lib/salesforce-headless360.ts (env-driven config validating https-only URLs + ≥32-byte session secrets; RFC 7636 PKCE helpers — base64url verifier ≥43 chars, S256 challenge via crypto.subtle; HMAC-SHA256 signed cookie envelope with timingSafeEqual verification and tamper-evidence; 3-state status machine designed/prototype/shipped) + six API routes: GET /api/salesforce/headless-360/config (public status probe, never leaks clientId/redirectUri/secret), GET /authorize (302 to Salesforce /services/oauth2/authorize with state + code_challenge + scopes + httpOnly+SameSite=Lax pending cookie), GET /callback (verifies state, exchanges code for tokens via Salesforce /services/oauth2/token, stores session in a fresh signed cookie, 302 to the originally-requested next path with open-redirect protection), POST /token/refresh (rotates the access token, updates the cookie, clears the cookie if Salesforce refuses), GET /me (calls /services/oauth2/userinfo under the session's access token), POST /logout (idempotent cookie clear). 25 unit tests pin: env-var parsing + the three-state matrix + secret omission from /config + PKCE alphabet + S256 derivation + signed-cookie tamper detection (tampered payload, forged MAC, truncation, missing separator) + JSON round-trip through serialize/sign/verify/parse. New docs/HEADLESS_360_RUNBOOK.md walks the External Client App procurement (Setup → External Client Apps → New → enable PKCE, require PKCE Verifier, scopes mcp_api+refresh_token+api, callback URL match) + the deploy-side env-var checklist + end-to-end verification + rollback. Audit page updated: gap #1 pill flipped designed → prototype, activation snippet rewritten to reflect the actually-shipped routes (not the speculative version). Live-verified against the local dev server in two modes: unset env → /config returns designed, /authorize+others 503 with actionable messages; provisioned env → /config returns prototype with scopes + authorizeUrl, /authorize returns 302 to https://test.my.salesforce.com/services/oauth2/authorize with response_type=code + S256 code_challenge + 256-bit state + scope=mcp_api+refresh_token + HMAC-signed pause_h360_pending cookie. tsc clean; 434/434 vitest tests (was 409; +25); smoke 167/167 (was 166; +1 API endpoint /config).",
        commits: [
          { sha: "a20806e", label: "headless-360: ship PKCE External Client App seam (gap #1 of audit; six routes, 25 tests, dormant until activated)" }
        ],
        status: "shipped"
      },
      {
        title: "Headless 360 — conformance audit page maps every Pause surface onto Salesforce's TDX 2026 architecture (REST + MCP + A2A)",
        summary:
          "Salesforce announced Headless 360 at TDX 2026 — the umbrella architecture that ties Agentforce 360 + Agent Fabric (MuleSoft) + Data Cloud + the Salesforce-hosted MCP server under three integration patterns (REST/SOAP, MCP, A2A) with one identity model (OAuth 2.0 Authorization Code + PKCE via an External Client App, scopes mcp_api + refresh_token). The PO asked for it. Honest framing matters: 'Headless 360' as of June 2026 is a Salesforce Architects blog family (TDX 2026), not yet a developer.salesforce.com doc family — so 'add Headless 360' doesn't map to a single SDK install. What CAN ship today is the conformance audit: a single-page mapping of every Pause surface onto the three patterns, with status pills on every row, plus the explicit list of what's MISSING for full Headless 360 conformance (the PKCE External Client App seam under the new mcp_api scope). Shipped: new /proposal/headless-360 page. Three sections worth calling out: (1) Three-card pattern overview (REST + MCP + A2A) with the live Pause surfaces in each — Data 360 grounding / MuleSoft Experience APIs / Agentforce embedded chat for REST; the Pause MCP server + host for MCP; the A2A Care Router endpoint + Agent Card for A2A. (2) Surface-map table — 8 rows, every Pause Salesforce-adjacent surface classified by pattern + auth model + state + pill, with cross-links to the per-surface briefs. (3) Audit table — 4 named gaps between today's prototype and full Headless 360 conformance: PKCE External Client App OAuth flow (designed); mcp_api scope on the Pause MCP server (designed); Event Monitoring sink from the Agent Fabric (designed); Salesforce CLI parity (future). Each gap names the missing module + the activation path, mirroring the env-driven pattern just used for Agentforce Voice. Cross-linked from /proposal/mcp + /proposal/agentforce + /proposal/agentforce-voice + /proposal/data-360 as the new 'where this fits' anchor in each readDeeper section. Also includes the activation-shape OAuth snippet (SF_HEADLESS360_CLIENT_ID + base URL + redirect + mcp_api + refresh_token scopes) plus the 4 routes that would land when the PKCE seam ships. Smoke jumped 163 → 166 (+1 route + 2 cross-link probes). tsc clean; 409 vitest tests still green.",
        commits: [
          { sha: "d357625", label: "headless-360: ship conformance audit page + cross-links from MCP/Agentforce/Voice/Data-360" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce Voice — partner-web seam wired (env-driven; audio round-trip gated on Agentforce Contact Center licensing)",
        summary:
          "Salesforce announced Agentforce Voice GA on 2025-10-13 and shipped Agentforce Contact Center (the add-on that bundles native voice + CCaaS partner integrations) on 2026-03-10. The PO asked for it on the Pause prototype. Honest framing matters here: the partner-web developer surface is sales-gated as of 2026-06-24 (no public LWC, no Agent API voice endpoint, no SDK index page that survives a curl), and the audio round-trip requires Agentforce Contact Center licensing + a CCaaS partner contract (Amazon Connect / Five9 / NiCE / Vonage). Shipping the licensing-dependent integration without the licensing would either be vaporware or a lie. Shipped instead: the prototype-side seam, fully env-driven and degrading honestly. lib/agentforce-voice.ts defines a 4-env-var contract (PROVIDER + BASE_URL + DEPLOYMENT_REF + AGENT_DEPLOYMENT) with an optional 5th (LANGUAGE) and a 6th verification flag (VERIFIED) that promotes status from 'prototype' to 'shipped' after the operator records a verified round-trip. GET /api/agentforce/voice/config returns a public-safe payload (status + provider + agentDeployment + language) and INTENTIONALLY omits baseUrl + deploymentRef (those are partner-side opaque identifiers a third party could use to initiate a session). A new <AgentforceVoiceButton/> component renders one of three affordances driven by /api/agentforce/voice/config: 'designed' (disabled with activation-plan copy), 'prototype' (enabled, click shows 'verification pending' toast), 'shipped' (enabled, real handshake lands on activation day). New /proposal/agentforce-voice page hosts the button + a Why-voice-first cards section + the activation table + the 5-env-var checklist. docs/AGENTFORCE_VOICE_RUNBOOK.md is the operator-readable procurement+activation checklist (Salesforce sales path, CCaaS partner pick, deploy-side env vars, verification, rollback). 16 unit tests pin the env-var parsing + 3-state matrix + secret-omission invariant. Smoke probe added: /api/agentforce/voice/config in the API matrix + /proposal/agentforce-voice in static routes. tsc clean; 409/409 vitest tests green (was 393; +16 voice unit tests); smoke 163/163 (was 161; +1 route +1 API). Three live states verified end-to-end against a local dev server: unset → designed; provisioned → prototype with secrets omitted from /config; provisioned + VERIFIED=true → shipped. The page deliberately does NOT claim 'voice input via Web Speech API' as Agentforce Voice — that's a separate product (voice input for chat), explicitly out of scope here for clarity.",
        commits: [
          { sha: "7c2e57f", label: "agentforce-voice: ship partner-web seam (env-driven, gated on Contact Center licensing)" }
        ],
        status: "shipped"
      },
      {
        title: "Founder bio refreshed from real LinkedIn content (career arc, education, alumniOf)",
        summary:
          "The earlier polish pass added structure (Person JSON-LD, LinkedIn CTA) but explicitly didn't touch the prose because the public LinkedIn fetcher returned HTTP 999 (their anti-scrape signal) — I refused to invent career history. Now sourced directly from the founder's PDF LinkedIn export: bio paragraph 1 names her current role (Principal Agentforce/Data Cloud Activation Solution Engineer at Salesforce, TMT, Dec 2025–present) and the prior platform-vendor arc (First American → VMware Tanzu → MuleSoft → Salesforce ISV Evangelist → Red Hat), plus the healthcare-domain context from her TriZetto tour on the Facets / NetworX claims platform. Bio paragraph 2 adds the in-flight education (USC Marshall Executive MBA May 2027; UC Berkeley Haas Executive Program in AI and Digital Strategy June 2026) and the earlier degrees (MS Software Engineering Kansas State; BS Computer Science UMKC). The verification line under the LinkedIn CTA now quotes the actual LinkedIn headline verbatim so a visitor confirming the profile sees text that matches what's on the LinkedIn page. JSON-LD enriched with `alumniOf` for all four institutions, with .edu URLs as the verifiable bridge. The career arc explains why she's the right founder for this specific company — every platform layer the Pause prototype talks to today (Agentforce + Data Cloud + MuleSoft + Salesforce + JBoss/Red Hat infra) has been her actual day job in a previous chapter. tsc clean; 393/393 vitest tests; smoke 161/161.",
        commits: [
          { sha: "12fecf5", label: "about: refresh founder bio from real LinkedIn content (career arc + education + JSON-LD alumniOf)" }
        ],
        status: "shipped"
      },
      {
        title: "Founder bio: richer LinkedIn affordance + Person JSON-LD on /about",
        summary:
          "The founder card on /about had a small icon-link to LinkedIn — fine for discoverability but a thin signal for previewers (LinkedIn / Google) trying to resolve the page to a Person identity. The actual bio content didn't change (no LinkedIn-scraped claims; LinkedIn returns HTTP 999 to unauthenticated fetchers, and inventing career history would be the wrong call). What did change: (1) Added a standalone Person JSON-LD block to /about scoped to Maggie C. Hu — same shape as the founder block already in the root Organization JSON-LD at app/layout.tsx, with sameAs to LinkedIn + GitHub, so search engines and LinkedIn's own scraper can resolve the founder card to her LinkedIn identity directly from this page (not just from the org graph at /). (2) Promoted the icon-only LinkedIn link to a labeled CTA — 'Connect on LinkedIn' button with the visible handle 'linkedin.com/in/hucmaggie' alongside, brand-tinted background, hover + focus states, and rel='me author' microformat hints. (3) Added a short verification line right below the CTA so a visitor can confirm they're on the right profile ('the LinkedIn page lists Pause-Health.ai as the current company, with this site in the contact info'). On narrow phones the long handle text is hidden so the CTA + label stay legible; the verify line below names the URL out loud. 393/393 vitest tests still green; smoke unchanged at 161/161; tsc clean.",
        commits: [
          { sha: "446a2e5", label: "about: richer founder LinkedIn affordance + Person JSON-LD on /about" }
        ],
        status: "shipped"
      },
      {
        title: "MCP Bridge: turned ON in production — Care Router host-mode is now serving live traffic at pause-health.ai",
        summary:
          "The previous entry shipped the MCP Bridge code path (per-request MCP host inside the Care Router task handler, loopback to /api/mcp, fallback to direct-call on host failure). This entry activates it: PAUSE_MCP_HOST_ENABLED=on added to Vercel production env; triggered a new prod deploy (dpl_BkoYS1iDj4zUF1xZhr6vpJfhpdXq, aliased to pause-health.ai); verified end-to-end against production with a POST to /api/agents/care-router/tasks (patientZip=92614). The agent fabric span on the verifier task carries `mcpHostEnabled=true`, `mcpHostRemoteCount=1`, and `mcpHostAttempts=[{remoteId:'loopback',ok:true}]` — proving the production Care Router resolved its provider recommendation by calling find_menopause_providers as an MCP tool against https://pause-health.ai/api/mcp, NOT by directly calling /api/mulesoft/providers. Response shape identical to the direct-call path (same 2 MSCP providers, same distance ranks); durationMs 1731 stays in the existing latency band. Rollback is a one-liner if anything goes wrong: `vercel env rm PAUSE_MCP_HOST_ENABLED production` + redeploy; the adapter's direct-call fallback is exercised on every host error anyway, so the surface degrades cleanly even without the env removal. The external slot (PAUSE_MCP_HOST_REMOTES) is still empty — turning on production loopback first is the honest 'eat your own dogfood' move before pointing the host at a partner's MCP server.",
        commits: [
          { sha: "0dcc65c", label: "changelog: turn MCP Bridge on in production (host-mode live at pause-health.ai)" }
        ],
        status: "shipped"
      },
      {
        title: "MCP Bridge: Pause's Care Router agent is now an MCP HOST — calls external MCP servers, not just exposes its own",
        summary:
          "The MCP work to date has been server-side: any AI agent can use Pause as a tool source via npx @pause-health/mcp (stdio) or https://pause-health.ai/api/mcp (Streamable HTTP). The other direction — Pause's own agents using a partner's MCP server as a tool source — was unwired. Closed: new lib/mcp/host.ts (MCPHost class, per-request lifecycle, multi-remote with first-ok-wins iteration, last-error surfaced for traces, configurable timeouts, idempotent close()) + lib/mcp/provider-lookup.ts (an adapter satisfying the existing ProviderLookup contract via find_menopause_providers tool calls; falls back to the legacy direct-call path on host failure so routing decisions NEVER regress when an MCP remote is down). Two remote slots ship today: a loopback to <origin>/api/mcp (always-on, demonstrates host architecture without a partner dep) and a configurable external slot via PAUSE_MCP_HOST_REMOTES (JSON-encoded array of {id,url,headers?}). The Care Router task endpoint at /api/agents/care-router/tasks now opens an MCP host per request (no module-level state — matches Vercel's serverless model) when PAUSE_MCP_HOST_ENABLED is set, threads providerLookup through route(), records per-attempt host attribution on the agent fabric span (mcpHostEnabled, mcpHostRemoteCount, mcpHostAttempts[]), and tears the host down in a finally block. Live end-to-end verified: POST tasks/send with patientZip=92614 returns identical RoutingDecision shape under host-on and host-off (same 2 providers, same distance ranks, same source 'mock' because loopback fronts the in-process directory). 17 new tests (10 host config + iteration; 6 adapter shape + fallback chains; 1 in-process integration round-trip using InMemoryTransport) bring total to 393 passed (was 376). tsc clean. /proposal/mcp now has a prototype-pilled 'Pause as MCP host' section laying out the why-ship-both-directions story. Smoke unchanged at 161/161.",
        commits: [
          { sha: "f333c2d", label: "mcp: ship MCP Bridge — Care Router is now an MCP host" }
        ],
        status: "shipped"
      },
      {
        title: "MCP server now ships a Streamable HTTP transport at /api/mcp — discoverable by the Agentforce 3.0 Registry",
        summary:
          "The mcp/ package shipped stdio-only — fine for Claude Desktop and Cursor, but Salesforce Agentforce 3.0 (the June 2025 release that introduced the native MCP client) registers external MCP servers through the Agentforce Registry which expects an HTTP-fronted server; stdio is not registry-callable. The prior README pointed at an 'External Services connector or Agentforce MCP gateway' — wording that's obsolete for 3.0 intake. Closed: extracted the four tool registrations (get_patient_timeline, get_patient_intake, find_menopause_providers, experience_api_health) into mcp/src/tools.ts behind a transport-agnostic createPauseMcpServer factory; mcp/src/server.ts now imports from there for the stdio path. Added a Next.js App Router route at frontend/app/api/mcp/route.ts using @modelcontextprotocol/sdk's WebStandardStreamableHTTPServerTransport (web-standard Request/Response, drops directly into the App Router handler shape; pinned runtime='nodejs' because the SDK uses Node-only APIs). Stateless mode (no sessionIdGenerator) matches Vercel's serverless invocation model and is what the Registry's connection profile expects today. The frontend's tools.ts is duplicated from mcp/src/tools.ts because frontend/ and mcp/ are separate npm packages (no monorepo); a parity vitest (frontend/lib/mcp/tools.parity.test.ts) compares the two file bodies and fails CI if they drift. Both transports verified end-to-end: stdio (cd mcp && npm run smoke) lists 4 tools + calls each one against the local dev server; Streamable HTTP (an MCP Client over StreamableHTTPClientTransport against http://localhost:3000/api/mcp) lists 4 tools and successfully calls all four. Smoke matrix extended with a new step [4/4] that POSTs an MCP initialize and asserts the SSE response carries serverInfo={name:pause-health-mcp,version:0.3.0} + tools capability advertised — 161/161 pass (was 160). README + /proposal/mcp + /proposal/agentforce updated with the actual Agentforce 3.0 Registry flow (Setup → Agentforce Registry → New MCP server → paste https://pause-health.ai/api/mcp → allowlist tools → land in Asset Library → attach to a Topic in Builder → validate in Plan Canvas). Auth specifics for the Registry's connection profile live in the gated 'MCP for Agentforce' help article and are flagged accordingly in both the README and the prototype page; we'll wire OAuth or Named-Credential auth when a partner needs it. The prototype endpoint serves the public mock APIs and runs unauthenticated by design. tsc clean; 376 vitest tests green (was 375; +1 for the parity test).",
        commits: [
          { sha: "0da5070", label: "mcp: ship Streamable HTTP transport at /api/mcp for Agentforce 3.0 Registry" }
        ],
        status: "shipped"
      },
      {
        title: "Smoke test now writes per-target reports — prod runs no longer clobber the committed local-evidence file",
        summary:
          "frontend/scripts/smoke-test.mjs always wrote to SMOKE_TEST_RESULTS.md regardless of BASE_URL, so running it against production (BASE_URL=https://pause-health.ai) overwrote the committed local-evidence file the /roadmap page points at. The diff after a prod run looked like a regression because production was lagging the deploy and had fewer rendered changelog entries → fewer internal links → fewer passing probes, even though both targets were healthy on their own. Burned ~30 min in this session figuring it out. Fixed: localhost / 127.0.0.1 still writes to SMOKE_TEST_RESULTS.md (the committed evidence file); any other URL writes to SMOKE_TEST_RESULTS.<host-slug>.md (e.g. SMOKE_TEST_RESULTS.pause-health-ai.md). Per-target reports are gitignored so ad-hoc prod runs don't sneak into a commit. A REPORT_PATH env var overrides either way for future flexibility. Production smoke was green (131/131) and prod is just one deploy behind main — once 861b3e9 + this commit ship, prod's counts will catch up to local's 160/160.",
        commits: [
          { sha: "861b3e9", label: "smoke: correct the API-endpoints count (16, not 17) and break out persona routes" },
          { sha: "2671fcb", label: "smoke: write per-target reports so prod runs don't clobber committed evidence" }
        ],
        status: "shipped"
      },
      {
        title: "End-to-end smoke test refreshed (132/132 → 160/160) against the post-Phase-2 surface",
        summary:
          "Committed SMOKE_TEST_RESULTS.md was dated 2026-06-08 — the surface has grown 20+ commits since (provider directory pages, telehealth filter end-to-end, recommended-providers helper, JHE bootstrap docs, MuleSoft iteration 8 deploy, real-JHE pytest marker, roadmap+integration reconciliation), and none of the new routes/links were in the smoke matrix. Re-ran against a fresh `next dev`: pass 160, warn 0, fail 0. Static pages 35→38, unique internal links 77→102, elapsed 15s→10s. API endpoints stayed at 16 (the smoke matrix was already complete on that axis at the previous run). Roadmap Now-horizon line bumped to the new counts and explicitly broken out as '38 static routes + 4 persona-specific routes + 102 unique internal links + 16 API endpoints' so the totals reconcile to the 160-pass headline. No regressions surfaced. tsc clean; 375 vitest tests green.",
        commits: [
          { sha: "ab6d6af", label: "smoke: refresh end-to-end smoke-test results (160/160 pass)" }
        ],
        status: "shipped"
      },
      {
        title: "Roadmap + integration page: reconcile pill states with the work shipped over the past two weeks",
        summary:
          "Roadmap had drifted relative to what's actually on main. Three corrections: (1) /roadmap MuleSoft iteration 8 — Phase-2 contract DataWeave was pilled 'planned' with a 'committed but undeployed' detail, but iteration 8 actually shipped 2026-06-16 as v1.0.4 on CloudHub 2.0 (commit ca2229a); flipped to 'shipped' and replaced the detail with the live verification (direct CloudHub returns the full Phase-2 field set; pause-health.ai/api/mulesoft/providers reports meta._source:'live-mulesoft') plus the two non-obvious deploy gotchas the maintainer captured (Connected App needs Runtime Manager + Exchange scopes per surface; -DmuleDeploy doesn't publish to Exchange so the deploy is two commands). (2) /roadmap pause_ingest → real JHE round-trip entry extended to mention the 2026-06-23 PAUSE_USE_REAL_JHE=1 pytest marker shipping — same 7 contract assertions now run against the live JHE Django instance, not just the periodic manual smoke; surfaced + documented 2 more mock-vs-real divergences. (3) /roadmap MuleSoft iterations 1–7 → iterations 1–8 (the same iteration-8 ship), and Now-horizon explainer trimmed accordingly. /proposal/integration Phase 0 + Phase 1 details extended in parallel so the integration brief's claim line ('verified against real JupyterHealth Exchange') is backed by the new automated contract suite rather than a manual smoke run. tsc clean; 375 vitest tests green.",
        commits: [
          { sha: "0f8bc99", label: "roadmap+integration: reconcile pill states with shipped work" }
        ],
        status: "shipped"
      },
      {
        title: "JupyterHealth Exchange: opt-in pytest marker now runs pause_ingest's contract test against a real JHE instance, not just the wire-level mock",
        summary:
          "The JHE_SETUP_RUNBOOK called out Path B as a sketch — an opt-in PAUSE_USE_REAL_JHE=1 pytest marker that would swap the in-process JheMockServer fixture for IngestConfig.from_env() so the same contract assertions run against a real JHE Django instance, but the sketch was never wired. Closed: shipped pause_ingest/tests/conftest.py (registers the real_jhe marker + a collection hook that swaps modes on PAUSE_USE_REAL_JHE and skips the mock-only test_exchange_integration module when the real mode is on) and pause_ingest/tests/test_exchange_real_jhe.py (7 tests mirroring the mock contract suite: token exchange, mapped-handler OMH write, auxiliary-handler write with X-JHE-FHIR-Source-ID, invalid-credentials 4xx, FHIR validator rejection on missing subject reference, no-cross-patient-leakage on unknown patient_id, and the end-to-end raw-plus-derived round-trip with derivedFrom pointers resolving to the JHE-assigned ids). Default pytest run unchanged: 67 passed, 7 skipped (real_jhe gated off). PAUSE_USE_REAL_JHE=1 pytest run against the live jhe-local Docker stack: 66 passed, 8 skipped (mock contract gated off) — 7/7 real_jhe tests green. Two more mock-vs-real divergences the first real-mode run surfaced beyond the 3 fixed on 2026-06-16: (1) real JHE's POST /Observation response body does NOT include valueAttachment — only the envelope — so the test validates the OMH payload via the read-back path instead of the POST response, and the runbook now documents the divergence; (2) real JHE's GET /Observation?patient=<unknown> does NOT return an empty Bundle — it returns whatever the OAuth client is authorized to see across its studies, ignoring the unknown patient= filter — so the test asserts the no-leakage invariant (no result is subject-referenced at the unknown patient) rather than fetched==[]. The JHE Exchange line on /proposal/integration and /roadmap can now claim a continuously-verified real-JHE contract, not just a wire-level mock + periodic manual smoke run.",
        commits: [
          { sha: "3b08d6b", label: "jhe: ship the PAUSE_USE_REAL_JHE=1 opt-in pytest marker for pause_ingest's contract suite" }
        ],
        status: "shipped"
      },
      {
        title: "JupyterHealth Exchange: pause_ingest now exercises both JHE write paths end-to-end (mapped + auxiliary)",
        summary:
          "Closing out the loose end called out in the previous JHE entry. The first real-JHE run only wrote the raw OMH heart-rate observation (which routes to JHE's mapped Observation handler); the derived HRV-features path was left undone because it routes to JHE's *auxiliary* FhirAuxResource handler, which 400s without an X-JHE-FHIR-Source-ID header pointing at a registered FhirSource row. Plumbed end-to-end: IngestConfig grew an optional fhir_source_id field loaded from JHE_FHIR_SOURCE_ID; upload_observation now sends the X-JHE-FHIR-Source-ID header whenever the config carries it (mapped handler ignores the header, so always sending it is safe); examples/oura_sample_upload.py uploads BOTH observations on every run and now ends with 'OK — uploaded and round-tripped 2 observation(s)' (raw → server pk integer 60014; derived → server pk UUID 1d752859-… with derivedFrom pointing at 60014); jhe-local/bootstrap.sh reads back the FhirSource pk after creation and surfaces it in the printed env block as JHE_FHIR_SOURCE_ID=90003 so the next contributor's first run uploads through both paths without extra Django shell work; .env.example documents the new field. The wire-level mock was tightened in lockstep — codings outside https://w3id.org/openmhealth now 400 without the header, mirroring real JHE's mapped-vs-aux routing contract; a new test_upload_aux_routed_observation_requires_fhir_source_id_header pins both directions (no fhir_source_id → HTTPStatusError 400 with the JHE error string in the body; with fhir_source_id → success and the mock observed the header value), and the existing core test was tightened to assert the mock did NOT observe the header on a mapped-handler write so the symmetric direction can't drift back. The fourth runbook 'known unknown' (derivedFrom resolution against real JHE) is closed empirically: JHE accepts the derived row with its derivedFrom pointer to the raw row's server-issued integer id and renders the same Bundle search for the patient with both kinds present. 67 pause_ingest tests + 375 frontend tests + tsc all green; transcript appended in docs/JHE_REAL_RUN_2026-06-16.md.",
        commits: [
          { sha: "141e148", label: "jhe: wire pause_ingest's auxiliary-handler write path (derived HRV features) end-to-end" }
        ],
        status: "shipped"
      },
      {
        title: "JupyterHealth Exchange: pause_ingest now round-trips against a real JHE Django instance, not a wire-level mock",
        summary:
          "The integration line on /proposal/integration and /roadmap was correctly pilled `designed` because pause_ingest was only passing against an in-process JHE mock — there had never been a real JHE Django instance behind it. Closed today: stood up real JupyterHealth Exchange end-to-end on the local Docker host (postgres:16 on 127.0.0.1:5433, a locally-built jhe-local:latest image from the upstream Dockerfile, an RS256 OIDC signing key, the canonical seed fixtures including 5 Patients / 6 DataSources / 16 OMH CodeableConcepts), wired a client_credentials OAuth app named pause-ingest whose user is the Patient's JheUser (so client_credentials tokens authenticate as that patient and pass JHE's `subject == user.get_patient()` write check), bound it to the Oura DataSource through a Study with explicit per-scope StudyScopeRequest + StudyPatientScopeConsent rows for every OMH coding pause_ingest writes, and ran the full pipeline end-to-end: examples/oura_sample_upload.py converted a real Oura sample through omh-shim, built a FHIR R5 Observation, POSTed it to /fhir/r5/Observation, got back a server-issued Observation id, and read it back via JupyterHealthClient. `OK — uploaded and round-tripped 1 observation`. The JHE_SETUP_RUNBOOK predicted ~5 known unknowns; three of them fired on the first real-JHE run and were all pause_ingest-side bugs the over-permissive mock had not pinned: (1) pause_ingest requested OAuth scope strings observation.read / observation.write, but JHE's OAuth2 vocabulary is fixed at openid+email and rejects everything else with invalid_scope (JHE authorizes FHIR writes by Study/Patient/Scope consent, not by OAuth scope) — fixed by making `_fetch_oauth_token`'s scope arg optional and dropping it at both call sites; (2) Content-Type and Accept were application/fhir+json which JHE's DRF parser rejects with 415, must be application/json — fixed in upload_observation; (3) the OMH coding shape `system: https://w3id.org/openmhealth/schemas/<ns>` + `code: <schema-name>` did not match JHE's mapped-Observation routing criteria (`code=https://w3id.org/openmhealth|`), so writes silently fell through to the auxiliary FhirAuxResource handler which then 400'd on the missing X-JHE-FHIR-Source-ID header — fixed in omh_to_fhir_observation to emit `system: https://w3id.org/openmhealth` with `code: omh:<schema>:<version>` (matches the seeded CodeableConcept.coding_code shape verbatim). The mock was tightened in the same pass — its round-trip assertion now pins {`omh:heart-rate:2.0`, `hrv-time-domain`} so the routing-criteria shape can't drift back. Captured the full transcript at docs/JHE_REAL_RUN_2026-06-16.md and shipped jhe-local/bootstrap.sh + teardown.sh — idempotent scripts that bring the entire stack up from `./bootstrap.sh` and tear it down from `./teardown.sh`, so the next contributor can repeat the run in 5 min instead of an hour. Status pills flipped: JHE Exchange `designed → prototype`, Phase 1 `designed → prototype` (now reads 'Shipped 2026-06-16'). 66 pause_ingest tests + 375 frontend tests + tsc all green.",
        commits: [
          { sha: "d49cd2d", label: "jhe: pause_ingest round-trips against a real JupyterHealth Exchange instance" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: Phase-2 /providers contract is live on CloudHub (v1.0.4 deployed end-to-end)",
        summary:
          "The Phase-2 DataWeave rewritten in commit cf4a42d (2026-06-15) was sitting committed but undeployed — direct curl to the CloudHub worker still returned the pre-Phase-2 shape (no lat/lng, no serviceSignals/licenseStatus/insuranceAccepted/credentialSource, no top-level matchType/sort), and production /api/mulesoft/providers degraded cleanly to mock-fallback because the ngrok tunnel had gone dormant. Closed both: bumped pom.xml to 1.0.4, restarted ngrok against the pinned cattail-reactive-sassy.ngrok-free.dev domain pointing at the still-running Flex Gateway Docker container (up 7 days, healthy, port 8081), and pushed the new artifact through Anypoint. Two non-obvious deploy gotchas were captured for next time: (1) the rotated pause-prototype-cloudhub Connected App needed scopes added per surface — Runtime Manager (View Environment, View Organization, Read/Create/Delete/Download Applications) on Pause Health > Sandbox AND Exchange (Contributor + Viewer/Administrator) at the Pause Health business-group level (Exchange is org-wide, not env-scoped); without the Exchange grants the deploy phase looked further than 'business group invalid' and made it as far as creating the deployment record, but Runtime Manager then 403'd trying to read the artifact from Exchange and the new replica went into Kubernetes CrashLoopBackOff while the previous-config replica kept serving traffic. (2) mule-maven-plugin's -DmuleDeploy goal does NOT publish to Exchange — it assumes the artifact already exists and just calls Runtime Manager. So the deploy is two commands: a plain mvn deploy:deploy-file against the Exchange v2 maven endpoint (`https://maven.anypoint.mulesoft.com/api/v2/organizations/<bgId>/maven`) — Exchange v3 returns 412 because it requires a runId-precondition handshake the standard maven-deploy-plugin doesn't perform — followed by mvn -DmuleDeploy deploy for the runtime side. Verified end-to-end: direct CloudHub /providers?zip=92614&menopause=true&limit=2 returns the full Phase-2 field set (latitude/longitude/distanceMiles, serviceSignals, licenseStatus, insuranceAccepted with 5 plans, credentialSource:'curated-overlay', top-level sort:'score'); production proxy at pause-health.ai/api/mulesoft/{health,providers} reports meta._source:'live-mulesoft' through the gateway. Local shell still can't reach the tunnel (TLS reset on handshake — VPN/Zscaler edge issue documented in the iteration-3 runbook) but Vercel's network reaches it fine, which is what the demo runs on.",
        commits: [
          { sha: "ca2229a", label: "mulesoft: deploy v1.0.4 with the Phase-2 /providers contract end-to-end" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: reconciled the committed CI SQL + runbooks with the unified_id__c contract that actually runs",
        summary:
          "Documentation/artifact drift cleanup, and a real trap: the committed Data Cloud mock SQL would have been REJECTED if anyone pasted it. data-cloud/_mock_path.sql grouped by ssot__Id__c and emitted bare (non-__c) measure columns — but the DC Calculated-Insight validator rejects the ssot__Id__c alias (the inner __ trips it) and requires output columns to end in __c, and the client (getWearableInsights) filters [unified_id__c=<contact-id>] and reads the *__c columns. So the committed mock SQL contradicted both the validator and the code, and didn't reflect the CIs that are actually activated on trailsignup (which were hand-fixed during activation). The real per-CI .sql files already had the right shape; the mock and the prose hadn't caught up. Fixed: _mock_path.sql now aliases the Individual's ssot__Id__c → unified_id__c, suffixes every measure column with __c, fully-qualifies its column refs, and documents the three validator rules inline so it stays in lockstep with the real CI SQL and data-cloud.ts (also corrected the stale header comment that claimed the code filters on ssot__Id__c). PHASE_2_ACTIVATION_CHECKLIST.md's Step-5 verification query now selects from the __cio object filtered by unified_id__c, and its dated session-2 snapshot carries a session-3 correction. MULESOFT_PHASE_2_DATA_CLOUD.md got a callout that the canonical copy-paste SQL is the committed data-cloud/*.sql (its inline snippets predate the validator rules and are conceptual only), plus fixes to the verify query, the unified-individual mapping, and the failure-mode entry. Docs + SQL only — not executed by app code, so no runtime/test/build impact; the point is that the committed artifacts now match what's live.",
        commits: [
          { sha: "40d9461", label: "data-360: reconcile committed CI SQL + runbooks with the activated unified_id__c contract" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: the live Data Cloud client finally has tests (a360 token exchange + CI mapping)",
        summary:
          "The Phase-2 Data Cloud client (lib/salesforce/data-cloud.ts) is the grounding path production trailsignup actually runs — and it had zero TypeScript coverage, to the point where it exported a _resetDataCloudTokenCacheForTests hook that literally nothing called. The riskiest, most fiddly piece is the a360 two-legged token exchange: a normal Salesforce client-credentials token is NOT valid against the c360a tenant, so it has to be swapped at /services/a360/token for a Data-Cloud-scoped token (the single thing the original runbook got wrong — see PHASE_2_ACTIVATION_CHECKLIST.md). New data-cloud.test.ts (19 tests) drives the module through a URL-routing fetch mock that distinguishes the four endpoints it touches (core /services/oauth2/token, the a360 exchange, the CI endpoint, and /api/v1/query), so request ordering and the Promise.all fan-out don't matter. It pins: the config gate (needs SF + SF_DC_TENANT_URL, and that the tenant URL does NOT auto-derive); the exchange's CDP grant_type + subject_token shape; the exchange-returned instance_url winning as the tenant host over the configured SF_DC_TENANT_URL (and the CI call carrying the exchanged DC bearer, not the core one); token caching, re-exchange after expiry, the reset hook, and graceful degradation to null when the exchange fails or omits access_token/instance_url; the CI request shape (GET /insight/calculated-insights/{name}?filters=[unified_id__c=…] with literal brackets, filter omitted when absent), dcQuery POSTing SQL, and non-ok surfacing the status; and the row→CalculatedInsight mapping — including the source-independent `kind` the Care Router now branches on, id sanitization, per-insight null on empty rows, and whole-call degrade to null on any CI error. No runtime change; pure coverage of the live path. 375 frontend tests green; next build clean.",
        commits: [
          { sha: "cfd1b8e", label: "data-360: test the live Data Cloud client (a360 exchange + CI mapping)" }
        ],
        status: "shipped"
      },
      {
        title: "Data 360: grounding insights now match by a stable kind, not the id that drifts live",
        summary:
          "A silent mock⇄live drift in the highest-stakes path. The Care Router grounds its routing rationale on Data 360 Calculated Insights, but it keyed on the mock's insight ids — insight.hrv-zscore-30d and insight.days-since-mscp-contact. The live Data Cloud + Health Cloud path emits different ids for the very same concepts (insight.hrv-rmssd-30d off the HRV RMSSD CI; insight.days-since-last-clinical-contact off the latest Health Cloud Case), so the moment trailsignup flipped from mock to the real org the HRV and last-contact rationales silently stopped firing and groundingUsed.insightsCited collapsed to vasomotor-only — with no error, because the only insight whose id happened to match on both paths was the vasomotor one. The tests never caught it: they only ever fed mock ids. Fixed it at the contract: CalculatedInsight gains a source-independent `kind` classifier (InsightKind: hrv-variability | vasomotor-burden | sleep-disruption | days-since-clinical-contact | care-program-enrollment | care-plan-status), set on every mock insight (data-360.ts) and every live insight (grounding.ts's SOQL insights + baselines, data-cloud.ts's three CIs). The router now matches by kind first and falls back to the known mock+live id-aliases for any fixture that predates the field, and it cites the ACTUAL matched id so insightsCited is honest on whichever path produced it. The last-contact rationale text is now source-agnostic ('no documented clinician contact in N days') since the live signal is any clinical Case, not specifically an MSCP encounter. Three new tests pin it shut: a live-id grounding fires all three rationales (the exact regression), a renamed id carrying the right kind still matches and cites under its own id, and the real mock GroundingContext is fed straight through to assert its kinds line up with what the router branches on. 356 frontend tests green; next build clean.",
        commits: [
          { sha: "f4b9664", label: "data-360: match grounding insights by stable kind, not the drifting id" }
        ],
        status: "shipped"
      },
      {
        title: "MSCP feed: certification provenance is now visible per-provider (curated vs self-reported)",
        summary:
          "The MSCP feed flags a provider menopauseCertified two honest ways — a curated overlay roster (today synthetic, tomorrow the licensed Menopause Society feed) and a self-reported MSCP/NCMP credential token in the provider's own NPPES record. But the ingest pipeline appended an 'MSCP' badge to overlay providers, which erased the distinction in the credentials array, and the flag itself was a bare boolean — so the UI and the agent literally could not tell a curated-roster provider from a heuristic keyword match. Added a credentialSource field ('curated-overlay' | 'self-reported', present only on certified rows) across the whole surface in mock⇄live⇄OAS parity. The Python dataclass + nppes.py now record it natively going forward (computed BEFORE the badge append, with overlay membership authoritative so it wins over a coincident self-report). For the already-committed national artifact (built before the field existed), the frontend reconstructs it with deriveCredentialSource() — prefer a value the record carries, else derive from overlay membership — backed by a new lib/mscp-overlay.ts that single-sources the 7 overlay NPIs and is pinned against provider_ingest's fixture so the two can't drift. The live CloudHub worker's DataWeave derives the same value off the same NPI list (so live matches mock), both OAS specs declare it, and the /provider/[npi] profile shows an honest source line ('The Menopause Society certified-practitioner roster (curated)' vs 'self-reported … not independently verified by Pause'). This also closes a silent-refresh trap: a new committed-artifact invariant asserts a non-overlay (self-reported) certified cohort survives, and the mock tests assert both sources appear nationally — so a monthly NPPES refresh that dropped every self-reporter fails loudly instead of hiding behind the 7 hardcoded overlay personas. Frontend: 353 tests green; next build clean; both OAS + the worker XML parse. Python: records/nppes/tests py_compile clean (full pytest runs on the maintainer's py3.10+ refresh box).",
        commits: [
          { sha: "f50d2c7", label: "mscp: surface certification provenance (curated-overlay vs self-reported) end-to-end" }
        ],
        status: "shipped"
      },
      {
        title: "Provider UI: single-sourced the display-label maps (the last duplication)",
        summary:
          "Refactor closing out the Provider UI thread. Three surfaces render the same provider data — the directory index (/provider), the profile (/provider/[npi]), and the shared RecommendedProviders list (live Care Router card + scripted intake fallback) — and each carried its own copies of the service-line signal + insurance plan label maps. Adding a new NPPES signal token or insurance plan was a three-file edit that silently drifted (the maps had already diverged once). Extracted everything into lib/provider-labels.ts. The one subtlety worth preserving: the profile deliberately uses spelled-out signal labels ('Board-certified OB/GYN', 'Women's Health Nurse Practitioner') where it has the room, while the chip rows and the inline recommendation list use compact ones ('Board-cert OB/GYN', 'Women's Health NP') — so the module exports two vocabularies (SIGNAL_LABELS + SIGNAL_LABELS_VERBOSE) over a single token key set, plus one shared PLAN_LABELS. The directory and profile import the helpers directly; recommended-providers keeps its recommendedSignalLabel / recommendedPlanLabel exports as thin delegates so its consumers and tests are untouched. New lib/provider-labels.test.ts (5 tests) pins both vocabularies, the raw-token fallback, PLAN_OPTIONS↔PLAN_LABELS mirroring, and the real guard — that the compact and verbose signal maps cover exactly the same tokens so they can't drift apart again. No UI change; 345 frontend tests green; next build clean.",
        commits: [
          { sha: "334c6ae", label: "provider: single-source the provider display-label maps" }
        ],
        status: "shipped"
      },
      {
        title: "Provider UI: made the directory discoverable + fixed the live card's missing ?from",
        summary:
          "Two smaller Provider-UI follow-ups. (1) Discoverability: /provider was a real patient-facing page reachable only from the homepage CTA and proposal prose — it was missing from the sitemap, the footer, and the smoke test, so it was effectively invisible to crawlers and to anyone not on the landing page. Added it to app/sitemap.ts (weekly, priority 0.75), the footer 'Product' group as 'Find a Provider', and scripts/smoke-test.mjs (the index, a filtered query that also exercises the new ?telehealth + ?menopause params, and a /provider/[npi] profile with ?from for the distance chip). Deliberately left the curated top + mobile primary nav alone — that's a marketing-IA decision, not a defect. (2) ?from consistency: the live 'Latest Care Router decision' card rendered its recommended providers without fromZip, so unlike the scripted intake fallback its profile links never carried ?from and the profile's distance-from-your-ZIP chip silently never appeared. The Care Router span now records recommendedProvidersZip (the same query ZIP that drove the distance ranking), and the card reads it and threads fromZip through RecommendedProviders. 340 frontend tests green; next build clean.",
        commits: [
          { sha: "58776aa", label: "provider: discoverability (sitemap/footer/smoke) + carry ?from through the live decision card" }
        ],
        status: "shipped"
      },
      {
        title: "Provider UI: telehealth filter end-to-end + fixed the profile navigation dead-end",
        summary:
          "Provider-directory polish in two parts. (1) Telehealth filter: telehealth already drove a whole fallback tier (certified-remote) and showed as a chip on every card and profile, but a patient who specifically wanted a virtual visit had no way to filter for it. Added an opt-in telehealth filter and threaded it through the entire surface in mock⇄live⇄OAS parity — the standard the rest of this stack holds: queryProviderDirectory gained a telehealth? opt applied to the candidate pool BEFORE the tier ladder (exactly like the insurance filter, so a 'relevant-local telehealth provider' stays relevant-local and we never silently broaden past the filter), echoed in result.query.telehealth; GET /api/mulesoft/providers parses ?telehealth=true and the live providers.ts client forwards it to the CloudHub worker, whose DataWeave got the matching telehealthOnly param + offersTelehealth predicate + query echo (kept 1:1 with the mock); both OpenAPI specs (the published experience-API and the Agentforce External Services slice) now declare the param so the live agent can use it too; and the /provider UI got a 'Telehealth only' checkbox wired through the GET form + reset. (2) Dead-end fix: a /provider/[npi] profile's only navigation was '← Back to demo intake' (→ /demo/intake) — a patient who arrived from the directory had no way back to their results. Replaced it with a '← Back to directory' link that preserves the ?from ZIP as the directory's search ZIP (so distance ranking resumes), keeping the intake link as a secondary action. Tests: a new telehealth mock suite (off-by-default strictly narrows the matched total, telehealth-only returns only telehealth providers, applies before the ladder for certified-national, composes with the insurance filter), route forwarding + mock-mode echo, the live-worker snapshot's query echo, and the Agentforce OAS contract param list. 340 frontend tests green; next build clean.",
        commits: [
          { sha: "9f4f4e6", label: "provider: telehealth filter end-to-end (UI → mock → live → OAS) + fix profile dead-end" }
        ],
        status: "shipped"
      },
      {
        title: "Docs: refreshed the MuleSoft prose to match the live-on-CloudHub reality",
        summary:
          "The MuleSoft Experience worker has been live on CloudHub 2.0 (serving /health + /providers behind Flex Gateway with JWT Validation) since Phase 1b, but several docs still told readers nothing was deployed — a credibility risk for anyone reading the repo. Corrected the flatly-stale claims while preserving the point-in-time runbooks as historical record. mulesoft/README.md: split the intro into live-deployable (the Experience worker) vs reference-grade (the not-yet-built ingestion .example files), updated the worker section to /health + /providers + Flex Gateway/JWT, rescoped the 'why these aren't a real Mule project yet' section to the ingestion references only, and replaced the old 'Mocked Experience API … no live MuleSoft runtime behind it' section with the live-or-mock proxy contract. docs/mulesoft-integration.md: header bumped from 'Draft v0.1 / 2026-05-25' to 'Phase 1 live', and the 'Live mock / no live runtime' section rewritten as the live-or-mock Experience API (both endpoints live, Auth0 Bearer-JWT, transparent mock fallback). docs/MULESOFT_RUNBOOK.md (a 2026-06-02 investigation snapshot) got an EXECUTED/SUPERSEDED banner so its 'no live Mule app deployed' line reads as the starting point, not today. docs/FLEX_GATEWAY_RUNBOOK.md status flipped from 'Not yet started' to DONE, noting JWT Validation replaced Client ID Enforcement. Docs-only.",
        commits: [
          { sha: "f1893af", label: "docs: refresh MuleSoft prose to the live-on-CloudHub reality" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: single-sourced live auth on Bearer-JWT + a complete env template",
        summary:
          "Auth cleanup + operator-onboarding fix. The live gateway enforces a JWT Validation policy (Auth0 RS256/JWKS) which replaced Client ID Enforcement on 2026-06-09 — but both Experience-API clients (health.ts, providers.ts) still carried a dead, copy-pasted, untested fallback that built a Basic Authorization + client_id/client_secret header from MULESOFT_CLIENT_ID/SECRET, credentials the JWT policy simply ignores. Replaced it with a single buildMulesoftAuthHeaders() in auth.ts (Bearer-JWT when an Auth0 M2M token is available, empty otherwise) used by both clients, and added X-Pause-Source to the providers client for parity with health. Added auth.ts's first test suite (9 tests): token mint via the client-credentials grant, caching, the non-2xx and missing-access_token failure paths, the header shape, and a guard that no Basic/client_id header is ever emitted even with the legacy vars set. Separately, frontend/.env.example was missing the vars needed to actually turn live MuleSoft on — completed it with MULESOFT_PROVIDERS_BASE_URL and the AUTH0_MULESOFT_* quartet (domain/audience/client id/secret), and flagged the retired MULESOFT_CLIENT_ID/SECRET as no-ops, so an operator can enable the live path from the template alone. 333 frontend tests green; tsc clean.",
        commits: [
          { sha: "36ff0ae", label: "mulesoft: single-source live auth on Bearer-JWT + complete the env template" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: the live /health worker now carries the DBDP feature lineage it always claimed to",
        summary:
          "Second silent mock⇄live drift on the MuleSoft surface, this time on /health. In mock mode /api/mulesoft/health serves buildPatientTimelineBundle() — a 5-entry FHIR bundle where the raw RR-interval window (obs-hrv-raw-001) and the derived RMSSD feature (obs-feature-rmssd-001) are both present and the feature carries a derivedFrom reference back to the raw window. That's the exact lineage the /proposal/mulesoft page advertises ('every DBDP-computed feature Observation carries a derivedFrom reference back to the raw window'). But the deployed CloudHub worker emitted only 4 flat Observations with no raw window and no derivedFrom — despite the worker's own header comment claiming shape-compatibility with the mock — so the moment /health flipped to live, the provenance would vanish. Rewrote the worker's /health DataWeave to mirror the mock 1:1 (same ids, codes, ordering; raw RR-interval components + RMSSD feature with derivedFrom, using the project's `as String` concat convention), updated the worker README, and extended the published OAS /health example to show the raw→derived lineage. Pinned the contract on the mock with 4 new tests: the timeline bundle is a searchset with exactly one Patient, has ≥1 DBDP feature Observation, every feature carries a non-empty derivedFrom, and every derivedFrom reference resolves to an Observation in the same bundle (no dangling lineage). XML well-formed; both OAS specs parse; 324 frontend tests green; tsc clean.",
        commits: [
          { sha: "3847935", label: "mulesoft: restore the /health DBDP lineage on the live worker" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: insurance synonyms now resolve on the LIVE providers path (mock⇄live parity)",
        summary:
          "Found and fixed a silent mock⇄live contract gap on GET /api/mulesoft/providers: the route forwarded the raw ?insurance value to the live Mule worker, which only lowercases (no alias mapping), while the mock path normalizes synonyms inside queryProviderDirectory. So ?insurance=United matched in mock mode but returned ZERO providers against the live CloudHub API — a patient filtering by 'UnitedHealthcare' would see an empty directory only once the integration went live. Now the route normalizes at the boundary with the shared normalizeInsurancePlan, so both paths receive the canonical token (United→uhc, 'Blue Cross'→bcbs); it's idempotent for the mock and is exactly the job the live worker's own DataWeave comment defers to the route handler. Also shipped the providers route's first test suite (12 tests) — mock mode, cache header, limit clamp, synonym normalization, the live path capturing the outbound URL to prove the canonical token is forwarded (and omitted when absent), and the degrade-to-mock-fallback failure modes (5xx / network error / wrong shape, never throws). 320 frontend tests green; tsc clean.",
        commits: [
          { sha: "802c998", label: "mulesoft: normalize insurance synonyms before the live providers call" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce: hardened the live embed — readiness watchdog + hidden-prechat sanitizer",
        summary:
          "Polished the real Embedded Messaging surface (components/agentforce-embed.tsx). (1) Readiness watchdog: init() resolves synchronously, but the chat launcher only appears once the SDK fires onEmbeddedMessagingReady — and the two most common production failures (a deployment that was never Published, or the host domain missing from the Embedded Service allow-list) leave init() succeeding while that event never fires, so the widget spun on 'Connecting…' indefinitely. After a 12s timeout it now surfaces an actionable hint that names the deployment and points at the publish/allow-list checks; the timer clears on ready, init-error, and unmount. (2) sanitizePrechatFields: now that the fixed V2 prechatAPI actually transmits registered fields to SCRT2, handing an empty string for a registered field like Patient_Zip would overwrite real MessagingSession context with blank — so the embed trims and drops empty/whitespace entries (skipping the setHiddenPrechatFields call entirely when nothing usable remains) and the UI's prechat-field count reflects the sanitized set. Both the sanitizer and the timeout constant moved into lib/agentforce.ts with a new lib/agentforce.test.ts (10 tests) that also backfills coverage for the previously untested getAgentforceConfig (missing/whitespace env vars → null, trailing-slash normalization, bootstrap-URL derivation). 308 frontend tests green; tsc clean; next build OK.",
        commits: [
          { sha: "68b7352", label: "agentforce: harden the live embed — readiness watchdog + prechat sanitizer" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce: contract guard so the live agent's OAS slice can't silently drift again",
        summary:
          "The drift fixed in the previous entry (matchType referenced by the agent instructions but undeclared in the External Services slice, so it never reached the action output) was silent for a while because nothing tied the lean Agentforce spec to the live /api/mulesoft/providers contract. Added frontend/lib/agentforce-provider-oas.contract.test.ts (7 tests) to pin both ends: it reads the YAML slice as raw text (no YAML dependency in the package) and asserts every agent-facing query param (zip/menopause/limit/insurance/fallback), top-level matchType with all five honest-framing tiers named in its description, and every per-row provider field the runbook tells the agent to present (name, specialty, location, telehealth, accepting, distanceMiles, insuranceAccepted, serviceSignals) are DECLARED — then cross-checks against a real queryProviderDirectory result that those same fields are actually PRODUCED, plus a guard that the slice never re-adds the parser-hostile constructs ($ref/oneOf/nullable) the External Services parser rejects. If the slice and the live route ever disagree on an agent-relevant field again, this test fails instead of the live agent silently dropping it. Full suite green: 298 tests.",
        commits: [
          { sha: "92afa7e", label: "agentforce: guard the External Services slice ↔ live provider contract" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce: the live agent's provider action gets the full honest contract (matchType + distance + insurance)",
        summary:
          "The Agentforce-facing External Services slice (salesforce/external-services/pause-provider-directory.oas.yaml — the lean spec Salesforce turns into the findMenopauseProviders action) had drifted from the live /api/mulesoft/providers contract. The drift was load-bearing: the topic instructions tell the agent to 'read the response matchType and frame the results honestly', but matchType wasn't declared in the slice, so External Services never mapped it into the action output and the honest-tiering logic had nothing to read. The runbook also mapped an `insurance` action input the spec didn't expose. Synced the slice to the live contract using only parser-safe primitives (no $ref/oneOf/nullable/enum, which the External Services parser rejects): added the `insurance` and `fallback` query params, the top-level `matchType` string (allowed values enumerated in its description), and per-provider `distanceMiles`, `serviceSignals`, and `insuranceAccepted`. Updated the runbook to note the action now generates those inputs/outputs and that the External Service must be re-registered for matchType to map, and extended both the topic instructions and the paste-ready reasoning block so the live agent presents distance ('about 4 miles away') and accepted insurance and reads matchType for honest tiering — the same framing the scripted fallback already shows the patient. Spec validated (parses; all five params + matchType + the three new provider fields present). Re-registering the External Service in the org is the maintainer's manual step.",
        commits: [
          { sha: "9a36645", label: "agentforce: sync the External Services OAS to the live provider contract" }
        ],
        status: "shipped"
      },
      {
        title: "Intake: test safety net for the shared provider-recommendation rendering",
        summary:
          "The <RecommendedProviders> component (newly shared by the live Care Router card and the prototype intake) shipped without tests. The frontend suite runs in a node environment with no React Testing Library, so rather than pull in jsdom + RTL just for one component, the component's pure logic was extracted into exported helpers and tested directly: profile-link building (bare /provider/<npi> vs ?from=<zip>, with URL-encoding of both NPI and ZIP), the inline meta line (city/state, distance rounded to 0.1 mi, telehealth, correct ordering, and omission of absent fields), the plan-chip cap with '+N more' overflow (incl. undefined/empty and a custom cap), and the signal/plan label lookups with raw-token fallback for unknown payers/credentials. The component now composes these helpers with no behavior change. 14 new tests (291 total) + tsc + next build clean.",
        commits: [
          { sha: "1beaf27", label: "intake: unit-test the shared RecommendedProviders rendering logic" }
        ],
        status: "shipped"
      },
      {
        title: "Intake: the scripted fallback now closes the loop to local MSCP specialists",
        summary:
          "The prototype intake (the scripted fallback shown when the live Agentforce env vars aren't set) asked the patient for their ZIP and insurance, handed off to the Care Router, and showed the routing decision — but silently dropped the provider recommendations the decision already carries, so the demo never actually surfaced the local menopause specialists the provider graph now serves nationally. Now, when the Care Router lands on an MSCP pathway and finds certified clinicians near the patient, the completed intake renders them under a 'MSCP-certified specialists near <ZIP>' heading: name + specialty, city/state, distance-from-your-ZIP, telehealth flag, board-cert / service-line signal chips, and accepted-plan chips. Each name links to /provider/<npi>?from=<ZIP> so the profile page shows the distance chip too. The Care Router path stays strict certified-only (no fallback tiers — that honesty boundary is unchanged), so anyone shown here is a genuinely certified clinician near the patient; ZIPs with no local certified provider simply show no list rather than a misleading one. Implementation extracted the provider-list rendering that lived inline in the live LatestCareRouterDecision card into a shared <RecommendedProviders> presentational component (deduped ~80 lines + the signal/plan label maps), so the live dashboard and the prototype intake now render the graph's output identically. tsc + 277 tests + next build clean.",
        commits: [
          { sha: "909af34", label: "intake: surface Care Router provider recommendations in the scripted fallback" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: committed-directory data-quality invariants (the coverage + US-ZIP wins are now test-enforced)",
        summary:
          "The coverage spread and the US-ZIP gate live in the generated artifact, not in code — so a future monthly refresh_national.sh run could silently regress them (drop --coverage, let foreign postals back in, lose a state) and every unit test would still pass. New vitest runs directly over the committed provider-directory.generated.json + its .meta.json sidecar and pins the guarantees the investor pages now claim: every provider's ZIP is exactly 5 US digits (the gate holds — zero foreign/garbage postals), ≥900 distinct ZIP-3 prefixes (coverage floor, ~930 today, with headroom for monthly wiggle), all 50 states + DC present, every NPI is 10 digits with a finite graphScore, menopause-certified providers retained (≥7 and all placeable), the row count stays within a sane server-bundle ceiling, and the sidecar metadata mirrors the array exactly (total / certified / zip3Prefixes / states can't drift from the data). Floors where a refresh legitimately moves the numbers, exact equality only where the sidecar must match the array. 277 frontend tests (7 new) + tsc green.",
        commits: [
          { sha: "b1b29a4", label: "provider-graph: pin committed-directory data-quality invariants" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: coverage-aware selection + US-ZIP gate — honest 930-prefix reach across all 50 states + DC",
        summary:
          "The national run held 2,000 real menopause-relevant providers, but they were the global top-N by graphScore — which piles into a handful of dense metros, so the committed directory covered only 532 ZIP-3 prefixes. Most ZIPs outside those metros dead-ended on general browsing and the relevant-local fallback even though the data to answer them was sitting right there. New opt-in --coverage mode in build.py (`_round_robin_by_zip3`) spends the same non-certified --limit budget for breadth instead of depth: bucket the non-certified survivors by ZIP-3 prefix, order buckets by their strongest provider, then round-robin one provider per bucket per round so every prefix that has anyone contributes its best candidate before any prefix gets a second. Then a data-quality pass made the metric honest: the first coverage run reported 1,055 'prefixes', but only 930 are real US numeric ZIP-3s — the other 125 were foreign practice addresses (Canadian 'A1B…', UK 'EC…'/'EH1…'), APO/FPO military codes, and truncated/garbage postals ('0', '44'). normalize_row now gates the directory to providers with a usable 5-digit US ZIP (138 non-placeable rows dropped), so every record can actually be local to a US patient and the coverage number is the real US count. Net: same 2,000-row budget, distinct-prefix coverage went 532 → 930 valid US ZIP-3s spanning all 50 states + DC. Certified providers are always kept (--keep-all-certified is orthogonal), so the agent's menopause=true coverage is identical and the demo personas still resolve to their curated local certified providers; --coverage is OFF by default so the old top-N callers and tests are untouched. refresh_national.sh passes --coverage by default (COVERAGE=0 opts out) and records `coverage: true` in the sidecar metadata; regenerated the committed national directory in place (2,015 providers, 15 certified, 930 ZIP-3 prefixes, sanctions unchanged at CA 588 / NY 849 / TX 283). 83 provider_ingest tests green (7 new: round-robin maximizes coverage / deepens by score / no-ops within budget / build wiring never narrows vs top-N; foreign + truncated ZIPs dropped; ZIP+4 kept & truncated) + ruff clean; 270 frontend tests + tsc green behind the unchanged provider contract.",
        commits: [
          { sha: "0d7191b", label: "provider-graph: coverage-aware non-certified selection (round-robin across ZIP-3)" },
          { sha: "24c5578", label: "provider-graph: gate directory to placeable US ZIPs (honest 930 ZIP-3 reach)" }
        ],
        status: "shipped"
      },
      {
        title: "Investor brief: /proposal/provider-graph rewritten for the Phase 2 shipped state",
        summary:
          "The provider-graph proposal page was reading like a plan when most of it had shipped. Rewrite closes the credibility gap. Header lead changes from \"Building a defensible menopause provider graph\" to \"...— Phase 2 shipped\" with a subtitle naming concrete counts: 2,015 providers, Census-ZCTA distance ranking, six NPPES board-cert + multi-specialty signals, three state license-sanction filters dropping 1,720 sanctioned candidates at build, synthetic-but-real-shaped insurance, /provider browseable UI. Today's Reality replaces \"what's wired vs. mocked\" prose with five verifiable numbers each pinned to provenance — a reader can curl /api/mulesoft/providers and confirm every count under provenance.dataset (CTA inline). Sources card grid grew 6 → 8: NPPES (now with 9.6M-row stream + 1m50s harness mention), Census 2020 ZCTA Gazetteer, state sanction overlays w/ all three states + the FL/NJ skip story, NPPES service-line signals w/ the capped-bonus rationale, insurance overlay marked synthetic-but-shape-live, clinic-site detection reframed as Phase 2-bis, licensed MSCP feed marked partnership-gated, outcomes future. New pill legend covers the `partial` (shape-live / value-pending) state. Scoring table 5 factors → 6: credential (prototype, union of MSCP overlay + self-reported NPPES MSCP/NCMP), service-line signals (NEW), license standing (prototype, filter not downweight — names the 3 overlays + the 1,720 build-time drops), geographic (prototype, real Haversine), insurance (NEW, partial w/ synthetic caveat), outcomes (future). Phases 4 → 5: Phase 0/1/2 all prototype (contract / NPPES pipeline / Phase-2 distance + signals + sanctions + insurance + UI + MuleSoft DataWeave), Phase 2-bis designed (clinic scraper + paid insurance feed — gated on need/partnership), Phase 3 future. Touch-the-architecture CTA leads with \"Browse the directory (UI)\" linking /provider?zip=92614&menopause=true; source-data row lists all 6 upstream public datasets directly (NPPES, Census ZCTA, CHHS S&I, NY OPMC, TX TMB, provider_ingest). Compliance posture reframed: public-domain substrate enumerated explicitly, sanctioned providers filtered not flagged. tsc + next build clean (108 KB page, registers static); smoke confirms all 10 sentinel-text counts present.",
        commits: [
          { sha: "e4e2c59", label: "proposal: rewrite /proposal/provider-graph for the Phase 2 shipped state" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: /provider browseable directory index (UI surface for the same contract)",
        summary:
          "Patient/maintainer-facing index page over the same queryProviderDirectory the agent and Care Router consume. Filters submit via a <form method=\"GET\"> so the URL is canonical (bookmarkable, refresh-safe, no client state, no hydration cost) — inputs: ZIP (drives both the 3-prefix filter AND the distance-ranking centroid lookup so users don't have to type it twice), insurance plan dropdown, MSCP-certified-only checkbox, fallback-ladder checkbox (defaults ON for browse so empty certified-local results don't dead-end), page size capped at 50. Each result card carries the now-familiar Phase-2 surface: name + specialty + city/state/zip + distance, certified vs relevant chip, new-patients status, service-line signals (board-cert OB/GYN, Women's Health NP, multi-specialty), top 4 insurance plan chips with \"+N more\" overflow. Names link to /provider/<npi>?from=<zip> so the patient ZIP rides through to the profile's distance chip. Header surfaces the response's sort and matchType so a reader can see which tier and ranking actually applied (\"20 of 247 providers · ranked by distance from your ZIP · matchType: certified-local\"). Empty states get explicit fallback links rather than dead ends. Provenance footer surfaces sources, generatedAt timestamp, and the per-source sanction-filter counts (\"CA: 588, NY: 849, TX: 283\") when present. /proposal/provider-graph's CTA now leads with \"Browse the directory (UI)\" linking here, with the raw Experience API JSON moved to a secondary button. Server-rendered on demand (force-dynamic) so searchParams flow through; smoke-tested: default page 86 KB / 20 cards / sort=score / matchType=all; ?zip=92614&menopause=true&plan=aetna → 2 providers (Anand + Okafor) with distance ranking and matchType=certified-local. 270 tests untouched (the page is a thin GET-form driver over already-tested logic). tsc + next build clean.",
        commits: [
          { sha: "bec49f7", label: "provider-graph: /provider browseable directory index" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: live /providers worker gets the full Phase-2 contract (matchType / signals / insurance / license / dataset)",
        summary:
          "The live Mule app (CloudHub 2.0 worker pause-mulesoft-health-v1, fronted by Flex Gateway) was still serving the pre-Phase-2 shape — 6 hand-curated providers, no lat/lng, no serviceSignals, no licenseStatus, no insuranceAccepted, no matchType / sort / dataset provenance — while the Next.js mock had moved on. This closes the live-vs-mock contract gap. providers-flow's DataWeave rewritten with a curated 9-row slice pulled from the committed provider-directory.generated.json (every demo persona resolves to a real certified-local provider; 2 relevant-local OB/GYN fallbacks for the tier ladder); each row carries the full Phase-2 field set including the synthetic insuranceAccepted draws. Tier ladder mirrors queryProviderDirectory line-for-line: certified-local → certified-national (no zip) → relevant-local (fallback only) → certified-remote (fallback only) → none. ?insurance=<plan> filter applied BEFORE the tier ladder so all tiers honor it. sort: \"score\" — the live worker doesn't carry the 33K-ZIP Census ZCTA centroid table (same lookup runs in the route handler instead), so it reports score-only ranking and leaves distanceMiles: null on each row; the route handler picks the higher-fidelity ranking when it has the centroid. provenance.dataset present for parity with generatedAt/sourceDate: null. README documents the two intentional differences (narrow demo slice + score-only ranking on live, national breadth + distance-aware on mock). OAS example bumped to show the full envelope; experienceApi @0.9 to match. 3 new vitest pin contract-shape parity: every record on the mock carries the full Phase-2 field set, response envelope carries the required top-level keys, and a hand-authored live-worker snapshot passes the same checks — drift either direction is caught at CI time. 270 frontend tests green; tsc clean. Deploy is the maintainer's next manual step.",
        commits: [
          { sha: "cf4a42d", label: "mulesoft: live worker /providers DataWeave gets the full Phase-2 contract" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: /provider/<npi> profile page surfaces the directory's per-provider data",
        summary:
          "Patient-facing surface for everything Phase 2 added. /provider/<npi> resolves a single ProviderRecord from the same directory the agent and Care Router consume (NPPES-derived generated JSON, curated fallback if not), then renders: hero name + specialty + city/state/zip; a chip row (certified vs menopause-relevant, accepting-new-patients, telehealth, distance \"4.2 mi from <zip>\" when ?from=<zip> resolves to a centroid AND the provider has lat/lng, license disposition); service-line signals chip block with plain-English labels (board-certified OB/GYN, Women's Health NP, multi-specialty, etc.); insurance-accepted chips with the synthetic-data caveat front and center (\"Synthetic — verify before booking\"); a provenance footer enumerating NPPES, MSCP overlay, sanctions filters (CA/NY/TX), graphScore composition, and distance source. Server component, force-dynamic so ?from=<zip> actually flows through (force-static would silently treat searchParams as undefined and the distance chip would never appear). Unknown NPIs return clean 404s via notFound() — sanctioned providers filtered at build time get the same 404, which is the right answer. New findProviderByNpi() helper exposes O(1) Map<npi,record> lookup against the directory; the Care Router trace span now carries `npi` per recommendation, so LatestCareRouterDecision links each name to its profile page (clicking a recommendation now opens the full profile). 267 frontend tests green (4 new on findProviderByNpi: hit, miss, null-safety, whitespace-trimming); tsc + MCP tsc + next build all clean. Tiny CSS addition: 5 profile-chip variants in globals.css patterned on the existing routing-acuity-chip color logic; no global style changes.",
        commits: [
          { sha: "ef517c8", label: "provider-graph: /provider/[npi] profile page surfaces the directory's per-provider data" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: TX sanctions overlay (Texas Medical Board active-disposition allowlist)",
        summary:
          "Third state-license safety filter — and the design decision was load-bearing. Texas Medical Board's DataSet-01-All Licenses (data.texas.gov tm3v-pfq9, ~507K rows) is the full TX licensee registry with structured Disciplinary Status + License Status columns, so we filter on disposition rather than enumerating disciplinary orders. The naive `!= NONE` would have dropped 9,475 providers — but auditing the dataset showed many of those values are CLEARED / DISMISSED / historical references (\"DISP. ACTION CLEARED\", \"COMPLAINT DISMISSED\", \"LICENSURE BOARD ORDER CLEARED\", \"LIC RESTRICTION REMOVED\", \"CLEARED BY ATTORNEY GENERAL\", \"SEE PREVIOUS ORDER\") whose presence does NOT mean a provider is currently sanctioned. Switched to an *allowlist* of explicit active-sanction values (SUSPENDED BY BOARD, REVOKED, UNDER BOARD ORDER, AUTOMATIC LICENSURE CANCELLED, etc.) → 2,071 sanctioned licenses, an honest filter rather than a noisy one. Currently-Licensed=N is also NOT a sanction signal: a provider who let their TX license lapse cleanly may be practicing under a clean license elsewhere. Reused the (state, license_num)-keyed cross-walk machinery NY introduced. CSV loader accepts both Title Case (web download) and snake_case (SODA API) headers via a small alias helper. BuildStats gained license_drops_by_state for per-state attribution under multi-state license-keyed overlays; CLI grew --sanctions-tx (auto-detected via SANCTIONS_TX / tx_tmb*licenses*.csv beside the NPPES zip); the summary line now reads \"CA filtered 588, NY filtered 849, TX filtered 283\". Real impact regenerating against the June 2026 TX drop: 1,720 total candidates filtered before sort/limit (588 CA + 849 NY + 283 TX); directory size unchanged at 2,015 (limit cap refills); 15 certified untouched; every demo persona intact. 76 provider_ingest tests green (4 new: allowlist excludes NONE/NONE clean rows + lapsed-clean rows; state-isolation across CA/NY/TX; per-source license attribution under TX + NY simultaneously). 263 frontend tests + tsc clean. NJ stays out — no structured public feed.",
        commits: [
          { sha: "43323e6", label: "provider-graph: TX sanctions overlay (Texas Medical Board allowlist)" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: NY sanctions overlay (license-number cross-walk via NPPES)",
        summary:
          "Second state-license safety filter — and it found 849 more candidates to drop. NY's data.ny.gov publishes the Professional Medical Conduct Board Actions dataset (ebmi-8ctw, 17,950+ rows since 1990) with license number + license type per action; NPI is NOT in the row, so the build cross-walks (NY, license_num) against each NPPES candidate's own Provider License Number_<i>/State Code_<i> columns during the same single pass that builds the directory. NJ skipped: disciplinary actions are PDFs scraped per-action, not a structured feed — not worth a brittle scraper. SanctionOverlay refactored to carry both NPI-keyed and (state, license_num)-keyed evidence with a merge() classmethod for the build's single pass; license-number normalization (whitespace/dashes/leading zeros/state casing) handles formatting drift between NPPES and OPMC; blank / \"000000\" rows skipped on load (NY's pre-issuance sentinel would otherwise match every blank-license NPPES record). extract_licenses() pulls all 15 NPPES license slots; build_directory collects each surviving candidate's licenses in a side-map during the same row visit, then applies both filters post-pass with separate npi_drops + license_drops counts on BuildStats. CLI gains --sanctions-ny; harness auto-detects ny_opmc-*.csv beside the NPPES zip; the CLI summary line reads \"CA filtered 588, NY filtered 849\". Sidecar metadata schema bumped to v2: per-source overlay paths under `sanctionsOverlays`, per-source drop counts under `providers.sanctionedFilteredBySource`. Frontend dataset provenance + OAS document both. Legacy single-overlay key still parses for older sidecars. Real impact regenerating against the May 2026 NY drop: 588 CA-NPI + 849 NY-license = 1,437 candidates filtered before sort/limit; directory size unchanged at 2,015 (limit cap refills with the next eligible providers); 15 certified untouched. 72 provider_ingest tests green (6 new); 263 frontend tests green; tsc clean.",
        commits: [
          { sha: "6d43e5f", label: "provider-graph: NY sanctions overlay (license-number cross-walk via NPPES)" }
        ],
        status: "shipped"
      },
      {
        title: "Salesforce: version-control Pause_Patient_Insurance__c so the live agent can read the plan in-band",
        summary:
          "Mirrored the Patient_Zip prechat plumbing one field over so the live Agentforce embed can pass the patient's insurance plan in-band the moment Patient_Insurance is registered on the deployment's prechat form. Tracked metadata, deployable via `./salesforce/deploy.sh trailsignup`: MessagingSession.Pause_Patient_Insurance__c (Text, 32) with a description flagging insuranceAccepted as synthetically derived (\"soft filter, not guarantee\" reads first); Pause_Intake_Prechat_Router flow gains the Patient_Insurance String input variable + recordUpdate inputAssignment writing it onto the existing Write_Dossier_To_Session step (description bumped 20 → 21 dossier fields); Messaging_for_In_App_Web channel gains a Patient_Insurance customParameter; Pause_Health_Intake_Prechat_Dossier permission set grants FLS read+edit on the new field; both manifest/package.xml (deploy subset) and manifest/package-complete.xml (full retrieve) list the new field alongside Pause_Patient_Zip__c; deploy.sh inventory comment and the salesforce/README.md track-table updated. Org-managed remainder (Agent Builder UI, runbook documents the clicks): bot context variable Pause_Patient_Insurance, findMenopauseProviders action insurance input binding to $Context.Pause_Patient_Insurance, prechat-form hidden-field registration, agent reasoning template (\"only ask when context is empty; surface match provisionally\"). Repo-side wiring was already complete from last week's commit so the Care Router, /api/intake/prechat-context, intake-patient-stage, and demo-cohort tests are unchanged. XML well-formed, no comments in deployable files (the trap that broke a Patient_Zip deploy back in c7895a0 and stays documented in the README). Frontend tsc + 263 vitest unchanged.",
        commits: [
          { sha: "0f304ec", label: "salesforce: deploy Pause_Patient_Insurance__c (parallel to Pause_Patient_Zip)" }
        ],
        status: "shipped"
      },
      {
        title: "Intake: capture patientInsurance and thread it end-to-end through the demo",
        summary:
          "The provider directory already accepted ?insurance= and the Care Router already read intake.patientInsurance, but nothing populated the field in the live demo flow — so the synthetic insurance overlay was invisible to anyone exercising the demo. This wires it up. Each of the six demo cohort entries gains a patientInsurance plan picked from its local MSCP-certified provider's insuranceAccepted list (Anika→Aetna, Brianna→BCBS, Carmen→Medicare, Deepa→BCBS, Elena→BCBS, Fatima→UHC) so the filter actually surfaces a local provider rather than silently emptying the directory; a new demo-cohort.test invariant pins this against the live committed directory so a future synthesis drift can't break the demo without the test telling future-me to re-pick from the local provider's accepted list. The AgentforceFallback intake gains an optional \"Which insurance do you have?\" step (8 canonical plans + Skip; blank → undefined, never an empty-string filter); the captured plan flows through to the existing Care Router handoff and into RoutingDecision.recommendedProviders.query.insurance, which the rationale line already calls out (\"...accepting Aetna...\"). The live Agentforce embed gets a parallel hidden prechat field — /api/intake/prechat-context emits Patient_Insurance alongside Patient_Zip, intake-patient-stage forwards both when a persona is selected, and the Agentforce runbook gains an \"Auto-passing the insurance plan\" section with the same six-step Salesforce-side wiring pattern + an agent reasoning template that frames the match as a soft filter (not a guarantee) since insuranceAccepted is synthetic today. Until Patient_Insurance is registered + mapped on the org, the SDK drops it gracefully and the agent just asks. 263 frontend tests green (3 new on demo-cohort), tsc clean.",
        commits: [
          { sha: "64770ec", label: "intake: capture patientInsurance and thread it end-to-end through the demo" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: insurance-acceptance overlay + ?insurance= filter (synthetic, real-shaped)",
        summary:
          "There's no public, free, structured payer/in-network feed available; a real insurance match needs a paid data partnership (Ribbon Health, Turquoise) or per-payer contracts. So this overlay is deterministic and synthetic — but every other layer is real, so when a partner feed lands the entire stack swaps in place. New module insurance.py derives `insuranceAccepted: list[str]` from a stable SHA-256 hash of each NPI; per-plan probability draws are decorrelated by salting the hash with the plan name; thresholds match real-world physician participation (Medicare ~85%, Kaiser ~20%, commercial plans 30-50%) so the population distribution looks plausible. Output is canonical-order, deterministic across rebuilds, never empty (Medicare is the conservative floor). Regenerated 2,015-row directory: medicare 85% / medicaid 67% / bcbs 51% / aetna 50% / uhc 44% / cigna 36% / humana 31% / kaiser 20%; ~3.8 plans per provider. Plumbed end-to-end: queryProviderDirectory gains an `insurance` filter applied BEFORE the tier ladder (so all tiers honor it consistently — we never broaden insurance just because the strict tier is empty); normalizeInsurancePlan() handles user-typed synonyms (\"United\" → \"uhc\", \"Blue Cross\" → \"bcbs\"); unknown plans yield zero results honestly. /api/mulesoft/providers picks up ?insurance=, OAS documents the field as an array of canonical tokens with the synthetic-data caveat, MCP find_menopause_providers gains an insurance input + framing that tells the agent to surface plan info provisionally rather than as ground truth. Care Router IntakeRecord gains patientInsurance; attachRecommendedProviders forwards it to the lookup, RecommendedProvider carries insuranceAccepted through to the agent fabric trace, and the LatestCareRouterDecision UI renders plans as small grey pill chips (\"+N more\" when capped at 4). Rationale line now reads \"...accepting Aetna near 92614...\" when a plan filter applied. Provenance.sources on every Experience API response explicitly says \"Insurance acceptance is synthetically derived per-NPI\" so consumers (humans + agents) see the caveat without reading the runbook. experienceApi @0.9. 66 provider_ingest tests green (6 new); 260 frontend tests green (7 new). frontend + MCP tsc clean. Phase 2's insurance match is now patient-facing; replacing the synthesis with a paid feed is a one-module swap.",
        commits: [
          { sha: "8eaefe5", label: "provider-graph: insurance-acceptance overlay + ?insurance= filter (synthetic, real-shaped)" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: filter sanctioned providers (CA Medi-Cal Suspended & Ineligible list)",
        summary:
          "First state-license safety filter — and it found real candidates to drop. The California Health & Human Services Agency publishes the Provider Suspended and Ineligible List (Medi-Cal S&I) as a free, public-domain CSV refreshed monthly at data.chhs.ca.gov, enumerating every provider barred from Medi-Cal participation (physicians, RNs, pharmacies, clinics). New module sanctions.py loads the CSV → set of suspended NPIs (\\b\\d{10}\\b regex over the free-text 'Provider Number' column; state license IDs like 'PHA999999' don't false-positive). build_directory drops every matching NPI before sort/limit and tracks the drop count as part of a new BuildStats return; the original build_directory signature is preserved so existing callers and tests don't break. ProviderRecord gains licenseStatus (default 'active') so the contract documents what was checked; the OAS schema mirrors it as an enum. Sidecar metadata gains sanctionsOverlay (the path applied) and providers.sanctionedFiltered (the drop count), surfaced under provenance.dataset on every Experience API response (experienceApi @0.8) — /api/mulesoft/providers now carries both freshness AND safety-filter provenance. The harness auto-discovers the latest suspended-ineligible-list-*.csv beside the NPPES zip and forwards --sanctions to the build. Real impact: regenerating the committed national directory with the May 2026 CHHS list filtered out 588 post-taxonomy candidates who were on California's suspended-ineligible roster — providers who would otherwise have surfaced in the relevant-local tier. Total directory size unchanged at 2,015 (the limit cap pulls in the next eligible non-sanctioned providers); 15 certified untouched; every demo persona's local certified provider intact. 60 provider_ingest tests green (5 new: regex precision, empty overlay no-op, build filters + stats, license-status default). 253 frontend tests green (2 new: provenance.dataset surfaces sanctioned counts; every loaded provider has licenseStatus active or undefined). tsc clean. Phase 2 starts where the demo cohort lives — other states will land additively behind the same overlay interface.",
        commits: [
          { sha: "4deb884", label: "provider-graph: filter sanctioned providers (CA Medi-Cal S&I list)" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: tracked refresh harness + sidecar build metadata so the directory is honestly dated",
        summary:
          "Replaced the ad-hoc .scratch/run_national*.sh files (gitignored, easy to lose) with a tracked provider_ingest/scripts/refresh_national.sh that one-shots the monthly refresh: auto-discovers the latest NPPES_Data_Dissemination_*.zip, picks the npidata_pfile member from the zip manifest, streams it through a FIFO (no extraction; ~1m50s end-to-end), cleans up on any exit, and supports --dry-run for inspection. Override defaults via NPPES_ZIP / NPPES_OUT / NPPES_LIMIT env vars. pause-provider-build gained a sidecar metadata writer: every build emits a <out>.meta.json next to the bare-array directory JSON (the array contract is unchanged — every existing consumer keeps working). The sidecar carries generatedAt (wall-clock), sourceDate (the NPPES zip's mtime — what the dataset actually reflects, not when the build ran), nppesInputs/mscpOverlay (so a build is reproducible), limit/keepAllCertified (the flags used), and providers.{total,certified,states,zip3Prefixes}. mulesoft-mocks loads the sidecar at module init and surfaces it under provenance.dataset on every /api/mulesoft/providers response; the OAS spec documents the field as nullable (null when only the curated fallback is in use). The Experience API can finally answer the question \"how fresh is this directory?\" honestly — sourceDate is the answer, not generatedAt. 55 provider_ingest tests green (6 new: metadata shape + roundtrip, ISO-UTC mtime helper, end-to-end main writes both files, default --meta path). 251 frontend tests green (1 new: dataset provenance is surfaced and consistent with the array). tsc clean.",
        commits: [
          { sha: "4414739", label: "provider-graph: tracked refresh harness + sidecar build metadata" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: broaden the curated NUCC taxonomies — and find a missing certified provider in the process",
        summary:
          "The curated menopause-taxonomy set was OB/GYN-heavy by construction, which meant a small number of menopause-relevant clinicians were silently dropped at the taxonomy filter. Added six NUCC codes that close real gaps: Urogynecology & Reconstructive Pelvic Surgery (relevance 0.95 — directly addresses GSM, pelvic floor, urinary symptoms), Gynecologic Oncology (0.78 — postmenopausal-bleeding red-flag context), Internal Medicine — Geriatric Medicine (0.68), NP — Gerontology (0.72), NP — Adult Health (0.66), and CNS — Gerontology (0.66). Relevance weights are calibrated so OB/GYN (1.00) still outranks all six — pinned by a new test — so the certified-local / relevant-local tiers still prefer OB/GYNs at the same baseline. The bulk of the broadening lands in ZIP-specific relevant-local fallback, exactly where it's needed. Real impact, not abstract: regenerating the national directory against the broader set surfaces ONE NEW MSCP-certified provider who was being silently filtered out — Dr. Lindsey Mehran-Rezaii, NP — Gerontology, MSCP (Apple Valley, MN). She self-reports MSCP in NPPES, but her primary code (363LG0600X) wasn't in our curated set, so the taxonomy filter dropped her. Adding the code fixes a correctness gap, not just coverage. Counts move from 14 → 15 certified and 28 → 38 non-OB/GYN providers; total 2,014 → 2,015. 49 provider_ingest tests green (2 new); 250 frontend tests untouched; tsc clean.",
        commits: [
          { sha: "978561d", label: "provider-graph: broaden NUCC menopause taxonomies (urogyn + geriatric care)" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: NPPES service-line signals sub-rank the relevant-local tier",
        summary:
          "Beyond the binary MSCP/NCMP credential, the pipeline now detects six public-registry signals from the NPPES record and stamps them onto every provider as serviceSignals: a small list of tokens (facog, faafp, face, whnp, cnm, multi-taxonomy) that suggest a non-certified provider actually delivers menopause-relevant care. Each signal feeds a +2% graphScore bump capped at +5% total — bounded so a non-certified provider with all signals still falls behind a certified provider at the same baseline, so the binary credential remains the strongest evidence. The tokens are evidence-based, not synthetic: facog/faafp/face are board-certification fellow tokens self-reported in NPPES \"Provider Credential Text\", whnp and cnm are the NUCC women's-health and midwifery roles, and multi-taxonomy fires when the provider lists ≥2 NUCC codes from the curated menopause set (e.g. OB/GYN + Reproductive Endocrinology). In the regenerated June 2026 national run, 435 of 2,014 providers (22%) carry at least one signal — primarily multi-taxonomy (421), with cnm (9), whnp (6), facog (3), faafp (2) rounding it out. The relevant-local tier is now sub-ranked honestly: a board-certified OB/GYN with FACOG outranks a generalist sharing the same taxonomy. Plumbed end-to-end: ProviderRecord gains serviceSignals (Python + TS, OAS additive), graph_score takes a service_signal_count, the MCP find_menopause_providers description tells the agent to surface the strongest signal in plain English when matchType=relevant-local, the Care Router's RecommendedProvider carries the signals through to the agent-fabric trace span, and the /demo dashboard's LatestCareRouterDecision card renders them as small \"Board-cert OB/GYN\" / \"Women's Health NP\" pill chips next to each recommendation. 250 frontend tests green, 47 provider_ingest tests green (7 new signal-detection tests + 2 new score-cap tests); frontend + MCP tsc clean.",
        commits: [
          { sha: "2d378ce", label: "provider-graph: NPPES service-line signals sub-rank the relevant-local tier" }
        ],
        status: "shipped"
      },
      {
        title: "Care Router: MSCP recommendations now show distance from the patient — and rank by it",
        summary:
          "The new ZCTA-centroid distance ranking is wired through to the Care Router's MSCP provider recommendations and surfaced in the UI. attachRecommendedProviders now resolves the patient's ZIP to a Census centroid and passes it through the ProviderLookup contract, so queryProviderDirectory ranks the candidate pool by Haversine distance ascending (graphScore desc tiebreak) before rankForModality re-orders within that for telehealth-vs-in-person preference. RecommendedProvider gained an optional distanceMiles, the rationale line reports which ranking actually applied (\"ranked by distance from the patient's ZIP\" vs \"ranked by graph score\") so the agent-fabric trace tells the truth, and the trace span itself carries a richer recommendedProviders attribute (name, specialty, city, state, telehealth, distanceMiles) alongside the legacy recommendedProviderNames array — older trace consumers still parse, newer ones get the full shape. The /demo dashboard's LatestCareRouterDecision card reads the rich attribute (with a graceful fallback to the legacy strings for traces written before this commit) and renders inline metadata next to each recommendation: e.g. \"Dr. Helen Okafor · OB/GYN (Newport Beach, CA · 4.2 mi away · telehealth)\". 250 frontend tests green (2 new: zipCentroid forwarded + distanceMiles propagated end-to-end, score-only rationale fallback when no centroid resolves); tsc clean.",
        commits: [
          { sha: "9a4ea19", label: "care-router: propagate distance through MSCP recommendations + UI" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: real distance ranking — providers come back sorted by miles from the patient ZIP",
        summary:
          "The directory now ranks by Haversine distance from the patient's ZIP whenever its centroid is known, instead of leaning on the ZIP-3 prefix tier as a proxy for proximity. The Census 2020 ZCTA Gazetteer (public domain, ~1 MB) is parsed into a {zip5: [lat, lng]} map by a new provider_ingest.centroids module and committed twice: once into the wheel-bundled provider_ingest/data/zip_centroids.json (so the build pipeline stamps latitude/longitude on every NPPES row whose ZIP has a ZCTA centroid — 1,931 of 2,014 in the June 2026 run, 96%) and once into frontend/lib/zip-centroids.generated.json (so a tiny server-only loader resolves the patient's query ZIP at request time). queryProviderDirectory grew an opt-in zipCentroid arg: when a centroid is supplied AND at least one in-tier provider has its own coordinates, every returned row gets a distanceMiles (rounded to 0.1 mi — false precision past that, since centroids are area middles, not addresses), the rows sort distance asc with graphScore desc as the tiebreak, and a new top-level sort field reports which ranking actually applied (\"distance\" vs \"score\"). Providers with no centroid (rare PO-box-only / very new ZIPs) get distanceMiles: null and slide to the end honestly. The tier ladder (matchType) is unchanged — distance is a within-tier sort, so certified-local still wins over relevant-local even when the latter is geographically closer. /api/mulesoft/providers wires the centroid in by default (?distance=false to opt out for callers that need the prior score-only ordering); the prefer-real client forwards the centroid (the live Mule app still ranks by score until its DataWeave is updated, which is fine because the agent reads sort=score and degrades cleanly). The OAS contract gained Provider.latitude / longitude / distanceMiles + a sort enum + a distance query param — all additive, so the registered Salesforce External Service still validates with no re-import. The MCP find_menopause_providers tool description and per-call summary now teach the model to read sort and report distance to the patient (\"about 4 miles away\") when present. 248 frontend tests green (4 new distance tests covering: distance ranking when centroid present, score-only fallback when not, null-distance providers slide to the end, Haversine sanity Irvine→Brooklyn ≈ 2,436 mi); 35 provider_ingest tests green (2 new centroid-stamping tests); frontend + MCP tsc clean.",
        commits: [
          { sha: "fd6321a", label: "provider-graph: distance ranking from Census ZCTA centroids" }
        ],
        status: "shipped"
      },
      {
        title: "Provider directory UI: the graceful fallback is now visible to humans, not just the agent",
        summary:
          "The /provider directory already consumed the new matchType field, but only as a muted one-line footnote — so the honest fallback framing the agent gets was invisible to anyone browsing the site. It now renders a clear, tier-aware banner above the results. The fallback tiers get a prominent brand-accented notice that names the patient's ZIP and distinguishes menopause-EXPERIENCED from CERTIFIED: relevant-local reads 'No menopause-certified providers in the 33101 area, so we're showing nearby menopause-experienced clinicians (not certified)'; certified-remote reads 'No providers in the 00601 area, so we're showing menopause-certified specialists elsewhere who offer telehealth'. The happy path (certified-local / certified-national) stays quiet with a subtle positive label, and zero-result searches get a clear no-match banner with widen-search links. New .match-banner styles (ok / info / empty tones) reuse the existing pink/green/muted palette and collapse responsively. frontend tsc + 270 tests + eslint all green.",
        commits: [
          { sha: "19978c9", label: "provider UI: per-tier match banner so the fallback is visible to humans" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: graceful provider fallback — any ZIP now gets a useful, honestly-labeled answer",
        summary:
          "The national NPPES run exposed a gap: the agent queries menopause=true, but self-reported MSCP/NCMP is rare (~7 nationally), so a patient outside the demo metros got an empty result while 2,000 real menopause-relevant providers sat invisible behind the certified filter. queryProviderDirectory now supports an opt-in tiered fallback that reports which tier answered via a new matchType field: certified-local (certified specialists in the ZIP-3 area — the happy path), relevant-local (no local certified, so nearby menopause-EXPERIENCED but non-certified clinicians), certified-remote (nothing local, so telehealth-capable certified specialists nationally), plus certified-national / local / all / none. Crucially the fallback is OFF by default — the Care Router's 'MSCP-credentialed' recommendation and the demo's strict certified-local invariant are untouched — and the agent-facing Experience API (/api/mulesoft/providers) opts in (?fallback=true, default-on, with a ?fallback=false escape hatch). It's plumbed through the live MuleSoft client (fetchLiveProviders / getProvidersPreferReal) and the MCP find_menopause_providers tool, whose summary + description now instruct the model to present each tier honestly (relevant-local as 'menopause-experienced, not certified'; certified-remote as 'no local match, these offer telehealth'). The OAS contract was extended additively (optional matchType + fallback param) so the already-registered Salesforce External Service still validates with no re-import, and the Agent Builder topic instructions were rewritten for honest matchType framing. 244 frontend tests green (7 new tiered-fallback tests, derived from the committed directory so they survive data regens); frontend + MCP tsc clean.",
        commits: [
          { sha: "0a3b620", label: "provider-graph: graceful provider fallback so any ZIP gets a useful, honest answer" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: version-controlled the Salesforce org + shipped a real national NPPES run (honest MSCP detection)",
        summary:
          "Two infrastructure passes on the provider/agent stack. (1) Phase 18b — the Agentforce intake/provider metadata is now a real, version-controlled salesforce/ SFDX project (sfdx-project.json + force-app + manifest + deploy.sh/retrieve.sh + README), replacing the throwaway .sf-deploy/ scaffold and the ad-hoc /tmp retrieves; the duplicate Named Credential was reconciled and the runbooks point at the new layout. The deployable subset (named credential, MessagingSession.Pause_Patient_Zip__c, routing flow, messaging channel, permission set) is tracked; the remaining ~20 dossier fields + the Agent (Bot/GenAiPlannerBundle) stay org-managed and are one retrieve.sh away. (2) Provider-graph — the NPPES ingest now earns real menopause-certified coverage honestly: independent of the synthetic overlay, nppes.py flags a provider menopauseCertified when they self-report MSCP (or its former name NCMP) in the NPPES 'Provider Credential Text' field — a real public-registry signal, not a fabricated credential — and build.py accepts multiple --nppes inputs that merge + de-dupe by NPI, so the national npidata_pfile can be combined with the demo fixture in one run (demo personas stay green, every other ZIP gets real coverage). No contract, agent, or Care-Router change needed; menopause=true keeps meaning certified. Then the national run actually shipped: the CMS June 2026 npidata_pfile (8.5M rows) streamed through the pipeline and the result is now the committed directory — 2,014 providers, of which 14 are menopause-certified: the 7 demo personas plus 7 REAL practitioners who self-report MSCP/NCMP in NPPES (CA, IA, ID, MN, NC×2, NJ), with 2,000 real non-certified providers across 55 states / 534 ZIP-3 prefixes for general browsing. Three changes made that correct + fast: the reader now parses only the ~40 columns it needs (csv.reader, not a 330-column DictReader) so the full file runs in ~1m45s instead of ~30 min; NPI-collision merge switched to 'later input wins' (demo fixture listed last) so personas stay green even where their real-format NPIs also exist nationally; and a new --keep-all-certified flag means --limit caps only the non-certified breadth and never drops a certified provider (the agent queries menopause=true). Verified all 6 demo persona ZIPs return identical certified results vs the prior dataset; provider_ingest 33 tests + ruff green, frontend tsc + 23 provider tests green. Honest finding, documented in the runbook + provenance: self-reported MSCP/NCMP is rare in NPPES (~7 nationally), so dense certified coverage outside the demo metros still needs the licensed Menopause Society feed — the non-certified rows give the directory real national breadth in the meantime.",
        commits: [
          { sha: "cbb760f", label: "salesforce: version-control org metadata into a canonical SFDX project (Phase 18b)" },
          { sha: "f63c582", label: "provider-graph: honest MSCP/NCMP credential detection + national-ready merge" },
          { sha: "5b67376", label: "provider-graph: ship national NPPES run behind the contract (2,014 providers)" }
        ],
        status: "prototype"
      },
      {
        title: "The Agentforce agent auto-uses the intake ZIP — live + verified on trailsignup",
        summary:
          "The 'Find a Provider' subagent now reads the patient's ZIP straight from the intake context and returns local specialists without ever asking — verified end-to-end on the live trailsignup embed: persona Anika Patel (92614) → 'find a provider that specializes in menopause' → Dr. Helen Okafor DO MSCP (Newport Beach) + Dr. Priya Anand MD FACOG MSCP (Irvine), both 926-prefix Orange County, no New York / LA national fallback, and no ZIP question. This finally lit up the hidden-prechat pipeline that had been dormant since Phase 18c (the V2 Embedded Messaging prechatAPI used to be a no-op Proxy; it's now a real implementation that validates field names). Repo side: the embed re-enables the one field (agentforce-embed.tsx + /api/intake/prechat-context send Patient_Zip from the selected persona), and the Salesforce handoff stack deployed to trailsignup (Deploy ID 0AfHp00003ocxqYKAQ, 5/5) — a MessagingSession.Pause_Patient_Zip__c Text(16) field, a Patient_Zip input + Update Records on the Pause_Intake_Prechat_Router routing Flow, the Patient_Zip customParameter + parameter mapping on the Messaging_for_In_App_Web channel, and FLS via the Pause_Health_Intake_Prechat_Dossier permission set. Org side: included Pause_Patient_Zip on the agent's Messaging Session context variable, bound the PauseProviderDirectory action's zip input to it, rewrote the Find-a-Provider reasoning to use context-then-ask, and activated Agent Version 4. Two gotchas worth their weight: (1) MessagingChannel metadata has no element for 'allowed file types', so any deploy with attachments on fails the 'Allowed file types can't be null' validation — disabled inbound attachments on the channel (intake never uses them); (2) the actual blocker was that the Embedded Service Deployment had to be re-Published after adding the hidden field — setHiddenPrechatFields reported 'applied' the whole time, but the value only reached the routing Flow once the deployment was published and the ~5-15 min CDN propagation finished. Full wiring + both gotchas in docs/PHASE_3_RUNBOOK.md (Phase 18d).",
        commits: [
          { sha: "f4a1654", label: "agentforce: ship auto-ZIP to Find-a-Provider (verified live on trailsignup)" }
        ],
        status: "shipped"
      },
      {
        title: "The Agentforce agent can now find providers — live on trailsignup",
        summary:
          "The live Pause_Health_Intake_Agent used to deflect on \"find a provider that specializes in menopause\" — it was a generic intake-only Service Agent with no action wired to the Pause provider graph. It now answers for real. The fix shipped in two halves. Repo side (no Apex needed, because /api/mulesoft/providers is a public no-auth GET): a lean External-Services-compatible OpenAPI 3.0 spec (operation findMenopauseProviders, stripped of $ref/oneOf/nullable/auth so the parser accepts it), a no-auth Named Credential pointing at https://pause-health.ai deployed via a throwaway SFDX harness, and a runbook with paste-ready Agent Builder copy. Org side, on trailsignup: registered the PauseProviderDirectory External Service from the spec, added a \"Find a Provider\" subagent to the agent with the findMenopauseProviders action (inputs agent-populated from descriptions — menopause=true, limit=3, zip asked of the patient), pasted the reasoning instructions, and activated Version 3. Verified end-to-end in Agent Builder Preview: \"find a provider that specializes in menopause near 92614\" → Agent Router transitions to Find a Provider → calls the action with zip=92614/menopause=true/limit=3 → returns two real NPPES-derived MSCP clinicians (Dr. Helen Okafor DO MSCP, Newport Beach; Dr. Priya Anand MD FACOG MSCP, Irvine) with telehealth + accepting-new-patients status → Output Evaluation: GROUNDED. Known limit: the embed's prechat is a no-op, so the agent asks the patient for their ZIP rather than reading the intake ZIP in-band; coverage tracks the demo fixture's ZIP prefixes until provider_ingest runs against the national NPPES file (same action, no agent change).",
        commits: [
          { sha: "6d89fbd", label: "agentforce: stage provider-lookup action (External Service + Named Credential + runbook)" },
          { sha: "8632f6f", label: "changelog + runbook: paste-ready agent copy" },
          { sha: "7245d47", label: "agentforce: SFDX deploy harness for the Named Credential" }
        ],
        status: "shipped"
      },
      {
        title: "Intake captures ZIP so MSCP recommendations are local",
        summary:
          "Closed the loop on the Care Router provider wiring: intake now captures an optional patient ZIP, so the MSCP recommendations narrow to the patient's area instead of falling back to top-national matches. The scripted intake assistant (agentforce-fallback) asks for a 5-digit ZIP right after the name step — optional, ZIP-validated, and sent as undefined when blank so an empty value never filters the directory. DemoPersona gained a patientZip and each of the six personas got a ZIP whose 3-digit prefix maps to an MSCP-certified clinician in the NPPES-derived directory, so the four personas that route to an MSCP pathway (Anika, Brianna, Elena, Fatima) now surface a local specialist. personaToCareRouterIntake forwards the ZIP; the intake telemetry span records patientZipProvided. Transport needed no change — the handoff already forwards the whole IntakeRecord. New demo-cohort.test pins that every persona ZIP resolves to at least one local certified provider; full frontend suite 237/237 green.",
        commits: [
          { sha: "22b7dff", label: "intake: capture patientZip to geo-narrow MSCP recommendations" }
        ],
        status: "prototype"
      },
      {
        title: "Care Router wiring: the provider graph now feeds triage",
        summary:
          "The NPPES-backed provider directory is no longer just a demo surface — it feeds the Care Router. When the router lands on an MSCP pathway (virtual or in-person), route() now enriches the RoutingDecision with a ranked recommended-provider list pulled from getProvidersPreferReal (live MuleSoft Experience API when MULESOFT_PROVIDERS_BASE_URL is set, otherwise the in-process NPPES-derived directory). The list is re-ranked for modality (telehealth-capable first for virtual visits, accepting-new-patients first for in-person), capped at three, and narrowed to the patient's ZIP when intake carries one. Enrichment is best-effort and never throws — a provider-graph failure leaves the routing decision intact. The recommendations flow through the existing A2A RoutingDecision artifact, the Agent Fabric trace span (recommendedProviderCount / source / names), and a new 'Provider graph · MSCP recommendations' block on the live decision card at /demo/routing. RoutingDecision gained an optional recommendedProviders field and IntakeRecord an optional patientZip; 7 new care-router tests (modality ranking both ways, ZIP passthrough, empty-directory omit, failure-never-throws, route() enrichment). Full frontend suite: 234/234 green.",
        commits: [
          { sha: "09bb6f9", label: "care-router: attach NPPES provider recommendations to MSCP pathways" }
        ],
        status: "prototype"
      },
      {
        title: "Provider graph Phase 1: real NPPES taxonomy filter behind the frozen contract",
        summary:
          "The provider directory is no longer a hand-curated slice. New provider_ingest package (pure standard library) streams the CMS NPPES bulk schema, filters on the real menopause NUCC taxonomy codes (OB/GYN 207V*, Reproductive Endocrinology, Endocrinology 207RE0101X, Family + Internal Medicine, NP — Women's Health 363LW0102X, CNM, PA, Women's-Health CNS — each carrying a relevance weight), overlays an MSCP credential list, and computes a deterministic graphScore (relevance + accepting-new-patients + telehealth + completeness, × MSCP boost). It emits frontend/lib/provider-directory.generated.json, which queryProviderDirectory() now loads behind the unchanged /api/mulesoft/providers contract — the hand-curated rows survive only as a fallback, and provenance.sources reports \"CMS NPPES (taxonomy-filtered via provider_ingest)\". The committed dataset is the pipeline run over a synthetic NPPES-format fixture (real schema + real codes, with an org row and an orthopaedist correctly filtered out); pointing pause-provider-build at the national npidata_pfile produces the full ~80K-row slice with zero contract change. NPPES has no accepting/telehealth field, so those are derived deterministically from the NPI for the demo, and the MSCP list is synthetic until the Menopause Society feed lands — both called out honestly on /proposal/provider-graph. 25 provider_ingest tests + ruff green; frontend tsc + 23 provider tests green. Run + verify steps in docs/PROVIDER_GRAPH_PHASE_1_RUNBOOK.md.",
        commits: [
          { sha: "7fa9973", label: "provider-graph: Phase 1 NPPES ingest behind the frozen contract" }
        ],
        status: "prototype"
      },
      {
        title: "Data 360 Phase 2 activated end-to-end on production",
        summary:
          "Authored and activated three Data Cloud Calculated Insights on the trailsignup org over ssot__Individual__dlm (the Contact_Home data stream's first ingestion failed; Individual was already populated with 1168 records incl. all six demo personas). data-cloud.ts was aligned with the live CI surface: __cio-suffixed API names, unified_id__c dimension, __c-suffixed metric columns, and the [field=value] CI filter syntax. The real fixes: (1) the CI query endpoint is GET /api/v1/insight/calculated-insights/{ci}?filters=[...], not the /insight/query?insight_api_name=... shape the code shipped with; (2) Data Cloud requires a two-legged token flow — the core client_credentials token must be exchanged at POST <instanceUrl>/services/a360/token (grant_type urn:salesforce:grant-type:external:cdp) for a DC-scoped token, and the c360a gateway rejects un-exchanged tokens with a bare 400. Added requestDataCloudToken()/getDataCloudToken() with its own cache; dcFetch now targets the authoritative tenant instance_url from the exchange. SF_DC_TENANT_URL set on Production/Preview/Development in Vercel. Verified live: anika-patel grounding returns the three wearable insights (z-score -0.3 / burden 47.5 / disruption 0.43) with 30d/30d/7d windows.",
        commits: [
          { sha: "1a441a3", label: "data-cloud: add the required Data Cloud token exchange" },
          { sha: "61736a3", label: "data-cloud: fix CI Query API endpoint shape" },
          { sha: "1901f90", label: "data-cloud: align constants + filter expression with live trailsignup CIs" },
          { sha: "feda3d4", label: "docs: mark Phase 2 Data Cloud activation SHIPPED + record gotchas" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 9, 2026",
    headline: "MuleSoft iterations 3–7: Flex Gateway live, JWT auth, OAS spec, rate limiting, stable tunnel",
    intro:
      "Five iterations landed in a single session. Flex Gateway (Docker + ngrok) is running with runtime enforcement active — 401 on missing/invalid JWT, 429 on rate limit exceeded. Auth0 M2M client credentials grant issues RS256 tokens; the Next.js proxy caches and forwards them automatically. Plain Rate Limiting (10 req/min global) replaced the SLA-based policy after a BadArgument conflict with JWT. The OAS 3.0 spec is published to Exchange as a REST API asset with interactive docs. ngrok static domain is pinned in docker-compose so the tunnel URL survives restarts. Policy stack: JWT Validation + Rate Limiting (plain).",
    entries: [
      {
        title: "MuleSoft iterations 3–7: Flex Gateway, JWT, OAS 3.0, rate limiting, stable tunnel",
        summary:
          "Iteration 3: Flex Gateway deployed as Docker + ngrok proxy, registered with Anypoint as Omni Gateway instance (ID 20955827), Client ID Enforcement policy applied — first live runtime enforcement (401 on unauthenticated requests). Iteration 4: Rate Limiting SLA (10 req/min Demo tier) added; Next.js proxy updated to send dual auth headers (Basic Auth + client_id/client_secret custom headers) because DataWeave Base64 decode is unsupported in Flex Gateway policy sandbox. Iteration 5: OAS 3.0 spec (mulesoft/pause-provider-experience-api.oas3.yaml) written and published to Exchange as pause-provider-experience-api-spec v1.0.0 (REST API type — separate from the HTTP API asset). Iteration 6: ngrok free static domain (cattail-reactive-sassy.ngrok-free.dev) pinned in docker-compose.yml with --domain flag. Iteration 7: JWT Validation policy (Auth0 RS256/JWKS, audience-validated, expiry mandatory) replaces Client ID Enforcement; Rate Limiting SLA replaced with plain Rate Limiting (SLA-based policy caused BadArgument when JWT present — contract lookup incompatible); Auth0 M2M app pause-prototype-client configured with Client Credentials grant; frontend/lib/mulesoft/auth.ts added for 24h token caching; both health.ts and providers.ts updated to send Authorization: Bearer <jwt> with Basic Auth fallback; AUTH0_MULESOFT_* vars set in Vercel; OAS spec updated to v1.0.2 with bearerAuth security scheme.",
        commits: [
          { sha: "37372b4", label: "mulesoft: iteration 3 — Flex Gateway live, runtime enforcement active" },
          { sha: "981c031", label: "mulesoft: iterations 4-7 — rate limiting, OAS spec, stable tunnel, JWT auth" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 7, 2026",
    headline: "MuleSoft iteration 2: /providers live + API Manager governance plane wired",
    intro:
      "MuleSoft iteration 2 shipped end-to-end. A second Experience API (/providers) is live on the CloudHub 2.0 worker; the Anypoint API Manager governance plane (API instance, Client ID Enforcement policy, Rate Limiting SLA, Demo/Production SLA tiers, registered client app, credentials set in Vercel) is fully configured. Runtime policy enforcement is deferred to Flex Gateway — a topology change, not a code change (CH2 Shared Space doesn't surface the Mule agent autodiscovery channel). Credential headers are injected from Vercel into both MuleSoft proxies today so the wire-up is a single Flex Gateway deployment away. Earlier same week: MuleSoft runtime 4.11.2 upgrade, health-flow.xml fixes, and Data 360 Phase 2 code layer.",
    entries: [
      {
        title: "MuleSoft iteration 2: /providers live + API Manager governance configured",
        summary:
          "GET /providers?zip=&menopause=&limit= is live on the deployed CloudHub 2.0 worker (pause-mulesoft-health-v1). The Mule flow returns a DataWeave-built provider directory ranked by graphScore with zip-prefix + menopause-certified filters; DataWeave slice clamping bug (sorted[0 to N-1] returning empty when N > array length) fixed. lib/mulesoft/providers.ts implements the same prefer-real / degrade-to-mock / warn-once pattern as health.ts: activated by MULESOFT_PROVIDERS_BASE_URL, falls back to queryProviderDirectory() on any failure. 23 new unit tests (providers.test.ts); total MuleSoft lib count: 45/45. MULESOFT_PROVIDERS_BASE_URL, MULESOFT_CLIENT_ID, and MULESOFT_CLIENT_SECRET are set in Vercel production; both /health and /providers proxies inject client credentials on every request. Anypoint governance plane: API Manager instance ID 20954842 registered, Client ID Enforcement + Rate Limiting SLA policies applied, Demo tier (10 req/min, auto-approve) + Production tier (1000 req/min) created, pause-prototype-client app approved on Demo tier. Runtime enforcement deferred: CH2 Shared Space doesn't expose the Mule agent autodiscovery channel; Flex Gateway is the path to activate the 401/429 enforcement at the wire. Runbook updated to document the full state and the Flex Gateway next step.",
        commits: [
          { sha: "1e4468e", label: "mulesoft: iteration 2 — /providers live + API Manager runbook" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: runtime 4.11.2, Java 17, health-flow.xml fixes",
        summary:
          "mule-artifact.json bumped to minMuleVersion 4.11.0 with javaSpecificationVersions: [\"17\"]. pom.xml bumped to app.runtime 4.11.2, mule-maven-plugin 4.7.0. health-flow.xml had two XML errors that prevented Code Builder from rendering the canvas: (1) <http:headers> used as a standalone flow processor — moved it into <http:response> nested inside <http:listener> where Mule 4 expects it; (2) double-hyphen (--) inside an XML comment — illegal in XML, replaced with single hyphen. Code Builder .vscode/launch.json and .vscode/settings.json scaffolding committed.",
        commits: [
          { sha: "3662130", label: "mulesoft: bump runtime + fix health-flow.xml" }
        ],
        status: "partial"
      },
      {
        title: "Data 360 Phase 2: Data Cloud Calculated Insights layer",
        summary:
          "New lib/salesforce/data-cloud.ts implements the Data Cloud Query API and Calculated Insights API client, mirroring the same warn-once / prefer-real / degrade-to-null pattern as the Phase 1 SOQL path. Activated by SF_DC_TENANT_URL env var. lib/salesforce/grounding.ts updated to call getWearableInsights() in parallel with the four SOQL queries; each of the three wearable insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) falls back to its intake baseline independently. groundingProvenance.federatedQuery reflects which path served the request. frontend/.env.example documents the new vars with derivation notes. Full org setup walkthrough — DMO authoring, CI SQL, mock CI path, env var wiring, verification curls — in new docs/MULESOFT_PHASE_2_DATA_CLOUD.md. Probe result: trailsignup org has the permission sets but no provisioned DC tenant; code is ready and waiting.",
        commits: [
          { sha: "8a2e55f", label: "data-360: Phase 2 Data Cloud Calculated Insights layer" }
        ],
        status: "partial"
      }
    ]
  },
  {
    range: "Week of June 1, 2026",
    headline: "Honesty-pilling marathon",
    intro:
      "Thirty-plus commits across every public page on the site. The single theme: replace any present-tense claim that isn't yet true with a StatusPill-flagged 'today vs. designed' framing. The Apache-2.0 license + OSS-hygiene trio (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY) landed mid-week, the polish marathon wrapped with a reproducible end-to-end smoke test (132 / 132 pass), the JupyterHealth integration jumped from designed-on-paper to wire-level prototype (27 / 27 against an in-process JHE mock), the Care Router business logic got its first test safety net (100 new tests covering ~1,100 lines of previously-untested risk-band + pathway + A2A code), and the MuleSoft Phase 1 deploy artifact got pre-staged (deployable Mule app, live/mock proxy with graceful degradation, 31 new unit tests, env-gated investor badge) so the Anypoint clickthrough is the only remaining work on the user's plate.",
    entries: [
      {
        title: "MuleSoft Anypoint Phase 1: deployable artifact + live/mock proxy",
        summary:
          "Phase 1 shipped 2026-06-07. A real Mule 4.11.2 app is running on CloudHub 2.0 (Cloudhub-US-West-1, Sandbox) at https://pause-mulesoft-health-v1-zkeniz.scqos5-1.usa-w1.cloudhub.io. MULESOFT_HEALTH_BASE_URL is set in Vercel production; /api/mulesoft/health reports meta._source: 'live-mulesoft' and meta._liveUrl matches the worker. Degradation path verified: stopping the Mule app surfaces meta._source: 'mock-fallback' with _liveAttempted: true — the prototype never goes hard-down. /proposal/mulesoft shows the green LIVE badge. Build fixes required along the way: mule-http-connector dependency missing from pom.xml, property placeholder ${http.listener.port:8081} replaced with hardcoded 8081, DataWeave (idx, _) two-arg lambda syntax replaced with $ / $$ implicit vars, config.yaml added for configuration-properties. Repo-side: lib/mulesoft/health.ts prefer-real / degrade-to-mock / warn-once client, 31 unit tests, env-gated investor badge.",
        commits: [
          { sha: "55e1b6d", label: "MuleSoft Phase 1 repo prep" },
          { sha: "3662130", label: "bump runtime 4.11.2, fix health-flow.xml" },
          { sha: "a4635f2", label: "add mule-http-connector dependency" },
          { sha: "a4b75fc", label: "add config.yaml + configuration-properties" },
          { sha: "bc6172b", label: "hardcode port 8081" },
          { sha: "38f4a24", label: "fix DataWeave lambda syntax" },
          { sha: "6a3c4ed", label: "set MULESOFT_HEALTH_BASE_URL in Vercel production" }
        ],
        status: "partial"
      },
      {
        title: "Care Router business logic: +100 unit tests, drift caught",
        summary:
          "Five new test files cover the highest-leverage business logic on the site: lib/risk-band.test.ts (30 tests pinning the deterministic intake → band → pathway decision tree against every persona in the demo cohort), lib/care-router-pathways.test.ts (11 tests pinning the canonical six-pathway enum), lib/care-router.test.ts (25 tests covering scriptedRoute's red-flag / severity / cycleStatus / ageBand / Data 360 grounding branches plus the claudeRoute no-API-key fallback), lib/agent-fabric.test.ts (20 tests covering evaluateGovernance, the trace ring buffer, and listRecentTaskIds), and app/api/agents/care-router/tasks/route.test.ts (14 tests covering JSON-RPC envelope validation, governance block path, success path with RoutingDecision artifacts, and metadata.parentSpanId / personaId passthrough into recorded trace spans). The risk-band suite surfaced a real drift: Brianna Okafor's displayRisk on the public /demo/intake queue table was labeled 'Moderate' but her sleepScore=8 trips the single-axis-promotion rule and computeRisk returns 'High'. Fixed the data, the tests now pin both surfaces. Total frontend test count: 73 → 173. Smoke test still 132 / 132.",
        commits: [
          { sha: "79bb9b0", label: "Care Router test suite" }
        ],
        status: "prototype"
      },
      {
        title: "pause_ingest → JHE: wire-level contract test (27 / 27 pass)",
        summary:
          "New in-process JHE mock server (tests/jhe_mock_server.py) implements the OAuth2 + FHIR endpoints pause_ingest actually hits. Seven integration tests (tests/test_exchange_integration.py) exercise the production exchange.upload_observation, hrv_features_to_fhir_observation, and read_recent_observations code paths end-to-end — including a full-pipeline test that uploads 6 raw heart-rate observations, computes time-domain HRV features, uploads the derived observation with derivedFrom provenance, and reads everything back. The contract test surfaced a real bug in read_recent_observations (the JupyterHealthClient 0.2.0 API doesn't accept client_id/client_secret) that lenient unit-test doubles missed. Added hrv_features_to_fhir_observation helper. New runbook at docs/JHE_SETUP_RUNBOOK.md captures the path to swap the mock for real JHE in an afternoon (~1 afternoon, gated on Docker). Flipped the JupyterHealth pill on /roadmap from designed to prototype.",
        commits: [
          { sha: "e1e43aa", label: "pause_ingest → JHE contract test" }
        ],
        status: "prototype"
      },
      {
        title: "End-to-end smoke test — 132 / 132 pass",
        summary:
          "New reproducible smoke-test harness at frontend/scripts/smoke-test.mjs. Hits all 35 public routes, follows 77 unique internal links discovered by parsing rendered HTML, and POSTs realistic fixtures to 16 API endpoints (including the A2A JSON-RPC tasks/send envelope to /api/agents/care-router/tasks). Results land in SMOKE_TEST_RESULTS.md committed at the repo root. Caught one false-positive in the link extractor (query-string handling) on the first run; no real regressions on the polished surface. Wired into package.json as `npm run smoke`.",
        commits: [
          { sha: "1fa3a19", label: "smoke test + 132/132 results" }
        ],
        status: "shipped"
      },
      {
        title: "/changelog + /roadmap pages",
        summary:
          "Built /changelog as a hand-curated weekly narrative with real commit SHAs linking to GitHub, and /roadmap as a Now / Next / Later horizon view drawn from the 30+ designed / planned / future items already pilled across the site. Home page got a 'momentum strip' (63 commits since May 24, 2026) with cross-links to both pages.",
        commits: [{ sha: "cd1ea17", label: "changelog + roadmap pages" }],
        status: "shipped"
      },
      {
        title: "Apache-2.0 license + OSS-hygiene trio",
        summary:
          "Released the source under the Apache License, Version 2.0 — the patent grant matters more than MIT's brevity in healthcare AI. Added the standard CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md set at the repo root, taking GitHub's Community Standards checklist to 100%. NOTICE file lists upstream attributions (JupyterHealth, DBDP, FLIRT, Salesforce, MCP, Anthropic, Menopause Society directory).",
        commits: [
          { sha: "83db016", label: "docs: OSS-hygiene trio" },
          { sha: "4090e33", label: "license: Apache-2.0" }
        ],
        status: "shipped"
      },
      {
        title: "/proposal/full — long-form investor brief polished",
        summary:
          "Nine high/medium-priority honesty fixes on the 4,000-line full proposal page. Hero copy softened from present-tense to 'designed to help clinicians…'. The $1,685 avoidable-spend metric deduplicated and pinned to its literature source. Anchor-provider claims softened to 'design-partner provider organizations'. whatPauseProvides and techFoundation cards each get per-card StatusPills. businessChannels ACV/PMPM table re-framed as Target ACV ranges with caveats. HIPAA/HITRUST/SOC 2 claims reconciled with the /security page.",
        commits: [{ sha: "91ee6ee", label: "proposal/full: pills + dedupe + sync" }],
        status: "shipped"
      },
      {
        title: "Seven supporting pages reconciled with reality",
        summary:
          "/careers, /security, /hipaa, /research, /privacy, /blog, /terms — each replaced false present-tense claims with explicit 'Today vs. Designed' tables. /security: removed 'BAAs executed' and 'SOC 2 Type II in progress' claims. /hipaa: stated outright 'Pause-Health.ai is NOT a Business Associate today.' /research: removed 'bias monitoring quarterly with clinician review' (no such program exists yet). /careers: reconciled the three founding roles (CMO, Head of AI, Head of Clinical Design) to match /about, all pilled 'future'.",
        commits: [
          { sha: "b60385b", label: "careers/security/hipaa/research/privacy/blog/terms: honesty pilling" }
        ],
        status: "shipped"
      },
      {
        title: "/about, /press, /contact — credibility polish",
        summary:
          "/about: hero updated to 'Pre-design-partner; prototype in the open'. Milestones split into Done vs. Planned with explicit pills. /press: replaced one-line stub with a real press kit — approved boilerplate, founder bio + headshot, brand-asset downloads, milestones, media contact with response-time SLA. /contact: each email alias now lists audience, what-to-include, response-time expectations. 'Self-route' section deflects to /careers, /press, /security, GitHub issues.",
        commits: [{ sha: "82a95db", label: "about/press/contact: honesty pilling + real press kit" }],
        status: "shipped"
      },
      {
        title: "Home page rebuilt with honest hero",
        summary:
          "New 'What's live today' strip with four prototype-pilled cards linking directly to /demo/intake, /demo/patient, /demo/routing, /demo/agent-fabric. Two-arc CTA section splits 'investors + partners' from 'builders + clinicians' with distinct calls-to-action. Founder credibility line links to /about and Maggie's LinkedIn. The $1,685 figure was removed from the hero (kept only in /proposal/full with proper research citation).",
        commits: [{ sha: "c3b71d3", label: "home: honest hero + What's live today + two-arc CTAs" }],
        status: "shipped"
      },
      {
        title: "Persona-aware navigation across all five /demo/* pages",
        summary:
          "DemoShell top nav now preserves the selected persona across pages (clicking 'Care Router' from /demo/intake?personaId=anika-patel keeps Anika selected). PreBriefPanel grew a compact switch-persona chip row, journey shortcuts ('Open Care Detail for Anika →'), and a risk-band + suggested-pathway verdict. /demo/analytics filters its cohort-comparison view by persona. /demo/agent-fabric grew a 'View all Anika's traces' link. A new PersonaJourneyFooter renders consistently across all five demo pages.",
        commits: [
          { sha: "a063a8d", label: "demo: PreBriefPanel persona-aware polish" },
          { sha: "1307ac2", label: "demo: persona-filterable agent-fabric + cross-links" },
          { sha: "45344bd", label: "demo: shared PersonaJourneyFooter" },
          { sha: "db057af", label: "demo: persona-preserving shell nav + analytics filter" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — late",
    headline: "Investor-brief polish, Arc A + Arc B",
    intro:
      "Eight architecture pages and four go-to-market pages each got a per-card StatusPill retrofit. The shared <StatusPill> component was extracted and the vocabulary canonicalized so 'Designed' means the same thing on /proposal/strategy as it does on /proposal/agentforce.",
    entries: [
      {
        title: "Arc B — eight architecture deep-dives polished",
        summary:
          "/proposal/agentforce, /proposal/mulesoft, /proposal/mcp, /proposal/dbdp, /proposal/integration, /proposal/provider-graph, /proposal/menopause-society, /proposal/data-360. Each rewritten with per-card pills, env-variable tables where relevant, and explicit 'today contract vs. designed pipeline' framing. /proposal/menopause-society: stale ~2,500 MSCP count updated to ~4,100 with a Research-pilled source citation.",
        commits: [
          { sha: "94e514b", label: "proposal/data-360: per-card pills + IR CTA" },
          { sha: "95e1fb2", label: "proposal/menopause-society: fix stale count" },
          { sha: "7f7dc6b", label: "proposal/provider-graph: prototype vs designed" },
          { sha: "c55eae5", label: "proposal/dbdp: per-row status pills" },
          { sha: "1630708", label: "proposal/integration: Phase 0 + pills" },
          { sha: "0805a32", label: "proposal/mulesoft: tense + pills" },
          { sha: "96db851", label: "proposal/mcp: gate npx behind Phase 1" },
          { sha: "0748050", label: "proposal/agentforce: honesty + env-table" }
        ],
        status: "shipped"
      },
      {
        title: "Arc A — go-to-market pages and shared <StatusPill>",
        summary:
          "/proposal/customers, /proposal/competition, /proposal/data, and the /proposal hub page each got the status-pill retrofit. The pill component itself was extracted from inline copies and canonicalized — three tones (real / mock / info) to distinguish 'this code ships today', 'this code is designed', and 'this is a research-derived number, not a capability'. Subsequent commits retrofit eight already-polished pages onto the shared component.",
        commits: [
          { sha: "3b67edc", label: "proposal: extract shared <StatusPill>, retrofit 8 pages" },
          { sha: "ced0fc0", label: "Arc A pages: customers / competition / data" },
          { sha: "189e565", label: "proposal hub: Arc A / Arc B grouping + demo links" }
        ],
        status: "shipped"
      },
      {
        title: "Strategy + technology + insights rebuilt for honesty",
        summary:
          "/proposal/strategy and /proposal/full rebuilt with plan-vs-status honesty. /proposal/technology reconciled with /proposal/insights so the customer-research summaries agree across pages. /proposal/insights re-framed as a 'Research-design plan' rather than asserting completed interviews.",
        commits: [
          { sha: "7c57191", label: "/proposal/technology + /proposal/insights" },
          { sha: "08e6be7", label: "/proposal/full + /proposal/strategy rebuild" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — early",
    headline: "Demo surface rebuild, persona-aware",
    intro:
      "The five /demo/* pages were each rebuilt around the canonical DEMO_COHORT personas. /demo/patient grew a Care Detail layout with risk gauge + axis flags + HRT suitability. /demo/routing demonstrates the Care Router decision live. /demo/analytics replaced static placeholder charts with operational metrics computed from real API trace data. /demo/agent-fabric joined the shared DemoShell nav.",
    entries: [
      {
        title: "Five /demo/* pages rebuilt around personas",
        summary:
          "Each demo page now accepts ?personaId=anika-patel (or any of the six seeded personas) and renders persona-aware content end-to-end. /demo/patient: Care Detail layout with risk gauge, axis flags, HRT suitability. /demo/routing: live Care Router decision with persona-specific intake hints. /demo/analytics: operational metrics + pathway-mix chart computed from real API traces.",
        commits: [
          { sha: "045aa04", label: "/demo/agent-fabric into shared DemoShell" },
          { sha: "2afb917", label: "/demo/analytics: live ops metrics + chart" },
          { sha: "81b48e3", label: "/demo/routing: persona-aware routing demo" },
          { sha: "a984061", label: "/demo/patient: persona-aware Care Detail" }
        ],
        status: "shipped"
      },
      {
        title: "Pre-Brief Panel ships — Embedded Messaging context layer",
        summary:
          "After discovering Salesforce's prechatAPI is a no-op Proxy in Embedded Messaging V2, pivoted from hidden pre-chat fields to a visible Pre-Brief Panel on /demo/intake. The panel surfaces the patient's Data 360 dossier (real Salesforce when SF_* env vars are set, deterministic mock otherwise) so the agent walks in pre-grounded.",
        commits: [
          { sha: "692f0a2", label: "Pre-Brief Panel: stack long Cohort_Name row" },
          { sha: "26fb582", label: "Pre-Brief Panel ships + V2 prechatAPI dead-end documented" },
          { sha: "2bb4e15", label: "Phase 18b: full agent-side wiring" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 24, 2026 — initial build",
    headline: "Prototype-in-the-open lands",
    intro:
      "The first week of Pause-Health.ai work. Eleven commits stood up the marketing site, investor brief, demo surface, MuleSoft integration plane, MCP server, multi-agent control plane, Salesforce Agentforce intake, and the Data 360 grounding layer — all built on top of the legacy Northstar Shipping API repo that already had CI/CD wiring.",
    entries: [
      {
        title: "Multi-agent control plane",
        summary:
          "Four agents (Agentforce intake, Anthropic Claude Care Router, Pause MCP server, MuleSoft Process API) wired through Google A2A + MCP, orchestrated by a MuleSoft Agent Fabric mock. Live console at /demo/agent-fabric.",
        commits: [
          { sha: "ded1e63", label: "multi-agent control plane" }
        ],
        status: "shipped"
      },
      {
        title: "Salesforce Data 360 grounding layer",
        summary:
          "Care Router grounds on real Salesforce Health Cloud objects (Contact + CareProgramEnrollee + CarePlan + Case) when SF_INSTANCE_URL/CLIENT_ID/SECRET are set; deterministic mock when unset. Agent Fabric console shows LIVE badge on every span served by a real org.",
        commits: [{ sha: "57dbdfd", label: "Data 360 grounding" }],
        status: "shipped"
      },
      {
        title: "MuleSoft + MCP + JupyterHealth + DBDP integration planes",
        summary:
          "Three-tier MuleSoft architecture reference artifacts. MCP server wraps the mocked Experience APIs as four tools for Claude Desktop, Cursor, Agentforce. JupyterHealth Exchange integration design + pause_ingest Python worker for wearable ingest. DBDP feature-engineering layer.",
        commits: [
          { sha: "d0942b6", label: "MCP server" },
          { sha: "1e35ef8", label: "MuleSoft integration plane" },
          { sha: "4a653c9", label: "JupyterHealth + ingest worker" },
          { sha: "13bd429", label: "DBDP wearable features" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce intake + Menopause Society referral path",
        summary:
          "Salesforce Agentforce Service Agent intake wired into the prototype with Pause-branded fallback. /proposal/menopause-society lays out the MSCP referral path with explicit ToS guardrails (deep-link to The Menopause Society's directory rather than scraping).",
        commits: [
          { sha: "1334296", label: "Agentforce intake" },
          { sha: "cc09923", label: "Menopause Society referral path" }
        ],
        status: "shipped"
      },
      {
        title: "Marketing site, investor brief, mobile nav, CI/CD",
        summary:
          "Initial Next.js frontend on top of the legacy Northstar repo. Full investor brief as a routed page. Mobile-friendly hamburger nav. Part 2 deep-dives. Vercel deploy + GitHub Actions for typecheck + Lighthouse nightly + CodeQL.",
        commits: [
          { sha: "597fd63", label: "Pause-Health.ai frontend + CI/CD" },
          { sha: "6501659", label: "Part 2 deep-dives + Next routing" },
          { sha: "479837e", label: "mobile hamburger nav" }
        ],
        status: "shipped"
      }
    ]
  }
];

function commitUrl(sha: string) {
  return `${GITHUB_REPO}/commit/${sha}`;
}

export default function ChangelogPage() {
  const allEntries = weeks.flatMap((w) => w.entries);

  return (
    <main className="container" style={{ paddingTop: "2.4rem", paddingBottom: "3rem", maxWidth: "60rem" }}>
      <header style={{ marginBottom: "1.8rem" }}>
        <p className="eyebrow">Changelog</p>
        <h1 style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", margin: "0.25rem 0 0.6rem" }}>
          What's shipped, week by week
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: "44rem", margin: 0, lineHeight: 1.55 }}>
          Pause-Health.ai is built in the open. The git log at{" "}
          <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          is the source of truth — this page is a hand-curated narrative
          view of the marquee weeks. Roadmap items (what's <em>coming</em>) live
          at <a href="/roadmap" style={{ color: "var(--brand)" }}>/roadmap</a>.
        </p>

        <div
          style={{
            marginTop: "1.1rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center"
          }}
        >
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            {allEntries.length} marquee entries across {weeks.length} weeks
          </span>
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            175 total commits since May 24, 2026
          </span>
          <a
            href={GITHUB_REPO + "/commits/main"}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.82rem", padding: "0.4rem 0.75rem" }}
          >
            See all commits on GitHub →
          </a>
        </div>
      </header>

      {/* Current-state banner.
          The marquee weeks below preserve history (and read like a plan
          if you start at the bottom), but a fresh reader needs to see
          what's actually live right now first. Update this block when
          a major phase lands — the entries list it summarizes stays
          immutable. */}
      <section
        className="card"
        style={{
          marginBottom: "2rem",
          background:
            "linear-gradient(180deg, rgba(255, 93, 168, 0.10) 0%, transparent 100%)",
          borderColor: "rgba(255, 93, 168, 0.35)"
        }}
        aria-label="Current state summary"
      >
        <p className="eyebrow" style={{ marginBottom: "0.4rem" }}>
          Where we are right now
        </p>
        <h2 style={{ marginTop: 0, fontSize: "clamp(1.2rem, 2.4vw, 1.6rem)" }}>
          Provider-graph Phase 2 + Data 360 Phase 2 are both shipped.
        </h2>
        <p style={{ color: "var(--muted)", lineHeight: 1.55, marginBottom: "0.8rem" }}>
          The provider directory carries 2,015 NPPES-derived rows behind the
          frozen Experience API contract. Distance ranking from Census 2020
          ZCTA centroids, six NPPES board-cert + multi-specialty signals, three
          state license-sanction filters dropping 1,720 sanctioned candidates
          at build (CA Medi-Cal + NY OPMC + TX TMB), real-shaped synthetic
          insurance, and a /provider browseable UI all ship today. Data Cloud
          Calculated Insights grounding is live in production on the
          trailsignup org (HRV / vasomotor burden / sleep disruption). The
          Care Router consumes both, so an MSCP-pathway routing decision now
          attaches a distance-ranked, plan-narrowed, modality-aware
          recommended-provider list to its output. Closed-loop outcomes
          scoring (Phase 3) activates with referral volume.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <a
            href="/proposal/provider-graph"
            className="btn btn-primary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Read the provider-graph brief →
          </a>
          <a
            href="/provider?zip=92614&menopause=true"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Browse the directory →
          </a>
          <a
            href="/api/mulesoft/providers?zip=92614&menopause=true"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 0.85rem" }}
          >
            Curl the contract →
          </a>
        </div>
      </section>

      {weeks.map((week) => (
        <section
          key={week.range}
          aria-label={week.range}
          style={{
            marginBottom: "2.2rem",
            paddingBottom: "1.6rem",
            borderBottom: "1px solid var(--surface-3)"
          }}
        >
          <header style={{ marginBottom: "1.1rem" }}>
            <p
              className="eyebrow"
              style={{ marginBottom: "0.15rem" }}
            >
              {week.range}
            </p>
            <h2
              style={{
                fontSize: "1.4rem",
                margin: "0.05rem 0 0.5rem",
                color: "var(--text)"
              }}
            >
              {week.headline}
            </h2>
            <p
              style={{
                color: "var(--muted)",
                margin: 0,
                lineHeight: 1.55,
                fontSize: "0.95rem"
              }}
            >
              {week.intro}
            </p>
          </header>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {week.entries.map((entry) => (
              <article
                key={entry.title}
                className="card"
                style={{ padding: "1.1rem 1.2rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.8rem",
                    flexWrap: "wrap",
                    marginBottom: "0.4rem"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.35 }}>
                    {entry.title}
                  </h3>
                  <StatusPill status={entry.status} />
                </div>
                <p
                  style={{
                    margin: "0.3rem 0 0.75rem",
                    color: "var(--muted)",
                    lineHeight: 1.55,
                    fontSize: "0.92rem"
                  }}
                >
                  {entry.summary}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.4rem",
                    fontSize: "0.78rem"
                  }}
                >
                  {entry.commits.map((c) => (
                    <a
                      key={c.sha + c.label}
                      href={commitUrl(c.sha)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "0.25rem 0.55rem",
                        borderRadius: "6px",
                        background: "var(--surface-2)",
                        color: "var(--muted)",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        textDecoration: "none",
                        border: "1px solid var(--surface-3)"
                      }}
                    >
                      <span style={{ color: "var(--brand)" }}>{c.sha}</span>{" "}
                      <span>{c.label}</span>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section
        aria-label="Where to go next"
        style={{ marginTop: "1rem" }}
      >
        <div
          className="card-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}
        >
          <article className="card">
            <p className="eyebrow">Forward-looking</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              What's coming next
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The roadmap groups the 31+ designed / planned / future items
              already pilled across the site into Now / Next / Later
              horizons. Each item links back to the page that describes it
              in detail.
            </p>
            <div style={{ marginTop: "0.9rem" }}>
              <a href="/roadmap" className="btn btn-primary">
                Open the roadmap →
              </a>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">Watch the build</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              Subscribe to commits
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The repo is public. Watch it on GitHub to get notified of new
              commits, or subscribe to the planned essays at <a href="/blog" style={{ color: "var(--brand)" }}>/blog</a> for
              the editorial version.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a
                href={GITHUB_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                GitHub →
              </a>
              <a href="/blog" className="btn btn-secondary">
                Editorial →
              </a>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
