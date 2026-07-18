/**
 * Health-Related Social Needs (HRSN) / SDOH screening + community-resource
 * referral drafting.
 *
 * Deterministic, dependency-free domain core the SDOH Screening Agent
 * (app/api/agents/sdoh-screening) wraps — the "Agentforce for Health"
 * whole-person-care analog on Pause's Agent Fabric. It screens a patient for
 * social determinants of health / health-related social needs using a
 * validated, public-domain instrument, deterministically flags the positive
 * social-need domains, escalates the interpersonal-safety red flag to a human
 * social worker, and drafts CONSENT-GATED community-resource referrals. There
 * is NO LLM here: every determination is real rule-based logic, so the agent is
 * honestly live rather than a stub.
 *
 *   Inbound:  an SdohScreeningResponse (screener id + per-domain responses)
 *   Outbound: an SdohScreeningResult (per-domain positive/negative, an overall
 *             count of positive social-need domains, and any red flags) plus
 *             consent-gated CommunityReferralDraft[]
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Instrument: CMS Accountable Health Communities HRSN screening tool.
 * ─────────────────────────────────────────────────────────────────────
 *  The screener modeled here is the CMS Accountable Health Communities
 *  Health-Related Social Needs (AHC-HRSN) screening tool's five CORE domains
 *  (public domain): housing instability, food insecurity, transportation
 *  needs, utility needs, and interpersonal safety. Like the Assessment Agent's
 *  validated-instrument allow-list, the SDOH agent refuses to administer any
 *  screener not on ALLOWLISTED_SDOH_SCREENERS — enforced at the governance
 *  boundary by policy.sdoh.validated-screener-only, and defended in depth by
 *  screenSocialNeeds() throwing on an off-list screener.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTIES.
 * ─────────────────────────────────────────────────────────────────────
 *  1. Interpersonal-safety RED FLAG: a positive interpersonal-safety screen
 *     (the HITS domain, cutoff-based) is a mandatory escalation to a human
 *     social worker — mirroring the Assessment Agent's PHQ-9 item 9 handling.
 *  2. CONSENT-GATED referral, NO autonomous enrollment: a community-resource
 *     referral is only ever a DRAFT prepared for human action and requires the
 *     patient's explicit consent — the agent never autonomously enrolls a
 *     patient in a program. sdohReferralHasConsent() reports the honest signal
 *     the Agent Fabric enforces via policy.sdoh.consent-before-referral (a
 *     referral asserted without consent → false → blocked).
 *  3. SDOH is SEPARATE from clinical severity: a positive social-need domain
 *     raises a care-coordination flag (sdohToIntakeSignal), NOT an intake
 *     clinical severity. Whole-person care complements the clinical agents.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: illustrative synthetic thresholds + resources.
 * ─────────────────────────────────────────────────────────────────────
 *  The per-domain positivity rules below follow the AHC-HRSN tool's published
 *  scoring where one exists (the Hunger Vital Sign two-item food screen; the
 *  HITS interpersonal-safety cutoff of >10). The community-resource catalog
 *  (211, food bank, housing/utility assistance, a domestic-violence hotline)
 *  is ILLUSTRATIVE — a demo-honest model of the SHAPE of a closed-loop referral,
 *  NOT a live directory of real programs. There is NO randomness and NO clock
 *  anywhere here: screening is a pure function of the responses the caller
 *  passes, so the same responses always screen identically — which is what lets
 *  the demo, the seeded trace, and the tests agree.
 */

/** The SDOH / HRSN screeners the agent is allowed to administer. */
export type SdohScreener = "ahc-hrsn";

/**
 * The allow-list. The SDOH Screening Agent refuses to administer or score
 * anything not on this list — enforced at the governance boundary by
 * policy.sdoh.validated-screener-only, and defended in depth by
 * screenSocialNeeds() throwing on an off-list screener.
 */
export const ALLOWLISTED_SDOH_SCREENERS: readonly SdohScreener[] = [
  "ahc-hrsn"
] as const;

/** The five AHC-HRSN core social-need domains. */
export type SdohDomainId =
  | "housing"
  | "food"
  | "transportation"
  | "utilities"
  | "safety";

/** A captured set of per-domain responses for one screener. */
export type SdohScreeningResponse = {
  screener: SdohScreener;
  /**
   * One integer vector per screener domain, keyed by domain id. Each value
   * must be within the domain's per-item range (validated at screen time). No
   * free-text fields — only the structured coded responses cross the boundary.
   */
  responses: Partial<Record<SdohDomainId, number[]>>;
};

