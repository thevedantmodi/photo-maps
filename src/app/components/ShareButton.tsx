"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { shareCardPath } from "@/lib/shareVersion";

interface ShareButtonProps {
  slug: string;
  caption: string;
  /** shareVersion() of the photo: a new value means a new card URL, so no stale CDN hit. */
  version: string;
}

type Status = "idle" | "building" | "ready" | "shared" | "error";

const LABEL: Record<Status, string> = {
  idle: "Copy link and build a story card",
  building: "Building the story card…",
  ready: "Share the story card",
  shared: "Link copied",
  error: "Something went wrong, try again",
};

const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <path d="M16 6l-4-4-4 4" />
    <path d="M12 2v14" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="icon-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const ErrorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.82 21h16.36a2 2 0 0 0 1.71-3l-8.18-14.14a2 2 0 0 0-3.42 0z" />
  </svg>
);

const ICON: Record<Status, () => React.JSX.Element> = {
  idle: ShareIcon,
  building: SpinnerIcon,
  ready: ShareIcon,
  shared: CheckIcon,
  error: ErrorIcon,
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

  const warm = useCallback(() => {
    if (!fileRef.current && !pendingRef.current) build().catch(() => {});
  }, [build]);

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
          .then(() => setStatus("shared"))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              setStatus("ready");
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
          });
        return;
      }
      window.open(URL.createObjectURL(file), "_blank", "noopener");
      setStatus("shared");
    },
    [caption],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (status === "building") return;

      // The link sticker is what converts on a Story, and only the poster can add it — so
      // the URL goes to the clipboard on the first tap, while activation is still fresh.
      const permalink = `${window.location.origin}/p/${encodeURIComponent(slug)}`;
      navigator.clipboard?.writeText(permalink).catch(() => {});

      const ready = fileRef.current;
      if (ready) {
        deliver(ready);
        return;
      }

      // Card still in flight: share the moment it lands. Activation usually outlives a
      // short wait; if it doesn't, deliver() drops back to "ready" for one more tap.
      setStatus("building");
      build()
        .then(deliver)
        .catch((err) => {
          console.error(err);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2500);
        });
    },
    [build, deliver, slug, status],
  );

  const Icon = ICON[status];

  return (
    <button
      className="modal-share-btn"
      onClick={onClick}
      onPointerEnter={warm}
      onFocus={warm}
      disabled={status === "building"}
      aria-label={LABEL[status]}
    >
      <Icon />
    </button>
  );
};

export default ShareButton;
