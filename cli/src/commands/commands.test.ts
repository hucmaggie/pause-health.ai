import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runHealth } from "./health";
import { runIntake } from "./intake";
import { runProviders } from "./providers";
import { runTimeline } from "./timeline";

/**
 * Tests for the four `pause` CLI commands. The lib (client, options) was
 * already covered; the commands themselves — path/query construction, the
 * --json vs human-summary branch, and the positional-arg guards — were not.
 *
 * Commands call the global fetch (no injectable impl), so we stub it and
 * capture stdout. Every command is driven with an explicit --base-url so the
 * asserted URLs don't depend on env.
 */

const BASE = "https://api.test";
let stdout: string[];

function stubFetch(payload: unknown) {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => ""
  }) as unknown as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function lastUrl(mock: ReturnType<typeof vi.fn>): string {
  return String((mock.mock.calls.at(-1) as [string])[0]);
}

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pause providers", () => {
  const PAYLOAD = {
    meta: { _source: "live-mulesoft" },
    matchType: "certified-local",
    total: 2015,
    returned: 1,
    providers: [
      {
        npi: "1",
        name: "Dr. Ada Lovelace",
        specialty: "OB/GYN",
        city: "LA",
        state: "CA",
        zip: "90012",
        menopauseCertified: true,
        telehealth: true,
        acceptingNewPatients: true,
        distanceMiles: 4.23
      }
    ]
  };

  it("builds the query string from flags", async () => {
    const mock = stubFetch(PAYLOAD);
    const rc = await runProviders([
      "--base-url", BASE,
      "--zip", "90012",
      "--menopause",
      "--limit", "5",
      "--insurance", "aetna",
      "--telehealth"
    ]);
    expect(rc).toBe(0);
    const url = new URL(lastUrl(mock));
    expect(url.pathname).toBe("/api/mulesoft/providers");
    expect(url.searchParams.get("zip")).toBe("90012");
    expect(url.searchParams.get("menopause")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("insurance")).toBe("aetna");
    expect(url.searchParams.get("telehealth")).toBe("true");
  });

  it("omits absent flags from the query", async () => {
    const mock = stubFetch(PAYLOAD);
    await runProviders(["--base-url", BASE]);
    const url = new URL(lastUrl(mock));
    expect(url.search).toBe("");
  });

  it("prints a human summary with distance formatting", async () => {
    stubFetch(PAYLOAD);
    await runProviders(["--base-url", BASE]);
    const out = stdout.join("");
    expect(out).toContain("matchType: certified-local");
    expect(out).toContain("returned: 1/2015");
    expect(out).toContain("Dr. Ada Lovelace");
    expect(out).toContain("4.2mi");
  });

  it("--json prints the raw payload and nothing else", async () => {
    stubFetch(PAYLOAD);
    await runProviders(["--base-url", BASE, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(PAYLOAD);
  });
});

describe("pause timeline", () => {
  const PAYLOAD = {
    meta: { _source: "mock" },
    bundle: {
      entry: [
        { resource: { resourceType: "Patient", id: "p1" } },
        { resource: { resourceType: "Observation", id: "o1", status: "final" } }
      ]
    }
  };

  it("requires exactly one patient id", async () => {
    stubFetch(PAYLOAD);
    await expect(runTimeline(["--base-url", BASE])).rejects.toThrow(
      /missing <patient-id>/
    );
    await expect(runTimeline(["--base-url", BASE, "a", "b"])).rejects.toThrow(
      /too many positional args/
    );
  });

  it("URL-encodes the patient id in the path", async () => {
    const mock = stubFetch(PAYLOAD);
    await runTimeline(["--base-url", BASE, "weird id/../x"]);
    const url = new URL(lastUrl(mock));
    expect(url.pathname).toBe(
      `/api/mulesoft/patient/${encodeURIComponent("weird id/../x")}/timeline`
    );
  });

  it("prints entry count and resource lines", async () => {
    stubFetch(PAYLOAD);
    await runTimeline(["--base-url", BASE, "pause-demo-patient-001"]);
    const out = stdout.join("");
    expect(out).toContain("patient: pause-demo-patient-001");
    expect(out).toContain("bundle entries: 2");
    expect(out).toContain("Observation o1 [final]");
  });
});

describe("pause intake", () => {
  const PAYLOAD = {
    meta: { _source: "mock" },
    intake: {
      patientId: "pause-demo-patient-001",
      preferredName: "Jane",
      ageBand: "46-50",
      primarySymptom: "hot_flashes",
      vasomotorScore: 7,
      sleepScore: 4,
      moodScore: 5
    }
  };

  it("requires exactly one patient id", async () => {
    stubFetch(PAYLOAD);
    await expect(runIntake(["--base-url", BASE])).rejects.toThrow(
      /missing <patient-id>/
    );
  });

  it("prints identity + scores in human mode", async () => {
    stubFetch(PAYLOAD);
    const rc = await runIntake(["--base-url", BASE, "pause-demo-patient-001"]);
    expect(rc).toBe(0);
    const out = stdout.join("");
    expect(out).toContain("name: Jane");
    expect(out).toContain("age band: 46-50");
    expect(out).toContain("scores: vasomotor=7, sleep=4, mood=5");
  });
});

describe("pause health", () => {
  const PAYLOAD = {
    meta: { _source: "live-mulesoft", _bundleEntries: 1 },
    bundle: { entry: [{ resource: { resourceType: "Patient", id: "p1" } }] }
  };

  it("hits the health path with no positional arg required", async () => {
    const mock = stubFetch(PAYLOAD);
    const rc = await runHealth(["--base-url", BASE]);
    expect(rc).toBe(0);
    expect(new URL(lastUrl(mock)).pathname).toBe("/api/mulesoft/health");
  });

  it("prints source and bundle entries", async () => {
    stubFetch(PAYLOAD);
    await runHealth(["--base-url", BASE]);
    const out = stdout.join("");
    expect(out).toContain("source: live-mulesoft");
    expect(out).toContain("bundle entries: 1");
    expect(out).toContain("Patient p1");
  });
});