/** The deterministic evaluation of one social-need domain. */
export type SdohDomainResult = {
  id: SdohDomainId;
  label: string;
  /** True when the domain screens positive (an identified social need). */
  positive: boolean;
  /** A domain-native score when the domain uses a cutoff (e.g. HITS total). */
  score?: number;
  /** Non-clinical, human-readable detail safe to record as a trace attribute. */
  detail: string;
};

/** A flagged high-risk domain (the interpersonal-safety screen). */
export type SdohRedFlag = {
  domain: SdohDomainId;
  code: string;
  description: string;
};

/** The structured, deterministic output of screening one instrument. */
export type SdohScreeningResult = {
  screener: SdohScreener;
  screenerName: string;
  domains: SdohDomainResult[];
  /** The ids of the domains that screened positive, in domain order. */
  positiveDomains: SdohDomainId[];
  /** The count of positive social-need domains. */
  positiveDomainCount: number;
  /** Interpersonal-safety red flag(s) — a mandatory human-social-worker escalation. */
  redFlags: SdohRedFlag[];
  /** One-line, non-clinical interpretation safe to record as a trace attribute. */
  interpretation: string;
};

/** Type guard: is `x` a screener on the validated allow-list? */
export function isAllowlistedSdohScreener(x: unknown): x is SdohScreener {
  return (
    typeof x === "string" &&
    (ALLOWLISTED_SDOH_SCREENERS as readonly string[]).includes(x)
  );
}

type SdohDomainSpec = {
  id: SdohDomainId;
  label: string;
  itemCount: number;
  /** Inclusive per-item minimum (0 for most; 1 for the HITS Likert items). */
  itemMin: number;
  /** Inclusive per-item maximum. */
  itemMax: number;
  /** Deterministic positivity determination + optional score + a detail line. */
  evaluate: (responses: number[]) => {
    positive: boolean;
    score?: number;
    detail: string;
  };
  /** True for the interpersonal-safety domain — a positive screen is a red flag. */
  redFlag?: boolean;
};

type SdohScreenerSpec = {
  id: SdohScreener;
  name: string;
  domains: SdohDomainSpec[];
};

/**
 * The AHC-HRSN core-domain spec. Domains are administered in the tool's
 * canonical order (housing, food, transportation, utilities, interpersonal
 * safety). Positivity rules follow the published scoring where one exists.
 */
const AHC_HRSN_SPEC: SdohScreenerSpec = {
  id: "ahc-hrsn",
  name: "CMS Accountable Health Communities HRSN screening tool (core domains)",
  domains: [
    {
      id: "housing",
      label: "Housing instability",
      // item 0: living situation (0 = steady place; 1 = worried about losing
      // it; 2 = no steady place). item 1: count of housing-quality problems
      // (pests, mold, no heat, no/broken smoke detectors, water leaks, ...).
      itemCount: 2,
      itemMin: 0,
      itemMax: 7,
      evaluate: (r) => {
        const livingSituation = r[0] ?? 0;
        const problems = r[1] ?? 0;
        const positive = livingSituation >= 1 || problems >= 1;
        const detail = positive
          ? `housing instability (living-situation code ${livingSituation}, ${problems} quality problem${problems === 1 ? "" : "s"})`
          : "stable housing, no quality problems reported";
        return { positive, detail };
      }
    },
    {
      id: "food",
      label: "Food insecurity",
      // Hunger Vital Sign two-item screen. Each item: 0 = never true,
      // 1 = sometimes true, 2 = often true. Positive if either is endorsed.
      itemCount: 2,
      itemMin: 0,
      itemMax: 2,
      evaluate: (r) => {
        const worried = r[0] ?? 0;
        const ranOut = r[1] ?? 0;
        const positive = worried >= 1 || ranOut >= 1;
        const detail = positive
          ? "food insecurity (Hunger Vital Sign endorsed)"
          : "no food insecurity reported";
        return { positive, detail };
      }
    },
    {
      id: "transportation",
      label: "Transportation needs",
      // item 0: lack of transportation kept you from medical appointments,
      // work, or getting things needed (0 = no, 1 = yes).
      itemCount: 1,
      itemMin: 0,
      itemMax: 1,
      evaluate: (r) => {
        const positive = (r[0] ?? 0) >= 1;
        return {
          positive,
          detail: positive
            ? "transportation kept the patient from care, work, or daily needs"
            : "no transportation barrier reported"
        };
      }
    },
    {
      id: "utilities",
      label: "Utility needs",
      // item 0: utility company threatened to shut off services in the past
      // 12 months (0 = no; 1 = yes; 2 = already shut off).
      itemCount: 1,
      itemMin: 0,
      itemMax: 2,
      evaluate: (r) => {
        const code = r[0] ?? 0;
        const positive = code >= 1;
        return {
          positive,
          detail: positive
            ? code >= 2
              ? "utilities already shut off"
              : "utility company threatened to shut off services"
            : "no utility shutoff risk reported"
        };
      }
    },
    {
      id: "safety",
      label: "Interpersonal safety",
      // HITS (Hurt, Insult, Threaten, Scream). Each item is a 1-5 frequency
      // Likert (1 = never ... 5 = frequently); the total ranges 4-20 and a
      // published cutoff of >10 indicates a positive interpersonal-safety
      // screen. A positive screen is a mandatory human-social-worker escalation.
      itemCount: 4,
      itemMin: 1,
      itemMax: 5,
      redFlag: true,
      evaluate: (r) => {
        const total = r.reduce((acc, v) => acc + (v ?? 0), 0);
        const positive = total > 10;
        return {
          positive,
          score: total,
          detail: positive
            ? `positive interpersonal-safety screen (HITS ${total}/20, cutoff >10) — human escalation required`
            : `interpersonal-safety screen negative (HITS ${total}/20)`
        };
      }
    }
  ]
};

