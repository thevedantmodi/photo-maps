"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { animate, type AnimationPlaybackControls } from "framer-motion";

import SiteHeader from "./SiteHeader";
import { fireShutter } from "./Mark";
import ShareButton from "./ShareButton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Link from "next/link";
import { closeTarget, forget, openOrigin, rememberStep, returnFocus, takeStep, type Rect, type Step, type StepWords } from "@/lib/photoTransition";
import type { PhotoStep } from "@/lib/photoSequence";
import { yearQuery } from "@/lib/yearParam";
import { canVibrate, haptic, tapOnRelease } from "@/lib/haptics";
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
// A finger has less room than a trackpad: sideways it needs to travel only this far (or
// flick), and it moves the morph along this much faster than it moves itself.
const TOUCH_SWIPE_PX = 56;
const TOUCH_GAIN = 1.5;
// Hold to step, like a Kinect button: rest the cursor (or a finger) on the left or right
// side of the photo and the ring fills; full, it steps. The ring waits a beat before it
// appears, so a cursor passing through doesn't start one.
const HOLD_SIDE = 0.3; // the outer share of the photo on each side that holds
const HOLD_DELAY_MS = 250;
const HOLD_MS = 850;
const TOUCH_HOLD_MS = 650;
// A quick tap on a side of the photo (on a phone) doesn't wait out the hold: the ring
// shows at once and fills in this long, then it steps.
const TAP_FILL_MS = 200;
// How far a finger moves before the drag commits to down or left.
const SWIPE_LOCK_PX = 8;
// Previous/Next: the photo slides this long on its way out and in.
const STEP_MS = 340;
// The space between one photo and the next as they slide past each other.
const PEEK_GAP = 32;
// Sideways the photos move on springs that take the swipe's speed with them, so a flick
// flies and a gentle push glides. Stepping is heavy and settles without a wobble; falling
// back short of the next photo has a little give.
const STEP_SPRING = { type: "spring", stiffness: 190, damping: 28, mass: 1.2, restDelta: 0.5, restSpeed: 30 } as const;
const BACK_SPRING = { type: "spring", stiffness: 320, damping: 24, mass: 1, restDelta: 0.5, restSpeed: 30 } as const;
// A release is judged by where its speed would carry it this far ahead (ms), not where it
// stopped: a short, fast flick steps; a long, slow drag let go gently can still fall back.
const PROJECT_MS = 180;

/** Past the first or last photo the drag gives less and less, like pulling on elastic. */
function rubber(x: number, size: number) {
  if (size <= 0) return 0;
  return Math.sign(x) * (1 - 1 / ((Math.abs(x) * 0.55) / size + 1)) * size;
}

/** Speed over a trail of recent positions, px per second. */
function speedOf(trail: { x: number; t: number }[]) {
  const first = trail[0];
  const last = trail[trail.length - 1];
  if (!first || !last || last.t <= first.t || performance.now() - last.t > 80) return 0;
  return ((last.x - first.x) / (last.t - first.t)) * 1000;
}
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
// The words changing from one photo's to the next.
const MORPH_MS = 460;

/** A box of this ratio fitted inside another, like object-fit: contain. */
function fitIn(box: { w: number; h: number }, ratio: number) {
  return box.w / box.h > ratio ? { w: box.h * ratio, h: box.h } : { w: box.w, h: box.w / ratio };
}

// Where the ring-cursor steps aside for the usual one: things to click, and the header.
const PLAIN_CURSOR = "a, button, input, select, textarea, label, summary, [role=button], header";

// Where the mouse is (null for none, or a finger), kept from the first photo opened on, so
// a photo mounted under a mouse resting still (after a step) can put the ring there at once.
let lastPointer: { x: number; y: number } | null = null;
let trackingPointer = false;
function trackPointer() {
  if (trackingPointer) return;
  trackingPointer = true;
  window.addEventListener(
    "pointermove",
    (e) => (lastPointer = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null),
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => (lastPointer = null));
}

