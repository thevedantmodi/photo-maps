"use client";

import { useCallback, useEffect, useState } from "react";
import { colors, type Theme } from "./theme";
import { Hint, Kbd, useModKey } from "./Kbd";
import LocationSection from "./LocationSection";
import { formatCoord, parseLat, parseLon } from "@/lib/gps";
import {
  isValidRadius,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  type CustomPlace,
} from "@/lib/customPlaces";

/** Starting radius for a new place: about a small island or a reef section. */
const DEFAULT_RADIUS_KM = 25;

// Radii are always stored and sent in km; miles are a display-only choice,
// remembered per browser.
type Unit = "km" | "mi";
const KM_PER_MI = 1.609344;
const UNIT_KEY = "photo-maps:admin:radius-unit";

const toKm = (value: number, unit: Unit) => (unit === "mi" ? value * KM_PER_MI : value);
const fromKm = (km: number, unit: Unit) => (unit === "mi" ? km / KM_PER_MI : km);
/** Up to two decimals, without trailing zeros: 15.53, 25, 0.1. */
const formatRadius = (n: number) => String(Number(n.toFixed(2)));

function loadUnit(): Unit {
  try {
    return localStorage.getItem(UNIT_KEY) === "mi" ? "mi" : "km";
  } catch {
    return "km";
  }
}

function saveUnit(unit: Unit) {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // Storage unavailable — the choice just won't survive a reload.
  }
}

/** Stepper increment that scales with the radius, so both 2 and 200 are a few clicks away. */
function radiusStep(value: number): number {
  if (value < 10) return 1;
  if (value < 50) return 5;
  return 10;
}

/** One stepper click from `value`, snapped to the step grid (units don't matter here). */
function stepValue(value: number, dir: 1 | -1): number {
  // Stepping down from 10 should land on 9, not 5, so size the step from the lower side.
  const step = radiusStep(dir === 1 ? value : value - 1e-9);
  return dir === 1
    ? Math.floor(value / step + 1e-9) * step + step
    : Math.ceil(value / step - 1e-9) * step - step;
}

interface PlaceModalProps {
  /** null when adding a new place. */
  place: CustomPlace | null;
  theme: Theme;
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  onClose: () => void;
  onSaved: (saved: CustomPlace) => void;
}

