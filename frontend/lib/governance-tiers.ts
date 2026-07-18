/**
 * Single source of truth for agent governance tiers and the planes they group
 * into. Dependency-free so both the server registry (lib/agent-fabric.ts) and
 * the client console (/demo/agent-fabric) can import it without pulling the
 * whole fabric into the browser bundle.
 *
 * The GovernanceTier union lives here and is referenced by AgentRecord, so the
 * GOVERNANCE_TIERS record below is exhaustive by construction: adding a tier to
 * the union without giving it a label + plane is a compile error.
 */

export type GovernanceTier =
  | "patient-facing"
  | "benefits-verification"
  | "care-coordination"
  | "clinical-decision"
  | "data-plane"
  | "integration"
  | "data-grounding"
  | "patient-acquisition"
  | "lead-qualification"
  | "patient-engagement"
  | "care-gap"
  | "commercial-operations";

/**
 * The three planes the fabric separates agents into. The patient/clinical
 * plane and the commercial plane are the PHI boundary; the platform plane is
 * the shared data + integration substrate that serves the patient plane.
 */
export type GovernancePlane = "patient-care" | "platform" | "commercial";

export const GOVERNANCE_PLANES: Record<
  GovernancePlane,
  { label: string; order: number; description: string }
> = {
  "patient-care": {
    order: 0,
    label: "Patient & clinical plane",
    description:
      "Everything that touches a patient or a clinical decision — acquisition, qualification, intake, routing, and post-conversion engagement. PHI lives here and is governed by the HIPAA audit policy."
  },
  platform: {
    order: 1,
    label: "Platform & data substrate",
    description:
      "The shared data and integration layer that serves the patient plane — Data 360 grounding, the Pause MCP server, and the MuleSoft process tier. Federated, consent-gated, allow-listed."
  },
  commercial: {
    order: 2,
    label: "Commercial plane · PHI-separated",
    description:
      "Pause's own B2B go-to-market in Sales Cloud. Strictly separated from the clinical plane: these agents cannot read patient PHI, which is why they are deliberately NOT on the HIPAA audit policy."
  }
};

export const GOVERNANCE_TIERS: Record<
  GovernanceTier,
  { label: string; plane: GovernancePlane }
> = {
  "patient-facing": { label: "Patient-facing", plane: "patient-care" },
  "benefits-verification": {
    label: "Benefits verification",
    plane: "patient-care"
  },
  "care-coordination": { label: "Care coordination", plane: "patient-care" },
  "clinical-decision": { label: "Clinical decision", plane: "patient-care" },
  "patient-acquisition": { label: "Patient acquisition", plane: "patient-care" },
  "lead-qualification": { label: "Lead qualification", plane: "patient-care" },
  "patient-engagement": { label: "Patient engagement", plane: "patient-care" },
  "care-gap": { label: "Care gap closure", plane: "patient-care" },
  "data-plane": { label: "Data plane", plane: "platform" },
  integration: { label: "Integration", plane: "platform" },
  "data-grounding": { label: "Data grounding", plane: "platform" },
  "commercial-operations": {
    label: "Commercial operations",
    plane: "commercial"
  }
};

/** Planes in display order. */
export const PLANES_IN_ORDER: GovernancePlane[] = (
  Object.keys(GOVERNANCE_PLANES) as GovernancePlane[]
).sort((a, b) => GOVERNANCE_PLANES[a].order - GOVERNANCE_PLANES[b].order);

/** Friendly label for a tier slug; falls back to the raw slug if unknown. */
export function tierLabel(tier: string): string {
  return (GOVERNANCE_TIERS as Record<string, { label: string }>)[tier]?.label ??
    tier;
}

/** The plane a tier slug belongs to, or undefined if the slug is unknown. */
export function planeForTier(tier: string): GovernancePlane | undefined {
  return (
    GOVERNANCE_TIERS as Record<string, { plane: GovernancePlane }>
  )[tier]?.plane;
}
