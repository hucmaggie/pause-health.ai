#!/usr/bin/env node
/**
 * End-to-end smoke test for Pause-Health.ai
 *
 * Runs two suites against a running Next.js dev server:
 *
 *   1. Static page audit
 *      - Hits every public route, confirms 200 + non-empty HTML.
 *      - Extracts internal links (`<a href="/...">`) from each page
 *        and verifies the targets resolve too. Catches dead links.
 *
 *   2. API smoke
 *      - GETs every read endpoint with sensible params.
 *      - POSTs every write endpoint with realistic fixtures
 *        (taken from the body-type definitions in each route.ts).
 *      - Confirms the response shape parses as JSON and the status
 *        is in the expected range.
 *
 * Usage (with dev server already running on localhost:3000):
 *
 *   node scripts/smoke-test.mjs
 *
 * Or pass a different base URL:
 *
 *   BASE_URL=https://pause-health.ai node scripts/smoke-test.mjs
 *
 * Writes a Markdown report to the repo root. Path depends on target:
 *
 *   - localhost / 127.0.0.1 → ../SMOKE_TEST_RESULTS.md
 *   - anything else (e.g. https://pause-health.ai) →
 *     ../SMOKE_TEST_RESULTS.<slug>.md (e.g. SMOKE_TEST_RESULTS.pause-health-ai.md)
 *   - override with REPORT_PATH=... env var
 *
 * The per-target split keeps the committed local-target evidence
 * file (referenced by /roadmap) from getting clobbered by ad-hoc
 * production runs that pass-but-with-different-counts (production
 * may be running an older deploy). Only the local-target file is
 * meant to be committed.
 *
 * Exit code 0 if all checks pass, 1 otherwise.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = process.env.BASE_URL || "http://localhost:3000";
const REPO_ROOT = resolve(__dirname, "..", "..");

// The committed SMOKE_TEST_RESULTS.md is evidence captured against a
// local dev server (the roadmap's "Run via npm run smoke" line points
// at it). Smoking production should NOT overwrite that evidence — its
// page-link counts and timings reflect the deployed surface, not the
// current main, and clobbering causes confusing diffs. Default to a
// per-target file when BASE_URL is anything other than localhost, and
// allow REPORT_PATH=... to override either way.
function defaultReportPath(base) {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(base);
  if (isLocal) return resolve(REPO_ROOT, "SMOKE_TEST_RESULTS.md");
  // Slugify the host for the filename: pause-health.ai → "pause-health-ai".
  let host;
  try {
    host = new URL(base).host;
  } catch {
    host = "unknown";
  }
  const slug = host.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return resolve(REPO_ROOT, `SMOKE_TEST_RESULTS.${slug}.md`);
}
const REPORT_PATH = process.env.REPORT_PATH
  ? resolve(process.env.REPORT_PATH)
  : defaultReportPath(BASE);

const PERSONA_ID = "anika-patel";
const PATIENT_ID = "pause-demo-patient-001";

const STATIC_ROUTES = [
  "/",
  "/about",
  "/blog",
  "/careers",
  "/changelog",
  "/contact",
  "/hipaa",
  "/press",
  "/privacy",
  "/provider",
  "/provider?zip=92614&menopause=true&telehealth=true",
  "/provider/1730155570?from=92614",
  "/research",
  "/roadmap",
  "/security",
  "/terms",
  "/proposal",
  "/proposal/agent-fabric",
  "/proposal/agentforce",
  "/proposal/agentforce-voice",
  "/proposal/headless-360",
  "/proposal/competition",
  "/proposal/customers",
  "/proposal/data",
  "/proposal/data-360",
  "/proposal/dbdp",
  "/proposal/full",
  "/proposal/insights",
  "/proposal/integration",
  "/proposal/mcp",
  "/proposal/menopause-society",
  "/proposal/mulesoft",
  "/proposal/provider-graph",
  "/proposal/strategy",
  "/proposal/technology",
  "/demo/intake",
  "/demo/patient",
  "/demo/routing",
  "/demo/agent-fabric",
  "/demo/analytics"
];

// Persona-aware demo routes (test that persona-query handling works)
const PERSONA_ROUTES = [
  `/demo/intake?personaId=${PERSONA_ID}`,
  `/demo/patient?personaId=${PERSONA_ID}`,
  `/demo/routing?personaId=${PERSONA_ID}`,
  `/demo/agent-fabric?personaId=${PERSONA_ID}`
];

// Pages that intentionally proxy/mock external services. If 502/503
// shows up on these in production we want to know, but in dev they
// should always 200 (mock fallback is the default with no SF_* env).
const API_CALLS = [
  {
    label: "GET /api/agent-fabric/agents",
    method: "GET",
    path: "/api/agent-fabric/agents"
  },
  {
    label: "GET /api/agent-fabric/policies",
    method: "GET",
    path: "/api/agent-fabric/policies"
  },
  {
    label: "GET /api/agent-fabric/traces",
    method: "GET",
    path: "/api/agent-fabric/traces"
  },
  {
    label: "GET /api/data-360/segments",
    method: "GET",
    path: "/api/data-360/segments"
  },
  {
    label: "GET /api/data-360/patient/[id]/record",
    method: "GET",
    path: `/api/data-360/patient/${PATIENT_ID}/record`
  },
  {
    label: "GET /api/data-360/patient/[id]/grounding",
    method: "GET",
    path: `/api/data-360/patient/${PATIENT_ID}/grounding`
  },
  {
    label: "GET /api/intake/prechat-context?personaId=" + PERSONA_ID,
    method: "GET",
    path: `/api/intake/prechat-context?personaId=${PERSONA_ID}`
  },
  {
    label: "GET /api/mulesoft/health",
    method: "GET",
    path: "/api/mulesoft/health"
  },
  {
    label: "GET /api/mulesoft/patient/[id]/timeline",
    method: "GET",
    path: `/api/mulesoft/patient/${PATIENT_ID}/timeline`
  },
  {
    label: "GET /api/mulesoft/patient/[id]/intake",
    method: "GET",
    path: `/api/mulesoft/patient/${PATIENT_ID}/intake`
  },
  {
    label: "GET /api/mulesoft/providers?zip=10001",
    method: "GET",
    path: "/api/mulesoft/providers?zip=10001&menopause=true&limit=5"
  },
  {
    label: "GET /api/agentforce/voice/config",
    method: "GET",
    path: "/api/agentforce/voice/config"
  },
  {
    label: "GET /api/salesforce/headless-360/config",
    method: "GET",
    path: "/api/salesforce/headless-360/config"
  },
  {
    label: "GET /api/agent-fabric/sf-sink/config",
    method: "GET",
    path: "/api/agent-fabric/sf-sink/config"
  },
  {
    label: "GET /api/agents/care-router/.well-known/agent.json",
    method: "GET",
    path: "/api/agents/care-router/.well-known/agent.json"
  },
  {
    label: "POST /api/data-360/identity/resolve",
    method: "POST",
    path: "/api/data-360/identity/resolve",
    body: {
      preferredName: "Anika",
      ageBand: "45-49",
      cycleStatus: "perimenopausal"
    }
  },
  {
    label: "POST /api/agent-fabric/governance/evaluate (pass)",
    method: "POST",
    path: "/api/agent-fabric/governance/evaluate",
    body: {
      agentId: "care-router-claude",
      task: {
        hasRedFlagScreen: true,
        requestedModel: "claude-sonnet-4-5-20250929",
        hasRationaleField: true
      }
    }
  },
  {
    label: "POST /api/intake/route-to-care-router",
    method: "POST",
    path: "/api/intake/route-to-care-router",
    body: {
      personaId: PERSONA_ID
    }
  },
  {
    label: "POST /api/agents/care-router/tasks (A2A JSON-RPC)",
    method: "POST",
    path: "/api/agents/care-router/tasks",
    body: {
      jsonrpc: "2.0",
      id: "smoke-test-1",
      method: "tasks/send",
      params: {
        id: "smoke-task-1",
        sessionId: "smoke-session-1",
        message: {
          role: "user",
          parts: [
            {
              kind: "data",
              data: {
                intake: {
                  preferredName: "Anika",
                  ageBand: "45-49",
                  cycleStatus: "perimenopausal",
                  chiefComplaint:
                    "Vasomotor symptoms 4x/night, mood low for 6 weeks",
                  symptomCluster: ["vasomotor", "sleep", "mood"],
                  redFlagScreen: { chestPainSob: false, unilateralLegPain: false }
                }
              }
            }
          ]
        }
      }
    }
  }
];

// We intentionally skip POSTs to /api/contact and /api/subscribe.
// They run Turnstile verification + provider integrations that are
// gated on env vars; a smoke test should not be creating real
// inbound messages. Their unit tests already cover the happy paths.

const results = {
  static: [],
  internalLinks: [],
  api: [],
  mcp: [],
  startedAt: new Date().toISOString(),
  base: BASE,
  pass: 0,
  fail: 0,
  warn: 0
};

function record(category, entry) {
  results[category].push(entry);
  if (entry.outcome === "pass") results.pass++;
  else if (entry.outcome === "warn") results.warn++;
  else results.fail++;
}

async function fetchWithTimeout(url, options = {}, ms = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probeStatic(routePath, { collectLinks = false } = {}) {
  const url = BASE + routePath;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();
    const ms = Date.now() - start;
    const ok = res.ok && text.length > 200;
    const entry = {
      outcome: ok ? "pass" : "fail",
      label: routePath,
      status: res.status,
      bytes: text.length,
      ms,
      note: ok ? "" : `status=${res.status} bytes=${text.length}`
    };
    record("static", entry);
    if (collectLinks && ok) {
      const links = extractInternalLinks(text);
      return { html: text, links };
    }
    return { html: text, links: [] };
  } catch (err) {
    record("static", {
      outcome: "fail",
      label: routePath,
      status: 0,
      bytes: 0,
      ms: Date.now() - start,
      note: `error: ${err.message}`
    });
    return { html: "", links: [] };
  }
}

function extractInternalLinks(html) {
  // Match the href value up to the closing quote OR the fragment (#),
  // but preserve the query string (?) -- some links carry a required
  // personaId or patient id that the target endpoint validates.
  const re = /href="(\/[^"#]*)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(html))) {
    const path = m[1];
    // Skip Next.js asset paths and file extensions
    if (path.startsWith("/_next")) continue;
    if (path.startsWith("/brand/")) continue;
    if (path.startsWith("/team/")) continue;
    if (path === "/" && out.size > 0) continue;
    // Strip query string for the asset-extension check (don't want to
    // skip /demo/intake?personaId=foo just because of the literal "?").
    const noQuery = path.split("?")[0];
    if (/\.(png|jpg|jpeg|svg|webp|ico|json|xml|txt|css|js)$/i.test(noQuery)) continue;
    out.add(path);
  }
  return [...out];
}

async function probeInternalLink(link, fromRoute) {
  const url = BASE + link;
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" }, 10000);
    // Some Next.js routes don't implement HEAD; fall back to GET
    if (res.status === 405 || res.status === 501) {
      const r2 = await fetchWithTimeout(url, { method: "GET" }, 15000);
      record("internalLinks", {
        outcome: r2.ok ? "pass" : "fail",
        label: `${fromRoute} → ${link}`,
        status: r2.status,
        note: r2.ok ? "" : `status=${r2.status} via GET`
      });
      return;
    }
    record("internalLinks", {
      outcome: res.ok ? "pass" : "fail",
      label: `${fromRoute} → ${link}`,
      status: res.status,
      note: res.ok ? "" : `status=${res.status}`
    });
  } catch (err) {
    record("internalLinks", {
      outcome: "fail",
      label: `${fromRoute} → ${link}`,
      status: 0,
      note: `error: ${err.message}`
    });
  }
}

async function probeApi(call) {
  const url = BASE + call.path;
  const start = Date.now();
  try {
    const init = { method: call.method };
    if (call.body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(call.body);
    }
    const res = await fetchWithTimeout(url, init, 60000);
    const text = await res.text();
    const ms = Date.now() - start;
    let parsed = null;
    let parseOk = true;
    try {
      parsed = JSON.parse(text);
    } catch {
      parseOk = false;
    }
    // Acceptable outcomes vary per route:
    //   - Most return 200 with JSON.
    //   - care-router tasks returns 200 with a JSON-RPC envelope.
    //   - identity/resolve returns 200 with { unifiedPatientId, _source }.
    // Anything 4xx/5xx is a fail; anything that doesn't parse as JSON
    // is a warn (some endpoints may legitimately return error HTML in
    // dev, but production endpoints should be JSON-clean).
    const status = res.status;
    let outcome = "pass";
    let note = "";
    if (status >= 500) {
      outcome = "fail";
      note = `server error status=${status}`;
    } else if (status >= 400) {
      outcome = "fail";
      note = `client error status=${status}`;
    } else if (!parseOk) {
      outcome = "warn";
      note = `non-JSON body (status=${status})`;
    }
    record("api", {
      outcome,
      label: call.label,
      status,
      ms,
      bytes: text.length,
      note,
      shape: parseOk ? topLevelKeys(parsed) : null
    });
  } catch (err) {
    record("api", {
      outcome: "fail",
      label: call.label,
      status: 0,
      ms: Date.now() - start,
      bytes: 0,
      note: `error: ${err.message}`
    });
  }
}

function topLevelKeys(obj) {
  if (obj == null) return null;
  if (Array.isArray(obj)) return `[${obj.length} items]`;
  if (typeof obj === "object") return Object.keys(obj).slice(0, 6).join(", ");
  return typeof obj;
}

// MCP Streamable HTTP returns an SSE stream on POST. Read until we see
// the first `data: { ... }` line for our request id and parse it.
async function probeMcpInitialize() {
  const url = BASE + "/api/mcp";
  const start = Date.now();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "pause-smoke-test", version: "0.1.0" }
    }
  });
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body
      },
      30000
    );
    const text = await res.text();
    const ms = Date.now() - start;
    const dataLine = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    let serverName = null;
    let serverVersion = null;
    let toolsHint = false;
    if (dataLine) {
      try {
        const env = JSON.parse(dataLine.slice("data:".length).trim());
        serverName = env?.result?.serverInfo?.name ?? null;
        serverVersion = env?.result?.serverInfo?.version ?? null;
        toolsHint = Boolean(env?.result?.capabilities?.tools);
      } catch {
        /* fall through to fail below */
      }
    }
    const ok =
      res.ok &&
      serverName === "pause-health-mcp" &&
      typeof serverVersion === "string" &&
      toolsHint;
    record("mcp", {
      outcome: ok ? "pass" : "fail",
      label: "POST /api/mcp (initialize)",
      status: res.status,
      ms,
      bytes: text.length,
      note: ok
        ? `serverInfo=${serverName}@${serverVersion} tools=advertised`
        : `status=${res.status} serverName=${serverName} version=${serverVersion} toolsHint=${toolsHint}`
    });
  } catch (err) {
    record("mcp", {
      outcome: "fail",
      label: "POST /api/mcp (initialize)",
      status: 0,
      ms: Date.now() - start,
      bytes: 0,
      note: `error: ${err.message}`
    });
  }
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchWithTimeout(BASE + "/", {}, 3000);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log(`smoke: target=${BASE}`);
  const ready = await waitForServer();
  if (!ready) {
    console.error(`smoke: server at ${BASE} did not respond. Is dev running?`);
    process.exit(2);
  }
  console.log("smoke: server reachable, beginning suite");

  // 1. Static pages
  console.log(`\nsmoke [1/3]: static pages (${STATIC_ROUTES.length} routes)...`);
  const linkPlan = new Map(); // route -> Set(links)
  for (const route of STATIC_ROUTES) {
    const { links } = await probeStatic(route, { collectLinks: true });
    if (links.length) linkPlan.set(route, links);
  }
  for (const route of PERSONA_ROUTES) {
    await probeStatic(route);
  }

  // 2. Internal links discovered from each page
  // Dedupe to avoid probing /demo/intake 30x from every footer link.
  const linkProbes = new Map(); // link -> firstRouteThatLinkedToIt
  for (const [route, links] of linkPlan) {
    for (const link of links) {
      if (!linkProbes.has(link)) linkProbes.set(link, route);
    }
  }
  console.log(
    `smoke [2/3]: internal-link probes (${linkProbes.size} unique targets)...`
  );
  for (const [link, fromRoute] of linkProbes) {
    await probeInternalLink(link, fromRoute);
  }

  // 3. API endpoints
  console.log(`smoke [3/3]: API endpoints (${API_CALLS.length} calls)...`);
  for (const call of API_CALLS) {
    await probeApi(call);
  }

  // 4. MCP Streamable HTTP endpoint — the Agentforce 3.0 Registry's
  //    intake surface. POST initialize and assert the SSE response
  //    contains serverInfo for pause-health-mcp.
  console.log(`smoke [4/4]: MCP Streamable HTTP (/api/mcp)...`);
  await probeMcpInitialize();

  results.finishedAt = new Date().toISOString();
  results.elapsedMs =
    new Date(results.finishedAt) - new Date(results.startedAt);

  const md = buildReport(results);
  writeFileSync(REPORT_PATH, md, "utf-8");

  console.log("\n=== summary ===");
  console.log(`pass: ${results.pass}`);
  console.log(`warn: ${results.warn}`);
  console.log(`fail: ${results.fail}`);
  console.log(`report: ${REPORT_PATH}`);

  if (results.fail > 0) {
    console.error(
      "\nsmoke: FAILED. See SMOKE_TEST_RESULTS.md for the breakdown."
    );
    process.exit(1);
  }
  console.log("\nsmoke: PASS");
}

