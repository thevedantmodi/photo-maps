import { NextResponse } from 'next/server';
import { db } from '@/db';
import { photos } from '@/db/schema';
import { getPublicUrl } from '@/lib/r2';

export async function GET() {
  const rows = await db.select().from(photos).orderBy(photos.created_at);
  return NextResponse.json(rows.map(row => ({
    id: row.id,
    friendly_name: row.friendly_name,
    caption: row.caption,
    status: row.status,
    thumb_url: getPublicUrl(row.thumb_name),
    thumb_name: row.thumb_name,
    large_name: row.large_name,
    date: row.date?.toISOString() ?? null,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
  })));
}
