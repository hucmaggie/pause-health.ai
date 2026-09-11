import { describe, expect, it } from "vitest";

import {
  type IdentifierValidationDetermination,
  DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST,
  DEMO_IDENTIFIER_VALIDATION_REQUEST,
  NPI_PREFIX,
  checksumConsistent,
  evaluateIdentifierValidation,
  identifierNoAutonomousReject,
  identifierValidationSummary,
  identifiersSourced,
  npiCheckDigit,
  validateNpi
} from "./identifier-validation";

describe("npiCheckDigit", () => {
  it("computes the CMS check digit for the canonical example (1234567893)", () => {
    // The 9-digit base 123456789 has check digit 3 (a widely-cited valid NPI).
    expect(npiCheckDigit("123456789")).toBe(3);
  });

  it("uses the 80840 issuer prefix", () => {
    expect(NPI_PREFIX).toBe("80840");
  });

  it("is deterministic", () => {
    expect(npiCheckDigit("198765432")).toBe(npiCheckDigit("198765432"));
  });
});

describe("validateNpi", () => {
  it("accepts a well-formed NPI with a valid check digit", () => {
    const r = validateNpi({ npi: "1234567893" });
    expect(r.disposition).toBe("valid");
    expect(r.expectedCheckDigit).toBe(3);
    expect(r.actualCheckDigit).toBe(3);
  });

  it("flags a transposed / wrong check digit as invalid-checksum", () => {
    const r = validateNpi({ npi: "1234567890" });
    expect(r.disposition).toBe("invalid-checksum");
    expect(r.expectedCheckDigit).toBe(3);
    expect(r.actualCheckDigit).toBe(0);
  });

  it("flags a too-short identifier as invalid-format", () => {
    const r = validateNpi({ npi: "99999" });
    expect(r.disposition).toBe("invalid-format");
    expect(r.expectedCheckDigit).toBeNull();
    expect(r.actualCheckDigit).toBeNull();
  });

  it("flags a non-digit identifier as invalid-format", () => {
    expect(validateNpi({ npi: "12345678a3" }).disposition).toBe("invalid-format");
  });

  it("flags a leading digit outside the 1-2 range as invalid-format", () => {
    expect(validateNpi({ npi: "3234567893" }).disposition).toBe("invalid-format");
    expect(validateNpi({ npi: "0234567893" }).disposition).toBe("invalid-format");
  });

  it("accepts a 2-prefixed NPI with a valid check digit", () => {
    const r = validateNpi({ npi: "2345678900" });
    expect(r.disposition).toBe("valid");
  });
});

describe("evaluateIdentifierValidation", () => {
  it("classifies the mixed demo batch — 1 valid, 1 checksum, 1 format", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(d.total).toBe(3);
    expect(d.validCount).toBe(1);
    expect(d.invalidChecksumCount).toBe(1);
    expect(d.invalidFormatCount).toBe(1);
    expect(d.disposition).toBe("invalids-flagged");
    expect(d.requiresStewardReview).toBe(true);
    expect(d.autoRejected).toBe(false);
    expect(d.results.map((r) => r.disposition)).toEqual([
      "valid",
      "invalid-checksum",
      "invalid-format"
    ]);
  });

  it("reports all-valid for a batch of valid NPIs", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST);
    expect(d.disposition).toBe("all-valid");
    expect(d.validCount).toBe(3);
    expect(d.invalidFormatCount).toBe(0);
    expect(d.invalidChecksumCount).toBe(0);
  });

  it("reports invalids-flagged for a single malformed NPI", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST);
    expect(d.disposition).toBe("invalids-flagged");
    expect(d.invalidFormatCount).toBe(1);
    expect(d.total).toBe(1);
  });

  it("echoes the submitted identifiers so the sourced guard can recompute", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(d.identifiers.map((i) => i.npi)).toEqual(["1234567893", "1234567890", "99999"]);
    expect(d.results).toHaveLength(3);
  });

  it("handles an empty batch (all-valid vacuously)", () => {
    const d = evaluateIdentifierValidation({ batchRef: "b", identifiers: [] });
    expect(d.total).toBe(0);
    expect(d.disposition).toBe("all-valid");
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    const b = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("identifiersSourced", () => {
  it("is true for a produced determination", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(identifiersSourced(d)).toBe(true);
  });

  it("is false when a result is fabricated for an identifier not in the batch", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(
      identifiersSourced({
        ...d,
        results: [
          ...d.results,
          {
            npi: "0000000000",
            disposition: "invalid-format",
            expectedCheckDigit: null,
            actualCheckDigit: null,
            reason: ""
          }
        ],
        total: 4,
        invalidFormatCount: 2
      })
    ).toBe(false);
  });

  it("is false when the counts don't sum to the total", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(identifiersSourced({ ...d, validCount: 2 })).toBe(false);
  });

  it("is false when the disposition doesn't follow the counts", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST);
    expect(identifiersSourced({ ...d, disposition: "invalids-flagged" })).toBe(false);
  });

  it("is false when a result's NPI doesn't match its submitted identifier", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    const tampered = {
      ...d,
      results: [{ ...d.results[0], npi: "1987654328" }, d.results[1], d.results[2]]
    };
    expect(identifiersSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(identifiersSourced(null)).toBe(false);
  });
});

