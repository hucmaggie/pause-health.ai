import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { DEMO_PATIENT_ID } from "../../../../../../lib/mulesoft-mocks";

/**
 * Tests for GET /api/mulesoft/patient/{id}/timeline — the mocked Experience
 * API standing in for the MuleSoft pause-patient-bundle-process-api, and the
 * HTTP surface the MCP `get_patient_timeline` tool calls.
 *
 * Mock-only route. The contract worth pinning: a well-formed FHIR searchset
 * Bundle, meta._bundleEntries staying in lockstep with the actual entry
 * count (it's derived, so a mismatch would mean the summary lies), the
 * MCP-tool-equivalence stamp, id-aliasing bookkeeping, and the cache header.
 */

function call(id: string) {
  return GET(
    new Request(`https://pause-health.ai/api/mulesoft/patient/${id}/timeline`),
    { params: Promise.resolve({ id }) }
  );
}

describe("GET /api/mulesoft/patient/[id]/timeline", () => {
  it("returns 200 with a non-empty FHIR searchset Bundle", async () => {
    const res = await call(DEMO_PATIENT_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bundle.resourceType).toBe("Bundle");
    expect(json.bundle.type).toBe("searchset");
    expect(json.bundle.entry.length).toBeGreaterThan(0);
  });

  it("reports meta._bundleEntries equal to the actual entry count", async () => {
    const json = await (await call(DEMO_PATIENT_ID)).json();
    expect(json.meta._bundleEntries).toBe(json.bundle.entry.length);
  });

  it("stamps meta with the MCP tool equivalent and demo-cohort bookkeeping", async () => {
    const json = await (await call(DEMO_PATIENT_ID)).json();
    expect(json.meta._mcpToolEquivalent).toBe("get_patient_timeline");
    expect(json.meta._demoPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._requestedPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._idAliased).toBe(false);
  });

  it("flags _idAliased=true when a non-demo id is requested", async () => {
    const json = await (await call("mystery-id")).json();
    expect(json.meta._requestedPatientId).toBe("mystery-id");
    expect(json.meta._idAliased).toBe(true);
    expect(json.bundle.entry.length).toBeGreaterThan(0);
  });

  it("falls back to the demo patient id when the path segment is empty", async () => {
    const json = await (await call("")).json();
    expect(json.meta._requestedPatientId).toBe(DEMO_PATIENT_ID);
    expect(json.meta._idAliased).toBe(false);
  });

  it("carries the MuleSoft process-API source stamp on the Bundle", async () => {
    const json = await (await call(DEMO_PATIENT_ID)).json();
    expect(json.bundle.meta.source).toContain(
      "pause-patient-bundle-process-api"
    );
  });

  it("emits the documented cacheable Cache-Control header", async () => {
    const res = await call(DEMO_PATIENT_ID);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
});
