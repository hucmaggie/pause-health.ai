#!/usr/bin/env node
/**
 * Smoke test: invoke the built bin against the live Experience APIs.
 * Run after `npm run build`. Exits non-zero on the first failure.
 *
 * Usage:
 *   node scripts/smoke.mjs
 *   PAUSE_BASE_URL=https://preview-abc.vercel.app node scripts/smoke.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, "..", "dist", "cli.js");

const CASES = [
  { args: ["--help"], expectExit: 0, expectStdoutInclude: "Usage:" },
  { args: ["--version"], expectExit: 0, expectStdoutMatch: /^\d+\.\d+\.\d+/ },
  { args: ["bogus"], expectExit: 2, expectStderrInclude: "unknown command" },
  { args: ["health"], expectExit: 0, expectStdoutInclude: "source:" },
  {
    args: ["providers", "--menopause", "--limit", "1"],
    expectExit: 0,
    expectStdoutInclude: "matchType:"
  },
  {
    args: ["providers", "--menopause", "--limit", "1", "--json"],
    expectExit: 0,
    expectStdoutMatch: /"matchType"\s*:/
  }
];

let failed = 0;
for (const c of CASES) {
  const res = spawnSync("node", [BIN, ...c.args], {
    encoding: "utf-8",
    env: { ...process.env }
  });
  const ok =
    res.status === c.expectExit &&
    (!c.expectStdoutInclude || res.stdout.includes(c.expectStdoutInclude)) &&
    (!c.expectStderrInclude || res.stderr.includes(c.expectStderrInclude)) &&
    (!c.expectStdoutMatch || c.expectStdoutMatch.test(res.stdout));
  if (ok) {
    console.log(`✓ pause ${c.args.join(" ")}`);
  } else {
    failed++;
    console.error(`✗ pause ${c.args.join(" ")}`);
    console.error(`  exit=${res.status} (expected ${c.expectExit})`);
    if (c.expectStdoutInclude && !res.stdout.includes(c.expectStdoutInclude)) {
      console.error(`  stdout missing: ${c.expectStdoutInclude}`);
    }
    if (c.expectStdoutMatch && !c.expectStdoutMatch.test(res.stdout)) {
      console.error(`  stdout no match: ${c.expectStdoutMatch}`);
    }
    if (c.expectStderrInclude && !res.stderr.includes(c.expectStderrInclude)) {
      console.error(`  stderr missing: ${c.expectStderrInclude}`);
    }
    console.error(`  stdout:\n${res.stdout.slice(0, 400)}`);
    console.error(`  stderr:\n${res.stderr.slice(0, 400)}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${CASES.length} cases failed`);
  process.exit(1);
}
console.log(`\n${CASES.length}/${CASES.length} smoke cases passed`);
