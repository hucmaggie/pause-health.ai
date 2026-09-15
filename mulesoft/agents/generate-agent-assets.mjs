#!/usr/bin/env node
/**
 * generate-agent-assets.mjs
 * -------------------------------------------------------------------------
 * Prepares one Anypoint Exchange "Agents" asset per Pause fabric agent, so
 * that Anypoint Agent Visualizer (which reads Exchange agent assets alongside
 * Monitoring + API Manager) can discover the Pause agent network.
 *
 * SOURCE OF TRUTH: mulesoft/agents/agents-snapshot.json — a deterministic,
 * offline snapshot of the live fabric registry (frontend/lib/agent-fabric.ts
 * listAgents()). Regenerate the snapshot with the vitest one-shot documented
 * in mulesoft/agents/README.md whenever the registry changes.
 *
 * For each of the 110 agents this writes an asset folder under
 *   mulesoft/agents/assets/<id>/
 * containing:
 *   - <id>-agent.json  : a canonical A2A v0.3 Agent Card (the payload Exchange
 *                        ingests for the "Agents" asset type, classifier
 *                        `a2a-card`). Registry-derived, so it can never
 *                        overclaim vs. what the fabric actually enforces. This
 *                        is the ONLY file uploaded — agent assets are published
 *                        via the Exchange Experience API (type=agent), not the
 *                        Maven jar path, so there is no pom.
 *   - README.md        : what this asset is, its PHI posture, provenance.
 *
 * This script performs NO network calls. It only reads the snapshot and writes
 * files. Publishing is a separate, dry-run-gated step (publish-agent-assets.sh).
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = __dirname;
const SNAPSHOT = resolve(AGENTS_DIR, "agents-snapshot.json");
const ASSETS_DIR = resolve(AGENTS_DIR, "assets");

// Pause Health business group — the Exchange org/group the 9 existing spec
// assets already live under. See docs/MULESOFT_RUNBOOK.md.
const GROUP_ID = "56707cc3-a0e3-4318-b110-78126aace370";
const ASSET_VERSION = "1.0.0";
const SITE = "https://pause-health.ai";

function die(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(SNAPSHOT)) {
  die(
    `snapshot not found: ${SNAPSHOT}\n` +
      `Regenerate it (see mulesoft/agents/README.md) before running the generator.`
  );
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const agents = snapshot.agents ?? [];
if (!Array.isArray(agents) || agents.length === 0) {
  die("snapshot has no agents[]");
}

/**
 * Map a fabric agent's endpoint to an absolute A2A URL. Registry endpoints are
 * either an absolute route ("/api/agents/<id>") or a scheme://... locator
 * (e.g. "salesforce://agentforce/..."). Agent cards need an absolute URL, so
 * relative routes are prefixed with the public site origin; opaque locators are
 * passed through unchanged (they are already fully qualified).
 */
function toAbsoluteUrl(endpoint) {
  if (/^https?:\/\//.test(endpoint)) return endpoint;
  if (endpoint.startsWith("/")) return `${SITE}${endpoint}`;
  return endpoint; // scheme://... opaque agent locator
}

/**
 * Turn a fabric capability string into a stable A2A skill id: lowercased,
 * non-alphanumerics collapsed to single dashes, trimmed. Deterministic so
 * re-runs produce identical cards (Exchange tombstones versions — see README).
 */
function skillId(capability, index) {
  const base = capability
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base ? `${base}` : `skill-${index + 1}`;
}

/**
 * Build a canonical A2A v0.3 Agent Card from a registry record. Uniform across
 * all 110 agents (no live-vs-synthesized split): the fields are exactly what
 * the registry authoritatively knows, so the published discovery document
 * matches what the fabric enforces. `pauseGovernance` mirrors the extension the
 * live .well-known/agent.json routes already advertise.
 */
function buildAgentCard(agent) {
  const url = toAbsoluteUrl(agent.endpoint);
  const skills = (agent.capabilities ?? []).map((cap, i) => ({
    id: skillId(cap, i),
    name: cap.length > 60 ? `${cap.slice(0, 57)}...` : cap,
    description: cap,
    inputModes: ["data"],
    outputModes: ["data"],
    tags: [agent.governanceTier]
  }));

  return {
    name: agent.name,
    description:
      `${agent.name} — a governed Pause fabric agent (${agent.kind}, ${agent.protocol.toUpperCase()}). ` +
      `Governance tier: ${agent.governanceTier}. Enforces ${agent.policies.length} ` +
      `Pause Agent Fabric ${agent.policies.length === 1 ? "policy" : "policies"}. ` +
      `Prototype agent card — synthetic data, no real PHI.`,
    url,
    provider: {
      organization: agent.provider || "Pause-Health.ai",
      url: SITE
    },
    version: agent.version || "0.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true
    },
    defaultInputModes: ["text", "data"],
    defaultOutputModes: ["text", "data"],
    skills:
      skills.length > 0
        ? skills
        : [
            {
              id: "primary",
              name: agent.name,
              description: agent.name,
              inputModes: ["data"],
              outputModes: ["data"],
              tags: [agent.governanceTier]
            }
          ],
    // Pause-specific extension carried on every live .well-known card too.
    pauseGovernance: {
      fabricRegisteredAs: agent.id,
      kind: agent.kind,
      governanceTier: agent.governanceTier,
      status: agent.status,
      policies: agent.policies
    }
  };
}

