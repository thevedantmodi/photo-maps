"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTheme, type Theme } from "../hooks/useTheme";
import { shareCardPath } from "@/lib/shareVersion";

interface ShareButtonProps {
  slug: string;
  caption: string;
  /** shareVersion() of the photo: a new value means a new card URL, so no stale CDN hit. */
  version: string;
  className?: string;
}

type Status = "idle" | "building" | "ready" | "shared" | "error";

const LABEL: Record<Status, string> = {
  idle: "Copy link and build a story card",
  building: "Building the story card…",
  ready: "Share the story card",
  shared: "Link copied",
  error: "Something went wrong, try again",
};

// Which line of the reel each status shows: Share, Building card…, Link copied, Try again,
// Card ready (the card landed after the phone stopped honouring the tap).
const REEL: Record<Status, number> = { idle: 0, building: 1, shared: 2, error: 3, ready: 4 };

const ShareButton = ({ slug, caption, version, className }: ShareButtonProps) => {
  const [theme] = useTheme();
  const [status, setStatus] = useState<Status>("idle");
  // The card follows the theme on screen, so each theme keeps its own file.
  const files = useRef<Partial<Record<Theme, File>>>({});
  const pending = useRef<Partial<Record<Theme, Promise<File>>>>({});
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const settle = useCallback((next: Status, after: number) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus(next), after);
  }, []);

  const build = useCallback(
    (t: Theme): Promise<File> => {
      const existing = pending.current[t];
      if (existing) return existing;
      const p = fetch(shareCardPath(slug, version, t))
        .then(async (res) => {
          if (!res.ok) throw new Error(`share image failed: ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], `${slug}.png`, { type: "image/png" });
          files.current[t] = file;
          return file;
        })
        .catch((err) => {
          delete pending.current[t];
          throw err;
        });
      pending.current[t] = p;
      return p;
    },
    [slug, version],
  );

  const warm = useCallback(() => {
    if (!files.current[theme] && !pending.current[theme]) build(theme).catch(() => {});
  }, [build, theme]);

  // Touch devices never hover, so build the card as soon as the photo opens — otherwise
  // the first tap only builds it and a second tap is needed to actually share.
  useEffect(warm, [warm]);

  const deliver = useCallback(
    (file: File) => {
      // navigator.share needs transient user activation, so this must run in the click
      // handler without an await in front of it — hence the two-phase flow above.
      if (navigator.canShare?.({ files: [file] })) {
        navigator
          .share({ files: [file], text: caption })
          .then(() => {
            setStatus("shared");
            settle("idle", 2000);
          })
          .catch((err: unknown) => {
            // Share sheet dismissed.
            if (err instanceof DOMException && err.name === "AbortError") {
              setStatus("idle");
              return;
            }
            // Activation lapsed while the card was still building: the next tap shares instantly.
            if (err instanceof DOMException && err.name === "NotAllowedError") {
              setStatus("ready");
              return;
            }
            // Share sheet unavailable: fall back to a plain tab.
            window.open(URL.createObjectURL(file), "_blank", "noopener");
            setStatus("shared");
            settle("idle", 2000);
          });
        return;
      }
      window.open(URL.createObjectURL(file), "_blank", "noopener");
      setStatus("shared");
      settle("idle", 2000);
    },
    [caption, settle],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (status === "building") return;

      // The link sticker is what converts on a Story, and only the poster can add it — so
      // the URL goes to the clipboard on the first tap, while activation is still fresh.
      const permalink = `${window.location.origin}/p/${encodeURIComponent(slug)}`;
      navigator.clipboard?.writeText(permalink).catch(() => {});

      const ready = files.current[theme];
      if (ready) {
        deliver(ready);
        return;
      }

      // Card still in flight: share the moment it lands. Activation usually outlives a
      // short wait; if it doesn't, deliver() drops back to "ready" for one more tap.
      setStatus("building");
      build(theme)
        .then(deliver)
        .catch((err) => {
          console.error(err);
          setStatus("error");
          settle("idle", 2500);
        });
    },
    [build, deliver, settle, slug, status, theme],
  );

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-disabled={status === "building"}
      aria-label={LABEL[status]}
    >
      <span className="share-reel" aria-hidden="true">
        <span style={{ transform: `translateY(${-1.35 * REEL[status]}em)` }}>
          <span>Share</span>
          <span>Building card…</span>
          <span>Link copied</span>
          <span>Try again</span>
          <span>Card ready</span>
        </span>
      </span>
    </button>
  );
};

export default ShareButton;
