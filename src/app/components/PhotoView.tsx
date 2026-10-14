"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "./SiteHeader";
import ShareButton from "./ShareButton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { closeTarget, forget, openOrigin, type Rect } from "@/lib/photoTransition";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import { shareVersion } from "@/lib/shareVersion";
import type { CustomPlace } from "@/lib/customPlaces";
import type { Photo } from "../types";

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";
const OPEN_MS = 380;
const CLOSE_MS = 320;
// The title follows the photo in, rather than arriving with it.
const DETAILS_DELAY_MS = 220;
// Never leave the details hidden, even if the photo fails to load.
const DETAILS_FALLBACK_MS = 600;
// Drag the photo down this far on a phone and letting go closes it.
const SWIPE_CLOSE_PX = 120;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The transform and clip that make the frame (at rest at `frame`) look exactly like the
 * square, cover-cropped thumbnail at `thumb`. The frame scales from its top-left corner
 * (transform-origin: 0 0 in globals.css) until it covers the thumbnail, centred on it, and
 * the clip trims it to the thumbnail's box.
 */
function thumbPose(thumb: Rect, frame: DOMRect) {
  const w = frame.width;
  const h = frame.height;
  const k = Math.max(thumb.width / w, thumb.height / h);
  const tx = thumb.left + thumb.width / 2 - (frame.left + (w * k) / 2);
  const ty = thumb.top + thumb.height / 2 - (frame.top + (h * k) / 2);
  const insetX = Math.max(0, (w - thumb.width / k) / 2);
  const insetY = Math.max(0, (h - thumb.height / k) / 2);
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${k})`,
    clipPath: `inset(${insetY}px ${insetX}px)`,
  };
}

interface PhotoViewProps {
  photo: Photo;
  places: CustomPlace[];
  /** "overlay": drawn over the map after a click there. "page": the standalone /p/<slug>. */
  mode: "overlay" | "page";
}

/**
 * The one photo page. Over the map it grows out of the thumbnail that was clicked and
 * shrinks back into it on close; on its own it simply appears. The title slides up after
 * the photo and the place, date and coordinates draw in one row at a time.
 */
export default function PhotoView({ photo, places, mode }: PhotoViewProps) {
  const router = useRouter();
  const slug = photo.friendly_name;
  const title = photo.caption || photo.original_name;
  const year = photo.date ? new Date(photo.date).getFullYear() : null;
  const date = formatDate(photo.date);
  const hasCoords = photo.lat != null && photo.lon != null;
  const isPhone = useMediaQuery("(max-width: 767px)");

  // Read once: where the clicked thumbnail sat, if this photo was just opened from the map.
  const [origin] = useState<Rect | null>(() => (mode === "overlay" ? openOrigin(slug) : null));
  const [details, setDetails] = useState(mode === "page");
  const [closing, setClosing] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [largeLoaded, setLargeLoaded] = useState(false);
  const [place, setPlace] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLImageElement>(null);
  const played = useRef(false);
  const closingRef = useRef(false);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // The thumbnail has the photo's proportions and is usually cached from the map, so it
  // sizes the frame before the large image arrives.
  const readRatio = useCallback((img: HTMLImageElement | null) => {
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setRatio(img.naturalWidth / img.naturalHeight);
    }
  }, []);

  useEffect(() => {
    if (probeRef.current?.complete) readRatio(probeRef.current);
  }, [readRatio]);

  // Fit the frame inside the figure, like object-fit: contain, and keep it fitted.
  useLayoutEffect(() => {
    const figure = figureRef.current;
    if (!figure || !ratio) return;
    const fit = () => {
      const fw = figure.clientWidth;
      const fh = figure.clientHeight;
      if (fw === 0 || fh === 0) return;
      setFrame(fw / fh > ratio ? { w: fh * ratio, h: fh } : { w: fw, h: fw / ratio });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(figure);
    return () => ro.disconnect();
  }, [ratio]);

  // Opening: grow out of the thumbnail, then bring in the details.
  useEffect(() => {
    if (mode !== "overlay") return;
    later(() => setDetails(true), origin ? DETAILS_FALLBACK_MS : 16);
  }, [mode, origin, later]);

  useLayoutEffect(() => {
    if (!frame || played.current) return;
    played.current = true;
    const el = frameRef.current;
    if (!el || !origin || reducedMotion()) return;
    const pose = thumbPose(origin, el.getBoundingClientRect());
    el.animate(
      [
        { transform: pose.transform, clipPath: pose.clipPath, filter: "grayscale(1)" },
        { transform: "none", clipPath: "inset(0px 0px)", filter: "grayscale(0)" },
      ],
      { duration: OPEN_MS, easing: EASE },
    );
    later(() => setDetails(true), DETAILS_DELAY_MS);
  }, [frame, origin, later]);

  // Over the map, focus moves into the photo page (announced by its title) so the
  // keyboard and screen readers follow it; Escape or Close returns to the map.
  useEffect(() => {
    if (mode === "overlay") rootRef.current?.focus({ preventScroll: true });
  }, [mode]);

  // The place name: a custom place, else Mapbox, cached in this browser.
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || photo.lat == null || photo.lon == null) return;
    let cancelled = false;
    reverseGeocode(photo.lon, photo.lat, token, places).then((name) => {
      if (!cancelled) setPlace(name);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.lat, photo.lon, places]);

  const mapHref = hasCoords ? `/map?lon=${photo.lon}&lat=${photo.lat}&z=12` : "/map";

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setDetails(false);
    const reduce = reducedMotion();

    if (mode === "page") {
      later(() => router.push(mapHref), reduce ? 0 : 200);
      return;
    }

    const finish = () => {
      forget(slug);
      router.back();
    };
    const target = closeTarget(slug);
    const el = frameRef.current;
    if (!target || !el || reduce) {
      later(finish, reduce ? 0 : 250);
      return;
    }

    const dragged = el.style.transform !== "";
    // A drag leaves the page half faded inline, which would beat the stylesheet's fade-out.
    const bg = bgRef.current;
    if (bg?.style.opacity) {
      bg.animate([{ opacity: bg.style.opacity }, { opacity: 0 }], { duration: 250, fill: "forwards" });
    }
    later(
      () => {
        // Measure the frame at rest, then fly from wherever it is (dragged or not).
        const start = el.style.transform || "none";
        el.style.transform = "";
        const pose = thumbPose(target, el.getBoundingClientRect());
        const anim = el.animate(
          [
            { transform: start, clipPath: "inset(0px 0px)", filter: "grayscale(0)" },
            { transform: pose.transform, clipPath: pose.clipPath, filter: "grayscale(1)" },
          ],
          { duration: CLOSE_MS, easing: EASE, fill: "forwards" },
        );
        let done = false;
        const once = () => {
          if (done) return;
          done = true;
          finish();
        };
        anim.onfinish = once;
        later(once, CLOSE_MS + 120);
      },
      dragged ? 0 : 140,
    );
  }, [mode, slug, router, mapHref, later]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Phones: drag the photo down to close it. It follows the finger and shrinks a little;
  // short of the threshold it springs back.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || closingRef.current) return;
    // A spring-back or the opening growth still running would override the drag.
    frameRef.current?.getAnimations().forEach((a) => a.cancel());
    drag.current = { startY: e.clientY, dy: 0 };
    rootRef.current?.setAttribute("data-dragging", "true");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the drag simply won't be captured.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    const p = Math.min(d.dy / 300, 1);
    const s = 1 - p * 0.35;
    el.style.transform = `translate(${(el.offsetWidth * (1 - s)) / 2}px, ${d.dy}px) scale(${s})`;
    if (mode === "overlay" && bgRef.current) bgRef.current.style.opacity = String(1 - p * 0.85);
    // The title and details fade out ahead of the photo (globals.css reads --drag).
    rootRef.current?.style.setProperty("--drag", p.toFixed(3));
  };

  const onPointerUp = () => {
    const d = drag.current;
    const el = frameRef.current;
    drag.current = null;
    rootRef.current?.removeAttribute("data-dragging");
    if (!d || !el) return;
    if (d.dy > SWIPE_CLOSE_PX) {
      close();
      return;
    }
    const from = el.style.transform || "none";
    el.style.transform = "";
    if (bgRef.current) bgRef.current.style.opacity = "";
    rootRef.current?.style.removeProperty("--drag");
    if (from !== "none" && !reducedMotion()) {
      el.animate([{ transform: from }, { transform: "none" }], { duration: 280, easing: SPRING });
    }
  };

  const version = shareVersion(photo);
  const share = (className: string) => (
    // Keyed by slug so a new photo remounts with a fresh, uncached card.
    <ShareButton key={slug} slug={slug} caption={title} version={version} className={className} />
  );

  const facts: { label: string; value: string }[] = [];
  if (hasCoords) facts.push({ label: "Place", value: place ?? "…" });
  if (date) facts.push({ label: "Date", value: date });
  if (hasCoords) facts.push({ label: "Coordinates", value: formatCoords(photo.lat!, photo.lon!) });

  return (
    <div
      ref={rootRef}
      className="pv"
      data-mode={mode}
      data-details={details}
      data-closing={closing}
      role={mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "overlay" ? true : undefined}
      aria-labelledby="pv-title"
      tabIndex={mode === "overlay" ? -1 : undefined}
    >
      <div className="pv-bg" ref={bgRef} />
      <SiteHeader current="photo" />

      <div className="pv-head">
        <div className="pv-bar">
          <span className="pv-kicker label">{year !== null ? `(${year})` : ""}</span>
          <div className="pv-actions">
            {!isPhone && share("text-btn share-btn")}
            <button
              type="button"
              className="text-btn"
              onClick={close}
              aria-label="Close the photo and go back to the map"
            >
              Close ×
            </button>
          </div>
        </div>
        <h1 id="pv-title" className="pv-title">
          {title}
        </h1>
      </div>

      <div className="pv-body">
        <figure className="pv-figure" ref={figureRef}>
          {/* Hidden: only read for the photo's proportions. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
          <img
            ref={probeRef}
            src={photo.thumb_url}
            alt=""
            hidden
            onLoad={(e) => readRatio(e.currentTarget)}
          />
          {frame && (
            <div
              ref={frameRef}
              className="pv-frame"
              data-grow={origin !== null}
              style={{ width: frame.w, height: frame.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
              <img src={photo.thumb_url} alt="" draggable={false} />
              {/* eslint-disable-next-line @next/next/no-img-element -- R2 rendition, already sized */}
              <img
                className="pv-large"
                data-loaded={largeLoaded}
                src={photo.large_url}
                alt={title}
                draggable={false}
                onLoad={() => setLargeLoaded(true)}
              />
            </div>
          )}
        </figure>

        <div className="pv-side">
          {facts.length > 0 && (
            <dl className="pv-facts">
              {facts.map((f, i) => (
                <div key={f.label} className="pv-fact" style={{ "--i": i } as React.CSSProperties}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {isPhone && share("solid-btn pv-share-wide")}
        </div>
      </div>
    </div>
  );
}
