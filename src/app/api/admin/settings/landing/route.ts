import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { photos, settings } from '@/db/schema';
import { DEFAULT_LANDING_PHOTO, parseLandingPhoto } from '@/lib/landingPhoto';
import { LANDING_PHOTO_KEY, saveLandingPhoto } from '@/lib/landingPhotoStore';

export async function GET() {
  // Not getLandingPhoto(): that falls back quietly for the landing page, but here a failed
  // query should show up.
  const [row] = await db.select().from(settings).where(eq(settings.key, LANDING_PHOTO_KEY));
  return NextResponse.json({ setting: parseLandingPhoto(row?.value) ?? DEFAULT_LANDING_PHOTO });
}

export async function PUT(req: NextRequest) {
  const setting = parseLandingPhoto(await req.json().catch(() => null));
  if (!setting) {
    return NextResponse.json(
      { error: 'photoId must be a photo id or null, and focus x and y percentages' },
      { status: 400 },
    );
  }
  if (setting.photoId) {
    const [photo] = await db
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.id, setting.photoId), eq(photos.status, 'published')));
    if (!photo) return NextResponse.json({ error: 'No published photo with that id' }, { status: 400 });
  }
  await saveLandingPhoto(setting);
  return NextResponse.json({ setting });
}
