import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import meta from "../provider-directory.generated.meta.json";

/**
 * Drift guard for the hardcoded provider-directory numbers baked into the
 * LLM-facing find_menopause_providers tool description in tools.ts.
 *
 * That description tells the agent "2,015 NPPES-derived providers" and
 * "1,720 dropped this build" (sanctioned, filtered at build time from
 * CA Medi-Cal + NY OPMC + TX TMB). Those are static strings — nothing ties
 * them to provider-directory.generated.meta.json, which is regenerated
 * whenever the directory is rebuilt. So the next `total` / `sanctionedFiltered`
 * change would silently make the tool lie to every agent that reads it,
 * with no failing test.
 *
 * tools.ts MUST stay byte-identical to mcp/src/tools.ts (see
 * tools.parity.test.ts), so we can't derive these at runtime without pulling
 * the meta file into the standalone npm package. Instead we pin, not couple:
 * assert the description's numbers match the generated meta, exactly the
 * "guard, don't couple" approach registry-parity.test.ts uses.
 */

const TOOLS_SRC = readFileSync(resolve(__dirname, "tools.ts"), "utf-8");

function providerToolDescription(): string {
  // The find_menopause_providers registration is the only place these
  // dataset numbers appear; grab the description string literal.
  const marker = "Search Pause's provider directory";
  const start = TOOLS_SRC.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  // The description is a single double-quoted literal on one line.
  const lineEnd = TOOLS_SRC.indexOf("\n", start);
  return TOOLS_SRC.slice(start, lineEnd);
}

describe("find_menopause_providers description ⇄ generated directory meta", () => {
  const desc = providerToolDescription();

  it("advertises the directory total from the generated meta", () => {
    const total = meta.providers.total.toLocaleString("en-US");
    expect(desc).toContain(`${total} NPPES-derived providers`);
  });

  it("advertises the sanctioned-filtered count from the generated meta", () => {
    const filtered = meta.providers.sanctionedFiltered.toLocaleString("en-US");
    expect(desc).toContain(`${filtered} dropped this build`);
  });

  it("names exactly the sanction-source states present in the generated meta", () => {
    // Description says "CA Medi-Cal + NY OPMC + TX TMB"; the meta must carry
    // the matching per-source keys (and no surprise extras).
    const sources = Object.keys(meta.providers.sanctionedFilteredBySource).sort();
    expect(sources).toEqual(["ca", "ny", "tx"]);
    expect(desc).toContain("CA Medi-Cal");
    expect(desc).toContain("NY OPMC");
    expect(desc).toContain("TX TMB");
  });
});
