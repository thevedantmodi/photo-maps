import { and, desc, eq, gte } from 'drizzle-orm';

import { db } from '@/db';
import { photos } from '@/db/schema';
import { getPublicUrl } from '@/lib/r2';
import { Photo } from '@/app/types';

type PhotoRow = typeof photos.$inferSelect;

function toPhoto(row: PhotoRow): Photo {
  return {
    ...row,
    date: row.date?.toISOString() ?? null,
    created_at: row.created_at?.toISOString() ?? null,
    thumb_url: getPublicUrl(row.thumb_name),
    large_url: getPublicUrl(row.large_name),
  };
}

export async function getPublishedPhotos(): Promise<Photo[]> {
  try {
    const rows = await db.select().from(photos).where(eq(photos.status, 'published'));
    return rows.map(toPhoto);
  } catch {
    return [];
  }
}

export async function getRecentPublishedPhotos(limit: number): Promise<Photo[]> {
  const rows = await db
    .select()
    .from(photos)
    .where(eq(photos.status, 'published'))
    .orderBy(desc(photos.created_at))
    .limit(limit);
  return rows.map(toPhoto);
}

export async function getPublishedPhotosSince(since: Date): Promise<Photo[]> {
  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.status, 'published'), gte(photos.created_at, since)))
    .orderBy(desc(photos.created_at));
  return rows.map(toPhoto);
}

export async function getPhotoBySlug(slug: string): Promise<Photo | null> {
  try {
    const rows = await db
      .select()
      .from(photos)
      .where(and(eq(photos.status, 'published'), eq(photos.friendly_name, slug)))
      .limit(1);
    return rows[0] ? toPhoto(rows[0]) : null;
  } catch {
    return null;
  }
}
