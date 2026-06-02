#!/usr/bin/env node
/**
 * Salesforce smoke test for Pause-Health.ai
 *
 * Exercises the OAuth 2.0 Client Credentials Flow against the real org
 * configured in .env.local (or process env), then runs one trivial SOQL
 * query to prove end-to-end connectivity.
 *
 * Usage (from frontend/):
 *   node scripts/salesforce-smoke.mjs
 *
 * Exits 0 on success, 1 on any failure with a clear human-readable reason.
 *
 * This script intentionally does NOT import frontend/lib/salesforce/auth.ts
 * — that module is TypeScript and getting tsx / ts-node in the loop adds
 * dependency surface area for a one-screen script. The OAuth flow it
 * exercises is small enough to duplicate cleanly here. If the smoke
 * passes, the production auth helper (same shape, same endpoint, same
 * grant type) is also expected to work.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, "..", ".env.local");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m"
};

function fail(msg, detail) {
  console.error(`${COLORS.red}${COLORS.bold}FAIL:${COLORS.reset} ${msg}`);
  if (detail) console.error(`${COLORS.gray}${detail}${COLORS.reset}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`${COLORS.green}OK${COLORS.reset}    ${msg}`);
}

function info(msg) {
  console.log(`${COLORS.blue}INFO${COLORS.reset}  ${msg}`);
}

function warn(msg) {
  console.log(`${COLORS.yellow}WARN${COLORS.reset}  ${msg}`);
}

function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function maskSecret(s) {
  if (!s) return "(empty)";
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

async function main() {
  console.log(`${COLORS.bold}Pause-Health Salesforce smoke test${COLORS.reset}\n`);

  const fileEnv = loadEnvFile(ENV_PATH);
  const env = { ...fileEnv, ...process.env };

  const instanceUrl = (env.SF_INSTANCE_URL || "").trim().replace(/\/+$/, "");
  const clientId = (env.SF_CLIENT_ID || "").trim();
  const clientSecret = (env.SF_CLIENT_SECRET || "").trim();
  const apiVersion = (env.SF_API_VERSION || "60.0").trim();

  if (!instanceUrl) fail("SF_INSTANCE_URL is not set", `Looked in ${ENV_PATH} and process.env.`);
  if (!clientId) fail("SF_CLIENT_ID is not set");
  if (!clientSecret) fail("SF_CLIENT_SECRET is not set");
  if (clientId.includes("PASTE_CONSUMER_KEY_HERE")) {
    fail("SF_CLIENT_ID still has the placeholder value", "Open frontend/.env.local and replace PASTE_CONSUMER_KEY_HERE with your real Consumer Key.");
  }
  if (clientSecret.includes("PASTE_CONSUMER_SECRET_HERE")) {
    fail("SF_CLIENT_SECRET still has the placeholder value", "Open frontend/.env.local and replace PASTE_CONSUMER_SECRET_HERE with your real Consumer Secret.");
  }
  if (!clientId.startsWith("3MVG")) {
    warn(`SF_CLIENT_ID does not start with the expected '3MVG' prefix. Got: ${maskSecret(clientId)}. This is unusual but may be valid for newer orgs. Continuing.`);
  }

  ok(`Env vars present`);
  info(`Instance URL:   ${instanceUrl}`);
  info(`Client ID:      ${maskSecret(clientId)}`);
  info(`Client Secret:  ${maskSecret(clientSecret)}`);
  info(`API Version:    ${apiVersion}`);
  console.log("");

  // Step 1: OAuth token request
  const tokenUrl = `${instanceUrl}/services/oauth2/token`;
  info(`POST ${tokenUrl}`);
  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  let tokenRes;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: tokenBody.toString()
    });
  } catch (err) {
    fail(`Network error reaching token endpoint: ${err?.message || err}`);
  }

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    let parsed = null;
    try { parsed = JSON.parse(tokenText); } catch { /* not JSON */ }
    const sfError = parsed?.error || "(no error code)";
    const sfDescription = parsed?.error_description || "(no description)";
    const hint = (() => {
      if (sfError === "invalid_client_id" || sfError === "invalid_client") {
        return "Most common cause: Consumer Key is wrong, OR you didn't wait long enough after creating the app (Salesforce caches OAuth config for up to 10 min). Wait 5 more minutes and retry.";
      }
      if (sfError === "invalid_grant") {
        return "Common cause: Client Credentials Flow is enabled on the OAuth Settings card but the matching Policy (with Run-As user) is missing or the run-as user is not pre-authorized via permission set. Re-check Phase 1 Part 3 and Part 4.";
      }
      if (sfError === "unsupported_grant_type") {
        return "Common cause: 'Enable Client Credentials Flow' is unchecked on the OAuth Settings card. Re-check Phase 1 Part 2 step 5.";
      }
      return "See https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_client_credentials_flow.htm";
    })();
    fail(
      `Token request returned HTTP ${tokenRes.status} (${sfError}: ${sfDescription})`,
      hint + "\n\nRaw response: " + tokenText.slice(0, 400)
    );
  }

  let tokenJson;
  try {
    tokenJson = JSON.parse(tokenText);
  } catch {
    fail("Token endpoint returned non-JSON", tokenText.slice(0, 400));
  }

  const accessToken = tokenJson.access_token;
  const resolvedInstanceUrl = (tokenJson.instance_url || instanceUrl).replace(/\/+$/, "");
  const expiresIn = tokenJson.expires_in;
  const tokenType = tokenJson.token_type;

  if (!accessToken) {
    fail("Token response missing access_token", tokenText.slice(0, 400));
  }

  ok(`Access token acquired`);
  info(`Token type:     ${tokenType || "(unspecified)"}`);
  info(`Expires in:     ${expiresIn ? `${expiresIn}s (~${Math.round(expiresIn / 60)} min)` : "(unspecified)"}`);
  info(`Instance URL:   ${resolvedInstanceUrl} (from token response)`);
  info(`Access token:   ${maskSecret(accessToken)}`);
  console.log("");

  // Step 2: Trivial SOQL query to prove the token works
  const soql = "SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 1";
  const queryUrl = `${resolvedInstanceUrl}/services/data/v${apiVersion}/query/?q=${encodeURIComponent(soql)}`;
  info(`GET  ${queryUrl}`);

  let queryRes;
  try {
    queryRes = await fetch(queryUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
  } catch (err) {
    fail(`Network error reaching query endpoint: ${err?.message || err}`);
  }

  const queryText = await queryRes.text();
  if (!queryRes.ok) {
    fail(
      `Query returned HTTP ${queryRes.status}`,
      queryText.slice(0, 400)
    );
  }

  let queryJson;
  try {
    queryJson = JSON.parse(queryText);
  } catch {
    fail("Query endpoint returned non-JSON", queryText.slice(0, 400));
  }

  ok(`SOQL query succeeded`);
  info(`Total records:  ${queryJson.totalSize}`);
  if (queryJson.records?.[0]) {
    info(`Sample record:  ${queryJson.records[0].Name || "(no Name)"} (${queryJson.records[0].Id})`);
  }

  console.log("");
  console.log(`${COLORS.green}${COLORS.bold}All checks passed.${COLORS.reset} Salesforce auth + REST are working.`);
  console.log(`${COLORS.gray}Next: Phase 1D (seed menopause-specific Health Cloud records).${COLORS.reset}`);
}

main().catch((err) => {
  console.error(`${COLORS.red}${COLORS.bold}Unexpected error:${COLORS.reset} ${err?.stack || err}`);
  process.exit(1);
});
