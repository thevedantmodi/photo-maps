// Shared GPS helpers used by the photo processor (server) and the admin UI (client).

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const COORD_PRECISION = 6;

export function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLon(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/** Format a coordinate for a textbox: fixed precision, trailing zeros trimmed. */
export function formatCoord(n: number): string {
  return String(Number(n.toFixed(COORD_PRECISION)));
}

/** Parse a textbox value into a latitude, or null when blank/invalid. */
export function parseLat(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return isValidLat(n) ? n : null;
}

/** Parse a textbox value into a longitude, or null when blank/invalid. */
export function parseLon(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return isValidLon(n) ? n : null;
}

/** Split a pasted "40.7128, -74.006" pair into its two halves, or null. */
export function splitCoordPair(value: string): { lat: string; lon: string } | null {
  const parts = value.split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  return { lat: formatCoord(lat), lon: formatCoord(lon) };
}

/** Accept a lat/lon pair supplied by a client, or null when either half is unusable. */
export function coercePair(lat: unknown, lon: unknown): Coordinates | null {
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!isValidLat(latitude) || !isValidLon(longitude)) return null;
  return { latitude, longitude };
}

// Parse GPS rational DMS string like "38/1 15/1 2062/100" to decimal degrees.
// Ref is "N"/"S" for lat, "E"/"W" for lon; absent Ref = positive.
export function dmsRationalToDecimal(dms: string, ref?: string): number | null {
  const parts = dms.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const vals = parts.map((p) => {
    const [n, d] = p.split('/').map(Number);
    return d ? n / d : n;
  });
  const decimal = vals[0] + vals[1] / 60 + vals[2] / 3600;
  return ref === 'S' || ref === 'W' ? -decimal : decimal;
}

export function extractGps(exifData: Record<string, unknown> | null | undefined): Coordinates | null {
  if (!exifData) return null;

  // Standard path: exifr already computed decimal coords (works for JPEG)
  if (typeof exifData.latitude === 'number' && typeof exifData.longitude === 'number') {
    return { latitude: exifData.latitude, longitude: exifData.longitude };
  }

  // Fallback: parse raw DMS rational strings (PNG/XMP export from Lightroom)
  const rawLat = exifData.GPSLatitude;
  const rawLon = exifData.GPSLongitude;
  if (typeof rawLat !== 'string' || typeof rawLon !== 'string') return null;

  const latRef = typeof exifData.GPSLatitudeRef === 'string' ? exifData.GPSLatitudeRef : undefined;
  const lonRef = typeof exifData.GPSLongitudeRef === 'string' ? exifData.GPSLongitudeRef : undefined;

  const latitude = dmsRationalToDecimal(rawLat, latRef);
  const longitude = dmsRationalToDecimal(rawLon, lonRef);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

/** exifr options that match what the server reads, so client and server agree. */
export const EXIF_PARSE_OPTIONS = {
  gps: true,
  xmp: true,
  exif: true,
  tiff: true,
  translateValues: false,
} as const;
