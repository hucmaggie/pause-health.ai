import { describe, expect, it } from "vitest";
import {
  recommendedMetaParts,
  recommendedPlanChips,
  recommendedPlanLabel,
  recommendedProfileHref,
  recommendedSignalLabel,
  type RecommendedProviderEntry
} from "./recommended-providers";

const base: RecommendedProviderEntry = {
  npi: "1234567890",
  name: "Dr. Test",
  specialty: "Obstetrics & Gynecology",
  city: "Irvine",
  state: "CA",
  telehealth: false,
  distanceMiles: null,
  serviceSignals: [],
  insuranceAccepted: []
};

describe("recommendedProfileHref", () => {
  it("links to the bare profile when no ZIP is supplied", () => {
    expect(recommendedProfileHref("1234567890")).toBe("/provider/1234567890");
    expect(recommendedProfileHref("1234567890", null)).toBe("/provider/1234567890");
    expect(recommendedProfileHref("1234567890", "")).toBe("/provider/1234567890");
  });

  it("carries ?from=<zip> so the profile can show the distance chip", () => {
    expect(recommendedProfileHref("1234567890", "92614")).toBe(
      "/provider/1234567890?from=92614"
    );
  });

  it("URL-encodes both the NPI and the ZIP", () => {
    expect(recommendedProfileHref("a/b", "9 2")).toBe("/provider/a%2Fb?from=9%202");
  });
});

describe("recommendedMetaParts", () => {
  it("includes city/state when both present", () => {
    expect(recommendedMetaParts(base)).toEqual(["Irvine, CA"]);
  });

  it("omits location when either city or state is missing", () => {
    expect(recommendedMetaParts({ ...base, state: "" })).toEqual([]);
    expect(recommendedMetaParts({ ...base, city: "" })).toEqual([]);
  });

  it("renders distance rounded to one decimal when present", () => {
    expect(recommendedMetaParts({ ...base, distanceMiles: 4.26 })).toEqual([
      "Irvine, CA",
      "4.3 mi away"
    ]);
    expect(recommendedMetaParts({ ...base, distanceMiles: 4 })).toEqual([
      "Irvine, CA",
      "4 mi away"
    ]);
  });

  it("omits distance when null and appends telehealth when true", () => {
    expect(
      recommendedMetaParts({ ...base, distanceMiles: null, telehealth: true })
    ).toEqual(["Irvine, CA", "telehealth"]);
  });

  it("orders parts location → distance → telehealth", () => {
    expect(
      recommendedMetaParts({ ...base, distanceMiles: 2.5, telehealth: true })
    ).toEqual(["Irvine, CA", "2.5 mi away", "telehealth"]);
  });
});

describe("recommendedPlanChips", () => {
  it("returns all plans and zero overflow within the cap", () => {
    expect(recommendedPlanChips(["aetna", "bcbs"])).toEqual({
      shown: ["aetna", "bcbs"],
      overflow: 0
    });
  });

  it("caps at 4 and reports the remainder as overflow", () => {
    expect(
      recommendedPlanChips(["a", "b", "c", "d", "e", "f"])
    ).toEqual({ shown: ["a", "b", "c", "d"], overflow: 2 });
  });

  it("handles undefined / empty plans", () => {
    expect(recommendedPlanChips(undefined)).toEqual({ shown: [], overflow: 0 });
    expect(recommendedPlanChips([])).toEqual({ shown: [], overflow: 0 });
  });

  it("respects a custom cap", () => {
    expect(recommendedPlanChips(["a", "b", "c"], 2)).toEqual({
      shown: ["a", "b"],
      overflow: 1
    });
  });
});

describe("label lookups", () => {
  it("maps known signal/plan tokens to human labels", () => {
    expect(recommendedSignalLabel("facog")).toBe("Board-cert OB/GYN");
    expect(recommendedSignalLabel("whnp")).toBe("Women's Health NP");
    expect(recommendedPlanLabel("bcbs")).toBe("BCBS");
    expect(recommendedPlanLabel("aetna")).toBe("Aetna");
  });

  it("falls back to the raw token when unknown", () => {
    expect(recommendedSignalLabel("mystery-token")).toBe("mystery-token");
    expect(recommendedPlanLabel("some-regional-hmo")).toBe("some-regional-hmo");
  });
});