const SCREENERS: Record<SdohScreener, SdohScreenerSpec> = {
  "ahc-hrsn": AHC_HRSN_SPEC
};

/** Look up the (immutable) spec metadata for an allow-listed screener. */
export function getScreenerSpec(screener: SdohScreener): {
  id: SdohScreener;
  name: string;
  domains: { id: SdohDomainId; label: string; itemCount: number }[];
} {
  const spec = SCREENERS[screener];
  return {
    id: spec.id,
    name: spec.name,
    domains: spec.domains.map((d) => ({
      id: d.id,
      label: d.label,
      itemCount: d.itemCount
    }))
  };
}

/**
 * Deterministically screen a validated SDOH instrument.
 *
 * Throws when:
 *   - the screener is not on the validated allow-list (defense in depth behind
 *     policy.sdoh.validated-screener-only), or
 *   - a domain's response vector is the wrong length or carries an out-of-range
 *     value (garbage in must not silently produce a plausible screen).
 */
export function screenSocialNeeds(
  input: SdohScreeningResponse
): SdohScreeningResult {
  if (!isAllowlistedSdohScreener(input.screener)) {
    throw new Error(
      `Screener "${String(
        input.screener
      )}" is not on the validated SDOH allow-list (${ALLOWLISTED_SDOH_SCREENERS.join(
        ", "
      )})`
    );
  }
  const spec = SCREENERS[input.screener];
  const responses = input.responses ?? {};

  for (const domain of spec.domains) {
    const vec = responses[domain.id];
    if (!Array.isArray(vec) || vec.length !== domain.itemCount) {
      throw new Error(
        `${spec.name} domain "${domain.id}" expects ${domain.itemCount} response${
          domain.itemCount === 1 ? "" : "s"
        }; received ${Array.isArray(vec) ? vec.length : "non-array"}`
      );
    }
    for (let i = 0; i < vec.length; i++) {
      const v = vec[i];
      if (!Number.isInteger(v) || v < domain.itemMin || v > domain.itemMax) {
        throw new Error(
          `${spec.name} domain "${domain.id}" item ${i + 1} response "${v}" is out of range (${domain.itemMin}-${domain.itemMax})`
        );
      }
    }
  }

  const domains: SdohDomainResult[] = spec.domains.map((d) => {
    const ev = d.evaluate(responses[d.id] as number[]);
    return {
      id: d.id,
      label: d.label,
      positive: ev.positive,
      ...(ev.score !== undefined ? { score: ev.score } : {}),
      detail: ev.detail
    };
  });

  const positiveDomains = domains.filter((d) => d.positive).map((d) => d.id);

  const redFlags: SdohRedFlag[] = spec.domains
    .filter((d) => d.redFlag)
    .flatMap((d) => {
      const res = domains.find((x) => x.id === d.id);
      if (!res || !res.positive) return [];
      return [
        {
          domain: d.id,
          code: "ahc-hrsn-interpersonal-safety",
          description:
            "AHC-HRSN interpersonal-safety domain screened positive — mandatory escalation to a human social worker."
        }
      ];
    });

  const interpretation = `${spec.name}: ${positiveDomains.length} positive social-need domain${
    positiveDomains.length === 1 ? "" : "s"
  }${positiveDomains.length > 0 ? ` (${positiveDomains.join(", ")})` : ""}.${
    redFlags.length > 0
      ? " Interpersonal-safety red flag — escalation to a human social worker required."
      : ""
  }`;

  return {
    screener: spec.id,
    screenerName: spec.name,
    domains,
    positiveDomains,
    positiveDomainCount: positiveDomains.length,
    redFlags,
    interpretation
  };
}

