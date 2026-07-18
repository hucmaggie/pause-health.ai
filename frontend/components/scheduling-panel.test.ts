import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCHEDULING_PRESETS,
  buildSchedulingRequestBody,
  runSchedulingTask,
  schedulingViewFromTask
} from "./scheduling-panel";
import type { A2ATask } from "../lib/a2a";
import {
  bookAppointment,
  getProviderAvailability,
  hasSchedulingSource
} from "../lib/scheduling";

/**
 * Unit coverage for the /demo/intake Appointment Scheduling agent panel.
 * This repo tests components as node-env pure functions (see
 * benefits-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Scheduling agent,
 *   - that runSchedulingTask returns the resulting task,
 *   - and that schedulingViewFromTask lifts a confirmed booking and a
 *     governance block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/appointment-scheduling
 * actually returns (see that route + lib/scheduling).
 */

const PROVIDER = "1720394857";
const MONDAY = "2026-02-02";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(overrides?: {
  request?: Parameters<typeof bookAppointment>[0];
}): A2ATask {
  // Derive a realistic booking from the domain source of truth so the fixture
  // can't drift from what the agent actually returns.
  const booking = bookAppointment(
    overrides?.request ?? {
      providerId: PROVIDER,
      providerName: "Dr. Elena Vasquez, MD, MSCP",
      modality: "telehealth",
      requestedDate: MONDAY
    }
  );
  return {
    id: "scheduling-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AppointmentBooking",
        index: 0,
        parts: [{ type: "data", data: { booking, summary: {} } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: [
          "policy.scheduling.no-double-book",
          "policy.scheduling.honor-provider-availability"
        ],
        traceSpanId: "span-1",
        traceTaskId: "scheduling-abc",
        serviceAppointmentId: booking.serviceAppointmentId,
        modality: booking.modality,
        status: booking.status,
        nextAgent: "engagement-agent"
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "scheduling-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this appointment booking: policy.scheduling.no-double-book (slot already taken)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: [
          "policy.scheduling.no-double-book",
          "policy.scheduling.honor-provider-availability"
        ],
        violations: [
          {
            policyId: "policy.scheduling.no-double-book",
            reason: "slot already taken"
          }
        ]
      }
    }
  };
}

describe("SCHEDULING_PRESETS", () => {
  it("has a clean booking preset that auto-picks an open telehealth slot", () => {
    const preset = SCHEDULING_PRESETS.find((p) => p.id === "book-telehealth");
    expect(preset).toBeDefined();
    const booking = bookAppointment(preset!.request);
    expect(booking.status).toBe("booked");
    expect(booking.modality).toBe("telehealth");
    expect(hasSchedulingSource(booking)).toBe(true);
  });

  it("has a reschedule preset that produces a rescheduled booking", () => {
    const preset = SCHEDULING_PRESETS.find((p) => p.id === "reschedule");
    expect(preset).toBeDefined();
    expect(preset!.request.intent).toBe("reschedule");
    const booking = bookAppointment(preset!.request);
    expect(booking.status).toBe("rescheduled");
  });

  it("has a double-book preset targeting an already-taken slot", () => {
    const preset = SCHEDULING_PRESETS.find((p) => p.id === "double-book");
    expect(preset).toBeDefined();
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const target = avail.slots.find((s) => s.start === preset!.request.requestedSlotStart);
    expect(target?.status).toBe("booked");
    // Booking a taken slot is refused by the domain (defense in depth).
    expect(() => bookAppointment(preset!.request)).toThrow(/double-book/);
  });

  it("has an out-of-availability preset targeting a non-published time", () => {
    const preset = SCHEDULING_PRESETS.find((p) => p.id === "out-of-availability");
    expect(preset).toBeDefined();
    expect(preset!.request.requestedSlotStart).toMatch(/T03:00:00$/);
    expect(() => bookAppointment(preset!.request)).toThrow(/availability/);
  });
});

describe("buildSchedulingRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a schedulingRequest data part", () => {
    const request = {
      providerId: PROVIDER,
      modality: "telehealth" as const,
      requestedDate: MONDAY
    };
    const body = buildSchedulingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ schedulingRequest: request });
  });
});

describe("runSchedulingTask", () => {
  it("POSTs the A2A body to the Scheduling agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/appointment-scheduling/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.schedulingRequest.providerId).toBe(
        PROVIDER
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runSchedulingTask(
      {
        taskId: "task-1",
        request: { providerId: PROVIDER, modality: "telehealth", requestedDate: MONDAY }
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("scheduling-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runSchedulingTask(
        { taskId: "t", request: { providerId: PROVIDER, modality: "telehealth" } },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("schedulingViewFromTask", () => {
  it("lifts a confirmed booking with slot, modality, id, source, and handoff", () => {
    const view = schedulingViewFromTask(completedTask());
    expect(view.kind).toBe("booked");
    if (view.kind !== "booked") return;
    expect(view.modality).toBe("telehealth");
    expect(view.status).toBe("booked");
    expect(view.serviceAppointmentId).toMatch(/^sa-/);
    expect(view.slotStart.length).toBeGreaterThan(0);
    expect(view.source.synthetic).toBe(true);
    expect(view.nextAgent).toBe("engagement-agent");
    expect(view.traceTaskId).toBe("scheduling-abc");
  });

  it("lifts a rescheduled booking with the prior appointment it replaced", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const open = avail.slots.find((s) => s.status === "open")!;
    const view = schedulingViewFromTask(
      completedTask({
        request: {
          providerId: PROVIDER,
          modality: open.modalities[0],
          requestedSlotStart: open.start,
          intent: "reschedule",
          rescheduleFrom: { serviceAppointmentId: "sa-prior" }
        }
      })
    );
    expect(view.kind).toBe("booked");
    if (view.kind !== "booked") return;
    expect(view.status).toBe("rescheduled");
    expect(view.rescheduledFrom?.serviceAppointmentId).toBe("sa-prior");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = schedulingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this appointment booking/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.scheduling.no-double-book"
    );
    expect(view.policiesEvaluated).toContain("policy.scheduling.no-double-book");
    expect(view.traceTaskId).toBe("scheduling-block");
  });

  it("treats a failed non-block task as an invalid (not-booked) result", () => {
    const task: A2ATask = {
      id: "scheduling-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "Appointment could not be booked: bad input" }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = schedulingViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be booked/);
  });
});
