import { NextRequest, NextResponse, after } from 'next/server';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { photos } from '@/db/schema';
import { getBaseUrl } from '@/lib/baseUrl';
import { getPublicUrl } from '@/lib/r2';
import { generateAndStoreShareCard } from '@/lib/shareCardStore';

export const maxDuration = 30;

/**
 * Rebuilds share cards on demand, for when something on a card changed without its
 * database row changing (a renamed place, a new card design without a CARD_DESIGN bump).
 *
 * Each rebuild bumps the photo's share_card_nonce, which is part of shareVersion(): the
 * card gets a new URL, so the CDN's cached copy is skipped rather than purged.
 *
 *   { id }   one photo: its cards are rendered and stored right after this responds.
 *   {}       every published photo: each card is rendered the next time it's asked for
 *            (the share route renders a stale card live, then stores it), since rendering
 *            them all here would outlast the request.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const bump = { share_card_nonce: sql`${photos.share_card_nonce} + 1` };

  if (body.id !== undefined) {
    if (typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id must be a photo id' }, { status: 400 });
    }
    const [row] = await db.update(photos).set(bump).where(eq(photos.id, body.id)).returning();
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const base = await getBaseUrl(req.headers);
    after(() =>
      generateAndStoreShareCard(
        {
          friendly_name: row.friendly_name,
          caption: row.caption,
          original_name: row.original_name,
          date: row.date?.toISOString() ?? null,
          lat: row.lat,
          lon: row.lon,
          large_name: row.large_name,
          large_url: getPublicUrl(row.large_name),
          camera: row.camera,
          focal_length_mm: row.focal_length_mm,
          f_number: row.f_number,
          exposure_s: row.exposure_s,
          iso: row.iso,
          share_card_nonce: row.share_card_nonce,
        },
        base,
      ),
    );
    return NextResponse.json({ ok: true, rebuilt: 1 });
  }

  const rows = await db
    .update(photos)
    .set(bump)
    .where(eq(photos.status, 'published'))
    .returning({ id: photos.id });
  return NextResponse.json({ ok: true, rebuilt: rows.length });
}
