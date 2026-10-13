/**
 * Values for the share cards: the 1080x1920 story card, and the 1200x630 link preview (OG).
 *
 * Satori (which backs next/og) has no CSS custom properties, so the card cannot read
 * globals.css. These literals mirror the Photo Maps design system — the source of truth is
 * project/tokens.json in the Design System artifact 5Cei2PGXh8r6JKN1WEZM7W. Change them there
 * first, then here.
 *
 * SCALE: tokens are authored as 1x CSS px. The card is a 1080px-wide canvas viewed on a
 * ~390pt phone, so token px are multiplied by 2.5 to land at the same apparent size.
 */

export const SCALE = 2.5;

export const CARD = {
  width: 1080,
  height: 1920,
  /**
   * Instagram overlays its caption bar and reply box across roughly the top and bottom 250px
   * of a story. Nothing readable may sit inside these bands.
   */
  safeInset: 300,
  sidePadding: 84,
} as const;

export const PHOTO = {
  maxWidth: 912,
  maxHeight: 1000,
  /** radius-xs (4px) scaled, rounded to the nearest even px */
  radius: 10,
  /** shadow-photo, scaled */
  shadow: '0 50px 125px rgba(0, 0, 0, 0.5)',
} as const;

/**
 * The ambient layer: the same photo, blurred to fill the frame. Satori has no filter
 * property, so sharp bakes this before render.
 */
export const AMBIENT = {
  blur: 70,
  brightness: 0.72,
  saturation: 1.6,
  quality: 60,
} as const;

/**
 * The liquid-glass plate. Translucent rather than blurred on purpose: the ambient layer
 * behind it is already blurred, so a flat translucent fill reads as frosted glass without
 * backdrop-filter (which satori does not support).
 *
 * The inset highlight is the glass recipe from the shadow-toggle token, scaled.
 */
export const GLASS = {
  background: 'rgba(28, 28, 30, 0.58)',
  border: '3px solid rgba(255, 255, 255, 0.18)',
  radius: 72,
  shadow: '0 32px 90px rgba(0, 0, 0, 0.45), inset 0 3px 0 rgba(255, 255, 255, 0.15)',
  paddingY: 48,
  paddingX: 56,
  gap: 52,
  text: '#ffffff',
} as const;

/**
 * The mini map that sits beside the caption, in the slot a QR code used to fill. On a story
 * the viewer is already on their phone, so a QR is unscannable; a map says where the photo
 * was taken, which is the point of the site.
 */
export const MAP = {
  size: 256,
  radius: 28,
  /** frame width in px; drawn in GLASS's border colour */
  frame: 3,
  frameColor: 'rgba(255, 255, 255, 0.18)',
  shadow: '0 14px 40px rgba(0, 0, 0, 0.3)',
} as const;

/**
 * The pin on the mini map: the photo itself in a white ring, like a marker on the live map
 * (.photo-marker). Larger than 48px scaled would suggest, so it reads on a small tile.
 */
export const PIN = {
  size: 76,
  /** white ring width in px */
  ring: 5,
  shadow: '0 6px 16px rgba(0, 0, 0, 0.5)',
} as const;

export const TYPE = {
  caption: { fontSize: 50, fontWeight: 600, letterSpacing: -1, lineHeight: 1.15 },
  place: { fontSize: 34, fontWeight: 400, opacity: 0.92 },
  date: { fontSize: 32, fontWeight: 400, opacity: 0.82 },
  url: { fontSize: 26, fontWeight: 400, opacity: 0.72 },
} as const;

/**
 * The 1200x630 link preview used for og:image. Chat apps and X show a 1.91:1 image; the
 * 9:16 story card cropped to that is a strip from its middle. X crops to 2:1, trimming 15px
 * top and bottom, which the padding absorbs.
 */
export const OG = {
  width: 1200,
  height: 630,
  padding: 56,
  gap: 48,
  photoMaxWidth: 520,
  photoRadius: 8,
  photoShadow: '0 24px 60px rgba(0, 0, 0, 0.5)',
  plateRadius: 40,
  platePadding: 40,
  mapSize: 120,
  mapRadius: 16,
  mapFrame: 2,
  pinSize: 40,
  pinRing: 3,
  caption: { fontSize: 40, fontWeight: 600, letterSpacing: -0.8, lineHeight: 1.15 },
  place: { fontSize: 26, fontWeight: 400, opacity: 0.92 },
  date: { fontSize: 24, fontWeight: 400, opacity: 0.82 },
} as const;

export const FONT = {
  sans: 'Geist',
  mono: 'Geist Mono',
} as const;

/** background token, dark theme — the ground behind everything if a photo fails to load */
export const BACKGROUND = '#0a0a0a';
