#!/usr/bin/env node
/**
 * Preflight check for Pause-Health.ai
 *
 * Verifies SSL + HTTP security headers on a target URL.
 *
 * Usage:
 *   PROD_URL=https://pause-health.ai node scripts/preflight.mjs
 *   node scripts/preflight.mjs https://staging.pause-health.ai
 *
 * Exits with code 0 when all required checks pass, 1 otherwise.
 * Optional checks (TLS expiry warnings) print warnings but never fail the run.
 */

import tls from "node:tls";
import { URL } from "node:url";

const REQUIRED_HEADERS = [
  { name: "strict-transport-security", required: true },
  { name: "content-type", required: true },
  { name: "x-content-type-options", required: false, expected: /nosniff/i },
  { name: "referrer-policy", required: false }
];

const TLS_SOON_EXPIRY_DAYS = 14;

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const positional = process.argv.find(
  (a, i) => i >= 2 && !a.startsWith("--") && !a.startsWith("-")
);
const targetRaw = positional || process.env.PROD_URL || arg("--url", null);

if (!targetRaw) {
  console.error(
    "preflight: no target URL provided. Set PROD_URL or pass a URL as the first argument."
  );
  process.exit(2);
}

let target;
try {
  target = new URL(targetRaw);
} catch {
  console.error(`preflight: invalid URL: ${targetRaw}`);
  process.exit(2);
}

if (target.protocol !== "https:") {
  console.error(`preflight: target must be https (got ${target.protocol}).`);
  process.exit(1);
}

const failures = [];
const warnings = [];

function pass(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label) {
  console.log(`  ✗ ${label}`);
  failures.push(label);
}
function warn(label) {
  console.log(`  ! ${label}`);
  warnings.push(label);
}

console.log(`\nPreflight target: ${target.href}\n`);

console.log("HTTPS reachability");
let response;
const controller = new AbortController();
const fetchTimeout = setTimeout(() => controller.abort(), 8000);
try {
  response = await fetch(target.href, {
    method: "GET",
    redirect: "follow",
    signal: controller.signal,
    headers: { "user-agent": "pause-health-preflight/1.0" }
  });
} catch (err) {
  fail(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  clearTimeout(fetchTimeout);
  printSummary();
  process.exit(1);
} finally {
  clearTimeout(fetchTimeout);
}

if (!response.ok) {
  fail(`HTTP ${response.status} ${response.statusText}`);
} else {
  pass(`HTTP ${response.status} ${response.statusText}`);
}

console.log("\nSecurity headers");
const headers = response.headers;
for (const h of REQUIRED_HEADERS) {
  const value = headers.get(h.name);
  if (!value) {
    if (h.required) fail(`missing ${h.name}`);
    else warn(`missing ${h.name}`);
    continue;
  }
  if (h.expected && !h.expected.test(value)) {
    warn(`${h.name} = ${value} (does not match ${h.expected})`);
    continue;
  }
  pass(`${h.name} = ${truncate(value, 80)}`);
}

console.log("\nTLS certificate");
try {
  await new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: target.hostname,
        port: target.port ? Number(target.port) : 443,
        servername: target.hostname,
        timeout: 8000
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) {
          warn("could not read certificate metadata");
          socket.end();
          return resolve();
        }
        const expiresAt = new Date(cert.valid_to);
        const now = Date.now();
        const msLeft = expiresAt.getTime() - now;
        const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        if (msLeft <= 0) {
          fail(`certificate expired ${expiresAt.toISOString()}`);
        } else if (daysLeft <= TLS_SOON_EXPIRY_DAYS) {
          warn(`certificate expires in ${daysLeft} days (${expiresAt.toISOString()})`);
        } else {
          pass(
            `cert valid ${daysLeft} more days (issuer: ${cert.issuer?.O || "unknown"})`
          );
        }
        socket.end();
        resolve();
      }
    );
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS handshake timed out"));
    });
    socket.on("error", (err) => reject(err));
  });
} catch (err) {
  fail(`TLS check failed: ${err instanceof Error ? err.message : String(err)}`);
}

printSummary();
process.exit(failures.length > 0 ? 1 : 0);

function truncate(value, max) {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}

function printSummary() {
  console.log("");
  console.log(
    `Preflight complete · ${failures.length} failure(s), ${warnings.length} warning(s).`
  );
  if (failures.length === 0 && warnings.length === 0) {
    console.log("All checks passed.");
  }
}
