import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { listSegments } from "../../../../lib/data-360";

/**
 * Tests for GET /api/data-360/segments — the mocked Data 360 segment catalog
 * the Agent Fabric subscribes to for proactive outreach. Mock-only route; the
 * contract worth pinning is that meta's derived counts stay in sync with the
 * catalog (so they can't silently drift from listSegments) and the CDN cache
 * header the console relies on.
 */

describe("GET /api/data-360/segments", () => {
  it("returns 200 with the segment catalog", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.segments)).toBe(true);
    expect(json.segments).toHaveLength(listSegments().length);
  });

  it("derives meta counts from the catalog rather than hardcoding them", async () => {
    const json = await (await GET()).json();
    const segs = listSegments();
    expect(json.meta._segmentCount).toBe(segs.length);
    expect(json.meta._totalPatients).toBe(
      segs.reduce((s, x) => s + x.patientCount, 0)
    );
  });

  it("emits the documented cacheable Cache-Control header", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
});
