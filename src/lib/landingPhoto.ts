/**
 * The photograph in front of the landing title: the newest upload unless one is pinned in
 * the admin, cropped around a focal point. The focal point is kept with the photo it was
 * set on, so a new upload taking the newest's place opens centred rather than on a point
 * picked for another photo.
 */
export interface Focus {
  /** Percent across and down the photo: 0 is the left or top edge, 100 the right or bottom. */
  x: number;
  y: number;
}

export interface LandingPhotoSetting {
  /** The pinned photo, or null for the newest upload. */
  photoId: string | null;
  /** Where to crop around, and the photo that was picked on. */
  focus: (Focus & { photoId: string }) | null;
}

export const CENTRE: Focus = { x: 50, y: 50 };

export const DEFAULT_LANDING_PHOTO: LandingPhotoSetting = { photoId: null, focus: null };

const isPercent = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

const isId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64;

/** A stored or submitted setting, if it's well formed; null otherwise. */
export function parseLandingPhoto(value: unknown): LandingPhotoSetting | null {
  if (!value || typeof value !== 'object') return null;
  const { photoId, focus } = value as Record<string, unknown>;
  if (photoId !== null && !isId(photoId)) return null;
  if (focus === null) return { photoId, focus: null };
  if (!focus || typeof focus !== 'object') return null;
  const { x, y, photoId: focusId } = focus as Record<string, unknown>;
  if (!isPercent(x) || !isPercent(y) || !isId(focusId)) return null;
  return { photoId, focus: { x, y, photoId: focusId } };
}

/** The focal point for the photo being shown: the saved one if it was set on that photo. */
export function focusFor(setting: LandingPhotoSetting, shownId: string): Focus {
  const f = setting.focus;
  return f && f.photoId === shownId ? { x: f.x, y: f.y } : CENTRE;
}

/** The CSS object-position that keeps a focal point in the crop. */
export const objectPosition = (f: Focus) => `${f.x}% ${f.y}%`;
