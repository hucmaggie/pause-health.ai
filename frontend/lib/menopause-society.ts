/**
 * The Menopause Society — "Find a Menopause Practitioner" referral helpers.
 *
 * The Menopause Society (formerly NAMS) hosts a public ASP.NET WebForms
 * directory at portal.menopause.org with three search modes:
 *   1. By country
 *   2. By US ZIP code  (US only)
 *   3. By telehealth   (US state only)
 *
 * Their terms of use explicitly prohibit republishing or scraping the
 * directory or embedding it in promotional contexts. This module
 * deliberately only constructs DEEP LINKS into the official portal so
 * patients land on The Menopause Society's own page with their search
 * pre-populated. We never fetch, parse, or cache directory results
 * server-side.
 *
 * The URL shapes below were captured from the live portal on 2026-05-25.
 * They are the WebForms QueryMenuSelectedKey values that the page itself
 * uses when you switch between search modes.
 */

const PORTAL_BASE = "https://portal.menopause.org/NAMS/NAMS/Directory/Menopause-Practitioner.aspx";

const SEARCH_KEYS = {
  byCountry: "5cb1c02f-e5a3-4696-b8e0-d2430f861e3d",
  byZip: "2",
  byTelehealth: "3"
} as const;

export type DirectorySearchMode = keyof typeof SEARCH_KEYS;

export type DirectoryLinkOptions = {
  /** US ZIP code. When present, the URL uses the by-ZIP search mode. */
  zip?: string;
  /** US two-letter state code. Used when no ZIP is supplied for telehealth match. */
  state?: string;
  /** Force a specific search mode. Defaults to inferring from the supplied fields. */
  mode?: DirectorySearchMode;
};

/**
 * Build a URL that opens The Menopause Society's "Find a Menopause Practitioner"
 * directory pre-set to the appropriate search mode for the patient's location.
 *
 * Notes on the WebForms portal:
 *   - The directory does not accept the ZIP value via querystring; the
 *     value is filled into a form input client-side after the page loads.
 *     We therefore route the user to the right TAB (by-ZIP, by-state, etc.)
 *     and let them confirm. This is intentional — auto-submitting on their
 *     behalf would arguably violate the directory's terms of use.
 *   - We pass the search-mode key on a stable querystring key that the
 *     portal recognizes today. If they change keys we will need to refresh
 *     this module; the change is small and centralized here.
 */
export function mscpDirectoryUrl(options: DirectoryLinkOptions = {}): string {
  const { zip, state, mode } = options;

  const inferredMode: DirectorySearchMode = mode
    ? mode
    : zip
      ? "byZip"
      : state
        ? "byTelehealth"
        : "byCountry";

  const params = new URLSearchParams({
    QueryMenuSelectedKeyctl01_TemplateBody_WebPartManager1_gwpciNewQueryMenuCommon_ciNewQueryMenuCommon:
      SEARCH_KEYS[inferredMode]
  });

  return `${PORTAL_BASE}?${params.toString()}`;
}

/**
 * Human-readable copy paired with the link. Kept here so the wording
 * stays consistent across the prototype, the proposal pages, and any
 * future patient-facing handoffs.
 */
export const MSCP_DIRECTORY_LABELS = {
  title: "Find a Menopause Society Certified Practitioner",
  subtitle:
    "MSCPs have passed The Menopause Society's competency examination — a credential that specifically tests menopause knowledge above and beyond a clinician's primary specialty.",
  ctaByZip: "Search MSCPs near you by ZIP",
  ctaByState: "Search MSCPs by telehealth state",
  ctaGeneric: "Search MSCPs on menopause.org",
  attribution:
    "Directory hosted by The Menopause Society (formerly NAMS). Pause-Health.ai does not endorse, list, or represent any practitioner."
} as const;
