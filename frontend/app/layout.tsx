import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { NewsletterForm } from "../components/newsletter-form";
import { NewsletterBanner } from "../components/newsletter-banner";
import { MobileNav } from "../components/mobile-nav";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://pause-health.ai";
const SITE_NAME = "Pause-Health.ai";
const SITE_DESCRIPTION =
  "Premium menopause intelligence for modern provider organizations — explainable AI triage for women in midlife.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: "%s | Pause-Health.ai"
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "menopause",
    "perimenopause",
    "women's health",
    "AI triage",
    "clinical decision support",
    "provider organizations",
    "FemTech",
    "midlife health"
  ],
  authors: [{ name: "Pause-Health.ai" }],
  creator: "Pause-Health.ai",
  publisher: "Pause-Health.ai",
  category: "health",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [
      {
        url: "/brand/pause-health-og.png",
        width: 1200,
        height: 630,
        alt: "Pause-Health.ai — AI triage for providers serving women in midlife."
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/brand/pause-health-og.png"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1
    }
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ff5da8" },
    { media: "(prefers-color-scheme: dark)", color: "#190b16" }
  ]
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NewsletterBanner />
        <header className="site-header">
          <div className="container site-header-row">
            <a href="/" className="site-logo" aria-label="Pause-Health.ai home">
              <Image
                className="site-logo-full"
                src="/brand/pause-health-logo-mono-transparent.png"
                alt="Pause-Health.ai"
                width={220}
                height={64}
                priority
                sizes="220px"
              />
              <span className="site-logo-compact">
                <Image
                  className="site-logo-icon"
                  src="/brand/pause-health-icon-tight.png"
                  alt=""
                  width={48}
                  height={48}
                  priority
                  sizes="48px"
                />
                <span className="site-logo-wordmark">Pause-Health.ai</span>
              </span>
            </a>
            <nav className="site-nav site-nav-desktop" aria-label="Primary">
              <a href="/">Home</a>
              <a href="/about">About</a>
              <a href="/proposal">Investor Brief</a>
              <a href="/demo/intake">Prototype</a>
            </nav>
            <MobileNav />
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container site-footer-grid">
            <div className="site-footer-intro">
              <div className="site-footer-brand">
                <Image
                  src="/brand/pause-health-icon-tight.png"
                  alt="Pause-Health.ai"
                  width={40}
                  height={40}
                  loading="lazy"
                  sizes="40px"
                />
                <div>
                  <p className="site-footer-name">Pause-Health.ai</p>
                  <p className="site-footer-tagline">
                    Premium menopause intelligence for modern provider organizations.
                  </p>
                </div>
              </div>
              <NewsletterForm />
            </div>
            <nav className="site-footer-nav" aria-label="Footer">
              <div>
                <h4>Company</h4>
                <a href="/about">About Us</a>
                <a href="/careers">Careers</a>
                <a href="/press">Press</a>
                <a href="/contact">Contact</a>
              </div>
              <div>
                <h4>Product</h4>
                <a href="/demo/intake">Prototype</a>
                <a href="/proposal">Investor Brief</a>
                <a href="/proposal/full">Full Proposal</a>
              </div>
              <div>
                <h4>Resources</h4>
                <a href="/blog">Blog</a>
                <a href="/research">Clinical Research</a>
                <a href="/security">Security &amp; Compliance</a>
              </div>
              <div>
                <h4>Legal</h4>
                <a href="/privacy">Privacy</a>
                <a href="/terms">Terms</a>
                <a href="/hipaa">HIPAA Notice</a>
              </div>
            </nav>
          </div>
          <div className="container site-footer-bottom">
            <p>&copy; {new Date().getFullYear()} Pause-Health.ai. All rights reserved.</p>
            <p>Built with empathy for women in midlife.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
