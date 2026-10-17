type AltSource = {
  alt_text: string | null;
  caption: string | null;
  date: string | null;
};

/**
 * The alt attribute for a photo. Every <img> of a photo should go through this so none ships
 * without one.
 *
 * Prefers the hand-written alt text, then the caption. original_name is deliberately not a
 * fallback: it's the uploaded filename ("IMG_4021.HEIC"), which reads worse than nothing.
 */
export function photoAlt(photo: AltSource): string {
  const alt = photo.alt_text?.trim() || photo.caption?.trim();
  if (alt) return alt;

  const d = photo.date ? new Date(photo.date) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `Photo taken ${when}`;
  }
  return 'Photo';
}

type TitleSource = {
  caption: string | null;
  date: string | null;
};

/**
 * The title shown for a photo: its caption, or, since original_name is just the uploaded
 * filename ("IMG_4021.HEIC"), when it was taken.
 */
export function photoTitle(photo: TitleSource): string {
  const caption = photo.caption?.trim();
  if (caption) return caption;
  const d = photo.date ? new Date(photo.date) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `Photo from ${when}`;
  }
  return 'Untitled photo';
}
