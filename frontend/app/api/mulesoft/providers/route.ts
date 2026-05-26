import { NextResponse } from "next/server";
import { queryProviderDirectory } from "../../../../lib/mulesoft-mocks";

/**
 * Mocked Pause-Health.ai Experience API:
 *   GET /api/mulesoft/providers?zip=92614&menopause=true&limit=10
 *
 * Production equivalent: MuleSoft Experience API
 *   `pause-provider-directory-experience-api`
 * which composes CMS NPPES, MSCP credential lists, state board
 * registries, and Pause's internal closed-loop referral outcomes
 * into a single ranked provider directory.
 *
 * Today the directory is a hand-curated synthetic slice (see
 * `frontend/lib/mulesoft-mocks.ts` and `/proposal/provider-graph`).
 * The shape and filtering UX are real so MCP clients can integrate
 * against a stable contract.
 *
 * The MCP server (mcp/) exposes this as the `find_menopause_providers`
 * tool.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zipRaw = searchParams.get("zip") ?? undefined;
  const zip = zipRaw && /^\d{3,5}$/.test(zipRaw) ? zipRaw : undefined;
  const menopauseOnly =
    searchParams.get("menopause") === "true" ||
    searchParams.get("menopauseOnly") === "true";
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw) || 0)) : undefined;

  const payload = queryProviderDirectory({ zip, menopauseOnly, limit });

  const meta = {
    _note:
      "Mocked Pause-Health.ai Experience API for the provider directory. See /proposal/provider-graph for the production data-sourcing strategy (CMS NPPES + MSCP + state boards + closed-loop referrals).",
    _generatedBy: "next.js mock @ /api/mulesoft/providers",
    _mcpToolEquivalent: "find_menopause_providers"
  };

  return NextResponse.json(
    { meta, ...payload },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
