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
} as const;

export const FONT = {
  sans: 'Geist',
  mono: 'Geist Mono',
} as const;
