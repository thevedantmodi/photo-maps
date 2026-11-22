/**
 * Values for the 1080x1920 share card.
 *
 * Satori (which backs next/og) has no CSS custom properties, so the card cannot read
 * globals.css. These literals mirror its tokens (--bg, --ink, --muted) for both themes.
 * Change them there first, then here.
 */

export const CARD = {
  width: 1080,
  height: 1920,
  /**
   * Instagram overlays its caption bar and reply box across roughly the top and bottom 250px
   * of a story. Nothing that matters may sit inside these bands: the caption, place, date
   * and link run along the side edges between them.
   */
  safeInset: 300,
} as const;

export const PALETTE = {
  // bar: the letterbox around a photo that doesn't fill its window, a step off the border.
  dark: { bg: '#1c1c1c', ink: '#ededed', muted: '#9a9a9a', bar: '#0a0a0a' },
  light: { bg: '#ededeb', ink: '#141414', muted: '#636361', bar: '#dededb' },
} as const;

/** The border all round the photo window; the metadata is printed along it. */
export const BORDER = 64;

/**
 * The window the photo sits in. The photo is fitted inside it, never cropped or upscaled;
 * whatever it doesn't fill shows as bars.
 */
export const WINDOW = {
  width: CARD.width - 2 * BORDER,
  height: CARD.height - 2 * BORDER,
  /** radius-xs × 2.5 */
  radius: 10,
} as const;

/**
 * The map behind the window (lib/staticMap.ts). Zoom 13 in Mapbox's 512px tiles is about
 * 7 × 13 km across the window: a city's parks, rivers and street grid, not its buildings.
 * It is kept faint: a quarter of its colour, then washed most of the way to the bar colour,
 * so the photo stays the only thing on the card with colour in it.
 */
export const MAP = {
  zoom: 13,
  saturation: 0.25,
  /** Blur radius (sigma, px at the card's size) that turns the map's labels into texture. */
  blur: 2,
  /** How much of the bar colour lies over the map, per theme. */
  veil: { light: 0.88, dark: 0.8 },
  /** Bars thinner than this (a photo that nearly fills the window) don't get a map. */
  minBar: 24,
  timeoutMs: 4000,
  credit: '© Mapbox © OpenStreetMap',
} as const;

/** A soft shadow that lifts the photo off the map; none over plain bars. */
export const PHOTO_SHADOW = {
  light: '0 20px 50px rgba(0, 0, 0, 0.14)',
  dark: '0 20px 50px rgba(0, 0, 0, 0.45)',
} as const;

/** Space between the items along one edge. */
export const EDGE_GAP = 22;

export const TYPE = {
  name: { fontSize: 26, letterSpacing: -0.5 },
  year: { fontSize: 26, fontWeight: 600, letterSpacing: 0.5 },
  caption: { fontSize: 32, fontWeight: 600, letterSpacing: -0.8 },
  place: { fontSize: 26 },
  date: { fontSize: 26 },
  camera: { fontSize: 24 },
  /** Geist Mono: the coordinates and the typeable link. */
  mono: { fontSize: 22 },
  /** The map credit, Geist Mono, at the right of the bottom edge. */
  credit: { fontSize: 18 },
} as const;

export const FONT = {
  sans: 'Geist',
  mono: 'Geist Mono',
} as const;
