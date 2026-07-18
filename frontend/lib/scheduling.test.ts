import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANCHOR_DATE,
  VISIT_MINUTES,
  bookAppointment,
  bookingSummary,
  evaluateSchedulingRequest,
  getProviderAvailability,
  hasSchedulingSource,
  modalityForPathway,
  rescheduleAppointment,
  type Modality
} from "./scheduling";

/**
 * Tests for lib/scheduling.ts — the deterministic synthetic calendar
 * behind the Appointment Scheduling Agent. Every slot (open/booked +
 * modalities) and every ServiceAppointment id is a deterministic function
 * of providerId + date + slot (no randomness, no clock), so the same
 * provider + date always produces the same calendar. These tests pin
 * determinism, availability generation, the no-double-book and
 * honor-availability refusals, the reschedule path, and source provenance.
 */

const PROVIDER = "1720394857";
// 2026-02-02 is a Monday (the DEFAULT_ANCHOR_DATE).
const MONDAY = "2026-02-02";
const SATURDAY = "2026-02-07";

describe("getProviderAvailability · determinism + generation", () => {
  it("returns exactly the same calendar for the same provider + date", () => {
    expect(getProviderAvailability(PROVIDER, MONDAY)).toEqual(
      getProviderAvailability(PROVIDER, MONDAY)
    );
  });

  it("exposes 16 half-hour business-hours slots on a weekday", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    expect(avail.slots).toHaveLength(16);
    // First slot 09:00, last slot 16:30, all 30 minutes.
    expect(avail.slots[0].start).toBe(`${MONDAY}T09:00:00`);
    expect(avail.slots[0].end).toBe(`${MONDAY}T09:30:00`);
    expect(avail.slots[15].start).toBe(`${MONDAY}T16:30:00`);
    expect(avail.slots[15].end).toBe(`${MONDAY}T17:00:00`);
    for (const s of avail.slots) {
      expect(s.durationMinutes).toBe(VISIT_MINUTES);
      expect(["open", "booked"]).toContain(s.status);
      expect(s.modalities.length).toBeGreaterThan(0);
      for (const m of s.modalities) {
        expect(["telehealth", "in-person"]).toContain(m);
      }
    }
  });

  it("has no availability on weekends", () => {
    expect(getProviderAvailability(PROVIDER, SATURDAY).slots).toHaveLength(0);
  });

  it("has both open and booked slots on a typical weekday (partially-full calendar)", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    expect(avail.slots.some((s) => s.status === "open")).toBe(true);
    expect(avail.slots.some((s) => s.status === "booked")).toBe(true);
  });

  it("carries a synthetic source provenance the guard accepts", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    expect(avail.source.synthetic).toBe(true);
    expect(hasSchedulingSource(avail)).toBe(true);
  });

  it("supports a multi-day window (spans weekdays, skips the weekend)", () => {
    // Mon 2026-02-02 → Sun 2026-02-08: five weekdays × 16 slots = 80.
    const avail = getProviderAvailability(PROVIDER, {
      start: MONDAY,
      end: "2026-02-08"
    });
    expect(avail.slots).toHaveLength(80);
  });
});

describe("bookAppointment · happy path", () => {
  it("auto-picks the first open slot matching the modality and books it", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const firstOpenTelehealth = avail.slots.find(
      (s) => s.status === "open" && s.modalities.includes("telehealth")
    )!;
    const booking = bookAppointment({
      providerId: PROVIDER,
      modality: "telehealth",
      requestedDate: MONDAY
    });
    expect(booking.slotStart).toBe(firstOpenTelehealth.start);
    expect(booking.modality).toBe("telehealth");
    expect(booking.status).toBe("booked");
    expect(booking.serviceAppointmentId).toMatch(/^sa-/);
    expect(booking.durationMinutes).toBe(VISIT_MINUTES);
  });

  it("is deterministic — the same request books the same appointment", () => {
    const req = {
      providerId: PROVIDER,
      modality: "telehealth" as Modality,
      requestedDate: MONDAY
    };
    expect(bookAppointment(req)).toEqual(bookAppointment(req));
  });

  it("books an explicit open slot when requestedSlotStart is given", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const open = avail.slots.find((s) => s.status === "open")!;
    const modality = open.modalities[0];
    const booking = bookAppointment({
      providerId: PROVIDER,
      modality,
      requestedSlotStart: open.start
    });
    expect(booking.slotStart).toBe(open.start);
    expect(booking.modality).toBe(modality);
  });

  it("defaults to the synthetic anchor window when no date is given", () => {
    const booking = bookAppointment({ providerId: PROVIDER, modality: "telehealth" });
    // The first bookable day is the anchor Monday.
    expect(booking.slotStart.startsWith(DEFAULT_ANCHOR_DATE)).toBe(true);
  });
});

