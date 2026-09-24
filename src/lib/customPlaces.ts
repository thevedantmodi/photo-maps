import { distanceKm } from "./gps";

/**
 * Hand-named spots that Mapbox has no label for (open ocean, reefs, remote
 * parks). Checked before Mapbox for sidebar names and matched by the search box.
 * A photo group within `radiusKm` of a spot takes its name; nearest spot wins.
 */
export interface CustomPlace {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export const CUSTOM_PLACES: CustomPlace[] = [
  { name: "Great Barrier Reef", latitude: -16.52, longitude: 146.0, radiusKm: 60 },
];

/** The nearest custom place whose radius covers the point, or null. */
export function findCustomPlace(lon: number, lat: number): CustomPlace | null {
  let best: CustomPlace | null = null;
  let bestKm = Infinity;
  for (const place of CUSTOM_PLACES) {
    const km = distanceKm({ latitude: lat, longitude: lon }, place);
    if (km <= place.radiusKm && km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return best;
}

/** Custom places whose name contains the query, case-insensitively. */
export function searchCustomPlaces(query: string): CustomPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CUSTOM_PLACES.filter((p) => p.name.toLowerCase().includes(q));
}
