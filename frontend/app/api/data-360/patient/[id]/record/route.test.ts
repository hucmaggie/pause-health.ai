import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { DEMO_DATA360_PATIENT_ID } from "../../../../../../lib/data-360";

/**
 * Tests for GET /api/data-360/patient/{id}/record — the mocked Data 360
 * federated patient record the Agent Fabric console links to. Mock-only
 * route. Pins that the record echoes the requested id, meta reports the
 * requested vs demo id (so a reviewer knows which they're looking at), and
 * the CDN cache header.
 */

function call(id: string) {
  return GET(
    new Request(`https://pause-health.ai/api/data-360/patient/${id}/record`),
    { params: Promise.resolve({ id }) }
  );
}

describe("GET /api/data-360/patient/[id]/record", () => {
  it("returns 200 with a federated record keyed to the requested id", async () => {
    const res = await call("patient-abc");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.record.unifiedPatientId).toBe("patient-abc");
    expect(json.record.profile).toBeDefined();
    expect(Array.isArray(json.record.insights)).toBe(true);
    expect(json.record.activeSegments).toHaveLength(2);
  });

  it("stamps meta with the requested and demo patient ids", async () => {
    const json = await (await call("patient-abc")).json();
    expect(json.meta._requestedPatientId).toBe("patient-abc");
    expect(json.meta._demoPatientId).toBe(DEMO_DATA360_PATIENT_ID);
    expect(json.meta._generatedBy).toContain(
      "/api/data-360/patient/patient-abc/record"
    );
  });

  it("falls back to the demo patient id when the path segment is empty", async () => {
    const json = await (await call("")).json();
    expect(json.record.unifiedPatientId).toBe(DEMO_DATA360_PATIENT_ID);
  });

  it("emits the documented cacheable Cache-Control header", async () => {
    const res = await call(DEMO_DATA360_PATIENT_ID);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=60/);
  });
});
