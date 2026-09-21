"use client";

import { useCallback, useState } from "react";

interface ShareButtonProps {
  slug: string;
  caption: string;
}

type Status = "idle" | "working" | "copied" | "error";

const LABEL: Record<Status, string> = {
  idle: "Share",
  working: "Building…",
  copied: "Link copied",
  error: "Try again",
};

const ShareButton = ({ slug, caption }: ShareButtonProps) => {
  const [status, setStatus] = useState<Status>("idle");

  const share = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (status === "working") return;
      setStatus("working");

      const permalink = `${window.location.origin}/p/${encodeURIComponent(slug)}`;

      // The link sticker is what converts on a Story, and only the poster can add it —
      // so the URL goes to the clipboard whichever way the image is delivered.
      const copy = navigator.clipboard
        ?.writeText(permalink)
        .catch(() => {});

      try {
        const res = await fetch(`/api/share/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(`share image failed: ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], `${slug}.png`, { type: "image/png" });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text: caption });
        } else {
          window.open(URL.createObjectURL(blob), "_blank", "noopener");
        }

        await copy;
        setStatus("copied");
      } catch (err) {
        // A cancelled share sheet rejects with AbortError; that is not a failure.
        if (err instanceof DOMException && err.name === "AbortError") {
          setStatus("idle");
          return;
        }
        console.error(err);
        setStatus("error");
      }

      setTimeout(() => setStatus("idle"), 2500);
    },
    [slug, caption, status],
  );

  return (
    <button
      className="modal-share-btn"
      onClick={share}
      disabled={status === "working"}
      aria-label="Share this photo"
    >
      {LABEL[status]}
    </button>
  );
};

export default ShareButton;
