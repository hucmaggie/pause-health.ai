import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../../../lib/data-360";
import { resolveIdentityFromOrg } from "../../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../../lib/salesforce/auth";

/**
 * Salesforce Data 360 Identity Resolution:
 *   POST /api/data-360/identity/resolve
 *
 * Given a partial identity payload from intake (preferred name, age
 * band, cycle status, and any external ids), returns the unified
 * patient id with resolution provenance.
 *
 * Dual-mode:
 *   - If SF_* env vars are set, attempts to match against seeded
 *     Pause Demo Contacts in the org via name + hint. Returns the real
 *     Salesforce Contact.Id as `unifiedPatientId` with `_source: "real"`.
 *   - Otherwise falls back to the deterministic mock with the demo
 *     id and `_source: "mock"`.
 */
export async function POST(req: Request) {
  type Body = {
    preferredName?: string;
    ageBand?: string;
    cycleStatus?: string;
    externalIds?: Record<string, string>;
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let source: "real" | "mock" = "mock";
  let resolution = resolveIdentity(body);

  if (isSalesforceConfigured()) {
    try {
      const real = await resolveIdentityFromOrg(body);
      if (real) {
        source = "real";
        resolution = real;
      }
    } catch (err) {
      console.warn(
        "[data-360/identity/resolve] Real-org identity resolution failed; degrading to mock:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return NextResponse.json(
    {
      meta: {
        _source: source,
        _salesforceConfigured: isSalesforceConfigured(),
        _note:
          source === "real"
            ? "Live identity resolution against your Salesforce Health Cloud org (Phase 1: deterministic Contact match by preferredName + hint). Data Cloud IR ruleset replaces this in Phase 2."
            : "Deterministic mock. Set SF_INSTANCE_URL / SF_CLIENT_ID / SF_CLIENT_SECRET to enable real-org resolution. Production deployments run the customer's IR ruleset across federated sources and may return multiple candidates with confidence scores."
      },
      resolution
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
