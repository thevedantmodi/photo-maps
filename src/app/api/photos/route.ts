import { NextResponse } from 'next/server';
import { db } from '@/db';
import { photos } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getPublicUrl } from '@/lib/r2';

export async function GET() {
  const rows = await db.select().from(photos).where(eq(photos.status, 'published'));
  return NextResponse.json(rows.map(row => ({
    ...row,
    date: row.date?.toISOString() ?? null,
    thumb_url: getPublicUrl(row.thumb_name),
    large_url: getPublicUrl(row.large_name),
  })));
}
