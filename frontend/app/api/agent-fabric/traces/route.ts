import { NextResponse } from "next/server";
import { listRecentTaskIds, listTraces } from "../../../../lib/agent-fabric";

/**
 * Mocked MuleSoft Agent Fabric: Trace Viewer.
 *
 *   GET /api/agent-fabric/traces                 -> recent task ids
 *   GET /api/agent-fabric/traces?taskId=<id>     -> full span tree
 *   GET /api/agent-fabric/traces?limit=50        -> last N spans across tasks
 *
 * Spans are emitted by every Pause agent through
 * `recordInstantSpan()` in lib/agent-fabric.ts. In production these
 * are exported to the customer's observability backend (Datadog,
 * Splunk, OpenTelemetry) via the MuleSoft trace shipper.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") ?? undefined;
  const limit = searchParams.get("limit");

  if (!taskId && !limit) {
    const recentTaskIds = listRecentTaskIds(10);
    return NextResponse.json(
      {
        meta: {
          _note:
            "Mocked Pause Agent Fabric trace viewer. Index of recent task ids; query ?taskId=<id> for the full span tree."
        },
        recentTaskIds
      },
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const traces = listTraces({
    taskId,
    limit: limit ? Math.max(1, Math.min(200, Number(limit) || 0)) : undefined
  });

  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Pause Agent Fabric trace viewer. Span tree for the queried task / range.",
        _query: { taskId, limit },
        _spanCount: traces.length
      },
      traces
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
