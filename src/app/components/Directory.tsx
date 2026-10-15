"use client";

import { photoTitle } from "@/lib/alt";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useInView } from "./Reveal";
import SiteHeader from "./SiteHeader";
import YearFilter from "./YearFilter";
import { getLocationGroups } from "@/lib/locationGroups";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import { UNDATED, yearOf, yearQuery, yearValue } from "@/lib/yearParam";
import type { CustomPlace } from "@/lib/customPlaces";
import type { Photo } from "../types";

interface DirectoryProps {
  photos: Photo[];
  places: CustomPlace[];
  /** From ?year= in the address, already checked against the photos. */
  initialYear: number | null;
}

interface Row {
  id: string;
  longitude: number;
  latitude: number;
  count: number;
  years: string;
  latest: Photo;
}

function yearSpan(photos: Photo[]): string {
  const years = photos
    .map((p) => (p.date ? new Date(p.date).getFullYear() : NaN))
    .filter((y) => Number.isFinite(y));
  if (years.length === 0) return "";
  const from = Math.min(...years);
  const to = Math.max(...years);
  return from === to ? String(from) : `${from}–${to}`;
}

/** Most recent by date taken, falling back to upload time for undated photos. */
function newest(photos: Photo[]): Photo {
  return [...photos].sort((a, b) =>
    (b.date ?? b.created_at ?? "").localeCompare(a.date ?? a.created_at ?? ""),
  )[0];
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

/**
 * Every place on the map, by number of photographs: the same stable groups the map
 * uses, named by custom places or Mapbox (cached in this browser). A row opens the map
 * there. Hovering a row brings it forward and slides its newest photo alongside.
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

  const rows: Row[] = useMemo(() => {
    const byId = new Map(shown.map((p) => [p.id, p]));
    return getLocationGroups(shown).map((g) => {
      const members = g.photoIds.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
      return {
        id: g.id,
        longitude: g.longitude,
        latitude: g.latitude,
        count: g.count,
        years: yearSpan(members),
        latest: newest(members),
      };
    });
  }, [shown]);

  const [names, setNames] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<number | null>(null);
  // The preview stays mounted after the pointer leaves, so it can fade out in place.
  const [preview, setPreview] = useState<{ index: number; y: number } | null>(null);

  const show = (i: number, el: HTMLElement) => {
    setHover(i);
    // Centred on the row: the li's offset within the table, less half the preview's overhang.
    const li = el.parentElement;
    setPreview({ index: i, y: (li?.offsetTop ?? 0) - 48 });
  };

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || rows.length === 0) return;
    let cancelled = false;
    // Three lookups in flight at a time. One at a time let a single slow lookup (open
    // ocean, which searches outward in rings) hold up every row below it, even rows a
    // custom place or the cache could name at once.
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < rows.length) {
        const row = rows[next++];
        const name = await reverseGeocode(row.longitude, row.latitude, token, places);
        if (cancelled) return;
        setNames((prev) => ({ ...prev, [row.id]: name }));
      }
    };
    for (let i = 0; i < Math.min(3, rows.length); i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [rows, places]);

  const previewRow = preview ? rows[preview.index] : null;

  return (
    <main className="dir">
      <SiteHeader current="directory" />

      <div className="dir-head">
        <h1 className="label" style={{ margin: 0 }}>
          Directory
        </h1>
      </div>

      <YearFilter photos={photos} selectedYear={year} onYearChange={changeYear} />

      <div className="dir-table">
        <div className="dir-cols" aria-hidden="true">
          <span>No</span>
          <span>Place</span>
          <span className="dir-years">Years</span>
          <span>Works</span>
          <span className="dir-latest" style={{ fontStyle: "normal" }}>
            Most recent
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="dir-empty">
            {year === null
              ? "No located photos yet."
              : year === UNDATED
                ? "No located photos without a date."
                : `No located photos from ${year}.`}
          </p>
        ) : (
          <ol
            className="dir-list"
            data-hovering={hover !== null}
            onMouseLeave={() => setHover(null)}
          >
            {rows.map((row, i) => {
              const name = names[row.id];
              const zoom = row.count > 1 ? 9 : 12;
              return (
                <DirItem key={row.id} index={i} hovered={hover === i}>
                  <Link
                    className="dir-row"
                    href={`/map?lon=${row.longitude}&lat=${row.latitude}&z=${zoom}${yearQuery(year)}`}
                    onMouseEnter={(e) => show(i, e.currentTarget)}
                    onFocus={(e) => show(i, e.currentTarget)}
                    onBlur={() => setHover(null)}
                    aria-label={`${name ?? "Loading place name"}, ${row.count} ${
                      row.count === 1 ? "photo" : "photos"
                    }. Open on the map`}
                  >
                    <span>({String(i + 1).padStart(2, "0")})</span>
                    <span>{name ?? "Loading…"}</span>
                    <span className="dir-years">{row.years}</span>
                    <span>{row.count}</span>
                    <span className="dir-latest">
                      {photoTitle(row.latest)}
                    </span>
                  </Link>
                </DirItem>
              );
            })}
          </ol>
        )}

        {previewRow && preview && (
          // eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail
          <img
            className="dir-preview"
            data-on={hover !== null}
            src={previewRow.latest.thumb_url}
            alt=""
            style={{ "--y": `${preview.y}px` } as React.CSSProperties}
          />
        )}
      </div>
    </main>
  );
}
