"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  describeFill,
  fillFor,
  matchFile,
  missingCamera,
  type BackfillPhoto,
  type FillOptions,
  type Match,
  type ReadFile,
} from "@/lib/backfill";
import { extractCamera } from "@/lib/camera";
import { EXIF_PARSE_OPTIONS, exifDateInputValue, extractExifDate, extractGps } from "@/lib/gps";
import { colors, type Theme } from "./theme";

interface ListPhoto extends BackfillPhoto {
  thumb_url: string;
}

interface Row {
  file: ReadFile;
  match: Match;
  /** The photo chosen for an ambiguous file, by id. */
  chosen: string | null;
  include: boolean;
  result?: "saved" | string;
}

/** How many files to read, and photos to save, at once. */
const AT_ONCE = 4;

async function inBatches<T>(items: T[], run: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await run(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
}

const KIND_LABEL: Record<Match["kind"], string> = {
  name: "Same filename",
  stem: "Same name, other format",
  time: "Same moment taken",
  ambiguous: "Pick the photo",
  none: "No match",
};

/**
 * Fills camera details (and, if asked, missing dates and places) for photos uploaded before
 * they were recorded, from the original files: dropped here, read in this browser (nothing
 * is uploaded) and matched to photos by filename, then by when and where they were taken.
 */
export default function BackfillTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [photos, setPhotos] = useState<ListPhoto[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [opts, setOpts] = useState<FillOptions>({ overwrite: false, datesAndPlaces: true });
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // photos starts null, so there is nothing to set before the fetch resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/photos");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ListPhoto[] = await res.json();
        if (!cancelled) setPhotos(data);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const readFiles = async (list: FileList | File[]) => {
    if (!photos) return;
    const files = Array.from(list).filter((f) => /^image\//.test(f.type) || /\.(heic|heif|dng|arw|cr2|cr3|nef|raf|orf|rw2)$/i.test(f.name));
    if (files.length === 0) return;
    const { default: exifr } = await import("exifr");
    const read: ReadFile[] = new Array(files.length);
    setReading({ done: 0, total: files.length });
    let done = 0;
    await inBatches(files, async (f, i) => {
      const exif = await exifr.parse(f, EXIF_PARSE_OPTIONS).catch(() => null);
      const taken = extractExifDate(exif);
      const gps = extractGps(exif);
      read[i] = {
        name: f.name,
        camera: extractCamera(exif),
        takenInput: taken ? exifDateInputValue(taken) : null,
        gps: gps ? { latitude: gps.latitude, longitude: gps.longitude } : null,
      };
      setReading({ done: ++done, total: files.length });
    });
    setReading(null);
    setRows(
      read.map((file) => {
        const match = matchFile(file, photos);
        return { file, match, chosen: match.photo?.id ?? null, include: match.kind === "name" || match.kind === "stem" || match.kind === "time" };
      }),
    );
  };

  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);

  // What each row would change, given the options and the photo it's matched to.
  const planned = rows.map((r) => {
    const photo = r.chosen ? byId.get(r.chosen) : undefined;
    const body = photo ? fillFor(r.file, photo, opts) : null;
    return { row: r, photo, body };
  });
  const toSave = planned.filter((p) => p.row.include && p.photo && p.body && p.row.result !== "saved");
  const counts = {
    ready: planned.filter((p) => p.photo && p.body).length,
    nothing: planned.filter((p) => p.photo && !p.body).length,
    pick: planned.filter((p) => p.row.match.kind === "ambiguous" && !p.photo).length,
    none: planned.filter((p) => p.row.match.kind === "none").length,
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    const jobs = toSave.map((p) => ({ index: rows.indexOf(p.row), photo: p.photo!, body: p.body! }));
    setSaving({ done: 0, total: jobs.length });
    let done = 0;
    await inBatches(jobs, async (job) => {
      try {
        const res = await fetch(`/api/admin/photos/${job.photo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(job.body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        // Keep the list current, so the "still missing" count and later rows see the change.
        setPhotos((ps) => ps && ps.map((p) => (p.id === job.photo.id ? ({ ...p, ...job.body } as ListPhoto) : p)));
        update(job.index, { result: "saved" });
      } catch (err: unknown) {
        update(job.index, { result: err instanceof Error ? err.message : String(err) });
      }
      setSaving({ done: ++done, total: jobs.length });
    });
    setSaving(null);
  };

  if (loadError) return <p style={{ color: c.danger, fontSize: 14 }}>Error loading photos: {loadError}</p>;
  if (!photos) return <p style={{ color: c.muted, fontSize: 14 }}>Loading…</p>;

  const stillMissing = missingCamera(photos);
  const small: React.CSSProperties = { fontSize: 12, color: c.muted };
  const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
    padding: "10px 20px",
    background: primary ? c.btn : "none",
    color: primary ? c.btnText : c.text,
    border: primary ? "none" : `1px solid ${c.inputBorder}`,
    borderRadius: 0,
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted, lineHeight: 1.5, maxWidth: 720 }}>
        Photos uploaded before camera details were recorded can get them from your original
        files. Choose the originals (exported unmodified from Photos, or straight off the card):
        they&apos;re read in this browser and nothing is uploaded. Each is matched to a photo by
        filename, then by when and where it was taken. {stillMissing.length} of {photos.length}{" "}
        photos have no camera details yet.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void readFiles(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${c.inputBorder}`,
          padding: "28px 20px",
          textAlign: "center",
          background: c.dropBg,
          fontSize: 14,
          color: c.muted,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span>Drop original files here, or</span>
        <button type="button" style={btn(false, !!reading)} disabled={!!reading} onClick={() => filesRef.current?.click()}>
          Choose files
        </button>
        <button type="button" style={btn(false, !!reading)} disabled={!!reading} onClick={() => folderRef.current?.click()}>
          Choose a folder
        </button>
        <input ref={filesRef} type="file" multiple accept="image/*,.heic,.heif,.dng" style={{ display: "none" }} onChange={(e) => e.target.files && readFiles(e.target.files)} />
        <input
          ref={folderRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => e.target.files && readFiles(e.target.files)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
      </div>

      {reading && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          Reading {reading.done} of {reading.total}…
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", fontSize: 14, color: c.text }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={opts.datesAndPlaces}
                onChange={(e) => setOpts((o) => ({ ...o, datesAndPlaces: e.target.checked }))}
              />
              Also fill missing dates and locations
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={opts.overwrite}
                onChange={(e) => setOpts((o) => ({ ...o, overwrite: e.target.checked }))}
              />
              Replace camera details already set
            </label>
          </div>

          <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
            {rows.length} files · {counts.ready} ready · {counts.nothing} already complete
            {counts.pick ? ` · ${counts.pick} to pick` : ""}
            {counts.none ? ` · ${counts.none} with no match` : ""}
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: c.text }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `1px solid ${c.text}` }}>
                  <th style={{ padding: "6px 8px 6px 0", width: 28 }}>
                    <span className="sr-only">Include</span>
                  </th>
                  <th style={{ padding: "6px 8px" }}>File</th>
                  <th style={{ padding: "6px 8px" }}>Photo</th>
                  <th style={{ padding: "6px 8px" }}>Matched by</th>
                  <th style={{ padding: "6px 8px" }}>Fills in</th>
                </tr>
              </thead>
              <tbody>
                {planned.map(({ row, photo, body }, i) => (
                  <tr key={`${row.file.name}-${i}`} style={{ borderBottom: `1px solid ${c.border}`, verticalAlign: "middle" }}>
                    <td style={{ padding: "6px 8px 6px 0" }}>
                      <input
                        type="checkbox"
                        aria-label={`Include ${row.file.name}`}
                        checked={row.include && !!photo && !!body}
                        disabled={!photo || !body || row.result === "saved"}
                        onChange={(e) => update(i, { include: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: "6px 8px", wordBreak: "break-all" }}>{row.file.name}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.match.kind === "ambiguous" ? (
                        <select
                          value={row.chosen ?? ""}
                          aria-label={`Photo for ${row.file.name}`}
                          onChange={(e) => update(i, { chosen: e.target.value || null, include: Boolean(e.target.value) })}
                          style={{ font: "inherit", color: c.text, background: c.bg, border: `1px solid ${c.inputBorder}`, borderRadius: 0, padding: "2px 4px" }}
                        >
                          <option value="">Choose…</option>
                          {row.match.candidates.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.friendly_name}
                              {p.date ? ` · ${p.date.slice(0, 10)}` : ""}
                            </option>
                          ))}
                        </select>
                      ) : photo ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
                          <img src={byId.get(photo.id)?.thumb_url} alt="" width={32} height={32} style={{ objectFit: "cover" }} />
                          {photo.friendly_name}
                        </span>
                      ) : (
                        <span style={small}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", color: row.match.kind === "none" ? c.muted : c.text }}>{KIND_LABEL[row.match.kind]}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.result === "saved" ? (
                        <span style={{ color: c.muted }}>Saved</span>
                      ) : row.result ? (
                        <span style={{ color: c.danger }}>Error: {row.result}</span>
                      ) : body ? (
                        describeFill(body)
                      ) : photo ? (
                        <span style={small}>Nothing new</span>
                      ) : (
                        <span style={small}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" style={btn(true, !toSave.length || !!saving)} disabled={!toSave.length || !!saving} onClick={save}>
              {saving ? `Saving ${saving.done} of ${saving.total}…` : `Save ${toSave.length} ${toSave.length === 1 ? "photo" : "photos"}`}
            </button>
            <button type="button" style={btn(false, !!saving)} disabled={!!saving} onClick={() => setRows([])}>
              Clear
            </button>
          </div>
        </>
      )}

      {stillMissing.length > 0 && rows.some((r) => r.result === "saved") && (
        <details>
          <summary style={{ fontSize: 13, cursor: "pointer", color: c.text }}>
            {stillMissing.length} {stillMissing.length === 1 ? "photo still has" : "photos still have"} no camera details
          </summary>
          <p style={{ fontSize: 13, color: c.muted, lineHeight: 1.6 }}>
            {stillMissing.map((p) => `${p.friendly_name}${p.original_name ? ` (${p.original_name})` : ""}`).join(", ")}
          </p>
        </details>
      )}
    </div>
  );
}
