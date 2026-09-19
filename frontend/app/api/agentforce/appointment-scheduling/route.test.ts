import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/appointment-scheduling — the flat REST alias the
 * Agentforce External Service (bookAppointment) binds to. Invariants: it returns
 * the flat booking summary (not an A2A envelope), stays deterministic (same
 * provider+modality → same synthetic appointment id + slot), honors a requested
 * date, requires a providerId, and enforces the SAME governance gate as the A2A
 * agent (no double-book / within published availability).
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/appointment-scheduling${qs}`);
}
async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/agentforce/appointment-scheduling", () => {
  it("books a telehealth appointment and returns a flat synthetic summary", async () => {
    const { status, json } = await body("?providerId=npi-1234567890&modality=telehealth");
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(json.status).toBe("booked");
    expect(json.modality).toBe("telehealth");
    expect(typeof json.serviceAppointmentId).toBe("string");
    expect(typeof json.slotStart).toBe("string");
    // Flat shape — no A2A task envelope.
    expect(json).not.toHaveProperty("jsonrpc");
    expect(json).not.toHaveProperty("source"); // provenance summarized to bookingReference, not leaked whole
  });

  it("honors a requested date and modality", async () => {
    const { json } = await body(
      "?providerId=npi-1234567890&modality=in-person&requestedDate=2026-02-10"
    );
    expect(json.modality).toBe("in-person");
    expect(String(json.slotStart)).toContain("2026-02-10");
  });

  it("is deterministic — same provider+modality yields the same appointment", async () => {
    const a = await body("?providerId=npi-777&modality=telehealth");
    const b = await body("?providerId=npi-777&modality=telehealth");
    expect(a.json.serviceAppointmentId).toBe(b.json.serviceAppointmentId);
    expect(a.json.slotStart).toBe(b.json.slotStart);
  });

  it("requires a providerId", async () => {
    const { status, json } = await body("?modality=telehealth");
    expect(status).toBe(400);
    expect(json.error).toBe("missing-providerId");
  });
});
