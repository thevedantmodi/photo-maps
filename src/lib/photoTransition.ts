/**
 * Where a photo's thumbnail sat on screen when it was clicked, so the photo page can grow
 * the photo out of that exact spot and, on close, shrink it back in. Module state in the
 * browser: it only needs to live from the click on the map to the photo page closing.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let last: { slug: string; rect: Rect; at: number } | null = null;

/** How long after the click the growing animation still makes sense. */
const FRESH_MS = 4000;

export function rememberOpen(slug: string, el: Element) {
  const r = el.getBoundingClientRect();
  last = { slug, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, at: Date.now() };
}

/** The thumbnail's rect for growing the photo, if this photo was just clicked. */
export function openOrigin(slug: string): Rect | null {
  if (!last || last.slug !== slug || Date.now() - last.at > FRESH_MS) return null;
  return last.rect;
}

/** The rect to shrink back into on close. The map hasn't moved underneath, so no age limit. */
export function closeTarget(slug: string): Rect | null {
  return last && last.slug === slug ? last.rect : null;
}

export function forget(slug: string) {
  if (last?.slug === slug) last = null;
}
