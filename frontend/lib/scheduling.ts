/**
 * Appointment Scheduling — synthetic provider calendar.
 *
 * Deterministic, dependency-free synthetic appointment scheduling. This
 * is the domain core the Appointment Scheduling Agent
 * (app/api/agents/appointment-scheduling) wraps — the Salesforce
 * "Agentforce for Health — Book/Reschedule/Update Appointment" analog on
 * Pause's Agent Fabric. It books (and can reschedule) the MSCP
 * menopause-specialist visit the Care Router recommends, honoring the
 * requested modality (telehealth / in-person) against a deterministic
 * provider availability calendar.
 *
 *   Inbound:  a SchedulingRequest (providerId/name, modality, a requested
 *             date/window or an explicit slot start, patient zip/timezone)
 *   Outbound: an AppointmentBooking (synthetic ServiceAppointment id, the
 *             confirmed slot start/end, modality, provider, status
 *             "booked"|"rescheduled", and a `source` provenance block
 *             marked `synthetic:true`)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a real Salesforce Scheduler write.
 * ─────────────────────────────────────────────────────────────────────
 *  There is NO real Salesforce Scheduler / ServiceAppointment record and
 *  NO real calendar integration here. Every open slot, every "already
 *  taken" slot, and every ServiceAppointment id is a DETERMINISTIC
 *  synthetic value derived by hashing providerId + date + slot — no
 *  randomness, no clock, no network call. The calendar is a MOCK. The
 *  point of the module is to model the SHAPE of a booking round-trip and,
 *  crucially, two governance invariants the fabric mirrors:
 *    (a) never double-book an already-taken synthetic slot, and
 *    (b) only book a slot that is within the provider's availability.
 *  Those invariants are enforced at the governance boundary by
 *  policy.scheduling.no-double-book and
 *  policy.scheduling.honor-provider-availability, and defended here by
 *  bookAppointment() refusing (throwing) on either violation.
 *
 *  Because it is deterministic on its inputs, a given provider + date
 *  always produces the same calendar — which is what lets the demo, the
 *  seeded trace, and the tests agree.
 */

/** The two visit modalities the scheduler can honor. */
export type Modality = "telehealth" | "in-person";

/** The visit length the synthetic calendar books in (minutes). */
export const VISIT_MINUTES = 30 as const;
/** Business day starts at 09:00 local. */
const BUSINESS_START_HOUR = 9;
/** 16 half-hour slots → 09:00 through 16:30 (last visit ends 17:00). */
const SLOTS_PER_DAY = 16;
/** How many days the default availability window spans. */
const DEFAULT_WINDOW_DAYS = 14;
/**
 * A fixed, clearly-synthetic anchor Monday used when a request carries no
 * date/window. We can't default to "today" — this module takes no clock —
 * so the default window is a deterministic demo anchor instead.
 */
export const DEFAULT_ANCHOR_DATE = "2026-02-02" as const;

/** A single half-hour slot on a provider's synthetic calendar. */
export type AvailabilitySlot = {
  /** Stable slot id (equals `start`). */
  slotId: string;
  /** ISO-ish local start, e.g. "2026-02-02T09:00:00" (no tz conversion). */
  start: string;
  /** ISO-ish local end, VISIT_MINUTES after start. */
  end: string;
  durationMinutes: number;
  /** Which modalities this slot is offered in (telehealth and/or in-person). */
  modalities: Modality[];
  /** "open" = bookable; "booked" = already taken on the synthetic calendar. */
  status: "open" | "booked";
};

/** The (mock) scheduling-system provenance every booking carries. */
export type AppointmentSource = {
  /** Always true — this provenance describes a synthetic booking. */
  synthetic: true;
  /** The (mock) scheduling system the booking is attributed to. */
  system: string;
  /** Deterministic synthetic calendar id for the provider. */
  calendarId: string;
  /** Deterministic synthetic booking reference (hashed, not a real id). */
  bookingReference: string;
  /** Honesty note kept on the wire so the mock is auditable downstream. */
  note: string;
};

/** A provider's synthetic availability over a date window. */
export type ProviderAvailability = {
  providerId: string;
  providerName: string;
  /** Inclusive date window (YYYY-MM-DD) the slots span. */
  window: { start: string; end: string };
  slots: AvailabilitySlot[];
  source: AppointmentSource;
};

