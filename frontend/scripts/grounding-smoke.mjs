#!/usr/bin/env node
/**
 * Real-grounding smoke test.
 *
 * Exercises the same SOQL queries as lib/salesforce/grounding.ts against
 * the seeded Pause Demo cohort. Picks one persona at random, prints the
 * grounding context that would be returned, and exits 0 on success.
 *
 * Usage:  node scripts/grounding-smoke.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, "..", ".env.local");

function loadEnv(path) {
  let text; try { text = readFileSync(path, "utf8"); } catch { return {}; }
  const out = {};
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("="); if (eq === -1) continue;
    out[l.slice(0, eq).trim()] = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = { ...loadEnv(ENV_PATH), ...process.env };
const instanceUrl = env.SF_INSTANCE_URL?.replace(/\/+$/, "");
const apiVersion = env.SF_API_VERSION || "60.0";

async function token() {
  const res = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SF_CLIENT_ID, client_secret: env.SF_CLIENT_SECRET }).toString()
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function soql(t, q) {
  const r = await fetch(`${instanceUrl}/services/data/v${apiVersion}/query/?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${t}` }
  });
  if (!r.ok) throw new Error(`SOQL ${r.status}: ${(await r.text()).slice(0, 300)}\nQuery: ${q}`);
  return (await r.json()).records || [];
}

async function main() {
  console.log("Pause-Health real-grounding smoke test\n");
  const t = await token();
  console.log("OK   authenticated");

  // Match BOTH the new schema (Title = 'Pause Demo Patient') and the
  // legacy schema (LastName LIKE prefix) so the script keeps working
  // during a partial migration. lib/salesforce/grounding.ts applies the
  // same OR predicate in production.
  const contacts = await soql(t,
    "SELECT Id, FirstName, LastName, Description, AccountId FROM Contact " +
      "WHERE Title = 'Pause Demo Patient' OR Department = 'Pause Demo' " +
      "OR LastName LIKE 'Pause Demo Patient:%'"
  );
  if (contacts.length === 0) {
    console.error("FAIL: no seeded Pause Demo contacts found. Run scripts/salesforce-seed.mjs first.");
    process.exit(1);
  }
  console.log(`OK   ${contacts.length} seeded Contacts found`);

  // Pick the persona with severe vasomotor (Deepa) to exercise interesting routing
  const target = contacts.find(c => c.FirstName === "Deepa") || contacts[0];
  console.log(`INFO target persona: ${target.FirstName} ${target.LastName} (${target.Id})\n`);

  // Run all four grounding queries in parallel just like the production code does.
  const [enrollee, carePlan, latestCase, programCount] = await Promise.all([
    soql(t, `SELECT Id, Name, Status, CreatedDate, CareProgramId, AccountId FROM CareProgramEnrollee WHERE AccountId = '${target.AccountId}' AND Status = 'Active' ORDER BY CreatedDate DESC LIMIT 1`),
    soql(t, `SELECT Id, Name, Status, StartDate, Description, ParticipantId FROM CarePlan WHERE ParticipantId = '${target.Id}' AND Status = 'Active' ORDER BY StartDate DESC LIMIT 1`),
    soql(t, `SELECT Id, Subject, Status, LastModifiedDate, ContactId FROM Case WHERE ContactId = '${target.Id}' ORDER BY LastModifiedDate DESC LIMIT 1`),
    soql(t, `SELECT Id FROM CareProgramEnrollee WHERE CareProgramId IN (SELECT Id FROM CareProgram WHERE Name = 'Pause Demo: Menopause Care Program')`)
  ]);

  console.log("Grounding data assembled from real org:");
  console.log("  Enrollee:       ", enrollee[0]?.Id, "status=", enrollee[0]?.Status, "program=", enrollee[0]?.CareProgramId);
  console.log("  CarePlan:       ", carePlan[0]?.Id, "status=", carePlan[0]?.Status);
  console.log("  Latest Case:    ", latestCase[0]?.Id, "lastMod=", latestCase[0]?.LastModifiedDate);
  console.log("  Cohort size:    ", programCount.length, "enrollees in Pause Demo program");
  console.log("");
  console.log("Description blob (parsed by grounding.ts for hints):");
  console.log(target.Description);
  console.log("");
  console.log("All queries passed. grounding.ts ready for API route integration.");
}

main().catch(e => { console.error("FAIL:", e.message || e); process.exit(1); });
