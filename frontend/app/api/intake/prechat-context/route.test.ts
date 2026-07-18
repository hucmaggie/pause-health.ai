import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { DEMO_COHORT } from "../../../../lib/demo-cohort";

/**
 * Tests for GET /api/intake/prechat-context — builds the hidden-prechat field
 * bag the browser hands to Salesforce Embedded Messaging. Invariants worth
 * pinning: the closed-list persona guard (400 missing / 404 unknown), the
 * string-only field bag (Salesforce hidden prechat fields are string-typed),
 * the 255-char channel clamp, the Patient_Percentile_Basis honesty marker,
 * the deliberate omission of the oversized Patient_Context_JSON dossier from
 * the in-band payload, and no-store caching.
 *
 * SF_* left unset → identity + grounding take the deterministic mock path.
 */

const SF_KEYS = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const;
const originalEnv: Record<string, string | undefined> = {};
const PERSONA = DEMO_COHORT[0];

function call(query: string) {
  return GET(
    new Request(`https://pause-health.ai/api/intake/prechat-context${query}`)
  );
}

beforeEach(() => {
  for (const k of SF_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SF_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("GET /api/intake/prechat-context", () => {
  it("returns 400 when personaId is missing", async () => {
    const res = await call("");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing personaid/i);
  });

  it("returns 404 for an unknown persona (closed list)", async () => {
    const res = await call("?personaId=not-a-real-persona");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/unknown personaid/i);
  });

  it("builds a string-only field bag for a known persona (mock path)", async () => {
    const res = await call(`?personaId=${PERSONA.id}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._personaId).toBe(PERSONA.id);
    expect(json.meta._identitySource).toBe("mock");
    expect(json.meta._groundingSource).toBe("mock");
    expect(json.meta._salesforceConfigured).toBe(false);

    const fields: Record<string, unknown> = json.prechatFields;
    // Every hidden prechat field is string-typed and within the channel cap.
    for (const [key, value] of Object.entries(fields)) {
      expect(typeof value, `${key} must be a string`).toBe("string");
      expect((value as string).length).toBeLessThanOrEqual(255);
    }
    // Standard + custom fields the routing Flow depends on.
    expect(fields._firstName).toBe(PERSONA.firstName);
    expect(fields.Patient_First_Name).toBe(PERSONA.firstName);
    expect(fields.Patient_Zip).toBe(PERSONA.patientZip);
    expect(fields.Patient_Insurance).toBe(PERSONA.patientInsurance);
  });

  it("carries the Patient_Percentile_Basis honesty marker", async () => {
    const json = await (await call(`?personaId=${PERSONA.id}`)).json();
    // The mock cohort percentile is an intake-scaled estimate, not a live
    // segment rank — the field must say so.
    expect(json.prechatFields.Patient_Percentile_Basis).toBe("intake-estimate");
  });

  it("omits the oversized Patient_Context_JSON dossier from the in-band bag", async () => {
    const json = await (await call(`?personaId=${PERSONA.id}`)).json();
    expect(json.prechatFields.Patient_Context_JSON).toBeUndefined();
  });

  it("is uncacheable (no-store) — resolution is per-request", async () => {
    const res = await call(`?personaId=${PERSONA.id}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
