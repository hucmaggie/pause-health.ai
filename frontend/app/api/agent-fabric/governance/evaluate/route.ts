import { NextResponse } from "next/server";
import {
  evaluateGovernance,
  type GovernanceTask
} from "../../../../../lib/agent-fabric";

/**
 * Mocked MuleSoft Agent Fabric: Pre-flight Governance Evaluator.
 *
 *   POST /api/agent-fabric/governance/evaluate
 *   {
 *     "agentId": "care-router-claude",
 *     "task": {
 *       "hasRedFlagScreen": true,
 *       "requestedModel": "claude-sonnet-4-5-20250929",
 *       "hasRationaleField": true
 *     }
 *   }
 *
 * Used by /demo/agent-fabric's "Run test case" button to show what
 * the gate looks like in isolation. The Care Router invokes the same
 * evaluator in-process on every inbound A2A task.
 *
 * The task shape is the shared GovernanceTask so this route stays in
 * lockstep with what evaluateGovernance() actually checks (Care Router
 * signals plus the lifecycle + commercial-plane signals). Every field is
 * optional; unknown fields are ignored.
 */
export async function POST(req: Request) {
  type Body = {
    agentId?: string;
    task?: GovernanceTask;
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const agentId = body.agentId ?? "care-router-claude";
  const task = body.task ?? {};
  const result = evaluateGovernance({ agentId, task });
  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Pause Agent Fabric pre-flight policy evaluator. In production this is enforced inline by the Anypoint API gateway and by each agent's inbound middleware."
      },
      result
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
