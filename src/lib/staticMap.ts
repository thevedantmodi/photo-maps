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
export async function mapBackground(
  lat: number,
  lon: number,
  theme: CardTheme,
  base: string,
): Promise<Buffer | null> {
  const token = process.env.MAPBOX_STATIC_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  // The public token is restricted to the site's own URLs, which Mapbox checks against the
  // Referer — and a server request sends none, so it would be refused. Name the site, the
  // canonical domain where set (previews may not be on the token's list). A server-only
  // MAPBOX_STATIC_TOKEN without URL restrictions works too.
  const referer = `${(process.env.NEXT_PUBLIC_BASE_URL || base).replace(/\/$/, '')}/`;

  const fetchStyle = async (styleUrl: string): Promise<Buffer | null> => {
    const style = styleUrl.replace('mapbox://styles/', '');
    // The window at @2x: Mapbox caps a side at 1280 logical px, and 476×896@2x is 952×1792.
    const url =
      `https://api.mapbox.com/styles/v1/${style}/static/` +
      `${lon.toFixed(5)},${lat.toFixed(5)},${MAP.zoom},0/${WINDOW.width / 2}x${WINDOW.height / 2}@2x` +
      // The card prints the credit itself, on its bottom edge.
      `?logo=false&attribution=false&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { Referer: referer }, signal: AbortSignal.timeout(MAP.timeoutMs) });
    if (!res.ok) {
      console.error('[share-card] map image refused', style, res.status);
      return null;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    // A style the static renderer can't draw comes back as a blank, fully transparent image
    // (and Mapbox caches it), as the site's custom dark style does for most places.
    const { channels } = await sharp(raw).stats();
    if (channels.length === 4 && channels[3].max === 0) {
      console.error('[share-card] map image blank', style);
      return null;
    }
    return raw;
  };

  try {
    const raw =
      (await fetchStyle(MAP_STYLES[theme])) ?? (await fetchStyle(FALLBACK_STYLES[theme]));
    if (!raw) return null;
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
      // Softens the labels into texture; the park, the water and the grid still read.
      .blur(MAP.blur)
      .composite([{ input: veil }])
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error('[share-card] map image failed', e);
    return null;
  }
}

/** Mapbox's own styles, used when the site's style comes back blank. */
const FALLBACK_STYLES: Record<CardTheme, string> = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
