/**
 * A short fingerprint of everything that changes what a share card shows.
 *
 * The card is served from Vercel's CDN for 24 hours and nothing purges it on edit, so the
 * URL itself has to change when the content does: `/api/share/<slug>?v=<version>`. The CDN
 * keys on the query string, so an edited caption gets a fresh render on the next request
 * and the old entry simply ages out unused.
 *
 * Runs in both the browser (ShareButton) and the server (og:image in /p/[slug]), and both
 * must produce the same string — hence a plain FNV-1a rather than node:crypto. It is a cache
 * key, not a security boundary, so collisions are not a concern at this scale.
 */
type Versioned = {
  caption: string | null;
  original_name: string;
  date: string | null;
  lat: number | null;
  lon: number | null;
  large_name: string;
};

/**
 * Bump when the card design changes, so cards already in R2 and the CDN are re-rendered
 * instead of served in the old design.
 */
const DESIGN = '2';

/**
 * The place name on the card is resolved from lat/lon at render time, so editing a custom
 * place does not change this key: those cards pick up the new name on their next re-render.
 */
export function shareVersion(photo: Versioned): string {
  // The card falls back to original_name when there is no caption, so it belongs in the key.
  const input = [
    DESIGN,
    photo.caption ?? '',
    photo.original_name,
    photo.date ?? '',
    photo.lat ?? '',
    photo.lon ?? '',
    photo.large_name,
  ].join('\u0000');

  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** `og` is the 1200x630 link preview; the default is the 1080x1920 story card. */
export function shareCardPath(slug: string, version: string, format: 'story' | 'og' = 'story'): string {
  const path = `/api/share/${encodeURIComponent(slug)}?v=${version}`;
  return format === 'og' ? `${path}&format=og` : path;
}
