/**
 * Shared presentational list of MSCP provider recommendations.
 *
 * Used by both the live "latest Care Router decision" card and the scripted
 * intake fallback so the two surfaces render the provider graph's output
 * identically. Pure (no hooks/handlers), so it is safe in either a server or
 * client tree. When `fromZip` is supplied, profile links carry `?from=<zip>`
 * so the /provider/<npi> page can show the distance-from-your-ZIP chip.
 */

export type RecommendedProviderEntry = {
  npi?: string;
  name: string;
  specialty?: string;
  city?: string;
  state?: string;
  telehealth?: boolean;
  distanceMiles?: number | null;
  serviceSignals?: string[];
  insuranceAccepted?: string[];
};

// Plain-English labels for the public-registry signal tokens. Anything not in
// this map renders as the raw token in lowercase — fine, since the agent and
// the UI both prefer the human label when one exists.
const SIGNAL_LABELS: Record<string, string> = {
  facog: "Board-cert OB/GYN",
  faafp: "Board-cert family med",
  face: "Board-cert endocrinology",
  facp: "Board-cert internal med",
  whnp: "Women's Health NP",
  cnm: "Certified Nurse-Midwife",
  "multi-taxonomy": "Multi-specialty"
};

// Plain-English labels for the canonical insurance tokens. Same fallback rule
// as SIGNAL_LABELS: unknown plans render as their raw lowercase token, which
// is the honest answer for a real-but-unrecognized payer.
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

function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return source === "live"
    ? " (live MuleSoft directory)"
    : " (NPPES-derived directory)";
}

export function RecommendedProviders({
  providers,
  source,
  fromZip,
  heading = "Provider graph · MSCP recommendations"
}: {
  providers: RecommendedProviderEntry[];
  source?: string | null;
  fromZip?: string | null;
  heading?: string;
}) {
  if (providers.length === 0) return null;

  const profileHref = (npi: string) =>
    fromZip
      ? `/provider/${encodeURIComponent(npi)}?from=${encodeURIComponent(fromZip)}`
      : `/provider/${encodeURIComponent(npi)}`;

  return (
    <div
      style={{
        marginTop: "0.6rem",
        paddingTop: "0.6rem",
        borderTop: "1px solid var(--border, rgba(0,0,0,0.08))"
      }}
    >
      <p
        style={{
          color: "var(--brand)",
          fontWeight: 600,
          fontSize: "0.8rem",
          marginBottom: "0.3rem"
        }}
      >
        {heading}
        {sourceLabel(source)}
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
        {providers.map((p) => {
          const meta: string[] = [];
          if (p.city && p.state) meta.push(`${p.city}, ${p.state}`);
          if (typeof p.distanceMiles === "number") {
            const miles = Math.round(p.distanceMiles * 10) / 10;
            meta.push(`${miles} mi away`);
          }
          if (p.telehealth) meta.push("telehealth");
          const signals = p.serviceSignals ?? [];
          const plans = p.insuranceAccepted ?? [];
          // Cap plan chips at 4 so a row doesn't run away with chips when a
          // provider accepts every plan; "+N more" tells the truth.
          const planChipsShown = plans.slice(0, 4);
          const planOverflow = Math.max(0, plans.length - planChipsShown.length);
          const nameLabel = p.specialty ? `${p.name} · ${p.specialty}` : p.name;
          return (
            <li
              key={`${p.npi ?? p.name}-${p.city ?? ""}`}
              style={{ marginBottom: "0.25rem" }}
            >
              {p.npi ? (
                <a href={profileHref(p.npi)}>{nameLabel}</a>
              ) : (
                nameLabel
              )}
              {meta.length > 0 ? (
                <span style={{ color: "var(--muted)", marginLeft: "0.4rem" }}>
                  ({meta.join(" · ")})
                </span>
              ) : null}
              {signals.length > 0 ? (
                <span
                  style={{
                    marginLeft: "0.4rem",
                    display: "inline-flex",
                    gap: "0.3rem",
                    flexWrap: "wrap"
                  }}
                >
                  {signals.map((s) => (
                    <span
                      key={s}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.05rem 0.4rem",
                        borderRadius: "999px",
                        background: "rgba(0, 122, 158, 0.08)",
                        color: "var(--brand)",
                        border: "1px solid rgba(0, 122, 158, 0.2)"
                      }}
                    >
                      {SIGNAL_LABELS[s] ?? s}
                    </span>
                  ))}
                </span>
              ) : null}
              {plans.length > 0 ? (
                <span
                  style={{
                    marginLeft: "0.4rem",
                    display: "inline-flex",
                    gap: "0.3rem",
                    flexWrap: "wrap"
                  }}
                >
                  {planChipsShown.map((plan) => (
                    <span
                      key={plan}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.05rem 0.4rem",
                        borderRadius: "999px",
                        background: "rgba(120, 120, 120, 0.08)",
                        color: "var(--muted)",
                        border: "1px solid rgba(120, 120, 120, 0.2)"
                      }}
                    >
                      {PLAN_LABELS[plan] ?? plan}
                    </span>
                  ))}
                  {planOverflow > 0 ? (
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                      +{planOverflow} more
                    </span>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
