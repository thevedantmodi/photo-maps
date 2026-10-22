import { findCustomPlace } from '@/lib/customPlaces';
import { lookupPlace } from '@/lib/mapboxGeocode';
import { getPlaces } from '@/lib/places';

/**
 * The place printed on a share card: a hand-named custom place if one covers the point,
 * else Mapbox's name for it. One request at most — the browser's "Near <town>" probing
 * (reverseGeocode) is too chatty for a server render — and null rather than a guess.
 */
export async function placeNameFor(lat: number, lon: number): Promise<string | null> {
  const custom = findCustomPlace(await getPlaces(), lon, lat);
  if (custom) return custom.name;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    return (await lookupPlace(lon, lat, token))?.name ?? null;
  } catch {
    return null;
  }
}
