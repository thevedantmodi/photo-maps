/**
 * The ?year= in a map, directory or photo address, so a view filtered to one year can be
 * shared or bookmarked. Anything that isn't a plausible four-digit year reads as none.
 */
export function parseYear(value: string | string[] | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1800 && year <= 2200 ? year : null;
}

/** The photo's year, by date taken; undated photos have none. */
export function yearOf(photo: { date: string | null }): number | null {
  if (!photo.date) return null;
  const y = new Date(photo.date).getFullYear();
  return Number.isFinite(y) ? y : null;
}

/** "&year=2024" (or "?year=2024" when it starts a query), or nothing without a year. */
export function yearQuery(year: number | null, first = false): string {
  return year === null ? '' : `${first ? '?' : '&'}year=${year}`;
}
