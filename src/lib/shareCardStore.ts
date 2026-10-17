import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { photos } from '@/db/schema';
import { putObject } from '@/lib/r2';
import { renderShareCardPng, type ShareCardPhoto } from '@/lib/shareCard';
import { shareVersion, type CardTheme } from '@/lib/shareVersion';

export const CARD_THEMES: CardTheme[] = ['dark', 'light'];

/** R2 key for a photo's precomputed share card in one theme. */
export function shareCardKey(friendly_name: string, theme: CardTheme): string {
  return `${friendly_name}_share_${theme}.png`;
}

/** The single-theme key cards were stored under before the redesign; only deleted now. */
export function legacyShareCardKey(friendly_name: string): string {
  return `${friendly_name}_share.png`;
}

// shareVersion() hashes large_name (the R2 object key), not large_url, so callers need to
// supply both: large_url to fetch the source bytes, large_name to fingerprint the version.
export type StorableSharePhoto = ShareCardPhoto & { large_name: string };

/**
 * Renders a photo's share cards (dark and light) and stores them in R2, then records the
 * version baked into them so /api/share/[slug] can tell fresh cards from stale ones.
 *
 * Called fire-and-forget from after() in the routes that change card-relevant content
 * (upload, caption/date/location edit, rotate) — never awaited by the request that
 * triggers it, so failures here must never throw: they're logged and left for the
 * live-render fallback to paper over. Both R2 writes happen before the DB version update,
 * so a crash in between leaves share_card_version stale/null rather than pointing at a
 * half-written pair. The themes render one after the other to keep memory flat.
 */
export async function generateAndStoreShareCard(photo: StorableSharePhoto, base: string): Promise<void> {
  try {
    for (const theme of CARD_THEMES) {
      const png = await renderShareCardPng(photo, base, theme);
      await putObject(shareCardKey(photo.friendly_name, theme), png, 'image/png');
    }
    await db
      .update(photos)
      .set({ share_card_version: shareVersion(photo) })
      .where(eq(photos.friendly_name, photo.friendly_name));
  } catch (e) {
    console.error('[share-card] generation failed', photo.friendly_name, e);
  }
}
