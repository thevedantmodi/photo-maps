"use client";

import { motion } from "framer-motion";
import { Photo } from "../types";

// Outer size of `.photo-marker` in globals.css (48px + 3px border each side);
// GAP keeps neighbours from touching.
const MARKER_SIZE = 54;
const GAP = 8;
const SPACING = MARKER_SIZE + GAP;
const MIN_RING_RADIUS = 56;
const RING_MAX = 8;

/**
 * Screen offsets (px) for fanning `n` photos around one point: a ring up to
 * RING_MAX, then an Archimedean spiral whose turns and neighbours both stay
 * SPACING apart, so no two markers overlap however many share the spot.
 */
export function fanOffsets(n: number): { x: number; y: number }[] {
  if (n <= RING_MAX) {
    const r = Math.max(MIN_RING_RADIUS, (SPACING * n) / (2 * Math.PI));
    return Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  const out: { x: number; y: number }[] = [];
  let leg = SPACING;
  let angle = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    out.push({ x: leg * Math.cos(angle), y: leg * Math.sin(angle) });
    const step = SPACING / leg;
    angle += step;
    leg += (SPACING * step) / (2 * Math.PI);
  }
  return out;
}

/** Farthest a fanned marker's edge reaches from the centre, for keeping the fan on screen. */
export function fanExtent(n: number): number {
  const offsets = fanOffsets(n);
  return Math.max(...offsets.map((o) => Math.hypot(o.x, o.y))) + MARKER_SIZE / 2;
}

interface PhotoStackProps {
  photos: Photo[];
  onSelect: (photo: Photo) => void;
}

/**
 * Photos that share a spot, fanned out around it with a leader line back to
 * the true location. Rendered inside a Marker anchored at that location.
 */
export default function PhotoStack({ photos, onSelect }: PhotoStackProps) {
  const offsets = fanOffsets(photos.length);
  const extent = fanExtent(photos.length);

  return (
    <div className="photo-stack">
      <svg
        className="photo-stack-legs"
        width={extent * 2}
        height={extent * 2}
        viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
      >
        {offsets.map((o, i) => (
          <motion.line
            key={photos[i].id}
            x1={0}
            y1={0}
            initial={{ x2: 0, y2: 0 }}
            animate={{ x2: o.x, y2: o.y }}
            transition={{ duration: 0.2, delay: i * 0.015 }}
          />
        ))}
      </svg>
      <div className="photo-stack-origin" />
      {photos.map((photo, i) => (
        <motion.button
          key={photo.id}
          type="button"
          className="photo-marker photo-stack-item"
          aria-label={photo.caption || photo.original_name}
          style={{ backgroundImage: `url('${photo.thumb_url}')` }}
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
          animate={{ x: offsets[i].x, y: offsets[i].y, scale: 1, opacity: 1 }}
          transition={{ duration: 0.2, delay: i * 0.015 }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(photo);
          }}
        />
      ))}
    </div>
  );
}
