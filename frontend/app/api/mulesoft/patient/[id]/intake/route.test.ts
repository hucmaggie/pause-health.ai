import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { DEMO_PATIENT_ID } from "../../../../../../lib/mulesoft-mocks";

/**
 * Tests for GET /api/mulesoft/patient/{id}/intake — the mocked Experience
 * API standing in for the MuleSoft pause-intake-process-api, and the HTTP
 * surface the MCP `get_patient_intake` tool calls.
 *
 * This route is mock-only (no live branch): the demo cohort has one
 * synthetic patient, so any id resolves to the same record. The contract
 * worth pinning is the id-aliasing bookkeeping in meta (so an operator /
 * agent can tell when they asked for a non-demo id and got the demo shape),
 * the MCP-tool-equivalence stamp, provenance passthrough, and the cache
 * header the CDN relies on.
 */

function call(id: string) {
  return GET(
    new Request(`https://pause-health.ai/api/mulesoft/patient/${id}/intake`),
    { params: Promise.resolve({ id }) }
  );
}

describe("GET /api/mulesoft/patient/[id]/intake", () => {
  it("returns 200 with an intake record echoing the requested id", async () => {
    const res = await call(DEMO_PATIENT_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.intake.patientId).toBe(DEMO_PATIENT_ID);
    expect(json.intake.chiefComplaint).toBeTruthy();
    expect(json.intake.redFlagScreen).toBeDefined();
    expect(json.intake.triageRecommendation.acuity).toBeTruthy();
  });

  it("stamps meta with the MCP tool equivalent and demo-cohort bookkeeping", async () => {
    const json = await (await call(DEMO_PATIENT_ID)).json();
    expect(json.meta._mcpToolEquivalent).toBe("get_patient_intake");
    expect(json.meta._demoPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._requestedPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._idAliased).toBe(false);
  });

  it("flags _idAliased=true when a non-demo id is requested (still returns the demo shape)", async () => {
    const json = await (await call("some-other-patient")).json();
    expect(json.meta._requestedPatientId).toBe("some-other-patient");
    expect(json.meta._idAliased).toBe(true);
    // Aliased, but the record still carries the requested id.
    expect(json.intake.patientId).toBe("some-other-patient");
  });

  it("falls back to the demo patient id when the path segment is empty", async () => {
    const json = await (await call("")).json();
    expect(json.meta._requestedPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._idAliased).toBe(false);
  });

  it("passes the MuleSoft process/experience-API provenance through", async () => {
    const json = await (await call(DEMO_PATIENT_ID)).json();
    expect(json.intake.provenance.processApi).toContain(
      "pause-intake-process-api"
    );
    expect(json.intake.provenance.experienceApi).toBeTruthy();
    expect(json.intake.provenance.hipaaAuditId).toBeTruthy();
  });

  it("emits the documented cacheable Cache-Control header", async () => {
    const res = await call(DEMO_PATIENT_ID);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
});
