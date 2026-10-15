import { photoTitle } from '@/lib/alt';
import { yearOf } from '@/lib/yearParam';
import type { Photo } from '@/app/types';

/** Enough of a neighbouring photo to link to it and load it ahead of time. */
export interface PhotoStep {
  slug: string;
  title: string;
  largeUrl: string;
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
    p ? { slug: p.friendly_name, title: photoTitle(p), largeUrl: p.large_url } : null;
  // The year rides along in the links only while the walk is actually inside it.
  const kept = withinYear ? year : null;
  return i < 0
    ? { prev: null, next: null, year: kept }
    : { prev: step(ordered[i - 1]), next: step(ordered[i + 1]), year: kept };
}