function PlaceModal({ place, theme, unit, onUnitChange, onClose, onSaved }: PlaceModalProps) {
  const c = colors(theme);
  const mod = useModKey();
  const [name, setName] = useState(place?.name ?? "");
  const [lat, setLat] = useState(place ? formatCoord(place.latitude) : "");
  const [lon, setLon] = useState(place ? formatCoord(place.longitude) : "");
  const initialKm = place?.radiusKm ?? DEFAULT_RADIUS_KM;
  // What's in the box, in the display unit.
  const [radius, setRadius] = useState(formatRadius(fromKm(initialKm, unit)));
  // The exact km behind the box while it holds a converted or clamped value,
  // so flipping km ⇄ mi and saving doesn't drift 25 km to 24.99. Cleared on typing.
  const [exactKm, setExactKm] = useState<number | null>(initialKm);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const inputStyle = (invalid = false): React.CSSProperties => ({
    width: "100%",
    padding: "8px 12px",
    border: `1px solid ${invalid ? c.danger : c.inputBorder}`,
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
    background: c.input,
    color: c.text,
  });

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
    color: c.text,
  };

  const stepperBtn = (disabled: boolean, divider: "left" | "right"): React.CSSProperties => ({
    width: 38,
    flexShrink: 0,
    border: "none",
    [divider === "left" ? "borderLeft" : "borderRight"]: `1px solid ${c.inputBorder}`,
    background: c.cardBg,
    color: c.text,
    fontSize: 16,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });

  const latNum = parseLat(lat);
  const lonNum = parseLon(lon);
  const minDisplay = fromKm(MIN_RADIUS_KM, unit);
  const maxDisplay = fromKm(MAX_RADIUS_KM, unit);
  const radiusKm =
    exactKm ?? (radius.trim() === "" ? null : toKm(Number(radius), unit));
  const radiusInvalid = radiusKm !== null && !isValidRadius(radiusKm);
  const atMin = radiusKm !== null && radiusKm <= MIN_RADIUS_KM;
  const atMax = radiusKm !== null && radiusKm >= MAX_RADIUS_KM;

  const typeRadius = (text: string) => {
    setRadius(text);
    setExactKm(null);
  };

  const nudgeRadius = (dir: 1 | -1) => {
    const current =
      radiusKm !== null && Number.isFinite(radiusKm) ? fromKm(radiusKm, unit) : fromKm(DEFAULT_RADIUS_KM, unit);
    const next = stepValue(current, dir);
    // Pin the bounds to exact km so a clamped mile value can't round past them.
    if (next <= minDisplay) {
      setRadius(formatRadius(minDisplay));
      setExactKm(MIN_RADIUS_KM);
    } else if (next >= maxDisplay) {
      setRadius(formatRadius(maxDisplay));
      setExactKm(MAX_RADIUS_KM);
    } else {
      setRadius(formatRadius(next));
      setExactKm(null);
    }
  };

  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    if (radiusKm !== null && Number.isFinite(radiusKm)) {
      setRadius(formatRadius(fromKm(radiusKm, next)));
      setExactKm(radiusKm);
    }
    onUnitChange(next);
  };

  const canSave =
    name.trim() !== "" &&
    latNum !== null &&
    lonNum !== null &&
    radiusKm !== null &&
    !radiusInvalid;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setStatusMsg("Error: a place needs a name, a pin on the map, and a radius.");
      return;
    }
    setSaving(true);
    setStatusMsg("");
    try {
      const res = await fetch(
        place ? `/api/admin/places/${place.id}` : "/api/admin/places",
        {
          method: place ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            lat: latNum,
            lon: lonNum,
            radius_km: radiusKm,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      onSaved(await res.json());
      onClose();
    } catch (err: unknown) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [canSave, latNum, lonNum, name, onClose, onSaved, place, radiusKm]);

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
          borderRadius: 10,
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
            {place ? `Edit: ${place.name}` : "New place"}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: c.muted, padding: 0 }}
          >
            ×
          </button>
        </div>

        <label style={labelStyle}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Great Barrier Reef"
          autoFocus
          style={{ ...inputStyle(), marginBottom: 16 }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <label style={{ ...labelStyle, marginBottom: 0 }}>Radius</label>
          {/* Display only: the saved value is always km. */}
          <div
            role="radiogroup"
            aria-label="Radius unit"
            style={{
              display: "flex",
              padding: 2,
              gap: 2,
              borderRadius: 6,
              background: c.chipBg,
            }}
          >
            {(["km", "mi"] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                onClick={() => switchUnit(u)}
                style={{
                  padding: "2px 10px",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: unit === u ? 600 : 400,
                  background: unit === u ? c.input : "transparent",
                  color: unit === u ? c.text : c.muted,
                  boxShadow: unit === u ? `0 0 0 1px ${c.inputBorder}` : "none",
                  cursor: "pointer",
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        {/* Text input plus our own − / + instead of type="number", whose
            native spinner can't be styled to match the admin theme. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            border: `1px solid ${radiusInvalid ? c.danger : c.inputBorder}`,
            borderRadius: 6,
            background: c.input,
            overflow: "hidden",
            marginBottom: radiusInvalid ? 4 : 6,
          }}
        >
          <button
            type="button"
            onClick={() => nudgeRadius(-1)}
            disabled={atMin}
            aria-label="Decrease radius"
            style={stepperBtn(atMin, "right")}
          >
            −
          </button>
          <input
            value={radius}
            onChange={(e) => typeRadius(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                nudgeRadius(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
            inputMode="decimal"
            aria-label={unit === "mi" ? "Radius in miles" : "Radius in kilometres"}
            aria-invalid={radiusInvalid}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "8px 12px",
              border: "none",
              outline: "none",
              background: "transparent",
              color: c.text,
              fontSize: 14,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <span
            style={{
              alignSelf: "center",
              paddingRight: 10,
              fontSize: 13,
              color: c.muted,
            }}
          >
            {unit}
          </span>
          <button
            type="button"
            onClick={() => nudgeRadius(1)}
            disabled={atMax}
            aria-label="Increase radius"
            style={stepperBtn(atMax, "left")}
          >
            +
          </button>
        </div>
        {radiusInvalid && (
          <p style={{ margin: "0 0 6px", fontSize: 12, color: c.danger }}>
            Radius must be between {formatRadius(minDisplay)} and {formatRadius(maxDisplay)} {unit}.
          </p>
        )}
        <Hint theme={theme} style={{ marginBottom: 16 }}>
          <span>Photo groups inside the circle take this name. Nearest place wins where circles overlap.</span>
        </Hint>

        <LocationSection
          theme={theme}
          lat={lat}
          lon={lon}
          onChange={(nextLat, nextLon) => {
            setLat(nextLat);
            setLon(nextLon);
          }}
          radiusKm={radiusInvalid ? null : radiusKm}
          height={240}
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
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            style={{
              flex: 2,
              padding: "9px",
              background: c.btn,
              color: c.btnText,
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              cursor: saving || !canSave ? "not-allowed" : "pointer",
              opacity: saving || !canSave ? 0.5 : 1,
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

export default function PlacesTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [places, setPlaces] = useState<CustomPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  // undefined = closed, null = adding, a place = editing it.
  const [editing, setEditing] = useState<CustomPlace | null | undefined>(undefined);
  // Only mounts after the Places tab is clicked, so reading storage here can't mismatch SSR.
  const [unit, setUnit] = useState<Unit>(loadUnit);

  const changeUnit = (next: Unit) => {
    setUnit(next);
    saveUnit(next);
  };

  // loading starts true, so there is nothing to set before the fetch resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/places");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setPlaces(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (place: CustomPlace) => {
    if (!confirm(`Delete "${place.name}"?`)) return;
    setDeleting(place.id);
    const res = await fetch(`/api/admin/places/${place.id}`, { method: "DELETE" });
    if (res.ok) setPlaces((prev) => prev.filter((p) => p.id !== place.id));
    setDeleting(null);
  };

  const handleSaved = (saved: CustomPlace) => {
    setPlaces((prev) => {
      const next = prev.some((p) => p.id === saved.id)
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  if (loading) return <p style={{ color: c.muted, fontSize: 14 }}>Loading…</p>;
  if (loadError) {
    return (
      <p style={{ color: c.danger, fontSize: 14 }}>
        Error loading places: {loadError}
      </p>
    );
  }

  const iconBtn: React.CSSProperties = {
    background: "none",
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 4,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontSize: 13,
    color: c.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  return (
    <>
      {editing !== undefined && (
        <PlaceModal
          place={editing}
          theme={theme}
          unit={unit}
          onUnitChange={changeUnit}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
        />
      )}

      <Hint theme={theme} style={{ marginBottom: 12 }}>
        <span>
          Names for spots Mapbox leaves unlabeled. They show in the sidebar and
          search on the next page load. No deploy needed.
        </span>
      </Hint>

      <button
        onClick={() => setEditing(null)}
        style={{
          width: "100%",
          padding: "10px",
          background: c.btn,
          color: c.btnText,
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        + Add place
      </button>

      {places.length === 0 ? (
        <p style={{ color: c.muted, fontSize: 14 }}>No custom places yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {places.map((place) => (
            <div
              key={place.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: c.cardBg,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: c.text }}>
                  {place.name}
                </div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>
                  {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)} · {formatRadius(fromKm(place.radiusKm, unit))} {unit}
                </div>
              </div>
              <button onClick={() => setEditing(place)} style={iconBtn} title="Edit">
                ✎
              </button>
              <button
                onClick={() => handleDelete(place)}
                disabled={deleting === place.id}
                style={iconBtn}
                title="Delete"
              >
                {deleting === place.id ? "…" : "×"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
