"use client";

import { useEffect, useRef, useState } from "react";
import {
  CENTRE,
  DEFAULT_LANDING_PHOTO,
  focusFor,
  objectPosition,
  type Focus,
  type LandingPhotoSetting,
} from "@/lib/landingPhoto";
import { colors, PIN_COLOR, type Theme } from "./theme";

interface PickerPhoto {
  id: string;
  friendly_name: string;
  caption: string | null;
  status: string;
  thumb_url: string;
  large_url: string;
  created_at: string | null;
}

// The crops the photo is seen in, scaled down. Desktop is the photo at its largest
// (globals.css, .landing-photo); on a phone it fills the width and whatever height the
// title leaves, so a tall phone and a short one both show.
const PREVIEWS = [
  { label: "Desktop", w: 420, h: 300 },
  { label: "Tall phone", w: 343, h: 330 },
  { label: "Short phone", w: 343, h: 150 },
];
const PREVIEW_SCALE = 0.6;

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * The photograph in front of the landing title: keep the newest upload or pin one, then
 * click (or drag, or use the arrow keys) on it to choose what the crop keeps in view.
 */
export default function LandingPhotoTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [photos, setPhotos] = useState<PickerPhoto[] | null>(null);
  const [saved, setSaved] = useState<LandingPhotoSetting>(DEFAULT_LANDING_PHOTO);
  // null: the newest upload.
  const [pinned, setPinned] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(CENTRE);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [photosRes, settingRes] = await Promise.all([
          fetch("/api/admin/photos"),
          fetch("/api/admin/settings/landing"),
        ]);
        if (!photosRes.ok) throw new Error(`photos: HTTP ${photosRes.status}`);
        const all: PickerPhoto[] = await photosRes.json();
        const published = all
          .filter((p) => p.status === "published")
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        let setting = DEFAULT_LANDING_PHOTO;
        let loadError: string | null = null;
        if (settingRes.ok) setting = (await settingRes.json()).setting;
        else loadError = `Couldn't load the saved choice (HTTP ${settingRes.status}).`;
        if (cancelled) return;
        // A pin on a photo since deleted or unpublished shows as the newest, as on the page.
        const pin = setting.photoId && published.some((p) => p.id === setting.photoId) ? setting.photoId : null;
        const shown = pin ?? published[0]?.id;
        setPhotos(published);
        setSaved(setting);
        setPinned(pin);
        setFocus(shown ? focusFor(setting, shown) : CENTRE);
        if (loadError) setStatus({ kind: "error", text: loadError });
      } catch (err: unknown) {
        if (cancelled) return;
        setPhotos([]);
        setStatus({ kind: "error", text: `Couldn't load photos (${err instanceof Error ? err.message : String(err)}).` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!photos) return <p style={{ color: c.muted, fontSize: 14 }}>Loading…</p>;
  if (photos.length === 0) {
    return (
      <p style={{ color: status.kind === "error" ? c.danger : c.muted, fontSize: 14 }}>
        {status.text ?? "No published photos yet. The newest one will stand in front of the title."}
      </p>
    );
  }

  const newest = photos[0];
  const shown = photos.find((p) => p.id === pinned) ?? newest;
  const savedPin = saved.photoId && photos.some((p) => p.id === saved.photoId) ? saved.photoId : null;
  const savedFocus = focusFor(saved, savedPin ?? newest.id);
  const changed = pinned !== savedPin || focus.x !== savedFocus.x || focus.y !== savedFocus.y;

  const choose = (id: string | null) => {
    setPinned(id);
    setFocus(focusFor(saved, id ?? newest.id));
    setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
  };

  const move = (next: Focus) => {
    setFocus({ x: clamp(next.x), y: clamp(next.y) });
    setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
  };

  const focusAt = (e: React.PointerEvent) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    move({ x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (!(e.key in d)) return;
    e.preventDefault();
    move({ x: focus.x + d[e.key][0], y: focus.y + d[e.key][1] });
  };

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const body: LandingPhotoSetting = { photoId: pinned, focus: { ...focus, photoId: shown.id } };
      const res = await fetch("/api/admin/settings/landing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaved(data.setting);
      setStatus({ kind: "saved", text: "Saved. The landing page shows it now." });
    } catch (err: unknown) {
      setStatus({ kind: "error", text: `Not saved: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

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

  const tile = (selected: boolean): React.CSSProperties => ({
    position: "relative",
    padding: 0,
    border: "none",
    outline: selected ? `2px solid ${c.text}` : "none",
    outlineOffset: 2,
    background: c.cardBg,
    cursor: "pointer",
    aspectRatio: "1",
    overflow: "hidden",
  });

  const heading: React.CSSProperties = { margin: 0, fontSize: 13, fontWeight: 600, color: c.text };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 900 }}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted, lineHeight: 1.5 }}>
        The photograph in front of the title on the landing page. Keep the newest upload, or pin
        one; then click on it to choose what the crop keeps in view.
      </p>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={heading}>Photo</h2>
        <div
          role="radiogroup"
          aria-label="Landing photo"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 10 }}
        >
          <button type="button" role="radio" aria-checked={pinned === null} onClick={() => choose(null)} style={tile(pinned === null)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
            <img src={newest.thumb_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.45 }} />
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 6,
                fontSize: 12,
                fontWeight: 600,
                color: c.text,
              }}
            >
              Newest upload
            </span>
          </button>
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pinned === p.id}
              aria-label={p.caption || p.friendly_name}
              title={p.caption || p.friendly_name}
              onClick={() => choose(p.id)}
              style={tile(pinned === p.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
              <img src={p.thumb_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: c.muted }}>
          {pinned === null
            ? `Showing the newest: ${shown.caption || shown.friendly_name}. A new upload takes its place, centred.`
            : `Pinned: ${shown.caption || shown.friendly_name}.`}
        </p>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: "1 1 320px", maxWidth: 480 }}>
          <h2 style={heading}>Focal point</h2>
          <div
            ref={frameRef}
            role="group"
            tabIndex={0}
            aria-label="Focal point"
            aria-describedby="focal-point-readout"
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              focusAt(e);
            }}
            onPointerMove={(e) => dragging.current && focusAt(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            style={{
              position: "relative",
              alignSelf: "flex-start",
              cursor: "crosshair",
              touchAction: "none",
              userSelect: "none",
              lineHeight: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- R2 large image */}
            <img
              src={shown.large_url}
              alt=""
              draggable={false}
              style={{ maxWidth: "100%", maxHeight: 480, width: "auto", height: "auto", display: "block" }}
            />
            <svg
              aria-hidden="true"
              width="26"
              height="26"
              viewBox="0 0 26 26"
              style={{
                position: "absolute",
                left: `${focus.x}%`,
                top: `${focus.y}%`,
                margin: "-13px 0 0 -13px",
                pointerEvents: "none",
                overflow: "visible",
              }}
            >
              <circle cx="13" cy="13" r="9" fill="none" stroke="#fff" strokeWidth="4" opacity="0.7" />
              <circle cx="13" cy="13" r="9" fill="none" stroke={PIN_COLOR} strokeWidth="2" />
              <path d="M13 0v6M13 20v6M0 13h6M20 13h6" stroke={PIN_COLOR} strokeWidth="2" />
            </svg>
          </div>
          <p id="focal-point-readout" aria-live="polite" style={{ margin: 0, fontSize: 12, color: c.muted, fontVariantNumeric: "tabular-nums" }}>
            {focus.x}% across, {focus.y}% down. Arrow keys nudge it; hold Shift for bigger steps.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={heading}>As it&rsquo;s cropped</h2>
          {PREVIEWS.map((v) => (
            <figure key={v.label} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- R2 large image */}
              <img
                src={shown.large_url}
                alt=""
                style={{
                  width: v.w * PREVIEW_SCALE,
                  height: v.h * PREVIEW_SCALE,
                  objectFit: "cover",
                  objectPosition: objectPosition(focus),
                  display: "block",
                  background: c.cardBg,
                }}
              />
              <figcaption style={{ fontSize: 12, color: c.muted }}>{v.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          style={btn(true, !changed || status.kind === "saving")}
          disabled={!changed || status.kind === "saving"}
          onClick={save}
        >
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          style={btn(false, !changed)}
          disabled={!changed}
          onClick={() => {
            setPinned(savedPin);
            setFocus(savedFocus);
          }}
        >
          Back to saved
        </button>
        <button
          type="button"
          style={btn(false, focus.x === CENTRE.x && focus.y === CENTRE.y)}
          disabled={focus.x === CENTRE.x && focus.y === CENTRE.y}
          onClick={() => move(CENTRE)}
        >
          Centre
        </button>
        {status.text && (
          <span role="status" style={{ fontSize: 13, color: status.kind === "error" ? c.danger : c.muted }}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
