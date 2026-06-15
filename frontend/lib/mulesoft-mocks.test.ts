import { describe, expect, it } from "vitest";
import { queryProviderDirectory } from "./mulesoft-mocks";
import generated from "./provider-directory.generated.json";

/**
 * Tiered graceful-fallback tests for queryProviderDirectory.
 *
 * The agent queries menopause=true + ZIP. Real certified coverage is sparse, so
 * a patient outside the certified footprint must still get a useful, honestly
 * LABELED answer instead of an empty result. These tests pin the tier ladder
 * (certified-local → relevant-local → certified-remote) and the invariant that
 * fallback is OPT-IN — the strict default protects the Care Router and the demo.
 *
 * ZIPs are derived from the committed directory so the tests stay valid across
 * data regens.
 */

type Row = { zip: string; menopauseCertified: boolean; telehealth: boolean };
const DIR = generated as Row[];
const zip3 = (z: string) => z.slice(0, 3);

const certifiedPrefixes = new Set(
  DIR.filter((r) => r.menopauseCertified).map((r) => zip3(r.zip))
);
const allPrefixes = new Set(DIR.map((r) => zip3(r.zip)));

// A ZIP whose 3-prefix has a NON-certified provider but NO certified one.
const relevantOnlyZip = DIR.find(
  (r) => !r.menopauseCertified && !certifiedPrefixes.has(zip3(r.zip))
)?.zip;

// A 3-digit prefix used by NO provider at all (guaranteed empty area).
let emptyZip = "00000";
for (let i = 0; i < 1000; i++) {
  const p = String(i).padStart(3, "0");
  if (!allPrefixes.has(p)) {
    emptyZip = `${p}01`;
    break;
  }
}

describe("queryProviderDirectory · graceful fallback tiers", () => {
  it("tier 1 — certified-local: returns local certified providers", () => {
    const out = queryProviderDirectory({ zip: "92614", menopauseOnly: true, fallback: true });
    expect(out.matchType).toBe("certified-local");
    expect(out.providers.length).toBeGreaterThan(0);
    for (const p of out.providers) {
      expect(p.menopauseCertified).toBe(true);
      expect(p.zip.slice(0, 3)).toBe("926");
    }
  });

  it("tier 2 — relevant-local: no local certified → nearby NON-certified, clearly tiered", () => {
    expect(relevantOnlyZip, "fixture: need a non-certified-only ZIP area").toBeTruthy();
    const out = queryProviderDirectory({
      zip: relevantOnlyZip!,
      menopauseOnly: true,
      fallback: true
    });
    expect(out.matchType).toBe("relevant-local");
    expect(out.providers.length).toBeGreaterThan(0);
    for (const p of out.providers) {
      expect(p.menopauseCertified).toBe(false);
      expect(p.zip.slice(0, 3)).toBe(zip3(relevantOnlyZip!));
    }
  });

  it("tier 3 — certified-remote: nothing local → national telehealth-capable certified", () => {
    const out = queryProviderDirectory({ zip: emptyZip, menopauseOnly: true, fallback: true });
    expect(out.matchType).toBe("certified-remote");
    expect(out.providers.length).toBeGreaterThan(0);
    for (const p of out.providers) {
      expect(p.menopauseCertified).toBe(true);
      expect(p.telehealth).toBe(true);
    }
  });

  it("strict by default — no fallback flag returns the empty certified-local result", () => {
    expect(relevantOnlyZip).toBeTruthy();
    const out = queryProviderDirectory({ zip: relevantOnlyZip!, menopauseOnly: true });
    expect(out.query.fallback).toBe(false);
    expect(out.providers).toHaveLength(0);
    expect(out.matchType).toBe("none");
  });

  it("general browse (menopauseOnly=false) is unaffected by fallback and keeps non-certified rows", () => {
    const out = queryProviderDirectory({ zip: "92614", menopauseOnly: false, fallback: true });
    expect(out.matchType).toBe("local");
    for (const p of out.providers) {
      expect(p.zip.slice(0, 3)).toBe("926");
    }
  });

  it("certified-national when no ZIP is given", () => {
    const out = queryProviderDirectory({ menopauseOnly: true, fallback: true });
    expect(out.matchType).toBe("certified-national");
    for (const p of out.providers) {
      expect(p.menopauseCertified).toBe(true);
    }
  });

  it("respects limit while preserving the true total", () => {
    const out = queryProviderDirectory({ menopauseOnly: true, limit: 3, fallback: true });
    expect(out.returned).toBeLessThanOrEqual(3);
    expect(out.total).toBeGreaterThanOrEqual(out.returned);
  });
});