function assetReadme(agent, artifactId) {
  const phi = agent.governanceTier === "clinical-decision" ||
    agent.policies.some((p) => p.includes("hipaa") || p.includes("consent"))
    ? "PHI-adjacent (HIPAA-audit / consent policies apply)"
    : "non-PHI";
  return `# ${agent.name}

Anypoint Exchange **Agents** asset (A2A v0.3 card, classifier \`a2a-card\`),
published via the Exchange Experience API (\`type=agent\`).

- **Fabric agent id:** \`${agent.id}\`
- **Asset:** \`${artifactId}\` \`${ASSET_VERSION}\` (groupId \`${GROUP_ID}\`)
- **Kind / protocol:** ${agent.kind} / ${agent.protocol.toUpperCase()}
- **Governance tier:** ${agent.governanceTier}
- **Posture:** ${phi}
- **Policies enforced (${agent.policies.length}):** ${agent.policies.join(", ") || "—"}

> Prototype agent card. Data is synthetic; no real PHI. The card is derived from
> the Pause Agent Fabric registry (\`frontend/lib/agent-fabric.ts\`), so it cannot
> overclaim relative to what the fabric actually enforces. Published solely so
> Anypoint Agent Visualizer can discover the Pause agent network.
`;
}

// -------------------------------------------------------------------------

// Fresh assets dir each run (deterministic; safe because it's fully generated).
if (existsSync(ASSETS_DIR)) rmSync(ASSETS_DIR, { recursive: true, force: true });
mkdirSync(ASSETS_DIR, { recursive: true });

const manifest = [];
let cardFieldErrors = 0;

for (const agent of agents) {
  if (!agent.id) die(`agent with no id: ${JSON.stringify(agent).slice(0, 120)}`);
  const artifactId = `pause-agent-${agent.id}`;
  const assetDir = resolve(ASSETS_DIR, agent.id);
  const resDir = resolve(assetDir, "src/main/resources");
  mkdirSync(resDir, { recursive: true });

  const card = buildAgentCard(agent);

  // Self-check: the card must satisfy the A2A v0.3 required fields.
  for (const req of ["name", "description", "url", "version"]) {
    if (!card[req] || typeof card[req] !== "string") {
      console.error(`  card field missing/invalid: ${agent.id}.${req}`);
      cardFieldErrors += 1;
    }
  }

  const cardPath = resolve(resDir, `${agent.id}-agent.json`);
  const readmePath = resolve(assetDir, "README.md");

  writeFileSync(cardPath, JSON.stringify(card, null, 2) + "\n");
  writeFileSync(readmePath, assetReadme(agent, artifactId));

  manifest.push({
    id: agent.id,
    artifactId,
    version: ASSET_VERSION,
    groupId: GROUP_ID,
    type: "agent",
    protocol: "a2a",
    classifier: "a2a-card",
    cardPath: cardPath.replace(resolve(AGENTS_DIR, "..", "..") + "/", ""),
    governanceTier: agent.governanceTier,
    policyCount: agent.policies.length
  });
}

if (cardFieldErrors > 0) {
  die(`${cardFieldErrors} agent card(s) failed required-field validation`);
}

const manifestPath = resolve(ASSETS_DIR, "..", "assets-manifest.json");
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      groupId: GROUP_ID,
      assetVersion: ASSET_VERSION,
      assetType: "agent",
      protocol: "a2a",
      classifier: "a2a-card",
      count: manifest.length,
      assets: manifest
    },
    null,
    2
  ) + "\n"
);

console.log(`Generated ${manifest.length} Exchange agent assets under mulesoft/agents/assets/`);
console.log(`Manifest: mulesoft/agents/assets-manifest.json`);
console.log(`Every card passed A2A v0.3 required-field validation (name, description, url, version).`);
