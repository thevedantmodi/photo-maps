import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { photos } from '@/db/schema';
import { putObject } from '@/lib/r2';
import { renderAllShareCards, type CardFormat, type ShareCardPhoto } from '@/lib/shareCard';
import { shareVersion } from '@/lib/shareVersion';

/** R2 key for a photo's precomputed card, matching the _thumb.jpg/_large.jpg convention. */
export function shareCardKey(friendly_name: string, format: CardFormat = 'story'): string {
  return format === 'og' ? `${friendly_name}_og.png` : `${friendly_name}_share.png`;
}

/** Every card key for a photo, for cleanup on delete. */
export function shareCardKeys(friendly_name: string): string[] {
  return [shareCardKey(friendly_name, 'story'), shareCardKey(friendly_name, 'og')];
}

// shareVersion() hashes large_name (the R2 object key), not large_url, so callers need to
// supply both: large_url to fetch the source bytes, large_name to fingerprint the version.
export type StorableSharePhoto = ShareCardPhoto & { large_name: string };

/**
 * Renders a photo's cards (story and link preview) and stores them in R2, then records the
 * version baked into them so /api/share/[slug] can tell a fresh card from a stale one.
 *
 * Called fire-and-forget from after() in the routes that change card-relevant content
 * (upload, caption/date edit, rotate) — never awaited by the request that triggers it, so
 * failures here must never throw: they're logged and left for the live-render fallback to
 * paper over. The R2 write happens before the DB version update, so a crash between the two
 * leaves share_card_version stale/null rather than pointing at a half-written object.
 *
 * Resolves to whether the cards were stored, for callers that keep count.
 */
export async function generateAndStoreShareCard(photo: StorableSharePhoto, base: string): Promise<boolean> {
  try {
    const cards = await renderAllShareCards(photo, base);
    await Promise.all(
      (Object.keys(cards) as CardFormat[]).map((format) =>
        putObject(shareCardKey(photo.friendly_name, format), cards[format], 'image/png')
      )
    );
    await db
      .update(photos)
      .set({ share_card_version: shareVersion(photo) })
      .where(eq(photos.friendly_name, photo.friendly_name));
    return true;
  } catch (e) {
    console.error('[share-card] generation failed', photo.friendly_name, e);
    return false;
  }
}
