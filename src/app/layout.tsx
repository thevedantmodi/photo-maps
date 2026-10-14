import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import { getBaseUrl } from "@/lib/baseUrl";
import { AUTHOR, RSS_ALTERNATE, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await getBaseUrl()),
    title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    authors: [{ name: AUTHOR }],
    alternates: { types: RSS_ALTERNATE },
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
