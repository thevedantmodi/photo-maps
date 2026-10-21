"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useInView } from "./Reveal";
import SiteHeader from "./SiteHeader";
import YearFilter from "./YearFilter";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import { getTrips, sample, tripDates } from "@/lib/trips";
import { UNDATED, yearOf, yearQuery, yearValue } from "@/lib/yearParam";
import type { CustomPlace } from "@/lib/customPlaces";
import type { Photo } from "../types";

interface DirectoryProps {
  photos: Photo[];
  places: CustomPlace[];
  /** From ?year= in the address, already checked against the photos. */
  initialYear: number | null;
}

/** A row that rules itself in when it scrolls into view; rows arriving together stagger. */
function DirItem({
  index,
  hovered,
  children,
}: {
  index: number;
  hovered: boolean;
  children: React.ReactNode;
}) {
  const [ref, inView] = useInView<HTMLLIElement>("0px 0px -6% 0px");
  return (
    <li
      ref={ref}
      className="dir-item"
      data-hover={hovered}
      data-in={inView}
      style={{ "--i": index % 8 } as React.CSSProperties}
    >
      {children}
    </li>
  );
}

/** How many photographs a row shows before "+n". */
const STRIP = 5;

/**
 * Every trip, newest first under the year it began: a place's photos (the same groups the
 * map uses), split wherever more than a week passes. Places are named by custom places or
 * Mapbox (cached in this browser). A row opens the map there; hovering one brings it
 * forward and opens up its strip of photographs.
 */
export default function Directory({ photos, places, initialYear }: DirectoryProps) {
  const [year, setYear] = useState<number | null>(initialYear);

  // Same as the map: the year sits in the address so a filtered directory can be shared.
  const changeYear = (next: number | null) => {
    setYear(next);
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete("year");
    else url.searchParams.set("year", yearValue(next));
    window.history.replaceState(window.history.state, "", url);
  };

  const shown = useMemo(
    () => (year === null ? photos : photos.filter((p) => yearOf(p) === year)),
    [photos, year],
  );

  const years = useMemo(() => getTrips(shown), [shown]);
  const trips = useMemo(() => years.flatMap((y) => y.trips), [years]);
  // One name per place, however many trips went there.
  const placeList = useMemo(() => {
    const seen = new Map<string, { id: string; longitude: number; latitude: number }>();
    for (const t of trips) {
      if (!seen.has(t.placeId)) seen.set(t.placeId, { id: t.placeId, longitude: t.longitude, latitude: t.latitude });
    }
    return Array.from(seen.values());
  }, [trips]);

  const [names, setNames] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || placeList.length === 0) return;
    let cancelled = false;
    // Three lookups in flight at a time. One at a time let a single slow lookup (open
    // ocean, which searches outward in rings) hold up every row below it, even rows a
    // custom place or the cache could name at once.
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < placeList.length) {
        const place = placeList[next++];
        const name = await reverseGeocode(place.longitude, place.latitude, token, places);
        if (cancelled) return;
        setNames((prev) => ({ ...prev, [place.id]: name }));
      }
    };
    for (let i = 0; i < Math.min(3, placeList.length); i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [placeList, places]);

  const works = trips.reduce((n, t) => n + t.photos.length, 0);
  let index = 0;

  return (
    <main className="dir">
      <SiteHeader current="directory" />

      <div className="dir-head">
        <h1 className="label" style={{ margin: 0 }}>
          Directory
        </h1>
        {trips.length > 0 && (
          <p className="dir-sum">
            {trips.length} {trips.length === 1 ? "trip" : "trips"} · {placeList.length}{" "}
            {placeList.length === 1 ? "place" : "places"} · {works} {works === 1 ? "work" : "works"}
          </p>
        )}
      </div>

      <YearFilter photos={photos} selectedYear={year} onYearChange={changeYear} />

      <div className="dir-table">
        <div className="dir-cols" aria-hidden="true">
          <span>Year</span>
          <span>When</span>
          <span>Place</span>
          <span>Works</span>
          <span className="trip-strip">Photographs</span>
        </div>

        {trips.length === 0 ? (
          <p className="dir-empty">
            {year === null
              ? "No located photos yet."
              : year === UNDATED
                ? "No located photos without a date."
                : `No located photos from ${year}.`}
          </p>
        ) : (
          <div data-hovering={hover !== null} onMouseLeave={() => setHover(null)}>
            {years.map((y) => (
              <section
                key={y.year}
                className="trip-year"
                aria-label={y.year === UNDATED ? "Undated" : `Trips in ${y.year}`}
              >
                <h2 className="trip-year-name">{y.year === UNDATED ? "Undated" : y.year}</h2>
                <ol className="dir-list">
                  {y.trips.map((trip) => {
                    const name = names[trip.placeId];
                    const count = trip.photos.length;
                    const zoom = count > 1 ? 9 : 12;
                    const strip = sample(trip.photos, STRIP);
                    const when = tripDates(trip);
                    return (
                      <DirItem key={trip.id} index={index++} hovered={hover === trip.id}>
                        <Link
                          className="dir-row"
                          href={`/map?lon=${trip.longitude}&lat=${trip.latitude}&z=${zoom}${yearQuery(year)}`}
                          onMouseEnter={() => setHover(trip.id)}
                          onFocus={() => setHover(trip.id)}
                          onBlur={() => setHover(null)}
                          aria-label={`${name ?? "Loading place name"}, ${when}, ${count} ${
                            count === 1 ? "photo" : "photos"
                          }. Open on the map`}
                        >
                          <span className="trip-when">{when}</span>
                          <span className="trip-place">{name ?? "Loading…"}</span>
                          <span>{String(count).padStart(2, "0")}</span>
                          <span className="trip-strip" aria-hidden="true">
                            {strip.map((p) => (
                              // eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail
                              <img key={p.id} src={p.thumb_url} alt="" loading="lazy" />
                            ))}
                            {count > strip.length && (
                              <span className="trip-more">+{count - strip.length}</span>
                            )}
                          </span>
                        </Link>
                      </DirItem>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
