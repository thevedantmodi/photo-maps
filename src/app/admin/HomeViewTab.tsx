"use client";

import { useCallback, useEffect, useState } from "react";
import Map, { NavigationControl, type ViewStateChangeEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAP_STYLES } from "@/lib/mapStyles";
import {
  DEFAULT_HOME_VIEW,
  HOME_ZOOM_MAX,
  HOME_ZOOM_MIN,
  frameZoom,
  homeZoom,
  type HomeView,
} from "@/lib/homeView";
import { colors, type Theme } from "./theme";

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

function describe(v: HomeView) {
  const lat = `${Math.abs(v.latitude).toFixed(2)}° ${v.latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(v.longitude).toFixed(2)}° ${v.longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon} · zoom ${v.zoom.toFixed(1)}`;
}

/**
 * Where the public map opens on a first visit: frame it here, as visitors will see it
 * (a globe, the same style), and save. Directory links and a view a tab remembers still
 * take precedence there.
 */
// The preview's size, so it shows the same stretch of the world as the public map does
// (home zooms are framed for a desktop-sized map; see frameZoom).
const PREVIEW_W = 900;
const PREVIEW_H = 420;
const toPreview = (v: HomeView): HomeView => ({ ...v, zoom: frameZoom(v.zoom, PREVIEW_W, PREVIEW_H) });
const fromPreview = (v: HomeView): HomeView => ({ ...v, zoom: homeZoom(v.zoom, PREVIEW_W, PREVIEW_H) });

export default function HomeViewTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [saved, setSaved] = useState<HomeView | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [view, setView] = useState<HomeView | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });

  // view starts null, so there is nothing to set before the fetch resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/home");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { view: HomeView; isDefault: boolean } = await res.json();
        if (cancelled) return;
        setSaved(data.view);
        setIsDefault(data.isDefault);
        setView(toPreview(data.view));
      } catch (err: unknown) {
        if (cancelled) return;
        // Still usable: start from New York, and saving will say what's wrong.
        setSaved(DEFAULT_HOME_VIEW);
        setView(toPreview(DEFAULT_HOME_VIEW));
        setStatus({ kind: "error", text: `Couldn't load the saved view (${err instanceof Error ? err.message : String(err)}).` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onMove = useCallback((e: ViewStateChangeEvent) => {
    const { longitude, latitude, zoom } = e.viewState;
    setView({ longitude, latitude, zoom });
    setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
  }, []);

  // `next` is a stored home view (not the preview's own zoom).
  const save = async (next: HomeView) => {
    setStatus({ kind: "saving" });
    try {
      const body: HomeView = {
        longitude: round(next.longitude, 5),
        latitude: round(next.latitude, 5),
        zoom: Math.min(HOME_ZOOM_MAX, Math.max(HOME_ZOOM_MIN, round(next.zoom, 2))),
      };
      const res = await fetch("/api/admin/settings/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaved(data.view);
      setIsDefault(false);
      setView(toPreview(data.view));
      setStatus({ kind: "saved", text: "Saved. New visitors open here." });
    } catch (err: unknown) {
      setStatus({ kind: "error", text: `Not saved: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  if (!view || !saved) return <p style={{ color: c.muted, fontSize: 14 }}>Loading…</p>;

  const framed = fromPreview(view);
  const changed =
    Math.abs(framed.longitude - saved.longitude) > 1e-4 ||
    Math.abs(framed.latitude - saved.latitude) > 1e-4 ||
    Math.abs(framed.zoom - saved.zoom) > 0.01;

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
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted, lineHeight: 1.5 }}>
        Where the map opens for someone arriving fresh. Move and zoom the map below to frame it,
        then save. Links from the Directory, and a view a tab already remembers, still open where
        they say.
      </p>

      {token ? (
        <div style={{ position: "relative", width: "100%", maxWidth: PREVIEW_W, height: PREVIEW_H, background: c.mapBg }}>
          <Map
            {...view}
            onMove={onMove}
            mapStyle={MAP_STYLES[theme]}
            mapboxAccessToken={token}
            projection="globe"
            minZoom={HOME_ZOOM_MIN}
            maxZoom={HOME_ZOOM_MAX}
            style={{ width: "100%", height: "100%" }}
            attributionControl={false}
          >
            <NavigationControl position="top-right" showCompass={false} />
          </Map>
          {/* The middle of the frame: the point the map opens centred on. */}
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 22 22"
            style={{ position: "absolute", left: "50%", top: "50%", margin: "-11px 0 0 -11px", pointerEvents: "none" }}
          >
            <path d="M11 0v8M11 14v8M0 11h8M14 11h8" stroke="#e5484d" strokeWidth="2" />
          </svg>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
          Map unavailable — set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to frame the view.
        </p>
      )}

      <div style={{ fontSize: 13, color: c.text, fontVariantNumeric: "tabular-nums" }}>
        {describe(framed)}
        <span style={{ color: c.muted }}>
          {" "}
          — saved: {isDefault ? "New York (the default)" : describe(saved)}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          style={btn(true, !changed || status.kind === "saving")}
          disabled={!changed || status.kind === "saving"}
          onClick={() => save(framed)}
        >
          {status.kind === "saving" ? "Saving…" : "Open the map here"}
        </button>
        <button type="button" style={btn(false, !changed)} disabled={!changed} onClick={() => setView(toPreview(saved))}>
          Back to saved
        </button>
        <button
          type="button"
          style={btn(false, status.kind === "saving")}
          disabled={status.kind === "saving"}
          onClick={() => save(DEFAULT_HOME_VIEW)}
        >
          Reset to New York
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
