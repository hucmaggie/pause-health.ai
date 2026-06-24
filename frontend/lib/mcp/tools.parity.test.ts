/**
 * Parity test: `frontend/lib/mcp/tools.ts` must stay in lockstep with
 * the canonical `mcp/src/tools.ts`. The two copies exist because
 * frontend/ and mcp/ are separate npm packages; a relative TS import
 * would break the standalone `npm publish` path. Drift between them
 * means the Next.js MCP route and the published stdio binary expose
 * different tool surfaces — exactly the failure mode this test guards.
 *
 * Headers (the top JSDoc block) are allowed to differ because each
 * copy is named differently from its own POV. Everything from the
 * first `import` line down must be byte-identical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FRONTEND_COPY = resolve(__dirname, "tools.ts");
const CANONICAL = resolve(__dirname, "..", "..", "..", "mcp", "src", "tools.ts");

function bodyOf(path: string): string {
  const src = readFileSync(path, "utf-8");
  // Strip the leading JSDoc block: everything up through and including
  // the first `*/` line. Then advance to the first non-blank line so
  // both files start at `import ...`.
  const close = src.indexOf("*/");
  if (close === -1) {
    throw new Error(`${path} has no leading JSDoc header`);
  }
  return src.slice(close + 2).replace(/^\s*/, "");
}

describe("MCP tools.ts parity", () => {
  it("frontend copy matches the canonical mcp/src/tools.ts body", () => {
    const frontend = bodyOf(FRONTEND_COPY);
    const canonical = bodyOf(CANONICAL);
    expect(frontend).toBe(canonical);
  });
});
