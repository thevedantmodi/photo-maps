import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { places } from '@/db/schema';
import { toCustomPlace } from '@/lib/places';
import { parsePlaceBody } from '../validate';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = parsePlaceBody(await req.json());
  if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });

  const [row] = await db.update(places).set(parsed).where(eq(places.id, id)).returning();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(toCustomPlace(row));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db.delete(places).where(eq(places.id, id)).returning();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
