import type { Metadata } from "next";
import { absoluteUrl } from "./site";

type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogImageAlt?: string;
};

export function pageMetadata({
  title,
  description,
  path,
  ogImage = "/brand/pause-health-og.png",
  ogImageAlt
}: PageMetaInput): Metadata {
  const fullTitle = `${title} | Pause-Health.ai`;
  const altText = ogImageAlt ?? `${title} — Pause-Health.ai`;

  // Pin OG / Twitter images to the canonical site URL so cards rendered
  // by Twitter/LinkedIn/Slack from a preview URL still fetch the image
  // from pause-health.ai. (Without this, Next 14 resolves relative
  // image URLs against the request origin, not metadataBase.)
  const ogImageAbsolute = absoluteUrl(ogImage);

  return {
    title,
    description,
    // alternates.canonical and openGraph.url remain RELATIVE on purpose;
    // Next resolves them against the root metadataBase (= SITE_URL) so
    // they end up as https://pause-health.ai/<path>.
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      type: "website",
      images: [
        {
          url: ogImageAbsolute,
          width: 1200,
          height: 630,
          alt: altText
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImageAbsolute]
    }
  };
}
