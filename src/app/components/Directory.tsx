"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useInView } from "./Reveal";
import SiteHeader from "./SiteHeader";
import { getLocationGroups } from "@/lib/locationGroups";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import type { CustomPlace } from "@/lib/customPlaces";
import type { Photo } from "../types";

interface DirectoryProps {
  photos: Photo[];
  places: CustomPlace[];
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
export default function Directory({ photos, places }: DirectoryProps) {
  const rows: Row[] = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return getLocationGroups(photos).map((g) => {
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
  }, [photos]);

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
    (async () => {
      // One request in flight at a time; cached names resolve before slow ones.
      for (const row of rows) {
        if (cancelled) return;
        const name = await reverseGeocode(row.longitude, row.latitude, token, places);
        if (cancelled) return;
        setNames((prev) => ({ ...prev, [row.id]: name }));
      }
    })();
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
          <p className="dir-empty">No located photos yet.</p>
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
                    href={`/map?lon=${row.longitude}&lat=${row.latitude}&z=${zoom}`}
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
                      {row.latest.caption || row.latest.original_name}
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
