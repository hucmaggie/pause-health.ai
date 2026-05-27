/**
 * Canonical site URL for Pause-Health.ai.
 *
 * Used by:
 *   - app/layout.tsx          (metadataBase + root OG)
 *   - lib/page-metadata.ts    (per-page canonical + OG)
 *   - app/sitemap.ts          (absolute sitemap entries)
 *   - app/robots.ts           (sitemap + host)
 *
 * Override per-environment via NEXT_PUBLIC_SITE_URL. The fallback is the
 * production apex so that previews / local dev still emit canonical
 * pause-health.ai URLs in <link rel="canonical">, og:url, twitter:image,
 * and sitemap entries.
 *
 * Note: we deliberately do NOT set Next's `assetPrefix` to this value.
 * `assetPrefix` only affects _next/static asset URLs and would cause
 * preview deployments to load production bundles. Canonical-domain
 * behavior belongs in the metadata layer, not the asset-serving layer.
 */
export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://pause-health.ai";

/**
 * Resolve a possibly-relative URL to an absolute URL on the canonical
 * site. Already-absolute URLs (http://, https://) are returned as-is so
 * callers can pin a specific asset to a CDN if needed.
 */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${SITE_URL}${path}`;
}