function buildReport(r) {
  const lines = [];
  lines.push("# Smoke test results");
  lines.push("");
  lines.push(
    `Last run: ${r.startedAt} → ${r.finishedAt} (${Math.round(
      r.elapsedMs / 1000
    )}s elapsed)`
  );
  lines.push("");
  lines.push(`Target: \`${r.base}\``);
  lines.push("");
  lines.push(
    "Run via `node frontend/scripts/smoke-test.mjs` against a local dev " +
      "server, or set `BASE_URL=https://pause-health.ai` to smoke production. " +
      "Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs)."
  );
  lines.push("");
  lines.push(
    `**Summary:** ${r.pass} pass · ${r.warn} warn · ${r.fail} fail`
  );
  lines.push("");

  const section = (title, rows, columns) => {
    lines.push(`## ${title}`);
    lines.push("");
    lines.push("| " + columns.join(" | ") + " |");
    lines.push("|" + columns.map(() => "---").join("|") + "|");
    for (const row of rows) {
      lines.push(
        "| " +
          columns
            .map((c) => {
              const v = row[c];
              if (v == null) return "";
              return String(v).replace(/\|/g, "\\|");
            })
            .join(" | ") +
          " |"
      );
    }
    lines.push("");
  };

  const staticRows = r.static.map((e) => ({
    "✓/✗": e.outcome === "pass" ? "✓" : "✗",
    Route: e.label,
    Status: e.status,
    "Bytes": e.bytes,
    "ms": e.ms,
    Notes: e.note
  }));
  section("Static pages", staticRows, [
    "✓/✗",
    "Route",
    "Status",
    "Bytes",
    "ms",
    "Notes"
  ]);

  // Internal link breakdown -- collapse passes to a count line, show
  // failures explicitly
  const linkFailures = r.internalLinks.filter((e) => e.outcome !== "pass");
  const linkPasses = r.internalLinks.filter((e) => e.outcome === "pass");
  lines.push("## Internal links");
  lines.push("");
  lines.push(
    `${linkPasses.length} link(s) resolve (200/OK); ${linkFailures.length} ` +
      `broken or unexpected.`
  );
  lines.push("");
  if (linkFailures.length) {
    section("Broken internal links", linkFailures, [
      "label",
      "status",
      "note"
    ]);
  }

  const apiRows = r.api.map((e) => ({
    "✓/✗":
      e.outcome === "pass" ? "✓" : e.outcome === "warn" ? "⚠" : "✗",
    Endpoint: e.label,
    Status: e.status,
    "Bytes": e.bytes,
    "ms": e.ms,
    Shape: e.shape || "",
    Notes: e.note
  }));
  section("API endpoints", apiRows, [
    "✓/✗",
    "Endpoint",
    "Status",
    "Bytes",
    "ms",
    "Shape",
    "Notes"
  ]);

  const mcpRows = (r.mcp ?? []).map((e) => ({
    "✓/✗": e.outcome === "pass" ? "✓" : e.outcome === "warn" ? "⚠" : "✗",
    Probe: e.label,
    Status: e.status,
    Bytes: e.bytes,
    ms: e.ms,
    Notes: e.note
  }));
  if (mcpRows.length) {
    section("MCP Streamable HTTP", mcpRows, [
      "✓/✗",
      "Probe",
      "Status",
      "Bytes",
      "ms",
      "Notes"
    ]);
  }

  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error("smoke: fatal", err);
  process.exit(2);
});
