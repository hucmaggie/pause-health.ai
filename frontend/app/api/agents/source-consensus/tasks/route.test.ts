import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CONSENSUS_NO_MAJORITY_REQUEST,
  DEMO_CONSENSUS_REQUEST,
  DEMO_CONSENSUS_UNANIMOUS_REQUEST,
  evaluateConsensus
} from "../../../../../lib/source-consensus";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/source-consensus/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the strict-majority demo — the block base. */
const VALID_DETERMINATION = evaluateConsensus(DEMO_CONSENSUS_REQUEST);

describe("POST /api/agents/source-consensus/tasks", () => {
  it("consensus → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-sc-consensus-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONSENSUS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("consensus");
    expect(body.result.metadata.agentFabric.candidate).toBe("Endocrinology");
    expect(body.result.metadata.agentFabric.candidateCount).toBe(4);
    expect(body.result.metadata.agentFabric.consensusVotesSourced).toBe(true);
    expect(body.result.metadata.agentFabric.consensusConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.consensusNoAutonomousWrite).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("consensus.receive-votes");
    expect(ops).toContain("consensus.run-majority-vote");
    expect(ops).toContain("consensus.classify-consensus");
    expect(ops).toContain("consensus.log-audit");
    const voteSpan = spans.find((s) => s.operation === "consensus.run-majority-vote");
    expect(voteSpan?.agentId).toBe("source-consensus-agent");
    expect(voteSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("no-majority → completed, no-consensus", async () => {
    const res = await POST(
      rpc({
        id: "test-sc-nomajority-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONSENSUS_NO_MAJORITY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("no-consensus");
    expect(body.result.metadata.agentFabric.hasConsensus).toBe(false);
    expect(body.result.metadata.agentFabric.candidate).toBeNull();
  });

  it("unanimous → completed, consensus", async () => {
    const res = await POST(
      rpc({
        id: "test-sc-unanimous-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONSENSUS_UNANIMOUS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.candidate).toBe("82-1147739");
  });

  it("blocks a fabricated source (votes-sourced)", async () => {
    const taskId = "test-sc-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONSENSUS_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  agreements: VALID_DETERMINATION.agreements.map((a, i) =>
                    i === 4 ? { ...a, sourceId: "phantom-feed" } : a
                  )
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.consensus.votes-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "consensus.run-majority-vote.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "consensus.log-audit")).toBe(false);
  });

  it("blocks a wrong winner (consensus-consistent)", async () => {
    const res = await POST(
      rpc({
        id: "test-sc-wrongwinner-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONSENSUS_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  candidate: "Internal Medicine",
                  candidateCount: 1
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.consensus.consensus-consistent");
  });

  it("blocks an autonomous write (no-autonomous-write)", async () => {
    const res = await POST(
      rpc({
        id: "test-sc-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONSENSUS_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresStewardReview: false,
                  autoWritten: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.consensus.no-autonomous-write");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/source-consensus/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/source-consensus/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
