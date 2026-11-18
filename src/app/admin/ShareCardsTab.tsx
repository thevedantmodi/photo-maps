"use client";

import { useState } from "react";

import { colors, type Theme } from "./theme";

/**
 * Rebuilds every published photo's share card: each gets a new card URL, so nothing is
 * served from the CDN's old copy, and its card is rendered fresh the next time it's asked
 * for. One photo's card is rebuilt from its edit window instead.
 */
export default function ShareCardsTab({ theme }: { theme: Theme }) {
  const c = colors(theme);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const rebuildAll = async () => {
    if (!window.confirm("Rebuild the share card for every published photo?")) return;
    setBusy(true);
    setStatus("Rebuilding share cards…");
    try {
      const res = await fetch("/api/admin/share-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const n: number = data.rebuilt ?? 0;
      setStatus(
        `Done. ${n} ${n === 1 ? "photo has" : "photos have"} a new share card link; each card is drawn the first time it's opened or shared.`,
      );
    } catch (err: unknown) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted, lineHeight: 1.5, maxWidth: 720 }}>
        Share cards rebuild by themselves when you change something printed on them: the
        caption, date, location, camera or exposure. Rebuild them here when a card is out of
        date for another reason, such as a renamed place. Every card gets a new link, so
        nobody is shown the old one, and is drawn the next time it&apos;s opened or shared,
        which takes a couple of seconds the first time. To rebuild one photo&apos;s card, use
        Rebuild share card in its edit window under Manage.
      </p>
      <button
        type="button"
        onClick={rebuildAll}
        disabled={busy}
        style={{
          padding: "10px 20px",
          background: c.btn,
          color: c.btnText,
          border: "none",
          borderRadius: 0,
          fontSize: 14,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? "Rebuilding…" : "Rebuild all share cards"}
      </button>
      {status && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: status.startsWith("Error") ? c.danger : c.muted }}>
          {status}
        </p>
      )}
    </div>
  );
}
