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

/**
 * Reverse-geocodes a point to a short place name ("New York, NY"),
 * caching results in localStorage so repeat visits don't re-fetch.
 */
export async function reverseGeocode(
  lon: number,
  lat: number,
  token: string,
): Promise<string> {
  const cache = loadCache();
  const key = keyFor(lon, lat);
  if (cache[key]) return cache[key];

  const fallback = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
        `?types=place,region,country&access_token=${token}`,
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const feature = data.features?.[0];
    const fullName: string | undefined = feature?.place_name;
    if (!fullName) return fallback;

    // "New York, New York, United States" -> "New York, New York"
    const short = fullName.split(",").slice(0, 2).join(",").trim();

    cache[key] = short;
    saveCache(cache);
    return short;
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
 * Forward-geocodes free text ("tokyo") into place suggestions for the search box.
 */
export async function searchPlaces(
  query: string,
  token: string,
): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
        `?types=place,region,country,locality&limit=5&access_token=${token}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map(
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
  } catch {
    return [];
  }
}
