import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://pause-health.ai";

const STATIC_PATHS: { path: string; priority: number; changeFrequency: "yearly" | "monthly" | "weekly" }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/about", priority: 0.8, changeFrequency: "monthly" },
  { path: "/proposal", priority: 0.8, changeFrequency: "monthly" },
  { path: "/proposal/full", priority: 0.75, changeFrequency: "monthly" },
  { path: "/proposal/customers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/insights", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/data", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/competition", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/strategy", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/technology", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/integration", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/dbdp", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/menopause-society", priority: 0.7, changeFrequency: "monthly" },
  { path: "/proposal/provider-graph", priority: 0.7, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.7, changeFrequency: "monthly" },
  { path: "/careers", priority: 0.7, changeFrequency: "weekly" },
  { path: "/press", priority: 0.4, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/research", priority: 0.6, changeFrequency: "monthly" },
  { path: "/security", priority: 0.5, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/hipaa", priority: 0.3, changeFrequency: "yearly" },
  { path: "/demo/intake", priority: 0.6, changeFrequency: "monthly" },
  { path: "/demo/patient", priority: 0.6, changeFrequency: "monthly" },
  { path: "/demo/routing", priority: 0.6, changeFrequency: "monthly" },
  { path: "/demo/analytics", priority: 0.6, changeFrequency: "monthly" }
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return STATIC_PATHS.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority
  }));
}
