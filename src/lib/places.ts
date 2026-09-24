import { asc } from 'drizzle-orm';

import { db } from '@/db';
import { places, type PlaceRow } from '@/db/schema';
import type { CustomPlace } from '@/lib/customPlaces';

export function toCustomPlace(row: PlaceRow): CustomPlace {
  return {
    id: row.id,
    name: row.name,
    latitude: row.lat,
    longitude: row.lon,
    radiusKm: row.radius_km,
  };
}

export async function getPlaces(): Promise<CustomPlace[]> {
  try {
    const rows = await db.select().from(places).orderBy(asc(places.name));
    return rows.map(toCustomPlace);
  } catch {
    return [];
  }
}
