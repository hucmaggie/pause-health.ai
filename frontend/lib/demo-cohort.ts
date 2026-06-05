/**
 * Canonical Pause Demo Cohort.
 *
 * The same six menopause-shaped personas the Salesforce seeder
 * (`scripts/salesforce-seed.mjs`) writes into the configured Health
 * Cloud org. Centralizing the cohort here means:
 *
 *   1. The `/demo/intake` queue table, the "View as" patient picker,
 *      and the seeder all stay in sync. There is exactly one
 *      authoritative list of demo patients.
 *   2. The prechat-context API route can hand the live Agentforce
 *      Service Agent a deterministic patient profile when the
 *      patient picker selects one of these personas — even before
 *      the agent reads any Salesforce object — and the agent's
 *      Health Cloud grounding will still match because the seeder
 *      created Contacts with the same FirstName/LastName.
 *
 * Field meanings:
 *   - displaySymptoms / displayRisk / displayWait / displaySource:
 *     cosmetic strings for the public "Live menopause care queue"
 *     card; do NOT have to match raw Salesforce values.
 *   - firstName / lastName: must match the seeder exactly so the
 *     Salesforce grounding module can resolve by name. Live in the
 *     real org as Contact records under "Pause Demo Patient" Title.
 *   - ageBand / cycleStatus / primarySymptom: shape inputs forwarded
 *     to `getGroundingContextPreferReal({ hint: ... })`.
 *   - vasomotorScore / sleepScore / moodScore: 0-10 hint scores
 *     embedded in Contact.Description by the seeder; surface to the
 *     Care Router and the prechat dossier as triage signals.
 *   - profileNote: investor-facing one-liner explaining what's
 *     clinically interesting about this persona; surfaces to the
 *     agent in the Patient_Context_JSON hidden prechat field so
 *     the agent has narrative context, not just numbers.
 *
 * Keeping this module pure-data (no Salesforce calls, no env reads)
 * lets it import safely from both server routes and client
 * components.
 */

export type DemoPersona = {
  /** Stable client-side id used in URLs and React keys. */
  id: string;
  firstName: string;
  lastName: string;
  ageBand: string;
  cycleStatus: string;
  primarySymptom: string;
  vasomotorScore: number;
  sleepScore: number;
  moodScore: number;
  profileNote: string;
  displaySymptoms: string;
  displayRisk: "Low" | "Moderate" | "High" | "Critical";
  displayWait: string;
  displaySource: string;
};

export const DEMO_COHORT: DemoPersona[] = [
  {
    id: "anika-patel",
    firstName: "Anika",
    lastName: "Patel",
    ageBand: "45-49",
    cycleStatus: "Perimenopausal",
    primarySymptom: "Hot flashes",
    vasomotorScore: 7,
    sleepScore: 4,
    moodScore: 3,
    profileNote:
      "Daily vasomotor symptoms x 8 months. No cardiometabolic flags. MSCP virtual visit candidate.",
    displaySymptoms: "Hot flashes, night sweats, sleep disruption",
    displayRisk: "Moderate",
    displayWait: "12m",
    displaySource: "JupyterHealth EHR + wearable sync"
  },
  {
    id: "brianna-okafor",
    firstName: "Brianna",
    lastName: "Okafor",
    ageBand: "50-54",
    cycleStatus: "Perimenopausal",
    primarySymptom: "Sleep disruption",
    vasomotorScore: 5,
    sleepScore: 8,
    moodScore: 5,
    profileNote:
      "Night sweats + insomnia. HRT discussion appropriate. Virtual visit candidate.",
    displaySymptoms: "Night sweats, insomnia, daytime fatigue",
    displayRisk: "Moderate",
    displayWait: "17m",
    displaySource: "JupyterHealth EHR + dbdp wearable sync"
  },
  {
    id: "carmen-diaz",
    firstName: "Carmen",
    lastName: "Diaz",
    ageBand: "55-59",
    cycleStatus: "Postmenopausal",
    primarySymptom: "Vaginal dryness",
    vasomotorScore: 2,
    sleepScore: 3,
    moodScore: 2,
    profileNote:
      "Postmenopausal x 3 years. GSM-predominant. Local therapy options pathway.",
    displaySymptoms: "GSM symptoms, dyspareunia, urinary urgency",
    displayRisk: "Low",
    displayWait: "21m",
    displaySource: "JupyterHealth EHR"
  },
  {
    id: "deepa-krishnan",
    firstName: "Deepa",
    lastName: "Krishnan",
    ageBand: "48-52",
    cycleStatus: "Perimenopausal",
    primarySymptom: "Hot flashes",
    vasomotorScore: 9,
    sleepScore: 7,
    moodScore: 4,
    profileNote:
      "Severe vasomotor + family history of CVD + BMI 31. Escalation: in-person MSCP recommended.",
    displaySymptoms: "Severe vasomotor + cardiometabolic risk markers",
    displayRisk: "High",
    displayWait: "6m",
    displaySource: "JupyterHealth EHR + claims + wearable"
  },
  {
    id: "elena-rossi",
    firstName: "Elena",
    lastName: "Rossi",
    ageBand: "46-50",
    cycleStatus: "Perimenopausal",
    primarySymptom: "Mood changes",
    vasomotorScore: 3,
    sleepScore: 5,
    moodScore: 8,
    profileNote:
      "Mood-predominant presentation. Behavioral health co-management recommended.",
    displaySymptoms: "Mood lability, anxiety spikes, passive low mood",
    displayRisk: "High",
    displayWait: "4m",
    displaySource: "JupyterHealth EHR + intake transcript"
  },
  {
    id: "fatima-khan",
    firstName: "Fatima",
    lastName: "Khan",
    ageBand: "51-55",
    cycleStatus: "Postmenopausal",
    primarySymptom: "Joint pain",
    vasomotorScore: 4,
    sleepScore: 4,
    moodScore: 4,
    profileNote:
      "Musculoskeletal-predominant. PT referral + lifestyle pathway.",
    displaySymptoms: "Joint pain, stiffness, functional decline",
    displayRisk: "Moderate",
    displayWait: "14m",
    displaySource: "JupyterHealth EHR"
  }
];