/** A request to book (or reschedule) an appointment. */
export type SchedulingRequest = {
  /** Provider to book with (e.g. the Care Router's top recommendation NPI). */
  providerId: string;
  /** Human-readable provider name (display only). */
  providerName?: string;
  /** Requested visit modality. */
  modality: Modality;
  /** Explicit slot start (ISO-ish local); when set, that exact slot is targeted. */
  requestedSlotStart?: string;
  /** Requested single date (YYYY-MM-DD) — shorthand for a one-day window. */
  requestedDate?: string;
  /** Requested date window (YYYY-MM-DD inclusive). */
  dateWindow?: { start: string; end: string };
  /** Patient ZIP (display / future distance ranking; not used for math). */
  patientZip?: string;
  /** Patient timezone (carried onto the booking; no conversion performed). */
  patientTimezone?: string;
  /** book (default) or reschedule. */
  intent?: "book" | "reschedule";
  /** When rescheduling, the prior appointment being replaced. */
  rescheduleFrom?: { serviceAppointmentId?: string; slotStart?: string };
};

/** The structured, deterministic output of booking an appointment. */
export type AppointmentBooking = {
  /** Synthetic Salesforce ServiceAppointment id. */
  serviceAppointmentId: string;
  providerId: string;
  providerName: string;
  modality: Modality;
  /** Confirmed slot start/end (ISO-ish local). */
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  status: "booked" | "rescheduled";
  serviceType: string;
  patientTimezone?: string;
  /** Present on a reschedule: the prior slot that was replaced. */
  rescheduledFrom?: { serviceAppointmentId?: string; slotStart?: string };
  /** Mock scheduling-system provenance — required, always present. */
  source: AppointmentSource;
};

/** The default service context: a menopause specialist (MSCP) visit. */
export const DEFAULT_SERVICE_TYPE = "mscp-specialist-visit" as const;

/**
 * FNV-1a 32-bit string hash. Pure and deterministic — the same string
 * always produces the same synthetic value, so there is deliberately NO
 * randomness and NO clock anywhere here. (Same hash the benefits module
 * uses; kept local so this file stays dependency-free.)
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Parse a YYYY-MM-DD string into numeric parts (no timezone semantics). */
function parseDate(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return { y, m, day };
}