describe("checksumConsistent", () => {
  it("is true for each demo finding", () => {
    expect(
      checksumConsistent(evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST))
    ).toBe(true);
    expect(
      checksumConsistent(evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST))
    ).toBe(true);
    expect(
      checksumConsistent(evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST))
    ).toBe(true);
  });

  it("is false when a checksum-invalid NPI is reported as valid", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    const tampered = {
      ...d,
      results: [
        d.results[0],
        {
          npi: "1234567890",
          disposition: "valid" as const,
          expectedCheckDigit: 0,
          actualCheckDigit: 0,
          reason: ""
        },
        d.results[2]
      ],
      validCount: 2,
      invalidChecksumCount: 0
    };
    expect(checksumConsistent(tampered)).toBe(false);
  });

  it("is false when the reported counts don't match the recomputed dispositions", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(checksumConsistent({ ...d, invalidChecksumCount: 5 })).toBe(false);
  });

  it("ignores the identifiers correspondence — isolated from the sourced check", () => {
    // A finding with an extra correctly-computed result for an out-of-batch NPI:
    // the sourced check fails (results ≠ identifiers) but the checksums still recompute.
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    const tampered = {
      ...d,
      results: [
        ...d.results,
        {
          npi: "0000000000",
          disposition: "invalid-format" as const,
          expectedCheckDigit: null,
          actualCheckDigit: null,
          reason: ""
        }
      ],
      total: 4,
      invalidFormatCount: 2
    };
    expect(checksumConsistent(tampered)).toBe(true);
    expect(identifiersSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(checksumConsistent(null)).toBe(false);
  });
});

describe("identifierNoAutonomousReject", () => {
  it("is true for a produced determination", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(identifierNoAutonomousReject(d)).toBe(true);
  });

  it("is false when the claim was auto-rejected", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(
      identifierNoAutonomousReject({
        ...(d as IdentifierValidationDetermination),
        autoRejected: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when steward review is skipped", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(
      identifierNoAutonomousReject({
        ...(d as IdentifierValidationDetermination),
        requiresStewardReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(identifierNoAutonomousReject(null)).toBe(false);
  });
});

describe("identifierValidationSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateIdentifierValidation(DEMO_IDENTIFIER_VALIDATION_REQUEST);
    expect(identifierValidationSummary(d)).toEqual({
      batchRef: "npi-batch-001",
      disposition: "invalids-flagged",
      total: 3,
      validCount: 1,
      invalidFormatCount: 1,
      invalidChecksumCount: 1,
      requiresStewardReview: true,
      synthetic: true
    });
  });
});
