import { NextRequest, NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { places } from '@/db/schema';
import { toCustomPlace } from '@/lib/places';
import { parsePlaceBody } from './validate';

export async function GET() {
  // Not getPlaces(): that swallows errors for the public page, but here a
  // failed query should show up rather than look like an empty list.
  const rows = await db.select().from(places).orderBy(asc(places.name));
  return NextResponse.json(rows.map(toCustomPlace));
}

export async function POST(req: NextRequest) {
  const parsed = parsePlaceBody(await req.json());
  if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });

  const [row] = await db.insert(places).values(parsed).returning();
  return NextResponse.json(toCustomPlace(row), { status: 201 });
}
