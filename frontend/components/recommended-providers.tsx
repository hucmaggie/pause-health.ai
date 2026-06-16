/**
 * Shared presentational list of MSCP provider recommendations.
 *
 * Used by both the live "latest Care Router decision" card and the scripted
 * intake fallback so the two surfaces render the provider graph's output
 * identically. Pure (no hooks/handlers), so it is safe in either a server or
 * client tree. When `fromZip` is supplied, profile links carry `?from=<zip>`
 * so the /provider/<npi> page can show the distance-from-your-ZIP chip.
 */

import { planLabel, signalLabel } from "../lib/provider-labels";

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

function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return source === "live"
    ? " (live MuleSoft directory)"
    : " (NPPES-derived directory)";
}

/** Profile link, carrying `?from=<zip>` so the profile shows the distance chip. */
export function recommendedProfileHref(
  npi: string,
  fromZip?: string | null
): string {
  return fromZip
    ? `/provider/${encodeURIComponent(npi)}?from=${encodeURIComponent(fromZip)}`
    : `/provider/${encodeURIComponent(npi)}`;
}

/** Inline "(city, ST · N mi away · telehealth)" parts, omitting absent fields. */
export function recommendedMetaParts(p: RecommendedProviderEntry): string[] {
  const meta: string[] = [];
  if (p.city && p.state) meta.push(`${p.city}, ${p.state}`);
  if (typeof p.distanceMiles === "number") {
    // Source is already 0.1-mi precision; a single decimal reads cleaner inline.
    const miles = Math.round(p.distanceMiles * 10) / 10;
    meta.push(`${miles} mi away`);
  }
  if (p.telehealth) meta.push("telehealth");
  return meta;
}

/** Cap plan chips so a row can't run away; the remainder becomes "+N more". */
export function recommendedPlanChips(
  plans: string[] | undefined,
  max = 4
): { shown: string[]; overflow: number } {
  const list = plans ?? [];
  const shown = list.slice(0, max);
  return { shown, overflow: Math.max(0, list.length - shown.length) };
}

/** Human label for a service-line signal token (raw token if unknown). */
export function recommendedSignalLabel(token: string): string {
  return signalLabel(token);
}

/** Human label for an insurance-plan token (raw token if unknown). */
export function recommendedPlanLabel(token: string): string {
  return planLabel(token);
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
          const meta = recommendedMetaParts(p);
          const signals = p.serviceSignals ?? [];
          const { shown: planChipsShown, overflow: planOverflow } =
            recommendedPlanChips(p.insuranceAccepted);
          const nameLabel = p.specialty ? `${p.name} · ${p.specialty}` : p.name;
          return (
            <li
              key={`${p.npi ?? p.name}-${p.city ?? ""}`}
              style={{ marginBottom: "0.25rem" }}
            >
              {p.npi ? (
                <a href={recommendedProfileHref(p.npi, fromZip)}>{nameLabel}</a>
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
                      {recommendedSignalLabel(s)}
                    </span>
                  ))}
                </span>
              ) : null}
              {planChipsShown.length > 0 ? (
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
                      {recommendedPlanLabel(plan)}
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