/** A community resource in the (illustrative) referral catalog. */
export type CommunityResource = {
  /** Stable catalog id every referral draft must reference. */
  id: string;
  /** Human-readable resource label. */
  label: string;
  /** The social-need domain this resource addresses ("general" = catch-all). */
  domain: SdohDomainId | "general";
  /**
   * The (illustrative) resource this maps to. NOT a live directory entry — a
   * demo-honest model of the SHAPE of a community-resource referral.
   */
  description: string;
};

/**
 * The community-resource catalog. This is the ONLY source of legitimate
 * referral drafts — draftCommunityReferralsForResult() iterates over these, so
 * a returned referral can never reference a resource that isn't defined here.
 * Illustrative/synthetic values; NOT a live directory of real programs.
 */
export const COMMUNITY_RESOURCES: CommunityResource[] = [
  {
    id: "resource.211-helpline",
    label: "211 community-resource helpline",
    domain: "general",
    description:
      "The 211 helpline connects the patient to local health & human-services resources across every social-need domain. (Illustrative — not a live directory entry.)"
  },
  {
    id: "resource.housing-assistance",
    label: "Local housing assistance / rental support",
    domain: "housing",
    description:
      "Rental assistance, emergency housing, and housing-stability programs for a patient with housing instability. (Illustrative — not a live directory entry.)"
  },
  {
    id: "resource.food-bank",
    label: "Local food bank / SNAP enrollment help",
    domain: "food",
    description:
      "A local food bank plus SNAP enrollment assistance for a patient screening positive for food insecurity. (Illustrative — not a live directory entry.)"
  },
  {
    id: "resource.transportation-assistance",
    label: "Non-emergency medical transportation / transit assistance",
    domain: "transportation",
    description:
      "Non-emergency medical transportation and transit-assistance programs for a patient with a transportation barrier. (Illustrative — not a live directory entry.)"
  },
  {
    id: "resource.utility-assistance",
    label: "Utility assistance (LIHEAP)",
    domain: "utilities",
    description:
      "The Low Income Home Energy Assistance Program (LIHEAP) and local utility-assistance funds for a patient at risk of a utility shutoff. (Illustrative — not a live directory entry.)"
  },
  {
    id: "resource.dv-hotline",
    label: "Domestic-violence / interpersonal-safety hotline",
    domain: "safety",
    description:
      "A confidential domestic-violence / interpersonal-safety hotline and warm hand-off to a human social worker for a positive interpersonal-safety screen. (Illustrative — not a live directory entry.)"
  }
];

const RESOURCE_BY_DOMAIN = new Map(
  COMMUNITY_RESOURCES.map((r) => [r.domain, r])
);

/** Is `id` a defined community-resource catalog id? */
export function isCommunityResource(id: string): boolean {
  return COMMUNITY_RESOURCES.some((r) => r.id === id);
}

/** The catalog resource that addresses a given domain (undefined if none). */
export function resourceForDomain(
  domain: SdohDomainId | "general"
): CommunityResource | undefined {
  return RESOURCE_BY_DOMAIN.get(domain);
}

/**
 * A drafted community-resource referral. EXPLICITLY consent-gated and never an
 * autonomous enrollment: the agent drafts this for a human to review and act
 * on with the patient's consent, and never enrolls the patient itself.
 */
export type CommunityReferralDraft = {
  /** The community-resource catalog id this referral is about. */
  resourceId: string;
  resourceLabel: string;
  /** The social-need domain this referral addresses. */
  domain: SdohDomainId | "general";
  /** Draft body (no free-text PII; resource + call-to-connect only). */
  body: string;
  /** Always true — a community referral requires the patient's explicit consent. */
  requiresPatientConsent: true;
  /** Always false — the agent never autonomously enrolls a patient in a program. */
  autonomousEnrollment: false;
  /** True when the patient hasn't consented, so the draft is suppressed. */
  suppressedForNoConsent: boolean;
  /** Always true — the draft is for human review; the prototype never sends. */
  requiresHumanApproval: true;
  /** Always false — nothing is sent autonomously. */
  sent: false;
  /** The human this draft is handed to (a social worker for the safety domain). */
  handoffTo: "social-worker" | "community-health-worker";
};

