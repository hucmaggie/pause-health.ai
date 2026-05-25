/** @type {import('next').NextConfig} */
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
