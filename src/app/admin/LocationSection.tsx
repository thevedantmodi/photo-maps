"use client";

import dynamic from "next/dynamic";
import { formatCoord, parseLat, parseLon, splitCoordPair } from "@/lib/gps";
import { colors, type Theme } from "./theme";
import { Hint, Kbd } from "./Kbd";

const MapPicker = dynamic(() => import("./MapPicker"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 220,
        borderRadius: 8,
        background: "rgba(128,128,128,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        opacity: 0.6,
      }}
    >
      Loading map…
    </div>
  ),
});

export interface LocationSectionProps {
  theme: Theme;
  /** Raw textbox values so partially typed input is never clobbered. */
  lat: string;
  lon: string;
  onChange: (lat: string, lon: string) => void;
  /** Short note about where the current coordinates came from. */
  badge?: string | null;
  /** Undo back to the coordinates the photo arrived with, when they differ. */
  revert?: { label: string; title?: string; onRevert: () => void } | null;
  height?: number;
}

export default function LocationSection({
  theme,
  lat,
  lon,
  onChange,
  badge,
  revert,
  height = 220,
}: LocationSectionProps) {
  const c = colors(theme);

  const latNum = parseLat(lat);
  const lonNum = parseLon(lon);
  const latInvalid = lat.trim() !== "" && latNum === null;
  const lonInvalid = lon.trim() !== "" && lonNum === null;
  const hasPin = latNum !== null && lonNum !== null;

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
    color: c.text,
  };

  const linkButtonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12,
    color: c.muted,
    cursor: "pointer",
    textDecoration: "underline",
  };

  const inputStyle = (invalid: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "8px 12px",
    border: `1px solid ${invalid ? c.danger : c.inputBorder}`,
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    background: c.input,
    color: c.text,
  });

  // Typing/pasting into either box. A pasted "40.7128, -74.006" fills both.
  const handleField = (field: "lat" | "lon", value: string) => {
    const pair = splitCoordPair(value);
    if (pair) {
      onChange(pair.lat, pair.lon);
      return;
    }
    if (field === "lat") onChange(value, lon);
    else onChange(lat, value);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <label style={{ ...labelStyle, marginBottom: 0 }}>Location</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {badge && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 10,
                background: c.chipBg,
                color: c.chipText,
              }}
            >
              {badge}
            </span>
          )}
          {revert && (
            <button
              type="button"
              onClick={revert.onRevert}
              title={revert.title}
              style={linkButtonStyle}
            >
              {revert.label}
            </button>
          )}
          {(lat !== "" || lon !== "") && (
            <button
              type="button"
              onClick={() => onChange("", "")}
              style={linkButtonStyle}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <MapPicker
          theme={theme}
          lat={latNum}
          lon={lonNum}
          height={height}
          onPick={(nextLat, nextLon) =>
            onChange(formatCoord(nextLat), formatCoord(nextLon))
          }
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div>
          <label style={labelStyle}>Latitude</label>
          <input
            value={lat}
            onChange={(e) => handleField("lat", e.target.value)}
            placeholder="e.g. 40.71280"
            inputMode="decimal"
            aria-invalid={latInvalid}
            style={inputStyle(latInvalid)}
          />
        </div>
        <div>
          <label style={labelStyle}>Longitude</label>
          <input
            value={lon}
            onChange={(e) => handleField("lon", e.target.value)}
            placeholder="e.g. -74.00600"
            inputMode="decimal"
            aria-invalid={lonInvalid}
            style={inputStyle(lonInvalid)}
          />
        </div>
      </div>

      {(latInvalid || lonInvalid) && (
        <p style={{ margin: "0 0 6px", fontSize: 12, color: c.danger }}>
          {latInvalid && lonInvalid
            ? "Latitude must be between -90 and 90, longitude between -180 and 180."
            : latInvalid
              ? "Latitude must be a number between -90 and 90."
              : "Longitude must be a number between -180 and 180."}
        </p>
      )}

      {!hasPin && !latInvalid && !lonInvalid && (lat !== "" || lon !== "") && (
        <p style={{ margin: "0 0 6px", fontSize: 12, color: c.muted }}>
          Both latitude and longitude are needed to place the photo on the map.
        </p>
      )}

      <Hint theme={theme}>
        <span>
          Click the map to drop a pin, or drag the pin to fine-tune. Paste
          “lat, lon” into either box to fill both.
        </span>
      </Hint>
      <Hint theme={theme} style={{ marginTop: 2 }}>
        <span>With the map focused:</span>
        <Kbd theme={theme}>↑</Kbd>
        <Kbd theme={theme}>↓</Kbd>
        <Kbd theme={theme}>←</Kbd>
        <Kbd theme={theme}>→</Kbd>
        <span>pan,</span>
        <Kbd theme={theme}>+</Kbd>
        <Kbd theme={theme}>−</Kbd>
        <span>zoom.</span>
      </Hint>
    </div>
  );
}
