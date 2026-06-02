#!/usr/bin/env node
/**
 * Salesforce seed/cleanup for Pause-Health.ai's menopause demo cohort
 *
 * Creates (idempotently) a small set of menopause-shaped Health Cloud
 * records in the configured Salesforce org so the Care Router has clean,
 * clinically-coherent records to ground on.
 *
 * Per patient persona, this seeder creates a 4-object chain:
 *
 *   Account ("Pause Demo Household: <Name>")
 *     └── Contact ("Pause Demo Patient: <Name>")    [RecordType: Individual]
 *           └── Case ("Pause Demo Intake: <Name>")  [RecordType: Care Management]
 *                 └── CarePlan ("Pause Demo CarePlan: <Name>")
 *
 * And once, shared across all personas:
 *
 *   CareProgram ("Pause Demo: Menopause Care Program")
 *     └── CareProgramEnrollee (one per Account)
 *
 * EVERY seeded record is tagged with the "Pause Demo" prefix in its Name
 * field so it can be found and bulk-deleted later. The cleanup mode runs
 * deletes in reverse dependency order.
 *
 * Usage (from frontend/):
 *   node scripts/salesforce-seed.mjs              # idempotent seed
 *   node scripts/salesforce-seed.mjs --cleanup    # delete every Pause Demo record
 *   node scripts/salesforce-seed.mjs --dry-run    # plan only, no writes
 *
 * Why not use sf data import tree?
 *   The dependency chain is small enough (~30 records) that explicit REST
 *   calls give us better error messages and idempotency without the
 *   ceremony of authoring + maintaining a tree JSON spec.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, "..", ".env.local");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", gray: "\x1b[90m", cyan: "\x1b[36m"
};
const log = {
  ok: (m) => console.log(`${C.green}OK${C.reset}    ${m}`),
  info: (m) => console.log(`${C.blue}INFO${C.reset}  ${m}`),
  warn: (m) => console.log(`${C.yellow}WARN${C.reset}  ${m}`),
  step: (m) => console.log(`${C.cyan}${C.bold}\n=== ${m} ===${C.reset}`),
  dim: (m) => console.log(`${C.gray}      ${m}${C.reset}`),
  fail: (m, d) => { console.error(`${C.red}${C.bold}FAIL:${C.reset} ${m}`); if (d) console.error(`${C.gray}${d}${C.reset}`); process.exit(1); }
};

// ----- env loader (matches salesforce-smoke.mjs) -----
function loadEnvFile(path) {
  let text; try { text = readFileSync(path, "utf8"); } catch { return {}; }
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

// ----- Args -----
const args = process.argv.slice(2);
const MODE = args.includes("--cleanup") ? "cleanup" : "seed";
const DRY_RUN = args.includes("--dry-run");

// ----- Demo cohort: 6 menopause-shaped personas -----
// Mix of routing-decision profiles so the Care Router has visibly varied
// records to ground on:
//  - early perimenopause vs late perimenopause vs postmenopausal
//  - vasomotor-dominant vs sleep-dominant vs mood-dominant
//  - one with cardiometabolic risk that should escalate routing
const COHORT = [
  {
    firstName: "Anika",  lastName: "Patel",   ageBand: "45-49",
    cycleStatus: "Perimenopausal",  primarySymptom: "Hot flashes",
    vasomotorScore: 7, sleepScore: 4, moodScore: 3,
    notes: "Daily vasomotor symptoms x 8 months. No cardiometabolic flags. MSCP virtual visit candidate."
  },
  {
    firstName: "Brianna", lastName: "Okafor", ageBand: "50-54",
    cycleStatus: "Perimenopausal",  primarySymptom: "Sleep disruption",
    vasomotorScore: 5, sleepScore: 8, moodScore: 5,
    notes: "Night sweats + insomnia. HRT discussion appropriate. Virtual visit candidate."
  },
  {
    firstName: "Carmen",  lastName: "Diaz",    ageBand: "55-59",
    cycleStatus: "Postmenopausal", primarySymptom: "Vaginal dryness",
    vasomotorScore: 2, sleepScore: 3, moodScore: 2,
    notes: "Postmenopausal x 3 years. GSM-predominant. Local therapy options pathway."
  },
  {
    firstName: "Deepa",   lastName: "Krishnan", ageBand: "48-52",
    cycleStatus: "Perimenopausal", primarySymptom: "Hot flashes",
    vasomotorScore: 9, sleepScore: 7, moodScore: 4,
    notes: "Severe vasomotor + family history of CVD + BMI 31. Escalation: in-person MSCP recommended."
  },
  {
    firstName: "Elena",   lastName: "Rossi",   ageBand: "46-50",
    cycleStatus: "Perimenopausal", primarySymptom: "Mood changes",
    vasomotorScore: 3, sleepScore: 5, moodScore: 8,
    notes: "Mood-predominant presentation. Behavioral health co-management recommended."
  },
  {
    firstName: "Fatima",  lastName: "Khan",    ageBand: "51-55",
    cycleStatus: "Postmenopausal", primarySymptom: "Joint pain",
    vasomotorScore: 4, sleepScore: 4, moodScore: 4,
    notes: "Musculoskeletal-predominant. PT referral + lifestyle pathway."
  }
];

const PROGRAM_NAME = "Pause Demo: Menopause Care Program";
const PROGRAM_DESC = "Menopause-specific care program seeded by Pause-Health.ai prototype. Safe to delete via scripts/salesforce-seed.mjs --cleanup.";
const ACCOUNT_PREFIX = "Pause Demo Household: ";
const CONTACT_PREFIX = "Pause Demo Patient: ";
const CASE_PREFIX = "Pause Demo Intake: ";
const CAREPLAN_PREFIX = "Pause Demo CarePlan: ";

const CONTACT_RECORDTYPE_DEVNAME = "IndustriesIndividual";
const CASE_RECORDTYPE_DEVNAME = "HLS_Payer_CareManagement";

// ----- Auth + REST helpers -----
async function getToken(env) {
  const instanceUrl = (env.SF_INSTANCE_URL || "").trim().replace(/\/+$/, "");
  const clientId = (env.SF_CLIENT_ID || "").trim();
  const clientSecret = (env.SF_CLIENT_SECRET || "").trim();
  if (!instanceUrl || !clientId || !clientSecret) {
    log.fail("Salesforce env vars not set", "Run scripts/salesforce-smoke.mjs first to verify your .env.local.");
  }
  const res = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString()
  });
  const text = await res.text();
  if (!res.ok) log.fail(`OAuth failed (HTTP ${res.status})`, text.slice(0, 400));
  const j = JSON.parse(text);
  return {
    accessToken: j.access_token,
    instanceUrl: (j.instance_url || instanceUrl).replace(/\/+$/, ""),
    apiVersion: (env.SF_API_VERSION || "60.0").trim()
  };
}

function api(ctx, path) { return `${ctx.instanceUrl}/services/data/v${ctx.apiVersion}${path}`; }

async function sfFetch(ctx, method, path, body) {
  const res = await fetch(api(ctx, path), {
    method,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 600);
    try { detail = JSON.stringify(JSON.parse(text), null, 2).slice(0, 800); } catch { /* leave raw */ }
    throw new Error(`${method} ${path} -> HTTP ${res.status}\n${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

async function soql(ctx, q) {
  const res = await sfFetch(ctx, "GET", `/query/?q=${encodeURIComponent(q)}`);
  return res.records || [];
}

async function getRecordTypeId(ctx, sobject, developerName) {
  const rows = await soql(ctx,
    `SELECT Id FROM RecordType WHERE SobjectType='${sobject}' AND DeveloperName='${developerName}' AND IsActive=true LIMIT 1`
  );
  return rows[0]?.Id || null;
}

// Find a record by exact Name. Returns Id or null.
async function findByName(ctx, sobject, name) {
  const safe = name.replace(/'/g, "\\'");
  const rows = await soql(ctx, `SELECT Id FROM ${sobject} WHERE Name='${safe}' LIMIT 1`);
  return rows[0]?.Id || null;
}

async function createOrFind(ctx, sobject, name, payload) {
  const existing = await findByName(ctx, sobject, name);
  if (existing) {
    log.dim(`reused existing ${sobject} ${existing}`);
    return { id: existing, created: false };
  }
  if (DRY_RUN) {
    log.dim(`[dry-run] would create ${sobject} "${name}"`);
    return { id: `DRY_RUN_${sobject}`, created: false };
  }
  const res = await sfFetch(ctx, "POST", `/sobjects/${sobject}`, payload);
  if (!res?.id) throw new Error(`Create ${sobject} returned no id: ${JSON.stringify(res)}`);
  log.dim(`created ${sobject} ${res.id}`);
  return { id: res.id, created: true };
}

// ----- SEED -----
async function seed(ctx) {
  log.step("Resolving RecordType IDs");
  const contactRTId = await getRecordTypeId(ctx, "Contact", CONTACT_RECORDTYPE_DEVNAME);
  const caseRTId = await getRecordTypeId(ctx, "Case", CASE_RECORDTYPE_DEVNAME);
  if (!contactRTId) log.fail(`Contact RecordType '${CONTACT_RECORDTYPE_DEVNAME}' not found`);
  if (!caseRTId) log.fail(`Case RecordType '${CASE_RECORDTYPE_DEVNAME}' not found`);
  log.ok(`Contact RT: ${contactRTId}`);
  log.ok(`Case RT:    ${caseRTId}`);

  log.step("CareProgram (shared by all personas)");
  const program = await createOrFind(ctx, "CareProgram", PROGRAM_NAME, {
    Name: PROGRAM_NAME,
    Status: "In Progress",
    Category: "PatientServices",
    StartDate: "2026-01-01",
    Description: PROGRAM_DESC
  });

  const summary = [];

  for (const p of COHORT) {
    const fullName = `${p.firstName} ${p.lastName}`;
    log.step(`Persona: ${fullName} (${p.ageBand}, ${p.cycleStatus}, ${p.primarySymptom})`);

    const account = await createOrFind(ctx, "Account", `${ACCOUNT_PREFIX}${fullName}`, {
      Name: `${ACCOUNT_PREFIX}${fullName}`,
      Description: `${p.notes}\n\n[Pause Demo seed — safe to delete]`
    });

    const contact = await createOrFind(ctx, "Contact", `${CONTACT_PREFIX}${fullName}`, {
      LastName: `${CONTACT_PREFIX}${fullName}`,
      FirstName: p.firstName,
      AccountId: account.id,
      RecordTypeId: contactRTId,
      Description: [
        `Pause demo patient: ${fullName}`,
        `Age band: ${p.ageBand}`,
        `Cycle status: ${p.cycleStatus}`,
        `Primary symptom: ${p.primarySymptom}`,
        `Vasomotor: ${p.vasomotorScore}/10  Sleep: ${p.sleepScore}/10  Mood: ${p.moodScore}/10`,
        ``,
        p.notes
      ].join("\n")
    });

    const enrolleeName = `Pause Demo Enrollee: ${fullName}`;
    // EnrolleeType / BenefitCoverageType were intentionally removed: the
    // describe output advertises them but org-specific permissions can
    // make them invalid for create. The Care Router demo only needs the
    // enrollee Id + AccountId + CareProgramId linkage to function, so we
    // keep the payload minimal.
    const enrollee = await createOrFind(ctx, "CareProgramEnrollee", enrolleeName, {
      Name: enrolleeName,
      CareProgramId: program.id,
      AccountId: account.id,
      Status: "Active"
    });

    const caseName = `${CASE_PREFIX}${fullName}`;
    // Cases don't have a 'Name' field — they have CaseNumber (auto) + Subject.
    // We use Subject as our identifier and key our idempotency off Subject.
    const existingCase = await soql(ctx,
      `SELECT Id FROM Case WHERE Subject='${caseName.replace(/'/g, "\\'")}' LIMIT 1`
    );
    let caseId;
    if (existingCase[0]) {
      caseId = existingCase[0].Id;
      log.dim(`reused existing Case ${caseId}`);
    } else if (DRY_RUN) {
      caseId = "DRY_RUN_Case";
      log.dim(`[dry-run] would create Case "${caseName}"`);
    } else {
      const res = await sfFetch(ctx, "POST", "/sobjects/Case", {
        Subject: caseName,
        Status: "Intake",
        Origin: "Web",
        RecordTypeId: caseRTId,
        AccountId: account.id,
        ContactId: contact.id,
        Description: `Pause Demo intake encounter for ${fullName}. Safe to delete.`
      });
      caseId = res.id;
      log.dim(`created Case ${caseId}`);
    }

    const carePlanName = `${CAREPLAN_PREFIX}${fullName}`;
    const carePlan = await createOrFind(ctx, "CarePlan", carePlanName, {
      Name: carePlanName,
      Status: "Active",
      CaseId: caseId,
      ParticipantId: contact.id,
      StartDate: "2026-06-01T00:00:00Z",
      Description: `Menopause care plan for ${fullName}. ${p.notes}`
    });

    summary.push({ name: fullName, accountId: account.id, contactId: contact.id, enrolleeId: enrollee.id, caseId, carePlanId: carePlan.id });
  }

  log.step("Seed complete");
  console.table(summary);
  log.info(`CareProgram Id: ${program.id}`);
  log.info(`Cohort size:    ${summary.length} patients`);
  if (DRY_RUN) log.warn("Dry run — no records were actually written.");
}

