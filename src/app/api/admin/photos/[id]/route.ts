import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { photos } from '@/db/schema';
import { deleteObject } from '@/lib/r2';

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
