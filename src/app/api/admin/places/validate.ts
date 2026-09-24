import { isValidLat, isValidLon } from '@/lib/gps';
import { isValidRadius, MAX_RADIUS_KM, MIN_RADIUS_KM } from '@/lib/customPlaces';

export interface PlaceInput {
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
}

/** Checks a create/update body; returns the clean fields or an error message. */
export function parsePlaceBody(body: Record<string, unknown>): PlaceInput | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'name is required' };

  const lat = Number(body.lat);
  if (body.lat == null || body.lat === '' || !isValidLat(lat)) {
    return { error: 'lat must be between -90 and 90' };
  }

  const lon = Number(body.lon);
  if (body.lon == null || body.lon === '' || !isValidLon(lon)) {
    return { error: 'lon must be between -180 and 180' };
  }

  const radius_km = Number(body.radius_km);
  if (!isValidRadius(radius_km)) {
    return { error: `radius_km must be between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM}` };
  }

  return { name, lat, lon, radius_km };
}
