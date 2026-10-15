import type { MetadataRoute } from 'next';

import { getBaseUrl } from '@/lib/baseUrl';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getBaseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/api/share/'],
      // /api/share/ stays crawlable: it serves og:image, and Twitterbot honours robots.txt
      // when fetching cards. /subscribe/confirm is left out so crawlers can see its noindex.
      disallow: ['/admin', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
