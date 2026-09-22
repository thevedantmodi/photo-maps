"use client";

import { useCallback, useRef, useState } from "react";
import { track } from "@vercel/analytics";

import { shareCardPath } from "@/lib/shareVersion";

interface ShareButtonProps {
  slug: string;
  caption: string;
  /** shareVersion() of the photo: a new value means a new card URL, so no stale CDN hit. */
  version: string;
}

type Status = "idle" | "building" | "ready" | "shared" | "error";

const LABEL: Record<Status, string> = {
  idle: "Share",
  building: "Building…",
  ready: "Share card",
  shared: "Link copied",
  error: "Try again",
};

const ShareButton = ({ slug, caption, version }: ShareButtonProps) => {
  const [status, setStatus] = useState<Status>("idle");
  const fileRef = useRef<File | null>(null);
  const pendingRef = useRef<Promise<File> | null>(null);

  const build = useCallback((): Promise<File> => {
    if (pendingRef.current) return pendingRef.current;
    const p = fetch(shareCardPath(slug, version))
      .then(async (res) => {
        if (!res.ok) throw new Error(`share image failed: ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], `${slug}.png`, { type: "image/png" });
        fileRef.current = file;
        return file;
      })
      .catch((err) => {
        pendingRef.current = null;
        throw err;
      });
    pendingRef.current = p;
    return p;
  }, [slug, version]);

  // Desktop gets the card built before the click ever lands.
  const warm = useCallback(() => {
    if (!fileRef.current && !pendingRef.current) build().catch(() => {});
  }, [build]);

  const deliver = useCallback(
    (file: File) => {
      // navigator.share needs transient user activation, so this must run in the click
      // handler without an await in front of it — hence the two-phase flow above.
      if (navigator.canShare?.({ files: [file] })) {
        navigator
          .share({ files: [file], text: caption })
          .then(() => {
            track("share_delivered", { slug, method: "native" });
            setStatus("shared");
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              setStatus("ready");
              return;
            }
            // Activation expired or the sheet is unavailable: fall back to a plain tab.
            window.open(URL.createObjectURL(file), "_blank", "noopener");
            track("share_delivered", { slug, method: "fallback" });
            setStatus("shared");
          });
        return;
      }
      window.open(URL.createObjectURL(file), "_blank", "noopener");
      track("share_delivered", { slug, method: "fallback" });
      setStatus("shared");
    },
    [caption, slug],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (status === "building") return;

      // The link sticker is what converts on a Story, and only the poster can add it — so
      // the URL goes to the clipboard on the first tap, while activation is still fresh.
      // UTM params ride along so Vercel Analytics can attribute the permalink pageview
      // back to a share, not just to whatever referrer the platform reports.
      const permalink = `${window.location.origin}/p/${encodeURIComponent(slug)}?utm_source=share&utm_medium=social&utm_campaign=photo_share`;
      navigator.clipboard?.writeText(permalink).catch(() => {});
      track("share_click", { slug });

      const ready = fileRef.current;
      if (ready) {
        deliver(ready);
        return;
      }

      setStatus("building");
      build()
        .then(() => setStatus("ready"))
        .catch((err) => {
          console.error(err);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2500);
        });
    },
    [build, deliver, slug, status],
  );

  return (
    <button
      className="modal-share-btn"
      onClick={onClick}
      onPointerEnter={warm}
      onFocus={warm}
      disabled={status === "building"}
      aria-label={
        status === "ready" ? "Share the story card" : "Copy link and build a story card"
      }
    >
      {LABEL[status]}
    </button>
  );
};

export default ShareButton;
