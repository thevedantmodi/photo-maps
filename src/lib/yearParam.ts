/**
 * The year filter's choice for photos with no date taken. It stands in for a year wherever
 * one is compared, so "Undated" filters like any other year; in addresses it's "undated".
 */
export const UNDATED = 0;

/**
 * The ?year= in a map, directory or photo address, so a view filtered to one year can be
 * shared or bookmarked. Anything that isn't a plausible four-digit year (or "undated")
 * reads as none.
 */
export function parseYear(value: string | string[] | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'undated') return UNDATED;
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1800 && year <= 2200 ? year : null;
}

/** The photo's year, by date taken; UNDATED when it has none. */
export function yearOf(photo: { date?: string | null }): number {
  if (!photo.date) return UNDATED;
  const y = new Date(photo.date).getFullYear();
  return Number.isFinite(y) ? y : UNDATED;
}

/** The year as it's written in an address: "2024", or "undated". */
export function yearValue(year: number): string {
  return year === UNDATED ? 'undated' : String(year);
}

/** "&year=2024" (or "?year=2024" when it starts a query), or nothing without a year. */
export function yearQuery(year: number | null, first = false): string {
  return year === null ? '' : `${first ? '?' : '&'}year=${yearValue(year)}`;
}
