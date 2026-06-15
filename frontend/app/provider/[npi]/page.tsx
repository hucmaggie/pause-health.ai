import { notFound } from "next/navigation";

import { pageMetadata } from "../../../lib/page-metadata";
import {
  findProviderByNpi,
  normalizeInsurancePlan,
  type ProviderRecord
} from "../../../lib/mulesoft-mocks";
import { lookupZipCentroid } from "../../../lib/zip-centroids";

/**
 * Per-provider profile page.
 *
 * `/provider/<npi>` resolves a single ProviderRecord from the same directory
 * the agent and Care Router consume — the NPPES-derived generated JSON when
 * present, the curated fallback otherwise. The page is the patient-facing
 * surface for everything Phase 2 added: certification status, distance from
 * a `?from=<zip>` query param, board-certification + service-line signals,
 * accepted plans, license disposition. Surviving providers always carry
 * `licenseStatus: "active"` because sanctioned candidates are filtered at
 * build time — that's surfaced explicitly on the card so the patient and
 * agent both see the safety filter applied.
 *
 * Server component: data is loaded synchronously from the in-process
 * directory at request time. `?from=<zip>` is honored when supplied so the
 * "X miles away" line resolves the same way `queryProviderDirectory` does
 * (Census 2020 ZCTA centroid → Haversine), but the field is optional —
 * leave it off and the page just doesn't show distance.
 */

export async function generateMetadata({
  params
}: {
  params: Promise<{ npi: string }>;
}) {
  const { npi } = await params;
  const provider = findProviderByNpi(npi);
  if (!provider) {
    return pageMetadata({
      title: "Provider not found",
      description: "No provider matched this NPI in the Pause directory.",
      path: `/provider/${npi}`
    });
  }
  return pageMetadata({
    title: provider.name,
    description: `${provider.specialty} in ${provider.city}, ${provider.state}. ${
      provider.menopauseCertified
        ? "MSCP-credentialed menopause specialist."
        : "Menopause-relevant clinician."
    }`,
    path: `/provider/${npi}`
  });
}

