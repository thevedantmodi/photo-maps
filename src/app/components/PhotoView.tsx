"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "./SiteHeader";
import { fireShutter } from "./Mark";
import ShareButton from "./ShareButton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Link from "next/link";
import { closeTarget, forget, openOrigin, rememberStep, returnFocus, takeStep, type Rect, type Step, type StepWords } from "@/lib/photoTransition";
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
// Swipe the photo this far and let go: down closes it, sideways steps through the photos.
const SWIPE_PX = 120;
// How far a finger moves before the drag commits to down or left.
const SWIPE_LOCK_PX = 8;
// Previous/Next: the photo slides this long on its way out and in.
const STEP_MS = 340;
// The space between one photo and the next as they slide past each other.
const PEEK_GAP = 32;
// A quick flick steps even when it's short of SWIPE_PX: px per ms, and a minimum distance.
const FLICK_SPEED = 0.45;
const FLICK_PX = 24;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
// The words changing from one photo's to the next.
const MORPH_MS = 460;

/** A box of this ratio fitted inside another, like object-fit: contain. */
function fitIn(box: { w: number; h: number }, ratio: number) {
  return box.w / box.h > ratio ? { w: box.h * ratio, h: box.h } : { w: box.w, h: box.w / ratio };
}

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
  // Arrived by Previous/Next. If it slid into place (ratio known), it's drawn as it landed.
  const [arrived] = useState<Step | null>(() => takeStep());
  const landed = arrived?.ratio != null;
  const [details, setDetails] = useState(mode === "page" || landed);
  const [closing, setClosing] = useState(false);
  const [ratio, setRatio] = useState<number | null>(() => arrived?.ratio ?? null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  // The figure's box, and the proportions of the photos either side, to size them alongside.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [sideRatio, setSideRatio] = useState<{ prev?: number; next?: number }>({});
  const [largeLoaded, setLargeLoaded] = useState(false);
  const [place, setPlace] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLImageElement>(null);
  const prevPeekRef = useRef<HTMLDivElement>(null);
  const nextPeekRef = useRef<HTMLDivElement>(null);
  // How far the photo has been dragged sideways, so a step carries on from there.
  const dragX = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // This photo's words, kept current for a step to hand on (set after the facts are built).
  const wordsRef = useRef<Omit<StepWords, "titleFont" | "titleLineHeight" | "titleHeight"> | null>(null);
  // The words of the photo just left, shown fading into these until the morph is over.
  const [ghost, setGhost] = useState<StepWords | null>(() =>
    arrived?.words && !reducedMotion() ? arrived.words : null,
  );
  const played = useRef(false);
  const closingRef = useRef(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
    // How far along the locked axis: down, or sideways (negative is left).
    dist: number;
    // The finger's recent positions (the last ~100ms), to tell a flick from a slow drag.
    trail: { x: number; t: number }[];
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
      setBox({ w: fw, h: fh });
      setFrame(fitIn({ w: fw, h: fh }, ratio));
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
      if (arrived && !landed) {
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
  }, [frame, origin, arrived, landed, later]);

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
  // How far the photo alongside sits from this one's centre: edge to edge, PEEK_GAP apart.
  const peekSpan = useCallback((peek: HTMLElement | null) => {
    const w = frameRef.current?.offsetWidth ?? 0;
    return w / 2 + PEEK_GAP + (peek?.offsetWidth ?? w) / 2;
  }, []);

  const go = useCallback(
    (dir: 1 | -1, button = false) => {
      const to = dir === 1 ? next : prev;
      if (!to || closingRef.current || steppingRef.current) return;
      steppingRef.current = true;
      const navigate = () => router.replace(stepHref(to), { scroll: false });
      const el = frameRef.current;
      const root = rootRef.current;
      const peek = (dir === 1 ? nextPeekRef : prevPeekRef).current;
      const toRatio = sideRatio[dir === 1 ? "next" : "prev"] ?? null;
      const h1 = titleRef.current;
      const words = wordsRef.current;
      const style = h1 ? getComputedStyle(h1) : null;
      const handOn: StepWords | null =
        h1 && words && style
          ? {
              ...words,
              titleFont: style.fontSize,
              titleLineHeight: style.lineHeight,
              titleHeight: h1.offsetHeight,
            }
          : null;
      if (!el || !root || !peek || !toRatio || reducedMotion()) {
        // No photo alongside yet (or no motion wanted): the new one comes in on its own.
        rememberStep(dir, button, null, handOn);
        navigate();
        return;
      }
      rememberStep(dir, button, toRatio, handOn);
      // Like turning a page: this photo slides off as the next slides into its place, from
      // wherever a swipe left them. The page underneath stays put, so there's no gap.
      root.setAttribute("data-swipe-dir", dir === 1 ? "next" : "prev");
      const span = peekSpan(peek);
      const from = dragX.current;
      const end = -dir * span;
      const duration = Math.max(160, STEP_MS * Math.min(1, Math.abs(end - from) / span));
      const timing = { duration, easing: EASE_OUT, fill: "forwards" as const };
      // The one leaving fades as it goes, so nothing is cut off when the page changes.
      el.animate(
        [
          { transform: `translateX(${from}px)`, opacity: 1 },
          { transform: `translateX(${end}px)`, opacity: 0 },
        ],
        timing,
      );
      const anim = peek.animate(
        [{ transform: `translateX(${from + dir * span}px)` }, { transform: "translateX(0px)" }],
        timing,
      );
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        navigate();
      };
      anim.onfinish = once;
      later(once, duration + 100);
    },
    [next, prev, router, stepHref, later, sideRatio, peekSpan],
  );

  // Clicked Previous/Next: focus lands on the same button here, or the other one at the end.
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!arrived?.button) return;
    const nav = stepsRef.current;
    const same = nav?.querySelector<HTMLElement>(`[data-dir="${arrived.dir}"]`);
    (same ?? nav?.querySelector<HTMLElement>("a"))?.focus({ preventScroll: true });
  }, [arrived]);

  // The words morph: the old title, year and facts blur and shrink away where they stood
  // as the new ones grow in and sharpen, and the title block eases between the two heights.
  useLayoutEffect(() => {
    if (!ghost) return;
    const h1 = titleRef.current;
    if (h1 && h1.offsetHeight !== ghost.titleHeight) {
      h1.animate([{ height: `${ghost.titleHeight}px` }, { height: `${h1.offsetHeight}px` }], {
        duration: MORPH_MS,
        easing: EASE_OUT,
      });
    }
    const t = setTimeout(() => setGhost(null), MORPH_MS + 50);
    return () => clearTimeout(t);
  }, [ghost]);

  // The neighbours load ahead, so stepping lands on a photo that's already there.
  useEffect(() => {
    let cancelled = false;
    for (const [side, to] of [["prev", prev], ["next", next]] as const) {
      if (!to) continue;
      router.prefetch(stepHref(to));
      const img = new Image();
      const read = () => {
        if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
          setSideRatio((r) => ({ ...r, [side]: img.naturalWidth / img.naturalHeight }));
        }
      };
      img.onload = read;
      img.src = to.largeUrl;
      if (img.complete) read();
    }
    return () => {
      cancelled = true;
    };
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

  // Swipe the photo left for the next one and right for the one before, like turning pages
  // (a finger on a phone, two fingers on a trackpad); swipe a finger down to close it. The
  // photo follows, shrinking a little as the page fades; short of the line it springs back.
  // On a trackpad a ring at the cursor fills towards the line.
  const dragTo = useCallback(
    (axis: "x" | "y", dist: number) => {
      const el = frameRef.current;
      const root = rootRef.current;
      if (!el || !root) return;
      // Signed: left is negative (next), right positive (previous), down positive (close).
      const reach = Math.abs(dist);
      if (axis === "x") {
        // Sideways the photo moves one to one with the finger and the next one comes in
        // beside it; the page stays solid.
        el.style.transform = `translateX(${dist}px)`;
        dragX.current = dist;
        const peek = (dist < 0 ? nextPeekRef : prevPeekRef).current;
        const span = peekSpan(peek);
        if (peek) peek.style.transform = `translateX(${dist + (dist < 0 ? span : -span)}px)`;
        if (dist === 0) root.removeAttribute("data-swipe-dir");
        else root.setAttribute("data-swipe-dir", dist < 0 ? "next" : "prev");
        root.style.setProperty("--swipe", Math.min(reach / SWIPE_PX, 1).toFixed(3));
        root.toggleAttribute("data-swipe-ready", reach > SWIPE_PX);
        return;
      }
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
      root.style.setProperty("--swipe", Math.min(reach / SWIPE_PX, 1).toFixed(3));
      root.toggleAttribute("data-swipe-ready", reach > SWIPE_PX);
      root.setAttribute("data-swipe-dir", "close");
    },
    [mode, peekSpan],
  );

  const startDrag = useCallback(() => {
    // A spring-back or the opening growth still running would override the drag.
    frameRef.current?.getAnimations().forEach((a) => a.cancel());
    rootRef.current?.setAttribute("data-dragging", "true");
  }, []);

  const endDrag = useCallback(
    (axis: "x" | "y", dist: number, flick = false) => {
      const el = frameRef.current;
      const root = rootRef.current;
      root?.removeAttribute("data-dragging");
      if (!el || !root) return;
      if (axis === "y" && dist > SWIPE_PX) {
        close();
        return;
      }
      const far = flick ? FLICK_PX : SWIPE_PX;
      if (axis === "x" && dist < -far && next) {
        go(1);
        return;
      }
      if (axis === "x" && dist > far && prev) {
        go(-1);
        return;
      }
      if (axis === "x") {
        // Short of the line: both photos glide back, then the one alongside hides again.
        const peek = (dist < 0 ? nextPeekRef : prevPeekRef).current;
        const span = peekSpan(peek);
        el.style.transform = "";
        dragX.current = 0;
        root.style.removeProperty("--swipe");
        root.removeAttribute("data-swipe-ready");
        root.removeAttribute("data-swipe-cursor");
        const reset = () => {
          if (steppingRef.current) return;
          if (peek) peek.style.transform = "";
          root.removeAttribute("data-swipe-dir");
        };
        if (dist === 0 || reducedMotion()) {
          reset();
          return;
        }
        const timing = { duration: 300, easing: EASE_OUT };
        el.animate([{ transform: `translateX(${dist}px)` }, { transform: "translateX(0px)" }], timing);
        const anim = peek?.animate(
          [
            { transform: `translateX(${dist + (dist < 0 ? span : -span)}px)` },
            { transform: `translateX(${dist < 0 ? span : -span}px)` },
          ],
          timing,
        );
        if (anim) anim.onfinish = reset;
        else reset();
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
    [close, go, next, prev, peekSpan],
  );

  // Touch: a drag locks to whichever way the finger first moves.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || closingRef.current) return;
    startDrag();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      axis: null,
      dist: 0,
      trail: [{ x: e.clientX, t: performance.now() }],
    };
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
    // Sideways only towards a photo that's there; down closes.
    if (d.axis === "y") d.dist = Math.max(0, dy);
    else d.dist = (dx < 0 ? next : prev) ? dx : 0;
    const now = performance.now();
    d.trail.push({ x: e.clientX, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 100) d.trail.shift();
    dragTo(d.axis, d.dist);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) {
      rootRef.current?.removeAttribute("data-dragging");
      return;
    }
    // A quick flick the same way as the drag counts even when it's short; a finger that
    // stopped before lifting doesn't.
    const first = d.trail[0];
    const last = d.trail[d.trail.length - 1];
    const fresh = performance.now() - last.t < 80;
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    endDrag(d.axis ?? "y", d.dist, fresh && Math.abs(v) > FLICK_SPEED && Math.sign(v) === Math.sign(d.dist));
  };

  // Trackpad: a two-finger swipe arrives as sideways wheel events. Fingers moving left
  // (positive deltaX) step to the next photo, moving right to the one before. Taking them
  // keeps the browser's own back and forward swipes from running instead. It steps the
  // moment it crosses the line, since the momentum that follows would otherwise carry it
  // for a beat longer; a pause short of that springs back.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let dist = 0;
    let active = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    // A swipe's momentum keeps arriving after it has stepped. Arriving by a step, the new
    // photo ignores it until the wheel has been quiet for a moment, so one swipe is one photo.
    let cooling = arrived !== null;
    let lastWheel = performance.now();
    const settle = () => {
      if (!active) return;
      active = false;
      if (!closingRef.current) endDrag("x", dist);
      dist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (closingRef.current || steppingRef.current) {
        // Swallow the momentum still arriving after the photo closed or stepped.
        if (active) e.preventDefault();
        return;
      }
      const now = performance.now();
      const quiet = now - lastWheel > 200;
      lastWheel = now;
      if (cooling && !quiet && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        return;
      }
      cooling = false;
      if (e.ctrlKey) return; // pinch to zoom
      if (!active) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        // At either end the swipe is left to the browser.
        if (e.deltaX > 0 ? !next : !prev) return;
      }
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
      if (!prev) dist = Math.min(0, dist);
      dragTo("x", dist);
      if (Math.abs(dist) > SWIPE_PX) {
        endDrag("x", dist);
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
  }, [dragTo, startDrag, endDrag, next, prev, arrived]);

  const version = shareVersion(photo);
  const share = (className: string) => (
    // Keyed by slug so a new photo remounts with a fresh, uncached card.
    <ShareButton key={slug} slug={slug} caption={title} version={version} className={className} />
  );

  const facts: { label: string; value: string }[] = [];
  const kickerText = year !== null ? `(${year})` : "";
  // When Mapbox has no name the lookup falls back to coordinates, which the Coordinates row
  // already shows, so the Place row is left out rather than said twice.
  const placeIsCoords =
    hasCoords && place === `${photo.lat!.toFixed(2)}, ${photo.lon!.toFixed(2)}`;
  if (hasCoords && !placeIsCoords) facts.push({ label: "Place", value: place ?? "…" });
  if (date) facts.push({ label: "Date", value: date });
  if (hasCoords) facts.push({ label: "Coordinates", value: formatCoords(photo.lat!, photo.lon!) });
  const factsKey = JSON.stringify(facts);
  useEffect(() => {
    wordsRef.current = {
      title,
      kicker: kickerText,
      facts: Object.fromEntries((JSON.parse(factsKey) as typeof facts).map((f) => [f.label, f.value])),
    };
  }, [title, kickerText, factsKey]);

  return (
    <div
      ref={rootRef}
      className="pv"
      data-mode={mode}
      data-details={details}
      data-closing={closing}
      data-arrived={landed || undefined}
      role={mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "overlay" ? true : undefined}
      aria-labelledby="pv-title"
      tabIndex={mode === "overlay" ? -1 : undefined}
    >
      <div className="pv-bg" ref={bgRef} />
      {/* Trackpad swipes only: sits at the cursor and fills as the swipe nears the next photo. */}
      <svg className="pv-swipe" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="pv-swipe-disc" cx="24" cy="24" r="23" />
        <circle className="pv-swipe-track" cx="24" cy="24" r="18" />
        <circle className="pv-swipe-fill" cx="24" cy="24" r="18" pathLength={1} />
        <path className="pv-swipe-arrow" data-dir="next" d="M17 24h14M26 19l5 5-5 5" />
        <path className="pv-swipe-arrow" data-dir="prev" d="M31 24H17M22 19l-5 5 5 5" />
      </svg>
      <SiteHeader current="photo" />

      <div className="pv-head">
        <div className="pv-bar">
          <span className="pv-kicker label">
            <Morph from={ghost?.kicker}>{kickerText}</Morph>
          </span>
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
          ref={titleRef}
          id="pv-title"
          className="pv-title"
          // Long captions step down in size so the photo stays on the first screen.
          data-length={title.length > 70 ? "long" : title.length > 30 ? "mid" : undefined}
        >
          {ghost && ghost.title !== title && (
            <span
              className="pv-ghost pv-ghost-title"
              aria-hidden="true"
              style={{ fontSize: ghost.titleFont, lineHeight: ghost.titleLineHeight }}
            >
              {ghost.title}
            </span>
          )}
          <span className="pv-new" data-morph={Boolean(ghost && ghost.title !== title)}>
            {title}
          </span>
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
          {/* The photos either side, waiting off to the side of the frame for a swipe. */}
          {box &&
            ([
              ["prev", prev],
              ["next", next],
            ] as const).map(([side, to]) => {
              const r = sideRatio[side];
              if (!to || !r) return null;
              const size = fitIn(box, r);
              return (
                <div
                  key={to.slug}
                  ref={side === "prev" ? prevPeekRef : nextPeekRef}
                  className="pv-peek"
                  data-dir={side}
                  aria-hidden="true"
                  style={{ width: size.w, height: size.h, marginLeft: -size.w / 2, marginTop: -size.h / 2 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- R2 rendition, already loaded */}
                  <img src={to.largeUrl} alt="" draggable={false} />
                </div>
              );
            })}
        </figure>

        <div className="pv-side">
          {facts.length > 0 && (
            <dl className="pv-facts">
              {facts.map((f, i) => (
                <div key={f.label} className="pv-fact" style={{ "--i": i } as React.CSSProperties}>
                  <dt>{f.label}</dt>
                  <dd>
                    <Morph from={ghost?.facts[f.label]}>{f.value}</Morph>
                  </dd>
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

/**
 * A word changing from one photo's to the next: the old one (if different) blurs and shrinks
 * away on top while the new one grows in and sharpens (globals.css, "pv-ghost").
 */
function Morph({ from, children }: { from: string | undefined; children: string }) {
  const changing = from !== undefined && from !== children;
  return (
    <span className="pv-morph">
      {changing && (
        <span className="pv-ghost" aria-hidden="true">
          {from}
        </span>
      )}
      <span className="pv-new" data-morph={changing}>
        {children}
      </span>
    </span>
  );
}
