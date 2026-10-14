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
   * of a story. Nothing readable may sit inside these bands.
   */
  safeInset: 300,
  sidePadding: 84,
} as const;

export const PALETTE = {
  dark: { bg: '#1c1c1c', ink: '#ededed', muted: '#9a9a9a' },
  light: { bg: '#ededeb', ink: '#141414', muted: '#636361' },
} as const;

export const PHOTO = {
  maxWidth: CARD.width - 2 * CARD.sidePadding,
  maxHeight: 900,
  minHeight: 420,
  /** Space above and below the photo, between the header rule and the title. */
  gap: 48,
} as const;

export const QR = {
  /** rendered size on the card, including its white tile */
  tile: 168,
  padding: 14,
  /** generated larger, so downsampling stays crisp */
  renderSize: 560,
} as const;

/** Lines between the rows of the card are this thick. */
export const RULE = 2;

export const TYPE = {
  name: { fontSize: 44, letterSpacing: -0.9 },
  year: { fontSize: 32, fontWeight: 600, letterSpacing: 0.6 },
  /** Title size steps down as captions get longer, so most fit on two lines. */
  title: [
    { maxChars: 16, fontSize: 120 },
    { maxChars: 32, fontSize: 96 },
    { maxChars: 60, fontSize: 72 },
    { maxChars: Infinity, fontSize: 56 },
  ],
  titleLineHeight: 0.95,
  titleLetterSpacing: -0.04,
  row: { fontSize: 32, labelWidth: 260 },
  urlLabel: { fontSize: 28 },
  url: { fontSize: 34, fontWeight: 600 },
} as const;

export const FONT = {
  sans: 'Geist',
} as const;
