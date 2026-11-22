import sharp from 'sharp';

import { MAP_STYLES } from '@/lib/mapStyles';
import { MAP, PALETTE, WINDOW } from '@/lib/shareTokens';
import type { CardTheme } from '@/lib/shareVersion';

/**
 * The map behind a share card's photo window: a Mapbox static image of where the photo
 * was taken, centred on it so the photo sits on its own spot, in the site's light or dark
 * map style. It is turned down to a faint texture here, since satori can't filter images:
 * most of its colour taken out, then washed toward the window's bar colour.
 *
 * Returns null — and the card keeps plain bars — when there's no token, or Mapbox refuses
 * or is slow. A share card never fails for want of a map.
 */
export async function mapBackground(lat: number, lon: number, theme: CardTheme): Promise<Buffer | null> {
  // A server-only token, if set, for when the public one is restricted to the site's own
  // pages (Mapbox checks the Referer, which a server request doesn't send).
  const token = process.env.MAPBOX_STATIC_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const style = MAP_STYLES[theme].replace('mapbox://styles/', '');
  // The window at @2x: Mapbox caps a side at 1280 logical px, and 476×896@2x is 952×1792.
  const w = WINDOW.width / 2;
  const h = WINDOW.height / 2;
  const url =
    `https://api.mapbox.com/styles/v1/${style}/static/` +
    `${lon.toFixed(5)},${lat.toFixed(5)},${MAP.zoom},0/${w}x${h}@2x` +
    // The card prints the credit itself, on its bottom edge.
    `?logo=false&attribution=false&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(MAP.timeoutMs) });
    if (!res.ok) {
      console.error('[share-card] map image refused', res.status);
      return null;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    const bar = PALETTE[theme].bar;
    const veil = await sharp({
      create: { width: WINDOW.width, height: WINDOW.height, channels: 4, background: { ...hexRgb(bar), alpha: MAP.veil[theme] } },
    })
      .png()
      .toBuffer();
    return await sharp(raw)
      .resize(WINDOW.width, WINDOW.height, { fit: 'cover' })
      .removeAlpha()
      .modulate({ saturation: MAP.saturation })
      .composite([{ input: veil }])
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error('[share-card] map image failed', e);
    return null;
  }
}

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
