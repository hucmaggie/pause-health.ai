/**
 * Single source of truth for provider display labels.
 *
 * Three surfaces render the same provider data — the directory index
 * (`/provider`), the profile page (`/provider/[npi]`), and the shared
 * `RecommendedProviders` list (Care Router decision card + scripted intake
 * fallback). They previously each carried their own copies of these maps,
 * which meant adding a new NPPES signal token or insurance plan was a
 * three-file edit that silently drifted. They now all read from here.
 *
 * Two deliberate vocabularies for the service-line signals:
 *   - SIGNAL_LABELS         — compact ("Board-cert OB/GYN"), for chip rows and
 *                             inline lists where horizontal space is tight.
 *   - SIGNAL_LABELS_VERBOSE — spelled-out ("Board-certified OB/GYN"), for the
 *                             single-provider profile where space allows.
 * Insurance plan labels are identical everywhere, so there's one map.
 *
 * Fallback rule for every lookup: an unknown token renders as its raw
 * lowercase value — the honest answer for a real-but-unrecognized code.
 */

/** Compact service-line signal labels (chip rows, inline recommendation lists). */
export const SIGNAL_LABELS: Record<string, string> = {
  facog: "Board-cert OB/GYN",
  faafp: "Board-cert family med",
  face: "Board-cert endocrinology",
  facp: "Board-cert internal med",
  whnp: "Women's Health NP",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty"
};

/** Spelled-out signal labels for the single-provider profile page. */
export const SIGNAL_LABELS_VERBOSE: Record<string, string> = {
  facog: "Board-certified OB/GYN",
  faafp: "Board-certified family medicine",
  face: "Board-certified endocrinology",
  facp: "Board-certified internal medicine",
  whnp: "Women's Health Nurse Practitioner",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty practice"
};

/** Canonical insurance-plan tokens → display labels (identical on every surface). */
export const PLAN_LABELS: Record<string, string> = {
  medicare: "Medicare",
  medicaid: "Medicaid",
  aetna: "Aetna",
  bcbs: "BCBS",
  uhc: "UHC",
  cigna: "Cigna",
  humana: "Humana",
  kaiser: "Kaiser"
};

/** `[token, label]` pairs for the directory's insurance `<select>`. */
export const PLAN_OPTIONS = Object.entries(PLAN_LABELS);

/** Compact human label for a service-line signal token (raw token if unknown). */
export function signalLabel(token: string): string {
  return SIGNAL_LABELS[token] ?? token;
}

/** Spelled-out human label for a service-line signal token (raw token if unknown). */
export function signalLabelVerbose(token: string): string {
  return SIGNAL_LABELS_VERBOSE[token] ?? token;
}

/** Human label for an insurance-plan token (raw token if unknown). */
export function planLabel(token: string): string {
  return PLAN_LABELS[token] ?? token;
}
