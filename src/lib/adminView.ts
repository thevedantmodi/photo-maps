/**
 * Sorting and grouping for the admin's Manage grid, over every field a card shows. Photos
 * missing the field sorted or grouped on always come last, whichever way the sort runs.
 */

export interface ViewPhoto {
  id: string;
  friendly_name: string;
  caption: string | null;
  alt_text: string | null;
  date: string | null;
  created_at: string | null;
  lat: number | null;
  lon: number | null;
}

export const SORTS = {
  taken: "Date taken",
  uploaded: "Uploaded",
  name: "Name",
  caption: "Caption",
  place: "Place",
  alt: "Alt text",
} as const;
export type SortKey = keyof typeof SORTS;

export const GROUPS = {
  none: "None",
  year: "Year",
  month: "Month",
  place: "Place",
  missing: "Missing",
} as const;
export type GroupKey = keyof typeof GROUPS;

export type Dir = "asc" | "desc";

export interface Group<P> {
  key: string;
  label: string;
  photos: P[];
}

/** A place name for a photo with coordinates, once looked up; null while unknown. */
export type PlaceOf = (p: ViewPhoto) => string | null;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const coords = (p: ViewPhoto) => (p.lat != null && p.lon != null ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : null);
const text = (s: string | null) => (s && s.trim() ? s.trim().toLocaleLowerCase() : null);

function sortValue(p: ViewPhoto, key: SortKey, placeOf: PlaceOf): string | null {
  switch (key) {
    case "taken":
      return p.date;
    case "uploaded":
      return p.created_at;
    case "name":
      return text(p.friendly_name);
    case "caption":
      return text(p.caption);
    case "place":
      return text(placeOf(p) ?? coords(p));
    case "alt":
      return text(p.alt_text);
  }
}

export function sortPhotos<P extends ViewPhoto>(photos: P[], key: SortKey, dir: Dir, placeOf: PlaceOf): P[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...photos].sort((a, b) => {
    const va = sortValue(a, key, placeOf);
    const vb = sortValue(b, key, placeOf);
    if (va === null || vb === null) {
      if (va === vb) return a.friendly_name.localeCompare(b.friendly_name);
      return va === null ? 1 : -1;
    }
    return sign * va.localeCompare(vb, undefined, { numeric: true }) || a.friendly_name.localeCompare(b.friendly_name);
  });
}

/** What a photo is missing that the site shows or needs. */
export function missingOf(p: ViewPhoto): string[] {
  const out: string[] = [];
  if (!p.date) out.push("Date");
  if (p.lat == null || p.lon == null) out.push("Location");
  if (!text(p.caption)) out.push("Caption");
  if (!text(p.alt_text)) out.push("Alt text");
  return out;
}

function groupOf(p: ViewPhoto, key: GroupKey, placeOf: PlaceOf): { key: string; label: string } {
  switch (key) {
    case "none":
      return { key: "all", label: "" };
    case "year": {
      if (!p.date) return { key: "~", label: "No date" };
      const y = String(new Date(p.date).getFullYear());
      return { key: y, label: y };
    }
    case "month": {
      if (!p.date) return { key: "~", label: "No date" };
      const d = new Date(p.date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key: k, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
    }
    case "place": {
      if (p.lat == null || p.lon == null) return { key: "~", label: "No location" };
      const name = placeOf(p) ?? "Looking up…";
      return { key: name, label: name };
    }
    case "missing": {
      const m = missingOf(p);
      return m.length ? { key: m.join(", "), label: `No ${m.join(", ").toLocaleLowerCase()}` } : { key: "~", label: "Complete" };
    }
  }
}

/**
 * The sorted photos in groups. Years and months run the same way as the sort (newest
 * first, or oldest); places and what's missing come in the order of their first photo in
 * the sort, so a newest-first sort leads with the place photographed most recently. The
 * group of photos without the field comes last.
 */
export function groupPhotos<P extends ViewPhoto>(
  sorted: P[],
  key: GroupKey,
  dir: Dir,
  placeOf: PlaceOf,
): Group<P>[] {
  const map = new Map<string, Group<P>>();
  for (const p of sorted) {
    const g = groupOf(p, key, placeOf);
    let entry = map.get(g.key);
    if (!entry) map.set(g.key, (entry = { key: g.key, label: g.label, photos: [] }));
    entry.photos.push(p);
  }
  const groups = [...map.values()];
  const last = groups.filter((g) => g.key === "~");
  const rest = groups.filter((g) => g.key !== "~");
  if (key === "year" || key === "month") {
    const sign = dir === "desc" ? -1 : 1;
    rest.sort((a, b) => sign * a.key.localeCompare(b.key, undefined, { numeric: true }));
  }
  return [...rest, ...last];
}