// ----- CLEANUP -----
async function cleanup(ctx) {
  log.step("Cleanup: finding all Pause Demo records");

  const tables = [
    // delete order matters: children before parents
    { sobject: "CarePlan", where: `Name LIKE '${CAREPLAN_PREFIX}%'`, label: "CarePlans" },
    { sobject: "Case", where: `Subject LIKE '${CASE_PREFIX}%'`, label: "Cases" },
    { sobject: "CareProgramEnrollee", where: `Name LIKE 'Pause Demo Enrollee:%'`, label: "Enrollees" },
    { sobject: "CareProgram", where: `Name = '${PROGRAM_NAME}'`, label: "CareProgram" },
    { sobject: "Contact", where: `LastName LIKE '${CONTACT_PREFIX}%'`, label: "Contacts" },
    { sobject: "Account", where: `Name LIKE '${ACCOUNT_PREFIX}%'`, label: "Accounts" }
  ];

  let totalDeleted = 0;
  for (const t of tables) {
    const rows = await soql(ctx, `SELECT Id FROM ${t.sobject} WHERE ${t.where}`);
    log.info(`${t.label}: ${rows.length} record(s) to delete`);
    if (rows.length === 0) continue;
    if (DRY_RUN) {
      rows.forEach(r => log.dim(`[dry-run] would delete ${t.sobject} ${r.Id}`));
      continue;
    }
    for (const r of rows) {
      try {
        await sfFetch(ctx, "DELETE", `/sobjects/${t.sobject}/${r.Id}`);
        log.dim(`deleted ${t.sobject} ${r.Id}`);
        totalDeleted++;
      } catch (err) {
        log.warn(`failed to delete ${t.sobject} ${r.Id}: ${err.message.split('\n')[0]}`);
      }
    }
  }

  log.step(`Cleanup complete — ${totalDeleted} records deleted`);
}

// ----- Main -----
async function main() {
  console.log(`${C.bold}Pause-Health Salesforce seed${C.reset}  mode=${MODE}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
  const env = { ...loadEnvFile(ENV_PATH), ...process.env };
  const ctx = await getToken(env);
  log.ok(`Authenticated. Instance: ${ctx.instanceUrl}`);
  if (MODE === "cleanup") {
    await cleanup(ctx);
  } else {
    await seed(ctx);
  }
}

main().catch((err) => {
  console.error(`${C.red}${C.bold}Unexpected error:${C.reset}\n${err?.stack || err}`);
  process.exit(1);
});
