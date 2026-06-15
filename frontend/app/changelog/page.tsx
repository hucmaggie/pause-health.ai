import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Changelog",
  description:
    "What's shipped at Pause-Health.ai. Grouped by week, with links to the underlying GitHub commits. Updated after every polish pass — the git log is part of the artifact.",
  path: "/changelog",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Pause-Health.ai changelog — what's shipped, week by week."
});

const GITHUB_REPO = "https://github.com/hucmaggie/pause-health.ai";

type ChangelogEntry = {
  title: string;
  summary: string;
  commits: Array<{ sha: string; label: string }>;
  status: StatusPillStatus;
};

type ChangelogWeek = {
  range: string;
  headline: string;
  intro: string;
  entries: ChangelogEntry[];
};

const weeks: ChangelogWeek[] = [
  {
    range: "Week of June 13, 2026",
    headline: "Data 360 Phase 2 is LIVE: Data Cloud Calculated Insights grounding in production",
    intro:
      "The Data Cloud wearable/EHR insights flipped from designed-on-paper to live in production. On the trailsignup org, Data Cloud was already provisioned; three Calculated Insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) were authored over ssot__Individual__dlm and activated, SF_DC_TENANT_URL was wired into Vercel, and the grounding endpoint now returns \"Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights\". The path there surfaced five things the original runbook got wrong — most importantly that a core Salesforce token is not valid against the c360a tenant and must be exchanged at /services/a360/token first. All five are documented in docs/PHASE_2_ACTIVATION_CHECKLIST.md so re-running on a customer org is a checklist, not an archaeology dig.",
    entries: [
      {
        title: "Care Router: MSCP recommendations now show distance from the patient — and rank by it",
        summary:
          "The new ZCTA-centroid distance ranking is wired through to the Care Router's MSCP provider recommendations and surfaced in the UI. attachRecommendedProviders now resolves the patient's ZIP to a Census centroid and passes it through the ProviderLookup contract, so queryProviderDirectory ranks the candidate pool by Haversine distance ascending (graphScore desc tiebreak) before rankForModality re-orders within that for telehealth-vs-in-person preference. RecommendedProvider gained an optional distanceMiles, the rationale line reports which ranking actually applied (\"ranked by distance from the patient's ZIP\" vs \"ranked by graph score\") so the agent-fabric trace tells the truth, and the trace span itself carries a richer recommendedProviders attribute (name, specialty, city, state, telehealth, distanceMiles) alongside the legacy recommendedProviderNames array — older trace consumers still parse, newer ones get the full shape. The /demo dashboard's LatestCareRouterDecision card reads the rich attribute (with a graceful fallback to the legacy strings for traces written before this commit) and renders inline metadata next to each recommendation: e.g. \"Dr. Helen Okafor · OB/GYN (Newport Beach, CA · 4.2 mi away · telehealth)\". 250 frontend tests green (2 new: zipCentroid forwarded + distanceMiles propagated end-to-end, score-only rationale fallback when no centroid resolves); tsc clean.",
        commits: [
          { sha: "9a4ea19", label: "care-router: propagate distance through MSCP recommendations + UI" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: real distance ranking — providers come back sorted by miles from the patient ZIP",
        summary:
          "The directory now ranks by Haversine distance from the patient's ZIP whenever its centroid is known, instead of leaning on the ZIP-3 prefix tier as a proxy for proximity. The Census 2020 ZCTA Gazetteer (public domain, ~1 MB) is parsed into a {zip5: [lat, lng]} map by a new provider_ingest.centroids module and committed twice: once into the wheel-bundled provider_ingest/data/zip_centroids.json (so the build pipeline stamps latitude/longitude on every NPPES row whose ZIP has a ZCTA centroid — 1,931 of 2,014 in the June 2026 run, 96%) and once into frontend/lib/zip-centroids.generated.json (so a tiny server-only loader resolves the patient's query ZIP at request time). queryProviderDirectory grew an opt-in zipCentroid arg: when a centroid is supplied AND at least one in-tier provider has its own coordinates, every returned row gets a distanceMiles (rounded to 0.1 mi — false precision past that, since centroids are area middles, not addresses), the rows sort distance asc with graphScore desc as the tiebreak, and a new top-level sort field reports which ranking actually applied (\"distance\" vs \"score\"). Providers with no centroid (rare PO-box-only / very new ZIPs) get distanceMiles: null and slide to the end honestly. The tier ladder (matchType) is unchanged — distance is a within-tier sort, so certified-local still wins over relevant-local even when the latter is geographically closer. /api/mulesoft/providers wires the centroid in by default (?distance=false to opt out for callers that need the prior score-only ordering); the prefer-real client forwards the centroid (the live Mule app still ranks by score until its DataWeave is updated, which is fine because the agent reads sort=score and degrades cleanly). The OAS contract gained Provider.latitude / longitude / distanceMiles + a sort enum + a distance query param — all additive, so the registered Salesforce External Service still validates with no re-import. The MCP find_menopause_providers tool description and per-call summary now teach the model to read sort and report distance to the patient (\"about 4 miles away\") when present. 248 frontend tests green (4 new distance tests covering: distance ranking when centroid present, score-only fallback when not, null-distance providers slide to the end, Haversine sanity Irvine→Brooklyn ≈ 2,436 mi); 35 provider_ingest tests green (2 new centroid-stamping tests); frontend + MCP tsc clean.",
        commits: [
          { sha: "fd6321a", label: "provider-graph: distance ranking from Census ZCTA centroids" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: graceful provider fallback — any ZIP now gets a useful, honestly-labeled answer",
        summary:
          "The national NPPES run exposed a gap: the agent queries menopause=true, but self-reported MSCP/NCMP is rare (~7 nationally), so a patient outside the demo metros got an empty result while 2,000 real menopause-relevant providers sat invisible behind the certified filter. queryProviderDirectory now supports an opt-in tiered fallback that reports which tier answered via a new matchType field: certified-local (certified specialists in the ZIP-3 area — the happy path), relevant-local (no local certified, so nearby menopause-EXPERIENCED but non-certified clinicians), certified-remote (nothing local, so telehealth-capable certified specialists nationally), plus certified-national / local / all / none. Crucially the fallback is OFF by default — the Care Router's 'MSCP-credentialed' recommendation and the demo's strict certified-local invariant are untouched — and the agent-facing Experience API (/api/mulesoft/providers) opts in (?fallback=true, default-on, with a ?fallback=false escape hatch). It's plumbed through the live MuleSoft client (fetchLiveProviders / getProvidersPreferReal) and the MCP find_menopause_providers tool, whose summary + description now instruct the model to present each tier honestly (relevant-local as 'menopause-experienced, not certified'; certified-remote as 'no local match, these offer telehealth'). The OAS contract was extended additively (optional matchType + fallback param) so the already-registered Salesforce External Service still validates with no re-import, and the Agent Builder topic instructions were rewritten for honest matchType framing. 244 frontend tests green (7 new tiered-fallback tests, derived from the committed directory so they survive data regens); frontend + MCP tsc clean.",
        commits: [
          { sha: "0a3b620", label: "provider-graph: graceful provider fallback so any ZIP gets a useful, honest answer" }
        ],
        status: "shipped"
      },
      {
        title: "Provider graph: version-controlled the Salesforce org + shipped a real national NPPES run (honest MSCP detection)",
        summary:
          "Two infrastructure passes on the provider/agent stack. (1) Phase 18b — the Agentforce intake/provider metadata is now a real, version-controlled salesforce/ SFDX project (sfdx-project.json + force-app + manifest + deploy.sh/retrieve.sh + README), replacing the throwaway .sf-deploy/ scaffold and the ad-hoc /tmp retrieves; the duplicate Named Credential was reconciled and the runbooks point at the new layout. The deployable subset (named credential, MessagingSession.Pause_Patient_Zip__c, routing flow, messaging channel, permission set) is tracked; the remaining ~20 dossier fields + the Agent (Bot/GenAiPlannerBundle) stay org-managed and are one retrieve.sh away. (2) Provider-graph — the NPPES ingest now earns real menopause-certified coverage honestly: independent of the synthetic overlay, nppes.py flags a provider menopauseCertified when they self-report MSCP (or its former name NCMP) in the NPPES 'Provider Credential Text' field — a real public-registry signal, not a fabricated credential — and build.py accepts multiple --nppes inputs that merge + de-dupe by NPI, so the national npidata_pfile can be combined with the demo fixture in one run (demo personas stay green, every other ZIP gets real coverage). No contract, agent, or Care-Router change needed; menopause=true keeps meaning certified. Then the national run actually shipped: the CMS June 2026 npidata_pfile (8.5M rows) streamed through the pipeline and the result is now the committed directory — 2,014 providers, of which 14 are menopause-certified: the 7 demo personas plus 7 REAL practitioners who self-report MSCP/NCMP in NPPES (CA, IA, ID, MN, NC×2, NJ), with 2,000 real non-certified providers across 55 states / 534 ZIP-3 prefixes for general browsing. Three changes made that correct + fast: the reader now parses only the ~40 columns it needs (csv.reader, not a 330-column DictReader) so the full file runs in ~1m45s instead of ~30 min; NPI-collision merge switched to 'later input wins' (demo fixture listed last) so personas stay green even where their real-format NPIs also exist nationally; and a new --keep-all-certified flag means --limit caps only the non-certified breadth and never drops a certified provider (the agent queries menopause=true). Verified all 6 demo persona ZIPs return identical certified results vs the prior dataset; provider_ingest 33 tests + ruff green, frontend tsc + 23 provider tests green. Honest finding, documented in the runbook + provenance: self-reported MSCP/NCMP is rare in NPPES (~7 nationally), so dense certified coverage outside the demo metros still needs the licensed Menopause Society feed — the non-certified rows give the directory real national breadth in the meantime.",
        commits: [
          { sha: "cbb760f", label: "salesforce: version-control org metadata into a canonical SFDX project (Phase 18b)" },
          { sha: "f63c582", label: "provider-graph: honest MSCP/NCMP credential detection + national-ready merge" },
          { sha: "5b67376", label: "provider-graph: ship national NPPES run behind the contract (2,014 providers)" }
        ],
        status: "prototype"
      },
      {
        title: "The Agentforce agent auto-uses the intake ZIP — live + verified on trailsignup",
        summary:
          "The 'Find a Provider' subagent now reads the patient's ZIP straight from the intake context and returns local specialists without ever asking — verified end-to-end on the live trailsignup embed: persona Anika Patel (92614) → 'find a provider that specializes in menopause' → Dr. Helen Okafor DO MSCP (Newport Beach) + Dr. Priya Anand MD FACOG MSCP (Irvine), both 926-prefix Orange County, no New York / LA national fallback, and no ZIP question. This finally lit up the hidden-prechat pipeline that had been dormant since Phase 18c (the V2 Embedded Messaging prechatAPI used to be a no-op Proxy; it's now a real implementation that validates field names). Repo side: the embed re-enables the one field (agentforce-embed.tsx + /api/intake/prechat-context send Patient_Zip from the selected persona), and the Salesforce handoff stack deployed to trailsignup (Deploy ID 0AfHp00003ocxqYKAQ, 5/5) — a MessagingSession.Pause_Patient_Zip__c Text(16) field, a Patient_Zip input + Update Records on the Pause_Intake_Prechat_Router routing Flow, the Patient_Zip customParameter + parameter mapping on the Messaging_for_In_App_Web channel, and FLS via the Pause_Health_Intake_Prechat_Dossier permission set. Org side: included Pause_Patient_Zip on the agent's Messaging Session context variable, bound the PauseProviderDirectory action's zip input to it, rewrote the Find-a-Provider reasoning to use context-then-ask, and activated Agent Version 4. Two gotchas worth their weight: (1) MessagingChannel metadata has no element for 'allowed file types', so any deploy with attachments on fails the 'Allowed file types can't be null' validation — disabled inbound attachments on the channel (intake never uses them); (2) the actual blocker was that the Embedded Service Deployment had to be re-Published after adding the hidden field — setHiddenPrechatFields reported 'applied' the whole time, but the value only reached the routing Flow once the deployment was published and the ~5-15 min CDN propagation finished. Full wiring + both gotchas in docs/PHASE_3_RUNBOOK.md (Phase 18d).",
        commits: [
          { sha: "f4a1654", label: "agentforce: ship auto-ZIP to Find-a-Provider (verified live on trailsignup)" }
        ],
        status: "shipped"
      },
      {
        title: "The Agentforce agent can now find providers — live on trailsignup",
        summary:
          "The live Pause_Health_Intake_Agent used to deflect on \"find a provider that specializes in menopause\" — it was a generic intake-only Service Agent with no action wired to the Pause provider graph. It now answers for real. The fix shipped in two halves. Repo side (no Apex needed, because /api/mulesoft/providers is a public no-auth GET): a lean External-Services-compatible OpenAPI 3.0 spec (operation findMenopauseProviders, stripped of $ref/oneOf/nullable/auth so the parser accepts it), a no-auth Named Credential pointing at https://pause-health.ai deployed via a throwaway SFDX harness, and a runbook with paste-ready Agent Builder copy. Org side, on trailsignup: registered the PauseProviderDirectory External Service from the spec, added a \"Find a Provider\" subagent to the agent with the findMenopauseProviders action (inputs agent-populated from descriptions — menopause=true, limit=3, zip asked of the patient), pasted the reasoning instructions, and activated Version 3. Verified end-to-end in Agent Builder Preview: \"find a provider that specializes in menopause near 92614\" → Agent Router transitions to Find a Provider → calls the action with zip=92614/menopause=true/limit=3 → returns two real NPPES-derived MSCP clinicians (Dr. Helen Okafor DO MSCP, Newport Beach; Dr. Priya Anand MD FACOG MSCP, Irvine) with telehealth + accepting-new-patients status → Output Evaluation: GROUNDED. Known limit: the embed's prechat is a no-op, so the agent asks the patient for their ZIP rather than reading the intake ZIP in-band; coverage tracks the demo fixture's ZIP prefixes until provider_ingest runs against the national NPPES file (same action, no agent change).",
        commits: [
          { sha: "6d89fbd", label: "agentforce: stage provider-lookup action (External Service + Named Credential + runbook)" },
          { sha: "8632f6f", label: "changelog + runbook: paste-ready agent copy" },
          { sha: "7245d47", label: "agentforce: SFDX deploy harness for the Named Credential" }
        ],
        status: "shipped"
      },
      {
        title: "Intake captures ZIP so MSCP recommendations are local",
        summary:
          "Closed the loop on the Care Router provider wiring: intake now captures an optional patient ZIP, so the MSCP recommendations narrow to the patient's area instead of falling back to top-national matches. The scripted intake assistant (agentforce-fallback) asks for a 5-digit ZIP right after the name step — optional, ZIP-validated, and sent as undefined when blank so an empty value never filters the directory. DemoPersona gained a patientZip and each of the six personas got a ZIP whose 3-digit prefix maps to an MSCP-certified clinician in the NPPES-derived directory, so the four personas that route to an MSCP pathway (Anika, Brianna, Elena, Fatima) now surface a local specialist. personaToCareRouterIntake forwards the ZIP; the intake telemetry span records patientZipProvided. Transport needed no change — the handoff already forwards the whole IntakeRecord. New demo-cohort.test pins that every persona ZIP resolves to at least one local certified provider; full frontend suite 237/237 green.",
        commits: [
          { sha: "22b7dff", label: "intake: capture patientZip to geo-narrow MSCP recommendations" }
        ],
        status: "prototype"
      },
      {
        title: "Care Router wiring: the provider graph now feeds triage",
        summary:
          "The NPPES-backed provider directory is no longer just a demo surface — it feeds the Care Router. When the router lands on an MSCP pathway (virtual or in-person), route() now enriches the RoutingDecision with a ranked recommended-provider list pulled from getProvidersPreferReal (live MuleSoft Experience API when MULESOFT_PROVIDERS_BASE_URL is set, otherwise the in-process NPPES-derived directory). The list is re-ranked for modality (telehealth-capable first for virtual visits, accepting-new-patients first for in-person), capped at three, and narrowed to the patient's ZIP when intake carries one. Enrichment is best-effort and never throws — a provider-graph failure leaves the routing decision intact. The recommendations flow through the existing A2A RoutingDecision artifact, the Agent Fabric trace span (recommendedProviderCount / source / names), and a new 'Provider graph · MSCP recommendations' block on the live decision card at /demo/routing. RoutingDecision gained an optional recommendedProviders field and IntakeRecord an optional patientZip; 7 new care-router tests (modality ranking both ways, ZIP passthrough, empty-directory omit, failure-never-throws, route() enrichment). Full frontend suite: 234/234 green.",
        commits: [
          { sha: "09bb6f9", label: "care-router: attach NPPES provider recommendations to MSCP pathways" }
        ],
        status: "prototype"
      },
      {
        title: "Provider graph Phase 1: real NPPES taxonomy filter behind the frozen contract",
        summary:
          "The provider directory is no longer a hand-curated slice. New provider_ingest package (pure standard library) streams the CMS NPPES bulk schema, filters on the real menopause NUCC taxonomy codes (OB/GYN 207V*, Reproductive Endocrinology, Endocrinology 207RE0101X, Family + Internal Medicine, NP — Women's Health 363LW0102X, CNM, PA, Women's-Health CNS — each carrying a relevance weight), overlays an MSCP credential list, and computes a deterministic graphScore (relevance + accepting-new-patients + telehealth + completeness, × MSCP boost). It emits frontend/lib/provider-directory.generated.json, which queryProviderDirectory() now loads behind the unchanged /api/mulesoft/providers contract — the hand-curated rows survive only as a fallback, and provenance.sources reports \"CMS NPPES (taxonomy-filtered via provider_ingest)\". The committed dataset is the pipeline run over a synthetic NPPES-format fixture (real schema + real codes, with an org row and an orthopaedist correctly filtered out); pointing pause-provider-build at the national npidata_pfile produces the full ~80K-row slice with zero contract change. NPPES has no accepting/telehealth field, so those are derived deterministically from the NPI for the demo, and the MSCP list is synthetic until the Menopause Society feed lands — both called out honestly on /proposal/provider-graph. 25 provider_ingest tests + ruff green; frontend tsc + 23 provider tests green. Run + verify steps in docs/PROVIDER_GRAPH_PHASE_1_RUNBOOK.md.",
        commits: [
          { sha: "7fa9973", label: "provider-graph: Phase 1 NPPES ingest behind the frozen contract" }
        ],
        status: "prototype"
      },
      {
        title: "Data 360 Phase 2 activated end-to-end on production",
        summary:
          "Authored and activated three Data Cloud Calculated Insights on the trailsignup org over ssot__Individual__dlm (the Contact_Home data stream's first ingestion failed; Individual was already populated with 1168 records incl. all six demo personas). data-cloud.ts was aligned with the live CI surface: __cio-suffixed API names, unified_id__c dimension, __c-suffixed metric columns, and the [field=value] CI filter syntax. The real fixes: (1) the CI query endpoint is GET /api/v1/insight/calculated-insights/{ci}?filters=[...], not the /insight/query?insight_api_name=... shape the code shipped with; (2) Data Cloud requires a two-legged token flow — the core client_credentials token must be exchanged at POST <instanceUrl>/services/a360/token (grant_type urn:salesforce:grant-type:external:cdp) for a DC-scoped token, and the c360a gateway rejects un-exchanged tokens with a bare 400. Added requestDataCloudToken()/getDataCloudToken() with its own cache; dcFetch now targets the authoritative tenant instance_url from the exchange. SF_DC_TENANT_URL set on Production/Preview/Development in Vercel. Verified live: anika-patel grounding returns the three wearable insights (z-score -0.3 / burden 47.5 / disruption 0.43) with 30d/30d/7d windows.",
        commits: [
          { sha: "1a441a3", label: "data-cloud: add the required Data Cloud token exchange" },
          { sha: "61736a3", label: "data-cloud: fix CI Query API endpoint shape" },
          { sha: "1901f90", label: "data-cloud: align constants + filter expression with live trailsignup CIs" },
          { sha: "feda3d4", label: "docs: mark Phase 2 Data Cloud activation SHIPPED + record gotchas" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 9, 2026",
    headline: "MuleSoft iterations 3–7: Flex Gateway live, JWT auth, OAS spec, rate limiting, stable tunnel",
    intro:
      "Five iterations landed in a single session. Flex Gateway (Docker + ngrok) is running with runtime enforcement active — 401 on missing/invalid JWT, 429 on rate limit exceeded. Auth0 M2M client credentials grant issues RS256 tokens; the Next.js proxy caches and forwards them automatically. Plain Rate Limiting (10 req/min global) replaced the SLA-based policy after a BadArgument conflict with JWT. The OAS 3.0 spec is published to Exchange as a REST API asset with interactive docs. ngrok static domain is pinned in docker-compose so the tunnel URL survives restarts. Policy stack: JWT Validation + Rate Limiting (plain).",
    entries: [
      {
        title: "MuleSoft iterations 3–7: Flex Gateway, JWT, OAS 3.0, rate limiting, stable tunnel",
        summary:
          "Iteration 3: Flex Gateway deployed as Docker + ngrok proxy, registered with Anypoint as Omni Gateway instance (ID 20955827), Client ID Enforcement policy applied — first live runtime enforcement (401 on unauthenticated requests). Iteration 4: Rate Limiting SLA (10 req/min Demo tier) added; Next.js proxy updated to send dual auth headers (Basic Auth + client_id/client_secret custom headers) because DataWeave Base64 decode is unsupported in Flex Gateway policy sandbox. Iteration 5: OAS 3.0 spec (mulesoft/pause-provider-experience-api.oas3.yaml) written and published to Exchange as pause-provider-experience-api-spec v1.0.0 (REST API type — separate from the HTTP API asset). Iteration 6: ngrok free static domain (cattail-reactive-sassy.ngrok-free.dev) pinned in docker-compose.yml with --domain flag. Iteration 7: JWT Validation policy (Auth0 RS256/JWKS, audience-validated, expiry mandatory) replaces Client ID Enforcement; Rate Limiting SLA replaced with plain Rate Limiting (SLA-based policy caused BadArgument when JWT present — contract lookup incompatible); Auth0 M2M app pause-prototype-client configured with Client Credentials grant; frontend/lib/mulesoft/auth.ts added for 24h token caching; both health.ts and providers.ts updated to send Authorization: Bearer <jwt> with Basic Auth fallback; AUTH0_MULESOFT_* vars set in Vercel; OAS spec updated to v1.0.2 with bearerAuth security scheme.",
        commits: [
          { sha: "37372b4", label: "mulesoft: iteration 3 — Flex Gateway live, runtime enforcement active" },
          { sha: "981c031", label: "mulesoft: iterations 4-7 — rate limiting, OAS spec, stable tunnel, JWT auth" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of June 7, 2026",
    headline: "MuleSoft iteration 2: /providers live + API Manager governance plane wired",
    intro:
      "MuleSoft iteration 2 shipped end-to-end. A second Experience API (/providers) is live on the CloudHub 2.0 worker; the Anypoint API Manager governance plane (API instance, Client ID Enforcement policy, Rate Limiting SLA, Demo/Production SLA tiers, registered client app, credentials set in Vercel) is fully configured. Runtime policy enforcement is deferred to Flex Gateway — a topology change, not a code change (CH2 Shared Space doesn't surface the Mule agent autodiscovery channel). Credential headers are injected from Vercel into both MuleSoft proxies today so the wire-up is a single Flex Gateway deployment away. Earlier same week: MuleSoft runtime 4.11.2 upgrade, health-flow.xml fixes, and Data 360 Phase 2 code layer.",
    entries: [
      {
        title: "MuleSoft iteration 2: /providers live + API Manager governance configured",
        summary:
          "GET /providers?zip=&menopause=&limit= is live on the deployed CloudHub 2.0 worker (pause-mulesoft-health-v1). The Mule flow returns a DataWeave-built provider directory ranked by graphScore with zip-prefix + menopause-certified filters; DataWeave slice clamping bug (sorted[0 to N-1] returning empty when N > array length) fixed. lib/mulesoft/providers.ts implements the same prefer-real / degrade-to-mock / warn-once pattern as health.ts: activated by MULESOFT_PROVIDERS_BASE_URL, falls back to queryProviderDirectory() on any failure. 23 new unit tests (providers.test.ts); total MuleSoft lib count: 45/45. MULESOFT_PROVIDERS_BASE_URL, MULESOFT_CLIENT_ID, and MULESOFT_CLIENT_SECRET are set in Vercel production; both /health and /providers proxies inject client credentials on every request. Anypoint governance plane: API Manager instance ID 20954842 registered, Client ID Enforcement + Rate Limiting SLA policies applied, Demo tier (10 req/min, auto-approve) + Production tier (1000 req/min) created, pause-prototype-client app approved on Demo tier. Runtime enforcement deferred: CH2 Shared Space doesn't expose the Mule agent autodiscovery channel; Flex Gateway is the path to activate the 401/429 enforcement at the wire. Runbook updated to document the full state and the Flex Gateway next step.",
        commits: [
          { sha: "1e4468e", label: "mulesoft: iteration 2 — /providers live + API Manager runbook" }
        ],
        status: "shipped"
      },
      {
        title: "MuleSoft: runtime 4.11.2, Java 17, health-flow.xml fixes",
        summary:
          "mule-artifact.json bumped to minMuleVersion 4.11.0 with javaSpecificationVersions: [\"17\"]. pom.xml bumped to app.runtime 4.11.2, mule-maven-plugin 4.7.0. health-flow.xml had two XML errors that prevented Code Builder from rendering the canvas: (1) <http:headers> used as a standalone flow processor — moved it into <http:response> nested inside <http:listener> where Mule 4 expects it; (2) double-hyphen (--) inside an XML comment — illegal in XML, replaced with single hyphen. Code Builder .vscode/launch.json and .vscode/settings.json scaffolding committed.",
        commits: [
          { sha: "3662130", label: "mulesoft: bump runtime + fix health-flow.xml" }
        ],
        status: "partial"
      },
      {
        title: "Data 360 Phase 2: Data Cloud Calculated Insights layer",
        summary:
          "New lib/salesforce/data-cloud.ts implements the Data Cloud Query API and Calculated Insights API client, mirroring the same warn-once / prefer-real / degrade-to-null pattern as the Phase 1 SOQL path. Activated by SF_DC_TENANT_URL env var. lib/salesforce/grounding.ts updated to call getWearableInsights() in parallel with the four SOQL queries; each of the three wearable insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) falls back to its intake baseline independently. groundingProvenance.federatedQuery reflects which path served the request. frontend/.env.example documents the new vars with derivation notes. Full org setup walkthrough — DMO authoring, CI SQL, mock CI path, env var wiring, verification curls — in new docs/MULESOFT_PHASE_2_DATA_CLOUD.md. Probe result: trailsignup org has the permission sets but no provisioned DC tenant; code is ready and waiting.",
        commits: [
          { sha: "8a2e55f", label: "data-360: Phase 2 Data Cloud Calculated Insights layer" }
        ],
        status: "partial"
      }
    ]
  },
  {
    range: "Week of June 1, 2026",
    headline: "Honesty-pilling marathon",
    intro:
      "Thirty-plus commits across every public page on the site. The single theme: replace any present-tense claim that isn't yet true with a StatusPill-flagged 'today vs. designed' framing. The Apache-2.0 license + OSS-hygiene trio (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY) landed mid-week, the polish marathon wrapped with a reproducible end-to-end smoke test (132 / 132 pass), the JupyterHealth integration jumped from designed-on-paper to wire-level prototype (27 / 27 against an in-process JHE mock), the Care Router business logic got its first test safety net (100 new tests covering ~1,100 lines of previously-untested risk-band + pathway + A2A code), and the MuleSoft Phase 1 deploy artifact got pre-staged (deployable Mule app, live/mock proxy with graceful degradation, 31 new unit tests, env-gated investor badge) so the Anypoint clickthrough is the only remaining work on the user's plate.",
    entries: [
      {
        title: "MuleSoft Anypoint Phase 1: deployable artifact + live/mock proxy",
        summary:
          "Phase 1 shipped 2026-06-07. A real Mule 4.11.2 app is running on CloudHub 2.0 (Cloudhub-US-West-1, Sandbox) at https://pause-mulesoft-health-v1-zkeniz.scqos5-1.usa-w1.cloudhub.io. MULESOFT_HEALTH_BASE_URL is set in Vercel production; /api/mulesoft/health reports meta._source: 'live-mulesoft' and meta._liveUrl matches the worker. Degradation path verified: stopping the Mule app surfaces meta._source: 'mock-fallback' with _liveAttempted: true — the prototype never goes hard-down. /proposal/mulesoft shows the green LIVE badge. Build fixes required along the way: mule-http-connector dependency missing from pom.xml, property placeholder ${http.listener.port:8081} replaced with hardcoded 8081, DataWeave (idx, _) two-arg lambda syntax replaced with $ / $$ implicit vars, config.yaml added for configuration-properties. Repo-side: lib/mulesoft/health.ts prefer-real / degrade-to-mock / warn-once client, 31 unit tests, env-gated investor badge.",
        commits: [
          { sha: "55e1b6d", label: "MuleSoft Phase 1 repo prep" },
          { sha: "3662130", label: "bump runtime 4.11.2, fix health-flow.xml" },
          { sha: "a4635f2", label: "add mule-http-connector dependency" },
          { sha: "a4b75fc", label: "add config.yaml + configuration-properties" },
          { sha: "bc6172b", label: "hardcode port 8081" },
          { sha: "38f4a24", label: "fix DataWeave lambda syntax" },
          { sha: "6a3c4ed", label: "set MULESOFT_HEALTH_BASE_URL in Vercel production" }
        ],
        status: "partial"
      },
      {
        title: "Care Router business logic: +100 unit tests, drift caught",
        summary:
          "Five new test files cover the highest-leverage business logic on the site: lib/risk-band.test.ts (30 tests pinning the deterministic intake → band → pathway decision tree against every persona in the demo cohort), lib/care-router-pathways.test.ts (11 tests pinning the canonical six-pathway enum), lib/care-router.test.ts (25 tests covering scriptedRoute's red-flag / severity / cycleStatus / ageBand / Data 360 grounding branches plus the claudeRoute no-API-key fallback), lib/agent-fabric.test.ts (20 tests covering evaluateGovernance, the trace ring buffer, and listRecentTaskIds), and app/api/agents/care-router/tasks/route.test.ts (14 tests covering JSON-RPC envelope validation, governance block path, success path with RoutingDecision artifacts, and metadata.parentSpanId / personaId passthrough into recorded trace spans). The risk-band suite surfaced a real drift: Brianna Okafor's displayRisk on the public /demo/intake queue table was labeled 'Moderate' but her sleepScore=8 trips the single-axis-promotion rule and computeRisk returns 'High'. Fixed the data, the tests now pin both surfaces. Total frontend test count: 73 → 173. Smoke test still 132 / 132.",
        commits: [
          { sha: "79bb9b0", label: "Care Router test suite" }
        ],
        status: "prototype"
      },
      {
        title: "pause_ingest → JHE: wire-level contract test (27 / 27 pass)",
        summary:
          "New in-process JHE mock server (tests/jhe_mock_server.py) implements the OAuth2 + FHIR endpoints pause_ingest actually hits. Seven integration tests (tests/test_exchange_integration.py) exercise the production exchange.upload_observation, hrv_features_to_fhir_observation, and read_recent_observations code paths end-to-end — including a full-pipeline test that uploads 6 raw heart-rate observations, computes time-domain HRV features, uploads the derived observation with derivedFrom provenance, and reads everything back. The contract test surfaced a real bug in read_recent_observations (the JupyterHealthClient 0.2.0 API doesn't accept client_id/client_secret) that lenient unit-test doubles missed. Added hrv_features_to_fhir_observation helper. New runbook at docs/JHE_SETUP_RUNBOOK.md captures the path to swap the mock for real JHE in an afternoon (~1 afternoon, gated on Docker). Flipped the JupyterHealth pill on /roadmap from designed to prototype.",
        commits: [
          { sha: "e1e43aa", label: "pause_ingest → JHE contract test" }
        ],
        status: "prototype"
      },
      {
        title: "End-to-end smoke test — 132 / 132 pass",
        summary:
          "New reproducible smoke-test harness at frontend/scripts/smoke-test.mjs. Hits all 35 public routes, follows 77 unique internal links discovered by parsing rendered HTML, and POSTs realistic fixtures to 16 API endpoints (including the A2A JSON-RPC tasks/send envelope to /api/agents/care-router/tasks). Results land in SMOKE_TEST_RESULTS.md committed at the repo root. Caught one false-positive in the link extractor (query-string handling) on the first run; no real regressions on the polished surface. Wired into package.json as `npm run smoke`.",
        commits: [
          { sha: "1fa3a19", label: "smoke test + 132/132 results" }
        ],
        status: "shipped"
      },
      {
        title: "/changelog + /roadmap pages",
        summary:
          "Built /changelog as a hand-curated weekly narrative with real commit SHAs linking to GitHub, and /roadmap as a Now / Next / Later horizon view drawn from the 30+ designed / planned / future items already pilled across the site. Home page got a 'momentum strip' (63 commits since May 24, 2026) with cross-links to both pages.",
        commits: [{ sha: "cd1ea17", label: "changelog + roadmap pages" }],
        status: "shipped"
      },
      {
        title: "Apache-2.0 license + OSS-hygiene trio",
        summary:
          "Released the source under the Apache License, Version 2.0 — the patent grant matters more than MIT's brevity in healthcare AI. Added the standard CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md set at the repo root, taking GitHub's Community Standards checklist to 100%. NOTICE file lists upstream attributions (JupyterHealth, DBDP, FLIRT, Salesforce, MCP, Anthropic, Menopause Society directory).",
        commits: [
          { sha: "83db016", label: "docs: OSS-hygiene trio" },
          { sha: "4090e33", label: "license: Apache-2.0" }
        ],
        status: "shipped"
      },
      {
        title: "/proposal/full — long-form investor brief polished",
        summary:
          "Nine high/medium-priority honesty fixes on the 4,000-line full proposal page. Hero copy softened from present-tense to 'designed to help clinicians…'. The $1,685 avoidable-spend metric deduplicated and pinned to its literature source. Anchor-provider claims softened to 'design-partner provider organizations'. whatPauseProvides and techFoundation cards each get per-card StatusPills. businessChannels ACV/PMPM table re-framed as Target ACV ranges with caveats. HIPAA/HITRUST/SOC 2 claims reconciled with the /security page.",
        commits: [{ sha: "91ee6ee", label: "proposal/full: pills + dedupe + sync" }],
        status: "shipped"
      },
      {
        title: "Seven supporting pages reconciled with reality",
        summary:
          "/careers, /security, /hipaa, /research, /privacy, /blog, /terms — each replaced false present-tense claims with explicit 'Today vs. Designed' tables. /security: removed 'BAAs executed' and 'SOC 2 Type II in progress' claims. /hipaa: stated outright 'Pause-Health.ai is NOT a Business Associate today.' /research: removed 'bias monitoring quarterly with clinician review' (no such program exists yet). /careers: reconciled the three founding roles (CMO, Head of AI, Head of Clinical Design) to match /about, all pilled 'future'.",
        commits: [
          { sha: "b60385b", label: "careers/security/hipaa/research/privacy/blog/terms: honesty pilling" }
        ],
        status: "shipped"
      },
      {
        title: "/about, /press, /contact — credibility polish",
        summary:
          "/about: hero updated to 'Pre-design-partner; prototype in the open'. Milestones split into Done vs. Planned with explicit pills. /press: replaced one-line stub with a real press kit — approved boilerplate, founder bio + headshot, brand-asset downloads, milestones, media contact with response-time SLA. /contact: each email alias now lists audience, what-to-include, response-time expectations. 'Self-route' section deflects to /careers, /press, /security, GitHub issues.",
        commits: [{ sha: "82a95db", label: "about/press/contact: honesty pilling + real press kit" }],
        status: "shipped"
      },
      {
        title: "Home page rebuilt with honest hero",
        summary:
          "New 'What's live today' strip with four prototype-pilled cards linking directly to /demo/intake, /demo/patient, /demo/routing, /demo/agent-fabric. Two-arc CTA section splits 'investors + partners' from 'builders + clinicians' with distinct calls-to-action. Founder credibility line links to /about and Maggie's LinkedIn. The $1,685 figure was removed from the hero (kept only in /proposal/full with proper research citation).",
        commits: [{ sha: "c3b71d3", label: "home: honest hero + What's live today + two-arc CTAs" }],
        status: "shipped"
      },
      {
        title: "Persona-aware navigation across all five /demo/* pages",
        summary:
          "DemoShell top nav now preserves the selected persona across pages (clicking 'Care Router' from /demo/intake?personaId=anika-patel keeps Anika selected). PreBriefPanel grew a compact switch-persona chip row, journey shortcuts ('Open Care Detail for Anika →'), and a risk-band + suggested-pathway verdict. /demo/analytics filters its cohort-comparison view by persona. /demo/agent-fabric grew a 'View all Anika's traces' link. A new PersonaJourneyFooter renders consistently across all five demo pages.",
        commits: [
          { sha: "a063a8d", label: "demo: PreBriefPanel persona-aware polish" },
          { sha: "1307ac2", label: "demo: persona-filterable agent-fabric + cross-links" },
          { sha: "45344bd", label: "demo: shared PersonaJourneyFooter" },
          { sha: "db057af", label: "demo: persona-preserving shell nav + analytics filter" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — late",
    headline: "Investor-brief polish, Arc A + Arc B",
    intro:
      "Eight architecture pages and four go-to-market pages each got a per-card StatusPill retrofit. The shared <StatusPill> component was extracted and the vocabulary canonicalized so 'Designed' means the same thing on /proposal/strategy as it does on /proposal/agentforce.",
    entries: [
      {
        title: "Arc B — eight architecture deep-dives polished",
        summary:
          "/proposal/agentforce, /proposal/mulesoft, /proposal/mcp, /proposal/dbdp, /proposal/integration, /proposal/provider-graph, /proposal/menopause-society, /proposal/data-360. Each rewritten with per-card pills, env-variable tables where relevant, and explicit 'today contract vs. designed pipeline' framing. /proposal/menopause-society: stale ~2,500 MSCP count updated to ~4,100 with a Research-pilled source citation.",
        commits: [
          { sha: "94e514b", label: "proposal/data-360: per-card pills + IR CTA" },
          { sha: "95e1fb2", label: "proposal/menopause-society: fix stale count" },
          { sha: "7f7dc6b", label: "proposal/provider-graph: prototype vs designed" },
          { sha: "c55eae5", label: "proposal/dbdp: per-row status pills" },
          { sha: "1630708", label: "proposal/integration: Phase 0 + pills" },
          { sha: "0805a32", label: "proposal/mulesoft: tense + pills" },
          { sha: "96db851", label: "proposal/mcp: gate npx behind Phase 1" },
          { sha: "0748050", label: "proposal/agentforce: honesty + env-table" }
        ],
        status: "shipped"
      },
      {
        title: "Arc A — go-to-market pages and shared <StatusPill>",
        summary:
          "/proposal/customers, /proposal/competition, /proposal/data, and the /proposal hub page each got the status-pill retrofit. The pill component itself was extracted from inline copies and canonicalized — three tones (real / mock / info) to distinguish 'this code ships today', 'this code is designed', and 'this is a research-derived number, not a capability'. Subsequent commits retrofit eight already-polished pages onto the shared component.",
        commits: [
          { sha: "3b67edc", label: "proposal: extract shared <StatusPill>, retrofit 8 pages" },
          { sha: "ced0fc0", label: "Arc A pages: customers / competition / data" },
          { sha: "189e565", label: "proposal hub: Arc A / Arc B grouping + demo links" }
        ],
        status: "shipped"
      },
      {
        title: "Strategy + technology + insights rebuilt for honesty",
        summary:
          "/proposal/strategy and /proposal/full rebuilt with plan-vs-status honesty. /proposal/technology reconciled with /proposal/insights so the customer-research summaries agree across pages. /proposal/insights re-framed as a 'Research-design plan' rather than asserting completed interviews.",
        commits: [
          { sha: "7c57191", label: "/proposal/technology + /proposal/insights" },
          { sha: "08e6be7", label: "/proposal/full + /proposal/strategy rebuild" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — early",
    headline: "Demo surface rebuild, persona-aware",
    intro:
      "The five /demo/* pages were each rebuilt around the canonical DEMO_COHORT personas. /demo/patient grew a Care Detail layout with risk gauge + axis flags + HRT suitability. /demo/routing demonstrates the Care Router decision live. /demo/analytics replaced static placeholder charts with operational metrics computed from real API trace data. /demo/agent-fabric joined the shared DemoShell nav.",
    entries: [
      {
        title: "Five /demo/* pages rebuilt around personas",
        summary:
          "Each demo page now accepts ?personaId=anika-patel (or any of the six seeded personas) and renders persona-aware content end-to-end. /demo/patient: Care Detail layout with risk gauge, axis flags, HRT suitability. /demo/routing: live Care Router decision with persona-specific intake hints. /demo/analytics: operational metrics + pathway-mix chart computed from real API traces.",
        commits: [
          { sha: "045aa04", label: "/demo/agent-fabric into shared DemoShell" },
          { sha: "2afb917", label: "/demo/analytics: live ops metrics + chart" },
          { sha: "81b48e3", label: "/demo/routing: persona-aware routing demo" },
          { sha: "a984061", label: "/demo/patient: persona-aware Care Detail" }
        ],
        status: "shipped"
      },
      {
        title: "Pre-Brief Panel ships — Embedded Messaging context layer",
        summary:
          "After discovering Salesforce's prechatAPI is a no-op Proxy in Embedded Messaging V2, pivoted from hidden pre-chat fields to a visible Pre-Brief Panel on /demo/intake. The panel surfaces the patient's Data 360 dossier (real Salesforce when SF_* env vars are set, deterministic mock otherwise) so the agent walks in pre-grounded.",
        commits: [
          { sha: "692f0a2", label: "Pre-Brief Panel: stack long Cohort_Name row" },
          { sha: "26fb582", label: "Pre-Brief Panel ships + V2 prechatAPI dead-end documented" },
          { sha: "2bb4e15", label: "Phase 18b: full agent-side wiring" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 24, 2026 — initial build",
    headline: "Prototype-in-the-open lands",
    intro:
      "The first week of Pause-Health.ai work. Eleven commits stood up the marketing site, investor brief, demo surface, MuleSoft integration plane, MCP server, multi-agent control plane, Salesforce Agentforce intake, and the Data 360 grounding layer — all built on top of the legacy Northstar Shipping API repo that already had CI/CD wiring.",
    entries: [
      {
        title: "Multi-agent control plane",
        summary:
          "Four agents (Agentforce intake, Anthropic Claude Care Router, Pause MCP server, MuleSoft Process API) wired through Google A2A + MCP, orchestrated by a MuleSoft Agent Fabric mock. Live console at /demo/agent-fabric.",
        commits: [
          { sha: "ded1e63", label: "multi-agent control plane" }
        ],
        status: "shipped"
      },
      {
        title: "Salesforce Data 360 grounding layer",
        summary:
          "Care Router grounds on real Salesforce Health Cloud objects (Contact + CareProgramEnrollee + CarePlan + Case) when SF_INSTANCE_URL/CLIENT_ID/SECRET are set; deterministic mock when unset. Agent Fabric console shows LIVE badge on every span served by a real org.",
        commits: [{ sha: "57dbdfd", label: "Data 360 grounding" }],
        status: "shipped"
      },
      {
        title: "MuleSoft + MCP + JupyterHealth + DBDP integration planes",
        summary:
          "Three-tier MuleSoft architecture reference artifacts. MCP server wraps the mocked Experience APIs as four tools for Claude Desktop, Cursor, Agentforce. JupyterHealth Exchange integration design + pause_ingest Python worker for wearable ingest. DBDP feature-engineering layer.",
        commits: [
          { sha: "d0942b6", label: "MCP server" },
          { sha: "1e35ef8", label: "MuleSoft integration plane" },
          { sha: "4a653c9", label: "JupyterHealth + ingest worker" },
          { sha: "13bd429", label: "DBDP wearable features" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce intake + Menopause Society referral path",
        summary:
          "Salesforce Agentforce Service Agent intake wired into the prototype with Pause-branded fallback. /proposal/menopause-society lays out the MSCP referral path with explicit ToS guardrails (deep-link to The Menopause Society's directory rather than scraping).",
        commits: [
          { sha: "1334296", label: "Agentforce intake" },
          { sha: "cc09923", label: "Menopause Society referral path" }
        ],
        status: "shipped"
      },
      {
        title: "Marketing site, investor brief, mobile nav, CI/CD",
        summary:
          "Initial Next.js frontend on top of the legacy Northstar repo. Full investor brief as a routed page. Mobile-friendly hamburger nav. Part 2 deep-dives. Vercel deploy + GitHub Actions for typecheck + Lighthouse nightly + CodeQL.",
        commits: [
          { sha: "597fd63", label: "Pause-Health.ai frontend + CI/CD" },
          { sha: "6501659", label: "Part 2 deep-dives + Next routing" },
          { sha: "479837e", label: "mobile hamburger nav" }
        ],
        status: "shipped"
      }
    ]
  }
];

function commitUrl(sha: string) {
  return `${GITHUB_REPO}/commit/${sha}`;
}

export default function ChangelogPage() {
  const allEntries = weeks.flatMap((w) => w.entries);

  return (
    <main className="container" style={{ paddingTop: "2.4rem", paddingBottom: "3rem", maxWidth: "60rem" }}>
      <header style={{ marginBottom: "1.8rem" }}>
        <p className="eyebrow">Changelog</p>
        <h1 style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", margin: "0.25rem 0 0.6rem" }}>
          What's shipped, week by week
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: "44rem", margin: 0, lineHeight: 1.55 }}>
          Pause-Health.ai is built in the open. The git log at{" "}
          <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          is the source of truth — this page is a hand-curated narrative
          view of the marquee weeks. Roadmap items (what's <em>coming</em>) live
          at <a href="/roadmap" style={{ color: "var(--brand)" }}>/roadmap</a>.
        </p>

        <div
          style={{
            marginTop: "1.1rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center"
          }}
        >
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            {allEntries.length} marquee entries across {weeks.length} weeks
          </span>
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            63 total commits since May 24, 2026
          </span>
          <a
            href={GITHUB_REPO + "/commits/main"}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.82rem", padding: "0.4rem 0.75rem" }}
          >
            See all commits on GitHub →
          </a>
        </div>
      </header>

      {weeks.map((week) => (
        <section
          key={week.range}
          aria-label={week.range}
          style={{
            marginBottom: "2.2rem",
            paddingBottom: "1.6rem",
            borderBottom: "1px solid var(--surface-3)"
          }}
        >
          <header style={{ marginBottom: "1.1rem" }}>
            <p
              className="eyebrow"
              style={{ marginBottom: "0.15rem" }}
            >
              {week.range}
            </p>
            <h2
              style={{
                fontSize: "1.4rem",
                margin: "0.05rem 0 0.5rem",
                color: "var(--text)"
              }}
            >
              {week.headline}
            </h2>
            <p
              style={{
                color: "var(--muted)",
                margin: 0,
                lineHeight: 1.55,
                fontSize: "0.95rem"
              }}
            >
              {week.intro}
            </p>
          </header>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {week.entries.map((entry) => (
              <article
                key={entry.title}
                className="card"
                style={{ padding: "1.1rem 1.2rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.8rem",
                    flexWrap: "wrap",
                    marginBottom: "0.4rem"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.35 }}>
                    {entry.title}
                  </h3>
                  <StatusPill status={entry.status} />
                </div>
                <p
                  style={{
                    margin: "0.3rem 0 0.75rem",
                    color: "var(--muted)",
                    lineHeight: 1.55,
                    fontSize: "0.92rem"
                  }}
                >
                  {entry.summary}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.4rem",
                    fontSize: "0.78rem"
                  }}
                >
                  {entry.commits.map((c) => (
                    <a
                      key={c.sha + c.label}
                      href={commitUrl(c.sha)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "0.25rem 0.55rem",
                        borderRadius: "6px",
                        background: "var(--surface-2)",
                        color: "var(--muted)",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        textDecoration: "none",
                        border: "1px solid var(--surface-3)"
                      }}
                    >
                      <span style={{ color: "var(--brand)" }}>{c.sha}</span>{" "}
                      <span>{c.label}</span>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section
        aria-label="Where to go next"
        style={{ marginTop: "1rem" }}
      >
        <div
          className="card-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}
        >
          <article className="card">
            <p className="eyebrow">Forward-looking</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              What's coming next
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The roadmap groups the 31+ designed / planned / future items
              already pilled across the site into Now / Next / Later
              horizons. Each item links back to the page that describes it
              in detail.
            </p>
            <div style={{ marginTop: "0.9rem" }}>
              <a href="/roadmap" className="btn btn-primary">
                Open the roadmap →
              </a>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">Watch the build</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              Subscribe to commits
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The repo is public. Watch it on GitHub to get notified of new
              commits, or subscribe to the planned essays at <a href="/blog" style={{ color: "var(--brand)" }}>/blog</a> for
              the editorial version.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a
                href={GITHUB_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                GitHub →
              </a>
              <a href="/blog" className="btn btn-secondary">
                Editorial →
              </a>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
