import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MSCP_OVERLAY_NPIS } from "./mscp-overlay";

/**
 * The frontend's MSCP overlay set must stay identical to the ingest pipeline's
 * roster (`provider_ingest/examples/fixtures/mscp_npis.json`). The frontend
 * derives each certified provider's `credentialSource` from overlay
 * membership, so a drift here would silently mislabel curated providers as
 * self-reported (or vice-versa). Parsed straight from the committed fixture so
 * the two can't fall out of sync.
 */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../provider_ingest/examples/fixtures/mscp_npis.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as { npis: string[] };

describe("MSCP overlay NPIs · single-sourced with the ingest fixture", () => {
  it("matches provider_ingest/examples/fixtures/mscp_npis.json exactly", () => {
    expect([...MSCP_OVERLAY_NPIS].sort()).toEqual(
      [...FIXTURE.npis].map(String).sort()
    );
  });

  it("is a non-empty set of 10-digit NPIs", () => {
    expect(MSCP_OVERLAY_NPIS.size).toBeGreaterThan(0);
    for (const npi of MSCP_OVERLAY_NPIS) {
      expect(npi).toMatch(/^\d{10}$/);
    }
  });
});
