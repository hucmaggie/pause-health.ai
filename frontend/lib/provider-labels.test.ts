import { describe, expect, it } from "vitest";
import {
  PLAN_LABELS,
  PLAN_OPTIONS,
  SIGNAL_LABELS,
  SIGNAL_LABELS_VERBOSE,
  planLabel,
  signalLabel,
  signalLabelVerbose
} from "./provider-labels";

/**
 * provider-labels is the single source of truth for the three provider
 * surfaces (directory index, profile, RecommendedProviders). These tests pin
 * the two deliberate signal vocabularies, the shared plan labels, the
 * raw-token fallback, and — most importantly — that the compact and verbose
 * signal maps can't drift out of key-alignment (adding a token to one without
 * the other would silently degrade one surface to the raw token).
 */

describe("provider-labels · signal vocabularies", () => {
  it("compact labels are terse; verbose labels are spelled out", () => {
    expect(signalLabel("facog")).toBe("Board-cert OB/GYN");
    expect(signalLabelVerbose("facog")).toBe("Board-certified OB/GYN");
    expect(signalLabel("whnp")).toBe("Women's Health NP");
    expect(signalLabelVerbose("whnp")).toBe("Women's Health Nurse Practitioner");
  });

  it("both maps cover exactly the same token set (no drift)", () => {
    expect(Object.keys(SIGNAL_LABELS).sort()).toEqual(
      Object.keys(SIGNAL_LABELS_VERBOSE).sort()
    );
  });

  it("falls back to the raw lowercase token when unknown", () => {
    expect(signalLabel("mystery-token")).toBe("mystery-token");
    expect(signalLabelVerbose("mystery-token")).toBe("mystery-token");
  });
});

describe("provider-labels · plan labels", () => {
  it("maps canonical tokens to display labels with a raw fallback", () => {
    expect(planLabel("bcbs")).toBe("BCBS");
    expect(planLabel("aetna")).toBe("Aetna");
    expect(planLabel("some-regional-hmo")).toBe("some-regional-hmo");
  });

  it("PLAN_OPTIONS mirrors PLAN_LABELS for the directory <select>", () => {
    expect(PLAN_OPTIONS).toEqual(Object.entries(PLAN_LABELS));
    expect(PLAN_OPTIONS.length).toBe(Object.keys(PLAN_LABELS).length);
  });
});