// Plain-English labels for the public-registry signal tokens. Same fallback
// as the dashboard card: unknown tokens render as their raw lowercase value.
const SIGNAL_LABELS: Record<string, string> = {
  facog: "Board-certified OB/GYN",
  faafp: "Board-certified family medicine",
  face: "Board-certified endocrinology",
  facp: "Board-certified internal medicine",
  whnp: "Women's Health Nurse Practitioner",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty practice"
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

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function distanceFromQuery(
  provider: ProviderRecord,
  fromZip: string | undefined
): number | null {
  if (!fromZip) return null;
  const patient = lookupZipCentroid(fromZip);
  if (!patient) return null;
  if (provider.latitude == null || provider.longitude == null) return null;
  return haversineMiles(
    patient.latitude,
    patient.longitude,
    provider.latitude,
    provider.longitude
  );
}

export default async function ProviderProfilePage({
  params,
  searchParams
}: {
  params: Promise<{ npi: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { npi } = await params;
  const sp = await searchParams;
  const provider = findProviderByNpi(npi);
  if (!provider) {
    notFound();
  }

  const fromRaw = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const fromZip = fromRaw && /^\d{3,5}$/.test(fromRaw) ? fromRaw : undefined;
  const distanceMiles = distanceFromQuery(provider, fromZip);

  const signals = provider.serviceSignals ?? [];
  const plans = provider.insuranceAccepted ?? [];
  const licenseStatus = provider.licenseStatus ?? "active";

  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Provider Profile</p>
        <h1 style={{ marginBottom: "0.4rem" }}>{provider.name}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "0.8rem" }}>
          {provider.specialty} · {provider.city}, {provider.state} {provider.zip}
        </p>
        <div
          style={{
            display: "inline-flex",
            gap: "0.4rem",
            flexWrap: "wrap",
            marginBottom: "0.6rem"
          }}
        >
          {provider.menopauseCertified ? (
            <span className="profile-chip profile-chip-strong">
              Menopause Society Certified Practitioner
            </span>
          ) : (
            <span className="profile-chip">Menopause-relevant clinician</span>
          )}
          {provider.acceptingNewPatients ? (
            <span className="profile-chip profile-chip-good">Accepting new patients</span>
          ) : (
            <span className="profile-chip profile-chip-muted">Not accepting new patients</span>
          )}
          {provider.telehealth ? (
            <span className="profile-chip profile-chip-good">Telehealth available</span>
          ) : null}
          {distanceMiles !== null ? (
            <span className="profile-chip profile-chip-good">
              {distanceMiles} mi from {fromZip}
            </span>
          ) : null}
          <span
            className={
              licenseStatus === "active"
                ? "profile-chip profile-chip-good"
                : "profile-chip profile-chip-warn"
            }
          >
            License: {licenseStatus}
          </span>
        </div>
      </section>

      {signals.length > 0 ? (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <p className="eyebrow">Service-line signals</p>
          <p style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>
            Public-registry signals from NPPES that strengthen the case for this
            provider — board certifications and multi-specialty practice tokens
            detected directly in the credential text and taxonomy stack. Empty
            list means none matched.
          </p>
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              padding: 0,
              listStyle: "none",
              marginTop: "0.6rem"
            }}
          >
            {signals.map((s) => (
              <li key={s} className="profile-chip profile-chip-strong">
                {SIGNAL_LABELS[s] ?? s}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plans.length > 0 ? (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <p className="eyebrow">Insurance accepted</p>
          <p style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>
            <strong>Synthetic — verify before booking.</strong> No public payer
            feed exists; Pause derives a per-NPI plan list deterministically
            (calibrated to plausible real-world participation rates). Treat the
            chips as a soft filter, not a guarantee. Replacing the synthesis
            with a partner feed (e.g. Ribbon Health) is a one-module swap.
          </p>
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              padding: 0,
              listStyle: "none",
              marginTop: "0.6rem"
            }}
          >
            {plans.map((p) => (
              <li key={p} className="profile-chip">
                {PLAN_LABELS[p] ?? p}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Provenance</p>
        <ul style={{ marginTop: "0.4rem", paddingLeft: "1.1rem", color: "var(--muted)" }}>
          <li>NPI: <code>{provider.npi}</code></li>
          <li>
            Source: CMS NPPES, taxonomy-filtered by{" "}
            <code>provider_ingest</code>; menopauseCertified resolved against
            the licensed/synthetic MSCP overlay plus self-reported MSCP/NCMP in
            NPPES.
          </li>
          <li>
            License disposition checked against CA Medi-Cal Suspended &amp;
            Ineligible (NPI-keyed), NY Professional Medical Conduct Board
            Actions (license-keyed), and Texas Medical Board All-Licenses
            (license-keyed, active-disposition allowlist) — sanctioned
            candidates are dropped at build time, so survivors carry
            licenseStatus = active.
          </li>
          <li>
            graphScore: {provider.graphScore.toFixed(2)} — in [0, 1]; combines
            taxonomy relevance, accepting-new-patients, telehealth,
            location-completeness, MSCP boost, and a capped service-signal
            bonus.
          </li>
          <li>
            Distance is computed from the Census 2020 ZCTA centroid for the
            patient&apos;s ZIP (passed via <code>?from=&lt;zip&gt;</code>) and
            the provider&apos;s practice ZIP, via Haversine (rounded to 0.1
            mi).
          </li>
        </ul>
      </section>

      <p style={{ marginTop: "1.5rem" }}>
        <a href="/demo/intake" className="btn btn-secondary">
          ← Back to demo intake
        </a>
      </p>
    </main>
  );
}

// Server-rendered on demand: the page reads `?from=<zip>` to resolve the
// patient ZIP centroid + Haversine distance, which means we can't pre-render
// (force-static would silently treat searchParams as undefined and the
// distance line would never appear on the static output).
export const dynamic = "force-dynamic";
