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
  large_name: string;
  lat: number | null;
  lon: number | null;
  // The camera and exposure print on the card's edges (the lens does not).
  camera?: string | null;
  focal_length_mm?: number | null;
  f_number?: number | null;
  exposure_s?: number | null;
  iso?: number | null;
  // Bumped by the admin's "Rebuild share card" to force a fresh card.
  share_card_nonce?: number;
};

/**
 * Bumped whenever the card's design changes, so every card re-renders in the new look
 * instead of serving the old one from R2 or the CDN.
 */
const CARD_DESIGN = 'letterbox-1'; // letterbox-1: photo fitted whole, metadata on the border

export type CardTheme = 'dark' | 'light';

export function shareVersion(photo: Versioned): string {
  // The card falls back to original_name when there is no caption, so it belongs in the key.
  // The location names the place printed on the card.
  const input = [
    CARD_DESIGN,
    photo.caption ?? '',
    photo.original_name,
    photo.date ?? '',
    photo.large_name,
    photo.lat ?? '',
    photo.lon ?? '',
    photo.camera ?? '',
    photo.focal_length_mm ?? '',
    photo.f_number ?? '',
    photo.exposure_s ?? '',
    photo.iso ?? '',
    // 0 and missing hash alike, so a photo never rebuilt keeps the version it had.
    photo.share_card_nonce ? String(photo.share_card_nonce) : '',
  ].join('\u0000');

  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function shareCardPath(slug: string, version: string, theme: CardTheme = 'dark'): string {
  return `/api/share/${encodeURIComponent(slug)}?v=${version}&theme=${theme}`;
}
