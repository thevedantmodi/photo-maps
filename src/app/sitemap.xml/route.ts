import { getBaseUrl } from '@/lib/baseUrl';
import { getRecentPublishedPhotos } from '@/lib/photos';

export const dynamic = 'force-dynamic';

// The sitemap protocol caps a single file at 50,000 URLs; four slots go to the home, map,
// directory and subscribe pages.
const MAX_PHOTOS = 49_996;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Hand-written rather than app/sitemap.ts: Next emits <image:image> straight after <loc>,
// but the sitemaps.org schema wants extension elements after <priority>, so its output
// fails strict validation.
function url(loc: string, lastmod: string | null, changefreq: string, priority: string, image?: string) {
  return [
    '<url>',
    `<loc>${escapeXml(loc)}</loc>`,
    lastmod ? `<lastmod>${lastmod}</lastmod>` : '',
    `<changefreq>${changefreq}</changefreq>`,
    `<priority>${priority}</priority>`,
    image ? `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>` : '',
    '</url>',
  ].join('');
}

export async function GET(req: Request) {
  const base = await getBaseUrl(req.headers);
  // Let a DB failure surface as a 500 rather than a sitemap with only the home page in it,
  // which a crawler would read as every photo page having gone away.
  const photos = await getRecentPublishedPhotos(MAX_PHOTOS);

  const entries = [
    // No trailing slash: matches the canonical Next renders for "/".
    url(base, photos[0]?.created_at ?? null, 'weekly', '1.0'),
    url(`${base}/map`, photos[0]?.created_at ?? null, 'weekly', '0.9'),
    url(`${base}/directory`, photos[0]?.created_at ?? null, 'weekly', '0.8'),
    url(`${base}/subscribe`, null, 'yearly', '0.5'),
    ...photos.map((photo) =>
      url(
        `${base}/p/${encodeURIComponent(photo.friendly_name)}`,
        photo.created_at,
        'yearly',
        '0.7',
        photo.large_url
      )
    ),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' +
    entries.join('') +
    '</urlset>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
