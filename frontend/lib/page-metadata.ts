import type { Metadata } from "next";

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
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      type: "website",
      images: [
        {
          url: ogImage,
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
      images: [ogImage]
    }
  };
}
