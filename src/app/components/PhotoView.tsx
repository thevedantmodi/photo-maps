"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "./SiteHeader";
import { fireShutter } from "./Mark";
import ShareButton from "./ShareButton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Link from "next/link";
import { closeTarget, forget, openOrigin, rememberStep, returnFocus, takeStep, type Rect, type Step } from "@/lib/photoTransition";
import type { PhotoStep } from "@/lib/photoSequence";
import { yearQuery } from "@/lib/yearParam";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import { shareVersion } from "@/lib/shareVersion";
import { photoAlt, photoTitle } from "@/lib/alt";
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
// Swipe the photo down, or right, this far and letting go closes it.
const SWIPE_CLOSE_PX = 120;
// How far a finger moves before the drag commits to down or left.
const SWIPE_LOCK_PX = 8;
// Previous/Next: the photo slides this long on its way out and in.
const STEP_MS = 240;

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
  /** The photos either side, by date taken (within the map's year filter, if any). */
  prev: PhotoStep | null;
  next: PhotoStep | null;
  /** The map's year filter, kept in the address as you step. */
  year: number | null;
}

/**
 * The one photo page. Over the map it grows out of the thumbnail that was clicked and
 * shrinks back into it on close; on its own it simply appears. The title slides up after
 * the photo and the place, date and coordinates draw in one row at a time.
 */
