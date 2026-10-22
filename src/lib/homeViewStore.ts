import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings } from '@/db/schema';
import { DEFAULT_HOME_VIEW, parseHomeView, type HomeView } from '@/lib/homeView';

export const HOME_VIEW_KEY = 'home_view';

/** The saved home view for the public map; New York if none is saved or it can't be read. */
export async function getHomeView(): Promise<HomeView> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, HOME_VIEW_KEY));
    return parseHomeView(row?.value) ?? DEFAULT_HOME_VIEW;
  } catch {
    return DEFAULT_HOME_VIEW;
  }
}

export async function saveHomeView(view: HomeView): Promise<void> {
  await db
    .insert(settings)
    .values({ key: HOME_VIEW_KEY, value: view })
    .onConflictDoUpdate({ target: settings.key, set: { value: view, updated_at: new Date() } });
}