/** Whether an element holds words of its own (a title, a caption, a fact). */
function ownsText(el: Element): boolean {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return true;
  return false;
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

/**
 * One photo's part in the morph between two: scaled to cover the shared frame (W x H) and
 * clipped to it, like object-fit: cover, then swelled, blurred and faded.
 */
function morph(
  el: HTMLElement,
  m: { w: number; h: number; W: number; H: number; x: number; swell: number; blur: number; opacity: number },
) {
  const k = Math.max(m.W / m.w, m.H / m.h);
  const insetX = Math.max(0, (m.w - m.W / k) / 2);
  const insetY = Math.max(0, (m.h - m.H / k) / 2);
  el.style.transformOrigin = "50% 50%";
  el.style.transform = `translateX(${m.x}px) scale(${k * m.swell})`;
  el.style.clipPath = `inset(${insetY}px ${insetX}px)`;
  el.style.opacity = String(Math.max(0, Math.min(1, m.opacity)));
  // The blur goes on the picture inside, enlarged just enough that its softened edges stay
  // outside the frame; blurred whole, the frame's own edge would haze past the other photo.
  // (In the photo's own pixels, so it looks the same however far the frame is scaled.)
  const blur = m.blur / (k * m.swell);
  const grow = 1 + (4 * blur) / Math.max(1, Math.min(m.w, m.h));
  for (const img of el.querySelectorAll("img")) {
    img.style.filter = blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : "";
    img.style.transform = blur > 0.2 ? `scale(${grow.toFixed(4)})` : "";
  }
}

/**
 * Marks the swipe as past the line (the ring and arrows read it) and, the moment it
 * crosses, ticks like a detent where the device can vibrate mid-gesture (Android).
 */
function crossLine(root: HTMLElement, past: boolean) {
  if (past && !root.hasAttribute("data-swipe-ready") && canVibrate()) haptic(8);
  root.toggleAttribute("data-swipe-ready", past);
}

/**
 * A tap as a swipe lets go and commits. On iPhone this is the only moment it can play;
 * where the device already ticked at the line (Android), it isn't repeated.
 */
function commitTap() {
  if (!canVibrate()) tapOnRelease();
}

function clearMorph(el: HTMLElement) {
  el.style.transformOrigin = "";
  el.style.transform = "";
  el.style.clipPath = "";
  el.style.opacity = "";
  for (const img of el.querySelectorAll("img")) {
    img.style.filter = "";
    img.style.transform = "";
  }
}

interface Words {
  title: string;
  kicker: string;
  facts: { label: string; value: string }[];
}

/** The words beside a photo: its title, the year above it, and the rows of facts. */
function wordsOf(
  p: { title: string; date: string | null; lat: number | null; lon: number | null },
  place: string | null,
): Words {
  const year = p.date ? new Date(p.date).getFullYear() : null;
  const date = formatDate(p.date);
  const facts: Words["facts"] = [];
  if (p.lat != null && p.lon != null) {
    // When Mapbox has no name the lookup falls back to coordinates, which the Coordinates
    // row already shows, so the Place row is left out rather than said twice.
    const placeIsCoords = place === `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
    if (!placeIsCoords) facts.push({ label: "Place", value: place ?? "…" });
  }
  if (date) facts.push({ label: "Date", value: date });
  if (p.lat != null && p.lon != null) facts.push({ label: "Coordinates", value: formatCoords(p.lat, p.lon) });
  return { title: p.title, kicker: year !== null ? `(${year})` : "", facts };
}

function recordOf(w: Words) {
  return { title: w.title, kicker: w.kicker, facts: Object.fromEntries(w.facts.map((f) => [f.label, f.value])) };
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
  // Seeded from the step that led here, when it had already looked the place up.
  const [place, setPlace] = useState<string | null>(() => {
    const handed = arrived?.words?.facts.Place;
    return handed && handed !== "…" ? handed : null;
  });
  // The photos either side's place names, looked up ahead with their images.
  const [sidePlace, setSidePlace] = useState<{ prev?: string; next?: string }>({});
  // The next photo's words, shown the moment a step commits (the page follows).
  const [showing, setShowing] = useState<Words | null>(null);

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
  const wordsRef = useRef<Words | null>(null);
  // The words of the photo just left, shown fading into these until the morph is over.
  const [ghost, setGhost] = useState<StepWords | null>(() =>
    arrived?.words && !arrived.words.settled && !reducedMotion() ? arrived.words : null,
  );
  const played = useRef(false);
  const closingRef = useRef(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
    // How far along the locked axis: down, or sideways (negative is left).
    dist: number;
    // The finger's recent positions (the last ~100ms), for the speed it lets go at.
    trail: { x: number; t: number }[];
    // Where the photo already was sideways when the finger came down (mid-spring).
    base: number;
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

  // The step between photos, after the iPhone's fold: rather than sliding past each other,
  // the two photos share one frame that reshapes from this photo's proportions to the
  // next one's, as this one blurs and swells away and the next comes into focus in its
  // place. `x` is how far the swipe (or its spring) has gone; a span's worth completes it.
  const springRef = useRef<AnimationPlaybackControls | null>(null);
  const coolRef = useRef({ on: arrived !== null, last: 0 });
  useEffect(() => {
    coolRef.current.last = performance.now();
  }, []);
  const placeX = useCallback(
    (x: number) => {
      const el = frameRef.current;
      const root = rootRef.current;
      if (!el || !root) return;
      dragX.current = x;
      const toward = x < 0 ? nextPeekRef.current : x > 0 ? prevPeekRef.current : null;
      const away = x < 0 ? prevPeekRef.current : nextPeekRef.current;
      if (away) clearMorph(away);
      if (x === 0) {
        clearMorph(el);
        if (toward) clearMorph(toward);
        root.removeAttribute("data-swipe-dir");
        return;
      }
      root.setAttribute("data-swipe-dir", x < 0 ? "next" : "prev");
      const p = Math.min(1, Math.abs(x) / peekSpan(toward));
      // The shared frame: from this photo's box to the next one's.
      const w0 = el.offsetWidth;
      const h0 = el.offsetHeight;
      const w1 = toward?.offsetWidth || w0;
      const h1 = toward?.offsetHeight || h0;
      const W = w0 + (w1 - w0) * p;
      const H = h0 + (h1 - h0) * p;
      // One frame for both: it drifts a little with the finger and breathes out mid-way,
      // settling back to centre as the next one lands.
      const drift = x * 0.12 * (1 - p);
      const swell = 1 + 0.035 * Math.sin(p * Math.PI);
      morph(el, {
        w: w0,
        h: h0,
        W,
        H,
        x: drift,
        swell,
        blur: 14 * p,
        // Underneath, it holds until the next one is mostly there, so the page never shows.
        opacity: p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4,
      });
      if (toward) {
        morph(toward, {
          w: w1,
          h: h1,
          W,
          H,
          x: drift,
          swell,
          blur: 14 * (1 - p),
          opacity: Math.min(1, p * 1.4),
        });
      }
    },
    [peekSpan],
  );

  useEffect(() => () => springRef.current?.stop(), []);

  const go = useCallback(
    (dir: 1 | -1, button = false, velocity = 0) => {
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
      const metrics = h1 && style
        ? { titleFont: style.fontSize, titleLineHeight: style.lineHeight, titleHeight: h1.offsetHeight }
        : null;
      const handOn: StepWords | null = words && metrics ? { ...recordOf(words), ...metrics } : null;
      if (!el || !root || !peek || !toRatio || reducedMotion()) {
        // No photo alongside yet (or no motion wanted): the new one comes in on its own.
        rememberStep(dir, button, null, handOn);
        navigate();
        return;
      }
      // The words change now, as the photos start to move, rather than once the next
      // page has arrived: the next photo's are known already.
      const toWords = wordsOf(to, sidePlace[dir === 1 ? "next" : "prev"] ?? null);
      if (handOn) setGhost(handOn);
      setShowing(toWords);
      rememberStep(dir, button, toRatio, { ...recordOf(toWords), titleFont: "", titleLineHeight: "", titleHeight: 0, settled: true });
      // The morph runs on to the next photo, from wherever the swipe left it and at the
      // speed it let go. The page underneath stays put, so there's no gap.
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        navigate();
      };
      springRef.current?.stop();
      const target = -dir * peekSpan(peek);
      springRef.current = animate(dragX.current, target, {
        ...STEP_SPRING,
        velocity,
        onUpdate: (x) => {
          placeX(x);
          // Close enough to rest that the page can change under it.
          if (Math.abs(x - target) < 3) once();
        },
        onComplete: once,
      });
      later(once, 1500);
    },
    [next, prev, router, stepHref, later, sideRatio, sidePlace, peekSpan, placeX],
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
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (token && to.lat != null && to.lon != null) {
        reverseGeocode(to.lon, to.lat, token, places).then((name) => {
          if (!cancelled && name) setSidePlace((r) => ({ ...r, [side]: name }));
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [prev, next, router, stepHref, places]);

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

  // Hold to step. One hold at a time; the ring and arrow are the trackpad swipe's, shown
  // at the cursor (above the finger on a phone, where it would otherwise be under it).
  // p: how full the ring is (0 to 1); wait: what's left of the beat before it shows;
  // ms: how long a full ring takes at the current pace (a tap speeds it up).
  const holdRef = useRef<{ dir: 1 | -1; raf: number; p: number; wait: number; ms: number } | null>(null);
  const cancelHold = useCallback(() => {
    const h = holdRef.current;
    if (!h) return;
    cancelAnimationFrame(h.raf);
    holdRef.current = null;
    const root = rootRef.current;
    if (!root || root.hasAttribute("data-dragging")) return;
    root.removeAttribute("data-hold-dir");
    root.removeAttribute("data-swipe-cursor");
    root.style.removeProperty("--swipe");
  }, []);
  const startHold = useCallback(
    (dir: 1 | -1, x: number, y: number, ms: number) => {
      const root = rootRef.current;
      if (holdRef.current?.dir === dir) return;
      cancelHold();
      if (!root || closingRef.current || steppingRef.current || !(dir === 1 ? next : prev)) return;
      root.style.setProperty("--swipe-x", `${x}px`);
      root.style.setProperty("--swipe-y", `${y}px`);
      let last = performance.now();
      const tick = (now: number) => {
        const h = holdRef.current;
        if (!h) return;
        const dt = now - last;
        last = now;
        if (h.wait > 0) h.wait -= dt;
        else h.p = Math.min(1, h.p + dt / h.ms);
        if (h.wait <= 0) {
          root.setAttribute("data-swipe-cursor", "");
          root.setAttribute("data-hold-dir", dir === 1 ? "next" : "prev");
          root.style.setProperty("--swipe", h.p.toFixed(3));
        }
        if (h.p >= 1) {
          // The full ring and its arrow stay up while the photo changes.
          holdRef.current = null;
          if (canVibrate()) haptic();
          go(dir);
          return;
        }
        h.raf = requestAnimationFrame(tick);
      };
      holdRef.current = { dir, raf: requestAnimationFrame(tick), p: 0, wait: HOLD_DELAY_MS, ms };
    },
    [cancelHold, go, next, prev],
  );
  // A tap let go before the hold was done: show the ring now and fill the rest quickly.
  const finishHold = useCallback(() => {
    const h = holdRef.current;
    if (!h) return false;
    h.wait = 0;
    h.ms = TAP_FILL_MS / Math.max(0.05, 1 - h.p);
    return true;
  }, []);
  useEffect(() => cancelHold, [cancelHold]);

  /** Which side of the photo a point is on, if it's in a holding zone with a photo there. */
  const holdSide = useCallback(
    (clientX: number): 1 | -1 | null => {
      const r = frameRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return null;
      const f = (clientX - r.left) / r.width;
      if (f < 0 || f > 1) return null;
      if (f < HOLD_SIDE && prev) return -1;
      if (f > 1 - HOLD_SIDE && next) return 1;
      return null;
    },
    [prev, next],
  );

  // Desktop: the cursor resting on either side of the photo. Pointer events, not mouse
  // ones: a phone fires pretend mouse events after a tap (a mouseleave among them) that
  // would cancel the tap's ring.
  const onFrameMouseMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || root.hasAttribute("data-dragging")) return;
    const dir = holdSide(e.clientX);
    if (dir === null) cancelHold();
    else startHold(dir, e.clientX, e.clientY, HOLD_MS);
  };

  // Swipe the photo left for the next one and right for the one before, like turning pages
  // (a finger on a phone, two fingers on a trackpad); swipe a finger down to close it. The
  // photo follows, shrinking a little as the page fades; short of the line it springs back.
  // On a trackpad a ring at the cursor fills towards the line.
  const dragTo = useCallback(
    (axis: "x" | "y", dist: number, line = SWIPE_PX) => {
      const el = frameRef.current;
      const root = rootRef.current;
      if (!el || !root) return;
      // Signed: left is negative (next), right positive (previous), down positive (close).
      const reach = Math.abs(dist);
      if (axis === "x") {
        // Sideways the finger scrubs the morph to the next photo; the page stays solid.
        placeX(dist);
        root.style.setProperty("--swipe", Math.min(reach / line, 1).toFixed(3));
        crossLine(root, reach > line);
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
      crossLine(root, reach > SWIPE_PX);
      root.setAttribute("data-swipe-dir", "close");
    },
    [mode, placeX],
  );

  const startDrag = useCallback(() => {
    // A spring-back or the opening growth still running would override the drag; a
    // sideways spring is caught where it is (the drag carries on from dragX).
    springRef.current?.stop();
    springRef.current = null;
    frameRef.current?.getAnimations().forEach((a) => a.cancel());
    rootRef.current?.setAttribute("data-dragging", "true");
  }, []);

  const endDrag = useCallback(
    (axis: "x" | "y", dist: number, velocity = 0, line = SWIPE_PX) => {
      const el = frameRef.current;
      const root = rootRef.current;
      root?.removeAttribute("data-dragging");
      if (!el || !root) return;
      if (axis === "y" && dist > SWIPE_PX) {
        commitTap();
        close();
        return;
      }
      if (axis === "x") {
        // Where the release would carry it decides: past the line it steps, else it falls back.
        const projected = dist + (velocity / 1000) * PROJECT_MS;
        if (projected < -line && dist < 0 && next) {
          commitTap();
          go(1, false, velocity);
          return;
        }
        if (projected > line && dist > 0 && prev) {
          commitTap();
          go(-1, false, velocity);
          return;
        }
        root.style.removeProperty("--swipe");
        root.removeAttribute("data-swipe-ready");
        root.removeAttribute("data-swipe-cursor");
        if (dist === 0 || reducedMotion()) {
          placeX(0);
          return;
        }
        // The morph springs back, keeping the speed the swipe had.
        springRef.current = animate(dist, 0, {
          ...BACK_SPRING,
          velocity,
          onUpdate: (x) => placeX(x),
          onComplete: () => placeX(0),
        });
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
    [close, go, next, prev, placeX],
  );

  // Touch: a drag locks to whichever way the finger first moves.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || closingRef.current || steppingRef.current) return;
    cancelHold();
    // A finger held still on either side steps too; moving it turns it into a swipe.
    const side = holdSide(e.clientX);
    if (side !== null) startHold(side, e.clientX, e.clientY - 72, TOUCH_HOLD_MS);
    startDrag();
    drag.current = {
      base: dragX.current,
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
    if (e.pointerType === "mouse") {
      onFrameMouseMove(e);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return;
      cancelHold();
      // A slightly diagonal swipe still counts as sideways; only a clearly downward one closes.
      d.axis = Math.abs(dx) > Math.abs(dy) * 0.7 ? "x" : "y";
    }
    // Sideways towards a photo that's there it follows the finger; past the first or last
    // it stretches like elastic. Down closes.
    if (d.axis === "y") d.dist = Math.max(0, dy);
    else {
      const x = d.base + dx * TOUCH_GAIN;
      d.dist = (x < 0 ? next : prev) ? x : rubber(x, figureRef.current?.clientWidth ?? 0);
    }
    const now = performance.now();
    d.trail.push({ x: e.clientX, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 100) d.trail.shift();
    dragTo(d.axis, d.dist, TOUCH_SWIPE_PX);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    // A tap on a side of the photo (no drag): step to that side without waiting out the hold.
    if (d && !d.axis && finishHold()) {
      rootRef.current?.removeAttribute("data-dragging");
      tapOnRelease();
      return;
    }
    cancelHold();
    if (!d) {
      rootRef.current?.removeAttribute("data-dragging");
      return;
    }
    // The photo carries on at the speed the finger let go at (none if it stopped first).
    endDrag(d.axis ?? "y", d.dist, d.axis === "x" ? speedOf(d.trail) * TOUCH_GAIN : 0, TOUCH_SWIPE_PX);
  };

  // The browser took the touch (to scroll, say): not a tap, so no step.
  const onPointerCancel = () => {
    cancelHold();
    onPointerUp();
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
    let shown = 0;
    let trail: { x: number; t: number }[] = [];
    let active = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    // A swipe's momentum keeps arriving after it has stepped. Arriving by a step, the new
    // photo ignores it until the wheel has been quiet for a moment, so one swipe is one photo.
    // (Kept in refs: this effect re-runs as the photos alongside load.)
    const cool = coolRef.current;
    const settle = () => {
      if (!active) return;
      active = false;
      if (!closingRef.current) endDrag("x", shown, 0);
      dist = 0;
      shown = 0;
      trail = [];
    };
    const onWheel = (e: WheelEvent) => {
      if (closingRef.current || steppingRef.current) {
        // Swallow the momentum still arriving after the photo closed or stepped.
        if (active) e.preventDefault();
        return;
      }
      const now = performance.now();
      const quiet = now - cool.last > 200;
      cool.last = now;
      if (cool.on && !quiet && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        return;
      }
      cool.on = false;
      if (e.ctrlKey) return; // pinch to zoom
      if (!active) {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        // At either end the swipe is left to the browser.
        if (e.deltaX > 0 ? !next : !prev) return;
      }
      e.preventDefault();
      if (!active) {
        active = true;
        cancelHold();
        startDrag();
        root.setAttribute("data-swipe-cursor", "");
      }
      // The ring sits on the cursor, and keeps with it.
      followCursor(e);
      if (trail.length === 0) dist = dragX.current;
      dist -= e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      shown = (dist < 0 ? next : prev) ? dist : rubber(dist, figureRef.current?.clientWidth ?? 0);
      trail.push({ x: shown, t: now });
      while (trail.length > 2 && now - trail[0].t > 100) trail.shift();
      dragTo("x", shown);
      if (Math.abs(shown) > SWIPE_PX) {
        // Past the line it goes at once, at the swipe's speed, rather than waiting out the
        // momentum still to come.
        endDrag("x", shown, speedOf(trail));
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(settle, 140);
    };
    const followCursor = (e: MouseEvent) => {
      root.style.setProperty("--swipe-x", `${e.clientX}px`);
      root.style.setProperty("--swipe-y", `${e.clientY}px`);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (root.hasAttribute("data-swipe-cursor")) followCursor(e);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      clearTimeout(idle);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("mousemove", onMouseMove);
    };
  }, [dragTo, startDrag, endDrag, next, prev, cancelHold]);

  // With a mouse the ring is the cursor: it follows the pointer anywhere on the view, an
  // arrow inside on either side of the photo (where holding steps), a dot elsewhere. Over
  // anything to click or read it gives way to the usual cursor. globals.css hides the
  // system one while data-cursor is set, and only on a fine pointer that hovers.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const hide = () => {
      root.removeAttribute("data-cursor");
      root.removeAttribute("data-aim");
    };
    const place = (x: number, y: number, t: Element | null) => {
      // Placed before it shows, so it never starts out anywhere but the pointer.
      root.style.setProperty("--swipe-x", `${x}px`);
      root.style.setProperty("--swipe-y", `${y}px`);
      if (!t || !root.contains(t) || t.closest(PLAIN_CURSOR) || ownsText(t)) return hide();
      root.setAttribute("data-cursor", "");
      const over = frameRef.current?.contains(t) ? holdSide(x) : null;
      if (over === null) root.removeAttribute("data-aim");
      else root.setAttribute("data-aim", over === 1 ? "next" : "prev");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches) return hide();
      place(e.clientX, e.clientY, e.target instanceof Element ? e.target : null);
    };
    trackPointer();
    if (lastPointer && fine.matches) place(lastPointer.x, lastPointer.y, document.elementFromPoint(lastPointer.x, lastPointer.y));
    root.addEventListener("pointermove", onMove, { passive: true });
    // Leaving the view (or the window) takes it away.
    root.addEventListener("pointerleave", hide);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", hide);
    };
  }, [holdSide]);


  const version = shareVersion(photo);
  const share = (className: string) => (
    // Keyed by slug so a new photo remounts with a fresh, uncached card.
    <ShareButton key={slug} slug={slug} caption={title} version={version} className={className} />
  );

  // This photo's words, or the next one's once a step has committed.
  const shown = showing ?? wordsOf({ title, date: photo.date, lat: photo.lat, lon: photo.lon }, place);
  const shownKey = JSON.stringify(shown);
  useEffect(() => {
    wordsRef.current = JSON.parse(shownKey) as Words;
  }, [shownKey]);

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
      {/* At the cursor: the cursor itself with a mouse, and the progress of a swipe or hold,
          filling as it nears the next photo. */}
      <svg className="pv-swipe" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="pv-swipe-disc" cx="24" cy="24" r="23" />
        <circle className="pv-swipe-track" cx="24" cy="24" r="18" />
        <circle className="pv-swipe-fill" cx="24" cy="24" r="18" />
        <path className="pv-swipe-arrow" data-dir="next" d="M17 24h14M26 19l5 5-5 5" />
        <path className="pv-swipe-arrow" data-dir="prev" d="M31 24H17M22 19l-5 5 5 5" />
        <circle className="pv-swipe-dot" cx="24" cy="24" r="2" />
      </svg>
      <SiteHeader current="photo" />

      <div className="pv-head">
        <div className="pv-bar">
          <span className="pv-kicker label">
            <Morph from={ghost?.kicker}>{shown.kicker}</Morph>
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
          data-length={shown.title.length > 70 ? "long" : shown.title.length > 30 ? "mid" : undefined}
        >
          {ghost && ghost.title !== shown.title && (
            <span
              className="pv-ghost pv-ghost-title"
              aria-hidden="true"
              style={{ fontSize: ghost.titleFont, lineHeight: ghost.titleLineHeight }}
            >
              {ghost.title}
            </span>
          )}
          <span className="pv-new" data-morph={Boolean(ghost && ghost.title !== shown.title)}>
            {shown.title}
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
              onPointerCancel={onPointerCancel}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") cancelHold();
              }}
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
          {shown.facts.length > 0 && (
            <dl className="pv-facts">
              {shown.facts.map((f, i) => (
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
