import { pageMetadata } from "../../lib/page-metadata";
import {
  queryProviderDirectory,
  type ProviderRecord,
  type ProviderRecordRanked
} from "../../lib/mulesoft-mocks";
import { lookupZipCentroid } from "../../lib/zip-centroids";

/**
 * /provider — browseable directory index.
 *
 * Server-rendered list backed by the same `queryProviderDirectory` the
 * agent and Care Router consume. Filters submit via a `<form method="GET">`
 * so the URL is the source of truth (bookmarkable, refresh-safe, no
 * client state). Each row links to /provider/<npi>?from=<zip> so the
 * patient ZIP rides through to the profile's distance chip.
 *
 * Filter inputs:
 *   ?zip=         — ZIP code, 3–5 digits. Matches the directory's 3-prefix.
 *   ?from=        — patient ZIP for distance ranking; falls back to ?zip
 *                   when omitted so a single field can drive both.
 *   ?menopause=   — "true" narrows to MSCP-certified providers.
 *   ?fallback=    — "true" opens the relevant-local / certified-remote
 *                   fallback ladder when the strict tier is empty.
 *   ?plan=        — insurance plan token (medicare/aetna/bcbs/etc.).
 *   ?limit=       — page size; default 20, capped at 50 to keep the
 *                   server response under a few hundred KB.
 *
 * The same renderer handles the empty case (zero results) and the no-
 * filters case (defaults: certified-only, no zip → certified-national
 * tier). A "How this list ranks" footnote next to the result count
 * surfaces the response's `sort` and `matchType` so a reader can see
 * which tier and ranking actually applied.
 */

export const metadata = pageMetadata({
  title: "Find a provider",
  description:
    "Browse the Pause provider directory: menopause-certified specialists, distance ranking, board certifications, accepted plans. Filter by ZIP and insurance.",
  path: "/provider",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt:
    "Find a menopause-certified provider — Pause-Health.ai directory."
});

const SIGNAL_LABELS: Record<string, string> = {
  facog: "Board-cert OB/GYN",
  faafp: "Board-cert family med",
  face: "Board-cert endocrinology",
  facp: "Board-cert internal med",
  whnp: "Women's Health NP",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty"
};

const PLAN_LABELS: Record<string, string> = {
  medicare: "Medicare",
  medicaid: "Medicaid",
  aetna: "Aetna",
  bcbs: "BCBS",
  uhc: "UHC",
  cigna: "Cigna",
  humana: "Humana",
  kaiser: "Kaiser"
};
const PLAN_OPTIONS = Object.entries(PLAN_LABELS);

const MATCH_TYPE_NOTES: Record<string, string> = {
  "certified-local":
    "Menopause-certified providers within your ZIP-3 area.",
  "relevant-local":
    "No certified provider in your area, so showing nearby menopause-experienced (non-certified) clinicians.",
  "certified-remote":
    "No local match — showing telehealth-capable certified specialists nationally.",
  "certified-national": "Menopause-certified providers nationally.",
  local: "All menopause-relevant providers within your ZIP-3 area.",
  all: "All menopause-relevant providers, no ZIP filter applied.",
  none: "No providers matched your filters."
};

