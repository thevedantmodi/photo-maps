/**
 * Where the map opens on a first visit: set in the admin, New York until then. The zoom is
 * as framed in a map HOME_FRAME_PX across its shorter side; smaller maps (a phone) open
 * further out so they show the same stretch of the world (frameZoom).
 */
export interface HomeView {
  longitude: number;
  latitude: number;
  zoom: number;
}

// New York in the middle, all of North America, and Europe and Africa just showing.
export const DEFAULT_HOME_VIEW: HomeView = { longitude: -73.98, latitude: 40.73, zoom: 2.4 };

export const HOME_FRAME_PX = 700;

export const HOME_ZOOM_MIN = 0.5;
export const HOME_ZOOM_MAX = 16;

/** A stored or submitted view, if it's a real place and zoom; null otherwise. */
export function parseHomeView(value: unknown): HomeView | null {
  if (!value || typeof value !== 'object') return null;
  const { longitude, latitude, zoom } = value as Record<string, unknown>;
  if (
    typeof longitude !== 'number' ||
    typeof latitude !== 'number' ||
    typeof zoom !== 'number' ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(zoom) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90 ||
    zoom < HOME_ZOOM_MIN ||
    zoom > HOME_ZOOM_MAX
  ) {
    return null;
  }
  return { longitude, latitude, zoom };
}

/** The zoom that shows a home view's stretch of the world in a map of this size. */
export function frameZoom(zoom: number, width: number, height: number): number {
  const side = Math.min(width, height);
  if (!(side > 0)) return zoom;
  return Math.max(HOME_ZOOM_MIN, zoom + Math.min(0, Math.log2(side / HOME_FRAME_PX)));
}

/** The reverse: the home zoom for a view framed at `zoom` in a map of this size. */
export function homeZoom(zoom: number, width: number, height: number): number {
  const side = Math.min(width, height);
  if (!(side > 0)) return zoom;
  return Math.min(HOME_ZOOM_MAX, Math.max(HOME_ZOOM_MIN, zoom - Math.min(0, Math.log2(side / HOME_FRAME_PX))));
}
