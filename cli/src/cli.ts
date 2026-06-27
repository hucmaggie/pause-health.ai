#!/usr/bin/env node
/**
 * @pause-health/cli — sf-style CLI for the Pause-Health.ai Experience APIs.
 *
 * The Headless 360 audit at /proposal/headless-360 calls out four gaps
 * between Pause's prototype and Salesforce-architect-approved Headless
 * 360 conformance. Gap #4 was "Salesforce CLI parity for Pause tools":
 * Salesforce's Headless 360 trust model exposes every agent capability
 * through three surfaces — REST API, MCP tool, AND `sf` CLI command.
 * Pause shipped the REST + MCP sides during the prototype build-out;
 * this package is the third surface.
 *
 * Design constraints:
 *   - Zero runtime dependencies. Salesforce's `sf` CLI is itself a
 *     heavy tree; for a thin wrapper around four REST endpoints, a
 *     hand-rolled argv parser keeps the install lean and the audit
 *     surface honest.
 *   - Same data path as the MCP server. Every `pause` command hits the
 *     same /api/mulesoft/* surface that mcp/src/tools.ts wraps — so an
 *     operator running `pause providers --zip 92614 --menopause` gets
 *     byte-identical results to the agent calling
 *     `find_menopause_providers({zip: "92614", menopause: true})`.
 *   - Honest output modes. `--json` returns the raw API response
 *     unchanged for piping into jq; the default pretty-prints a small
 *     human summary so the CLI is usable interactively.
 *
 * Not in scope (yet):
 *   - No write commands. The Experience APIs are read-only today; when
 *     Phase 1c ships a write-capable Process API, the CLI grows
 *     `pause intake create` to match.
 *   - No auth flow. The CLI inherits PAUSE_BASE_URL (default
 *     https://pause-health.ai) and an optional PAUSE_API_KEY env. When
 *     the Headless 360 PKCE seam (gap #1) activates user-identity flows,
 *     the CLI grows `pause auth login` to walk the same Authorization
 *     Code + PKCE handshake.
 */
import { runHealth } from "./commands/health.js";
import { runIntake } from "./commands/intake.js";
import { runProviders } from "./commands/providers.js";
import { runTimeline } from "./commands/timeline.js";

const COMMANDS = {
  health: runHealth,
  providers: runProviders,
  timeline: runTimeline,
  intake: runIntake
} as const;

type CommandName = keyof typeof COMMANDS;

function printUsage(): void {
  process.stdout.write(
    [
      "pause — CLI for the Pause-Health.ai Experience APIs",
      "",
      "Usage:",
      "  pause <command> [options]",
      "",
      "Commands:",
      "  health                          Patient health timeline (FHIR R5 Bundle)",
      "  providers [--zip N] [--menopause] [--limit N] [--fallback] [--insurance PLAN] [--telehealth]",
      "                                  Provider directory (menopause-relevant)",
      "  timeline   <patient-id>         Per-patient FHIR Bundle",
      "  intake     <patient-id>         Structured intake record",
      "",
      "Global options:",
      "  --json                          Print the raw JSON response (default: pretty summary)",
      "  --base-url URL                  Override PAUSE_BASE_URL (default: https://pause-health.ai)",
      "  --help, -h                      Show this help and exit",
      "  --version, -v                   Print the CLI version and exit",
      "",
      "Environment:",
      "  PAUSE_BASE_URL                  Default base URL (overridden by --base-url)",
      "  PAUSE_API_KEY                   Optional Bearer token. When set, sent as Authorization header",
      "",
      "Examples:",
      "  pause health",
      "  pause providers --zip 92614 --menopause --limit 3",
      "  pause providers --zip 92614 --menopause --insurance aetna --json | jq '.providers[].name'",
      "  pause timeline pause-demo-patient-001",
      "",
      "The CLI wraps the same /api/mulesoft/* surface the Pause MCP server",
      "exposes. See https://pause-health.ai/proposal/headless-360 for the",
      "audit gap this closes."
    ].join("\n") + "\n"
  );
}

async function readVersion(): Promise<string> {
  // Resolve relative to the compiled output. The package.json sits one
  // directory above dist/, both in the npm tarball and during local dev.
  try {
    const url = new URL("../package.json", import.meta.url);
    const text = await (await import("node:fs/promises")).readFile(url, "utf-8");
    const pkg = JSON.parse(text) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function main(argv: string[]): Promise<number> {
  const [, , ...rest] = argv;
  if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") {
    printUsage();
    return 0;
  }
  if (rest[0] === "--version" || rest[0] === "-v") {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }
  const cmd = rest[0];
  if (!(cmd in COMMANDS)) {
    process.stderr.write(`pause: unknown command '${cmd}'\n\n`);
    printUsage();
    return 2;
  }
  try {
    return await COMMANDS[cmd as CommandName](rest.slice(1));
  } catch (err) {
    process.stderr.write(`pause: ${(err as Error).message}\n`);
    return 1;
  }
}

// Only auto-run when invoked as a binary (skip when imported by tests).
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith("/cli.js") ||
  import.meta.url.endsWith("\\cli.js");

if (invokedDirectly) {
  void main(process.argv).then((code) => {
    process.exit(code);
  });
}
