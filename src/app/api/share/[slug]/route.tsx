import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import { getPublicUrl } from '@/lib/r2';
import { renderShareCardPng } from '@/lib/shareCard';
import { shareCardKey } from '@/lib/shareCardStore';
import { shareVersion } from '@/lib/shareVersion';

// sharp and font reads both need Node (used by the live-render fallback).
export const runtime = 'nodejs';
export const maxDuration = 30;

const CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const base = await getBaseUrl(req.headers);
  const photo = await getPhotoBySlug(slug);
  if (!photo) return new Response('Not found', { status: 404 });

  const version = shareVersion(photo);

  // Precomputed and still current: proxy the stored PNG rather than paying satori's ~2.6s
  // render again. Proxied (not redirected) so link-preview crawlers that don't follow
  // redirects on og:image still get bytes directly at this URL.
  if (photo.share_card_version === version) {
    const stored = await fetch(getPublicUrl(shareCardKey(slug)));
    if (stored.ok) {
      return new Response(stored.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE_CONTROL },
      });
    }
    // Version matched but the object is missing (deleted out-of-band, etc.) — fall through.
  }

  try {
    const png = await renderShareCardPng(photo, base);
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE_CONTROL },
    });
  } catch (e) {
    console.error('[share] live render failed', slug, e);
    return new Response('Photo unavailable', { status: 502 });
  }
}
