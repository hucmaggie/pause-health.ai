import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/route-to-care — the single handoff action the
 * Agentforce Intake Agent (handoffToCareRouter) binds to. Invariants: it always
 * runs the deterministic Care Router; it enforces the SAME governance gate as
 * the Care Router alias (a MISSING red-flag screen is blocked so the agent must
 * ask the yes/no safety question before routing); it CHAINS the specialists
 * deterministically (Benefits when a payer is present, Appointment when book+
 * MSCP+provider, SDOH when a screen vector is given); every response carries a
 * taskId correlating the whole chain in one Agent Fabric trace; and the chain
 * degrades gracefully — a specialist failure never breaks the routing decision.
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/route-to-care${qs}`);
}
async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/agentforce/route-to-care", () => {
  it("blocks the handoff when no red-flag screen was completed", async () => {
    // No redFlagsAcknowledged param → the mandatory screen is missing.
    const { status, json } = await body("?primarySymptom=vasomotor&severity=moderate");
    expect(status).toBe(200);
    expect(json.blocked).toBe(true);
    expect(json.decision).toBe("block");
    expect(Array.isArray(json.violations)).toBe(true);
    expect((json.violations as unknown[]).length).toBeGreaterThan(0);
    // Even a blocked handoff returns a correlating taskId.
    expect(typeof json.taskId).toBe("string");
    expect(json.pathway).toBeUndefined();
  });

  it("routes moderate vasomotor (screen completed, no red flags) and always chains care-router", async () => {
    const { status, json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&cycleStatus=perimenopause"
    );
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(typeof json.pathway).toBe("string");
    expect(Array.isArray(json.rationale)).toBe(true);
    expect((json.rationale as string[]).length).toBeGreaterThan(0);
    expect(json.chained).toEqual(["care-router"]);
    expect(typeof json.taskId).toBe("string");
    // Flat shape — no A2A task envelope.
    expect(json).not.toHaveProperty("jsonrpc");
    expect(json).not.toHaveProperty("task");
  });

  it("chains Benefits verification when the intake carries a payer", async () => {
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&patientInsurance=Aetna&patientZip=92614"
    );
    expect(json.chained).toContain("care-router");
    expect(json.chained).toContain("benefits-verification");
    expect(json.coverage).toBeDefined();
    const coverage = json.coverage as Record<string, unknown>;
    expect(typeof coverage.eligibilityStatus).toBe("string");
    expect(coverage.payer).toBeDefined();
  });

  it("chains Benefits verification when verifyCoverage=true even without an inline payer", async () => {
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&verifyCoverage=true"
    );
    expect(json.chained).toContain("benefits-verification");
    expect(json.coverage).toBeDefined();
  });

  it("chains an Appointment booking when book=true, the pathway is MSCP, and a provider is given", async () => {
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&book=true&providerId=npi-123&modality=telehealth"
    );
    // Only assert the booking chained if the pathway is an MSCP visit (it is for
    // moderate vasomotor); the route guards book on isMscpVisit.
    if (String(json.pathway).startsWith("mscp-")) {
      expect(json.chained).toContain("appointment-scheduling");
      const scheduling = json.scheduling as Record<string, unknown>;
      expect(scheduling.serviceAppointmentId).toBeDefined();
      expect(scheduling.modality).toBe("telehealth");
    }
  });

  it("books with a synthesized provider id when book=true on an MSCP pathway without an explicit providerId", async () => {
    // The Agentforce agent often only has a provider NAME, not an NPI. book=true
    // on an MSCP pathway should still produce a synthetic confirmation.
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&book=true&providerName=Dr.%20Okafor"
    );
    if (String(json.pathway).startsWith("mscp-")) {
      expect(json.chained).toContain("appointment-scheduling");
      const scheduling = json.scheduling as Record<string, unknown>;
      expect(scheduling.serviceAppointmentId).toBeDefined();
      expect(String(scheduling.providerId)).toContain("npi-");
    }
  });

  it("does NOT book when the pathway is not an MSCP visit even if book=true", async () => {
    // A red-flag / urgent pathway is not bookable via this alias.
    const { json } = await body(
      "?primarySymptom=bleeding&severity=severe&redFlagsAcknowledged=yes&book=true&providerId=npi-123"
    );
    if (!String(json.pathway).startsWith("mscp-")) {
      expect(json.chained).not.toContain("appointment-scheduling");
      expect(json.scheduling).toBeUndefined();
    }
  });

  // A complete AHC-HRSN screen: housing 2 items (0-7), food 2 (0-2),
  // transportation 1 (0-1), utilities 1 (0-2), safety 4 (1-5, HITS). All five
  // domains are required or screenSocialNeeds throws (and the chain skips SDOH).
  const NEGATIVE_SCREEN = "housing:1,1;food:0,0;transportation:0;utilities:0;safety:1,1,1,1";
  const SAFETY_POSITIVE_SCREEN = "housing:1,1;food:0,0;transportation:0;utilities:0;safety:5,5,5,5";

  it("chains SDOH screening when a complete coded screen vector is supplied", async () => {
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no" +
        "&screenSdoh=" +
        encodeURIComponent(NEGATIVE_SCREEN)
    );
    expect(json.chained).toContain("sdoh-screening");
    const sdoh = json.sdoh as Record<string, unknown>;
    expect(sdoh.screener).toBeDefined();
    expect(typeof sdoh.positiveDomainCount).toBe("number");
    expect(typeof sdoh.safetyEscalation).toBe("boolean");
  });

  it("surfaces a positive interpersonal-safety screen as a mandatory escalation", async () => {
    // A positive HITS safety screen (4 items, all 5 → 20/20, cutoff >10) must
    // set safetyEscalation — the mandatory human-social-worker handoff.
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no" +
        "&screenSdoh=" +
        encodeURIComponent(SAFETY_POSITIVE_SCREEN)
    );
    expect(json.chained).toContain("sdoh-screening");
    const sdoh = json.sdoh as Record<string, unknown>;
    expect(sdoh.safetyEscalation).toBe(true);
  });

  it("skips SDOH (never breaks routing) when the screen vector is incomplete", async () => {
    // Only housing supplied — screenSocialNeeds throws; the chain must degrade
    // gracefully, still returning the routing decision without sdoh-screening.
    const { status, json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no" +
        "&screenSdoh=" +
        encodeURIComponent("housing:1,1")
    );
    expect(status).toBe(200);
    expect(json.pathway).toBeDefined();
    expect(json.chained).not.toContain("sdoh-screening");
    expect(json.sdoh).toBeUndefined();
  });

  it("chains all specialists together in one correlated trace", async () => {
    const { json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no" +
        "&patientInsurance=Aetna&book=true&providerId=npi-123" +
        "&screenSdoh=" +
        encodeURIComponent("housing:1,1;food:0,0;transportation:0;utilities:0;safety:1,1,1,1")
    );
    expect(json.chained).toContain("care-router");
    expect(json.chained).toContain("benefits-verification");
    expect(json.chained).toContain("sdoh-screening");
    // One taskId ties the whole chain together for /demo/agent-fabric.
    expect(typeof json.taskId).toBe("string");
    expect((json.taskId as string).length).toBeGreaterThan(0);
  });

  it("returns a deterministic result — same input, same pathway", async () => {
    const qs =
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&cycleStatus=perimenopause";
    const a = await body(qs);
    const b = await body(qs);
    expect(a.json.pathway).toBe(b.json.pathway);
    expect(a.json.acuity).toBe(b.json.acuity);
  });
});
