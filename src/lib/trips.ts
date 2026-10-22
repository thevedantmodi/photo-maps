import { getLocationGroups } from "@/lib/locationGroups";
import { UNDATED } from "@/lib/yearParam";
import type { Photo } from "@/app/types";

/** A new trip starts when a place's photos are further apart than this. */
const TRIP_GAP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Trip {
  id: string;
  /** The place's group, as the map draws it; place names are looked up by this. */
  placeId: string;
  longitude: number;
  latitude: number;
  /** The year it began, or UNDATED for a place's photos with no date taken. */
  year: number;
  /** First and last day, as YYYY-MM-DD; null when undated. */
  from: string | null;
  to: string | null;
  /** In the order they were taken. */
  photos: Photo[];
}

export interface TripYear {
  year: number;
  trips: Trip[];
}

const day = (p: Photo) => (p.date ?? "").slice(0, 10);

/**
 * The located photos as trips: each place's photos (the same groups the map uses), split
 * wherever more than a week passes between two of them. Newest first, under the year each
 * began; undated photos close the list, one entry per place.
 */
export function getTrips(photos: Photo[]): TripYear[] {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const trips: Trip[] = [];

  for (const g of getLocationGroups(photos)) {
    const members = g.photoIds.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
    const place = { placeId: g.id, longitude: g.longitude, latitude: g.latitude };
    const dated = members.filter((p) => p.date).sort((a, b) => day(a).localeCompare(day(b)));
    const undated = members.filter((p) => !p.date);

    let run: Photo[] = [];
    const close = () => {
      if (run.length === 0) return;
      const from = day(run[0]);
      trips.push({
        ...place,
        id: `${g.id}-${from}`,
        year: Number(from.slice(0, 4)),
        from,
        to: day(run[run.length - 1]),
        photos: run,
      });
      run = [];
    };
    for (const p of dated) {
      const last = run[run.length - 1];
      if (last && Date.parse(day(p)) - Date.parse(day(last)) > TRIP_GAP_DAYS * DAY_MS) close();
      run.push(p);
    }
    close();

    if (undated.length > 0) {
      trips.push({ ...place, id: `${g.id}-undated`, year: UNDATED, from: null, to: null, photos: undated });
    }
  }

  trips.sort((a, b) => {
    const aUndated = a.year === UNDATED;
    const bUndated = b.year === UNDATED;
    if (aUndated !== bUndated) return aUndated ? 1 : -1;
    // Undated places have no order of their own: most photographs first.
    if (aUndated) return b.photos.length - a.photos.length;
    return (b.from ?? "").localeCompare(a.from ?? "");
  });

  const years: TripYear[] = [];
  for (const t of trips) {
    const last = years[years.length - 1];
    if (last && last.year === t.year) last.trips.push(t);
    else years.push({ year: t.year, trips: [t] });
  }
  return years;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "10–19 March", "28 June – 3 July", "12 March", or across a new year "28 December 2024 – 3 January 2025". */
export function tripDates(trip: Trip): string {
  if (!trip.from || !trip.to) return "No date";
  const [y1, m1, d1] = trip.from.split("-").map(Number);
  const [y2, m2, d2] = trip.to.split("-").map(Number);
  if (trip.from === trip.to) return `${d1} ${MONTHS[m1 - 1]}`;
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

/** Up to `n` of the trip's photos, spread evenly from first to last. */
export function sample(photos: Photo[], n: number): Photo[] {
  if (photos.length <= n) return photos;
  return Array.from({ length: n }, (_, i) => photos[Math.round((i * (photos.length - 1)) / (n - 1))]);
}
