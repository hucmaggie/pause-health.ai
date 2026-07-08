import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_VERSION } from "./tools";

/**
 * Drift guard for the standalone `@pause-health/mcp` npm package version.
 *
 * SERVER_VERSION (reported on the MCP `initialize` handshake) is already
 * pinned against the public descriptor and the Agent Fabric registry. But the
 * npm package's OWN version in mcp/package.json — what `npx @pause-health/mcp`
 * advertises and what ships in the published bin — is a separate string with
 * no guard. It has drifted before (the build journal once claimed v0.2.0 while
 * the code reported 0.3.0). Bind them so a version bump in one place fails
 * loudly until the other is updated too.
 */

const MCP_PKG = resolve(__dirname, "..", "..", "..", "mcp", "package.json");

describe("standalone @pause-health/mcp package ⇄ SERVER_VERSION", () => {
  it("mcp/package.json version equals the version the server reports", () => {
    const pkg = JSON.parse(readFileSync(MCP_PKG, "utf-8")) as { version: string };
    expect(pkg.version).toBe(SERVER_VERSION);
  });
});
