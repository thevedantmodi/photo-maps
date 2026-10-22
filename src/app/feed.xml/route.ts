import { photoAlt, photoTitle } from '@/lib/alt';
import { getBaseUrl } from '@/lib/baseUrl';
import { getRecentPublishedPhotos } from '@/lib/photos';

export const dynamic = 'force-dynamic';

const FEED_TITLE = 'Photos by Vedant Modi';
const FEED_DESCRIPTION = 'Photos! Mapped!';
const ITEM_LIMIT = 50;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function GET(req: Request) {
  const base = await getBaseUrl(req.headers);
  // Let a DB failure surface as a 500 rather than an empty feed: readers treat an empty
  // feed as "nothing new" and a cached one would hide photos until it expires.
  const photos = await getRecentPublishedPhotos(ITEM_LIMIT);

  const items = photos.map((photo) => {
    const title = photoTitle(photo);
    const link = `${base}/p/${encodeURIComponent(photo.friendly_name)}`;
    const taken = formatDate(photo.date);
    // created_at is when the photo was uploaded and published, which is what "new" means
    // to a subscriber; the date taken goes in the body instead.
    const pubDate = photo.created_at ? new Date(photo.created_at).toUTCString() : null;
    const body =
      `<p><a href="${escapeXml(link)}"><img src="${escapeXml(photo.thumb_url)}" alt="${escapeXml(photoAlt(photo))}" /></a></p>` +
      `<p>${escapeXml(title)}</p>` +
      (taken ? `<p>${escapeXml(taken)}</p>` : '');

    return [
      '<item>',
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid isPermaLink="false">${escapeXml(photo.id)}</guid>`,
      pubDate ? `<pubDate>${pubDate}</pubDate>` : '',
      `<description>${escapeXml(body)}</description>`,
      `<media:thumbnail url="${escapeXml(photo.thumb_url)}" />`,
      '</item>',
    ].join('');
  });

  const lastBuild = photos[0]?.created_at
    ? new Date(photos[0].created_at).toUTCString()
    : new Date().toUTCString();

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">' +
    '<channel>' +
    `<title>${escapeXml(FEED_TITLE)}</title>` +
    `<link>${escapeXml(base)}/</link>` +
    `<description>${escapeXml(FEED_DESCRIPTION)}</description>` +
    '<language>en-us</language>' +
    `<lastBuildDate>${lastBuild}</lastBuildDate>` +
    `<atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml" />` +
    items.join('') +
    '</channel></rss>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
