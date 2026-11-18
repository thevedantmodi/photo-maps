import { after } from 'next/server';

import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import { getPublicUrl } from '@/lib/r2';
import { renderShareCardPng } from '@/lib/shareCard';
import { generateAndStoreShareCard, shareCardKey } from '@/lib/shareCardStore';
import { shareVersion, type CardTheme } from '@/lib/shareVersion';

// sharp and font reads both need Node (used by the live-render fallback).
export const runtime = 'nodejs';
export const maxDuration = 30;

const CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';
const SHORT_CACHE_CONTROL = 'public, s-maxage=60';

// Slugs whose cards this instance is already storing, so a burst of requests for a
// stale card stores it once.
const storing = new Set<string>();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // ?theme=light|dark — the Share button asks for the one matching the screen. Anything
  // else (old links, link-preview crawlers) gets the dark card.
  const search = new URL(req.url).searchParams;
  const theme: CardTheme = search.get('theme') === 'light' ? 'light' : 'dark';
  const base = await getBaseUrl(req.headers);
  const photo = await getPhotoBySlug(slug);
  if (!photo) return new Response('Not found', { status: 404 });

  const version = shareVersion(photo);
  // Only a URL carrying the current version may sit in the CDN for a day: it can never
  // show anything else. Anything else (no ?v=, an old one) is re-checked within a minute,
  // so an edit shows up there too instead of the CDN holding the old card for a day.
  const cacheControl = search.get('v') === version ? CACHE_CONTROL : SHORT_CACHE_CONTROL;

  // Precomputed and still current: proxy the stored PNG rather than paying satori's ~2.6s
  // render again. Proxied (not redirected) so link-preview crawlers that don't follow
  // redirects on og:image still get bytes directly at this URL.
  if (photo.share_card_version === version) {
    // The R2 key is the same for every version of a photo's card, so the public bucket's
    // own cache could still hold the last one: the version in the query keeps it apart.
    const stored = await fetch(`${getPublicUrl(shareCardKey(slug, theme))}?v=${version}`, { cache: 'no-store' });
    if (stored.ok) {
      return new Response(stored.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl },
      });
    }
    // Version matched but the object is missing (deleted out-of-band, etc.) — fall through.
  }

  // The stored cards are missing or stale (a new card design, or an edit whose
  // regeneration failed). Store fresh ones once this response is sent, so the next
  // request is a quick proxy instead of another live render: a share that waits on a
  // render outlasts the tap that asked for it, and the phone wants a second tap.
  if (!storing.has(slug)) {
    storing.add(slug);
    after(() => generateAndStoreShareCard(photo, base).finally(() => storing.delete(slug)));
  }

  try {
    const png = await renderShareCardPng(photo, base, theme);
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl },
    });
  } catch (e) {
    console.error('[share] live render failed', slug, e);
    return new Response('Photo unavailable', { status: 502 });
  }
}
