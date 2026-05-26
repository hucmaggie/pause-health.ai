import { NextResponse } from "next/server";
import { resolveIdentity } from "../../../../../lib/data-360";

/**
 * Mocked Salesforce Data 360 Identity Resolution:
 *   POST /api/data-360/identity/resolve
 *
 * Given a partial identity payload from intake (preferred name, age
 * band, cycle status, and any external ids), returns the unified
 * Data 360 patient id with resolution provenance.
 *
 * In production Data 360 IR runs a configurable ruleset across all
 * federated sources and returns a confidence-scored match. The
 * prototype stub always returns the demo id; the wire shape matches.
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
  const resolution = resolveIdentity(body);
  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Salesforce Data 360 Identity Resolution. Production deployments run the customer's IR ruleset across federated sources and may return multiple candidates with confidence scores."
      },
      resolution
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
