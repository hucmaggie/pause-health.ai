import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/clinical-trials/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

function dataPart(body: {
  result: { artifacts: { parts: { type: string; data?: unknown }[] }[] };
}) {
  return body.result.artifacts[0].parts.find(
    (p: { type: string }) => p.type === "data"
  ) as { type: "data"; data: Record<string, unknown> };
}

const PATIENT = {
  patientRef: "trial-patient-001",
  ageBand: "51-55",
  postmenopausal: true,
  symptoms: ["hot_flashes", "insomnia"],
  comorbidities: [],
  region: "US-CA",
  onHrt: false
};

describe("POST /api/agents/clinical-trials/tasks", () => {
  it("matches a patient and drafts a consent-gated outreach; records a parented trace", async () => {
    const taskId = "test-trials-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: PATIENT, researchConsent: true } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.eligibilityTracesToCriteria).toBe(true);
    expect(body.result.metadata.agentFabric.researchConsentPresent).toBe(true);
    expect(body.result.metadata.agentFabric.enrollmentRequiresHuman).toBe(true);
    expect(body.result.metadata.agentFabric.eligibleCount).toBe(3);
    expect(body.result.metadata.agentFabric.outreachState).toBe("drafted");

    const data = dataPart(body).data as {
      result: {
        matches: { studyId: string; eligible: boolean }[];
        recommendedStudyIds: string[];
        outreach: { state: string; enrolled: boolean; requiresHuman: boolean };
      };
    };
    expect(data.result.matches.length).toBeGreaterThan(0);
    expect(data.result.recommendedStudyIds.length).toBe(3);
    // The agent never enrolls.
    expect(data.result.outreach.enrolled).toBe(false);
    expect(data.result.outreach.requiresHuman).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("trials.load-catalog");
    expect(ops).toContain("trials.match");
    expect(ops).toContain("trials.draft-outreach");
    const match = spans.find((s) => s.operation === "trials.match");
    expect(match?.agentId).toBe("clinical-trials-agent");
    expect(match?.attributes?.phiAccessed).toBe(true);
    const outreach = spans.find((s) => s.operation === "trials.draft-outreach");
    expect(outreach?.attributes?.enrolled).toBe(false);
  });

  it("WITHHOLDS outreach when research consent is absent but still completes (safe answer, not a block)", async () => {
    const taskId = "test-trials-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { patient: PATIENT, researchConsent: false } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // Producing the safe (withheld) outreach is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.outreachState).toBe("consent-required");
    expect(body.result.metadata.agentFabric.researchConsentPresent).toBe(true);
  });

  it("blocks a fabricated / off-catalog eligibility (eligibility-criteria-sourced)", async () => {
    const taskId = "test-trials-fabricated-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                matches: [
                  {
                    studyId: "study.vms-nonhormonal-rct",
                    title: "?",
                    eligible: true,
                    matchedCriteria: [{ criterionId: "crit.fabricated-ad-hoc" }],
                    failedCriteria: [],
                    matchScore: 1
                  }
                ]
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.trials.eligibility-criteria-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "trials.match.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "trials.match")).toBe(false);
  });

  it("blocks an active outreach asserted without research consent (research-consent-required)", async () => {
    const taskId = "test-trials-outreach-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                outreach: {
                  state: "drafted",
                  invitedStudyIds: ["study.vms-nonhormonal-rct"],
                  body: "override",
                  researchConsentPresent: false,
                  requiresInformedConsent: true,
                  requiresHuman: true,
                  enrolled: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.trials.research-consent-required");
  });

  it("blocks an autonomous enrollment (no-autonomous-enrollment)", async () => {
    const taskId = "test-trials-autoenroll-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                outreach: {
                  state: "drafted",
                  invitedStudyIds: ["study.vms-nonhormonal-rct"],
                  body: "override",
                  researchConsentPresent: true,
                  requiresInformedConsent: true,
                  requiresHuman: false,
                  enrolled: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.trials.no-autonomous-enrollment");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/clinical-trials/tasks", {
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
      new Request("http://localhost/api/agents/clinical-trials/tasks", {
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
