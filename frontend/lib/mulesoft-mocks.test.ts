import { describe, expect, it } from "vitest";
import {
  normalizeInsurancePlan,
  queryProviderDirectory,
  sortByCentroidForTest
} from "./mulesoft-mocks";
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

/**
 * Distance ranking — separate from the tier ladder.
 *
 * The tier (matchType) decides WHICH providers are eligible; the sort decides
 * the order within that tier. Distance ranking is purely additive: when the
 * patient ZIP centroid is supplied AND at least one eligible provider has a
 * centroid, we rank by Haversine miles ascending and stamp `distanceMiles` on
 * each row. Without a centroid, the prior graphScore-only ranking is preserved.
 */
describe("queryProviderDirectory · distance ranking", () => {
  it("sorts by distance ascending when a ZIP centroid is supplied", () => {
    // Use the demo persona ZIP (Irvine, CA) — its centroid is in the bundled
    // gazetteer and the directory contains rows in 926* with real centroids.
    const irvine = { latitude: 33.68021, longitude: -117.833355 };
    const out = queryProviderDirectory({
      zip: "92614",
      menopauseOnly: true,
      fallback: true,
      zipCentroid: irvine,
      limit: 5
    });
    expect(out.sort).toBe("distance");
    expect(out.providers.length).toBeGreaterThan(0);

    // Distance is stamped on every returned row (not null) for in-area providers
    // — every certified-local row has a known centroid in the Census table.
    for (const p of out.providers) {
      expect(p.distanceMiles).not.toBeNull();
      expect(typeof p.distanceMiles).toBe("number");
      expect(p.distanceMiles!).toBeGreaterThanOrEqual(0);
      expect(p.distanceMiles!).toBeLessThan(50); // certified-local stays local
    }

    // Monotonically non-decreasing — the contract for sort=distance.
    for (let i = 1; i < out.providers.length; i++) {
      const prev = out.providers[i - 1].distanceMiles!;
      const curr = out.providers[i].distanceMiles!;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("falls back to graphScore ordering when no centroid is supplied", () => {
    const out = queryProviderDirectory({
      zip: "92614",
      menopauseOnly: true,
      fallback: true,
      limit: 5
    });
    expect(out.sort).toBe("score");
    // distanceMiles is null on every row when sort=score (no centroid known).
    for (const p of out.providers) {
      expect(p.distanceMiles).toBeNull();
    }
    // Still descending by graphScore, like before.
    for (let i = 1; i < out.providers.length; i++) {
      expect(out.providers[i - 1].graphScore).toBeGreaterThanOrEqual(
        out.providers[i].graphScore
      );
    }
  });

  it("places providers without coordinates at the end (null distances last)", () => {
    // Custom directory with mixed coverage so we can observe the slide-to-end
    // behavior deterministically. Patient is at (0, 0); B is closest, A next,
    // C has no centroid → must end up last regardless of graphScore.
    const here = { latitude: 0, longitude: 0 };
    const dir = [
      {
        npi: "1000000001",
        name: "A",
        credentials: ["MD"],
        specialty: "Obstetrics & Gynecology",
        menopauseCertified: true,
        city: "X",
        state: "XX",
        zip: "00001",
        acceptingNewPatients: true,
        telehealth: true,
        graphScore: 0.5,
        latitude: 0.5,
        longitude: 0.5
      },
      {
        npi: "1000000002",
        name: "B",
        credentials: ["MD"],
        specialty: "Obstetrics & Gynecology",
        menopauseCertified: true,
        city: "Y",
        state: "YY",
        zip: "00002",
        acceptingNewPatients: true,
        telehealth: true,
        graphScore: 0.4,
        latitude: 0.1,
        longitude: 0.1
      },
      {
        npi: "1000000003",
        name: "C-no-coords",
        credentials: ["MD"],
        specialty: "Obstetrics & Gynecology",
        menopauseCertified: true,
        city: "Z",
        state: "ZZ",
        zip: "99999",
        acceptingNewPatients: true,
        telehealth: true,
        graphScore: 0.99,
        latitude: null,
        longitude: null
      }
    ];
    const ranked = sortByCentroidForTest(dir, here);
    expect(ranked.map((p) => p.name)).toEqual(["B", "A", "C-no-coords"]);
    expect(ranked[0].distanceMiles).toBeLessThan(ranked[1].distanceMiles!);
    expect(ranked[2].distanceMiles).toBeNull();
  });

  it("surfaces dataset provenance (generatedAt + sourceDate + counts) when the generated directory is in use", () => {
    const out = queryProviderDirectory({ menopauseOnly: true, fallback: true });
    expect(out.provenance.dataset).not.toBeNull();
    const ds = out.provenance.dataset!;
    // The committed sidecar is written by refresh_national.sh; it always
    // carries an ISO-8601 generatedAt and a sourceDate from the NPPES zip's
    // mtime. We don't pin specific dates (the file refreshes), just the shape.
    expect(typeof ds.generatedAt).toBe("string");
    expect((ds.generatedAt as string).length).toBeGreaterThan(10);
    expect(typeof ds.sourceDate === "string" || ds.sourceDate === null).toBe(true);
    // Counts should be consistent with the loaded directory (the meta is
    // emitted by the same build as the array, so they can't drift).
    const certifiedInArray = (generated as Array<{ menopauseCertified: boolean }>).filter(
      (r) => r.menopauseCertified
    ).length;
    expect(ds.certified).toBe(certifiedInArray);
    expect(ds.total).toBe(generated.length);
  });

  it("surfaces sanctions filter results in dataset provenance (count + overlay path)", () => {
    const out = queryProviderDirectory({ menopauseOnly: true, fallback: true });
    const ds = out.provenance.dataset!;
    // sanctionedFiltered is an integer count; zero is the healthy default,
    // a positive number means real candidates were dropped for safety.
    expect(typeof ds.sanctionedFiltered).toBe("number");
    expect(ds.sanctionedFiltered).toBeGreaterThanOrEqual(0);
    // overlay-used reports the path of the sanctions list applied; null when
    // no overlay was passed at build time.
    expect(
      ds.sanctionsOverlayUsed === null || typeof ds.sanctionsOverlayUsed === "string"
    ).toBe(true);
  });

  it("every loaded provider has licenseStatus 'active' (sanctioned providers were filtered at build time)", () => {
    // Sanctioned providers are dropped during build, so survivors must all
    // carry licenseStatus 'active' (or undefined for older builds without
    // the field — both are honest, neither implies "suspended").
    const out = queryProviderDirectory({ menopauseOnly: true, fallback: true });
    for (const p of out.providers) {
      expect(p.licenseStatus === undefined || p.licenseStatus === "active").toBe(true);
    }
  });

  it("Haversine produces sensible values (Irvine CA → Brooklyn NY ≈ 2,450 mi)", () => {
    const irvine = { latitude: 33.68021, longitude: -117.833355 };
    const brooklyn = {
      npi: "1306188891",
      name: "Brooklyn",
      credentials: ["NP"],
      specialty: "Family Medicine",
      menopauseCertified: true,
      city: "Brooklyn",
      state: "NY",
      zip: "11215",
      acceptingNewPatients: true,
      telehealth: true,
      graphScore: 0.9,
      latitude: 40.662688,
      longitude: -73.98674
    };
    const [ranked] = sortByCentroidForTest([brooklyn], irvine);
    // True great-circle distance is ~2,436 miles — accept ±15 mi for centroid
    // sourcing and Earth-radius approximation. Mostly a guard against accidental
    // unit/sign swaps (km vs mi, lat/lng order, missing toRad).
    expect(ranked.distanceMiles).not.toBeNull();
    expect(Math.abs(ranked.distanceMiles! - 2436)).toBeLessThan(15);
  });
});

/**
 * Insurance filter — applied BEFORE the tier ladder.
 *
 * insuranceAccepted is synthetically derived per-NPI today (no public payer
 * feed); the filter UX, the contract, and the agent framing are real. These
 * tests pin the behavior end-to-end against the committed national run.
 */
describe("queryProviderDirectory · insurance filter", () => {
  it("normalizes user-typed plan names and synonyms", () => {
    expect(normalizeInsurancePlan("Aetna")).toBe("aetna");
    expect(normalizeInsurancePlan("  BCBS  ")).toBe("bcbs");
    expect(normalizeInsurancePlan("Blue Cross")).toBe("bcbs");
    expect(normalizeInsurancePlan("United")).toBe("uhc");
    expect(normalizeInsurancePlan("UnitedHealthcare")).toBe("uhc");
    expect(normalizeInsurancePlan("Kaiser Permanente")).toBe("kaiser");
    // Unknown plans pass through (lowercased) — honest no-match downstream.
    expect(normalizeInsurancePlan("Wellcare")).toBe("wellcare");
    expect(normalizeInsurancePlan(null)).toBeNull();
    expect(normalizeInsurancePlan("")).toBeNull();
  });

  it("filters the directory to providers accepting the requested plan", () => {
    const out = queryProviderDirectory({
      menopauseOnly: false,
      insurance: "aetna",
      limit: 50
    });
    expect(out.query.insurance).toBe("aetna");
    expect(out.providers.length).toBeGreaterThan(0);
    for (const p of out.providers) {
      expect(p.insuranceAccepted ?? []).toContain("aetna");
    }
  });

  it("an unknown plan yields zero results (honest no-match, not a silent no-op)", () => {
    const out = queryProviderDirectory({
      menopauseOnly: false,
      insurance: "wellcare-fake-plan",
      limit: 50
    });
    expect(out.providers.length).toBe(0);
    expect(out.matchType).toBe("none");
    expect(out.query.insurance).toBe("wellcare-fake-plan");
  });

  it("applies BEFORE the tier ladder so each tier honors the plan", () => {
    // certified-national tier (no ZIP, menopauseOnly=true) should also honor
    // the insurance filter — we don't broaden insurance because the strict
    // tier is empty.
    const out = queryProviderDirectory({
      menopauseOnly: true,
      insurance: "aetna",
      fallback: true
    });
    for (const p of out.providers) {
      expect(p.menopauseCertified).toBe(true);
      expect(p.insuranceAccepted ?? []).toContain("aetna");
    }
  });

  it("synonym aliases work in real queries (Blue Cross → bcbs)", () => {
    const a = queryProviderDirectory({
      menopauseOnly: false,
      insurance: "Blue Cross",
      limit: 5
    });
    const b = queryProviderDirectory({
      menopauseOnly: false,
      insurance: "bcbs",
      limit: 5
    });
    expect(a.query.insurance).toBe("bcbs");
    expect(b.query.insurance).toBe("bcbs");
    // Same canonical token → same first-N providers.
    expect(a.providers.map((p) => p.npi)).toEqual(b.providers.map((p) => p.npi));
  });

  it("Medicare floor — every provider in the directory accepts at least one plan", () => {
    // Sanity: insurance.PLANS.medicare is the conservative floor; the
    // directory should never carry an empty insuranceAccepted row.
    const out = queryProviderDirectory({ menopauseOnly: false, limit: 100 });
    for (const p of out.providers) {
      expect((p.insuranceAccepted ?? []).length).toBeGreaterThan(0);
    }
  });
});
