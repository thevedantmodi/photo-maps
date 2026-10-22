/** Where the map opens on a first visit: set in the admin, New York until then. */
export interface HomeView {
  longitude: number;
  latitude: number;
  zoom: number;
}

export const DEFAULT_HOME_VIEW: HomeView = { longitude: -73.98, latitude: 40.73, zoom: 9.5 };

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
