import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings } from '@/db/schema';
import { DEFAULT_HOME_VIEW, parseHomeView } from '@/lib/homeView';
import { HOME_VIEW_KEY, saveHomeView } from '@/lib/homeViewStore';

export async function GET() {
  // Not getHomeView(): that falls back quietly for the public map, but here a failed
  // query (the settings table not created yet, say) should show up.
  const [row] = await db.select().from(settings).where(eq(settings.key, HOME_VIEW_KEY));
  const saved = parseHomeView(row?.value);
  return NextResponse.json({ view: saved ?? DEFAULT_HOME_VIEW, isDefault: !saved });
}

export async function PUT(req: NextRequest) {
  const view = parseHomeView(await req.json().catch(() => null));
  if (!view) {
    return NextResponse.json(
      { error: 'longitude, latitude and zoom must be numbers within range' },
      { status: 400 },
    );
  }
  await saveHomeView(view);
  return NextResponse.json({ view, isDefault: false });
}
