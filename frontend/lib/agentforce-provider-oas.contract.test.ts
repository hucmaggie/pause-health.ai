import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { queryProviderDirectory } from "./mulesoft-mocks";

/**
 * Agentforce External Services slice ↔ live provider contract guard.
 *
 * `salesforce/external-services/pause-provider-directory.oas.yaml` is the lean
 * spec Salesforce parses into the `findMenopauseProviders` agent action. It is
 * DELIBERATELY a subset of what GET /api/mulesoft/providers returns (no meta,
 * query echo, or provenance — the agent doesn't need those). But the subset is
 * load-bearing: the topic instructions in
 * docs/AGENTFORCE_PROVIDER_ACTION_RUNBOOK.md tell the agent to read `matchType`
 * and present `distanceMiles` / `insuranceAccepted`, and those only reach the
 * action output if they're DECLARED here. The slice silently drifted once
 * (matchType referenced by instructions but undeclared → never mapped); this
 * test pins both ends so it can't drift again:
 *
 *   - every agent-relevant field is DECLARED in the slice, and
 *   - every such field is actually PRODUCED by the live directory query.
 *
 * Parsed as raw text on purpose — no YAML dependency is declared in this
 * package, and substring presence is all the contract needs (the YAML itself is
 * validated structurally at author time).
 */

const OAS = readFileSync(
  fileURLToPath(
    new URL(
      "../../salesforce/external-services/pause-provider-directory.oas.yaml",
      import.meta.url
    )
  ),
  "utf8"
);

// Fields the runbook instructions present to the patient. Present on EVERY row
// of a non-empty result (distanceMiles is stamped as a number or null; the
// "Medicare floor" guarantees a non-empty insuranceAccepted on every row).
const PER_ROW_AGENT_FIELDS = [
  "npi",
  "name",
  "specialty",
  "menopauseCertified",
  "city",
  "state",
  "zip",
  "acceptingNewPatients",
  "telehealth",
  "graphScore",
  "distanceMiles",
  "insuranceAccepted"
] as const;

// Optional supporting evidence — declared in the slice and produced for some
// (not all) providers, so we assert "appears on at least one row".
// (serviceSignals: some providers; credentialSource: certified providers only.)
const OPTIONAL_AGENT_FIELDS = ["serviceSignals", "credentialSource"] as const;

const AGENT_QUERY_PARAMS = [
  "zip",
  "menopause",
  "limit",
  "insurance",
  "fallback",
  "telehealth"
] as const;

// The honest-framing tiers the topic instructions branch on. Each must be named
// in the matchType description so a maintainer re-registering the action sees
// the full ladder.
const MATCH_TYPES = [
  "certified-local",
  "relevant-local",
  "certified-remote",
  "certified-national",
  "none"
] as const;

describe("Agentforce provider OAS slice · declares what the agent needs", () => {
  it("declares every agent-facing query param", () => {
    for (const p of AGENT_QUERY_PARAMS) {
      expect(OAS, `query param "${p}" missing from the slice`).toContain(`name: ${p}`);
    }
  });

  it("declares top-level matchType and enumerates every honest-framing tier", () => {
    expect(OAS, "matchType not declared as a top-level response field").toMatch(
      /^ {18}matchType:/m
    );
    for (const tier of MATCH_TYPES) {
      expect(OAS, `matchType description omits the "${tier}" tier`).toContain(tier);
    }
  });

  it("declares every per-row provider field the instructions present", () => {
    for (const f of [...PER_ROW_AGENT_FIELDS, ...OPTIONAL_AGENT_FIELDS]) {
      expect(OAS, `provider field "${f}" missing from the slice`).toContain(`${f}:`);
    }
  });

  it("stays a lean slice — it must NOT re-add parser-hostile constructs", () => {
    // The External Services parser rejects these; keep the slice primitive.
    expect(OAS).not.toContain("$ref");
    expect(OAS).not.toContain("oneOf");
    expect(OAS).not.toContain("nullable");
  });
});

describe("Agentforce provider OAS slice · matches the live directory output", () => {
  // A ZIP+centroid query so distanceMiles is a real number and we exercise the
  // certified-local tier the demo relies on.
  const out = queryProviderDirectory({
    zip: "92614",
    menopauseOnly: true,
    fallback: true,
    zipCentroid: { latitude: 33.68021, longitude: -117.833355 },
    limit: 5
  });

  it("the live query returns the matchType the slice now exposes", () => {
    expect(MATCH_TYPES).toContain(out.matchType);
  });

  it("every per-row agent field declared in the slice is produced live", () => {
    expect(out.providers.length).toBeGreaterThan(0);
    const sample = out.providers[0];
    for (const f of PER_ROW_AGENT_FIELDS) {
      expect(sample, `live provider row missing "${f}"`).toHaveProperty(f);
    }
  });

  it("the optional supporting fields are produced for at least one provider", () => {
    // serviceSignals is per-provider evidence; the national run carries it on
    // the bulk of rows, so it must appear somewhere in a real result set.
    const wide = queryProviderDirectory({ menopauseOnly: false, limit: 100 });
    const withSignals = wide.providers.filter(
      (p) => (p.serviceSignals ?? []).length > 0
    );
    expect(withSignals.length).toBeGreaterThan(0);

    // credentialSource is stamped on every certified row; a certified-national
    // run must produce it (and only the two honest values).
    const certified = queryProviderDirectory({
      menopauseOnly: true,
      fallback: true,
      limit: 9999
    });
    expect(certified.providers.length).toBeGreaterThan(0);
    for (const p of certified.providers) {
      expect(["curated-overlay", "self-reported"]).toContain(p.credentialSource);
    }
  });
});