describe("no-double-book invariant", () => {
  it("reports an already-booked slot as not free and refuses to book it", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const booked = avail.slots.find((s) => s.status === "booked")!;
    const modality = booked.modalities[0];
    const evalResult = evaluateSchedulingRequest({
      providerId: PROVIDER,
      modality,
      requestedSlotStart: booked.start
    });
    // The slot is a real published slot (within availability) but taken.
    expect(evalResult.slotWithinProviderAvailability).toBe(true);
    expect(evalResult.requestedSlotIsFree).toBe(false);
    expect(() =>
      bookAppointment({
        providerId: PROVIDER,
        modality,
        requestedSlotStart: booked.start
      })
    ).toThrow(/double-book/i);
  });
});

describe("honor-provider-availability invariant", () => {
  it("reports an out-of-hours time as outside availability and refuses to book it", () => {
    // 03:00 is never a published business-hours slot.
    const outOfHours = `${MONDAY}T03:00:00`;
    const evalResult = evaluateSchedulingRequest({
      providerId: PROVIDER,
      modality: "telehealth",
      requestedSlotStart: outOfHours
    });
    expect(evalResult.slotWithinProviderAvailability).toBe(false);
    expect(() =>
      bookAppointment({
        providerId: PROVIDER,
        modality: "telehealth",
        requestedSlotStart: outOfHours
      })
    ).toThrow(/availability/i);
  });

  it("refuses a modality the published slot does not offer", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const telehealthOnly = avail.slots.find(
      (s) => s.modalities.length === 1 && s.modalities[0] === "telehealth"
    );
    // The synthetic generator biases toward "both", but telehealth-only
    // slots do occur; only assert when one exists on this day.
    if (telehealthOnly) {
      const evalResult = evaluateSchedulingRequest({
        providerId: PROVIDER,
        modality: "in-person",
        requestedSlotStart: telehealthOnly.start
      });
      expect(evalResult.slotWithinProviderAvailability).toBe(false);
    }
  });
});

describe("reschedule path", () => {
  it("books a new slot and records the prior slot on rescheduledFrom", () => {
    const avail = getProviderAvailability(PROVIDER, MONDAY);
    const open = avail.slots.find((s) => s.status === "open")!;
    const modality = open.modalities[0];
    const booking = rescheduleAppointment(
      { providerId: PROVIDER, modality, requestedSlotStart: open.start },
      { serviceAppointmentId: "sa-prior-001", slotStart: "2026-01-05T09:00:00" }
    );
    expect(booking.status).toBe("rescheduled");
    expect(booking.rescheduledFrom).toEqual({
      serviceAppointmentId: "sa-prior-001",
      slotStart: "2026-01-05T09:00:00"
    });
    expect(booking.slotStart).toBe(open.start);
  });
});

describe("source provenance + summary", () => {
  it("always attaches a synthetic scheduling source that hasSchedulingSource accepts", () => {
    const booking = bookAppointment({
      providerId: PROVIDER,
      modality: "telehealth",
      requestedDate: MONDAY
    });
    expect(booking.source.synthetic).toBe(true);
    expect(booking.source.calendarId).toMatch(/^cal-/);
    expect(booking.source.bookingReference).toMatch(/^sched-/);
    expect(booking.source.system).toMatch(/synthetic/i);
    expect(hasSchedulingSource(booking)).toBe(true);
  });

  it("hasSchedulingSource rejects a booking with no / partial source", () => {
    expect(hasSchedulingSource(null)).toBe(false);
    expect(hasSchedulingSource(undefined)).toBe(false);
    expect(
      hasSchedulingSource({
        source: {
          synthetic: true,
          system: "x",
          calendarId: "",
          bookingReference: "sched-1",
          note: "x"
        }
      })
    ).toBe(false);
  });

  it("bookingSummary is a trace-safe projection with the SA id + synthetic flag", () => {
    const booking = bookAppointment({
      providerId: PROVIDER,
      modality: "telehealth",
      requestedDate: MONDAY
    });
    const s = bookingSummary(booking);
    expect(s.serviceAppointmentId).toBe(booking.serviceAppointmentId);
    expect(s.slotStart).toBe(booking.slotStart);
    expect(s.bookingReference).toBe(booking.source.bookingReference);
    expect(s.synthetic).toBe(true);
    const allowedKeys = new Set([
      "serviceAppointmentId",
      "providerId",
      "providerName",
      "modality",
      "slotStart",
      "slotEnd",
      "durationMinutes",
      "status",
      "serviceType",
      "bookingReference",
      "synthetic"
    ]);
    for (const k of Object.keys(s)) {
      expect(allowedKeys.has(k), `unexpected summary key ${k}`).toBe(true);
    }
  });
});

describe("modalityForPathway", () => {
  it("maps in-person pathway to in-person and everything else to telehealth", () => {
    expect(modalityForPathway("mscp-in-person")).toBe("in-person");
    expect(modalityForPathway("mscp-virtual-visit")).toBe("telehealth");
    expect(modalityForPathway(undefined)).toBe("telehealth");
  });
});
