import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist } from "next/font/google";
import { getBaseUrl } from "@/lib/baseUrl";
import { AUTHOR, RSS_ALTERNATE, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import ServiceWorker from "./components/ServiceWorker";
import "./globals.css";

// Fallback face for devices without Helvetica Neue; see --font-sans in globals.css.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await getBaseUrl()),
    title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    authors: [{ name: AUTHOR }],
    alternates: { types: RSS_ALTERNATE },
    applicationName: SITE_NAME,
    appleWebApp: { capable: true, title: 'Photo Maps', statusBarStyle: 'default' },
    icons: { apple: '/icons/apple-touch-icon.png' },
    openGraph: {
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary',
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ededeb" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1c" },
  ],
};

// Runs before first paint so the page never flashes the wrong theme. A choice made with
// the Light | Dark switch sticks; otherwise the system setting decides.
const THEME_INIT = `(function(){try{var m=localStorage.getItem('theme-manual')==='1';var s=localStorage.getItem('theme');var t=m&&(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The Geist variable sits on <html>, where --font-sans (globals.css) reads it.
    <html lang="en" className={geistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Without JavaScript nothing scrolls into view, so show everything as is. */}
        <noscript>
          <style>{`.reveal,.dir-row{opacity:1!important;transform:none!important;clip-path:none!important}.dir-item::after{transform:none!important}.reveal>*{clip-path:none!important}`}</style>
        </noscript>
      </head>
      <body>
        {children}
        <div className="lights" aria-hidden="true" />
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
