"use client";

import { useState } from "react";

import type { BackfillPhoto } from "@/lib/backfill";
import { hasCamera } from "@/lib/camera";
import { colors, type Theme } from "./theme";

const MY_CAMERAS = ["Sony α7C II", "Apple iPhone 16 Pro", "Apple iPhone 13 Pro", "DJI Mavic Air 2"];

export interface PickerPhoto extends BackfillPhoto {
  thumb_url: string;
}

/**
 * Setting the camera by eye, for photos with no original to read it from: select photos in
 * the grid (shift-click for a run) and press a camera. Lens is optional and applies with it.
 */
export default function CameraPicker({
  theme,
  photos,
  onSaved,
}: {
  theme: Theme;
  photos: PickerPhoto[];
  onSaved: (id: string, body: { camera: string; lens?: string }) => void;
}) {
  const c = colors(theme);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [lens, setLens] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "done" | "error"; text?: string }>({ kind: "idle" });

  const shown = photos
    .filter((p) => showAll || !hasCamera(p))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const lenses = [...new Set(photos.map((p) => p.lens).filter((l): l is string => Boolean(l)))].sort();
  const cameras = [...new Set([...MY_CAMERAS, ...photos.map((p) => p.camera).filter((x): x is string => Boolean(x))])];

  const click = (i: number, shift: boolean) => {
    const id = shown[i].id;
    setSelected((s) => {
      const next = new Set(s);
      if (shift && anchor !== null) {
        const on = !s.has(id) || s.has(shown[anchor].id);
        for (let j = Math.min(anchor, i); j <= Math.max(anchor, i); j++) {
          if (on) next.add(shown[j].id);
          else next.delete(shown[j].id);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(i);
    if (status.kind === "done") setStatus({ kind: "idle" });
  };

  const apply = async (camera: string) => {
    const ids = [...selected];
    const body: { camera: string; lens?: string } = { camera };
    if (lens.trim()) body.lens = lens.trim();
    setStatus({ kind: "saving", text: `Saving 0 of ${ids.length}…` });
    let done = 0;
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const res = await fetch(`/api/admin/photos/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
          onSaved(id, body);
        } catch {
          failed.push(id);
        }
        setStatus({ kind: "saving", text: `Saving ${++done} of ${ids.length}…` });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    setSelected(new Set(failed));
    setAnchor(null);
    setStatus(
      failed.length
        ? { kind: "error", text: `${failed.length} not saved (still selected); try again.` }
        : { kind: "done", text: `Set ${ids.length} to ${camera}${body.lens ? ` · ${body.lens}` : ""}.` },
    );
  };

  const busy = status.kind === "saving";
  const none = selected.size === 0;
  const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
    padding: "8px 14px",
    background: primary ? c.btn : "none",
    color: primary ? c.btnText : c.text,
    border: primary ? "none" : `1px solid ${c.inputBorder}`,
    borderRadius: 0,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });
  const input: React.CSSProperties = {
    font: "inherit",
    fontSize: 13,
    color: c.text,
    background: c.bg,
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 0,
    padding: "7px 8px",
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 16, color: c.text }}>Set by hand</h3>
      <p style={{ margin: 0, fontSize: 14, color: c.muted, lineHeight: 1.5, maxWidth: 720 }}>
        No originals? Select photos below (shift-click selects a run) and press the camera that
        took them. Add a lens first if you want it set too.
      </p>

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: c.bg,
          padding: "8px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <span style={{ fontSize: 13, color: c.text, minWidth: 90 }}>{selected.size} selected</span>
        {cameras.map((cam) => (
          <button key={cam} type="button" style={btn(true, none || busy)} disabled={none || busy} onClick={() => apply(cam)}>
            {cam}
          </button>
        ))}
        <input
          aria-label="Other camera"
          placeholder="Other camera"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          style={{ ...input, width: 140 }}
        />
        <button
          type="button"
          style={btn(false, none || busy || !other.trim())}
          disabled={none || busy || !other.trim()}
          onClick={() => apply(other.trim())}
        >
          Set
        </button>
        <input
          aria-label="Lens (optional)"
          placeholder="Lens (optional)"
          list="picker-lenses"
          value={lens}
          onChange={(e) => setLens(e.target.value)}
          style={{ ...input, width: 180 }}
        />
        <datalist id="picker-lenses">
          {lenses.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        {status.text && (
          <span role="status" style={{ fontSize: 13, color: status.kind === "error" ? c.danger : c.muted }}>
            {status.text}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 13, color: c.text }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show photos that already have a camera
        </label>
        <button type="button" style={btn(false, busy)} disabled={busy} onClick={() => setSelected(new Set(shown.map((p) => p.id)))}>
          Select all {shown.length}
        </button>
        <button type="button" style={btn(false, none || busy)} disabled={none || busy} onClick={() => setSelected(new Set())}>
          Clear selection
        </button>
      </div>

      {shown.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: c.muted }}>Every photo has a camera.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {shown.map((p, i) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={(e) => click(i, e.shiftKey)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  outline: on ? `3px solid ${c.btn}` : `1px solid ${c.border}`,
                  outlineOffset: on ? -3 : -1,
                  padding: 4,
                  userSelect: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
                <img
                  src={p.thumb_url}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", opacity: on ? 0.75 : 1 }}
                />
                <span style={{ fontSize: 11, color: c.muted, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.date ? p.date.slice(0, 10) : "No date"}
                  {p.camera ? ` · ${p.camera}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
