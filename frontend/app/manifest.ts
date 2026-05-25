import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pause-Health.ai",
    short_name: "Pause-Health",
    description:
      "Premium menopause intelligence for modern provider organizations — explainable AI triage for women in midlife.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#190b16",
    theme_color: "#ff5da8",
    categories: ["health", "medical", "productivity"],
    icons: [
      {
        src: "/brand/pause-health-icon-tight.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/brand/pause-health-icon-tight.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/brand/pause-health-apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
