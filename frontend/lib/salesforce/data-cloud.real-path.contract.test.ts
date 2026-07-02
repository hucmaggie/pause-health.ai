import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Real-data ingestion contract guard.
 *
 * The activated Calculated Insights are still the MAX(constant) mocks; the
 * real-data flip (the maintainer's Ingestion-API step in
 * docs/PHASE_2_INGESTION_API_RUNBOOK.md) swaps them for the three committed
 * per-CI SQL files, which aggregate the Pause_Wearable_Feature__dlm DMO that
 * pause_ingest pushes into. Four artifacts have to agree on column names /
 * observation-type literals / the aggregate output shape or the flip silently
 * returns empty (or wrong) rows and grounding degrades back to the baseline
 * with no error — the exact ssot__Id__c-vs-unified_id__c class of drift that
 * already bit the mock path:
 *
 *   1. data-cloud/Pause_Wearable_Feature.dlo-schema.json  — the ingested fields
 *      (become <field>__c columns on the DMO) + the observation_type enum.
 *   2. pause_ingest (cohort.py) — the pushed rows. Its grain (30 HRV rows to
 *      AVG, 7 sleep nights, N vasomotor events to SUM) and field names are
 *      pinned Python-side in pause_ingest/tests/test_cohort.py; the field names
 *      are the DLO schema's, asserted below.
 *   3. data-cloud/Pause_*.sql — the real CIs: which DMO columns they read,
 *      which observation_type values they filter, and the columns they emit.
 *   4. frontend/lib/salesforce/data-cloud.ts — which output columns
 *      getWearableInsights actually reads, and the __cio CI names it queries.
 *
 * This test reads the committed files directly (no Python runtime needed) and
 * asserts 1⇄3, 3-internal, and 3⇄4 all line up, so a rename in any one artifact
 * fails here instead of at the maintainer's activation step.
 */

