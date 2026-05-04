"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "../hooks/useTheme";

interface AdminPhoto {
  id: string;
  friendly_name: string;
  caption: string | null;
  status: string;
  thumb_url: string;
  date: string | null;
  lat: number | null;
  lon: number | null;
}

type Theme = "light" | "dark";

function colors(theme: Theme) {
  return theme === "dark"
    ? {
        bg: "#0a0a0a",
        surface: "#1a1a1a",
        border: "#333",
        text: "#f0f0f0",
        muted: "#888",
        input: "#111",
        inputBorder: "#444",
        dropBg: "#111",
        dropBgActive: "#0d2d1a",
        btn: "#fff",
        btnText: "#000",
        cardBg: "#1e1e1e",
        captionText: "#aaa",
        progressBg: "#333",
        progressFill: "#fff",
        tabActive: "#fff",
        tabBorder: "#444",
        overlay: "rgba(0,0,0,0.75)",
        modalBg: "#1a1a1a",
        danger: "#e55",
      }
    : {
        bg: "#fff",
        surface: "#fff",
        border: "#eee",
        text: "#111",
        muted: "#999",
        input: "#fff",
        inputBorder: "#ddd",
        dropBg: "#fafafa",
        dropBgActive: "#f0fff4",
        btn: "#000",
        btnText: "#fff",
        cardBg: "#f5f5f5",
        captionText: "#666",
        progressBg: "#eee",
        progressFill: "#000",
        tabActive: "#000",
        tabBorder: "#eee",
        overlay: "rgba(0,0,0,0.5)",
        modalBg: "#fff",
        danger: "#c00",
      };
}

function UploadTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [file, setFile] = useState<File | null>(null);
  const [friendlyName, setFriendlyName] = useState("");
  const [caption, setCaption] = useState("");
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
      const processRes = await fetch("/api/admin/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: originalKey,
          friendly_name: friendlyName,
          original_name: file.name,
          caption,
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
      if (inputRef.current) inputRef.current.value = "";
    } catch (err: unknown) {
      setStatusMsg(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setUploading(false);
    }
  }, [file, friendlyName, caption]);

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
    borderRadius: 6,
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
          borderRadius: 8,
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
        style={{ ...inputStyle, marginBottom: 24, resize: "vertical" }}
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
          borderRadius: 6,
          fontSize: 14,
          cursor:
            !file || !friendlyName || uploading ? "not-allowed" : "pointer",
          opacity: !file || !friendlyName || uploading ? 0.5 : 1,
        }}
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>

      {uploading && (
        <div
          style={{
            marginTop: 12,
            background: c.progressBg,
            borderRadius: 4,
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
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [lat, setLat] = useState(photo.lat != null ? String(photo.lat) : "");
  const [lon, setLon] = useState(photo.lon != null ? String(photo.lon) : "");
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
    borderRadius: 6,
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

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg("");
    try {
      const body: Record<string, unknown> = {
        caption: caption || null,
        lat: lat !== "" ? parseFloat(lat) : null,
        lon: lon !== "" ? parseFloat(lon) : null,
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
        lat: lat !== "" ? parseFloat(lat) : null,
        lon: lon !== "" ? parseFloat(lon) : null,
        date: date || null,
      });
      onClose();
    } catch (err: unknown) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

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
          alt={photo.friendly_name}
          style={{ width: "100%", borderRadius: 6, marginBottom: 16, objectFit: "cover", maxHeight: 200 }}
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
                  borderRadius: 6,
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Latitude</label>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="e.g. 40.71280"
              type="number"
              step="any"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Longitude</label>
            <input
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="e.g. -74.00600"
              type="number"
              step="any"
              style={inputStyle}
            />
          </div>
        </div>

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
              borderRadius: 6,
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
              borderRadius: 6,
              fontSize: 14,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPhoto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/photos");
    setPhotos(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {photos.map((photo) => (
          <div
            key={photo.id}
            style={{
              position: "relative",
              borderRadius: 8,
              overflow: "hidden",
              background: c.cardBg,
            }}
          >
            <img
              src={photo.thumb_url}
              alt={photo.friendly_name}
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
              <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.4, marginTop: 2 }}>
                {photo.date != null
                  ? `${new Date(photo.date).toLocaleDateString()}`
                  : "No Date"}
              </div>
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
                borderRadius: 4,
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
                borderRadius: 4,
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
    </>
  );
}

export default function AdminPage() {
  const [theme, toggleTheme] = useTheme();
  const [tab, setTab] = useState<"upload" | "manage">("upload");

  const c = colors(theme);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: c.bg,
        color: c.text,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Admin</h1>
          <button
            onClick={toggleTheme}
            style={{
              background: "none",
              border: `1px solid ${c.inputBorder}`,
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 13,
              color: c.text,
            }}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 28,
            borderBottom: `1px solid ${c.tabBorder}`,
          }}
        >
          {(["upload", "manage"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 16px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? c.tabActive : c.muted,
                borderBottom:
                  tab === t
                    ? `2px solid ${c.tabActive}`
                    : "2px solid transparent",
                borderRadius: 0,
              }}
            >
              {t === "upload" ? "Upload" : "Manage"}
            </button>
          ))}
        </div>

        {tab === "upload" ? (
          <UploadTab theme={theme} />
        ) : (
          <ManageTab theme={theme} />
        )}
      </div>
    </main>
  );
}
