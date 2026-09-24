import { CustomPlace, findCustomPlace, searchCustomPlaces } from "./customPlaces";
import { offsetPoint } from "./gps";

const CACHE_KEY = "photo-maps:geocode-cache:v1";

type CacheMap = Record<string, string>;

function loadCache(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCache(cache: CacheMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — cache is a nice-to-have, not required.
  }
}

function keyFor(lon: number, lat: number) {
  // Round to ~1km so nearby photos share one cached lookup instead of
  // firing a request per photo.
  return `${lon.toFixed(2)},${lat.toFixed(2)}`;
}

interface Lookup {
  name: string; // "New York, New York"
  isPlace: boolean; // a town/city, not just a region or country
}

/** One Mapbox reverse lookup; null when Mapbox has nothing at the point. */
async function lookup(lon: number, lat: number, token: string): Promise<Lookup | null> {
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
      `?types=place,region,country&access_token=${token}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  const fullName: string | undefined = feature?.place_name;
  if (!fullName) return null;

  // "New York, New York, United States" -> "New York, New York"
  const short = fullName.split(",").slice(0, 2).join(",").trim();
  const isPlace = (feature.place_type as string[] | undefined)?.includes("place") ?? false;
  return { name: short, isPlace };
}

const RING_KM = [25, 50, 100];
const RING_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * For points Mapbox can't name (open ocean, reefs), probe rings of points
 * around them and return "Near <closest town>". Rings run nearest-first and
 * stop at the first one that finds a town, so most lookups cost one ring.
 */
async function nearestPlace(lon: number, lat: number, token: string): Promise<string | null> {
  let broadest: string | null = null;
  for (const km of RING_KM) {
    const hits = await Promise.all(
      RING_BEARINGS.map((bearing) => {
        const p = offsetPoint({ latitude: lat, longitude: lon }, km, bearing);
        return lookup(p.longitude, p.latitude, token).catch(() => null);
      }),
    );
    const town = hits.find((h) => h?.isPlace);
    if (town) return `Near ${town.name}`;
    broadest ??= hits.find((h) => h)?.name ?? null;
  }
  return broadest && `Near ${broadest}`;
}

/**
 * Names a point for the sidebar: a hand-named custom place if one covers it,
 * else Mapbox's name ("New York, NY"), else "Near <closest town>". Mapbox
 * results are cached in localStorage so repeat visits don't re-fetch.
 */
export async function reverseGeocode(
  lon: number,
  lat: number,
  token: string,
  places: CustomPlace[],
): Promise<string> {
  // Before the cache, so an edited place takes effect on the next page load.
  const custom = findCustomPlace(places, lon, lat);
  if (custom) return custom.name;

  const cache = loadCache();
  const key = keyFor(lon, lat);
  if (cache[key]) return cache[key];

  const fallback = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

  try {
    const name = (await lookup(lon, lat, token))?.name ?? (await nearestPlace(lon, lat, token));
    if (!name) return fallback;

    cache[key] = name;
    saveCache(cache);
    return name;
  } catch {
    return fallback;
  }
}

export interface PlaceSuggestion {
  name: string;
  longitude: number;
  latitude: number;
  bbox?: [number, number, number, number];
}

/**
 * Forward-geocodes free text ("tokyo") into place suggestions for the search
 * box, with matching custom places listed first.
 */
export async function searchPlaces(
  query: string,
  token: string,
  places: CustomPlace[],
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  const custom: PlaceSuggestion[] = searchCustomPlaces(places, query).map((p) => ({
    name: p.name,
    longitude: p.longitude,
    latitude: p.latitude,
  }));

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
        `?types=place,region,country,locality&limit=5&access_token=${token}`,
    );
    if (!res.ok) return custom;
    const data = await res.json();
    const mapbox: PlaceSuggestion[] = (data.features ?? []).map(
      (f: {
        place_name: string;
        center: [number, number];
        bbox?: [number, number, number, number];
      }) => ({
        name: f.place_name,
        longitude: f.center[0],
        latitude: f.center[1],
        bbox: f.bbox,
      }),
    );
    return [...custom, ...mapbox];
  } catch {
    return custom;
  }
}
