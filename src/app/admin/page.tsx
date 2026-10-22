"use client";

import dynamic from "next/dynamic";
import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "../hooks/useTheme";
import SiteHeader from "../components/SiteHeader";
import { colors, type Theme } from "./theme";
import { Hint, Kbd, useModKey } from "./Kbd";
import LocationSection from "./LocationSection";
import PlacesTab from "./PlacesTab";
import LandingPhotoTab from "./LandingPhotoTab";
// Mapbox needs the browser; the tab only mounts once picked.
const HomeViewTab = dynamic(() => import("./HomeViewTab"), { ssr: false });
import { photoAlt } from "@/lib/alt";
import { GROUPS, SORTS, groupPhotos, sortPhotos, type Dir, type GroupKey, type SortKey } from "@/lib/adminView";
import { getLocationGroups } from "@/lib/locationGroups";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import type { CustomPlace } from "@/lib/customPlaces";
import type { Photo } from "../types";
import {
  EXIF_PARSE_OPTIONS,
  extractExifDate,
  extractGps,
  formatCoord,
  parseLat,
  parseLon,
  type ExifDate,
} from "@/lib/gps";

// The datetime-local value the server will end up storing for an EXIF date.
// Camera dates are wall-clock times that exifr revives in the browser's zone
// but the server reads as UTC, so the local reading is what gets saved; the
// GPS stamp is true UTC either way.
function exifDateInputValue({ date, utc }: ExifDate): string {
  if (utc) return date.toISOString().slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface AdminPhoto {
  id: string;
  friendly_name: string;
  caption: string | null;
  alt_text: string | null;
  status: string;
  thumb_url: string;
  date: string | null;
  created_at: string | null;
  lat: number | null;
  lon: number | null;
}

// The Manage grid's sort and grouping, remembered in this browser.
const VIEW_KEY = "photo-maps:admin-view";
interface ManageView {
  sort: SortKey;
  dir: Dir;
  group: GroupKey;
}
const DEFAULT_VIEW: ManageView = { sort: "taken", dir: "desc", group: "none" };
function loadView(): ManageView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (v && v.sort in SORTS && v.group in GROUPS && (v.dir === "asc" || v.dir === "desc")) return v;
  } catch {
    // Unreadable or blocked storage: the default view.
  }
  return DEFAULT_VIEW;
}
// How each sort reads either way, for the button that reverses it.
const DIR_LABEL: Record<SortKey, [asc: string, desc: string]> = {
  taken: ["Oldest first", "Newest first"],
  uploaded: ["Oldest first", "Newest first"],
  name: ["A–Z", "Z–A"],
  caption: ["A–Z", "Z–A"],
  place: ["A–Z", "Z–A"],
  alt: ["A–Z", "Z–A"],
};

function UploadTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const mod = useModKey();
  const [file, setFile] = useState<File | null>(null);
  const [friendlyName, setFriendlyName] = useState("");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  // The coordinates the picked file arrived with. Kept for the whole upload so
  // a stray click on the map can be undone, and so clearing the boxes reads as
  // "no location" rather than "the client failed to parse EXIF".
  const [exifCoords, setExifCoords] = useState<{
    lat: string;
    lon: string;
  } | null>(null);
  const [gpsSource, setGpsSource] = useState<"exif" | "manual" | null>(null);
  // Manual date, only sent when the photo has none. EXIF always wins on the
  // server, so when the file has a date the field just shows it.
  const [date, setDate] = useState("");
  const [exifDate, setExifDate] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const slugify = (name: string) =>
    name
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const handleFile = (f: File) => {
    setFile(f);
    setFriendlyName(slugify(f.name));
    setLat("");
    setLon("");
    setExifCoords(null);
    setGpsSource(null);
    setDate("");
    setExifDate(null);
    // Read the photo's own GPS with the same rules the processor uses, so the
    // map opens on the existing location when the file has one. exifr is
    // imported lazily to keep it out of the initial admin bundle.
    import("exifr")
      .then(({ default: exifr }) => exifr.parse(f, EXIF_PARSE_OPTIONS))
      .then((data) => {
        const exif = data as Record<string, unknown> | null;
        const taken = extractExifDate(exif);
        if (taken) setExifDate(exifDateInputValue(taken));
        const gps = extractGps(exif);
        if (!gps) return;
        const coords = {
          lat: formatCoord(gps.latitude),
          lon: formatCoord(gps.longitude),
        };
        setLat(coords.lat);
        setLon(coords.lon);
        setExifCoords(coords);
        setGpsSource("exif");
      })
      .catch((e) => console.warn("[exif] could not read metadata", e));
  };

  const handleLocationChange = (nextLat: string, nextLon: string) => {
    setLat(nextLat);
    setLon(nextLon);
    const backToExif =
      exifCoords != null &&
      nextLat === exifCoords.lat &&
      nextLon === exifCoords.lon;
    setGpsSource(
      backToExif ? "exif" : nextLat === "" && nextLon === "" ? null : "manual",
    );
  };

  const revertToExif = () => {
    if (!exifCoords) return;
    setLat(exifCoords.lat);
    setLon(exifCoords.lon);
    setGpsSource("exif");
  };

  const handleUpload = useCallback(async () => {
    if (!file || !friendlyName) return;
    setUploading(true);
    setProgress(10);
    try {
      const ext = file.name.substring(file.name.lastIndexOf("."));
      const originalKey = `originals/${friendlyName}${ext}`;

      setStatusMsg("Getting upload URL…");
      const urlRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: originalKey, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await urlRes.json();

      setStatusMsg("Uploading to R2…");
      setProgress(35);
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) throw new Error("R2 upload failed");

      setStatusMsg("Processing image…");
      setProgress(70);
      const latNum = parseLat(lat);
      const lonNum = parseLon(lon);
      const processRes = await fetch("/api/admin/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: originalKey,
          friendly_name: friendlyName,
          original_name: file.name,
          caption,
          alt_text: altText.trim() || null,
          lat: latNum,
          lon: lonNum,
          // The photo had GPS and the operator removed it: don't let the
          // server put the EXIF coordinates back.
          gps_cleared:
            exifCoords !== null && (latNum === null || lonNum === null),
          date: exifDate ? null : date || null,
        }),
      });
      if (!processRes.ok) {
        const err = await processRes.json();
        throw new Error(err.error || "Processing failed");
      }

      setProgress(100);
      setStatusMsg("Done! Photo published.");
      setFile(null);
      setFriendlyName("");
      setCaption("");
      setAltText("");
      setLat("");
      setLon("");
      setExifCoords(null);
      setGpsSource(null);
      setDate("");
      setExifDate(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err: unknown) {
      setStatusMsg(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setUploading(false);
    }
  }, [file, friendlyName, caption, altText, lat, lon, exifCoords, date, exifDate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        handleUpload();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUpload]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 0,
    fontSize: 14,
    boxSizing: "border-box",
    background: c.input,
    color: c.text,
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        style={{
          border: `2px dashed ${c.inputBorder}`,
          borderRadius: 0,
          padding: "36px 20px",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 20,
          background: file ? c.dropBgActive : c.dropBg,
          fontSize: 14,
          color: c.muted,
        }}
      >
        {file
          ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
          : "Drop photo here or click to select"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 4,
          color: c.text,
        }}
      >
        Slug
      </label>
      <input
        value={friendlyName}
        onChange={(e) => setFriendlyName(e.target.value)}
        placeholder="city-landmark"
        style={{ ...inputStyle, marginBottom: 16 }}
      />

      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 4,
          color: c.text,
        }}
      >
        Caption
      </label>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Optional caption"
        rows={3}
        style={{ ...inputStyle, marginBottom: 16, resize: "vertical" }}
      />

      <label
        htmlFor="upload-alt-text"
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 4,
          color: c.text,
        }}
      >
        Alt text
      </label>
      <textarea
        id="upload-alt-text"
        value={altText}
        onChange={(e) => setAltText(e.target.value)}
        placeholder={caption ? `Falls back to caption: “${caption}”` : "Describe what's in the photo"}
        rows={2}
        style={{ ...inputStyle, marginBottom: 4, resize: "vertical" }}
      />
      <div style={{ fontSize: 11, color: c.muted, marginBottom: 16 }}>
        {altText.trim() || caption
          ? "Read by screen readers and search engines."
          : "Missing — screen readers will only hear the date."}
      </div>

      <div style={{ marginBottom: 8 }}>
        <LocationSection
          theme={theme}
          lat={lat}
          lon={lon}
          onChange={handleLocationChange}
          badge={
            gpsSource === "exif"
              ? "From photo EXIF"
              : gpsSource === "manual"
                ? "Set manually"
                : null
          }
          revert={
            exifCoords && (lat !== exifCoords.lat || lon !== exifCoords.lon)
              ? {
                  label: "Revert to EXIF",
                  title: `Back to the photo's own coordinates (${exifCoords.lat}, ${exifCoords.lon})`,
                  onRevert: revertToExif,
                }
              : null
          }
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <label
          style={{ fontSize: 13, fontWeight: 500, color: c.text }}
        >
          Date &amp; Time
        </label>
        {exifDate && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 0,
              background: c.chipBg,
              color: c.chipText,
            }}
          >
            From photo EXIF
          </span>
        )}
      </div>
      <input
        value={exifDate ?? date}
        onChange={(e) => setDate(e.target.value)}
        disabled={exifDate !== null}
        title={
          exifDate
            ? "The photo's own date is used. Change it after upload from the Manage tab."
            : undefined
        }
        type="datetime-local"
        style={{
          ...inputStyle,
          marginBottom: 16,
          opacity: exifDate ? 0.6 : 1,
        }}
      />

      <button
        onClick={handleUpload}
        disabled={!file || !friendlyName || uploading}
        style={{
          width: "100%",
          padding: "10px",
          background: c.btn,
          color: c.btnText,
          border: "none",
          borderRadius: 0,
          fontSize: 14,
          cursor:
            !file || !friendlyName || uploading ? "not-allowed" : "pointer",
          opacity: !file || !friendlyName || uploading ? 0.5 : 1,
        }}
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>

      <Hint theme={theme} style={{ marginTop: 8, justifyContent: "center" }}>
        <span>Press</span>
        <Kbd theme={theme}>{mod}</Kbd>
        <Kbd theme={theme}>↵</Kbd>
        <span>to upload from anywhere on this tab.</span>
      </Hint>

      {uploading && (
        <div
          style={{
            marginTop: 12,
            background: c.progressBg,
            borderRadius: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 3,
              background: c.progressFill,
              width: `${progress}%`,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}

      {statusMsg && (
        <p
          style={{
            marginTop: 16,
            fontSize: 13,
            color: statusMsg.startsWith("Error") ? "#e55" : c.muted,
          }}
        >
          {statusMsg}
        </p>
      )}
    </div>
  );
}

interface EditModalProps {
  photo: AdminPhoto;
  theme: Theme;
  onClose: () => void;
  onSaved: (updated: AdminPhoto) => void;
}

function EditModal({ photo, theme, onClose, onSaved }: EditModalProps) {
  const c = colors(theme);
  const mod = useModKey();
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [altText, setAltText] = useState(photo.alt_text ?? "");
  const savedLat = photo.lat != null ? formatCoord(photo.lat) : "";
  const savedLon = photo.lon != null ? formatCoord(photo.lon) : "";
  const [lat, setLat] = useState(savedLat);
  const [lon, setLon] = useState(savedLon);
  const [date, setDate] = useState(
    photo.date ? new Date(photo.date).toISOString().slice(0, 16) : ""
  );
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [thumbUrl, setThumbUrl] = useState(photo.thumb_url);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 0,
    fontSize: 14,
    boxSizing: "border-box",
    background: c.input,
    color: c.text,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
    color: c.text,
  };

  const latNum = parseLat(lat);
  const lonNum = parseLon(lon);
  // Half a coordinate can't be plotted, so treat it as unsaveable.
  const coordsInvalid =
    (lat.trim() !== "" && latNum === null) ||
    (lon.trim() !== "" && lonNum === null) ||
    (latNum === null) !== (lonNum === null);

  const handleSave = useCallback(async () => {
    if (coordsInvalid) {
      setStatusMsg(
        "Error: enter a valid latitude and longitude, or clear both.",
      );
      return;
    }
    setSaving(true);
    setStatusMsg("");
    try {
      const body: Record<string, unknown> = {
        caption: caption || null,
        alt_text: altText.trim() || null,
        lat: latNum,
        lon: lonNum,
        date: date || null,
      };
      const res = await fetch(`/api/admin/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      onSaved({
        ...photo,
        caption: caption || null,
        alt_text: altText.trim() || null,
        lat: latNum,
        lon: lonNum,
        date: date || null,
      });
      onClose();
    } catch (err: unknown) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [altText, caption, coordsInvalid, date, latNum, lonNum, onClose, onSaved, photo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, onClose]);

  const handleRotate = async (degrees: number) => {
    setRotating(true);
    setStatusMsg("");
    try {
      const res = await fetch(`/api/admin/photos/${photo.id}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ degrees }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Rotation failed");
      }
      // Bust the cache by appending a timestamp
      setThumbUrl(`${photo.thumb_url}?t=${Date.now()}`);
      setStatusMsg("Rotated successfully.");
    } catch (err: unknown) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: c.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: c.modalBg,
          borderRadius: 0,
          padding: 24,
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: c.text }}>
            Edit: {photo.friendly_name}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: c.muted, padding: 0 }}
          >
            ×
          </button>
        </div>

        <img
          src={thumbUrl}
          alt={photoAlt({ alt_text: altText, caption, date })}
          style={{ width: "100%", borderRadius: 0, marginBottom: 16, objectFit: "cover", maxHeight: 200 }}
        />

        {/* Rotation controls */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Rotate</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "↺ 90° CCW", deg: 270 },
              { label: "↻ 90° CW", deg: 90 },
              { label: "↕ 180°", deg: 180 },
            ].map(({ label, deg }) => (
              <button
                key={deg}
                onClick={() => handleRotate(deg)}
                disabled={rotating}
                style={{
                  flex: 1,
                  padding: "7px 4px",
                  background: c.cardBg,
                  color: c.text,
                  border: `1px solid ${c.inputBorder}`,
                  borderRadius: 0,
                  fontSize: 13,
                  cursor: rotating ? "not-allowed" : "pointer",
                  opacity: rotating ? 0.5 : 1,
                }}
              >
                {rotating ? "…" : label}
              </button>
            ))}
          </div>
        </div>

        <label style={labelStyle}>Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Optional caption"
          rows={3}
          style={{ ...inputStyle, marginBottom: 16, resize: "vertical" }}
        />

        <label style={labelStyle} htmlFor="edit-alt-text">
          Alt text
        </label>
        <textarea
          id="edit-alt-text"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          placeholder={caption ? `Falls back to caption: “${caption}”` : "Describe what's in the photo"}
          rows={2}
          style={{ ...inputStyle, marginBottom: 4, resize: "vertical" }}
        />
        <div style={{ fontSize: 11, color: c.muted, marginBottom: 16 }}>
          {altText.trim() || caption
            ? "Read by screen readers and search engines."
            : "Missing — screen readers will only hear the date."}
        </div>

        <LocationSection
          theme={theme}
          lat={lat}
          lon={lon}
          onChange={(nextLat, nextLon) => {
            setLat(nextLat);
            setLon(nextLon);
          }}
          badge={
            lat !== savedLat || lon !== savedLon
              ? "Edited — not saved yet"
              : savedLat !== ""
                ? "Saved location"
                : null
          }
          revert={
            savedLat !== "" && (lat !== savedLat || lon !== savedLon)
              ? {
                  label: "Revert",
                  title: `Back to the saved coordinates (${savedLat}, ${savedLon})`,
                  onRevert: () => {
                    setLat(savedLat);
                    setLon(savedLon);
                  },
                }
              : null
          }
          height={200}
        />

        <label style={labelStyle}>Date &amp; Time</label>
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="datetime-local"
          style={{ ...inputStyle, marginBottom: 20 }}
        />

        {statusMsg && (
          <p style={{ fontSize: 13, color: statusMsg.startsWith("Error") ? c.danger : c.muted, marginBottom: 12 }}>
            {statusMsg}
          </p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "9px",
              background: "none",
              color: c.text,
              border: `1px solid ${c.inputBorder}`,
              borderRadius: 0,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2,
              padding: "9px",
              background: c.btn,
              color: c.btnText,
              border: "none",
              borderRadius: 0,
              fontSize: 14,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        <Hint theme={theme} style={{ marginTop: 10, justifyContent: "center" }}>
          <Kbd theme={theme}>{mod}</Kbd>
          <Kbd theme={theme}>↵</Kbd>
          <span>save</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <Kbd theme={theme}>Esc</Kbd>
          <span>close</span>
        </Hint>
      </div>
    </div>
  );
}

function ManageTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const mod = useModKey();
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPhoto | null>(null);
  // Narrow the grid to the photos that still need a date, to fill them in through Edit.
  const [onlyUndated, setOnlyUndated] = useState(false);
  const anyUndated = photos.some((p) => p.date == null);
  const listed = onlyUndated && anyUndated ? photos.filter((p) => p.date == null) : photos;

  const [view, setView] = useState<ManageView>(DEFAULT_VIEW);
  useEffect(() => setView(loadView()), []);
  const changeView = (next: Partial<ManageView>) => {
    setView((v) => {
      const merged = { ...v, ...next };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(merged));
      } catch {
        // Not remembered; it still applies now.
      }
      return merged;
    });
  };

  // Place names, by the same groups the map and Directory use, looked up only once a sort
  // or grouping by place needs them (custom places first, then Mapbox, cached).
  const usesPlace = view.sort === "place" || view.group === "place";
  const placeGroups = useMemo(() => {
    const byPhoto = new Map<string, string>();
    const groups = getLocationGroups(photos as unknown as Photo[]);
    for (const g of groups) for (const id of g.photoIds) byPhoto.set(id, g.id);
    return { byPhoto, groups };
  }, [photos]);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!usesPlace || !token) return;
    let cancelled = false;
    (async () => {
      const places: CustomPlace[] = await fetch("/api/admin/places")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      let next = 0;
      const worker = async () => {
        while (!cancelled && next < placeGroups.groups.length) {
          const g = placeGroups.groups[next++];
          const name = await reverseGeocode(g.longitude, g.latitude, token, places);
          if (cancelled) return;
          setPlaceNames((prev) => ({ ...prev, [g.id]: name }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, placeGroups.groups.length) }, worker));
    })();
    return () => {
      cancelled = true;
    };
  }, [usesPlace, placeGroups]);
  const placeOf = useCallback(
    (p: { id: string }) => {
      const g = placeGroups.byPhoto.get(p.id);
      return g ? (placeNames[g] ?? null) : null;
    },
    [placeGroups, placeNames],
  );

  const grouped = useMemo(
    () => groupPhotos(sortPhotos(listed, view.sort, view.dir, placeOf), view.group, view.dir, placeOf),
    [listed, view, placeOf],
  );

  // loading starts true, so there is nothing to set before the fetch resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/photos");
      const data = await res.json();
      if (cancelled) return;
      setPhotos(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (photo: AdminPhoto) => {
    if (!confirm(`Delete "${photo.friendly_name}"?`)) return;
    setDeleting(photo.id);
    await fetch(`/api/admin/photos/${photo.id}`, { method: "DELETE" });
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setDeleting(null);
  };

  const handleSaved = (updated: AdminPhoto) => {
    setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  if (loading) return <p style={{ color: c.muted, fontSize: 14 }}>Loading…</p>;

  return (
    <>
      {editing && (
        <EditModal
          photo={editing}
          theme={theme}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <Hint theme={theme} style={{ marginBottom: 12 }}>
        <span>Open ✎ to edit a photo&apos;s location —</span>
        <Kbd theme={theme}>{mod}</Kbd>
        <Kbd theme={theme}>↵</Kbd>
        <span>saves,</span>
        <Kbd theme={theme}>Esc</Kbd>
        <span>closes.</span>
      </Hint>
      {anyUndated && (
        <div role="group" aria-label="Show" className="theme-switch filter-switch" style={{ marginBottom: 12 }}>
          <button type="button" className="text-btn" aria-pressed={!onlyUndated} onClick={() => setOnlyUndated(false)}>
            All
          </button>
          <span className="sep" aria-hidden="true">
            |
          </span>
          <button type="button" className="text-btn" aria-pressed={onlyUndated} onClick={() => setOnlyUndated(true)}>
            Needs a date
          </button>
        </div>
      )}
      <div className="admin-view">
        <label className="admin-view-field">
          <span className="label">Sort</span>
          <select value={view.sort} onChange={(e) => changeView({ sort: e.target.value as SortKey })}>
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORTS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-btn"
            onClick={() => changeView({ dir: view.dir === "asc" ? "desc" : "asc" })}
            aria-label={`${DIR_LABEL[view.sort][view.dir === "asc" ? 0 : 1]}. Reverse the order`}
          >
            {DIR_LABEL[view.sort][view.dir === "asc" ? 0 : 1]} ↕
          </button>
        </label>
        <div className="admin-view-field">
          <span className="label" id="group-by">
            Group
          </span>
          <div role="group" aria-labelledby="group-by" className="theme-switch filter-switch">
            {(Object.keys(GROUPS) as GroupKey[]).map((k, i) => (
              <Fragment key={k}>
                {i > 0 && (
                  <span className="sep" aria-hidden="true">
                    |
                  </span>
                )}
                <button
                  type="button"
                  className="text-btn"
                  aria-pressed={view.group === k}
                  onClick={() => changeView({ group: k })}
                >
                  {GROUPS[k]}
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      {grouped.map((g) => (
        <section key={g.key} className="admin-group" aria-label={g.label || "Photos"}>
          {view.group !== "none" && (
            <h2 className="admin-group-head">
              <span>{g.label}</span>
              <span className="admin-group-count">{g.photos.length}</span>
            </h2>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {g.photos.map((photo) => (
              <div
                key={photo.id}
                style={{
                  position: "relative",
                  borderRadius: 0,
                  overflow: "hidden",
                  background: c.cardBg,
                }}
              >
                <img
                  src={photo.thumb_url}
                  alt={photoAlt(photo)}
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <div style={{ padding: "8px 10px" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.4,
                      marginBottom: 2,
                      color: c.text,
                    }}
                  >
                    {photo.friendly_name}
                  </div>
                  {photo.caption && (
                    <div
                      style={{ fontSize: 11, color: c.captionText, lineHeight: 1.4 }}
                    >
                      {photo.caption}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.4, marginTop: 2 }}>
                    {photo.lat != null && photo.lon != null
                      ? `${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}`
                      : "No GPS"}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      lineHeight: 1.4,
                      marginTop: 2,
                      // Missing, it stands out: an undated photo drops out of every year filter.
                      color: photo.date != null ? c.muted : c.danger,
                      fontWeight: photo.date != null ? undefined : 600,
                    }}
                  >
                    {photo.date != null ? new Date(photo.date).toLocaleDateString() : "No date"}
                  </div>
                  {!photo.alt_text && !photo.caption && (
                    <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.4, marginTop: 2 }}>
                      No alt text
                    </div>
                  )}
                </div>
                {/* Edit button */}
                <button
                  onClick={() => setEditing(photo)}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 34,
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 0,
                    width: 24,
                    height: 24,
                    cursor: "pointer",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Edit"
                >
                  ✎
                </button>
                {/* Delete button */}
                <button
                  onClick={() => handleDelete(photo)}
                  disabled={deleting === photo.id}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 0,
                    width: 24,
                    height: 24,
                    cursor: "pointer",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Delete"
                >
                  {deleting === photo.id ? "…" : "×"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "manage", label: "Manage" },
  { id: "places", label: "Places" },
  { id: "home", label: "Home view" },
  { id: "landing", label: "Landing photo" },
] as const;

export default function AdminPage() {
  const [theme] = useTheme();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("upload");

  return (
    <main className="admin">
      <SiteHeader current="admin" />
      <div className="admin-head">
        <h1 className="label">Admin</h1>
        <nav className="admin-tabs" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="text-btn ul"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="admin-body">
        {tab === "upload" && <UploadTab theme={theme} />}
        {tab === "manage" && <ManageTab theme={theme} />}
        {tab === "places" && <PlacesTab theme={theme} />}
        {tab === "home" && <HomeViewTab theme={theme} />}
        {tab === "landing" && <LandingPhotoTab theme={theme} />}
      </div>
    </main>
  );
}
