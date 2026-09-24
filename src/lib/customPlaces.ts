import { distanceKm } from "./gps";

/**
 * Hand-named spots that Mapbox has no label for (open ocean, reefs, remote
 * parks). Stored in the `places` table and edited from the admin Places tab.
 * Checked before Mapbox for sidebar names and matched by the search box.
 * A photo group within `radiusKm` of a spot takes its name; nearest spot wins.
 */
export interface CustomPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** Bounds for an admin-entered radius, in km. */
export const MIN_RADIUS_KM = 0.1;
export const MAX_RADIUS_KM = 500;

export function isValidRadius(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_RADIUS_KM && n <= MAX_RADIUS_KM;
}

/** The nearest custom place whose radius covers the point, or null. */
export function findCustomPlace(
  places: CustomPlace[],
  lon: number,
  lat: number,
): CustomPlace | null {
  let best: CustomPlace | null = null;
  let bestKm = Infinity;
  for (const place of places) {
    const km = distanceKm({ latitude: lat, longitude: lon }, place);
    if (km <= place.radiusKm && km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return best;
}

/** Custom places whose name contains the query, case-insensitively. */
export function searchCustomPlaces(places: CustomPlace[], query: string): CustomPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return places.filter((p) => p.name.toLowerCase().includes(q));
}
