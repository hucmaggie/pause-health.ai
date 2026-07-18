import { describe, expect, it } from "vitest";

import { POST } from "./route";
import { getProviderAvailability } from "../../../../../lib/scheduling";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/appointment-scheduling/tasks", {
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

const PROVIDER = "1720394857";
const MONDAY = "2026-02-02";

describe("POST /api/agents/appointment-scheduling/tasks", () => {
  it("books an appointment and returns the structured booking + engagement handoff", async () => {
    const taskId = "test-scheduling-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                schedulingRequest: {
                  providerId: PROVIDER,
                  providerName: "Dr. Elena Vasquez, MD, MSCP",
                  modality: "telehealth",
                  requestedDate: MONDAY
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // Booked appointment is handed to the Engagement Agent for reminders.
    expect(body.result.metadata.agentFabric.nextAgent).toBe("engagement-agent");
    expect(typeof body.result.metadata.agentFabric.serviceAppointmentId).toBe(
      "string"
    );

    const data = dataPart(body).data as {
      booking: {
        modality: string;
        status: string;
        slotStart: string;
        source: { synthetic: boolean };
      };
      summary: { synthetic: boolean; serviceAppointmentId: string };
    };
    expect(data.booking.modality).toBe("telehealth");
    expect(data.booking.status).toBe("booked");
    expect(data.booking.source.synthetic).toBe(true);
    expect(data.summary.synthetic).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("scheduling.book");
    // The engagement handoff span is recorded on the same task.
    const handoff = spans.find(
      (s) => s.operation === "engagement.reminder.schedule"
    );
    expect(handoff?.agentId).toBe("engagement-agent");
    const book = spans.find((s) => s.operation === "scheduling.book");
    expect(book?.agentId).toBe("appointment-scheduling-agent");
    expect(book?.attributes?.synthetic).toBe(true);
  });

  it("reads a bare data object as the scheduling request", async () => {
    const taskId = "test-scheduling-bare-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { providerId: PROVIDER, modality: "in-person", requestedDate: MONDAY }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.modality).toBe("in-person");
  });

  it("blocks a booking that would double-book an already-taken slot", async () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const booked = avail.slots.find((s) => s.status === "booked")!;
    const modality = booked.modalities[0];
    const taskId = "test-scheduling-doublebook-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                schedulingRequest: {
                  providerId: PROVIDER,
                  modality,
                  requestedSlotStart: booked.start
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
    expect(violationIds).toContain("policy.scheduling.no-double-book");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "scheduling.book.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "scheduling.book")).toBe(false);
  });

  it("blocks a booking outside the provider's published availability", async () => {
    const taskId = "test-scheduling-availability-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                schedulingRequest: {
                  providerId: PROVIDER,
                  modality: "telehealth",
                  // 03:00 is never a published business-hours slot.
                  requestedSlotStart: `${MONDAY}T03:00:00`
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
    expect(violationIds).toContain(
      "policy.scheduling.honor-provider-availability"
    );
  });

  it("blocks a caller-asserted booking that carries no scheduling source", async () => {
    const taskId = "test-scheduling-nosource-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                booking: {
                  serviceAppointmentId: "sa-fabricated",
                  providerId: PROVIDER,
                  providerName: "Totally Real Provider",
                  modality: "telehealth",
                  slotStart: `${MONDAY}T09:00:00`,
                  slotEnd: `${MONDAY}T09:30:00`,
                  durationMinutes: 30,
                  status: "booked",
                  serviceType: "mscp-specialist-visit"
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    // A source-less asserted booking trips both scheduling invariants.
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.scheduling.no-double-book");
    expect(violationIds).toContain(
      "policy.scheduling.honor-provider-availability"
    );
  });

  it("reschedules an existing appointment (status rescheduled)", async () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const open = avail.slots.find((s) => s.status === "open")!;
    const modality = open.modalities[0];
    const taskId = "test-scheduling-reschedule-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                schedulingRequest: {
                  providerId: PROVIDER,
                  modality,
                  requestedSlotStart: open.start,
                  intent: "reschedule",
                  rescheduleFrom: { serviceAppointmentId: "sa-prior" }
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.status).toBe("rescheduled");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "scheduling.reschedule")).toBe(true);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/appointment-scheduling/tasks", {
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
      new Request("http://localhost/api/agents/appointment-scheduling/tasks", {
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