/**
 * Draft a single consent-gated community-resource referral for a resource.
 * Deterministic on its inputs. The draft is ALWAYS consent-gated and never an
 * autonomous enrollment (requiresPatientConsent: true, autonomousEnrollment:
 * false, requiresHumanApproval: true, sent: false). When the patient hasn't
 * consented the draft is marked suppressed — a referral is never prepared for
 * action without consent.
 */
export function draftCommunityReferral(
  resource: CommunityResource,
  opts: { patientConsent?: boolean } = {}
): CommunityReferralDraft {
  const hasConsent = opts.patientConsent === true;
  const handoffTo = resource.domain === "safety" ? "social-worker" : "community-health-worker";

  const body = hasConsent
    ? `Connect the patient to ${resource.label.toLowerCase()}. ${resource.description} ` +
      `Drafted for a ${handoffTo.replace("-", " ")} to review and act on with the patient — no autonomous enrollment.`
    : `Suppressed: no patient consent on file for a ${resource.label.toLowerCase()} referral. ` +
      `No referral will be drafted for action until the patient consents.`;

  return {
    resourceId: resource.id,
    resourceLabel: resource.label,
    domain: resource.domain,
    body,
    requiresPatientConsent: true,
    autonomousEnrollment: false,
    suppressedForNoConsent: !hasConsent,
    requiresHumanApproval: true,
    sent: false,
    handoffTo
  };
}

/**
 * Draft consent-gated community-resource referrals for a screening result: one
 * per positive social-need domain (mapped to its catalog resource), plus the
 * 211 general helpline whenever any domain is positive. Deterministic on its
 * inputs. Every draft references a catalog resource by construction — the
 * integrity property the Agent Fabric relies on — and each is consent-gated and
 * never an autonomous enrollment.
 */
export function draftCommunityReferralsForResult(
  result: Pick<SdohScreeningResult, "positiveDomains">,
  opts: { patientConsent?: boolean } = {}
): CommunityReferralDraft[] {
  const drafts: CommunityReferralDraft[] = [];
  for (const domain of result.positiveDomains) {
    const resource = resourceForDomain(domain);
    if (resource) drafts.push(draftCommunityReferral(resource, opts));
  }
  if (drafts.length > 0) {
    const general = resourceForDomain("general");
    if (general) drafts.push(draftCommunityReferral(general, opts));
  }
  return drafts;
}

/**
 * The consent an SDOH referral action carries. A community-resource referral is
 * only authorized with the patient's explicit consent — this is the honest
 * signal the route reports to policy.sdoh.consent-before-referral.
 */
export type SdohReferralConsent = {
  /** Whether the patient explicitly consented to a community-resource referral. */
  patientConsent?: boolean;
};

/**
 * The honest governance signal: does this referral action carry the patient's
 * explicit consent? TRUE only when the patient consented; FALSE for a
 * caller-asserted referral with no (or a withheld) consent. The route reports
 * this to policy.sdoh.consent-before-referral, which blocks when it is false —
 * so the agent can never draft a community-resource referral for action without
 * the patient's consent, and it can never autonomously enroll a patient.
 */
export function sdohReferralHasConsent(
  consent?: SdohReferralConsent | null
): boolean {
  return consent?.patientConsent === true;
}

/**
 * The honest governance signal for the screener allow-list: is `screener` on
 * the validated SDOH allow-list? The route reports this to
 * policy.sdoh.validated-screener-only, which blocks when it is false.
 */
export function usesValidatedSdohScreener(screener: unknown): boolean {
  return isAllowlistedSdohScreener(screener);
}

/**
 * A care-coordination signal derived from a screening result. SDOH is
 * conceptually SEPARATE from clinical severity: a positive social-need domain
 * raises a whole-person care-coordination flag (and a safety escalation when
 * the interpersonal-safety red flag fires), NOT an intake clinical severity —
 * so this composes with the intake spine WITHOUT ever changing
 * IntakeRecord.severity. Whole-person care complements the clinical agents.
 */
export type SdohCareCoordinationSignal = {
  socialNeedsIdentified: boolean;
  positiveDomainCount: number;
  positiveDomains: SdohDomainId[];
  /** True when the interpersonal-safety red flag fired (human escalation). */
  safetyEscalation: boolean;
};

/** Map a screening result onto its care-coordination signal (never a severity). */
export function sdohToIntakeSignal(
  result: SdohScreeningResult
): SdohCareCoordinationSignal {
  return {
    socialNeedsIdentified: result.positiveDomains.length > 0,
    positiveDomainCount: result.positiveDomainCount,
    positiveDomains: result.positiveDomains,
    safetyEscalation: result.redFlags.length > 0
  };
}
