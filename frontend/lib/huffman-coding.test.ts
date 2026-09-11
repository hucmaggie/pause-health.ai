import { describe, expect, it } from "vitest";

import {
  DEMO_HUFFMAN_REQUEST,
  DEMO_HUFFMAN_SKEWED_REQUEST,
  DEMO_HUFFMAN_UNIFORM_REQUEST,
  buildHuffmanCodes,
  codeOptimal,
  codeSourced,
  evaluateHuffman,
  fixedWidthBits,
  huffmanOptimalLength,
  huffmanSummary,
  noAutonomousDeploy
} from "./huffman-coding";

describe("buildHuffmanCodes", () => {
  it("produces a prefix-free code with the frequent symbol shortest", () => {
    const codes = buildHuffmanCodes(DEMO_HUFFMAN_REQUEST.symbols);
    const byId = Object.fromEntries(codes.map((c) => [c.symbol, c]));
    expect(byId["heartbeat"].length).toBe(1);
    expect(byId["reading-normal"].length).toBe(2);
    expect(byId["reading-high"].length).toBe(3);
    // The two rarest symbols sit at the deepest level.
    expect(byId["battery-low"].length).toBe(4);
    expect(byId["sync-error"].length).toBe(4);
    // Prefix-free: no code is a prefix of another.
    const strings = codes.map((c) => c.code);
    for (let i = 0; i < strings.length; i++) {
      for (let j = 0; j < strings.length; j++) {
        if (i !== j) expect(strings[j].startsWith(strings[i])).toBe(false);
      }
    }
  });

  it("gives a single symbol a one-bit code", () => {
    const codes = buildHuffmanCodes([{ symbol: "only", frequency: 9 }]);
    expect(codes).toEqual([{ symbol: "only", code: "0", length: 1, frequency: 9 }]);
  });

  it("returns empty for no symbols", () => {
    expect(buildHuffmanCodes([])).toEqual([]);
  });
});

describe("fixedWidthBits", () => {
  it("is ceil(log2(n)) for n>=2, else 0", () => {
    expect(fixedWidthBits(0)).toBe(0);
    expect(fixedWidthBits(1)).toBe(0);
    expect(fixedWidthBits(4)).toBe(2);
    expect(fixedWidthBits(5)).toBe(3);
  });
});

describe("huffmanOptimalLength", () => {
  it("is the weighted total of the optimal code", () => {
    expect(huffmanOptimalLength(DEMO_HUFFMAN_REQUEST.symbols)).toBe(178);
    expect(huffmanOptimalLength(DEMO_HUFFMAN_SKEWED_REQUEST.symbols)).toBe(130);
    expect(huffmanOptimalLength(DEMO_HUFFMAN_UNIFORM_REQUEST.symbols)).toBe(80);
  });
});

describe("evaluateHuffman", () => {
  it("classifies a compressible stream", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    expect(d.weightedTotal).toBe(178);
    expect(d.fixedTotal).toBe(300);
    expect(d.disposition).toBe("compressible");
    expect(d.requiresEngineerReview).toBe(true);
    expect(d.autoDeployed).toBe(false);
  });

  it("classifies a uniform stream as already-uniform", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_UNIFORM_REQUEST);
    expect(d.weightedTotal).toBe(80);
    expect(d.fixedTotal).toBe(80);
    expect(d.disposition).toBe("already-uniform");
  });

  it("classifies a heavily-skewed stream as compressible", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_SKEWED_REQUEST);
    expect(d.weightedTotal).toBe(130);
    expect(d.disposition).toBe("compressible");
  });

  it("is deterministic", () => {
    expect(evaluateHuffman(DEMO_HUFFMAN_REQUEST)).toEqual(evaluateHuffman(DEMO_HUFFMAN_REQUEST));
  });
});

describe("codeSourced", () => {
  it("is true for each demo assignment", () => {
    expect(codeSourced(evaluateHuffman(DEMO_HUFFMAN_REQUEST))).toBe(true);
    expect(codeSourced(evaluateHuffman(DEMO_HUFFMAN_UNIFORM_REQUEST))).toBe(true);
    expect(codeSourced(evaluateHuffman(DEMO_HUFFMAN_SKEWED_REQUEST))).toBe(true);
  });

  it("is false for a non-prefix-free code (isolated from code-optimal)", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    // Re-assign codes with the same lengths {1,2,3,4,4} but a prefix violation:
    // heartbeat "0" is a prefix of reading-normal "01". weightedTotal stays 178.
    const codes = [
      { symbol: "heartbeat", code: "0", length: 1, frequency: 50 },
      { symbol: "reading-normal", code: "01", length: 2, frequency: 30 },
      { symbol: "reading-high", code: "110", length: 3, frequency: 12 },
      { symbol: "battery-low", code: "1110", length: 4, frequency: 5 },
      { symbol: "sync-error", code: "1111", length: 4, frequency: 3 }
    ];
    const tampered = { ...d, codes };
    expect(codeSourced(tampered)).toBe(false);
    expect(codeOptimal(tampered)).toBe(true);
  });

  it("is false for a fabricated symbol", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    const codes = d.codes.map((c) =>
      c.symbol === "sync-error" ? { ...c, symbol: "phantom-event" } : c
    );
    expect(codeSourced({ ...d, codes })).toBe(false);
  });

  it("is false for an overstated weightedTotal", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    expect(codeSourced({ ...d, weightedTotal: 170 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(codeSourced(null)).toBe(false);
  });
});

describe("codeOptimal", () => {
  it("is true for each demo assignment", () => {
    expect(codeOptimal(evaluateHuffman(DEMO_HUFFMAN_REQUEST))).toBe(true);
    expect(codeOptimal(evaluateHuffman(DEMO_HUFFMAN_UNIFORM_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal (fixed-width) code (while code-sourced stays true)", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_SKEWED_REQUEST);
    // A valid, prefix-free, fixed-width 2-bit code — honest total 200, but sub-optimal (optimum is 130).
    const codes = [
      { symbol: "ack", code: "00", length: 2, frequency: 80 },
      { symbol: "nack", code: "01", length: 2, frequency: 10 },
      { symbol: "retry", code: "10", length: 2, frequency: 6 },
      { symbol: "drop", code: "11", length: 2, frequency: 4 }
    ];
    const tampered = { ...d, codes, weightedTotal: 200, disposition: "already-uniform" as const };
    expect(codeSourced(tampered)).toBe(true);
    expect(codeOptimal(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(codeOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousDeploy", () => {
  it("is true for a produced assignment", () => {
    expect(noAutonomousDeploy(evaluateHuffman(DEMO_HUFFMAN_REQUEST))).toBe(true);
  });

  it("is false when auto-deployed", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    expect(noAutonomousDeploy({ ...d, autoDeployed: true as unknown as false })).toBe(false);
  });

  it("is false when engineer review is skipped", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    expect(noAutonomousDeploy({ ...d, requiresEngineerReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousDeploy(null)).toBe(false);
  });
});

describe("huffmanSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateHuffman(DEMO_HUFFMAN_REQUEST);
    expect(huffmanSummary(d)).toEqual({
      streamRef: "rpm-device-events",
      disposition: "compressible",
      symbolCount: 5,
      weightedTotal: 178,
      fixedTotal: 300,
      savedBits: 122,
      requiresEngineerReview: true,
      synthetic: true
    });
  });
});
