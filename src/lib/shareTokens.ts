/**
 * Values for the 1080x1920 share card.
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

export const QR = {
  /** rendered size on the card */
  size: 216,
  /** generated larger, so downsampling stays crisp */
  renderSize: 648,
  padding: 20,
  radius: 28,
  shadow: '0 14px 40px rgba(0, 0, 0, 0.3)',
} as const;

export const TYPE = {
  caption: { fontSize: 50, fontWeight: 600, letterSpacing: -1, lineHeight: 1.15 },
  date: { fontSize: 32, fontWeight: 400, opacity: 0.82 },
  url: { fontSize: 26, fontWeight: 400, opacity: 0.72 },
} as const;

export const FONT = {
  sans: 'Geist',
  mono: 'Geist Mono',
} as const;

/** background token, dark theme — the ground behind everything if a photo fails to load */
export const BACKGROUND = '#0a0a0a';
