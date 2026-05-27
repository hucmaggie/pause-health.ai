/**
 * Canonical-domain note:
 *
 *   We deliberately do NOT set `assetPrefix` to https://pause-health.ai
 *   here. `assetPrefix` only rewrites the URLs of _next/static/* bundles
 *   (JS chunks, CSS, fonts). Setting it to the production apex would
 *   make Vercel preview deployments load production bundles instead of
 *   the PR's bundles -- silently breaking previews -- and would break
 *   `npm run dev` for anyone who doesn't happen to have pause-health.ai
 *   running locally.
 *
 *   Canonical-domain control for SEO / OpenGraph / Twitter / sitemap /
 *   robots lives in the metadata layer, not the asset-serving layer:
 *
 *     - lib/site.ts          (single source of SITE_URL + absoluteUrl)
 *     - app/layout.tsx       (metadataBase + root OG)
 *     - lib/page-metadata.ts (per-page canonical + absolute OG image)
 *     - app/sitemap.ts       (absolute sitemap entries)
 *     - app/robots.ts        (sitemap URL + host)
 *
 *   Override per-environment with NEXT_PUBLIC_SITE_URL.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/docs/menopause-clinical-decision-support-proposal.html",
        destination: "/proposal/full",
        permanent: true
      },
      {
        source: "/docs/menopause-clinical-decision-support-proposal.md",
        destination: "/proposal/full",
        permanent: true
      }
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions || {}),
        // Keep polling predictable and reduce file-descriptor watcher pressure.
        poll: 3000,
        aggregateTimeout: 300,
        ignored: [
          "**/.git/**",
          "**/.next/**",
          "**/node_modules/**",
          "../venv/**",
          "../.venv/**",
          "../.sfdx/**"
        ]
      };
    }
    return config;
  }
};

export default nextConfig;