/** Zero-pad a number to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Day of week (0=Sun … 6=Sat) for a YYYY-MM-DD date, computed in UTC. */
function dayOfWeek(dateStr: string): number {
  const { y, m, day } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

/** Add `n` days to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC stepping). */
function addDays(dateStr: string, n: number): string {
  const { y, m, day } = parseDate(dateStr);
  const t = Date.UTC(y, m - 1, day) + n * 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate()
  )}`;
}

/** Inclusive list of YYYY-MM-DD dates from start to end (capped for safety). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Hard cap so a malformed / inverted window can't spin forever.
  for (let i = 0; i < 31; i++) {
    out.push(cur);
    if (cur >= end) break;
    cur = addDays(cur, 1);
  }
  return out;
}

/** Normalize a date-window argument into an inclusive {start,end}. */
function normalizeWindow(
  dateWindow: string | { start: string; end: string }
): { start: string; end: string } {
  if (typeof dateWindow === "string") {
    return { start: dateWindow, end: dateWindow };
  }
  return { start: dateWindow.start, end: dateWindow.end };
}

/** Resolve the date window a request implies (explicit slot → its date). */
function resolveRequestWindow(req: SchedulingRequest): {
  start: string;
  end: string;
} {
  if (req.dateWindow) return normalizeWindow(req.dateWindow);
  if (req.requestedDate) return { start: req.requestedDate, end: req.requestedDate };
  if (req.requestedSlotStart) {
    const date = req.requestedSlotStart.slice(0, 10);
    return { start: date, end: date };
  }
  return {
    start: DEFAULT_ANCHOR_DATE,
    end: addDays(DEFAULT_ANCHOR_DATE, DEFAULT_WINDOW_DAYS - 1)
  };
}

/** Build the modality set for a slot from a hash — biased toward "both". */
function modalitiesForSlot(h: number): Modality[] {
  switch ((h >>> 5) % 5) {
    case 1:
      return ["telehealth"];
    case 2:
      return ["in-person"];
    default:
      return ["telehealth", "in-person"];
  }
}

/**
 * Generate a provider's deterministic synthetic availability across a
 * date window. Weekends have no slots; each weekday exposes 16 half-hour
 * business-hours slots (09:00–16:30). Each slot's open/booked state and
 * its offered modalities are a stable function of providerId + date +
 * slot index — no randomness, no clock. About a third of slots come back
 * pre-"booked" so the calendar reads like a partially-full real one (and
 * so the no-double-book invariant has something to bite on).
 */
export function getProviderAvailability(
  providerId: string,
  dateWindow: string | { start: string; end: string }
): ProviderAvailability {
  const window = normalizeWindow(dateWindow);
  const dates = enumerateDates(window.start, window.end);
  const slots: AvailabilitySlot[] = [];

  for (const date of dates) {
    const dow = dayOfWeek(date);
    if (dow === 0 || dow === 6) continue; // no weekend availability
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const h = hashString(`${providerId}|${date}|${i}`);
      const startHour = BUSINESS_START_HOUR + Math.floor(i / 2);
      const startMin = (i % 2) * 30;
      const endTotal = startHour * 60 + startMin + VISIT_MINUTES;
      const endHour = Math.floor(endTotal / 60);
      const endMin = endTotal % 60;
      const start = `${date}T${pad2(startHour)}:${pad2(startMin)}:00`;
      const end = `${date}T${pad2(endHour)}:${pad2(endMin)}:00`;
      slots.push({
        slotId: start,
        start,
        end,
        durationMinutes: VISIT_MINUTES,
        modalities: modalitiesForSlot(h),
        // ~1/3 of slots are already taken on the synthetic calendar.
        status: h % 3 === 0 ? "booked" : "open"
      });
    }
  }

  return {
    providerId,
    providerName: `Provider ${providerId}`,
    window,
    slots,
    source: buildSource(providerId, "availability")
  };
}

/** Deterministic mock scheduling-system provenance for a provider. */
function buildSource(providerId: string, seed: string): AppointmentSource {
  const calendarId = `cal-${hashString(`calendar:${providerId}`).toString(36)}`;
  const bookingReference = `sched-${hashString(`${seed}:${providerId}`).toString(
    36
  )}`;
  return {
    synthetic: true,
    system: "Salesforce Scheduler · ServiceAppointment (synthetic)",
    calendarId,
    bookingReference,
    note: "Synthetic scheduling result — deterministic mock calendar, not a real Salesforce Scheduler / ServiceAppointment write."
  };
}

/**
 * Evaluate a scheduling request against the provider's availability
 * WITHOUT booking. Returns the honest signals the governance gate mirrors
 * plus the slot the request targets:
 *
 *   - slotWithinProviderAvailability: does the requested time exist as a
 *     published slot for the requested modality? For an auto-pick request
 *     (no explicit slot), true when the provider offers the modality at
 *     all in the window.
 *   - requestedSlotIsFree: is the targeted slot open (not already booked)?
 *     For an auto-pick request, true when at least one matching slot is
 *     open.
 *
 * This is what the Appointment Scheduling Agent reports to the pre-flight
 * gate so policy.scheduling.honor-provider-availability and
 * policy.scheduling.no-double-book block honestly.
 */
export function evaluateSchedulingRequest(req: SchedulingRequest): {
  availability: ProviderAvailability;
  targetSlot?: AvailabilitySlot;
  slotWithinProviderAvailability: boolean;
  requestedSlotIsFree: boolean;
} {
  const window = resolveRequestWindow(req);
  const availability = getProviderAvailability(req.providerId, window);
  const modality = req.modality;

  if (req.requestedSlotStart) {
    const matching = availability.slots.filter(
      (s) => s.start === req.requestedSlotStart
    );
    const forModality = matching.filter((s) => s.modalities.includes(modality));
    const targetSlot = forModality[0] ?? matching[0];
    return {
      availability,
      targetSlot,
      // Within availability only if a published slot at that time offers
      // the requested modality.
      slotWithinProviderAvailability: forModality.length > 0,
      requestedSlotIsFree: targetSlot ? targetSlot.status === "open" : false
    };
  }

  // Auto-pick: first open slot supporting the modality, in date/time order.
  const open = availability.slots.find(
    (s) => s.status === "open" && s.modalities.includes(modality)
  );
  const anyForModality = availability.slots.some((s) =>
    s.modalities.includes(modality)
  );
  return {
    availability,
    targetSlot: open ?? availability.slots.find((s) => s.modalities.includes(modality)),
    slotWithinProviderAvailability: anyForModality,
    requestedSlotIsFree: Boolean(open)
  };
}

/**
 * Book an appointment against the deterministic synthetic calendar. Picks
 * the requested slot (when `requestedSlotStart` is given) or the first
 * open slot matching the modality/window otherwise, and returns an
 * AppointmentBooking with a synthetic ServiceAppointment id + source
 * provenance.
 *
 * Defense in depth: this THROWS rather than return a bad booking when the
 * two invariants the governance layer guards are violated — an
 * out-of-availability slot (honor-provider-availability) or an
 * already-taken slot (no-double-book). The agent route sets the matching
 * governance signals from evaluateSchedulingRequest() so a violation is
 * normally blocked before we get here; this refusal is the belt-and-braces
 * that keeps the domain honest even if a caller bypasses the gate.
 */
export function bookAppointment(req: SchedulingRequest): AppointmentBooking {
  const { availability, targetSlot, slotWithinProviderAvailability, requestedSlotIsFree } =
    evaluateSchedulingRequest(req);

  if (!targetSlot || !slotWithinProviderAvailability) {
    throw new Error(
      `Requested slot is outside provider ${req.providerId}'s published availability`
    );
  }
  if (!requestedSlotIsFree || targetSlot.status === "booked") {
    throw new Error(
      `Requested slot ${targetSlot.start} is already booked; refusing to double-book`
    );
  }

  const status: AppointmentBooking["status"] =
    req.intent === "reschedule" ? "rescheduled" : "booked";
  const serviceAppointmentId = `sa-${hashString(
    `${req.providerId}|${targetSlot.start}|${req.modality}`
  ).toString(36)}`;

  return {
    serviceAppointmentId,
    providerId: req.providerId,
    providerName: req.providerName || availability.providerName,
    modality: req.modality,
    slotStart: targetSlot.start,
    slotEnd: targetSlot.end,
    durationMinutes: targetSlot.durationMinutes,
    status,
    serviceType: DEFAULT_SERVICE_TYPE,
    ...(req.patientTimezone ? { patientTimezone: req.patientTimezone } : {}),
    ...(status === "rescheduled" && req.rescheduleFrom
      ? { rescheduledFrom: req.rescheduleFrom }
      : {}),
    source: buildSource(req.providerId, targetSlot.start)
  };
}

