import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings } from '@/db/schema';
import { DEFAULT_LANDING_PHOTO, parseLandingPhoto, type LandingPhotoSetting } from '@/lib/landingPhoto';

export const LANDING_PHOTO_KEY = 'landing_photo';

/** The saved landing photo setting; the newest upload, centred, if none is saved or it can't be read. */
export async function getLandingPhoto(): Promise<LandingPhotoSetting> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, LANDING_PHOTO_KEY));
    return parseLandingPhoto(row?.value) ?? DEFAULT_LANDING_PHOTO;
  } catch {
    return DEFAULT_LANDING_PHOTO;
  }
}

export async function saveLandingPhoto(setting: LandingPhotoSetting): Promise<void> {
  await db
    .insert(settings)
    .values({ key: LANDING_PHOTO_KEY, value: setting })
    .onConflictDoUpdate({ target: settings.key, set: { value: setting, updated_at: new Date() } });
}
