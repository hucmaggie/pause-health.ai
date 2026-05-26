import { NextResponse } from "next/server";
import { listSegments } from "../../../../lib/data-360";

/**
 * Mocked Salesforce Data 360 segments:
 *   GET /api/data-360/segments
 *
 * Returns the population segments currently active on the customer's
 * Data 360 deployment. Each segment names its criteria and the
 * downstream channels it is activated to (Agentforce, the Agent
 * Fabric, Health Cloud, etc.).
 *
 * The Agent Fabric subscribes to segment-membership events so it can
 * route proactive outreach (e.g. Agentforce nudges) without the
 * patient ever opening an intake session.
 */
export async function GET() {
  const segments = listSegments();
  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Salesforce Data 360 segment catalog. In production segments are authored in the Data 360 console; activation routes are configured per segment to Agentforce, MuleSoft, Health Cloud, and the MuleSoft Agent Fabric.",
        _segmentCount: segments.length,
        _totalPatients: segments.reduce((s, x) => s + x.patientCount, 0)
      },
      segments
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
