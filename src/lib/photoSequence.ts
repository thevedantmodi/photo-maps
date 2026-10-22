import { photoTitle } from '@/lib/alt';
import type { CameraDetails } from '@/lib/camera';
import { yearOf } from '@/lib/yearParam';
import type { Photo } from '@/app/types';

/**
 * Enough of a neighbouring photo to link to it, load it ahead of time, and show its words
 * the moment a swipe commits to it, before its page has arrived.
 */
export interface PhotoStep extends CameraDetails {
  slug: string;
  title: string;
  largeUrl: string;
  date: string | null;
  lat: number | null;
  lon: number | null;
}

/** When a photo was taken, falling back to when it was uploaded for undated ones. */
function when(p: Photo): string {
  return p.date ?? p.created_at ?? '';
}

/**
 * The photos either side of this one, oldest to newest by date taken: the order you'd
 * walk a gallery hung by date. With a year (from the map's filter) the walk stays inside
 * that year, unless the photo itself isn't from it; the year returned is the one kept.
 */
export function photoNeighbours(
  photos: Photo[],
  slug: string,
  year: number | null,
): { prev: PhotoStep | null; next: PhotoStep | null; year: number | null } {
  const current = photos.find((p) => p.friendly_name === slug);
  const withinYear = current && year !== null && yearOf(current) === year;
  const pool = withinYear ? photos.filter((p) => yearOf(p) === year) : photos;
  const ordered = [...pool].sort(
    (a, b) =>
      when(a).localeCompare(when(b)) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id),
  );
  const i = ordered.findIndex((p) => p.friendly_name === slug);
  const step = (p: Photo | undefined): PhotoStep | null =>
    p
      ? {
          slug: p.friendly_name,
          title: photoTitle(p),
          largeUrl: p.large_url,
          date: p.date,
          lat: p.lat,
          lon: p.lon,
          camera: p.camera,
          lens: p.lens,
          focal_length_mm: p.focal_length_mm,
          f_number: p.f_number,
          exposure_s: p.exposure_s,
          iso: p.iso,
        }
      : null;
  // The year rides along in the links only while the walk is actually inside it.
  const kept = withinYear ? year : null;
  return i < 0
    ? { prev: null, next: null, year: kept }
    : { prev: step(ordered[i - 1]), next: step(ordered[i + 1]), year: kept };
}
