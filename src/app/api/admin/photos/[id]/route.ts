import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { photos } from '@/db/schema';
import { deleteObject } from '@/lib/r2';
import { isValidLat, isValidLon } from '@/lib/gps';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const update: Record<string, unknown> = {};

  if ('caption' in body) update.caption = body.caption ?? null;

  if ('lat' in body) {
    if (body.lat == null || body.lat === '') {
      update.lat = null;
    } else if (isValidLat(Number(body.lat))) {
      update.lat = Number(body.lat);
    } else {
      return NextResponse.json({ error: 'lat must be between -90 and 90' }, { status: 400 });
    }
  }

  if ('lon' in body) {
    if (body.lon == null || body.lon === '') {
      update.lon = null;
    } else if (isValidLon(Number(body.lon))) {
      update.lon = Number(body.lon);
    } else {
      return NextResponse.json({ error: 'lon must be between -180 and 180' }, { status: 400 });
    }
  }

  if ('date' in body) update.date = body.date ? new Date(body.date) : null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  await db.update(photos).set(update).where(eq(photos.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await Promise.all([
    deleteObject(row.thumb_name),
    deleteObject(row.large_name),
  ]);

  await db.delete(photos).where(eq(photos.id, id));

  return NextResponse.json({ ok: true });
}
