import { findCustomPlace } from '@/lib/customPlaces';
import { MAP_STYLES } from '@/lib/mapStyles';
import { mapboxPlaceName } from '@/lib/mapboxGeocode';
import { getPlaces } from '@/lib/places';

/**
 * Where a photo was taken, for the share cards: its place name and a small map around it.
 * Both are best-effort: a failed lookup leaves that piece off the card, never fails the render.
 */

/**
 * The Mapbox token is the public one. If it is URL-restricted, Mapbox checks the Referer,
 * which server-side fetches don't send by default — so send the site's own origin.
 */
function mapboxInit(base: string): RequestInit {
  return { headers: { Referer: `${base}/` } };
}

/** Same naming as the sidebar: a hand-named custom place first, then Mapbox. */
export async function placeName(lon: number, lat: number, base: string): Promise<string | null> {
  const custom = findCustomPlace(await getPlaces(), lon, lat);
  if (custom) return custom.name;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    return await mapboxPlaceName(lon, lat, token, mapboxInit(base));
  } catch {
    return null;
  }
}

/** "mapbox://styles/<user>/<id>" -> "<user>/<id>", as the Static Images API wants it. */
const STATIC_STYLE = MAP_STYLES.dark.replace(/^mapbox:\/\/styles\//, '');

/** Country-scale: enough coastline to recognise where in the world, at a glance. */
const MAP_ZOOM = 4.5;

/**
 * A square map centred on the point, from the Mapbox Static Images API, at @2x for a crisp
 * downsample. The dark style matches the card's dark glass. Mapbox's logo and attribution
 * are switched off because they are unreadable at this size; the site itself carries them.
 */
export async function mapTile(
  lon: number,
  lat: number,
  size: number,
  base: string
): Promise<Buffer | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const center = `${lon.toFixed(4)},${lat.toFixed(4)},${MAP_ZOOM},0`;
  const url =
    `https://api.mapbox.com/styles/v1/${STATIC_STYLE}/static/${center}/${size}x${size}@2x` +
    `?attribution=false&logo=false&access_token=${token}`;

  try {
    const res = await fetch(url, mapboxInit(base));
    if (!res.ok) {
      console.error('[share-card] map tile failed', res.status);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error('[share-card] map tile failed', e);
    return null;
  }
}
