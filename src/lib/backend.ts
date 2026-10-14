import type { Photo } from '@/app/types';
import type { CustomPlace } from '@/lib/customPlaces';

/**
 * The Rust API in backend/. Server components call it directly; browser requests reach it
 * through the /api and /feed.xml rewrites in next.config.ts.
 */
export const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Every published photo, or none if the backend is unreachable. */
export async function getPublishedPhotos(): Promise<Photo[]> {
  try {
    return await get<Photo[]>('/api/photos');
  } catch (e) {
    console.error('[backend] photos', e);
    return [];
  }
}

/** Custom place labels, or none if the backend is unreachable. */
export async function getPlaces(): Promise<CustomPlace[]> {
  try {
    return await get<CustomPlace[]>('/api/places');
  } catch (e) {
    console.error('[backend] places', e);
    return [];
  }
}

/** A published photo by its friendly name, or null if there is none (or no backend). */
export async function getPhotoBySlug(slug: string): Promise<Photo | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/photos/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Photo;
  } catch (e) {
    console.error('[backend] photo', slug, e);
    return null;
  }
}

/** Whether a subscription confirmation link is still good. */
export async function isConfirmTokenValid(token: string): Promise<boolean> {
  try {
    const { valid } = await get<{ valid: boolean }>(
      `/api/subscribe/confirm?token=${encodeURIComponent(token)}`,
    );
    return valid;
  } catch (e) {
    console.error('[backend] confirm check', e);
    return false;
  }
}

export type ConfirmStatus = 'confirmed' | 'invalid' | 'error';

/** Subscribes the address in a confirmation token. */
export async function confirmSubscription(token: string): Promise<ConfirmStatus> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/subscribe/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { status } = (await res.json()) as { status: ConfirmStatus };
    return status;
  } catch (e) {
    console.error('[backend] confirm', e);
    return 'error';
  }
}
