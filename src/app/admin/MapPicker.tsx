"use client";

import { useCallback, useEffect, useRef } from "react";
import Map, { Marker, NavigationControl } from "react-map-gl/mapbox";
import type {
  MapRef,
  MapMouseEvent,
  MarkerDragEvent,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAP_STYLES } from "@/lib/mapStyles";
import { colors, PIN_COLOR, type Theme } from "./theme";

/** Zoom to settle on when a pin first appears (EXIF prefill or typed coords). */
const FOCUS_ZOOM = 9;
/** Wait this long after a keystroke before moving the camera. */
const FOCUS_DEBOUNCE_MS = 400;

export interface MapPickerProps {
  theme: Theme;
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
  height?: number;
}

export default function MapPicker({
  theme,
  lat,
  lon,
  onPick,
  height = 220,
}: MapPickerProps) {
  const c = colors(theme);
  const mapRef = useRef<MapRef>(null);
  // Set when the pin moved because of a map interaction, so the camera-follow
  // effect below doesn't fight the user's own click or drag.
  const selfUpdate = useRef(false);
  const hadPin = useRef(lat != null && lon != null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const pin = lat != null && lon != null ? { lat, lon } : null;

  const pick = useCallback(
    (nextLat: number, nextLon: number) => {
      selfUpdate.current = true;
      onPick(nextLat, nextLon);
    },
    [onPick],
  );

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => pick(e.lngLat.lat, e.lngLat.lng),
    [pick],
  );

  const handleDragEnd = useCallback(
    (e: MarkerDragEvent) => pick(e.lngLat.lat, e.lngLat.lng),
    [pick],
  );

  const recenter = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || lat == null || lon == null) return;
    map.easeTo({
      center: [lon, lat],
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      duration: 600,
    });
  }, [lat, lon]);

  // Follow coordinates that changed outside the map (EXIF prefill, typing,
  // pasting). Debounced so the camera doesn't jump on every keystroke.
  useEffect(() => {
    if (selfUpdate.current) {
      selfUpdate.current = false;
      hadPin.current = lat != null && lon != null;
      return;
    }
    if (lat == null || lon == null) {
      hadPin.current = false;
      return;
    }

    const appearing = !hadPin.current;
    hadPin.current = true;

    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const bounds = map.getBounds();
      const offscreen = !bounds || !bounds.contains([lon, lat]);
      if (!appearing && !offscreen) return;
      map.easeTo({
        center: [lon, lat],
        zoom: appearing ? Math.max(map.getZoom(), FOCUS_ZOOM) : map.getZoom(),
        duration: 600,
      });
    }, FOCUS_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [lat, lon]);

  const frame: React.CSSProperties = {
    height,
    borderRadius: 8,
    overflow: "hidden",
    border: `1px solid ${c.inputBorder}`,
    background: c.mapBg,
    position: "relative",
  };

  const overlay: React.CSSProperties = {
    position: "absolute",
    left: 10,
    top: 10,
    padding: "5px 9px",
    borderRadius: 6,
    border: "1px solid transparent",
    background:
      theme === "dark" ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.9)",
    color: c.text,
    fontSize: 12,
  };

  if (!token) {
    return (
      <div
        style={{
          ...frame,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 16,
          fontSize: 13,
          color: c.muted,
        }}
      >
        Map unavailable — set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to pick
        coordinates visually. You can still type them below.
      </div>
    );
  }

  return (
    <div className="map-picker" data-picker-theme={theme} style={frame}>
      <Map
        ref={mapRef}
        initialViewState={
          pin
            ? { longitude: pin.lon, latitude: pin.lat, zoom: FOCUS_ZOOM }
            : { longitude: -20, latitude: 25, zoom: 0.8 }
        }
        onClick={handleMapClick}
        mapStyle={MAP_STYLES[theme]}
        mapboxAccessToken={token}
        cursor="crosshair"
        // The public map renders as a globe; a flat projection is easier to
        // pin a point on in a box this size.
        projection="mercator"
        minZoom={0.5}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {pin && (
          <Marker
            longitude={pin.lon}
            latitude={pin.lat}
            anchor="bottom"
            draggable
            onDragEnd={handleDragEnd}
          >
            <svg
              width={26}
              height={34}
              viewBox="0 0 26 34"
              style={{ cursor: "grab", display: "block" }}
              aria-label="Photo location"
            >
              <path
                d="M13 1C7 1 2.5 5.6 2.5 11.3 2.5 19 13 33 13 33s10.5-14 10.5-21.7C23.5 5.6 19 1 13 1z"
                fill={PIN_COLOR}
                stroke="#fff"
                strokeWidth={2}
              />
              <circle cx={13} cy={11.3} r={3.6} fill="#fff" />
            </svg>
          </Marker>
        )}
      </Map>

      {/* Top-left so it never sits on top of the Mapbox logo. */}
      {pin ? (
        <button
          type="button"
          onClick={recenter}
          style={{ ...overlay, border: `1px solid ${c.inputBorder}`, cursor: "pointer" }}
          title="Center the map on the pin"
        >
          ⌖ Center on pin
        </button>
      ) : (
        <div style={{ ...overlay, pointerEvents: "none" }}>
          Click the map to drop a pin
        </div>
      )}
    </div>
  );
}