export default function PhotoView({ photo, places, mode, prev, next, year: filterYear }: PhotoViewProps) {
  const router = useRouter();
  const slug = photo.friendly_name;
  const title = photoTitle(photo);
  const year = photo.date ? new Date(photo.date).getFullYear() : null;
  const date = formatDate(photo.date);
  const hasCoords = photo.lat != null && photo.lon != null;
  const isPhone = useMediaQuery("(max-width: 767px)");

  // Read once: where the clicked thumbnail sat, if this photo was just opened from the map.
  const [origin] = useState<Rect | null>(() => (mode === "overlay" ? openOrigin(slug) : null));
  // Arrived by Previous/Next: slide in from that side.
  const [arrived] = useState<Step | null>(() => takeStep());
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
  const drag = useRef<{
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
    // How far along the locked axis, down or right; never negative.
    dist: number;
  } | null>(null);
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
    // The camera beside the name takes the shot as the photo appears.
    fireShutter();
    const el = frameRef.current;
    if (!el || reducedMotion()) return;
    if (!origin) {
      if (arrived) {
        el.animate(
          [
            { transform: `translateX(${arrived.dir * 56}px)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: STEP_MS, easing: EASE },
        );
      }
      return;
    }
    const pose = thumbPose(origin, el.getBoundingClientRect());
    el.animate(
      [
        { transform: pose.transform, clipPath: pose.clipPath },
        { transform: "none", clipPath: "inset(0px 0px)" },
      ],
      { duration: OPEN_MS, easing: EASE },
    );
    later(() => setDetails(true), DETAILS_DELAY_MS);
  }, [frame, origin, arrived, later]);

  // Over the map, focus moves into the photo page (announced by its title) so the
  // keyboard and screen readers follow it; Escape or Close returns to the map.
  useEffect(() => {
    if (mode === "overlay") rootRef.current?.focus({ preventScroll: true });
  }, [mode]);

  // A modal over the map: everything outside it goes inert while it's open, so Tab can't
  // wander onto the markers behind the photo and screen readers stay inside. Each ancestor's
  // other children are marked, and only the ones this marked are released on close.
  useEffect(() => {
    if (mode !== "overlay") return;
    const marked: Element[] = [];
    for (let node: Element | null = rootRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling === node || sibling.hasAttribute("inert") || sibling.tagName === "SCRIPT") continue;
        sibling.setAttribute("inert", "");
        marked.push(sibling);
      }
    }
    return () => marked.forEach((el) => el.removeAttribute("inert"));
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
      returnFocus(slug);
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
            { transform: start, clipPath: "inset(0px 0px)" },
            { transform: pose.transform, clipPath: pose.clipPath },
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

  // Previous/Next. Replaces the address rather than adding to history, so Close still goes
  // straight back to the map however many photos you've stepped through.
  const steppingRef = useRef(false);
  const stepHref = useCallback(
    (to: PhotoStep) => `/p/${encodeURIComponent(to.slug)}${yearQuery(filterYear, true)}`,
    [filterYear],
  );
  const go = useCallback(
    (dir: 1 | -1, button = false) => {
      const to = dir === 1 ? next : prev;
      if (!to || closingRef.current || steppingRef.current) return;
      steppingRef.current = true;
      rememberStep(dir, button);
      const navigate = () => router.replace(stepHref(to), { scroll: false });
      const el = frameRef.current;
      if (!el || reducedMotion()) {
        navigate();
        return;
      }
      // Out the way it's going, from wherever a swipe left it.
      const from = el.style.transform || "none";
      const anim = el.animate(
        [
          { transform: from, opacity: 1 },
          { transform: `${from === "none" ? "" : from} translateX(${-dir * 56}px)`, opacity: 0 },
        ],
        { duration: STEP_MS * 0.6, easing: EASE, fill: "forwards" },
      );
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        navigate();
      };
      anim.onfinish = once;
      later(once, STEP_MS);
    },
    [next, prev, router, stepHref, later],
  );

  // Clicked Previous/Next: focus lands on the same button here, or the other one at the end.
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!arrived?.button) return;
    const nav = stepsRef.current;
    const same = nav?.querySelector<HTMLElement>(`[data-dir="${arrived.dir}"]`);
    (same ?? nav?.querySelector<HTMLElement>("a"))?.focus({ preventScroll: true });
  }, [arrived]);

  // The neighbours load ahead, so stepping lands on a photo that's already there.
  useEffect(() => {
    for (const to of [prev, next]) {
      if (!to) continue;
      router.prefetch(stepHref(to));
      const img = new Image();
      img.src = to.largeUrl;
    }
  }, [prev, next, router, stepHref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      const t = e.target as HTMLElement | null;
      const typing = t?.closest("input, textarea, select, [contenteditable='true']");
      if (typing || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go]);

  // Swipe the photo down, or right, to close it: a finger on a phone, two fingers on a
  // trackpad. The photo follows, shrinking a little as the page fades; short of the line it
  // springs back. On a trackpad a ring at the cursor fills towards the line.
  const dragTo = useCallback(
    (axis: "x" | "y", dist: number) => {
      const el = frameRef.current;
      const root = rootRef.current;
      if (!el || !root) return;
      // Signed: right (or down) closes, left steps to the next photo.
      const reach = Math.abs(dist);
      const p = Math.min(reach / 300, 1);
      const s = 1 - p * 0.35;
      // transform-origin is the top left, so shrinking is re-centred by hand.
      const shrinkX = (el.offsetWidth * (1 - s)) / 2;
      el.style.transform =
        axis === "y"
          ? `translate(${shrinkX}px, ${dist}px) scale(${s})`
          : `translate(${shrinkX + dist}px, ${(el.offsetHeight * (1 - s)) / 2}px) scale(${s})`;
      if (mode === "overlay" && bgRef.current) bgRef.current.style.opacity = String(1 - p * 0.85);
      // The words fade out ahead of the photo and the ring fills (globals.css reads both).
      root.style.setProperty("--drag", p.toFixed(3));
      root.style.setProperty("--swipe", Math.min(reach / SWIPE_CLOSE_PX, 1).toFixed(3));
      root.toggleAttribute("data-swipe-ready", reach > SWIPE_CLOSE_PX);
      root.setAttribute("data-swipe-dir", dist < 0 ? "next" : "close");
    },
    [mode],
  );

  const startDrag = useCallback(() => {
    // A spring-back or the opening growth still running would override the drag.
    frameRef.current?.getAnimations().forEach((a) => a.cancel());
    rootRef.current?.setAttribute("data-dragging", "true");
  }, []);

  const endDrag = useCallback(
    (dist: number) => {
      const el = frameRef.current;
      const root = rootRef.current;
      root?.removeAttribute("data-dragging");
      if (!el || !root) return;
      if (dist > SWIPE_CLOSE_PX) {
        close();
        return;
      }
      if (dist < -SWIPE_CLOSE_PX && next) {
        go(1);
        return;
      }
      const from = el.style.transform || "none";
      el.style.transform = "";
      if (bgRef.current) bgRef.current.style.opacity = "";
      root.style.removeProperty("--drag");
      root.style.removeProperty("--swipe");
      root.removeAttribute("data-swipe-ready");
      root.removeAttribute("data-swipe-cursor");
      root.removeAttribute("data-swipe-dir");
      if (from !== "none" && !reducedMotion()) {
        el.animate([{ transform: from }, { transform: "none" }], { duration: 280, easing: SPRING });
      }
    },
    [close, go, next],
  );

  // Touch: a drag locks to whichever way the finger first moves.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || closingRef.current) return;
    startDrag();
    drag.current = { startX: e.clientX, startY: e.clientY, axis: null, dist: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the drag simply won't be captured.
    }
  };

  // iOS Safari ignores touch-action inside the scrolling overlay: it starts its own
  // scroll or bounce, cancels the pointer, and the photo springs back. Holding the
  // touch while dragging keeps the gesture ours. (React's touch listeners are passive.)
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, [frame]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    // Down and right close; left goes on to the next photo, when there is one.
    d.dist = d.axis === "y" ? Math.max(0, dy) : next ? dx : Math.max(0, dx);
    dragTo(d.axis, d.dist);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) endDrag(d.dist);
    else rootRef.current?.removeAttribute("data-dragging");
  };

  // Trackpad: a two-finger swipe arrives as sideways wheel events. Fingers moving right
  // scroll left (negative deltaX) and close; moving left steps to the next photo. Taking
  // them keeps the browser's own back and forward swipes from running instead. It closes the moment it crosses the line, since the momentum that
  // follows would otherwise carry it for a beat longer; a pause short of that springs back.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let dist = 0;
    let active = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (!active) return;
      active = false;
      if (!closingRef.current) endDrag(dist);
      dist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (closingRef.current) {
        // Swallow the momentum still arriving after the photo closed.
        if (active) e.preventDefault();
        return;
      }
      if (e.ctrlKey) return; // pinch to zoom
      if (!active && (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || (e.deltaX >= 0 && !next))) return;
      e.preventDefault();
      if (!active) {
        active = true;
        startDrag();
        // The ring appears where the cursor is.
        root.style.setProperty("--swipe-x", `${e.clientX}px`);
        root.style.setProperty("--swipe-y", `${e.clientY}px`);
        root.setAttribute("data-swipe-cursor", "");
      }
      dist -= e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (!next) dist = Math.max(0, dist);
      dragTo("x", dist);
      if (Math.abs(dist) > SWIPE_CLOSE_PX) {
        endDrag(dist);
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(settle, 140);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(idle);
      root.removeEventListener("wheel", onWheel);
    };
  }, [dragTo, startDrag, endDrag, next]);

  const version = shareVersion(photo);
  const share = (className: string) => (
    // Keyed by slug so a new photo remounts with a fresh, uncached card.
    <ShareButton key={slug} slug={slug} caption={title} version={version} className={className} />
  );

  const facts: { label: string; value: string }[] = [];
  // When Mapbox has no name the lookup falls back to coordinates, which the Coordinates row
  // already shows, so the Place row is left out rather than said twice.
  const placeIsCoords =
    hasCoords && place === `${photo.lat!.toFixed(2)}, ${photo.lon!.toFixed(2)}`;
  if (hasCoords && !placeIsCoords) facts.push({ label: "Place", value: place ?? "…" });
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
      {/* Trackpad swipes only: sits at the cursor and fills as the swipe nears closing. */}
      <svg className="pv-swipe" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="pv-swipe-disc" cx="24" cy="24" r="23" />
        <circle className="pv-swipe-track" cx="24" cy="24" r="18" />
        <circle className="pv-swipe-fill" cx="24" cy="24" r="18" pathLength={1} />
        <path className="pv-swipe-x" d="M19.5 19.5l9 9M28.5 19.5l-9 9" />
        <path className="pv-swipe-next" d="M17 24h14M26 19l5 5-5 5" />
      </svg>
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
        <h1
          id="pv-title"
          className="pv-title"
          // Long captions step down in size so the photo stays on the first screen.
          data-length={title.length > 70 ? "long" : title.length > 30 ? "mid" : undefined}
        >
          {title}
        </h1>
      </div>

      <div className="pv-body">
        <figure
          className="pv-figure"
          ref={figureRef}
          // On phones the figure takes the photo's shape, so a panorama isn't set in a tall,
          // mostly empty box (globals.css reads --ratio).
          style={ratio ? ({ "--ratio": ratio } as React.CSSProperties) : undefined}
        >
          {/* Hidden: only read for the photo's proportions. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
          <img
            ref={probeRef}
            src={photo.thumb_url}
            alt=""
            hidden
            onLoad={(e) => readRatio(e.currentTarget)}
          />
          {/* The frame is sized in the browser, so without JavaScript the photo would never
              appear. This stands in, and gives crawlers that don't run scripts the image. */}
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element -- R2 rendition, already sized */}
            <img className="pv-noscript" src={photo.large_url} alt={photoAlt(photo)} />
          </noscript>
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
                alt={photoAlt(photo)}
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
          {(prev || next) && (
            <nav className="pv-steps" aria-label="More photos" ref={stepsRef}>
              {prev ? (
                <Link
                  data-dir="-1"
                  className="text-btn"
                  href={stepHref(prev)}
                  replace
                  scroll={false}
                  title={prev.title}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    go(-1, true);
                  }}
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  data-dir="1"
                  className="text-btn"
                  href={stepHref(next)}
                  replace
                  scroll={false}
                  title={next.title}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    go(1, true);
                  }}
                >
                  Next →
                </Link>
              )}
            </nav>
          )}
          {isPhone && share("solid-btn pv-share-wide")}
        </div>
      </div>
    </div>
  );
}