function param(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = searchParams[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function chip(label: string, kind: "good" | "muted" | "strong" | "warn" | null = null) {
  const cls =
    kind === null ? "profile-chip" : `profile-chip profile-chip-${kind}`;
  return (
    <span key={label} className={cls}>
      {label}
    </span>
  );
}

function renderProviderCard(
  p: ProviderRecordRanked,
  fromZip: string | undefined
) {
  const meta: string[] = [];
  if (p.city && p.state) meta.push(`${p.city}, ${p.state} ${p.zip}`);
  if (typeof p.distanceMiles === "number") {
    meta.push(`${Math.round(p.distanceMiles * 10) / 10} mi away`);
  }
  if (p.telehealth) meta.push("telehealth");

  const profileHref = fromZip
    ? `/provider/${encodeURIComponent(p.npi)}?from=${encodeURIComponent(fromZip)}`
    : `/provider/${encodeURIComponent(p.npi)}`;

  const signals = p.serviceSignals ?? [];
  const plans = p.insuranceAccepted ?? [];
  const planChipsShown = plans.slice(0, 4);
  const planOverflow = Math.max(0, plans.length - planChipsShown.length);

  return (
    <article key={p.npi} className="card provider-card">
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
            <a href={profileHref}>{p.name}</a>
          </h3>
          <p style={{ margin: "0.15rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
            {p.specialty}
            {meta.length > 0 ? ` · ${meta.join(" · ")}` : null}
          </p>
        </div>
        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "flex-start" }}>
          {p.menopauseCertified
            ? chip("MSCP-certified", "strong")
            : chip("Menopause-relevant")}
          {p.acceptingNewPatients ? chip("New patients", "good") : chip("Closed", "muted")}
        </div>
      </header>

      {(signals.length > 0 || plans.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" }}>
          {signals.map((s) =>
            chip(SIGNAL_LABELS[s] ?? s, "strong")
          )}
          {planChipsShown.map((pl) => chip(PLAN_LABELS[pl] ?? pl, null))}
          {planOverflow > 0 ? (
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", alignSelf: "center" }}>
              +{planOverflow} more
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

export default async function ProviderIndexPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const zipRaw = param(sp, "zip")?.trim();
  const zip = zipRaw && /^\d{3,5}$/.test(zipRaw) ? zipRaw : undefined;

  // ?from defaults to ?zip so the form has one field driving both filter
  // narrowing and distance ranking. A user typing "92614" gets results
  // narrowed to 926* AND ranked by distance from the 92614 centroid.
  const fromRaw = (param(sp, "from") ?? zip)?.trim();
  const fromZip = fromRaw && /^\d{3,5}$/.test(fromRaw) ? fromRaw : undefined;
  const zipCentroid = fromZip ? lookupZipCentroid(fromZip) : null;

  const menopauseOnly = param(sp, "menopause") === "true";
  const fallback = param(sp, "fallback") !== "false"; // default ON for browse
  const plan = param(sp, "plan")?.trim() || undefined;

  const limitRaw = Number(param(sp, "limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(50, Math.floor(limitRaw))
    : 20;

  const result = queryProviderDirectory({
    zip,
    menopauseOnly,
    fallback,
    insurance: plan,
    zipCentroid,
    limit
  });

  const sortLabel =
    result.sort === "distance"
      ? "ranked by distance from your ZIP"
      : "ranked by graph score";

  const matchNote = MATCH_TYPE_NOTES[result.matchType] ?? "";

  return (
    <main className="container" style={{ paddingTop: "2.4rem", paddingBottom: "3rem", maxWidth: "60rem" }}>
      <section className="hero">
        <p className="eyebrow">Find a provider</p>
        <h1 style={{ marginBottom: "0.4rem" }}>Pause provider directory</h1>
        <p style={{ color: "var(--muted)", maxWidth: "50ch" }}>
          A defensible synthesis of CMS NPPES, self-reported MSCP/NCMP
          credentials, board-certification signals, and state license-
          verification overlays (CA / NY / TX). Sanctioned providers are
          filtered at build time. Insurance acceptance is synthetically
          derived per-NPI today — the chips are a soft filter, not a
          guarantee.
        </p>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Filters</p>
        <form method="GET" className="contact-form provider-filter-form">
          <div className="contact-form-row">
            <label>
              ZIP (your ZIP, 5 digits)
              <input
                type="text"
                name="zip"
                inputMode="numeric"
                pattern="[0-9]{3,5}"
                placeholder="92614"
                defaultValue={zip ?? ""}
                aria-label="Patient ZIP code"
              />
            </label>
            <label>
              Insurance
              <select name="plan" defaultValue={plan ?? ""}>
                <option value="">Any plan</option>
                {PLAN_OPTIONS.map(([token, label]) => (
                  <option key={token} value={token}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="contact-form-row">
            <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" name="menopause" value="true" defaultChecked={menopauseOnly} />
              <span style={{ fontSize: "0.85rem" }}>
                Only MSCP-certified providers
              </span>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" name="fallback" value="true" defaultChecked={fallback} />
              <span style={{ fontSize: "0.85rem" }}>
                Include nearby/relevant providers if no certified-local match
              </span>
            </label>
          </div>
          <div className="contact-form-actions">
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            {(zip || plan || menopauseOnly) && (
              <a className="btn btn-secondary" href="/provider">
                Reset
              </a>
            )}
          </div>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.8rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            {result.total === 0
              ? "No providers match"
              : `${result.returned} of ${result.total} providers`}
          </p>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.82rem" }}>
            {sortLabel}
            {result.matchType !== "none" ? ` · matchType: ${result.matchType}` : ""}
          </p>
        </header>
        {matchNote ? (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.8rem" }}>
            {matchNote}
          </p>
        ) : null}
        {result.providers.length === 0 ? (
          <p>
            Try widening the search:{" "}
            <a href="/provider?menopause=true&fallback=true">all certified providers nationally</a>{" "}
            ·{" "}
            <a href="/provider?fallback=true">all providers</a>.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {result.providers.map((p: ProviderRecord & { distanceMiles?: number | null }) =>
              renderProviderCard(p as ProviderRecordRanked, fromZip)
            )}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Provenance</p>
        <ul style={{ marginTop: "0.4rem", paddingLeft: "1.1rem", color: "var(--muted)" }}>
          {result.provenance.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
          <li>
            Experience API: <code>{result.provenance.experienceApi}</code>
          </li>
          {result.provenance.dataset?.generatedAt ? (
            <li>
              Directory generated: <code>{result.provenance.dataset.generatedAt}</code>
            </li>
          ) : null}
          {result.provenance.dataset?.sanctionedFiltered ? (
            <li>
              Sanctioned providers filtered this build:{" "}
              <strong>{result.provenance.dataset.sanctionedFiltered}</strong>
              {Object.entries(result.provenance.dataset.sanctionedFilteredBySource ?? {}).length > 0
                ? ` (${Object.entries(result.provenance.dataset.sanctionedFilteredBySource ?? {})
                    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
                    .join(", ")})`
                : ""}
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}

// Server-rendered on demand: we read searchParams to drive filters. With
// force-static Next would treat them as undefined and the form wouldn't
// work on prerendered output.
export const dynamic = "force-dynamic";