export function findDemoPersona(id: string): DemoPersona | null {
  return DEMO_COHORT.find((p) => p.id === id) || null;
}

/**
 * Returns the persona whose first name matches the input (case-
 * insensitive). The salesforce seeder writes Contact.FirstName
 * exactly as listed above, so this is the bridge between a
 * picker-driven `personaId` and the Salesforce identity-resolution
 * call that takes `preferredName`.
 */
export function findDemoPersonaByFirstName(name: string): DemoPersona | null {
  const want = name.trim().toLowerCase();
  return (
    DEMO_COHORT.find((p) => p.firstName.toLowerCase() === want) || null
  );
}

/**
 * Map a DemoPersona's display fields to the lowercase enum values the
 * Care Router (`lib/care-router.ts` / `IntakeRecord`) expects.
 *
 * The cohort displaySymptom strings are title-case for UI legibility
 * ("Hot flashes", "Sleep disruption"). The Care Router policy
 * normalizes to the symptom-cluster lowercase ids: hot_flashes,
 * sleep, mood, gsm, joint, bleeding. This mapper keeps both surfaces
 * aligned so a "Run Care Router" button on /demo/routing can submit
 * the same intake shape the agent-fabric debug page uses.
 */
export function personaToCareRouterIntake(persona: DemoPersona): {
  preferredName: string;
  ageBand: string;
  cycleStatus: string;
  primarySymptom: string;
  severity: "mild" | "moderate" | "severe";
  redFlagsAcknowledged: "yes" | "no" | "none";
} {
  const sym = persona.primarySymptom.toLowerCase();
  let primarySymptom = "hot_flashes";
  if (sym.includes("hot flash") || sym.includes("vasomotor")) {
    primarySymptom = "hot_flashes";
  } else if (sym.includes("sleep")) {
    primarySymptom = "sleep";
  } else if (sym.includes("mood")) {
    primarySymptom = "mood";
  } else if (sym.includes("vaginal") || sym.includes("gsm")) {
    primarySymptom = "gsm";
  } else if (sym.includes("joint") || sym.includes("musculoskeletal")) {
    primarySymptom = "joint";
  } else if (sym.includes("bleed")) {
    primarySymptom = "bleeding";
  }

  // Map cycleStatus from the display label ("Perimenopausal",
  // "Postmenopausal") to the Care Router's enum.
  const cs = persona.cycleStatus.toLowerCase();
  let cycleStatus = "irregular";
  if (cs.includes("postmeno")) {
    cycleStatus = "stopped>=12mo";
  } else if (cs.includes("peri")) {
    cycleStatus = "irregular";
  }

  // Severity from the aggregate symptom score (V+S+M, 0-30).
  const total = persona.vasomotorScore + persona.sleepScore + persona.moodScore;
  let severity: "mild" | "moderate" | "severe" = "moderate";
  if (total >= 22) severity = "severe";
  else if (total < 12) severity = "mild";

  // Red flags: derive from profileNote text for the High/Critical
  // patients. The CVD/bleeding flags map to redFlagsAcknowledged='yes'
  // so the router can apply the safety policy.
  const note = persona.profileNote.toLowerCase();
  let redFlagsAcknowledged: "yes" | "no" | "none" = "none";
  if (/cvd|cardiometabolic|bleed/.test(note)) {
    redFlagsAcknowledged = "yes";
  }

  return {
    preferredName: persona.firstName,
    ageBand: persona.ageBand,
    cycleStatus,
    primarySymptom,
    severity,
    redFlagsAcknowledged
  };
}