function readRepoFile(relFromRepoRoot: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../${relFromRepoRoot}`, import.meta.url)),
    "utf8"
  );
}

const dloSchema = JSON.parse(
  readRepoFile("data-cloud/Pause_Wearable_Feature.dlo-schema.json")
) as {
  components: {
    schemas: {
      wearable_feature: {
        properties: Record<string, unknown>;
        properties_observation_type?: unknown;
      };
    };
  };
};

const wearableFeature = dloSchema.components.schemas.wearable_feature as {
  properties: Record<string, { enum?: string[] }>;
};
const DLO_FIELDS = new Set(Object.keys(wearableFeature.properties));
const OBSERVATION_ENUM = new Set(
  wearableFeature.properties.observation_type.enum ?? []
);

const dataCloudTs = readFileSync(
  fileURLToPath(new URL("./data-cloud.ts", import.meta.url)),
  "utf8"
);

/** The four-artifact contract, per Calculated Insight. */
const CIS = [
  {
    label: "HRV RMSSD 30d",
    file: "data-cloud/Pause_HRV_RMSSD_30d.sql",
    devName: "Pause_HRV_RMSSD_30d",
    outputs: ["unified_id__c", "hrv_rmssd_ms__c", "z_score__c", "window_days__c"],
    frontendReads: ["hrv_rmssd_ms__c", "z_score__c"],
    observationTypes: ["hrv_rmssd"]
  },
  {
    label: "Vasomotor burden 30d",
    file: "data-cloud/Pause_Vasomotor_Burden_30d.sql",
    devName: "Pause_Vasomotor_Burden_30d",
    outputs: ["unified_id__c", "burden_score_0_100__c", "flash_count_30d__c"],
    frontendReads: ["burden_score_0_100__c", "flash_count_30d__c"],
    observationTypes: ["hot_flash", "night_sweat"]
  },
  {
    label: "Sleep disruption 7d",
    file: "data-cloud/Pause_Sleep_Disruption_7d.sql",
    devName: "Pause_Sleep_Disruption_7d",
    outputs: ["unified_id__c", "disruption_index_0_1__c", "disrupted_nights__c"],
    frontendReads: ["disruption_index_0_1__c", "disrupted_nights__c"],
    observationTypes: ["sleep_session"]
  }
] as const;

/** Drop `-- …` line comments so prose apostrophes/columns don't leak in. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Table-qualified column reads: `Pause_Wearable_Feature__dlm.<col>`. */
function inputColumns(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/Pause_Wearable_Feature__dlm\.(\w+)/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Output aliases: `... AS <col>`. */
function outputColumns(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/\bAS\s+(\w+)/gi)) out.add(m[1]);
  return out;
}

/** Single-quoted literals — in these CIs, only observation_type filter values. */
function quotedLiterals(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/'([^']+)'/g)) out.add(m[1]);
  return out;
}

/** A DMO column `<field>__c` maps back to the DLO ingested field `<field>`. */
function dmoColumnToDloField(col: string): string {
  return col.replace(/__c$/, "");
}

describe("real-data ingestion · DLO schema", () => {
  it("defines the fields the pipeline depends on + the observation_type enum", () => {
    for (const f of ["unified_id", "observation_type", "value_num"]) {
      expect(DLO_FIELDS.has(f)).toBe(true);
    }
    expect(OBSERVATION_ENUM).toEqual(
      new Set(["hrv_rmssd", "sleep_session", "hot_flash", "night_sweat"])
    );
  });
});

describe.each(CIS)("real CI SQL · $label", (ci) => {
  const sql = stripSqlComments(readRepoFile(ci.file));

  it("only reads DMO columns that exist as DLO schema fields", () => {
    const inputs = inputColumns(sql);
    expect(inputs.size).toBeGreaterThan(0);
    for (const col of inputs) {
      expect(DLO_FIELDS.has(dmoColumnToDloField(col))).toBe(true);
    }
    // The dimension + the metric are always read.
    expect(inputs.has("unified_id__c")).toBe(true);
    expect(inputs.has("value_num__c")).toBe(true);
  });

  it("filters exactly the observation_type values the push emits (all in-enum)", () => {
    const literals = quotedLiterals(sql);
    expect(literals).toEqual(new Set(ci.observationTypes));
    for (const v of literals) expect(OBSERVATION_ENUM.has(v)).toBe(true);
  });

  it("emits exactly the documented output columns", () => {
    expect(outputColumns(sql)).toEqual(new Set(ci.outputs));
  });

  it("groups by the unified_id__c dimension (never the validator-rejected ssot__Id__c)", () => {
    expect(sql).toMatch(/GROUP BY\s+Pause_Wearable_Feature__dlm\.unified_id__c/);
    expect(sql).not.toMatch(/GROUP BY[^\n]*ssot__Id__c/);
  });

  it("everything the frontend reads is an output column the CI emits", () => {
    const outputs = outputColumns(sql);
    for (const col of ci.frontendReads) expect(outputs.has(col)).toBe(true);
  });
});

describe("frontend read path (data-cloud.ts) ⇄ real CI contract", () => {
  it("queries each CI by its __cio API name", () => {
    for (const ci of CIS) {
      expect(dataCloudTs).toContain(`"${ci.devName}__cio"`);
    }
  });

  it("reads each CI's frontend-facing output columns by name", () => {
    for (const ci of CIS) {
      for (const col of ci.frontendReads) {
        expect(dataCloudTs).toContain(col);
      }
    }
  });

  it("filters the Calculated Insights on the unified_id__c dimension", () => {
    expect(dataCloudTs).toContain("unified_id__c");
  });
});

describe("union of CI observation-type filters covers the whole enum", () => {
  it("every enum value is consumed by exactly one CI (no orphaned or stray types)", () => {
    const covered = new Set<string>();
    for (const ci of CIS) {
      for (const t of ci.observationTypes) {
        expect(covered.has(t)).toBe(false); // no type claimed by two CIs
        covered.add(t);
      }
    }
    expect(covered).toEqual(OBSERVATION_ENUM);
  });
});