/**
 * Reschedule an appointment: books a new slot and stamps the prior slot on
 * `rescheduledFrom` so the change is auditable. Thin wrapper over
 * bookAppointment with intent "reschedule".
 */
export function rescheduleAppointment(
  req: SchedulingRequest,
  from: { serviceAppointmentId?: string; slotStart?: string }
): AppointmentBooking {
  return bookAppointment({ ...req, intent: "reschedule", rescheduleFrom: from });
}

/**
 * Does a booking carry a valid (mock) scheduling source provenance? Every
 * booking bookAppointment() returns does; this guards a caller-asserted
 * booking object that lacks one.
 */
export function hasSchedulingSource(
  booking: Pick<AppointmentBooking, "source"> | null | undefined
): boolean {
  const src = booking?.source;
  return Boolean(
    src &&
      src.synthetic === true &&
      typeof src.calendarId === "string" &&
      src.calendarId.length > 0 &&
      typeof src.bookingReference === "string" &&
      src.bookingReference.length > 0 &&
      typeof src.system === "string" &&
      src.system.length > 0
  );
}

/**
 * A compact, trace-safe summary of a booking — the shape stamped onto the
 * Agent Fabric trace + the intake→router response `meta`. Carries no
 * free-text PII (ids, provider name, times, modality only).
 */
export function bookingSummary(booking: AppointmentBooking): {
  serviceAppointmentId: string;
  providerId: string;
  providerName: string;
  modality: Modality;
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  status: string;
  serviceType: string;
  bookingReference: string;
  synthetic: boolean;
} {
  return {
    serviceAppointmentId: booking.serviceAppointmentId,
    providerId: booking.providerId,
    providerName: booking.providerName,
    modality: booking.modality,
    slotStart: booking.slotStart,
    slotEnd: booking.slotEnd,
    durationMinutes: booking.durationMinutes,
    status: booking.status,
    serviceType: booking.serviceType,
    bookingReference: booking.source.bookingReference,
    synthetic: booking.source.synthetic
  };
}

/** Map an MSCP care pathway to the visit modality it implies. */
export function modalityForPathway(pathway: string | undefined): Modality {
  return pathway === "mscp-in-person" ? "in-person" : "telehealth";
}
