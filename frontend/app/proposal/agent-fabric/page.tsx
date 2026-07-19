import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";
import {
  GOVERNANCE_PLANES,
  PLANES_IN_ORDER,
  planeForTier,
  tierLabel,
  type GovernanceTier
} from "../../../lib/governance-tiers";

export const metadata = pageMetadata({
  title: "Investor Brief · Multi-Agent Control Plane",
  description:
    "Pause-Health.ai's multi-agent architecture — Agentforce inbound lead generation, prospecting & nurture, qualification, intake, appointment scheduling, cosign-gated specialist referral management, claim-sourced member service / billing, clinician-gated prior authorization, engagement, proactive care-gap closure, and nudge-only medication adherence, the Anthropic Claude Care Router, the Pause MCP server, the MuleSoft integration plane, and a PHI-separated commercial plane (pipeline + account management) — orchestrated, monitored, and governed by a MuleSoft Agent Fabric control plane.",
  path: "/proposal/agent-fabric",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause multi-agent control plane — investor brief."
});

const agents: { name: string; role: string; tier: GovernanceTier; detail: string }[] = [
  {
    name: "Agentforce Inbound Lead Generation",
    role: "Inbound acquisition (site & chat)",
    tier: "patient-acquisition",
    detail:
      "The inbound complement to outbound prospecting. Captures interest from the marketing site, Agentforce web chat, and symptom-check forms; qualifies each visitor against the menopause-care ICP and scores readiness; creates an opt-in-consented lead in Data 360 with source attribution, resolved against existing patients/prospects so nothing duplicates. Routes a ready lead straight to intake and a not-yet-ready lead into the Prospecting & Nurture cadence — both over A2A."
  },
  {
    name: "Agentforce Prospecting & Nurture Agent",
    role: "Outbound acquisition + lead nurture (top of funnel)",
    tier: "patient-acquisition",
    detail:
      "Turns Data 360 population segments (e.g., the 40-60 vasomotor-burden cohort) into consented prospect audiences, then scores and warms leads across a multi-touch nurture cadence — drafting each outreach and nurture touch via Marketing Cloud for human review, never auto-sent. Suppresses anyone lacking contact consent, drops a prospect from every sequence the instant they convert or opt out, and hands a sufficiently-warmed prospect to the intake agent over A2A."
  },
  {
    name: "Agentforce Qualification",
    role: "Lead qualification (the gate before intake)",
    tier: "lead-qualification",
    detail:
      "The authoritative qualifier both acquisition paths hand off to. Applies one consistent rubric (menopause-care fit + eligibility + expressed intent/readiness) to inbound and outbound leads alike, and returns a qualified/disqualified decision with human-readable rationale on every lead. Routes qualified-and-ready leads to intake and qualified-but-warming ones back into nurture. Protected-class attributes are excluded from the criteria, and every disqualification is logged for human review."
  },
  {
    name: "Agentforce Service Agent",
    role: "Patient-facing intake (front door)",
    tier: "patient-facing",
    detail:
      "Captures the structured intake record, performs red-flag screening, and produces an Open-mHealth-shaped artifact. Speaks Google A2A outbound."
  },
  {
    name: "Agentforce Assessment Agent",
    role: "Validated-instrument scoring (patient-facing)",
    tier: "patient-facing",
    detail:
      "The Salesforce 'Agentforce for Health — Assessments' analog. Administers and DETERMINISTICALLY scores an allow-listed set of validated instruments — the Menopause Rating Scale, Greene Climacteric Scale, PHQ-9, and Insomnia Severity Index — with real cutoff-based math, no LLM: per-instrument subscores, a total, and a severity band normalized onto intake's mild/moderate/severe vocabulary. It screens red-flag items (e.g. PHQ-9 item 9 self-harm ideation) and escalates them explicitly, and it refuses any instrument outside the validated allow-list. The scored severity feeds IntakeRecord.severity, so the Care Router's decision is backed by a validated instrument rather than a self-report."
  },
  {
    name: "Agentforce Benefits & Coverage Verification (EBV)",
    role: "Eligibility & benefit verification (patient access)",
    tier: "benefits-verification",
    detail:
      "The Salesforce 'Agentforce for Health — Eligibility & Benefit Verification' analog. Verifies a patient's insurance coverage for a menopause specialist (MSCP) visit and returns a structured eligibility result — plan status (active/inactive), in/out-of-network, deductible + amount met, coinsurance/copay, and an estimated visit cost + patient out-of-pocket — with the (mock) payer/clearinghouse EBV source the result traces to. In the prototype the EBV round-trip is a DETERMINISTIC synthetic (deductible $1,500–$6,000, coinsurance 10–30%, visit $180–$420), clearly labeled synthetic — not a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse. Governance requires every returned result to trace to a payer/clearinghouse response, so the agent can't fabricate coverage without a source; the eligibility summary threads into the intake → Care Router spine so a coverage check can precede routing."
  },
  {
    name: "Pause Care Router (Anthropic Claude Sonnet 4.5)",
    role: "Clinical-decision agent",
    tier: "clinical-decision",
    detail:
      "Takes the structured intake over A2A, reasons over symptoms + cycle + safety screen + age band, and returns one of six care pathways with rationale and red-flag flags. Falls back to a deterministic Pause policy engine when ANTHROPIC_API_KEY is unset or the API call fails."
  },
  {
    name: "Pause Care Plan (Anthropic Claude Sonnet 4.5)",
    role: "Post-visit care plan + progress summary (clinical decision)",
    tier: "clinical-decision",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud CarePlan analog, a clinical-plane sibling of the Care Router and the SECOND live-Claude agent on the fabric. Post-visit, it DETERMINISTICALLY instantiates a menopause care plan (goals, interventions, follow-up cadence) from a defined template — HRT-management, vasomotor/lifestyle, bone-health, or mood/behavioral — selected by the Care Router's pathway/severity + intake, so the same context always yields the same plan and every plan references a defined template id (never fabricated; governance genuinely blocks any off-template plan via policy.careplan.template-sourced). It then generates a patient/clinician progress summary with live Anthropic Claude — the same model + allow-list as the Care Router — falling back to a DETERMINISTIC scripted summary (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails, exactly like the Care Router. Summaries are NON-PRESCRIPTIVE (they never add or change a medication, dose, order, or prescription). The templates are ILLUSTRATIVE synthetics, clearly labeled — not a certified care-plan engine."
  },
  {
    name: "Agentforce Appointment Scheduling",
    role: "Book / reschedule the MSCP visit (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health — Book/Reschedule/Update Appointment' analog, and the step that closes the loop: it books (and can reschedule) the MSCP menopause-specialist visit the Care Router recommends, honoring the requested modality (telehealth / in-person) against a provider availability calendar, and returns a structured booking — a Salesforce ServiceAppointment id, the confirmed slot start/end, modality, provider, and status. In the prototype the calendar is a DETERMINISTIC synthetic (hashed provider + date → stable 30-minute business-hours slots, ~a third pre-booked), clearly labeled synthetic — not a real Salesforce Scheduler / ServiceAppointment write. Governance genuinely enforces the two invariants that matter: it never double-books an already-taken slot and only books within the provider's published availability. It then hands the booked appointment to the Engagement Agent for visit reminders — closing acquisition → intake → routing → booking → engagement."
  },
  {
    name: "Agentforce Referral Management",
    role: "Triage + draft outbound specialist referrals (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' Referrals ('Create Referral') analog, and the full-referral GENERALIZATION of the Care Router's behavioral-health handoff: rather than expressing a single handoff pathway, it triages a patient's intake + Care Router routing signals into referrals across the adjacent specialists menopause commonly touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, and behavioral health — and drafts a referral request per recommendation. Triage is DETERMINISTIC (a pure function of the age/cycle/symptom/severity/red-flag context + risk flags — no randomness, no clock), so the same context always yields the same referral(s), and every recommended referral references a defined specialty-catalog id AND carries a documented reason (never fabricated, never reasonless). The load-bearing honesty property is that it can only DRAFT: an outbound referral requires a clinician's sign-off before it is sent — a referral is a clinical action that needs a human-in-the-loop, and governance genuinely blocks any send-without-cosign (policy.referral.clinician-cosign), alongside the reused rationale-required and HIPAA-audit policies. The specialties + triage rules are ILLUSTRATIVE synthetics, clearly labeled — not a certified clinical referral engine."
  },
  {
    name: "Agentforce Engagement Agent",
    role: "Care continuity (post-routing)",
    tier: "patient-engagement",
    detail:
      "Picks up the Care Router's pathway output and the booked appointment, and schedules the follow-up cadence — visit reminders, symptom check-ins, and adherence nudges — honoring quiet-hours, channel preference, and frequency caps sourced from Data 360, and escalating disengagement or emerging-risk signals back to the router."
  },
  {
    name: "Agentforce Care Gap Closure",
    role: "Proactive preventive care (care gap closure)",
    tier: "care-gap",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud care-gap-closure analog, and the fabric's PROACTIVE agent: rather than reacting to an intake, it grounds on the patient's Data 360 context + age/cycle/symptom signals and DETERMINISTICALLY detects menopause-relevant preventive-care gaps — bone-density/DEXA (osteoporosis risk), lipid panel, screening mammogram, and overdue HRT follow-up — then drafts consent- and quiet-hours-aware outreach for each and hands it to the Engagement Agent for delivery. Detection is a pure function of an explicit as-of date + per-measure history (no randomness, no clock), so the same context always yields the same gaps. The load-bearing property is integrity, not clinical authority: every detected gap references a defined clinical-measure catalog id — never a fabricated one — and governance genuinely blocks any off-catalog gap (policy.caregap.clinical-measure-sourced). The clinical measures + intervals are ILLUSTRATIVE synthetics, clearly labeled — not a certified guideline engine. Outreach reuses the engagement guards: contact consent required, human approval before any send, and quiet-hours + channel preference honored."
  },
  {
    name: "Agentforce Medication Adherence",
    role: "Nudge-only HRT/SSRI refill & adherence (patient engagement)",
    tier: "patient-engagement",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud MedicationRequest + MedicationTherapyReview analog, and a second PROACTIVE patient-care agent alongside Care Gap Closure: it tracks whether a patient is staying on their menopause medications — transdermal/oral HRT (estradiol, oral progesterone) and an SSRI/SNRI for vasomotor symptoms or mood (paroxetine, venlafaxine) — and whether a refill is coming due, then drafts consent- and quiet-hours-aware refill/adherence nudges it hands to the Engagement Agent and flags adherence drop-off to the care team. Detection is DETERMINISTIC (a pure function of an explicit as-of date + each medication's days-supply and last-fill — no randomness, no clock), producing a good / at-risk / lapsed status and a refill-due call. The load-bearing honesty property is that it can only NUDGE: it may draft a refill reminder for human review but must NEVER autonomously submit or order a refill — a refill is a clinical action that requires a human-in-the-loop, and governance genuinely blocks any autonomous refill (policy.medication.no-autonomous-refill), reusing the no-prescribing and engagement outreach guards (contact consent, human approval before send, quiet-hours + channel preference). The medications + refill intervals are ILLUSTRATIVE synthetics, clearly labeled — not a certified pharmacy / e-prescribing system."
  },
  {
    name: "Agentforce Member Service / Billing",
    role: "Billing & coverage self-service (patient service)",
    tier: "patient-facing",
    detail:
      "The Salesforce 'Agentforce for Health' Claims & Coverage / patient-service analog: it answers a member's BILLING & COVERAGE self-service questions — claim status, copay / patient responsibility, outstanding balance, and EOB explanation — grounded on the member's synthetic claim/EOB records, and routes anything out of scope (a clinical, prescription, or scheduling request) to a human member-services specialist with a PII-safe billing context bundle, keeping it scoped to billing/coverage self-service and distinct from the Engagement Agent. Generation is DETERMINISTIC (member/claim keys hashed into realistic billed / allowed / plan-paid / patient-responsibility figures across submitted / adjudicated / paid / denied statuses — no randomness, no clock), so the same member always yields the same claims and the same question always answers identically. The load-bearing honesty property is that every billing/claim answer must trace to a specific claim/EOB record — the agent may not fabricate claim data — and governance genuinely blocks any billing answer that cites no claim (policy.billing.claim-data-sourced), alongside the reused no-free-text-pii and HIPAA-audit policies. The claim/EOB records are ILLUSTRATIVE synthetics, clearly labeled — not a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit."
  },
  {
    name: "Agentforce Prior Authorization",
    role: "Assemble a clinician-gated PA (clinical decision · utilization management)",
    tier: "clinical-decision",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud CareRequest + Utilization Management analog — the HEAVIEST agent on the fabric and, deliberately, the LEAST demo-honest of the set. For a PA-requiring menopause item (systemic HRT / compounded estradiol, a bone-density DEXA scan, or a specialized hormone lab panel) it pulls the (synthetic) clinical context, DETERMINISTICALLY matches the payer's medical-necessity criteria, assembles the required supporting-documentation checklist (present vs missing), and returns a clinician-gated PA package with a synthetic Health Cloud CareRequest / authorization id and a status (draft / ready-for-clinician / submitted). Real prior authorization is a genuinely multi-system workflow — an X12 278 (or FHIR PAS / Da Vinci) EDI exchange against a payer's utilization-management system — so this is a clearly-labeled MOCK, NOT a real 278/EDI or payer PA portal submission, and the payer criteria + document checklists are ILLUSTRATIVE synthetics, not a certified utilization-management engine (Salesforce's own guidance is to do PA last, and we did). TWO load-bearing honesty properties are governance-enforced: it must NOT autonomously submit a PA — a clinician must approve first, so it only ever assembles a clinician-gated draft (requiresClinicianApproval:true, submitted:false) and governance blocks any submit-without-approval (policy.pa.no-autonomous-submission); and a PA submission must include the required supporting documentation — a submission missing a required document is blocked (policy.pa.documentation-integrity). It reuses the no-prescribing, consent-before-grounding, and HIPAA-audit policies."
  },
  {
    name: "Agentforce SDOH Screening",
    role: "Whole-person care · social-needs screening + community referral",
    tier: "whole-person-care",
    detail:
      "The Salesforce 'Agentforce for Health' whole-person-care analog: it screens a patient for health-related social needs / social determinants of health with a validated, public-domain instrument (the CMS Accountable Health Communities HRSN core-domain tool: housing instability, food insecurity, transportation needs, utility needs, interpersonal safety), DETERMINISTICALLY flags the positive social-need domains (real rule-based scoring — the Hunger Vital Sign food screen, the HITS interpersonal-safety cutoff — no LLM), and drafts CONSENT-GATED community-resource referrals (211, food bank, housing/utility assistance, a domestic-violence hotline). Two load-bearing honesty properties are governance-enforced: it may only administer a screener on the validated allow-list (policy.sdoh.validated-screener-only), and it may only draft a community referral with the patient's explicit consent — never an autonomous enrollment (policy.sdoh.consent-before-referral). A positive interpersonal-safety screen is a mandatory escalation to a human social worker (mirroring the Assessment Agent's PHQ-9 item 9 handling). SDOH is SEPARATE from clinical severity — a positive social need raises a care-coordination flag, not an intake severity — so it complements the clinical agents. The community-resource catalog is an ILLUSTRATIVE synthetic, NOT a live directory of real programs."
  },
  {
    name: "Agentforce Patient Education & Health Coaching",
    role: "Personalized menopause education + lifestyle coaching (patient engagement)",
    tier: "patient-engagement",
    detail:
      "The Salesforce 'Agentforce for Health' patient-education / health-coaching analog, and the FOURTH live-Claude agent: it turns already-produced signals (intake symptoms/severity, an optional validated-instrument assessment, Care Plan focus areas, and detected care gaps) into a personalized, evidence-sourced menopause/midlife education curriculum (bone health, cardiovascular risk, sleep hygiene, vasomotor self-management, mood/stress, nutrition, physical activity) and a warm, motivational coaching message. It is distinct from the clinician-authored Care Plan agent and the refill-focused Medication Adherence agent — it only EDUCATES and COACHES. Module SELECTION is DETERMINISTIC (a pure function of the inputs against a defined evidence-sourced catalog — no randomness, no clock), and the coaching message is generated with live Anthropic Claude, falling back to a deterministic scripted message (with a recorded fallbackReason) on a missing key or any SDK error, mirroring the Care Plan / Clinical Summary agents. THREE load-bearing honesty properties are governance-enforced: every module must trace to a defined evidence source (policy.education.evidence-sourced), the content must stay strictly within general education — never a diagnosis, medication dose, or individualized medical advice (policy.education.no-medical-advice), and any coaching outreach is consent-gated + human-approval-gated (policy.education.consent-before-outreach). It also honors the model allow-list and the HIPAA-audit policy. The education modules + source labels (The Menopause Society, USPSTF, NAMS/ACOG-style) are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified patient-education engine."
  },
  {
    name: "Agentforce Remote Patient Monitoring & Symptom-Trend Tracking",
    role: "Longitudinal symptom/vital trend detection + clinician-routed escalation (care coordination)",
    tier: "care-coordination",
    detail:
      "The remote-patient-monitoring (RPM) analog, and a DETERMINISTIC (no-Claude) agent modeled on Care Gap Closure and Medication Adherence: it ingests longitudinal (time-series) symptom/vital readings — self-reported or from wearables/devices — for a menopause/midlife patient (hot-flash frequency, sleep hours, mood score, resting heart rate, weight), DETERMINISTICALLY detects a per-metric trend (improving / stable / worsening) by comparing a recent window against a baseline window against a defined monitored-metrics catalog, and routes worsening or red-flag trends to a clinician for review. Trend detection is a pure function of the reading series (timestamps are accepted as data — no randomness, no clock dependence), so the same series always yields the same trend + escalation decision, and every escalation cites the metric + the threshold rule that triggered it. It is distinct from the preventive-measure Care Gap agent, the refill-focused Medication Adherence agent, and the coaching Patient Education agent — this one is about longitudinal monitoring, trend detection, and clinician-routed escalation. THREE load-bearing honesty properties are governance-enforced: every reading must trace to a recognized device/self-report source and a defined monitored metric — fabricated / off-catalog readings are blocked (policy.rpm.reading-source-integrity); it may NEVER take an autonomous clinical action — every escalation must be routed to a human clinician (routedTo:'clinician-review'), and any autonomous escalation is blocked (policy.rpm.no-autonomous-escalation); and longitudinal monitoring is consent-gated — monitoring without the patient's consent is blocked (policy.rpm.consent-to-monitor). It also honors the HIPAA-audit policy. The monitored-metric catalog, thresholds, and red-flag cutoffs are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified remote-monitoring or clinical-alerting engine."
  },
  {
    name: "Agentforce Population Health & Risk Stratification",
    role: "Panel/cohort-level risk stratification + prioritized outreach worklist (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud population-health / risk-stratification analog, and a DETERMINISTIC (no-Claude) agent. Unlike every other patient-plane agent (which reasons over a SINGLE patient), this one reasons over a whole PANEL/COHORT at once — a new granularity. It ingests already-produced per-patient signals (intake severity, validated-assessment band, open care gaps, positive SDOH domains, medication-adherence status, monitored-symptom trend) and DETERMINISTICALLY stratifies each patient into a risk tier (low / rising / high) with a TRANSPARENT additive/weighted risk model — a pure function of the signals (no randomness, no clock), so the same panel always yields the same tiers + worklist ordering with a stable, documented tie-break — then emits a prioritized outreach worklist for a human care manager. It is distinct from the single-patient Care Gap Closure, Remote Patient Monitoring, and Clinical Summary agents: this one is population-level prioritization / care-management triage. THREE load-bearing honesty properties are governance-enforced: every patient's tier must trace to the documented risk-factor spec — an opaque / off-spec / black-box score is blocked (policy.pophealth.transparent-risk-model); the risk model may NOT score on a protected-class attribute (race, ethnicity, gender identity, religion, etc.) — a fairness / responsible-AI requirement (policy.pophealth.no-protected-class-factors); and a risk tier is a prioritization signal only — it may NEVER trigger an autonomous care action, every tier→action requires human / care-manager review (policy.pophealth.no-autonomous-care-decision). It also honors the HIPAA-audit policy. The risk factors, weights, cutoffs, and patient references are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified risk-stratification model."
  },
  {
    name: "Agentforce Clinical Trials & Research Matching",
    role: "Structured trial-eligibility matching + consent-gated outreach (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud clinical-trials / research-matching analog, and a DETERMINISTIC (no-Claude) agent. It matches a SINGLE menopause/midlife patient against a SYNTHETIC study catalog using STRUCTURED eligibility criteria (age band, symptom profile, comorbidities, geography, prior therapy, HRT status, postmenopausal status), returns the matching studies ranked with per-criterion match explanations, and drafts a CONSENT-GATED outreach — it NEVER auto-enrolls a patient. Eligibility is a pure function of the patient context against each study's DEFINED criteria (dates, if any, are accepted as data — no randomness, no clock), so the same context always yields the same matches + ranking with a stable, documented tie-break (eligible first, then match score, then studyId). It ties thematically to the Consent & Preferences Management agent's `research` consent scope — deferring to that authoritative research-consent state before any outreach — but does its own eligibility logic, and is distinct from the single-patient Care Gap Closure and the panel-level Population Health agents: this one is trial / research eligibility matching. THREE load-bearing honesty properties are governance-enforced: every eligibility determination must trace to a defined study criterion — a fabricated / ad-hoc / off-catalog eligibility is blocked (policy.trials.eligibility-criteria-sourced); trial outreach is research-consent-gated — an active outreach without the patient's research consent is blocked, and when consent is absent the agent WITHHOLDS outreach (policy.trials.research-consent-required); and the agent may NEVER enroll a patient autonomously — enrollment requires informed consent + a human (policy.trials.no-autonomous-enrollment). It also honors the HIPAA-audit policy. The study catalog, sponsors, criteria, and patient references are ILLUSTRATIVE synthetics, clearly labeled — NOT real studies, real sponsors, or a certified trial-eligibility engine."
  },
  {
    name: "Agentforce Language Access & Health Equity",
    role: "LEP language access: qualified interpreter + approved materials + equity gaps (whole-person care)",
    tier: "whole-person-care",
    detail:
      "A patient-care EQUITY agent, and a DETERMINISTIC (no-Claude) agent, that ensures limited-English-proficiency (LEP) patients can actually understand their care. It DETERMINISTICALLY determines the patient's PREFERRED LANGUAGE (deferring in copy to the Consent & Preferences Management agent's preferred-language preference), decides whether a QUALIFIED MEDICAL INTERPRETER is required and of which modality (in-person / video / phone), checks whether the needed PATIENT MATERIALS exist in that language (from an approved translated-materials catalog, each with a translation-provenance label), and FLAGS EQUITY / ACCESS GAPS (no qualified interpreter available for a language, a consent form only in English). The assessment is a pure function of the patient's structured context against the supported-language + approved-materials catalogs (no randomness, no clock), so the same context always yields the same assessment with a stable, documented equity-gap ordering. It reuses the existing whole-person-care tier (the SDOH / equity tier — a health-equity / access activity), not a new tier, and is distinct from the SDOH, consent, and clinical agents. THREE load-bearing honesty properties are governance-enforced: clinical interpretation must use a QUALIFIED medical interpreter — an untrained / ad-hoc / family interpreter (or machine translation) for clinical communication is blocked (policy.langaccess.qualified-interpreter-only), and when no qualified interpreter is available the agent ESCALATES to a human language-access coordinator (a safe answer, not a block) rather than substituting an unqualified option; every in-language material presented as official must trace to the approved translated-materials catalog — an unverified / ad-hoc translation is blocked (policy.langaccess.translated-material-source-integrity); and machine / auto translation may NEVER be used for clinical consent or clinical decision communication (policy.langaccess.no-machine-translation-for-consent). It also honors the HIPAA-audit policy. The supported-language list, interpreter availability, translated-materials catalog, and translation-provenance labels are ILLUSTRATIVE synthetics, clearly labeled — NOT a real interpreter roster, a real translated-document library, or a certified language-access system."
  },
  {
    name: "Agentforce HEDIS & Quality Reporting",
    role: "Panel-level HEDIS / Star measure rollup + human-approved submission (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud quality-reporting analog, and a DETERMINISTIC (no-Claude) agent. Unlike the single-patient Care Gap Closure agent (which drafts outreach for one patient's gaps) and the panel-level Population Health & Risk Stratification agent (which prioritizes patients), this one reports a whole PANEL against a defined set of HEDIS quality measures — numerator, denominator, catalog-sourced exclusions, and compliance RATE per measure — the artifact provider organizations owe payers under value-based-care contracts. The illustrative measure catalog covers menopause-relevant preventive-and-screening (Osteoporosis Screening in Women / OSW, Breast Cancer Screening / BCS), cardiovascular (Controlling High Blood Pressure / CBP, Statin Therapy for CVD / SPC), and behavioral (Tobacco Cessation Counseling / TCC) domains. The roll-up is a pure function of the panel signals + the caller-provided `asOfPeriod` accepted as data (no randomness, no clock), so the same panel + period always yields the same rates and gap lists, with a stable, documented per-measure denominator narrowing. THREE load-bearing honesty properties are governance-enforced: every scored measure must trace to the defined HEDIS measure catalog — an off-catalog / fabricated measure is blocked (policy.hedis.measure-catalog-sourced); every applied denominator exclusion must trace to a defined catalog exclusion on that measure — an ad-hoc / unlisted exclusion is blocked (policy.hedis.exclusion-integrity), the load-bearing rate-integrity guard against inflating a rate by shrinking the denominator; and the agent may NEVER autonomously submit a package to a payer / CMS / a quality registry — every submission requires a human quality-team approval (policy.hedis.no-autonomous-submission). It also honors the HIPAA-audit policy. The measure catalog, thresholds, and exclusion lists are ILLUSTRATIVE synthetics, clearly labeled — NOT NCQA-certified HEDIS specifications, real value sets, or a certified HEDIS engine."
  },
  {
    name: "Agentforce Advance Care Planning",
    role: "Midlife ACP touchpoint: catalog-sourced directives + human-signoff + LEP-safe conversation (whole-person care)",
    tier: "whole-person-care",
    detail:
      "A whole-person-care ACP TOUCHPOINT agent for the midlife/menopause patient, and a DETERMINISTIC (no-Claude) agent. It uses perimenopause / menopause as a natural midlife moment to surface which advance directives are on file (living will, DPOA-HC; POLST only when a serious-illness flag is on), flags missing / stale / language-access gaps against an illustrative directive catalog + approved-source list (verbal / ad-hoc sources deliberately excluded), and drafts a consent-gated conversation prompt for the care team to deliver. It is distinct from the Consent & Preferences Management agent (data-use consent) and the Care Plan agent (active treatment planning) — this one is about preserving the patient's voice if they lose decisional capacity, held at a midlife touchpoint rather than during acute illness. The assessment is a pure function of the caller-provided asOfDate + directives-on-file (no randomness, no clock), so the same context always yields the same assessment. THREE load-bearing honesty properties are governance-enforced: every claimed directive on file must trace to the defined ACP directive catalog AND an approved directive-source label with a recorded execution date — an off-catalog directive, an unapproved / verbal / ad-hoc source, or a missing execution date is blocked (policy.acp.directive-source-integrity), so the agent cannot fabricate a directive on file to inflate ACP completeness; the agent may NEVER autonomously create, update, or override a directive — every change is a clinician + patient sign-off gated proposal (policy.acp.no-autonomous-directive-change); and for a limited-English-proficiency (LEP) patient the active conversation prompt is gated on a documented qualified-interpreter plan — a plan claiming an active drafted prompt for an LEP patient with no interpreter is blocked (policy.acp.language-access-integrity), and when no plan is documented the agent WITHHOLDS the active prompt (a safe completed answer, not a block), deferring to the Language Access & Health Equity agent. It also honors the HIPAA-audit policy. The directive catalog, approved-source labels, and staleness threshold are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified advance-directives registry, a POLST/MOLST program, or a legal instrument."
  },
  {
    name: "Agentforce Care Team & Case Management",
    role: "Multi-disciplinary team assembly + case-manager assignment (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud care-team / case-management analog, and a DETERMINISTIC (no-Claude) agent. It reasons over a SINGLE high-need menopause/midlife patient (distinct from the panel-level Population Health & Risk Stratification agent, which prioritizes people across a whole panel) and COORDINATES clinicians around that patient: it resolves which roles are needed from the patient's active clinical needs against an illustrative care-role catalog + condition→role trigger map (PCP + MSCP universally required; cardiology / endocrinology / bone-health / pelvic-floor PT / behavioral health triggered by cardiovascular / bone-health / pelvic-floor / behavioral needs), assembles the roster of assigned members in role catalog order, assigns a case manager by a stable, documented hash on the patient ref, and emits a shared team snapshot the whole team reads from. The assembly is a pure function of the context + asOfDate (no randomness, no clock), so the same context always yields the same team + case manager + snapshot with a stable, documented gap ordering. THREE load-bearing honesty properties are governance-enforced: every team role — on the roster and in the needed-roles set — must trace to the defined care-role catalog, so an off-catalog / fabricated discipline label is blocked (policy.careteam.role-catalog-sourced), preventing an assembly from padding the roster with an invented role or claiming coverage for a needed role that doesn't exist; the agent may NEVER autonomously add or remove a team member (or reassign the case manager) — every roster change is a case-manager sign-off gated proposal, mirroring the ACP Agent's directive-change and the HEDIS Agent's submission posture (policy.careteam.no-autonomous-assignment); and a legitimate multi-disciplinary team must include a PCP anchor — a specialist-only roster shipping without an accountable primary-care owner is blocked (policy.careteam.pcp-required), a load-bearing continuity-of-care invariant. It also honors the HIPAA-audit policy. The care-role catalog, condition→role triggers, case-manager pool, member refs, and responsibility labels are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified care-team schema, a real provider directory, or a case-management workflow engine."
  },
  {
    name: "Agentforce Discharge & Transitions of Care",
    role: "Close-the-loop after a hospitalization / ED visit — medication reconciliation + scheduled follow-up + PCP handoff (care coordination)",
    tier: "care-coordination",
    detail:
      "The Salesforce 'Agentforce for Health' / Health Cloud transitions-of-care analog, and a DETERMINISTIC (no-Claude) agent. It runs the CLOSE-THE-LOOP workflow after a hospitalization / ED / observation encounter for a menopause/midlife patient — RECONCILING the discharge medication list against the pre-admit list (added / removed / dose-changed / unchanged, each tracing to an approved source), BOOKING the follow-up appointment (or drafting an appointment-request handoff to the Appointment Scheduling agent — never a text recommendation), pulling encounter-reason RED-FLAG warning signs from an illustrative catalog (vasomotor, cardiovascular, behavioral, musculoskeletal, general), emitting a TEACH-BACK checklist, and assembling the PCP HANDOFF summary. It is distinct from the Care Plan agent (active treatment planning), the Medication Adherence agent (nudge-only refill / adherence prompts), and the Referral Management agent (specialist triage) — this one closes the loop back to primary care after an acute event. The package is a pure function of the context + discharge date + provided lists (no randomness, no clock; timestamps are accepted as data), so the same context always yields the same reconciliation + red-flag list + teach-back checklist + PCP summary with a stable, documented ordering (sorted by medication id). THREE load-bearing honesty properties are governance-enforced: every medication on the reconciliation (pre-admit or discharge) must cite an approved medication source (pre-admit-verified, discharge-order, patient-verified, ehr-scanned-with-provenance) — a verbal / ad-hoc / undocumented source is blocked (policy.toc.reconciliation-source-integrity), the load-bearing safety guard against a fabricated medication slipping in; the agent may NEVER autonomously commit a medication change — every add / remove / dose-change is a clinician sign-off gated proposal, and an autonomous change is blocked (policy.toc.no-autonomous-medication-change); and the follow-up must be a SCHEDULED slot (slotStart + providerRef + modality) or explicitly awaiting-schedule (state:'awaiting-schedule', a safe interim answer with a handoff to Scheduling) — a package claiming a 'scheduled' or 'complete' follow-up without a real slot is blocked (policy.toc.follow-up-scheduled-not-recommended), the load-bearing 30-day-readmission guard against 'recommended' follow-ups masquerading as complete. It also honors the HIPAA-audit policy. The encounter categories, red-flag catalog, follow-up window (14 days), approved-source labels, and teach-back items are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified TOC schema, a real ADT / discharge system, or a clinical-guideline registry."
  },
  {
    name: "Pause MCP Server",
    role: "Data-plane tool surface",
    tier: "data-plane",
    detail:
      "Exposes the MuleSoft Experience APIs as MCP tools so any AI agent (Claude Desktop, Cursor, Agentforce Service Agent) can call get_patient_timeline, get_patient_intake, find_menopause_providers, experience_api_health as native tools."
  },
  {
    name: "MuleSoft Process / Experience APIs",
    role: "Integration plane",
    tier: "integration",
    detail:
      "Three-tier API-Led Connectivity on Anypoint. The single ground-truth substrate every agent reads from and writes to. JupyterHealth + DBDP + wearables stitched into one FHIR R5 plane."
  },
  {
    name: "Pause MCP Bridge",
    role: "A2A ↔ MCP egress (platform)",
    tier: "integration",
    detail:
      "The outbound complement to the Pause MCP Server: a per-request MCP host that lets fabric agents call EXTERNAL MCP tool servers, not just expose Pause's own. The Care Router uses it to resolve providers through find_menopause_providers over an ordered remote list — same-origin loopback first, then allow-listed partners in PAUSE_MCP_HOST_REMOTES — returning the first success and falling back to the direct call if every remote errors, so routing never regresses. An inbound bearer is forwarded only to the same-origin loopback, never cross-origin. Env-gated and off by default."
  },
  {
    name: "Salesforce Data 360 (grounding)",
    role: "Unified patient memory",
    tier: "data-grounding",
    detail:
      "Federates JupyterHealth, the customer's EHR, and the DBDP feature store via a zero-copy Iceberg connector — no bulk PHI is copied into Salesforce. Grounds the Care Router on a consented, unified patient view before every routing decision: grounding calls require an active ai-decision-support consent, and segments activate only to allow-listed downstream channels."
  },
  {
    name: "Consent & Preferences Management",
    role: "Authoritative consent ledger + preferences (platform · data substrate)",
    tier: "data-plane",
    detail:
      "The MuleSoft control-plane / data-substrate consent service, and the AUTHORITATIVE, cross-cutting consent & communication-preferences store the rest of the fabric's consent-before-outreach / consent-before-referral / consent-to-monitor gates logically defer to. Unlike every other agent (which CONSUMES consent — the SDOH, Patient Education, Remote Monitoring, Care Gap, and Engagement agents each check a consent gate), this one is the SOURCE OF TRUTH FOR consent: it holds, per patient, a consent LEDGER (scopes — contact-outreach, data-sharing, remote-monitoring, research, marketing — each granted / withheld / revoked with a recorded basis, a timestamp, and an optional expiry) and communication PREFERENCES (allowed channels sms/email/voice, quiet hours, preferred language, frequency cap), and answers one DETERMINISTIC question via evaluateConsent — 'may this patient be contacted / have data used for this scope over this channel at this time?' — denying a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch, or a frequency-cap breach, and otherwise allowing, citing the consent record it relied on. The decision is a pure function of the ledger + the query's own atTime + priorTouches (no randomness, no clock), so the same inputs always yield the same decision. It is a control-plane / data-substrate service on the PLATFORM plane, not a live-Claude agent — but because it holds patient consent data it IS on the HIPAA-audit policy (it is NOT a commercial-plane agent). THREE load-bearing honesty properties are governance-enforced: every consent state must trace to a recorded consent event/basis — an asserted-but-unrecorded consent is blocked (policy.consent.recorded-source); a revoked / expired consent must be honored immediately — a decision may never ALLOW against it (policy.consent.honor-revocation); and a decision may never override a withheld scope or borrow consent across scopes — an allow requires a granted, current record for that exact scope (policy.consent.no-scope-override). The consent scopes, recorded sources, preferences, and patient references are ILLUSTRATIVE synthetics, clearly labeled — NOT a certified consent-management / preference-center system."
  },
  {
    name: "Agentforce Pipeline Management",
    role: "Commercial plane · B2B pipeline (PHI-separated)",
    tier: "commercial-operations",
    detail:
      "Pause's own go-to-market, not a patient-facing agent. Works the B2B opportunity pipeline for provider-organization, health-system, and employer deals in Sales Cloud — stage progression, deal health, next-best-action — and rolls up committed/best-case/pipeline forecasts where every figure traces back to a CRM record. Runs on the commercial plane only: it cannot read patient PHI, which is also why it's off the HIPAA audit policy."
  },
  {
    name: "Agentforce Account Management",
    role: "Commercial plane · customer success (PHI-separated)",
    tier: "commercial-operations",
    detail:
      "Manages signed provider-org and employer accounts post-close: health scoring, renewal and QBR drafts, churn-risk and expansion signals. Never commits a contract or pricing change without a human account owner. Like pipeline management, it runs strictly on the commercial CRM plane and never touches patient PHI."
  }
];

const protocols = [
  {
    name: "Google Agent-to-Agent Protocol (A2A)",
    role: "Agent ↔ agent handoff",
    detail:
      "Open standard from Google donated to the Linux Foundation, endorsed by Anthropic, Salesforce, MuleSoft, and OpenAI. AgentCard discovery at /.well-known/agent.json, Task lifecycle, JSON-RPC over HTTP, optional SSE streaming. Pause's Agentforce → Care Router handoff is A2A end-to-end."
  },
  {
    name: "Model Context Protocol (MCP)",
    role: "Agent ↔ tool surface",
    detail:
      "Open standard from Anthropic now in cross-vendor adoption. Pause's MCP server (mcp/) exposes the four Experience-tier capabilities as MCP tools. The same surface is registered in Claude Desktop, Cursor, and the production Agentforce gateway."
  },
  {
    name: "FHIR R5 + Open mHealth",
    role: "Data substrate",
    detail:
      "The clinical data crossing every agent boundary. MuleSoft Process APIs transform Open mHealth wearable payloads into FHIR R5 Observations via DataWeave; the MCP tools return FHIR Bundles; the A2A messages carry FHIR-shaped data parts."
  }
];

const fabricCapabilities = [
  {
    title: "Agent registry",
    detail:
      "Every Pause agent self-registers on the fabric with its protocol (A2A / MCP / REST), endpoint, version, capabilities, governance tier, and the policies it operates under. The console at /demo/agent-fabric shows the live registry."
  },
  {
    title: "Policy enforcement",
    detail:
      "The policy catalog spans: model allow-list (Claude Sonnet / Opus only), no autonomous prescribing, mandatory red-flag screen, mandatory rationale, deterministic fallback on API failure, a validated-instrument allow-list on the Assessment Agent (only MRS / Greene / PHQ-9 / ISI may be administered and scored into an intake severity), an eligibility-source-integrity block on the Benefits & Coverage Verification agent (every returned coverage result must trace to a payer/clearinghouse EBV response — the agent may not fabricate coverage without a source), two scheduling blocks on the Appointment Scheduling agent (no double-booking an already-taken slot, and book only within the provider's published availability), a clinical-measure-sourced block on the Care Gap Closure agent (every preventive-care gap acted on must derive from a defined clinical measure — the agent may not act on a fabricated / off-catalog gap), a no-autonomous-refill block on the Medication Adherence agent (it may draft a refill/adherence nudge but may never autonomously submit or order a refill — a refill without human approval is blocked), a clinician-cosign block on the Referral Management agent (it may triage and draft an outbound specialist referral but may never send it without a clinician's sign-off — a send-without-cosign is blocked), a claim-data-sourced block on the Member Service / Billing agent (every billing/claim answer must trace to a synthetic claim/EOB record — the agent may not fabricate claim data), two prior-authorization blocks on the Prior Authorization agent (it may assemble a clinician-gated PA draft but may never autonomously submit a PA — a clinician must approve before submission — and a PA submission must include the required supporting documentation — an incomplete submission is blocked), a template-sourced block on the Care Plan agent (every instantiated care plan must derive from a defined template — the agent may not fabricate a plan) plus the model allow-list on that agent's live-Claude progress summary, MCP tool allow-list (plus the MCP Bridge's egress guards — a remote allow-list, an egress-side tool allow-list, and a no-cross-origin-bearer rule so an inbound token never leaks to an external MCP server), FHIR-R5-only substrate, mTLS for system-to-system, HIPAA audit log on every turn, plus the patient-lifecycle guards on the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement agents (inbound opt-in + source required and identity-resolution-before-create, contact-consent required, human approval before any message is sent, a lead-nurture cadence cap that suppresses on conversion/opt-out, a qualification rubric that requires rationale on every decision and forbids protected-class criteria with reviewable disqualifications, quiet-hours + channel preference, and an engagement frequency cap) — plus the commercial-plane guards on Pipeline Management and Account Management (a hard PHI-separation block so commercial agents never read patient data, forecast-figures-must-trace-to-CRM, and human-owner-before-any-contract-change). Block / audit / rate-limit / redact enforcement modes."
  },
  {
    title: "End-to-end trace observability",
    detail:
      "Every A2A handoff and MCP tool call is recorded as a span with parent/child correlation. A patient intake span becomes the parent of the Care Router span, which becomes the parent of the MCP timeline span. The full multi-agent trace is visible in one place."
  },
  {
    title: "Identity-based security",
    detail:
      "Production deployments wire agent-to-agent calls through the customer's OAuth / mTLS provider via MuleSoft. Bearer tokens are issued per agent identity and validated at the Anypoint gateway before any tool call reaches the MCP server or the Care Router."
  }
];

const protoVsProd = [
  {
    aspect: "Care Router model",
    proto:
      "Anthropic Claude Sonnet 4.5 via @anthropic-ai/sdk when ANTHROPIC_API_KEY is set; deterministic Pause policy engine otherwise.",
    prod:
      "Same SDK path, with the model selected from the customer's approved allow-list. Bring-your-own-cloud Anthropic on Bedrock / Vertex supported via env var."
  },
  {
    aspect: "A2A transport",
    proto:
      "JSON-RPC over HTTP (Next.js API route). No auth between agents; Agent Fabric records the trace.",
    prod:
      "JSON-RPC over HTTPS with mTLS or OAuth, brokered by the Anypoint API gateway. Identity claims propagate into the trace."
  },
  {
    aspect: "Agent Fabric runtime",
    proto:
      "In-memory mock (frontend/lib/agent-fabric.ts) shared across Next.js API routes. Console at /demo/agent-fabric.",
    prod:
      "MuleSoft Agent Fabric on Anypoint. Policies authored in the Agent Fabric console; trace export to Datadog / Splunk / OTel."
  },
  {
    aspect: "Policy authoring",
    proto:
      "Static catalog in frontend/lib/agent-fabric.ts. Read-only in the UI.",
    prod:
      "Authored by the customer's platform team in the Agent Fabric console, version-controlled, promoted across dev / staging / prod."
  },
  {
    aspect: "Trace store",
    proto:
      "200-span ring buffer in-process. Survives dev-mode hot reload.",
    prod:
      "Customer's observability stack (Datadog, Splunk, OpenTelemetry). MuleSoft trace shipper exports spans with HIPAA-compliant correlation IDs."
  }
];

const phases = [
  {
    name: "Phase 0 — Multi-agent prototype",
    duration: "Today",
    detail:
      "Thirty-three agents registered on the mocked Agent Fabric across three planes — the Inbound Lead Generation, Prospecting & Nurture, Qualification, and Engagement lifecycle agents bracketing Agentforce intake, the Assessment Agent that scores validated instruments into an intake severity, the Benefits & Coverage Verification (EBV) agent that runs a synthetic eligibility check before routing, the Care Router, the Care Plan agent that instantiates a template-sourced menopause care plan and summarizes progress with live Claude (the second live-Claude agent), the Appointment Scheduling agent that books the recommended MSCP visit and hands it to engagement, the Referral Management agent that triages intake + routing signals into cosign-gated outbound specialist referrals (generalizing the Care Router's behavioral-health handoff), the Member Service / Billing agent that answers claim-sourced billing & coverage self-service questions and routes out-of-scope requests to a human, the Prior Authorization agent (the heaviest, deliberately-last workflow) that assembles a clinician-gated, documentation-complete PA and never autonomously submits it, the Care Gap Closure agent that proactively detects Data-360-grounded, clinical-measure-sourced preventive-care gaps and drafts consent-aware outreach for engagement, the Medication Adherence agent that proactively tracks HRT/SSRI adherence + refill timing and drafts nudge-only refill reminders (never an autonomous refill) for engagement, and the Clinical Summary agent that composes the outputs the other agents already produced into a patient-friendly after-visit summary and a clinician handoff with live Claude (the third live-Claude agent), grounding every summary in the source records the context was assembled from so it can never fabricate a clinical fact, the SDOH Screening agent (whole-person care) that screens a patient for health-related social needs with the validated CMS AHC-HRSN core-domain tool, escalates the interpersonal-safety red flag to a human social worker, and drafts consent-gated community-resource referrals that are never an autonomous enrollment, the Patient Education & Health Coaching agent that turns the intake, care-plan, and care-gap signals into a deterministically-selected, evidence-sourced menopause/midlife education curriculum and coaches the patient with live Claude (the fourth live-Claude agent), staying strictly within general education with consent-gated outreach, the Remote Patient Monitoring & Symptom-Trend Tracking agent that ingests longitudinal symptom/vital readings, deterministically detects per-metric trends against a synthetic monitored-metrics catalog, and routes worsening or red-flag trends to a clinician for review without ever taking an autonomous clinical action, and the Population Health & Risk Stratification agent that reasons over a whole patient panel at once, deterministically stratifies each patient into a low/rising/high risk tier with a transparent, additive risk model that scores on no protected-class attribute, and builds a prioritized outreach worklist for a human care manager without ever making an autonomous care decision, the Clinical Trials & Research Matching agent that deterministically matches a single patient against a synthetic study catalog using structured eligibility criteria, ranks the matching studies with per-criterion explanations tracing to defined criteria, and drafts a research-consent-gated outreach that never auto-enrolls (informed consent + a human required), and the Language Access & Health Equity agent that determines a limited-English-proficiency patient's preferred language, deterministically decides whether a qualified medical interpreter is needed and of which modality, checks approved in-language materials, and flags equity gaps — using a qualified medical interpreter only (never a family / ad-hoc / machine interpreter), never machine-translating clinical consent, and escalating to a human coordinator when no qualified interpreter is available, the HEDIS & Quality Reporting agent that deterministically rolls up a whole panel against a defined HEDIS measure catalog into per-measure numerator / denominator / catalog-sourced exclusions / compliance rate for value-based-care contracts, and assembles a submission package that ALWAYS requires human quality-team approval (never autonomously filed to a payer / CMS / quality registry, and never inflated by an ad-hoc / unlisted denominator exclusion), the Advance Care Planning agent that uses perimenopause / menopause as a midlife touchpoint to surface which advance directives are on file (living will, DPOA-HC; POLST only for serious-illness patients), flags missing / stale / language-access gaps, and drafts a consent-gated conversation prompt for the care team — every directive on file traces to the catalog + an approved source, every directive change is clinician + patient sign-off gated (never autonomously applied), and for a limited-English-proficiency patient with no interpreter plan the active prompt is withheld until the Language Access agent has arranged a qualified interpreter (a safe answer, not a block), the Care Team & Case Management agent that assembles the multi-disciplinary team around a single high-need patient (PCP, MSCP, cardiology, endocrinology, bone-health, pelvic-floor PT, behavioral health), assigns a case manager by a stable-hash pick from a synthetic pool, and emits a shared team snapshot — every role traces to the catalog, every roster change requires case-manager sign-off (never autonomously applied), and a legitimate team must include a PCP anchor, and the Discharge & Transitions of Care agent that closes the loop back to primary care after a hospitalization / ED visit — deterministically reconciling the discharge medication list (added / removed / dose-changed, each tracing to an approved medication source and every change clinician-signoff gated), booking (or handing off to Scheduling for) the follow-up appointment as a real slot (never a text recommendation — the load-bearing 30-day-readmission guard), pulling encounter-reason red-flag warning signs, emitting the teach-back checklist, and assembling the PCP handoff summary — on the patient/clinical plane; the Pause MCP server, the MCP Bridge (A2A ↔ MCP egress), the MuleSoft integration plane, Data 360 grounding, and the Consent & Preferences Management agent (the authoritative consent ledger + communication-preference store the other agents' consent-before-outreach / consent-before-referral / consent-to-monitor gates defer to, deterministically deciding whether a patient may be contacted for a scope over a channel at a time while honoring revocations/expiries immediately and never overriding a scope) on the platform substrate; and the PHI-separated commercial-plane Pipeline Management and Account Management agents. End-to-end A2A handoff Agentforce → Care Router. MCP tool surface. /demo/agent-fabric console for monitoring. Live in this repo."
  },
  {
    name: "Phase 1 — Real Claude routing",
    duration: "1 week",
    detail:
      "Wire ANTHROPIC_API_KEY in Vercel (or BYO Bedrock / Vertex). Tune the system prompt with menopause clinicians. Hold the deterministic fallback in place as the safety net."
  },
  {
    name: "Phase 2 — First Agent Fabric customer",
    duration: "4–6 weeks with customer",
    detail:
      "Deploy the Care Router and MCP server behind the customer's MuleSoft Anypoint platform. Register the Agentforce Service Agent. Author the customer's policy set in the Agent Fabric console. Wire OAuth / mTLS."
  },
  {
    name: "Phase 3 — Multi-tenant fabric",
    duration: "Ongoing",
    detail:
      "Pause ships one set of agents and policies; each customer's Agent Fabric overrides what they need. Telemetry rolled up cross-customer for product analytics and clinical evaluation."
  }
];

const investorTakeaways = [
  {
    label: "Multi-agent is the right unit of analysis",
    detail:
      "Pause is not 'an AI chatbot.' It is a patient-facing agent, a clinical-decision agent, a data-plane agent, and an integration plane — wired through open protocols and governed by a single control plane. The architecture matches how buyers actually operate AI in healthcare."
  },
  {
    label: "Composable on open standards",
    detail:
      "Google A2A + Anthropic MCP + FHIR R5 + Open mHealth + DBDP + MuleSoft API-Led Connectivity. Every protocol is industry-endorsed, multi-vendor, and independently auditable. There is no Pause-proprietary glue at any tier."
  },
  {
    label: "Governance is built in, not bolted on",
    detail:
      "Every agent declares its policies. Every A2A and MCP call is traced. Every decision carries provenance (which model, which path, what red-flags). This is the posture a hospital compliance officer will sign off on — not a per-agent retrofit."
  },
  {
    label: "Same architecture, two product motions",
    detail:
      "B2C: patients hit Agentforce, get routed by Claude, see the right pathway. B2B: health systems install our agents on their own Anypoint + Agent Fabric and govern them. One stack, two go-to-market wedges."
  }
];

export default function AgentFabricInvestorPage() {
  return (
    <ProposalShell
      eyebrow="Investor brief · Multi-agent control plane"
      title="Thirty-three agents across three planes, two open protocols, one governed control plane"
      subtitle="Pause-Health.ai composes Agentforce (inbound lead generation, prospecting & nurture, qualification, intake, validated-instrument assessment, benefits & coverage verification, appointment scheduling, cosign-gated specialist referral management, engagement, proactive care-gap closure, nudge-only medication adherence, after-visit clinical summary, consent-gated SDOH / social-needs screening, and evidence-sourced patient education & health coaching, plus a PHI-separated commercial plane for pipeline & account management), Anthropic Claude (clinical routing, template-sourced care planning with a live-Claude progress summary, a live-Claude after-visit summary + clinician handoff, and live-Claude patient education coaching), the Pause MCP server (data-plane tools), MuleSoft (integration plane), and Data 360 (grounding) into a single multi-agent system — orchestrated, monitored, secured, and governed by a MuleSoft Agent Fabric control plane."
    >
      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">The agents on the fabric</p>
        <p style={{ marginTop: "0.4rem", color: "var(--muted)" }}>
          Grouped by plane. The patient/clinical and commercial planes are the
          PHI boundary — the platform plane is the shared data + integration
          substrate that serves the patient plane.
        </p>
        {PLANES_IN_ORDER.filter((plane) =>
          agents.some((a) => planeForTier(a.tier) === plane)
        ).map((plane) => {
          const meta = GOVERNANCE_PLANES[plane];
          const planeAgents = agents.filter(
            (a) => planeForTier(a.tier) === plane
          );
          return (
            <div key={plane} style={{ marginTop: "1.25rem" }}>
              <h3 style={{ margin: "0 0 0.15rem" }}>
                {meta.label}{" "}
                <span
                  style={{
                    color: "var(--muted)",
                    fontWeight: 500,
                    fontSize: "0.85rem"
                  }}
                >
                  · {planeAgents.length} agents
                </span>
              </h3>
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "0.9rem",
                  margin: "0 0 0.7rem",
                  maxWidth: "74ch"
                }}
              >
                {meta.description}
              </p>
              <div className="card-grid">
                {planeAgents.map((a) => (
                  <article key={a.name} className="card">
                    <h3>{a.name}</h3>
                    <p
                      style={{
                        color: "var(--brand)",
                        fontWeight: 600,
                        marginBottom: "0.4rem"
                      }}
                    >
                      {a.role} · {tierLabel(a.tier)}
                    </p>
                    <p>{a.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Protocols on the wire</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {protocols.map((p) => (
            <article key={p.name} className="card">
              <h3>{p.name}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  marginBottom: "0.4rem"
                }}
              >
                {p.role}
              </p>
              <p>{p.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">What the Agent Fabric does</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {fabricCapabilities.map((c) => (
            <article key={c.title} className="card">
              <h3>{c.title}</h3>
              <p>{c.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Touch the architecture</p>
        <p style={{ marginTop: "0.4rem" }}>
          The clickable prototype runs the full multi-agent flow end-to-end.
          Complete an intake on <a href="/demo/intake">/demo/intake</a> — the
          Agentforce-style intake hands off to the Anthropic Care Router over
          Google A2A, the Care Router calls the Pause MCP server for patient
          context, and every span is recorded in the Agent Fabric console.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <a href="/demo/agent-fabric" className="btn btn-primary">
            Open Agent Fabric console
          </a>
          <a href="/demo/intake" className="btn btn-secondary">
            Run an intake → A2A handoff
          </a>
          <a
            href="/api/agents/care-router/.well-known/agent.json"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Care Router Agent Card
          </a>
          <a
            href="/api/agent-fabric/agents"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Agent registry JSON
          </a>
          <a
            href="/api/agent-fabric/policies"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Policy catalog JSON
          </a>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Prototype vs production</p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>Aspect</th>
                <th>Prototype today</th>
                <th>Customer deployment</th>
              </tr>
            </thead>
            <tbody>
              {protoVsProd.map((row) => (
                <tr key={row.aspect}>
                  <td>
                    <strong>{row.aspect}</strong>
                  </td>
                  <td>{row.proto}</td>
                  <td>{row.prod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Phased plan</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {phases.map((phase) => (
            <article key={phase.name} className="card">
              <h3>{phase.name}</h3>
              <p
                style={{
                  color: "var(--brand)",
                  fontWeight: 600,
                  marginBottom: "0.5rem"
                }}
              >
                {phase.duration}
              </p>
              <p>{phase.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why investors should care</p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {investorTakeaways.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <strong style={{ fontWeight: 500 }}>{item.detail}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/agentforce">Agentforce intake</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The front-door agent that captures and hands off the structured
              intake.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mulesoft">MuleSoft integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The connectivity plane the Agent Fabric sits on top of.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/mcp">MCP server</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The data-plane tool surface every agent calls.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data-360">Data 360 grounding</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The unified patient memory layer Pause grounds the Care Router on
              before every routing decision.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://google-a2a.github.io/A2A/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google A2A specification
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The open agent-to-agent protocol Pause speaks.
            </strong>
          </li>
          <li>
            <span>
              <a
                href="https://www.salesforce.com/products/mulesoft/agent-fabric/"
                target="_blank"
                rel="noopener noreferrer"
              >
                MuleSoft Agent Fabric
              </a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Salesforce control plane Pause's deployment composes with.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
