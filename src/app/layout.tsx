import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist } from "next/font/google";
import "./globals.css";

// Fallback face for devices without Helvetica Neue; see --font-sans in globals.css.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Photos by Vedant Modi",
  description: "Photographs, mapped.",
  alternates: {
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: "Photos by Vedant Modi" }],
    },
  },
};

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={geistSans.variable}>
        {children}
        <div className="lights" aria-hidden="true" />
        <Analytics />
      </body>
    </html>
  );
}
